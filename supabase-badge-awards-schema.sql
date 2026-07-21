-- ============================================================================
-- badge_awards — persist Building / Exploration badge earns per user
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- The 200 Building (edits) and Exploration (cells) badges were never stored.
-- "Earned" was recomputed every render as `stat >= threshold`, so a badge had
-- no award date, no history, and — worse — silently DISAPPEARED if the stat
-- ever dropped (e.g. a stat resync landing lower than a client-side bump).
--
-- This table records the first time each threshold is crossed. The profile then
-- treats a badge as earned if the stat currently qualifies OR a row exists here,
-- so a once-earned badge is permanent.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

create table if not exists badge_awards (
  user_id     uuid   not null references users(id) on delete cascade,
  -- 'building' (keyed on editsAllTime) or 'exploration' (keyed on cellsSubmitted)
  track       text   not null,
  -- The badge id from badge_definitions.ts (1-100 building, 101-200 exploration)
  badge_id    integer not null,
  awarded_at  timestamptz default now(),
  primary key (user_id, track, badge_id)
);

create index if not exists badge_awards_user_idx on badge_awards (user_id);

-- MVP RLS: permissive, matching every other table in this project. Tighten
-- alongside the app-wide RLS pass (see HANDOFF §15).
alter table badge_awards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'badge_awards' and policyname = 'badge_awards_all') then
    create policy badge_awards_all on badge_awards for all using (true) with check (true);
  end if;
end $$;
