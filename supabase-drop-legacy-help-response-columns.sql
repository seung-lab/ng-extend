-- ============================================================================
-- Drop the legacy single-response columns from help_requests
-- ----------------------------------------------------------------------------
-- Replies live in the help_responses child table (one row per reply, so share
-- links accumulate instead of overwriting). The legacy columns were kept
-- through the rollout so older client builds kept working; the client no
-- longer reads or writes them anywhere.
--
-- PRE-FLIGHT (verified 2026-08-11 before writing this file): every legacy
-- response was backfilled — 13 help_requests rows had response_note set, and
-- help_responses covers all 13 of those requests. Re-check before running:
--
--   select count(*) from help_requests hr
--   where hr.response_note is not null
--     and not exists (select 1 from help_responses r where r.request_id = hr.id);
--   -- must be 0
--
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

alter table if exists help_requests drop column if exists response_note;
alter table if exists help_requests drop column if exists response_url;
alter table if exists help_requests drop column if exists response_annotation_layer;
