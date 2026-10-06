-- ============================================================================
-- A claim's anchor: the supervoxel at the cell's soma (Ames 2026-10-05).
--
-- A cell gets a new segment ID with every merge or split, and large cells
-- take many sessions. The one thing that stays part of the cell through all
-- of it is a spot in its soma. Claims made from the Delta menu already store
-- that spot's supervoxel; claims made from the Cell Library did not, so the
-- game could not always tell which piece of a split cell was the cell.
--
-- The game now reads the supervoxel at the claim point (the nucleus
-- coordinates from the cell list) and saves it here, once, for the owner of
-- an active claim. It is never moved after that.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pilot_task_set_anchor(p_user uuid, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.proofreading_tasks%ROWTYPE; sv text := p_args->>'supervoxel_id';
BEGIN
  IF NOT public.pilot_is_member(p_user) THEN RAISE EXCEPTION 'Invited testers only' USING ERRCODE='42501'; END IF;
  IF coalesce(p_args->>'id','') !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'Invalid claim'; END IF;
  IF sv IS NULL OR sv !~ '^[0-9]{10,20}$' THEN RAISE EXCEPTION 'Invalid anchor'; END IF;
  SELECT * INTO t FROM public.proofreading_tasks WHERE id = (p_args->>'id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such claim'; END IF;
  IF t.assigned_to IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Only the current owner can change this claim' USING ERRCODE='42501'; END IF;
  IF t.status NOT IN ('assigned','in_progress') THEN RAISE EXCEPTION 'This claim is no longer active'; END IF;
  -- Set once. An anchor already there stays.
  IF t.supervoxel_id IS NULL THEN
    UPDATE public.proofreading_tasks SET supervoxel_id = sv, updated_at = now() WHERE id = t.id RETURNING * INTO t;
  END IF;
  RETURN to_jsonb(t);
END;
$$;

REVOKE ALL ON FUNCTION public.pilot_task_set_anchor(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_task_set_anchor(uuid, jsonb) TO service_role;
