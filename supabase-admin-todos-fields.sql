-- ============================================================================
-- admin_todos: links, a status line and a due date (Ames 2026-10-21)
-- ----------------------------------------------------------------------------
-- All optional. links: [{ "kind": "test" | "live" | "pr" | "doc" | "other",
-- "url": "https://...", "label": "..." }]. status: one short line on where a
-- card stands. due_on: a day, or nothing.
--
-- Run in the Supabase SQL editor. Safe to re-run; it only adds.
-- ============================================================================

alter table admin_todos add column if not exists links  jsonb not null default '[]'::jsonb;
alter table admin_todos add column if not exists status text  not null default '';
alter table admin_todos add column if not exists due_on date;

-- Images on a card (Ames 2026-10-21): [ "https://.../admin-uploads/todo-images/..." ]
alter table admin_todos add column if not exists images jsonb not null default '[]'::jsonb;
