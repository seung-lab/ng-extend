-- ============================================================================
-- Lost Fragments answers (Ames 2026-11-19: "a special lost fragment tag in
-- our cave table, and backup in supabase", "go for the new tables").
--
-- One row per player and fragment; Submit again updates it. The record in
-- CAVE is a point in eyewire_ii_cell_status_v2 tagged 'lost_fragment' at the
-- player's point (cave_annotation_id below). The server also copies each row
-- to the researchers' sheet, "Pyr Lost Fragments results" (sheet_row).
-- Each fragment counts as a completed cell (Ames 2026-11-19).
--
-- Written and read only by the EyeWire II server (service role): RLS on,
-- no policy, nothing for the public key.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ew_lost_fragments (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL,
  fragment_id        text NOT NULL,          -- the ID in the lab's list
  group_key          text NOT NULL CHECK (group_key IN ('large', 'smaller', 'glia', 'soma')),
  root_id            text,                   -- the segment after the player's edits
  lab_flag           text NOT NULL DEFAULT '',
  lab_um3            numeric,
  fixed              boolean NOT NULL DEFAULT false,
  ends               boolean NOT NULL DEFAULT false,
  point_in           text NOT NULL CHECK (point_in IN ('dendrite', 'soma')),
  pt                 integer[] NOT NULL CHECK (array_length(pt, 1) = 3),  -- voxels, 16 x 16 x 40 nm
  nucleus_id         text NOT NULL DEFAULT '',
  no_nucleus         boolean NOT NULL DEFAULT false,
  merges             integer,
  cuts               integer,
  um3_added          numeric,
  um3_removed        numeric,
  note               text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  cave_annotation_id bigint,
  sheet_row          integer,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fragment_id)
);
CREATE INDEX IF NOT EXISTS ew_lost_fragments_fragment ON public.ew_lost_fragments (fragment_id);
ALTER TABLE public.ew_lost_fragments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ew_lost_fragments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ew_lost_fragments_id_seq FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- Claims (Ames 2026-11-20: "play mode on a fragment should claim it as mine
-- until I skip it"). One row per fragment in play; a player holds one at a
-- time. Skip or Submit deletes it; one older than 14 days has lapsed
-- (functions/lost-fragments.js CLAIM_DAYS). Never copied to the sheet.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ew_lost_fragment_claims (
  fragment_id text PRIMARY KEY,
  user_id     uuid NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ew_lost_fragment_claims_user ON public.ew_lost_fragment_claims (user_id);
ALTER TABLE public.ew_lost_fragment_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ew_lost_fragment_claims FROM PUBLIC, anon, authenticated;

COMMIT;

-- The sheet line is written by the job ewLostFragmentsSheet, which runs as the
-- sheet identity (2026-11-20): Submit marks the answer waiting, with the
-- player's name for the line.
alter table public.ew_lost_fragments
  add column if not exists player_name text,
  add column if not exists sheet_dirty boolean not null default true;
update public.ew_lost_fragments f set player_name = coalesce(u.display_name, u.username, 'Player')
  from public.users u where u.id = f.user_id and f.player_name is null;

-- Points, a beta (2026-11-20): worked out on Submit (lost-fragments.js
-- fragmentPoints). Not in stats, the leaderboard or the sheet.
alter table public.ew_lost_fragments
  add column if not exists points integer,
  add column if not exists points_detail jsonb;
-- Per player, for the admins' review at the end of Thanksgiving week
-- (Ames 2026-11-20: check how well the points track what players did).
create or replace view public.ew_lost_fragment_points with (security_invoker = true) as
select f.user_id, max(f.player_name) as player_name, count(*) as fragments,
  sum(f.points) as points, sum((f.points_detail->>'size')::int) as size_points,
  sum((f.points_detail->>'edits')::int) as edit_points, sum((f.points_detail->>'grown')::int) as grown_points,
  sum((f.points_detail->>'nucleus')::int) as nucleus_points,
  sum(f.merges) as merges, sum(f.cuts) as cuts, round(sum(f.lab_um3)::numeric, 1) as lab_um3,
  min(f.submitted_at) as first_at, max(f.updated_at) as last_at
from public.ew_lost_fragments f group by f.user_id;
revoke all on public.ew_lost_fragment_points from anon, authenticated;

-- Stashed cells (Ames 2026-11-20: "stash the other cell for proofreading
-- somehow - or let the player choose to proofread it too"). Part of a
-- fragment belonged to another cell that is not proofread yet: that cell is
-- kept here, once, and shows in Lost Fragments as the Stashed group. It is
-- answered like any fragment, with group_key 'stashed'.
create table if not exists public.ew_lost_fragment_stash (
  root_id text primary key check (root_id ~ '^[0-9]{15,20}$'),
  pt integer[] not null,
  from_fragment_id text not null,
  user_id uuid not null,
  player_name text,
  choice text not null default 'stash' check (choice in ('stash', 'proofread')),
  created_at timestamptz not null default now()
);
alter table public.ew_lost_fragment_stash enable row level security;
revoke all on public.ew_lost_fragment_stash from public, anon, authenticated;
-- The other cell, on the fragment's own answer.
alter table public.ew_lost_fragments
  add column if not exists other_root text,
  add column if not exists other_status text check (other_status in ('done', 'stashed', 'proofread'));
alter table public.ew_lost_fragments drop constraint if exists ew_lost_fragments_group_key_check;
alter table public.ew_lost_fragments add constraint ew_lost_fragments_group_key_check
  check (group_key in ('large', 'smaller', 'glia', 'soma', 'stashed'));

-- Started fragments stay yours (Ames 2026-11-21): a claim the player has
-- edited is kept when Play hands them the next one, five at most
-- (lost-fragments.js KEEP_LIMIT).
alter table public.ew_lost_fragment_claims add column if not exists kept boolean not null default false;
