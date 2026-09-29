-- Recent console warnings and errors a player attached to "Submit an issue"
-- (Ames 2026-09-29). Written only through ewCommunityData; admins read it in
-- Admin Hub > Triage. Safe to re-run.
alter table site_issues add column if not exists console_log text;
notify pgrst, 'reload schema';
