-- ============================================================================
-- Chat reactions (Ames 2026-09-28): 👍 ❤️ 🔥 😂 🎉 🧠 on chat messages.
-- Pairs with the chat_reactions policy in functions/community-data.js.
-- Run this BEFORE deploying that gateway. Safe to re-run.
--
-- Security model (see docs/SECURITY-REMEDIATION.md): the browser never writes
-- these rows directly. The gateway inserts with user_id and name taken from
-- the verified identity, accepts only the six emoji above, and lets you
-- delete only your own reactions. anon/authenticated may only READ.
-- ============================================================================

create table if not exists chat_reactions (
  id          bigserial primary key,
  message_id  uuid not null references chat_messages(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists chat_reactions_message_idx on chat_reactions (message_id);

alter table chat_reactions enable row level security;
drop policy if exists "chat reactions are readable" on chat_reactions;
create policy "chat reactions are readable" on chat_reactions for select using (true);
grant select on chat_reactions to anon, authenticated;
revoke insert, update, delete on chat_reactions from anon, authenticated;

-- Live updates, with full old rows so a removed reaction says which one.
alter table chat_reactions replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions') then
    alter publication supabase_realtime add table chat_reactions;
  end if;
end $$;

notify pgrst, 'reload schema';
