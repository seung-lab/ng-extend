-- EyeWire II: saved teams (Ames 2026-10-07).
--
-- A team is two to four players working on one cell, whenever each of them
-- can. It belongs to the game, not to CAVE: CAVE keeps every edit under the
-- player who made it, and the game credits every member when the cell is
-- completed.
--
-- These tables are private. Row level security is on and there is no policy,
-- so the public key the game ships cannot read or write them at all. Only the
-- server function (ewSecureWrite, actions "team.*") touches them, and it
-- hands a player only the teams they are on, the invitations sent to them,
-- and teams that are open to join. That is what keeps an invitation between
-- the two people it concerns.
--
-- Safe to run more than once.

create table if not exists public.ew_teams (
  id            uuid primary key default gen_random_uuid(),
  dataset       text not null,
  task_id       bigint,                      -- the claim this team is on, when there is one
  segment_id    text,                        -- the cell's ID when the team was made (it changes with edits)
  anchor        jsonb,                       -- [x, y, z]: a point inside the cell, which does not change
  title         text not null default '',
  owner_id      uuid not null references public.users(id),
  is_open       boolean not null default false,   -- "looking for teammates"
  status        text not null default 'active' check (status in ('active', 'completed', 'closed')),
  completed_by  uuid references public.users(id),
  completed_at  timestamptz,
  completed_root text,
  created_at    timestamptz not null default now()
);
create index if not exists ew_teams_status_idx on public.ew_teams (status, is_open);
create index if not exists ew_teams_task_idx on public.ew_teams (task_id) where task_id is not null;

create table if not exists public.ew_team_members (
  team_id     uuid not null references public.ew_teams(id) on delete cascade,
  user_id     uuid not null references public.users(id),
  user_name   text not null default '',
  -- invited: asked by a member, has not answered. requested: asked to join an open team.
  state       text not null check (state in ('invited', 'requested', 'joined')),
  part_done   boolean not null default false,     -- "my part is done"
  celebrate   boolean not null default false,     -- the team completed the cell and this member has not seen it yet
  invited_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists ew_team_members_user_idx on public.ew_team_members (user_id);

-- The marks a team has drawn: one row per team, every annotation layer in it.
-- { "layers": { "<layer name>": { "spec": {...}, "anns": { "<id>": {...} } } } }
create table if not exists public.ew_team_marks (
  team_id     uuid primary key references public.ew_teams(id) on delete cascade,
  doc         jsonb not null default '{"layers":{}}'::jsonb,
  updated_by  uuid references public.users(id),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ew_team_messages (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.ew_teams(id) on delete cascade,
  user_id     uuid not null references public.users(id),
  user_name   text not null default '',
  body        text not null check (char_length(body) between 1 and 240),
  created_at  timestamptz not null default now()
);
create index if not exists ew_team_messages_team_idx on public.ew_team_messages (team_id, id);

alter table public.ew_teams          enable row level security;
alter table public.ew_team_members   enable row level security;
alter table public.ew_team_marks     enable row level security;
alter table public.ew_team_messages  enable row level security;

revoke all on public.ew_teams, public.ew_team_members, public.ew_team_marks, public.ew_team_messages from anon, authenticated;

select 'ew_teams' as table_name, count(*) as rows from public.ew_teams
union all select 'ew_team_members', count(*) from public.ew_team_members
union all select 'ew_team_marks', count(*) from public.ew_team_marks
union all select 'ew_team_messages', count(*) from public.ew_team_messages;
