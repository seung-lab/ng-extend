-- ============================================================================
-- user_views (2026-09-30): each player's last viewer state per dataset
-- (annotations, layers, camera), autosaved a few seconds after they stop
-- changing things, so work survives closing the tab, switching datasets or
-- changing computers. Offered back as "Pick up where you left off?".
--
-- Private. The public key gets nothing: the app reads and writes this only
-- through the ewCommunityData Cloud Function, scoped to the caller's own rows
-- (functions/community-data.js). One row per player per dataset, replaced on
-- each save. Safe to re-run.
-- ============================================================================

create table if not exists public.user_views (
  user_id    uuid not null references public.users(id) on delete cascade,
  dataset    text not null,
  state      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, dataset)
);

alter table public.user_views enable row level security;
-- No policies on purpose: with RLS on and no policy, anon and authenticated
-- are refused. The server function uses the secret key.
revoke all on public.user_views from anon, authenticated;

-- Check: one row, rls_enabled = true, policies = 0.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'user_views') as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'user_views';
