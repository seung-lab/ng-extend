-- ============================================================================
-- feedback_triage: Slack bridge columns
-- ----------------------------------------------------------------------------
-- scripts/slack-triage-bridge.mjs posts each proposal to Slack and lets Amy
-- or Celia approve or dismiss by replying in the thread. These columns track
-- what was posted where so proposals are never double-posted and replies can
-- be found again.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

alter table if exists feedback_triage add column if not exists slack_channel text;
alter table if exists feedback_triage add column if not exists slack_ts      text;
