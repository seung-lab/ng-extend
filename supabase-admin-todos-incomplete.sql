-- Cards closed as not finished (Ames 2026-11-12): list 'incomplete', off the
-- board, kept for Ames. Only she moves a card in or out (functions/todos.js).
alter table admin_todos drop constraint if exists admin_todos_list_check;
alter table admin_todos add constraint admin_todos_list_check check (list in ('todo', 'doing', 'done', 'incomplete'));
