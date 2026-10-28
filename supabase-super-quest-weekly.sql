-- ============================================================================
-- Active time by day, for My Week in Science (Ames 2026-10-28: "can we add
-- time in super quest to my week in science?").
--
-- claim_active_time keeps one total per claim; claim_active_days keeps the
-- seconds per claim per day (US Eastern days, as the recaps count weeks).
-- pilot_claim_time adds to both, and 'mine' answers each claim with its kind,
-- category and seconds by day, so the recap can sum any week, month or year.
-- The time counted before this ran goes to the day it was last counted.
--
-- Run after supabase-interneuron-quests.sql. Safe to re-run.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.claim_active_days (
  task_id integer NOT NULL REFERENCES public.proofreading_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  seconds integer NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, user_id, day)
);
ALTER TABLE public.claim_active_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.claim_active_days FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.claim_active_days TO service_role;

-- What was counted before, on the day it was last counted. Only for claims
-- with no days yet, so a re-run adds nothing twice.
INSERT INTO public.claim_active_days (task_id, user_id, day, seconds)
SELECT c.task_id, c.user_id, (c.last_at AT TIME ZONE 'America/New_York')::date, c.active_seconds
FROM public.claim_active_time c
WHERE c.active_seconds > 0
  AND NOT EXISTS (SELECT 1 FROM public.claim_active_days d WHERE d.task_id = c.task_id AND d.user_id = c.user_id)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.pilot_claim_time(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.proofreading_tasks%ROWTYPE; r public.claim_active_time%ROWTYPE;
  secs integer; ed integer; sv integer; gap integer; hrs integer[] := ARRAY[10, 25, 50, 100];
  passed integer[] := '{}'; h integer;
BEGIN
  IF NOT public.pilot_is_member(p_user) THEN RAISE EXCEPTION 'Invited testers only' USING ERRCODE='42501'; END IF;
  IF p_action = 'mine' THEN
    -- With each claim, its kind and category and its seconds by day (ET), for
    -- the row and for My Week, Month and Year in Science.
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'kind', k.kind, 'category', k.quest_category,
        'by_day', coalesce((SELECT jsonb_object_agg(d.day::text, d.seconds) FROM public.claim_active_days d
          WHERE d.task_id = c.task_id AND d.user_id = c.user_id AND d.day > current_date - 400), '{}'::jsonb)))
      FROM public.claim_active_time c
      JOIN public.proofreading_tasks k ON k.id = c.task_id
      WHERE c.user_id = p_user AND (k.assigned_to = p_user OR c.last_at > now() - interval '400 days')), '[]'::jsonb);
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
  IF secs > 0 THEN
    INSERT INTO public.claim_active_days (task_id, user_id, day, seconds)
      VALUES (t.id, p_user, (now() AT TIME ZONE 'America/New_York')::date, secs)
      ON CONFLICT (task_id, user_id, day) DO UPDATE SET seconds = public.claim_active_days.seconds + EXCLUDED.seconds;
  END IF;
  RETURN to_jsonb(r) || jsonb_build_object('passed', to_jsonb(passed), 'kind', t.kind);
END;
$$;

REVOKE ALL ON FUNCTION public.pilot_claim_time(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_claim_time(uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
