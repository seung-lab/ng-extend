-- ============================================================================
-- Interneuron quests and active time per claim (Ames 2026-10-28).
--
-- MEC's giant interneurons have so many branches that one can take a player
-- weeks, worked on in many short visits. They are a kind of claim of their
-- own:
--   * proofreading_tasks.kind = 'interneuron' marks a cell on the quest list
--     (admins add them from Admin Hub > Quests, pilot_quest_admin below).
--   * A player holds ONE interneuron quest at a time, beside their ordinary
--     claims, which it does not count against.
--   * A quest claim never expires (its assignment runs to 'infinity', which
--     expire_stale_assignments never reaches).
--
-- Active time (claim_active_time): the game adds up the seconds a player
-- really works on a claimed cell (the cell on screen, the Pyr tab in front,
-- input in the last 5 minutes) and sends them about once a minute. The server
-- caps each beat at 90 seconds and at the wall time since the last beat for
-- that claim, so two tabs or two devices cannot count the same minute twice.
-- Kept per claim: the task and the player who holds it.
--
-- Achievements come later: claim_active_time.milestones records each hour
-- milestone a claim passes (10, 25, 50, 100 hours), and the beat answers with
-- the ones it just passed. A finished quest is a completed task of kind
-- 'interneuron'.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
BEGIN;

