-- Cell match on Sandbox cells (Ames, 2026-11-12). Safe to run more than once.
--
-- sandbox_match_keys: per Cell Library task, the true cell in pinky_training,
--   the cell at the task's start, and the pieces that differ. Built by the
--   ewSandboxMatch function (functions/sandbox-match.js) on a cell's first
--   check. It is an answer key: no grants, RLS on, no policies, so only the
--   service role reads it.
-- sandbox_match_scores: each player's last and best match per cell, written
--   only through sandbox_match_record (service role). Admins read it.

CREATE TABLE IF NOT EXISTS public.sandbox_match_keys (
  task_id        integer PRIMARY KEY REFERENCES public.proofreading_tasks(id) ON DELETE CASCADE,
  version        text NOT NULL,
  truth_at       timestamptz NOT NULL,
  start_at       timestamptz,
  start_root     text,
  truth_root     text,
  truth_size     integer,
  missing_start  integer NOT NULL DEFAULT 0,
  extra_start    integer NOT NULL DEFAULT 0,
  missing_pieces jsonb NOT NULL DEFAULT '[]'::jsonb,
  extra_pieces   jsonb NOT NULL DEFAULT '[]'::jsonb,
  scorable       boolean NOT NULL DEFAULT false,
  reason         text,
  built_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sandbox_match_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandbox_match_keys FROM anon, authenticated;
-- Tiny pieces are optional (Ames 2026-11-14, functions/sandbox-match.js):
-- the supervoxels of each missing and extra piece under SMALL_PIECE.
ALTER TABLE public.sandbox_match_keys ADD COLUMN IF NOT EXISTS optional_missing jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.sandbox_match_keys ADD COLUMN IF NOT EXISTS optional_extra jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.sandbox_match_scores (
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id        integer NOT NULL REFERENCES public.proofreading_tasks(id) ON DELETE CASCADE,
  match          integer,
  best_match     integer,
  missing_left   integer,
  missing_total  integer,
  extra_left     integer,
  extra_total    integer,
  root           text,
  checks         integer NOT NULL DEFAULT 0,
  first_at       timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS sandbox_match_scores_task ON public.sandbox_match_scores(task_id);
-- The most wrong supervoxels the player's cell has held: Cut counts against it
-- when it is more than at the start (Ames 2026-11-16).
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS extra_peak integer NOT NULL DEFAULT 0;
ALTER TABLE public.sandbox_match_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandbox_match_scores FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sandbox_match_record(
  p_user uuid, p_task integer, p_match integer, p_root text,
  p_missing_left integer, p_missing_total integer, p_extra_left integer, p_extra_total integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO sandbox_match_scores AS s
    (user_id, task_id, match, best_match, missing_left, missing_total, extra_left, extra_total, root, checks)
  VALUES (p_user, p_task, p_match, p_match, p_missing_left, p_missing_total, p_extra_left, p_extra_total, p_root, 1)
  ON CONFLICT (user_id, task_id) DO UPDATE SET
    match = EXCLUDED.match,
    best_match = GREATEST(s.best_match, EXCLUDED.match),
    missing_left = EXCLUDED.missing_left, missing_total = EXCLUDED.missing_total,
    extra_left = EXCLUDED.extra_left, extra_total = EXCLUDED.extra_total,
    root = EXCLUDED.root, checks = s.checks + 1, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.sandbox_match_record(uuid, integer, integer, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sandbox_match_record(uuid, integer, integer, text, integer, integer, integer, integer) TO service_role;

-- Each player starts a cell at 0% (Ames 2026-11-17): the cell as this player
-- first saw it. Practice cells keep the edits made on them before, so the
-- cell's own start is not where every player begins. Null on rows from before.
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS start_missing integer;
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS start_extra integer;
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS start_missing_left integer;
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS start_extra_left integer;
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS start_reach real;

-- The most each wrong part has held on this player's cell, by its true cell
-- (Ames 2026-11-17): a part is cut off once most of it is gone.
ALTER TABLE public.sandbox_match_scores ADD COLUMN IF NOT EXISTS parts_peak jsonb;
