-- Pyr Proofreading Test: what the admins see of each try (Ames, 2026-10-21).
-- Admin Hub > Test tries lists every try; a try opens with its score, what
-- was fixed, missed and damaged, and the player's cell as they left it.
--
--   end_root    the cell's root id when it was scored (or, for a try left
--               unfinished, just before the next player's start put it
--               back). A root id names that set of supervoxels for good,
--               so the cell can be shown after the undos.
--   ends_found  branch ends marked, of
--   ends_total  branch ends in the key at the time.
--
-- Written by ewProofreadingTest (code 2026-10-21-proofreading-test-7) with
-- the service role; nobody else can read the table. Safe to run twice.

ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS end_root text
  CHECK (end_root IS NULL OR end_root ~ '^[0-9]{1,20}$');
ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS ends_found integer;
ALTER TABLE public.proofreading_test_attempts ADD COLUMN IF NOT EXISTS ends_total integer;

-- Tries scored before today: the ends from each check's result.
UPDATE public.proofreading_test_attempts a SET
    ends_total = (SELECT count(*) FROM jsonb_array_elements(a.checks) c WHERE c->>'kind' = 'endpoint'),
    ends_found = (SELECT count(*) FROM jsonb_array_elements(a.checks) c WHERE c->>'kind' = 'endpoint' AND (c->>'ok')::boolean)
  WHERE jsonb_typeof(a.checks) = 'array' AND a.ends_total IS NULL;

-- Kim's two tries (CAVE user 10711), their cells rebuilt from the graph
-- history: the soma's root just before the server's first undo after them.
-- 2026-10-20: 6 edits, scored when time ran out at 06:28 UTC.
UPDATE public.proofreading_test_attempts a SET end_root = '648518346350612738'
  FROM public.users u
  WHERE u.id = a.user_id AND u.cave_user_id = 10711 AND a.outcome IN ('pass', 'fail') AND a.end_root IS NULL
    AND a.submitted_at BETWEEN '2026-10-20 06:00:00+00' AND '2026-10-20 07:00:00+00';
-- 2026-10-21: 2 cuts at 02:57 and 03:08 UTC, never submitted (the hold ran out).
UPDATE public.proofreading_test_attempts a SET end_root = '648518346352954721'
  FROM public.users u
  WHERE u.id = a.user_id AND u.cave_user_id = 10711 AND a.outcome = 'expired' AND a.end_root IS NULL
    AND a.started_at BETWEEN '2026-10-21 01:00:00+00' AND '2026-10-21 03:08:52+00';

-- What it did: the latest tries.
SELECT a.id, u.username, a.started_at, a.outcome, a.percent, a.ends_found, a.ends_total, a.end_root
  FROM public.proofreading_test_attempts a JOIN public.users u ON u.id = a.user_id
  ORDER BY a.id DESC LIMIT 10;
