-- ============================================================================
-- Lockdown (2026-09-26): the public anon key may only READ notifications,
-- feedback_triage and admins.
--
-- Before this, every table here had a "FOR ALL USING (true)" policy, so anyone
-- with the anon key (it ships in the app bundle) could send a notification to
-- every user, edit or approve triage rows (which drive the code-writing
-- robot), or add themselves to admins.
--
-- After this:
--   * The app writes through the ewSecureWrite Cloud Function, which verifies
--     the caller's CAVE sign in and, for admin actions, the admins table.
--   * GitHub Actions and scripts use the service role key, which bypasses RLS,
--     so the triage robot, weekly recap and announcements keep working.
--   * Reads are unchanged (the app still lists notifications and triage).
--
-- Run ONLY after the app version that uses ewSecureWrite is live, or admin
-- actions in the old app will fail. Safe to re-run.
-- ============================================================================

do $$
declare pol record;
begin
  for pol in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('notifications', 'feedback_triage', 'admins')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table public.notifications   enable row level security;
alter table public.feedback_triage enable row level security;
alter table public.admins          enable row level security;

create policy notifications_read   on public.notifications   for select using (true);
create policy feedback_triage_read on public.feedback_triage for select using (true);
create policy admins_read          on public.admins          for select using (true);

-- Belt and braces: the anon and authenticated roles lose write grants too,
-- so a policy added by mistake later still cannot open writes.
revoke insert, update, delete on public.notifications   from anon, authenticated;
revoke insert, update, delete on public.feedback_triage from anon, authenticated;
revoke insert, update, delete on public.admins          from anon, authenticated;

-- Check: every row below should be a SELECT policy.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('notifications', 'feedback_triage', 'admins')
order by tablename;
