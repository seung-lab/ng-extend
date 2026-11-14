-- Sandbox cells back in play (Ames 2026-11-14). One row per completed Sandbox
-- task the reset job has looked at: functions/sandbox-reset.js.
--   reset         the cell was put back as it was handed out; new_task_id is
--                 the pending task that serves it again
--   needs_review  left alone (an edit after completion, an edit made while
--                 nobody held it, or not back to its start); an admin looks
--   failed        CAVE or the database failed; tried again on a later run
create table if not exists public.sandbox_cell_resets (
  task_id bigint primary key references public.proofreading_tasks(id) on delete cascade,
  status text not null check (status in ('reset', 'needs_review', 'failed')),
  new_task_id bigint references public.proofreading_tasks(id) on delete set null,
  ops_undone integer not null default 0,
  reason text,
  updated_at timestamptz not null default now()
);
alter table public.sandbox_cell_resets enable row level security;
revoke all on public.sandbox_cell_resets from anon, authenticated;
