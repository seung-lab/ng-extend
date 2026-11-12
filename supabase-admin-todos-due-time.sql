-- A time on a To do card's due day (Ames 2026-11-12: "add time"): "HH:MM",
-- read in the viewer's own time zone. Checked in functions/todos.js.
alter table admin_todos add column if not exists due_time text check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
