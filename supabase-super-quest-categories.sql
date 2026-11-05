-- ============================================================================
-- Super Quest categories, and the two lists (Ames 2026-10-28).
--
-- Each Super Quest (proofreading_tasks.kind = 'interneuron') now has a
-- category, shown to players on the row and in the Super Quests list:
--   Pyramidal Target      17 cells (both demo cells are in it)
--   Non-Pyramidal Target  12 cells
-- Admin Hub > Super Quests adds more cells to a category (pilot_quest_admin
-- takes a category now).
--
-- Run after supabase-interneuron-quests.sql. Safe to re-run.
-- ============================================================================
BEGIN;

ALTER TABLE public.proofreading_tasks ADD COLUMN IF NOT EXISTS quest_category text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proofreading_tasks_quest_category_check') THEN
    ALTER TABLE public.proofreading_tasks ADD CONSTRAINT proofreading_tasks_quest_category_check CHECK (quest_category IS NULL OR length(quest_category) <= 60);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_quest_admin(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ds text := p_args->>'dataset'; c jsonb; seg text; t public.proofreading_tasks%ROWTYPE;
  cat text := nullif(btrim(coalesce(p_args->>'category', '')), '');
  px double precision; py double precision; pz double precision; svx text;
  added integer := 0; changed integer := 0; already integer := 0; bad jsonb := '[]';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admins a JOIN public.users u ON lower(a.email) = lower(u.middleauth_email) WHERE u.id = p_user)
    THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
  IF p_action = 'add' THEN
    IF ds IS NULL OR ds !~ '^[a-z0-9_]{1,64}$' THEN RAISE EXCEPTION 'Invalid dataset'; END IF;
    IF cat IS NOT NULL AND (length(cat) > 60 OR cat !~ '^[[:print:]]+$') THEN RAISE EXCEPTION 'Invalid category'; END IF;
    IF jsonb_typeof(p_args->'cells') <> 'array' OR jsonb_array_length(p_args->'cells') > 500 THEN RAISE EXCEPTION 'Send up to 500 cells at once'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(98127, 61750);
    FOR c IN SELECT * FROM jsonb_array_elements(p_args->'cells') LOOP
      seg := c->>'segment_id';
      svx := CASE WHEN coalesce(c->>'supervoxel_id','') ~ '^[0-9]{10,20}$' THEN c->>'supervoxel_id' END;
      px := NULL; py := NULL; pz := NULL;
      IF jsonb_typeof(c->'point') = 'array' AND jsonb_array_length(c->'point') = 3 THEN
        BEGIN
          px := (c->'point'->>0)::double precision; py := (c->'point'->>1)::double precision; pz := (c->'point'->>2)::double precision;
        EXCEPTION WHEN others THEN px := NULL; py := NULL; pz := NULL; END;
        IF abs(px) > 1e9 OR abs(py) > 1e9 OR abs(pz) > 1e9 THEN px := NULL; py := NULL; pz := NULL; END IF;
      END IF;
      IF seg IS NULL OR seg !~ '^[1-9][0-9]{0,19}$' THEN bad := bad || to_jsonb(coalesce(seg, '')); CONTINUE; END IF;
      SELECT * INTO t FROM public.proofreading_tasks WHERE dataset = ds AND segment_id = seg
        ORDER BY (status IN ('assigned','in_progress')) DESC, id LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        IF t.kind = 'interneuron' AND t.status <> 'skipped' THEN
          -- Already a Super Quest: only its category may change.
          IF cat IS NOT NULL AND t.quest_category IS DISTINCT FROM cat THEN
            UPDATE public.proofreading_tasks SET quest_category = cat, updated_at = now() WHERE id = t.id;
            changed := changed + 1;
          ELSE already := already + 1; END IF;
          CONTINUE;
        END IF;
        UPDATE public.proofreading_tasks SET kind = 'interneuron',
          status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END,
          claim_point_x = coalesce(claim_point_x, px), claim_point_y = coalesce(claim_point_y, py), claim_point_z = coalesce(claim_point_z, pz),
          nucleus_coords = coalesce(nucleus_coords, CASE WHEN px IS NOT NULL THEN concat_ws(', ', px, py, pz) END),
          supervoxel_id = coalesce(supervoxel_id, svx),
          notes = coalesce(nullif(left(c->>'note', 200), ''), notes),
          quest_category = coalesce(cat, quest_category),
          updated_at = now() WHERE id = t.id;
        UPDATE public.task_assignments SET expires_at = 'infinity' WHERE task_id = t.id AND status = 'active';
        changed := changed + 1;
      ELSE
        INSERT INTO public.proofreading_tasks (dataset, segment_id, kind, claim_point_x, claim_point_y, claim_point_z, nucleus_coords, supervoxel_id, notes, quest_category)
        VALUES (ds, seg, 'interneuron', px, py, pz, CASE WHEN px IS NOT NULL THEN concat_ws(', ', px, py, pz) END, svx, nullif(left(c->>'note', 200), ''), cat);
        added := added + 1;
      END IF;
    END LOOP;
    RETURN jsonb_build_object('added', added, 'changed', changed, 'already', already, 'bad', bad);
  ELSIF p_action = 'remove' THEN
    IF coalesce(p_args->>'id','') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'Invalid quest'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(98127, 61750);
    UPDATE public.proofreading_tasks SET status = 'skipped', updated_at = now()
      WHERE id = (p_args->>'id')::integer AND kind = 'interneuron' AND status = 'pending' RETURNING * INTO t;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only a quest no one holds can be taken off the list'; END IF;
    RETURN to_jsonb(t);
  ELSIF p_action = 'report' THEN
    IF ds IS NULL OR ds !~ '^[a-z0-9_]{1,64}$' THEN RAISE EXCEPTION 'Invalid dataset'; END IF;
    RETURN jsonb_build_object(
      'quests', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', k.id, 'segment_id', k.segment_id, 'status', k.status, 'notes', k.notes, 'category', k.quest_category,
          'final_segment_id', k.final_segment_id, 'nucleus_coords', k.nucleus_coords,
          'holder', nullif(coalesce(nullif(u.username, ''), u.display_name), ''),
          'active_seconds', coalesce((SELECT sum(c2.active_seconds) FROM public.claim_active_time c2 WHERE c2.task_id = k.id), 0),
          'players', (SELECT count(*) FROM public.claim_active_time c2 WHERE c2.task_id = k.id))
          ORDER BY k.status <> 'skipped' DESC, k.quest_category NULLS LAST, k.id)
        FROM public.proofreading_tasks k LEFT JOIN public.users u ON u.id = k.assigned_to
        WHERE k.dataset = ds AND k.kind = 'interneuron'), '[]'::jsonb),
      'times', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'task_id', c.task_id, 'segment_id', k.segment_id, 'kind', k.kind, 'category', k.quest_category, 'status', k.status,
          'mine', k.assigned_to = c.user_id,
          'player', coalesce(nullif(u.username, ''), nullif(u.display_name, ''), 'player'),
          'active_seconds', c.active_seconds, 'days', c.days, 'beats', c.beats,
          'edits', c.edits, 'views_saved', c.views_saved, 'milestones', c.milestones,
          'first_at', c.first_at, 'last_at', c.last_at) ORDER BY c.active_seconds DESC)
        FROM public.claim_active_time c JOIN public.proofreading_tasks k ON k.id = c.task_id
        LEFT JOIN public.users u ON u.id = c.user_id
        WHERE k.dataset = ds AND c.active_seconds > 0), '[]'::jsonb));
  END IF;
  RAISE EXCEPTION 'Unknown quest action';
