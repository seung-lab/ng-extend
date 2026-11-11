-- Hierarchy on the To do board (Ames 2026-11-11): cards inside cards, and
-- named sections in each column. Read and written only by the server
-- (functions/todos.js, over the service key), like admin_todos itself.

create table if not exists admin_todo_sections (
  id uuid primary key default gen_random_uuid(),
  list text not null check (list in ('todo', 'doing', 'done')),
  name text not null check (char_length(name) between 1 and 60),
  rank double precision not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);
alter table admin_todo_sections enable row level security;

-- A sub card names its parent card. Deleting the parent keeps its sub cards,
-- as ordinary cards. One level only (checked in functions/todos.js).
alter table admin_todos add column if not exists parent_id uuid references admin_todos(id) on delete set null;
-- The section a card sits in, in its column. Removing a section keeps its cards.
alter table admin_todos add column if not exists section_id uuid references admin_todo_sections(id) on delete set null;
create index if not exists admin_todos_parent_idx on admin_todos (parent_id);
