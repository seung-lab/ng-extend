-- ============================================================================
-- site_issues.title: a short title on every report (Celia #178, 2026-10-20)
-- ----------------------------------------------------------------------------
-- "Submit an issue" asks for a title above the description, so the triage
-- board shows what a report is about at a glance. Older reports have none.
-- Until this runs, the game puts the title at the top of the message instead.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table site_issues add column if not exists title text;
alter table site_issues drop constraint if exists site_issues_title_len;
alter table site_issues add constraint site_issues_title_len check (title is null or char_length(title) <= 120);
