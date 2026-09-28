-- EyeWire II: raise the claim limit from 3 to 8 (Amy 2026-09-28).
-- Only pilot_task_action changes: the limit check and its message. Everything
-- else in the function is identical to supabase-pilot-access.sql. Grants are
-- kept by CREATE OR REPLACE. Safe to run once in the Supabase SQL editor.
CREATE OR REPLACE FUNCTION public.pilot_task_action(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.proofreading_tasks%ROWTYPE; a public.task_assignments%ROWTYPE;
  ds text := p_args->>'dataset'; seg text := p_args->>'segment_id';
  px double precision := (p_args->'point'->>0)::double precision;
  py double precision := (p_args->'point'->>1)::double precision;
  pz double precision := (p_args->'point'->>2)::double precision;
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
  IF p_action IN ('claim','claim_cell') THEN
    IF t.status IN ('completed','skipped') THEN RAISE EXCEPTION 'This cell is already completed'; END IF;
    IF t.assigned_to IS NOT NULL AND t.assigned_to <> p_user THEN RAISE EXCEPTION 'This cell is already claimed'; END IF;
    IF EXISTS (SELECT 1 FROM public.proofreading_tasks o WHERE o.id<>t.id AND o.dataset=t.dataset
      AND o.status IN ('assigned','in_progress') AND (o.segment_id=t.segment_id OR
      (o.claim_point_x=t.claim_point_x AND o.claim_point_y=t.claim_point_y AND o.claim_point_z=t.claim_point_z)))
      THEN RAISE EXCEPTION 'This cell is already claimed'; END IF;
    IF t.assigned_to IS DISTINCT FROM p_user AND
       (SELECT count(*) FROM public.proofreading_tasks WHERE assigned_to=p_user AND status IN ('assigned','in_progress')) >= 8
      THEN RAISE EXCEPTION 'Max 8 claims reached'; END IF;
    UPDATE public.proofreading_tasks SET status='assigned',assigned_to=p_user,updated_at=now() WHERE id=t.id RETURNING * INTO t;
    SELECT * INTO a FROM public.task_assignments WHERE task_id=t.id AND user_id=p_user AND status='active' ORDER BY id DESC LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.task_assignments(task_id,user_id,expires_at) VALUES(t.id,p_user,now()+interval '30 minutes');
    ELSE
      UPDATE public.task_assignments SET expires_at=now()+interval '30 minutes' WHERE id=a.id;
    END IF;
  ELSIF p_action IN ('release','complete','heartbeat') THEN
    IF t.assigned_to IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Only the current owner can change this claim' USING ERRCODE='42501'; END IF;
    IF p_action='complete' AND t.status='completed' THEN RETURN to_jsonb(t); END IF;
    IF t.status NOT IN ('assigned','in_progress') THEN RAISE EXCEPTION 'This claim is no longer active'; END IF;
    IF p_action='heartbeat' THEN
      UPDATE public.task_assignments SET expires_at=now()+interval '30 minutes' WHERE task_id=t.id AND user_id=p_user AND status='active';
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
  ELSE RAISE EXCEPTION 'Unknown claim action'; END IF;
  RETURN to_jsonb(t);
END;
$$;
