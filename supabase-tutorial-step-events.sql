-- How long players spend on each tutorial box (Ames, 2026-10-29: "know how
-- long players spend on them and even how long on each card"). One row each
-- time a player leaves a box: which tutorial and box, the seconds spent
-- there (the app caps a box at 10 minutes, so a player who walked away does
-- not skew it), how they left it (next, back, close, auto when the box moved
-- on by itself, other), how many times they pressed Help me on it, the
-- practice cell when there was one, and the app build. `run` groups the rows
-- of one go at a tutorial.
--
-- Written only through the ewCommunityData function, which stamps the player
-- and checks every field. Read only by admins, through the same function
-- (no public read policy here).
CREATE TABLE IF NOT EXISTS public.tutorial_step_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tutorial integer NOT NULL,
  step integer NOT NULL,
  box text,
  item text,
  seconds integer NOT NULL,
  left_by text NOT NULL,
  help integer NOT NULL DEFAULT 0,
  build text,
  run text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutorial_step_events_tut_idx ON public.tutorial_step_events (tutorial, step, created_at DESC);
CREATE INDEX IF NOT EXISTS tutorial_step_events_user_idx ON public.tutorial_step_events (user_id, created_at DESC);
ALTER TABLE public.tutorial_step_events ENABLE ROW LEVEL SECURITY;

-- Per box, across everyone: how many times it was seen, by how many players,
-- the median and slowest-tenth seconds, how often Help me was pressed, and
-- how many left the tutorial from it. `last_box` is the box's title as it
-- read most recently.
CREATE OR REPLACE VIEW public.tutorial_step_stats AS
SELECT
  tutorial,
  step,
  (array_agg(box ORDER BY created_at DESC))[1] AS last_box,
  count(*)::int AS n,
  count(DISTINCT user_id)::int AS players,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)::numeric, 1) AS median_s,
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds)::numeric, 1) AS p90_s,
  round(avg((help > 0)::int)::numeric, 3) AS help_rate,
  sum((left_by = 'close')::int)::int AS closes
FROM public.tutorial_step_events
GROUP BY tutorial, step;
-- The view reads with its owner's rights; keep it out of public reach too.
REVOKE ALL ON public.tutorial_step_stats FROM anon, authenticated;
