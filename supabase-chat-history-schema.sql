-- Chat history for the EyeWire II community chat.
-- The live chat runs over Supabase Realtime broadcast (ephemeral). This table
-- persists messages so the panel can show the recent conversation (last N) with
-- timestamps when a user opens it. Client uses the anon key, so anon may read
-- and insert (same pattern as help_requests / notifications).
--
-- Run once in the Supabase SQL editor for project javthknksdcrlhiaaptj.

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  rank       text not null default 'player',
  text       text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

-- Anyone (anon) can read recent messages and post a message.
drop policy if exists "chat_messages_read" on public.chat_messages;
create policy "chat_messages_read"
  on public.chat_messages for select
  using (true);

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert"
  on public.chat_messages for insert
  with check (true);