ALTER TABLE public.proofreading_tasks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cell';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proofreading_tasks_kind_check') THEN
    ALTER TABLE public.proofreading_tasks ADD CONSTRAINT proofreading_tasks_kind_check CHECK (kind IN ('cell', 'interneuron'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS proofreading_tasks_kind_idx ON public.proofreading_tasks (dataset, kind) WHERE kind <> 'cell';

CREATE TABLE IF NOT EXISTS public.claim_active_time (
  task_id integer NOT NULL REFERENCES public.proofreading_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  active_seconds integer NOT NULL DEFAULT 0,
  beats integer NOT NULL DEFAULT 0,          -- heartbeats that carried time
  days integer NOT NULL DEFAULT 0,           -- distinct days (UTC) with time
  last_day date,
  edits integer NOT NULL DEFAULT 0,          -- splits and merges on the cell
  views_saved integer NOT NULL DEFAULT 0,    -- Save view on the claim
  milestones integer[] NOT NULL DEFAULT '{}', -- hour milestones passed
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
ALTER TABLE public.claim_active_time ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.claim_active_time FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.claim_active_time TO service_role;

-- pilot_task_action: as in supabase-pilot-access.sql, with the quest rules.
CREATE OR REPLACE FUNCTION public.pilot_task_action(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.proofreading_tasks%ROWTYPE; a public.task_assignments%ROWTYPE; lim integer;
  ds text := p_args->>'dataset'; seg text := p_args->>'segment_id';
  px double precision := (p_args->'point'->>0)::double precision;
  py double precision := (p_args->'point'->>1)::double precision;
  pz double precision := (p_args->'point'->>2)::double precision;
  until timestamptz;
BEGIN
  IF NOT public.pilot_is_member(p_user) THEN RAISE EXCEPTION 'Invited testers only' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(98127, 61750);
  IF p_action = 'claim_cell' THEN
    IF ds IS NULL OR length(ds)>128 OR seg IS NULL OR seg !~ '^[0-9]{1,20}$'
      OR px IS NULL OR py IS NULL OR pz IS NULL
      OR abs(px)>1e9 OR abs(py)>1e9 OR abs(pz)>1e9 THEN RAISE EXCEPTION 'Invalid cell'; END IF;
    SELECT * INTO t FROM public.proofreading_tasks
      WHERE dataset=ds AND (segment_id=seg OR (claim_point_x=px AND claim_point_y=py AND claim_point_z=pz))
      ORDER BY (status IN ('assigned','in_progress')) DESC, id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.proofreading_tasks (dataset,segment_id,claim_point_x,claim_point_y,claim_point_z,supervoxel_id)
      VALUES(ds,seg,px,py,pz,p_args->>'supervoxel_id') RETURNING * INTO t;
    END IF;
  ELSE
    SELECT * INTO t FROM public.proofreading_tasks WHERE id=(p_args->>'id')::integer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cell not found'; END IF;
  END IF;
  -- A quest claim never expires; an ordinary one is renewed for 30 minutes.
  until := CASE WHEN t.kind = 'interneuron' THEN 'infinity'::timestamptz ELSE now()+interval '30 minutes' END;
  IF p_action IN ('claim','claim_cell') THEN
    IF t.status IN ('completed','skipped') THEN RAISE EXCEPTION 'This cell is already completed'; END IF;
    IF t.assigned_to IS NOT NULL AND t.assigned_to <> p_user THEN RAISE EXCEPTION 'This cell is already claimed'; END IF;
    IF EXISTS (SELECT 1 FROM public.proofreading_tasks o WHERE o.id<>t.id AND o.dataset=t.dataset
      AND o.status IN ('assigned','in_progress') AND (o.segment_id=t.segment_id OR
      (o.claim_point_x=t.claim_point_x AND o.claim_point_y=t.claim_point_y AND o.claim_point_z=t.claim_point_z)))
      THEN RAISE EXCEPTION 'This cell is already claimed'; END IF;
    IF t.kind = 'interneuron' THEN
      -- One interneuron quest at a time, in every dataset (Ames 2026-10-28).
      IF t.assigned_to IS DISTINCT FROM p_user AND EXISTS (SELECT 1 FROM public.proofreading_tasks
           WHERE assigned_to=p_user AND kind='interneuron' AND status IN ('assigned','in_progress'))
        THEN RAISE EXCEPTION 'You already hold an interneuron quest. Finish or release it first.'; END IF;
    ELSE
      -- Claim limit per dataset (Amy 2026-09-30): 10 on Retina, 8 elsewhere.
      -- Quests are not counted. Must match claimLimitFor() in src/store.ts.
      lim := CASE WHEN t.dataset = 'stroeh_mouse_retina' THEN 10 ELSE 8 END;
      IF t.assigned_to IS DISTINCT FROM p_user AND
         (SELECT count(*) FROM public.proofreading_tasks WHERE assigned_to=p_user AND dataset=t.dataset
            AND kind <> 'interneuron' AND status IN ('assigned','in_progress')) >= lim
        THEN RAISE EXCEPTION 'Max % claims reached', lim; END IF;
    END IF;
    UPDATE public.proofreading_tasks SET status='assigned',assigned_to=p_user,updated_at=now() WHERE id=t.id RETURNING * INTO t;
    SELECT * INTO a FROM public.task_assignments WHERE task_id=t.id AND user_id=p_user AND status='active' ORDER BY id DESC LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.task_assignments(task_id,user_id,expires_at) VALUES(t.id,p_user,until);
    ELSE
      UPDATE public.task_assignments SET expires_at=until WHERE id=a.id;
    END IF;
  ELSIF p_action IN ('release','complete','heartbeat') THEN
    IF t.assigned_to IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Only the current owner can change this claim' USING ERRCODE='42501'; END IF;
    IF p_action='complete' AND t.status='completed' THEN RETURN to_jsonb(t); END IF;
    IF t.status NOT IN ('assigned','in_progress') THEN RAISE EXCEPTION 'This claim is no longer active'; END IF;
    IF p_action='heartbeat' THEN
      UPDATE public.task_assignments SET expires_at=until WHERE task_id=t.id AND user_id=p_user AND status='active';
    ELSE
      UPDATE public.task_assignments SET status=CASE WHEN p_action='complete' THEN 'completed' ELSE 'released' END,
        completed_at=CASE WHEN p_action='complete' THEN now() ELSE completed_at END,
        released_at=CASE WHEN p_action='release' THEN now() ELSE released_at END
        WHERE task_id=t.id AND status='active';
      UPDATE public.proofreading_tasks SET status=CASE WHEN p_action='complete' THEN 'completed' ELSE 'pending' END,
        assigned_to=CASE WHEN p_action='complete' THEN p_user ELSE NULL END,
        final_segment_id=CASE WHEN p_action='complete' THEN coalesce(p_args->>'final_segment_id',final_segment_id) ELSE final_segment_id END,
        soma_coords=CASE WHEN p_action='complete' THEN coalesce(p_args->>'soma_coords',soma_coords) ELSE soma_coords END,
        updated_at=now() WHERE id=t.id RETURNING * INTO t;
    END IF;
  ELSIF p_action = 'save_link' THEN
    -- Each claimed cell keeps its own saved view (Amy 2026-09-28), so moving
    -- between claims restores that cell's annotation layers. Owner only,
    -- active claims only, one https link.
    IF t.assigned_to IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Only the current owner can change this claim' USING ERRCODE='42501'; END IF;
    IF t.status NOT IN ('assigned','in_progress') THEN RAISE EXCEPTION 'This claim is no longer active'; END IF;
    IF coalesce(p_args->>'link','') !~ '^https://[^[:space:]"''<>]+$' OR length(p_args->>'link') > 2000
      THEN RAISE EXCEPTION 'The link must be a single https link'; END IF;
    UPDATE public.proofreading_tasks SET working_link=p_args->>'link',updated_at=now() WHERE id=t.id RETURNING * INTO t;
  ELSE RAISE EXCEPTION 'Unknown claim action'; END IF;
  RETURN to_jsonb(t);
END;
$$;

-- Quest claims held before this ran stop expiring too.
UPDATE public.task_assignments a SET expires_at = 'infinity'
  FROM public.proofreading_tasks t
  WHERE a.task_id = t.id AND t.kind = 'interneuron' AND a.status = 'active';

-- ── Active time ─────────────────────────────────────────────────────────
-- p_action 'beat': {id, seconds, edits, saves} adds to the player's own active
--   claim. Answers {task_id, active_seconds, ..., passed: [hours]}.
-- p_action 'mine': the player's rows for their open claims, and for the
--   claims they finished or let go in the last 30 days.
CREATE OR REPLACE FUNCTION public.pilot_claim_time(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.proofreading_tasks%ROWTYPE; r public.claim_active_time%ROWTYPE;
  secs integer; ed integer; sv integer; gap integer; hrs integer[] := ARRAY[10, 25, 50, 100];
  passed integer[] := '{}'; h integer;
BEGIN
  IF NOT public.pilot_is_member(p_user) THEN RAISE EXCEPTION 'Invited testers only' USING ERRCODE='42501'; END IF;
  IF p_action = 'mine' THEN
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM public.claim_active_time c
      JOIN public.proofreading_tasks k ON k.id = c.task_id
      WHERE c.user_id = p_user AND (k.assigned_to = p_user OR c.last_at > now() - interval '30 days')), '[]'::jsonb);
  ELSIF p_action <> 'beat' THEN RAISE EXCEPTION 'Unknown time action'; END IF;

  IF coalesce(p_args->>'id','') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'Invalid claim'; END IF;
  -- Whole numbers only; anything else counts as nothing.
  secs := CASE WHEN coalesce(p_args->>'seconds','') ~ '^[0-9]{1,6}$' THEN (p_args->>'seconds')::integer ELSE 0 END;
  ed := CASE WHEN coalesce(p_args->>'edits','') ~ '^[0-9]{1,6}$' THEN least((p_args->>'edits')::integer, 50) ELSE 0 END;
  sv := CASE WHEN coalesce(p_args->>'saves','') ~ '^[0-9]{1,6}$' THEN least((p_args->>'saves')::integer, 10) ELSE 0 END;
  secs := least(secs, 90);
  SELECT * INTO t FROM public.proofreading_tasks WHERE id = (p_args->>'id')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such claim'; END IF;
  IF t.assigned_to IS DISTINCT FROM p_user OR t.status NOT IN ('assigned','in_progress') THEN
    RAISE EXCEPTION 'This claim is no longer active'; END IF;

  INSERT INTO public.claim_active_time (task_id, user_id, last_at) VALUES (t.id, p_user, now() - interval '90 seconds')
    ON CONFLICT (task_id, user_id) DO NOTHING;
  SELECT * INTO r FROM public.claim_active_time WHERE task_id = t.id AND user_id = p_user FOR UPDATE;
  -- No more than the time since the last beat on this claim, from any tab or
  -- device, plus a little for the network.
  gap := greatest(0, ceil(extract(epoch FROM now() - r.last_at))::integer + 5);
  secs := least(secs, gap);
  FOREACH h IN ARRAY hrs LOOP
    IF r.active_seconds < h * 3600 AND r.active_seconds + secs >= h * 3600 THEN passed := passed || h; END IF;
  END LOOP;
  UPDATE public.claim_active_time SET
    active_seconds = active_seconds + secs,
    beats = beats + CASE WHEN secs > 0 THEN 1 ELSE 0 END,
    days = days + CASE WHEN secs > 0 AND last_day IS DISTINCT FROM current_date THEN 1 ELSE 0 END,
    last_day = CASE WHEN secs > 0 THEN current_date ELSE last_day END,
    edits = edits + ed,
    views_saved = views_saved + sv,
    milestones = milestones || passed,
    last_at = now()
    WHERE task_id = t.id AND user_id = p_user RETURNING * INTO r;
  RETURN to_jsonb(r) || jsonb_build_object('passed', to_jsonb(passed), 'kind', t.kind);
END;
$$;

-- ── Admins: the quest list and the time report ──────────────────────────
-- p_action 'add': {dataset, cells: [{segment_id, point?, supervoxel_id?, note?}]}
--   Adds each cell to the quest list. A cell already in the Cell Library
--   becomes a quest; one held as an ordinary claim keeps its holder.
-- p_action 'remove': {id} takes an unclaimed quest off the list.
-- p_action 'report': {dataset} the quests, and the time on every claim.
CREATE OR REPLACE FUNCTION public.pilot_quest_admin(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ds text := p_args->>'dataset'; c jsonb; seg text; t public.proofreading_tasks%ROWTYPE;
  px double precision; py double precision; pz double precision; svx text;
  added integer := 0; changed integer := 0; already integer := 0; bad jsonb := '[]';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admins a JOIN public.users u ON lower(a.email) = lower(u.middleauth_email) WHERE u.id = p_user)
    THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
  IF p_action = 'add' THEN
    IF ds IS NULL OR ds !~ '^[a-z0-9_]{1,64}$' THEN RAISE EXCEPTION 'Invalid dataset'; END IF;
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
        IF t.kind = 'interneuron' AND t.status <> 'skipped' THEN already := already + 1; CONTINUE; END IF;
        UPDATE public.proofreading_tasks SET kind = 'interneuron',
          status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END,
          claim_point_x = coalesce(claim_point_x, px), claim_point_y = coalesce(claim_point_y, py), claim_point_z = coalesce(claim_point_z, pz),
          nucleus_coords = coalesce(nucleus_coords, CASE WHEN px IS NOT NULL THEN concat_ws(', ', px, py, pz) END),
          supervoxel_id = coalesce(supervoxel_id, svx),
          notes = coalesce(nullif(left(c->>'note', 200), ''), notes),
          updated_at = now() WHERE id = t.id;
        UPDATE public.task_assignments SET expires_at = 'infinity' WHERE task_id = t.id AND status = 'active';
        changed := changed + 1;
      ELSE
        INSERT INTO public.proofreading_tasks (dataset, segment_id, kind, claim_point_x, claim_point_y, claim_point_z, nucleus_coords, supervoxel_id, notes)
        VALUES (ds, seg, 'interneuron', px, py, pz, CASE WHEN px IS NOT NULL THEN concat_ws(', ', px, py, pz) END, svx, nullif(left(c->>'note', 200), ''));
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
          'id', k.id, 'segment_id', k.segment_id, 'status', k.status, 'notes', k.notes,
          'final_segment_id', k.final_segment_id, 'nucleus_coords', k.nucleus_coords,
          'holder', nullif(coalesce(nullif(u.username, ''), u.display_name), ''),
          'active_seconds', coalesce((SELECT sum(c2.active_seconds) FROM public.claim_active_time c2 WHERE c2.task_id = k.id), 0),
          'players', (SELECT count(*) FROM public.claim_active_time c2 WHERE c2.task_id = k.id))
          ORDER BY k.status <> 'skipped' DESC, k.id)
        FROM public.proofreading_tasks k LEFT JOIN public.users u ON u.id = k.assigned_to
        WHERE k.dataset = ds AND k.kind = 'interneuron'), '[]'::jsonb),
      'times', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'task_id', c.task_id, 'segment_id', k.segment_id, 'kind', k.kind, 'status', k.status,
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

REVOKE ALL ON FUNCTION public.pilot_task_action(uuid,text,jsonb), public.pilot_claim_time(uuid,text,jsonb), public.pilot_quest_admin(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_task_action(uuid,text,jsonb), public.pilot_claim_time(uuid,text,jsonb), public.pilot_quest_admin(uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
