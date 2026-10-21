-- ============================================================================
-- feedback_triage.admin_notes: notes on a triage card, with no decision
-- (Celia #178, 2026-10-20)
-- ----------------------------------------------------------------------------
-- [{ "by": "Ames", "text": "...", "at": "2026-10-20T..." }]. Written only by
-- ewSecureWrite (triage.note) for admins. Kept apart from feedback_log, which
-- the Slack bridge rewrites from its own copy.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table feedback_triage add column if not exists admin_notes jsonb not null default '[]'::jsonb;
