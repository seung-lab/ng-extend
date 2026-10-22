-- Pyr proofreading test (Ames, 2026-10-10): one Sandbox cell with several
-- mistakes on it. A player proofreads it, the server scores the result, and
-- a pass grants production access. Run in the Supabase SQL editor. Safe to
-- re-run (idempotent). Nothing here is readable with the public key except
-- the small view at the end: the checks are the answers.
--
-- Tables
--   proofreading_tests          one row per test cell: where it is, its start
--                               view, the baseline, the rules, and the claim
--   proofreading_test_checks    the answers: one row per thing to check,
--                               two supervoxels and what should become of them
--   proofreading_test_attempts  one row per try, written by the server only
--   proofreading_test_queue     the line of players waiting for the cell
-- Function
--   pilot_test_action(p_user, p_action, p_args)  status, claim, heartbeat,
--                               cleaned, record, queue_join, queue_leave,
--                               queue_remove. Service role only; called by
--                               ewProofreadingTest (functions/proofreading-test.js).
--                               No pilot membership needed: the test is how a
--                               player earns it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.proofreading_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  -- Where the cell lives (only the Pinky sandbox is approved).
  dataset text NOT NULL,                      -- segmentation layer name, pinky_nf_v2
  pcg_server text NOT NULL,                   -- https://minnie.microns-daf.com
  pcg_table text NOT NULL,                    -- pinky_nf_v2
  state_url text NOT NULL,                    -- the start view (a middleauth+ state link)
  anchor_supervoxel text NOT NULL CHECK (anchor_supervoxel ~ '^[0-9]{1,20}$'), -- on the soma
  root_at_baseline text NOT NULL DEFAULT '',  -- the cell's root at the baseline, for the record
  -- Every graph operation on the cell after this instant is undone at reset.
  baseline_at timestamptz NOT NULL DEFAULT now(),
  -- The rules.
  hold_minutes integer NOT NULL DEFAULT 60 CHECK (hold_minutes BETWEEN 5 AND 600), -- quiet minutes before the cell is released
  -- The time limit on the whole test, from the moment the cell is claimed
  -- (Ames, 2026-10-13). NULL = none. Renewing the hold never reaches past it.
  time_limit_minutes integer DEFAULT 60 CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 600),
  pass_mark integer NOT NULL DEFAULT 100 CHECK (pass_mark BETWEEN 1 AND 100),      -- percent of points needed
  damage_fails boolean NOT NULL DEFAULT true,  -- a broken keep/apart check fails the test outright
  attempts_allowed integer CHECK (attempts_allowed IS NULL OR attempts_allowed >= 1), -- NULL = no limit
  retry_hours integer NOT NULL DEFAULT 0 CHECK (retry_hours BETWEEN 0 AND 8760),    -- wait after a fail
  feedback text NOT NULL DEFAULT 'summary' CHECK (feedback IN ('none', 'summary', 'detail')),
  -- What a pass grants: the app's pilot list, and these CAVE groups
  -- (203 = Eyewire_2_Edit on stroeh-mouse-retina).
  grant_pilot boolean NOT NULL DEFAULT true,
  cave_groups integer[] NOT NULL DEFAULT ARRAY[203],
  -- The claim, as for practice cells.
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'in_use', 'needs_reset', 'resetting', 'broken')),
  enabled boolean NOT NULL DEFAULT false,
  claimed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  expires_at timestamptz,
  deadline_at timestamptz,                     -- when this claim's time limit runs out
  claim_nonce uuid,
  reset_nonce uuid,
  uses integer NOT NULL DEFAULT 0,
  reset_failures integer NOT NULL DEFAULT 0,
  last_reset_at timestamptz,
  last_error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Columns added after the first install (re-running this file adds them).
ALTER TABLE public.proofreading_tests
  ADD COLUMN IF NOT EXISTS time_limit_minutes integer DEFAULT 60 CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

