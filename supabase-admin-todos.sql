-- ============================================================================
-- admin_todos: the admins' own To do board (Ames 2026-10-19)
-- ----------------------------------------------------------------------------
-- A planning board for the admins, apart from player reports: lists To do,
-- Doing and Done, cards with notes, a checklist, a size, an owner, comments
-- and @ tags. Read and written only by the ewSecureWrite function (service
-- key) after it has checked the caller is an admin. Nobody else can see it.
--
-- A card made from a player report keeps that report's id in triage_id.
--
-- Also moves what was on the triage board's To do column (2026-10-19, earlier
-- today) onto this board: To dos typed in on the triage board become cards
-- here and leave feedback_triage; reports put on To do get a linked card.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

begin;

create table if not exists admin_todos (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null check (char_length(title) between 1 and 200),
  notes       text        not null default '' check (char_length(notes) <= 8000),
  list        text        not null default 'todo' check (list in ('todo', 'doing', 'done')),
  rank        double precision not null default 0,
  size        text        check (size is null or size in ('S', 'M', 'L')),
  owner_id    uuid,
  -- [{ "text": "...", "done": false }]
  checklist   jsonb       not null default '[]'::jsonb,
  -- [{ "by": "Ames", "text": "...", "at": "2026-10-19T..." }]
  comments    jsonb       not null default '[]'::jsonb,
  triage_id   uuid        references feedback_triage (id) on delete set null,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists admin_todos_list_idx on admin_todos (list, rank);
create unique index if not exists admin_todos_triage_idx on admin_todos (triage_id) where triage_id is not null;

-- No policies: the anon and signed in keys cannot read or write it at all.
alter table admin_todos enable row level security;

-- To dos typed in on the triage board: copied here, then removed there.
insert into admin_todos (title, notes, size, rank, created_by, created_at)
select left(split_part(coalesce(source_excerpt, 'To do'), E'\n', 1), 200),
       left(trim(substr(coalesce(source_excerpt, ''), char_length(split_part(coalesce(source_excerpt, ''), E'\n', 1)) + 1)), 8000),
       todo_size, coalesce(todo_rank, 0), reviewed_by, created_at
from feedback_triage
where source = 'todo'
  and status <> 'dismissed';
delete from feedback_triage where source = 'todo';

-- Reports on the To do list: a linked card each (once).
insert into admin_todos (title, size, rank, triage_id, created_by, created_at)
select left(split_part(coalesce(nullif(trim(source_excerpt), ''), 'Report'), E'\n', 1), 200),
       todo_size, coalesce(todo_rank, 0), id, reviewed_by, coalesce(reviewed_at, created_at)
from feedback_triage
where status = 'approved' and impl_state is null and approver_note like 'To do%'
on conflict do nothing;

commit;
