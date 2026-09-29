-- ============================================================================
-- user_settings (2026-09-29): a player's own app settings, so they follow the
-- account to any computer: toolbar icons and order, chat and help mutes, scout
-- tag dots, and Settings > Switching datasets (starter cells off, own start
-- view per dataset). Flag and bio are not here; they are on users.
--
-- Private. The public key gets nothing. The app reads and writes this only
-- through the ewCommunityData Cloud Function, which verifies the CAVE sign in
-- and scopes every request to the caller's own row (functions/
-- community-data.js). Safe to re-run.
-- ============================================================================

create table if not exists public.user_settings (
  user_id    uuid primary key references public.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
-- No policies on purpose: with RLS on and no policy, anon and authenticated
-- are refused. The server function uses the secret key.
revoke all on public.user_settings from anon, authenticated;

-- Check: should show the table with rls_enabled = true and 0 policies.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'user_settings') as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'user_settings';
