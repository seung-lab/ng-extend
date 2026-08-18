-- ============================================================================
-- feedback_triage: done-announcement columns
-- ----------------------------------------------------------------------------
-- When an approved proposal ships, the row moves to status='done' (Admin Hub
-- "Mark done", which also asks for a one-line result note). The Slack bridge
-- then posts a change update into the original thread, tagging the approvers,
-- and records the announcement timestamp here so it never double-posts.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

alter table if exists feedback_triage add column if not exists result_note   text;
alter table if exists feedback_triage add column if not exists done_slack_ts text;
