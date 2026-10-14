-- Pyr: saves waiting for CAVE (Ames 2026-10-14).
--
-- When CAVE does not answer, or answers with a server error, a completion or
-- a cell type the player just saved waits here instead of being refused. The
-- player's own browser sends it to CAVE once CAVE is back, with the player's
-- own sign in, so CAVE still records who made it. The server never sends
-- anything to CAVE and never keeps a player's CAVE sign in.
--
-- The table is private. Row level security is on and there is no policy, so
-- the public key the game ships cannot read or write it at all. Only the
-- server function (ewSecureWrite, actions "outbox.*", rules in
-- functions/cave-outbox.js) touches it, and it hands a player only their own
-- rows. The health watch reads it with the service key to count what waits.
--
-- Safe to run more than once.

create table if not exists public.cave_outbox (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.users(id),
  kind           text not null check (kind in ('complete', 'cell_type')),
  dataset        text not null,
  cave_server    text not null,                -- https://host, from a fixed list
  aligned_volume text not null,
  datastack      text not null default '',
  table_name     text not null,
  root_id        text not null,                -- the cell's ID when it was saved
  pt             jsonb not null,               -- [x, y, z]: the point it is saved at
  annotation     jsonb not null,               -- exactly what is sent to CAVE
  replaces_id    bigint,                       -- a cell type: the old CAVE row to remove once sent
  status         text not null default 'waiting' check (status in ('waiting', 'sent', 'cancelled')),
  attempts       integer not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  last_try_at    timestamptz,
  sent_at        timestamptz,
  annotation_id  bigint                        -- the CAVE row it became
);
create index if not exists cave_outbox_waiting_idx on public.cave_outbox (user_id) where status = 'waiting';
create index if not exists cave_outbox_status_idx on public.cave_outbox (status, created_at);

alter table public.cave_outbox enable row level security;
revoke all on public.cave_outbox from anon, authenticated;
