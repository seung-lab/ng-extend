-- Nicknames (Nseraf, report 602; Ames 2026-11-21): a player's own name for a
-- cell, not a cell type. Only that player sees it; it never goes to CAVE or
-- the lab. ids = every ID the cell has had (it follows merges and cuts),
-- anchor_sv = a supervoxel inside it. Read and written only by the server
-- (functions/nicknames.js, through ewSecureWrite).
create table if not exists public.ew_cell_nicknames (
  id bigserial primary key,
  user_id uuid not null,
  seg_id text not null,
  ids text[] not null default '{}',
  anchor_sv text,
  nickname text not null check (char_length(nickname) between 1 and 80),
  dataset text,
  updated_at timestamptz not null default now(),
  unique (user_id, seg_id)
);
create index if not exists ew_cell_nicknames_user on public.ew_cell_nicknames (user_id, updated_at desc);
alter table public.ew_cell_nicknames enable row level security;
revoke all on public.ew_cell_nicknames from public, anon, authenticated;
