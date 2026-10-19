-- ============================================================================
-- Retina access requests (Ames 2026-10-16): the EyeWire II Dataset Access form,
-- in the game. A player saves 7 cut examples (an accidental merger, with red
-- and blue Multicut points where they would cut) and 3 merge examples (an
-- accidental split, with both pieces shown), each with an optional note, and
-- sends them for review. Celia and Marissa are told (a bell and Slack), review
-- every example and every point in the Admin Hub (Access requests), and either
-- ask for redos (the player replaces only those) or invite the player. An
-- invite adds the player to pilot_members; the CAVE group (Eyewire_2_Edit,
-- 203) is still given by hand until the automated test grants it.
--
-- Every read and write goes through the ewAccessRequest Cloud Function
-- (functions/access-request.js) with the service role. Nothing here is
-- readable with the public key: the examples carry a player's email.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.access_requests (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  email         text not null,
  player_name   text not null default '',
  affiliation   text check (affiliation is null or length(affiliation) <= 200),
  -- draft: the player is collecting. submitted: waiting for a reviewer.
  -- redo: a reviewer asked for some examples again. invited: done.
  status        text not null default 'draft' check (status in ('draft', 'submitted', 'redo', 'invited')),
  tries         integer not null default 0,
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.users(id) on delete set null,
  reviewer_note text check (reviewer_note is null or length(reviewer_note) <= 4000),
  pilot_added   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One request per player: it is reopened for redos, never duplicated.
create unique index if not exists access_requests_user_idx on public.access_requests (user_id);
create index if not exists access_requests_status_idx on public.access_requests (status, submitted_at desc);

create table if not exists public.access_request_items (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.access_requests(id) on delete cascade,
  kind        text not null check (kind in ('cut', 'merge')),
  slot        integer not null check (slot between 1 and 7),
  link        text not null check (length(link) <= 2000),
  dataset     text check (dataset is null or length(dataset) <= 80),
  note        text check (note is null or length(note) <= 1000),
  -- {red: [{position:[x,y,z], segmentId, rootId}], blue: [...]} for a cut;
  -- the two pieces shown for a merge are in segments.
  points      jsonb not null default '{}'::jsonb,
  segments    jsonb not null default '[]'::jsonb,
  position    jsonb,
  -- The reviewer's: good or redo for the example, good or off for each
  -- point ({"red:0": "good", "blue:1": "off"}), and a note to the player.
  verdict     text check (verdict is null or verdict in ('good', 'redo')),
  point_marks jsonb not null default '{}'::jsonb,
  feedback    text check (feedback is null or length(feedback) <= 2000),
  saved_at    timestamptz not null default now(),
  unique (request_id, kind, slot),
  check ((kind = 'cut' and slot <= 7) or (kind = 'merge' and slot <= 3))
);

alter table public.access_requests      enable row level security;
alter table public.access_request_items enable row level security;
revoke all on public.access_requests      from anon, authenticated;
revoke all on public.access_request_items from anon, authenticated;
grant all on public.access_requests      to service_role;
grant all on public.access_request_items to service_role;

-- 2026-10-16 (Ames): the player's EyeWire username instead of a lab, and a
-- note to the reviewer that goes with the whole request.
alter table public.access_requests add column if not exists eyewire_username text check (eyewire_username is null or length(eyewire_username) <= 60);
alter table public.access_requests add column if not exists player_note text check (player_note is null or length(player_note) <= 1000);

-- 2026-10-16 (Ames: "grant access button would be good"): the player's CAVE
-- user id, taken from their sign in by the server, so Grant edit access can
-- add them to Eyewire_2_Edit (group 203) itself.
alter table public.access_requests add column if not exists cave_user_id bigint;
alter table public.access_requests add column if not exists cave_granted boolean not null default false;

-- 2026-10-16 (Ames: "save the wrong ones and the new ones become additional
-- submissions"): an example replaced or removed after a request was sent is
-- kept here, with the reviewer's marks and note, instead of being lost.
create table if not exists public.access_request_item_history (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.access_requests(id) on delete cascade,
  kind        text not null,
  slot        integer not null,
  try         integer not null default 0,
  link        text not null,
  dataset     text,
  note        text,
  points      jsonb not null default '{}'::jsonb,
  segments    jsonb not null default '[]'::jsonb,
  position    jsonb,
  verdict     text,
  point_marks jsonb not null default '{}'::jsonb,
  feedback    text,
  saved_at    timestamptz,
  replaced_at timestamptz not null default now()
);
create index if not exists access_request_item_history_req_idx on public.access_request_item_history (request_id, kind, slot);
alter table public.access_request_item_history enable row level security;
revoke all on public.access_request_item_history from anon, authenticated;
grant all on public.access_request_item_history to service_role;
