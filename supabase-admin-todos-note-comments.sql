-- Comments in the margin of a To do card's notes (Ames 2026-11-15: "make the
-- note function like a google doc with comments", "we have a lot of room in
-- margins"). Each thread holds the words it is on (quote, with a little text
-- before and after to find the right place again), its comment, replies, and
-- whether it is resolved. Written only by functions/todos.js (todo.noteComment).
alter table admin_todos add column if not exists note_comments jsonb not null default '[]'::jsonb;
