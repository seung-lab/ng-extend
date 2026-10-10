-- EyeWire II: reopen a completed Cell Library cell (Ames 2026-10-10:
-- "uncomplete reopens the cell"). Unmarking a cell in the Delta menu took the
-- mark off in CAVE but left the claim completed, so the Cell Library still
-- showed it done (Krzysztof 2026-10-09). The player who completed a cell can
-- now take it back as an open claim. Safe to run more than once.
--
-- Same shape as pilot_task_set_anchor (supabase-claim-anchor.sql): a small
-- function of its own, called only by the server.
CREATE OR REPLACE FUNCTION public.pilot_task_reopen(p_user uuid, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.proofreading_tasks%ROWTYPE; lim integer;
BEGIN
  IF NOT public.pilot_is_member(p_user) THEN RAISE EXCEPTION 'Invited testers only' USING ERRCODE='42501'; END IF;
  IF coalesce(p_args->>'id','') !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'Invalid claim'; END IF;
  -- The lock every claim path takes (pilot_task_action).
  PERFORM pg_catalog.pg_advisory_xact_lock(98127, 61750);
  SELECT * INTO t FROM public.proofreading_tasks WHERE id = (p_args->>'id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cell not found'; END IF;
  IF t.assigned_to IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Only the player who completed this cell can reopen it' USING ERRCODE='42501'; END IF;
  -- Already open (pressed twice): nothing to do.
  IF t.status IN ('assigned','in_progress') THEN RETURN to_jsonb(t); END IF;
  IF t.status <> 'completed' THEN RAISE EXCEPTION 'This cell is not completed'; END IF;
  -- The claim limit, as in pilot_task_action: 10 on Retina, 8 elsewhere.
  lim := CASE WHEN t.dataset = 'stroeh_mouse_retina' THEN 10 ELSE 8 END;
  IF (SELECT count(*) FROM public.proofreading_tasks WHERE assigned_to = p_user AND dataset = t.dataset
        AND status IN ('assigned','in_progress')) >= lim
    THEN RAISE EXCEPTION 'Max % claims reached', lim; END IF;
  UPDATE public.proofreading_tasks SET status = 'in_progress', updated_at = now() WHERE id = t.id RETURNING * INTO t;
  INSERT INTO public.task_assignments(task_id, user_id, expires_at) VALUES (t.id, p_user, now() + interval '30 minutes');
  RETURN to_jsonb(t);
END;
$$;

REVOKE ALL ON FUNCTION public.pilot_task_reopen(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_task_reopen(uuid, jsonb) TO service_role;