CREATE TABLE IF NOT EXISTS public.proofreading_test_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.proofreading_tests(id) ON DELETE CASCADE,
  ordinal integer NOT NULL DEFAULT 0,
  -- cut: a false merge, a and b start fused and must end apart.
  -- merge: a missing piece, a and b start apart and must end together.
  -- keep: a real part of the cell, must stay with it (damage check).
  -- apart: a neighbour, must stay off the cell (damage check).
  -- endpoint: a branch end the player must mark with a point annotation
  --   within radius_nm of point_a (no supervoxels).
  kind text NOT NULL CHECK (kind IN ('cut', 'merge', 'keep', 'apart', 'endpoint')),
  label text NOT NULL DEFAULT '',
  supervoxel_a text NOT NULL DEFAULT '' CHECK (supervoxel_a = '' OR supervoxel_a ~ '^[0-9]{1,20}$'),
  supervoxel_b text NOT NULL DEFAULT '' CHECK (supervoxel_b = '' OR supervoxel_b ~ '^[0-9]{1,20}$'),
  point_a jsonb,       -- viewer voxel [x, y, z], where a sits (or the endpoint)
  point_b jsonb,
  radius_nm integer,   -- endpoint only
  weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 1000000),  -- a piece weighs its size in supervoxels
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'endpoint' OR (supervoxel_a <> '' AND supervoxel_b <> '' AND supervoxel_a <> supervoxel_b)),
  CHECK (kind <> 'endpoint' OR point_a IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS proofreading_test_checks_test_idx ON public.proofreading_test_checks (test_id, ordinal);
-- Weights are piece sizes in supervoxels since 2026-10-19; the first cap was 100.
ALTER TABLE public.proofreading_test_checks DROP CONSTRAINT IF EXISTS proofreading_test_checks_weight_check;
ALTER TABLE public.proofreading_test_checks ADD CONSTRAINT proofreading_test_checks_weight_check CHECK (weight BETWEEN 0 AND 1000000);
-- The admins' heat map (2026-10-21): a cut or merge check's piece as a
-- segment of its own (scripts/proofreading-test-piece-roots.py fills it).
ALTER TABLE public.proofreading_test_checks ADD COLUMN IF NOT EXISTS piece_root text CHECK (piece_root IS NULL OR piece_root ~ '^[0-9]{1,20}$');

CREATE TABLE IF NOT EXISTS public.proofreading_test_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_id uuid NOT NULL REFERENCES public.proofreading_tests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  claim_nonce uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('pass', 'fail', 'abandoned', 'expired', 'error')),
  found integer,       -- error checks fixed (cut, merge)
  errors integer,      -- error checks in the test
  damaged integer,     -- keep/apart checks broken
  percent integer,     -- points earned of points available
  checks jsonb,        -- every check's result (private)
  endpoints jsonb,     -- the player's point annotations and which endpoints they hit
  granted jsonb,       -- what the pass granted: pilot, CAVE groups, errors
  error text,
  timed_out boolean NOT NULL DEFAULT false  -- scored because the time limit ran out
);
ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS timed_out boolean NOT NULL DEFAULT false;
-- What the admins see of a try (2026-10-21, supabase-proofreading-test-tries.sql):
-- the player's cell as they left it, and the ends they marked of how many.
ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS end_root text CHECK (end_root IS NULL OR end_root ~ '^[0-9]{1,20}$');
ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS ends_found integer;
ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS ends_total integer;
CREATE INDEX IF NOT EXISTS proofreading_test_attempts_user_idx ON public.proofreading_test_attempts (user_id, test_id, started_at DESC);

