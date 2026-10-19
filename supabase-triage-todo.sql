-- ============================================================================
-- feedback_triage: the To do list (Ames 2026-10-19)
-- ----------------------------------------------------------------------------
-- Admin Hub > Triage has a To do column for larger jobs, separate from Ideas
-- for later. A To do card is an approved card whose approver_note starts with
-- "To do" (the same way Later works), so the robot never builds it.
--
--   todo_rank  where the card sits in the To do column (smaller is higher).
--              Dragging a card writes only that card: it takes a number
--              between its new neighbours.
--   todo_size  S, M or L, set by clicking the tag on the card.
--   source     'todo' is a To do Ames or Celia typed in on the board, not a
--              player report. It never goes to Slack and nobody is notified.
--
-- Run in the Supabase SQL editor BEFORE the server code that writes these
-- columns is deployed. Safe to re-run.
-- ============================================================================

begin;

alter table feedback_triage add column if not exists todo_rank double precision;
alter table feedback_triage add column if not exists todo_size text;

alter table feedback_triage drop constraint if exists feedback_triage_todo_size_chk;
alter table feedback_triage add constraint feedback_triage_todo_size_chk
  check (todo_size is null or todo_size in ('S', 'M', 'L'));

-- Allow source = 'todo' alongside the existing kinds of report.
alter table feedback_triage drop constraint if exists feedback_triage_source_check;
alter table feedback_triage add constraint feedback_triage_source_check
  check (source in ('site_issue', 'client_error', 'guide_feedback', 'help_request', 'todo'));

commit;
