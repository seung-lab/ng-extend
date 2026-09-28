-- Stage 1: install before the gateway/client rollout. No existing data is removed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pilot_members (
  email text PRIMARY KEY CHECK (email = lower(trim(email)) AND email LIKE '%@%'),
  enabled boolean NOT NULL DEFAULT true,
  added_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pilot_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pilot_members TO service_role;

CREATE OR REPLACE FUNCTION public.pilot_is_member(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.users u WHERE u.id = p_user AND (
     EXISTS (SELECT 1 FROM public.admins a WHERE lower(a.email) = lower(u.middleauth_email)) OR
     EXISTS (SELECT 1 FROM public.pilot_members m WHERE m.email = lower(u.middleauth_email) AND m.enabled)
   )
 );
$$;

-- One transaction owns the task and assignment together. All claim paths share
-- this lock, including claims by point and duplicate imported rows of one cell.
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
       (SELECT count(*) FROM public.proofreading_tasks WHERE assigned_to=p_user AND status IN ('assigned','in_progress')) >= 3
      THEN RAISE EXCEPTION 'Max 3 claims reached'; END IF;
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

-- Expiry must share the claim lock and must not release a newer owner's task.
CREATE OR REPLACE FUNCTION public.expire_stale_assignments() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(98127,61750);
  UPDATE public.task_assignments SET status='expired',released_at=now() WHERE status='active' AND expires_at<now();
  UPDATE public.proofreading_tasks t SET status='pending',assigned_to=NULL,updated_at=now()
    WHERE t.status IN ('assigned','in_progress')
    AND EXISTS(SELECT 1 FROM public.task_assignments a WHERE a.task_id=t.id AND a.user_id=t.assigned_to AND a.status='expired')
    AND NOT EXISTS(SELECT 1 FROM public.task_assignments a WHERE a.task_id=t.id AND a.user_id=t.assigned_to AND a.status='active');
END;
$$;

ALTER TABLE public.tutorial_practice_examples ADD COLUMN IF NOT EXISTS reset_nonce uuid, ADD COLUMN IF NOT EXISTS claim_nonce uuid;
CREATE OR REPLACE FUNCTION public.pilot_practice_action(p_user uuid,p_action text,p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ex public.tutorial_practice_examples%ROWTYPE; is_admin boolean;
BEGIN
  IF NOT public.pilot_is_member(p_user) THEN RAISE EXCEPTION 'Invited testers only' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.admins a JOIN public.users u ON lower(a.email)=lower(u.middleauth_email) WHERE u.id=p_user) INTO is_admin;
  PERFORM pg_catalog.pg_advisory_xact_lock(98127,61749);
  IF p_action='claim' THEN
    -- Expired edits must be reset, including when the same learner returns.
    UPDATE public.tutorial_practice_examples SET status='needs_reset',claimed_by=NULL,claimed_at=NULL,expires_at=NULL,updated_at=now()
      WHERE status='in_use' AND expires_at<=now();
    -- p_args.exclude: cells this learner already holds. A tutorial hands the
    -- same learner two cells of a kind (one per practice step), so the second
    -- claim must not return the first.
    SELECT * INTO ex FROM public.tutorial_practice_examples e WHERE e.enabled AND e.kind=p_args->>'kind'
      AND NOT (e.id::text IN (SELECT jsonb_array_elements_text(coalesce(p_args->'exclude','[]'::jsonb))))
      AND (e.status='ready' OR (e.status='in_use' AND e.claimed_by=p_user AND e.expires_at>now()))
      AND NOT EXISTS(SELECT 1 FROM public.tutorial_practice_examples o WHERE o.id<>e.id AND o.enabled
        AND o.pcg_server=e.pcg_server AND o.pcg_table=e.pcg_table
        AND (o.status='resetting' OR (o.status='in_use' AND (o.expires_at IS NULL OR o.expires_at>now())))
        AND ARRAY[nullif(o.supervoxel_a,''),nullif(o.supervoxel_b,'')] && ARRAY[nullif(e.supervoxel_a,''),nullif(e.supervoxel_b,'')])
      ORDER BY (e.claimed_by=p_user) DESC NULLS LAST,e.uses,e.created_at LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.tutorial_practice_examples SET status='in_use',claim_nonce=CASE WHEN status='in_use' AND claimed_by=p_user THEN coalesce(claim_nonce,gen_random_uuid()) ELSE gen_random_uuid() END,claimed_by=p_user,
      claimed_at=CASE WHEN claimed_by=p_user THEN claimed_at ELSE now() END,expires_at=now()+interval '5 minutes',reset_nonce=NULL,updated_at=now()
      WHERE id=ex.id RETURNING * INTO ex;
  ELSE
    SELECT * INTO ex FROM public.tutorial_practice_examples WHERE id=(p_args->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Practice cell not found'; END IF;
    IF p_action='heartbeat' THEN
      IF ex.status<>'in_use' OR ex.claimed_by IS DISTINCT FROM p_user OR ex.claim_nonce IS DISTINCT FROM (p_args->>'session')::uuid OR ex.claim_nonce IS NULL OR ex.expires_at<=now() THEN RAISE EXCEPTION 'Practice session has ended'; END IF;
      UPDATE public.tutorial_practice_examples SET expires_at=now()+interval '5 minutes',updated_at=now() WHERE id=ex.id RETURNING * INTO ex;
    ELSIF p_action='begin_reset' THEN
      IF ex.status='resetting' THEN RAISE EXCEPTION 'A reset is already running'; END IF;
      IF ex.status='in_use' AND (ex.claimed_by IS DISTINCT FROM p_user OR ex.claim_nonce IS NULL OR ex.claim_nonce IS DISTINCT FROM (p_args->>'session')::uuid OR ex.expires_at<=now()) THEN
        RAISE EXCEPTION 'This practice session is no longer yours'; END IF;
      IF NOT is_admin AND (ex.status<>'in_use' OR ex.claimed_by IS DISTINCT FROM p_user) THEN RAISE EXCEPTION 'Only the current learner can reset this cell'; END IF;
      UPDATE public.tutorial_practice_examples SET status='resetting',claimed_by=p_user,reset_nonce=gen_random_uuid(),
        expires_at=now()+interval '3 minutes',updated_at=now() WHERE id=ex.id RETURNING * INTO ex;
    ELSIF p_action IN ('check_reset','finish_reset') THEN
      IF ex.status<>'resetting' OR ex.claimed_by IS DISTINCT FROM p_user OR ex.reset_nonce IS NULL
        OR ex.reset_nonce IS DISTINCT FROM (p_args->>'nonce')::uuid OR ex.expires_at<=now() THEN
        RAISE EXCEPTION 'Reset lease has ended; no edits were authorized'; END IF;
      IF p_action='check_reset' THEN
        UPDATE public.tutorial_practice_examples SET expires_at=now()+interval '3 minutes',updated_at=now() WHERE id=ex.id RETURNING * INTO ex;
      ELSE
        UPDATE public.tutorial_practice_examples SET status=CASE WHEN (p_args->>'clean')::boolean THEN 'ready' ELSE 'needs_reset' END,
          root_a=CASE WHEN (p_args->>'clean')::boolean AND kind<>'cut' THEN coalesce(p_args->>'root_a',root_a) ELSE root_a END,
          root_b=CASE WHEN (p_args->>'clean')::boolean AND kind<>'cut' THEN coalesce(p_args->>'root_b',root_b) ELSE root_b END,
          claimed_by=NULL,claimed_at=NULL,expires_at=NULL,reset_nonce=NULL,uses=uses+1,
          last_error=left(p_args->>'error',500),last_reset_at=CASE WHEN (p_args->>'clean')::boolean THEN now() ELSE last_reset_at END,
          reset_failures=CASE WHEN (p_args->>'clean')::boolean THEN 0 ELSE reset_failures END,updated_at=now()
          WHERE id=ex.id RETURNING * INTO ex;
      END IF;
    ELSE RAISE EXCEPTION 'Unknown practice action'; END IF;
  END IF;
  RETURN to_jsonb(ex);
END;
$$;

-- Scheduled worker uses the same lock order as learner claims. Snapshot matching
-- prevents a queued reset from acting on a newer session.
CREATE OR REPLACE FUNCTION public.pilot_worker_reset_lease(p_id uuid,p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ex public.tutorial_practice_examples%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(98127,61749);
  SELECT * INTO ex FROM public.tutorial_practice_examples WHERE id=p_id AND updated_at=p_expected AND enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF ex.status='in_use' AND (ex.expires_at IS NULL OR ex.expires_at>now()) THEN RETURN NULL; END IF;
  IF ex.status='resetting' AND ex.updated_at>now()-interval '15 minutes' THEN RETURN NULL; END IF;
  UPDATE public.tutorial_practice_examples SET status='resetting',claimed_by=NULL,claimed_at=NULL,expires_at=NULL,
    reset_nonce=gen_random_uuid(),updated_at=now() WHERE id=p_id RETURNING * INTO ex;
  RETURN to_jsonb(ex);
END;
$$;

REVOKE ALL ON FUNCTION public.pilot_is_member(uuid),public.pilot_task_action(uuid,text,jsonb),public.pilot_practice_action(uuid,text,jsonb),public.pilot_worker_reset_lease(uuid,timestamptz),public.expire_stale_assignments() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_is_member(uuid),public.pilot_task_action(uuid,text,jsonb),public.pilot_practice_action(uuid,text,jsonb),public.pilot_worker_reset_lease(uuid,timestamptz),public.expire_stale_assignments() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