-- The line (Ames, 2026-10-21): one player at a time, so the others wait
-- their turn. When the cell is free, the first in line is called: a
-- notification, and the cell held for them for 10 minutes. A turn not taken
-- in time drops them from the line and the next is called. While anyone is
-- waiting, the player on the cell keeps it through 15 quiet minutes, not the
-- test's usual hold.
CREATE TABLE IF NOT EXISTS public.proofreading_test_queue (
  test_id uuid NOT NULL REFERENCES public.proofreading_tests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,                        -- their turn: the cell is held for them
  PRIMARY KEY (test_id, user_id)
);
ALTER TABLE public.proofreading_test_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proofreading_test_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.proofreading_test_queue TO service_role;

ALTER TABLE public.proofreading_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proofreading_test_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proofreading_test_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proofreading_tests, public.proofreading_test_checks, public.proofreading_test_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.proofreading_tests, public.proofreading_test_checks, public.proofreading_test_attempts TO service_role;

-- What the burger menu may know with the public key: that a test exists and
-- whether it is free. No answers, no rules beyond the hold.
CREATE OR REPLACE VIEW public.proofreading_tests_public AS
  SELECT id, title, status, claimed_by, expires_at, hold_minutes
  FROM public.proofreading_tests WHERE enabled;
GRANT SELECT ON public.proofreading_tests_public TO anon, authenticated, service_role;

-- The test row as the player's browser may see it: no answers.
CREATE OR REPLACE FUNCTION public.proofreading_test_public(t public.proofreading_tests) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id', t.id, 'title', t.title, 'dataset', t.dataset, 'state_url', t.state_url,
    'status', t.status, 'claimed_by', t.claimed_by, 'expires_at', t.expires_at, 'hold_minutes', t.hold_minutes,
    'pass_mark', t.pass_mark, 'damage_fails', t.damage_fails, 'attempts_allowed', t.attempts_allowed,
    'retry_hours', t.retry_hours, 'feedback', t.feedback, 'cave_groups', to_jsonb(t.cave_groups),
    'grants', (t.grant_pilot OR cardinality(t.cave_groups) > 0), 'time_limit_minutes', t.time_limit_minutes);
$$;

-- The line moves: a turn not taken in 10 minutes drops out, and a free cell
-- calls the first in line, with a notification. Run under the test's lock by
-- pilot_test_action on every call, so the line moves whenever anyone looks.
CREATE OR REPLACE FUNCTION public.proofreading_test_call_next() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q public.proofreading_test_queue%ROWTYPE;
  turn constant interval := interval '10 minutes';
BEGIN
  DELETE FROM public.proofreading_test_queue WHERE called_at IS NOT NULL AND called_at + turn <= now();
  FOR q IN
    SELECT DISTINCT ON (l.test_id) l.* FROM public.proofreading_test_queue l
      JOIN public.proofreading_tests x ON x.id = l.test_id
      WHERE x.enabled AND x.status IN ('ready', 'needs_reset')
        AND NOT EXISTS (SELECT 1 FROM public.proofreading_test_queue c WHERE c.test_id = l.test_id AND c.called_at IS NOT NULL)
      ORDER BY l.test_id, l.joined_at
  LOOP
    UPDATE public.proofreading_test_queue SET called_at = now() WHERE test_id = q.test_id AND user_id = q.user_id;
    INSERT INTO public.notifications (title, body, target_type, target_id, send_at, expires_at)
      VALUES ('Your turn: the Proofreading Test',
        'The test cell is held for you for 10 minutes. Open the menu and start the Proofreading Test, or press Start the test on the card at the top left.',
        'user', q.user_id::text, now(), now() + turn);
  END LOOP;
END;
$$;

-- Why this player may not take the test now (NULL: they may). The same
-- rules for taking the cell and for joining the line.
CREATE OR REPLACE FUNCTION public.proofreading_test_refusal(t public.proofreading_tests, p_user uuid, p_admin boolean) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n_done integer;
  last_fail timestamptz;
