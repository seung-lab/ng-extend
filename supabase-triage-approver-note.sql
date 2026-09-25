-- ============================================================================
-- feedback_triage.approver_note: the reviewer's comment on approve / dismiss
-- ----------------------------------------------------------------------------
-- Admin Hub > Triage has a comment box under every proposal; the text is saved
-- here with the decision. Internal only, never sent to the reporter.
-- The triage loop (claude/triage-loop, supabase-triage-loop-columns.sql) adds
-- the same column and hands it to Claude with an approved spec, so running
-- either file is enough and both are safe to re-run.
--
-- Run in the Supabase SQL editor.
-- ============================================================================

alter table feedback_triage add column if not exists approver_note text;
