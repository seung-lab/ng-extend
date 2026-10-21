-- ============================================================================
-- admin_todo_keys: each admin's private connector address for the To do board
-- (Ames 2026-10-20: "let's add a connector")
-- ----------------------------------------------------------------------------
-- "Connect your AI" on the To do board makes an address with a secret key in
-- it; the admin pastes it into Claude (or ChatGPT) as a custom connector. Only
-- a SHA-256 of the key is kept here. Making a new address switches the old
-- one off. Read and written only by the server functions (service key).
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create table if not exists admin_todo_keys (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null,
  key_hash     text        not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists admin_todo_keys_user_idx on admin_todo_keys (user_id);

-- No policies: the anon and signed in keys cannot read or write it at all.
alter table admin_todo_keys enable row level security;
