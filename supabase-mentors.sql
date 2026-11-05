-- ============================================================================
-- The mentor program, a proof of concept (Nseraf, triage report 317; Ames
-- 2026-11-04). A new player's first 5 cells get a second look from a mentor
-- before they count. Rules: functions/mentors.js. Server: the ewMentor Cloud
-- Function, with the service role. Nothing here is readable with the public
-- key (RLS on, no policy), like supabase-teams.sql.
--
-- Credit is not stored here: a mentor's Complete writes the apprentice's
-- complete_task row to edit_log, which ew_cell_completions counts as usual.
--
-- Safe to re-run.
-- ============================================================================

-- Mentors, picked by an admin for now (Nseraf, annkri, kk, azurejay, ...).
create table if not exists public.ew_mentors (
  user_id     uuid primary key references public.users(id) on delete cascade,
  user_name   text not null default '',
  active      boolean not null default true,
  added_by    uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One row per apprentice. mentor_id is set by the first mentor to take one of
-- their cells, and cleared when that mentor hands them back.
create table if not exists public.ew_apprentices (
  user_id      uuid primary key references public.users(id) on delete cascade,
  user_name    text not null default '',
  mentor_id    uuid references public.users(id) on delete set null,
  mentor_name  text,
  status       text not null default 'active' check (status in ('active', 'finished', 'left')),
  cells_needed integer not null default 5 check (cells_needed between 1 and 50),
  cells_done   integer not null default 0,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  added_by     uuid references public.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index if not exists ew_apprentices_mentor_idx on public.ew_apprentices (mentor_id);

-- One row per cell an apprentice sends. waiting: no mentor has opened it.
-- looking: a mentor has it. suggestions: back with the apprentice, with notes.
-- complete: the mentor completed it and it counted for the apprentice.
create table if not exists public.ew_mentor_reviews (
  id              bigint generated always as identity primary key,
  apprentice_id   uuid not null references public.users(id) on delete cascade,
  apprentice_name text not null default '',
  mentor_id       uuid references public.users(id) on delete set null,
  mentor_name     text,
  state           text not null default 'waiting' check (state in ('waiting', 'looking', 'suggestions', 'complete')),
  rounds          integer not null default 1,
  dataset         text not null check (length(dataset) <= 80),
  log_dataset     text check (log_dataset is null or length(log_dataset) <= 100),
  task_id         integer not null,
  segment_id      text,
  root_id         text,
  position        jsonb,
  link            text check (link is null or length(link) <= 2000),
  -- What the apprentice's Complete form said: {status, notes, cellType, coords}.
  done            jsonb not null default '{}'::jsonb,
  -- The mentor's notes in the view: [{id, position: [x,y,z], text}].
  notes           jsonb not null default '[]'::jsonb,
  cell_note       text check (cell_note is null or length(cell_note) <= 2000),
  sheet_done      boolean not null default false,
  sent_at         timestamptz not null default now(),
  claimed_at      timestamptz,
  decided_at      timestamptz,
  touched_at      timestamptz not null default now()
);
create index if not exists ew_mentor_reviews_open_idx on public.ew_mentor_reviews (state, sent_at) where state in ('waiting', 'looking', 'suggestions');
create index if not exists ew_mentor_reviews_apprentice_idx on public.ew_mentor_reviews (apprentice_id, sent_at desc);
-- One open review per claimed cell.
create unique index if not exists ew_mentor_reviews_task_open_idx on public.ew_mentor_reviews (task_id) where state in ('waiting', 'looking', 'suggestions');

alter table public.ew_mentors        enable row level security;
alter table public.ew_apprentices    enable row level security;
alter table public.ew_mentor_reviews enable row level security;
revoke all on public.ew_mentors, public.ew_apprentices, public.ew_mentor_reviews from anon, authenticated;
grant all on public.ew_mentors, public.ew_apprentices, public.ew_mentor_reviews to service_role;

-- Run 2026-11-04 with Nseraf, Annkri, azurejay and KrzysztofKruk added as
-- mentors (Ames). Admins mentor too, without a row here.
--
-- No mentors are added here: a test site shares the live data, and a new
-- apprentice's first cell rings every mentor. Add them in the Admin Hub
-- (Access, Mentor program) once real players should hear about it; for
-- the old guard (Nseraf, annkri, kk, azurejay) when the program goes live:
-- insert into public.ew_mentors (user_id, user_name)
-- select id, username from public.users where lower(username) in ('nseraf', 'annkri', 'azurejay', 'krzysztofkruk')
-- on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
