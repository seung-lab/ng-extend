-- ============================================================================
-- client_errors — runtime error reporting from the browser
-- ----------------------------------------------------------------------------
-- WHY
-- .vue files get no type checking (tsc skips SFCs, esbuild transpiles without
-- checking bindings), so a ReferenceError in a <script setup> block can and did
-- ship to production and break chat completely. It was found by a person
-- noticing, not by any alarm. Runtime reporting is the compensating control.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

create table if not exists client_errors (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  message     text not null,
  stack       text,
  -- 'vue' (component render/lifecycle), 'window' (uncaught), 'promise'
  -- (unhandled rejection). Vue matters most: Vue catches render errors itself,
  -- so window.onerror never sees them — which is exactly the class that broke
  -- chat.
  source      text,
  component   text,
  -- Pathname only. The URL hash carries the entire neuroglancer viewer state
  -- and is multiple KB, so storing it would bloat every row for no benefit.
  url         text,
  dataset     text,
  user_id     uuid references users(id) on delete set null,
  user_agent  text,
  build       text
);

create index if not exists client_errors_created_idx on client_errors (created_at desc);
create index if not exists client_errors_message_idx on client_errors (message);

alter table client_errors enable row level security;

-- INSERT-ONLY for the anon key, deliberately NOT the blanket permissive policy
-- used elsewhere in this project. Stack traces and user ids shouldn't be
-- readable by anyone holding the public key. Read them from the Supabase
-- dashboard (service role), which bypasses RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'client_errors' and policyname = 'client_errors_insert'
  ) then
    create policy client_errors_insert on client_errors
      for insert with check (true);
  end if;
end $$;
