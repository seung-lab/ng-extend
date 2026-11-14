-- Sandbox play moments (Ames, 2026-11-14: "we want to track when users click
-- hint, how long they are spending here esp between each edit"). Safe to run
-- more than once.
--
-- One row per moment on a Sandbox cell: opened, hint_offered, hint, complete,
-- skip. Edits are not repeated here: edit_log already has each merge and cut
-- with its time, so the time between edits comes from there. Written only by
-- the ewSandboxMatch function (service role). No grants, RLS on, no policies:
-- players never read it; admins read it through the function.

CREATE TABLE IF NOT EXISTS public.sandbox_play_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id    integer NOT NULL REFERENCES public.proofreading_tasks(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('opened', 'hint_offered', 'hint', 'complete', 'skip')),
  at         timestamptz NOT NULL DEFAULT now(),
  -- Seconds since the player's last edit on this cell (or since it opened), as the browser counted it.
  idle_secs  integer,
  -- The match score at that moment, and for a hint which piece it showed.
  score      integer,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sandbox_play_events_task_user ON public.sandbox_play_events (task_id, user_id, at);
ALTER TABLE public.sandbox_play_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandbox_play_events FROM anon, authenticated;
