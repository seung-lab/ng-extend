-- ============================================================================
-- The Hunt (Ames 2026-10-20): timed merger hunts
-- ----------------------------------------------------------------------------
-- Players search a cell (or several) for mergers, put a point on each one
-- they find, and submit. An admin marks the mergers once in an ordinary
-- annotation layer; the game reads them from that view as the answer key.
-- When the hunt ends the best hunters get gold, silver and bronze special
-- Achievements (rows in special_badges / special_badge_awards).
--
--   hunts             one row per hunt: words, dates, cells, the view
--                     players start from (with no annotation layer in it),
--                     tolerance, tiers, the three notification ids
--   hunt_keys         the answer key: the marked mergers, in nanometres
--   hunt_submissions  every answer a player sent, with how many it found
--
-- Read and written only by the ewHunt Cloud Function (service key) after it
-- has checked who is asking (functions/hunts.js). No policies: the browser's
-- key cannot read or write any of these, so the key never reaches a player.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

begin;

create table if not exists hunts (
  id              bigint      generated always as identity primary key,
  title           text        not null check (char_length(title) between 1 and 80),
  description     text        not null default '' check (char_length(description) <= 1500),
  dataset         text        not null,
  -- [{ "root": "648518346350533705", "label": "..." }]
  cells           jsonb       not null default '[]'::jsonb,
  -- the neuroglancer state players start from, every annotation layer removed
  view            jsonb,
  target_count    integer     not null default 0,
  tolerance_nm    integer     not null default 3000 check (tolerance_nm between 100 and 100000),
  max_points      integer     not null default 0,       -- 0: three per merger, at least ten
  max_submissions integer     not null default 10,
  -- finds needed per tier; 0 = all, two thirds, one third
  tiers           jsonb       not null default '{"gold":0,"silver":0,"bronze":0}'::jsonb,
  -- optional art per tier: { "gold": "https://..." }; else the game's own medals
  art             jsonb       not null default '{}'::jsonb,
  status          text        not null default 'draft' check (status in ('draft', 'scheduled', 'cancelled')),
  announce_at     timestamptz,
  start_at        timestamptz,
  end_at          timestamptz,
  -- { "announce": 123, "start": 124, "end": 125 }: rows in notifications
  notif_ids       jsonb       not null default '{}'::jsonb,
  -- a picture per note: { "announce": { "image_url": "https://...", "thumbnail_url": "https://..." }, ... }
  notif_images    jsonb       not null default '{}'::jsonb,
  awarded_at      timestamptz,
  created_by      uuid        references users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at is null or start_at is null or end_at > start_at)
);
create index if not exists hunts_status_end_idx on hunts (status, end_at);
-- 2026-10-21: pictures for the notes (for a table made by the first version of this file)
alter table hunts add column if not exists notif_images jsonb not null default '{}'::jsonb;

create table if not exists hunt_keys (
  hunt_id     bigint      primary key references hunts (id) on delete cascade,
  -- [[x, y, z], ...] in nanometres
  targets     jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists hunt_submissions (
  id          bigint      generated always as identity primary key,
  hunt_id     bigint      not null references hunts (id) on delete cascade,
  user_id     uuid        not null references users (id) on delete cascade,
  -- [[x, y, z], ...] in nanometres, as sent
  points      jsonb       not null,
  found       integer     not null default 0,
  close       integer     not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists hunt_submissions_hunt_idx on hunt_submissions (hunt_id, user_id);

-- No policies: only the service key (the ewHunt function) can touch these.
alter table hunts enable row level security;
alter table hunt_keys enable row level security;
alter table hunt_submissions enable row level security;

commit;
