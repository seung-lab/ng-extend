-- ============================================================================
-- Chat presence (join / leave notices, "N online") and saved-link screenshots
-- (Amy 2026-09-28). Pairs with the ewCommunityData gateway change in
-- philogelos/functions/community-data.js. Run this BEFORE deploying that
-- gateway. Safe to re-run.
--
-- Security model (see docs/SECURITY-REMEDIATION.md): the browser never writes
-- these rows directly. The gateway upserts chat_presence with user_id, name
-- and last_seen_at taken from the verified CAVE identity; anon/authenticated
-- roles may only READ (usernames are already public in chat). joined_at is
-- set here, by trigger, so a join notice cannot be forged by a client.
-- ============================================================================

create table if not exists chat_presence (
  user_id      uuid primary key references users(id) on delete cascade,
  name         text not null,
  last_seen_at timestamptz not null default now(),
  joined_at    timestamptz not null default now()
);

-- A (re)join is a first heartbeat, or one after 2+ minutes of silence.
-- Routine heartbeats keep the old joined_at, so they never announce.
create or replace function chat_presence_stamp_join() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or old.last_seen_at < now() - interval '2 minutes' then
    new.joined_at := now();
  else
    new.joined_at := old.joined_at;
  end if;
  return new;
end $$;

drop trigger if exists chat_presence_stamp_join on chat_presence;
create trigger chat_presence_stamp_join
  before insert or update on chat_presence
  for each row execute function chat_presence_stamp_join();

alter table chat_presence enable row level security;
drop policy if exists "chat presence is readable" on chat_presence;
create policy "chat presence is readable" on chat_presence for select using (true);
grant select on chat_presence to anon, authenticated;
revoke insert, update, delete on chat_presence from anon, authenticated;

-- Live join/leave: publish changes, with full old rows so a leave carries the name.
alter table chat_presence replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_presence') then
    alter publication supabase_realtime add table chat_presence;
  end if;
end $$;

-- Saved-link screenshots (gateway only accepts our own public storage URLs).
alter table working_links add column if not exists screenshot_url text;

-- Make PostgREST see the new table and column immediately.
notify pgrst, 'reload schema';
