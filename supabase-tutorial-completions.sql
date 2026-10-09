-- Which tutorials each player has finished, and how many times (Ames,
-- 2026-10-09). One row per finish: the tutorial number (1 Get Started,
-- 2 Advanced Interface, 3 Merge, 4 Site Tour, 5 Cut, 9 Merger Sandbox, the
-- dataset tours 6, 7, 8, 10), and for the practice tutorials how many edits
-- were asked for and how many the player actually made. A sandbox row names
-- the merger in `item`. Written only by the server function (which stamps
-- the player); readable by anyone, like the other public game records.
-- Meant as the base for scoring a test later.
CREATE TABLE IF NOT EXISTS public.tutorial_completions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tutorial integer NOT NULL,
  item text,
  practice_asked integer NOT NULL DEFAULT 0,
  practice_made integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutorial_completions_user_idx ON public.tutorial_completions (user_id, tutorial, completed_at DESC);
ALTER TABLE public.tutorial_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tutorial_completions_read ON public.tutorial_completions;
CREATE POLICY tutorial_completions_read ON public.tutorial_completions FOR SELECT USING (true);
