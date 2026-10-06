-- ============================================================================
-- Activity-driven CAVE edits sync: beacon, sync stamp, and watermarks
-- ----------------------------------------------------------------------------
-- The app witnesses every in-app edit, so the sync never polls quiet users:
--   dirty user  ==  last_edit_at > last_cave_sync_at   (both ours, one clock)
-- The client stamps last_edit_at on real edits (debounced); the sync stamps
-- last_cave_sync_at whenever it checks a user. The watermark view gives each
-- user's newest mirrored op per dataset, which is that user's incremental
-- query window (first check = personal full backfill). A three-user drizzle
-- per run catches out-of-app edits with flat load, no weekly thundering herd.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

alter table if exists users add column if not exists last_edit_at      timestamptz;
alter table if exists users add column if not exists last_cave_sync_at timestamptz;
create index if not exists users_last_edit_at_idx      on users (last_edit_at desc nulls last);
create index if not exists users_last_cave_sync_at_idx on users (last_cave_sync_at asc nulls first);

create or replace view cave_edits_watermarks with (security_invoker = true) as
  select cave_user_id, dataset, max(timestamp) as newest
  from cave_edits_mirror
  group by cave_user_id, dataset;