BEGIN
  IF p_admin THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome = 'pass') THEN
    RETURN 'You have already passed this test';
  END IF;
  SELECT count(*) INTO n_done FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome IN ('pass', 'fail');
  IF t.attempts_allowed IS NOT NULL AND n_done >= t.attempts_allowed THEN RETURN 'No tries left on this test'; END IF;
  SELECT max(submitted_at) INTO last_fail FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome = 'fail';
  IF last_fail IS NOT NULL AND t.retry_hours > 0 AND last_fail + make_interval(hours => t.retry_hours) > now() THEN
    RETURN 'Try again after ' || to_char(last_fail + make_interval(hours => t.retry_hours), 'YYYY-MM-DD HH24:MI "UTC"');
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.pilot_test_action(p_user uuid, p_action text, p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.proofreading_tests%ROWTYPE;
  att public.proofreading_test_attempts%ROWTYPE;
  is_admin boolean;
  n_done integer;
  last_fail timestamptz;
  wait_until timestamptz;
  has_passed boolean;
  was text;
  want uuid := (p_args->>'id')::uuid;
  nonce uuid := (p_args->>'session')::uuid;
  clean boolean := coalesce((p_args->>'clean')::boolean, false);
  -- After the time limit a submit still gets through for this long: the
  -- player's page submits by itself the moment the clock reaches zero.
  grace constant interval := interval '2 minutes';
  -- The line: how long a called player has to start, and the quiet minutes
  -- the player on the cell gets while anyone is waiting.
  turn constant interval := interval '10 minutes';
  quiet_waiting constant integer := 15;
  q public.proofreading_test_queue%ROWTYPE;
  pos integer;
  n_line integer;
  other_turn boolean;
  quiet integer;
  why text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Create your Pyr profile first' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.admins a JOIN public.users u ON lower(a.email) = lower(u.middleauth_email) WHERE u.id = p_user) INTO is_admin;
  PERFORM pg_catalog.pg_advisory_xact_lock(98127, 61751);

  -- A hold that ran out: the attempt is closed and the cell waits for a reset.
  UPDATE public.proofreading_test_attempts a SET outcome = 'expired', submitted_at = now()
    FROM public.proofreading_tests x
    WHERE a.test_id = x.id AND a.claim_nonce = x.claim_nonce AND a.outcome IS NULL
      AND x.status = 'in_use' AND x.expires_at <= now();
  UPDATE public.proofreading_tests SET status = 'needs_reset', claimed_by = NULL, claimed_at = NULL,
      expires_at = NULL, deadline_at = NULL, claim_nonce = NULL, updated_at = now()
    WHERE status = 'in_use' AND expires_at <= now();
  -- The line moves on whatever just freed up.
  PERFORM public.proofreading_test_call_next();

  IF p_action = 'status' THEN
    SELECT * INTO t FROM public.proofreading_tests WHERE enabled AND (want IS NULL OR id = want)
      ORDER BY (claimed_by = p_user) DESC NULLS LAST, created_at LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('test', NULL); END IF;
    SELECT count(*) INTO n_done FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome IN ('pass', 'fail');
    SELECT EXISTS (SELECT 1 FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome = 'pass') INTO has_passed;
    SELECT max(submitted_at) INTO last_fail FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome = 'fail';
    wait_until := CASE WHEN last_fail IS NULL OR t.retry_hours = 0 THEN NULL ELSE last_fail + make_interval(hours => t.retry_hours) END;
    SELECT * INTO att FROM public.proofreading_test_attempts WHERE test_id = t.id AND user_id = p_user AND outcome IN ('pass', 'fail')
      ORDER BY submitted_at DESC LIMIT 1;
    SELECT count(*) INTO n_line FROM public.proofreading_test_queue WHERE test_id = t.id;
    SELECT * INTO q FROM public.proofreading_test_queue WHERE test_id = t.id AND user_id = p_user;
    pos := CASE WHEN q.user_id IS NULL THEN NULL
      ELSE (SELECT count(*) + 1 FROM public.proofreading_test_queue l WHERE l.test_id = t.id AND l.joined_at < q.joined_at) END;
    other_turn := EXISTS (SELECT 1 FROM public.proofreading_test_queue WHERE test_id = t.id AND called_at IS NOT NULL AND user_id <> p_user);
    RETURN jsonb_build_object(
      'test', public.proofreading_test_public(t),
      'free', (t.status IN ('ready', 'needs_reset') AND NOT other_turn) OR (t.status = 'in_use' AND t.claimed_by = p_user),
      'queue', jsonb_build_object('length', n_line, 'position', pos,
        'called_until', CASE WHEN q.called_at IS NOT NULL THEN q.called_at + turn ELSE NULL END,
        'other_turn', other_turn,
        'holder_until', CASE WHEN t.status = 'in_use' AND t.claimed_by IS DISTINCT FROM p_user THEN coalesce(t.deadline_at, t.expires_at) ELSE NULL END,
        'turn_minutes', 10,
        'quiet_minutes', CASE WHEN n_line > 0 THEN least(t.hold_minutes, quiet_waiting) ELSE t.hold_minutes END),
      'mine', t.status = 'in_use' AND t.claimed_by = p_user,
      'attempts', n_done,
      'passed', has_passed,
      'admin', is_admin,
      'last', CASE WHEN att.id IS NULL THEN NULL ELSE jsonb_build_object('outcome', att.outcome, 'found', att.found,
        'errors', att.errors, 'damaged', att.damaged, 'percent', att.percent, 'submitted_at', att.submitted_at) END,
      'wait_until', CASE WHEN wait_until > now() THEN wait_until ELSE NULL END,
      'deadline_at', CASE WHEN t.status = 'in_use' AND t.claimed_by = p_user THEN t.deadline_at ELSE NULL END,
      'can_start', is_admin OR (NOT has_passed AND (t.attempts_allowed IS NULL OR n_done < t.attempts_allowed)
        AND (wait_until IS NULL OR wait_until <= now()) AND t.status <> 'broken'));

  ELSIF p_action = 'claim' THEN
    SELECT * INTO t FROM public.proofreading_tests WHERE enabled AND (want IS NULL OR id = want)
      ORDER BY (claimed_by = p_user) DESC NULLS LAST, created_at LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'There is no test to take right now'; END IF;
    -- The same player again (a reload mid test): keep the session and its edits.
    IF t.status = 'in_use' AND t.claimed_by = p_user AND t.expires_at > now() THEN
      quiet := CASE WHEN EXISTS (SELECT 1 FROM public.proofreading_test_queue WHERE test_id = t.id) THEN least(t.hold_minutes, quiet_waiting) ELSE t.hold_minutes END;
      -- least() skips a NULL, so a test with no limit keeps renewing freely.
      UPDATE public.proofreading_tests SET expires_at = least(now() + make_interval(mins => quiet), deadline_at + grace), updated_at = now()
        WHERE id = t.id RETURNING * INTO t;
      SELECT * INTO att FROM public.proofreading_test_attempts WHERE test_id = t.id AND claim_nonce = t.claim_nonce AND outcome IS NULL
        ORDER BY id DESC LIMIT 1;
      RETURN jsonb_build_object('test', public.proofreading_test_public(t), 'session', t.claim_nonce,
        'attempt', att.id, 'resumed', true, 'was', 'in_use', 'deadline_at', t.deadline_at);
    END IF;
    IF t.status = 'in_use' THEN RAISE EXCEPTION 'Someone else is taking the test right now' USING ERRCODE = '55P03'; END IF;
    IF t.status = 'resetting' AND t.updated_at > now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'The test cell is being put back to its start; try again in a few minutes' USING ERRCODE = '55P03';
    END IF;
    IF t.status = 'broken' THEN RAISE EXCEPTION 'The test cell needs an admin to look at it; try again later'; END IF;
    -- The line: while it is someone else's turn, nobody else takes the cell.
    IF EXISTS (SELECT 1 FROM public.proofreading_test_queue WHERE test_id = t.id AND called_at IS NOT NULL AND user_id <> p_user) THEN
      RAISE EXCEPTION 'It is the turn of the next player in line. Join the line, and Pyr calls you when it is yours.' USING ERRCODE = '55P03';
    END IF;
    why := public.proofreading_test_refusal(t, p_user, is_admin);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%', why; END IF;
    -- Their turn, taken: out of the line.
    DELETE FROM public.proofreading_test_queue WHERE test_id = t.id AND user_id = p_user;
    quiet := CASE WHEN EXISTS (SELECT 1 FROM public.proofreading_test_queue WHERE test_id = t.id) THEN least(t.hold_minutes, quiet_waiting) ELSE t.hold_minutes END;
    was := t.status;
    -- No clock yet: it starts when the cell is handed over ('cleaned'), so
    -- time spent putting a long history back is not the player's.
    UPDATE public.proofreading_tests SET status = 'in_use', claimed_by = p_user, claimed_at = now(),
        deadline_at = NULL,
        expires_at = now() + make_interval(mins => quiet),
        claim_nonce = gen_random_uuid(), reset_nonce = NULL,
        uses = uses + 1, updated_at = now()
      WHERE id = t.id RETURNING * INTO t;
    INSERT INTO public.proofreading_test_attempts (test_id, user_id, claim_nonce) VALUES (t.id, p_user, t.claim_nonce) RETURNING * INTO att;
    RETURN jsonb_build_object('test', public.proofreading_test_public(t), 'session', t.claim_nonce,
      'attempt', att.id, 'resumed', false, 'was', was, 'deadline_at', t.deadline_at);

  ELSIF p_action = 'queue_join' THEN
    SELECT * INTO t FROM public.proofreading_tests WHERE enabled AND (want IS NULL OR id = want) ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'There is no test to take right now'; END IF;
    IF t.status = 'in_use' AND t.claimed_by = p_user THEN RAISE EXCEPTION 'The test cell is yours already'; END IF;
    why := public.proofreading_test_refusal(t, p_user, is_admin);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%', why; END IF;
    INSERT INTO public.proofreading_test_queue (test_id, user_id) VALUES (t.id, p_user) ON CONFLICT DO NOTHING;
    -- Someone is waiting now: the player on the cell has 15 minutes from
    -- here to make a move (any move renews it), not the usual hold.
    UPDATE public.proofreading_tests
      SET expires_at = least(expires_at, now() + make_interval(mins => least(hold_minutes, quiet_waiting)))
      WHERE id = t.id AND status = 'in_use' AND claimed_by IS DISTINCT FROM p_user;
    -- A free cell calls them at once.
    PERFORM public.proofreading_test_call_next();
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'queue_leave' THEN
    DELETE FROM public.proofreading_test_queue WHERE user_id = p_user AND (want IS NULL OR test_id = want);
    PERFORM public.proofreading_test_call_next();
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'queue_remove' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'Only admins can take someone out of the line' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.proofreading_test_queue WHERE user_id = (p_args->>'user')::uuid AND (want IS NULL OR test_id = want);
    PERFORM public.proofreading_test_call_next();
    RETURN jsonb_build_object('ok', true);

  ELSE
    SELECT * INTO t FROM public.proofreading_tests WHERE id = want FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Test not found'; END IF;
    IF t.status <> 'in_use' OR t.claimed_by IS DISTINCT FROM p_user OR t.claim_nonce IS NULL OR nonce IS NULL
       OR t.claim_nonce IS DISTINCT FROM nonce OR t.expires_at <= now() THEN
      RAISE EXCEPTION 'This test session has ended';
    END IF;
    IF p_action = 'heartbeat' THEN
      quiet := CASE WHEN EXISTS (SELECT 1 FROM public.proofreading_test_queue WHERE test_id = t.id) THEN least(t.hold_minutes, quiet_waiting) ELSE t.hold_minutes END;
      UPDATE public.proofreading_tests SET expires_at = least(now() + make_interval(mins => quiet), deadline_at + grace), updated_at = now()
        WHERE id = t.id RETURNING * INTO t;
      RETURN jsonb_build_object('expires_at', t.expires_at, 'deadline_at', t.deadline_at, 'quiet_minutes', quiet,
        'waiting', (SELECT count(*) FROM public.proofreading_test_queue WHERE test_id = t.id));
    ELSIF p_action = 'cleaned' THEN
      -- The server put the cell back to its start under this claim and hands
      -- it over: the time limit starts now (2026-10-19), and the hold can be
      -- renewed up to the limit plus the grace, never further.
      UPDATE public.proofreading_tests SET last_reset_at = now(), reset_failures = 0, last_error = NULL,
          deadline_at = coalesce(deadline_at, now() + make_interval(mins => time_limit_minutes)),
          expires_at = least(expires_at, coalesce(deadline_at, now() + make_interval(mins => time_limit_minutes)) + grace),
          updated_at = now()
        WHERE id = t.id RETURNING * INTO t;
      RETURN jsonb_build_object('ok', true, 'deadline_at', t.deadline_at);
    ELSIF p_action = 'record' THEN
      IF coalesce(p_args->>'outcome', '') NOT IN ('pass', 'fail', 'abandoned', 'error') THEN RAISE EXCEPTION 'Unknown outcome'; END IF;
      UPDATE public.proofreading_test_attempts SET outcome = p_args->>'outcome', submitted_at = now(),
          found = (p_args->>'found')::integer, errors = (p_args->>'errors')::integer, damaged = (p_args->>'damaged')::integer,
          percent = (p_args->>'percent')::integer, checks = p_args->'checks', endpoints = p_args->'endpoints',
          granted = p_args->'granted', error = left(p_args->>'error', 500),
          timed_out = coalesce((p_args->>'timed_out')::boolean, false)
        WHERE test_id = t.id AND claim_nonce = t.claim_nonce AND outcome IS NULL RETURNING * INTO att;
      -- A pass opens the app's own gate here, in the same transaction.
      IF p_args->>'outcome' = 'pass' AND t.grant_pilot THEN
        INSERT INTO public.pilot_members (email, enabled, added_by)
          SELECT lower(trim(u.middleauth_email)), true, NULL FROM public.users u WHERE u.id = p_user AND u.middleauth_email LIKE '%@%'
          ON CONFLICT (email) DO UPDATE SET enabled = true;
      END IF;
      UPDATE public.proofreading_tests SET
          status = CASE WHEN clean THEN 'ready' WHEN reset_failures + 1 >= 3 THEN 'broken' ELSE 'needs_reset' END,
          claimed_by = NULL, claimed_at = NULL, expires_at = NULL, deadline_at = NULL, claim_nonce = NULL, reset_nonce = NULL,
          last_reset_at = CASE WHEN clean THEN now() ELSE last_reset_at END,
          reset_failures = CASE WHEN clean THEN 0 ELSE reset_failures + 1 END,
          last_error = CASE WHEN clean THEN NULL ELSE left(p_args->>'error', 500) END,
          updated_at = now()
        WHERE id = t.id RETURNING * INTO t;
      -- The cell is free: the next in line is called now, not at the next look.
      PERFORM public.proofreading_test_call_next();
      RETURN jsonb_build_object('attempt', att.id, 'outcome', att.outcome, 'status', t.status);
    ELSE
      RAISE EXCEPTION 'Unknown test action';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pilot_test_action(uuid, text, jsonb), public.proofreading_test_public(public.proofreading_tests),
  public.proofreading_test_call_next(), public.proofreading_test_refusal(public.proofreading_tests, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_test_action(uuid, text, jsonb), public.proofreading_test_public(public.proofreading_tests),
  public.proofreading_test_call_next(), public.proofreading_test_refusal(public.proofreading_tests, uuid, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