END;
$$;

REVOKE ALL ON FUNCTION public.pilot_quest_admin(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_quest_admin(uuid,text,jsonb) TO service_role;

-- Pyramidal Target: 17 cells
INSERT INTO public.proofreading_tasks (dataset, segment_id, kind, quest_category)
SELECT 'pni_mec', s, 'interneuron', 'Pyramidal Target'
FROM unnest(ARRAY[
  '720575947400201311',
  '720575947582584839',
  '720575947504479978',
  '720575947457118433',
  '720575947560901294',
  '720575947474371141',
  '720575947484765350',
  '720575947522517632',
  '720575947484144550',
  '720575947498101437',
  '720575947480409234',
  '720575947475841668',
  '720575947488882169',
  '720575947456885923',
  '720575947543729736',
  '720575947503051632',
  '720575947546616180'
]) AS s
WHERE NOT EXISTS (SELECT 1 FROM public.proofreading_tasks t WHERE t.dataset = 'pni_mec' AND t.segment_id = s);
UPDATE public.proofreading_tasks SET kind = 'interneuron', quest_category = 'Pyramidal Target',
  status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END, updated_at = now()
WHERE dataset = 'pni_mec' AND segment_id = ANY (ARRAY[
  '720575947400201311',
  '720575947582584839',
  '720575947504479978',
  '720575947457118433',
  '720575947560901294',
  '720575947474371141',
  '720575947484765350',
  '720575947522517632',
  '720575947484144550',
  '720575947498101437',
  '720575947480409234',
  '720575947475841668',
  '720575947488882169',
  '720575947456885923',
  '720575947543729736',
  '720575947503051632',
  '720575947546616180'
]) AND (kind <> 'interneuron' OR quest_category IS DISTINCT FROM 'Pyramidal Target' OR status = 'skipped');

-- Non-Pyramidal Target: 12 cells
INSERT INTO public.proofreading_tasks (dataset, segment_id, kind, quest_category)
SELECT 'pni_mec', s, 'interneuron', 'Non-Pyramidal Target'
FROM unnest(ARRAY[
  '720575947567719448',
  '720575947561581256',
  '720575947498715895',
  '720575947480605684',
  '720575947564391266',
  '720575947481969233',
  '720575947529035170',
  '720575947474082117',
  '720575947518069781',
  '720575947424580329',
  '720575947508067093',
  '720575947518958945'
]) AS s
WHERE NOT EXISTS (SELECT 1 FROM public.proofreading_tasks t WHERE t.dataset = 'pni_mec' AND t.segment_id = s);
UPDATE public.proofreading_tasks SET kind = 'interneuron', quest_category = 'Non-Pyramidal Target',
  status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END, updated_at = now()
WHERE dataset = 'pni_mec' AND segment_id = ANY (ARRAY[
  '720575947567719448',
  '720575947561581256',
  '720575947498715895',
  '720575947480605684',
  '720575947564391266',
  '720575947481969233',
  '720575947529035170',
  '720575947474082117',
  '720575947518069781',
  '720575947424580329',
  '720575947508067093',
  '720575947518958945'
]) AND (kind <> 'interneuron' OR quest_category IS DISTINCT FROM 'Non-Pyramidal Target' OR status = 'skipped');

-- Quest claims never expire.
UPDATE public.task_assignments a SET expires_at = 'infinity'
FROM public.proofreading_tasks t
WHERE a.task_id = t.id AND t.kind = 'interneuron' AND a.status = 'active' AND a.expires_at <> 'infinity';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: 17 and 12.
SELECT quest_category, count(*) AS cells, count(*) FILTER (WHERE status = 'pending') AS open
FROM public.proofreading_tasks WHERE dataset = 'pni_mec' AND kind = 'interneuron'
GROUP BY quest_category ORDER BY quest_category;
