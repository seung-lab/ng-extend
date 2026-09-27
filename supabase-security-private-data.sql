-- Deploy ewCommunityData and its client integration before applying this migration.
-- This changes permissions only; it does not remove application records.
begin;

alter table public.chat_messages add column if not exists user_id uuid references public.users(id);
revoke insert, update, delete on public.chat_messages from public, anon, authenticated;
-- The upload function owns paths and enforces roles, bytes, size and quotas.
drop policy if exists security_upload_insert on storage.objects;
create policy security_upload_insert on storage.objects as restrictive for insert
  to anon, authenticated with check (bucket_id <> 'admin-uploads');
drop policy if exists security_upload_update on storage.objects;
create policy security_upload_update on storage.objects as restrictive for update
  to anon, authenticated using (bucket_id <> 'admin-uploads') with check (bucket_id <> 'admin-uploads');
drop policy if exists security_upload_delete on storage.objects;
create policy security_upload_delete on storage.objects as restrictive for delete
  to anon, authenticated using (bucket_id <> 'admin-uploads');
update storage.buckets set file_size_limit=8388608,
  allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif']
  where id='admin-uploads';
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- No database-authenticated user identity exists yet. Verified backend actions
-- own these operations, including profile identity and group membership.
revoke insert, update, delete on public.users, public.working_links,
  public.notification_reads, public.user_groups, public.user_group_members
  from public, anon, authenticated;
revoke all privileges on public.admins, public.feedback_triage,
  public.notifications, public.site_issues, public.notification_reads
  from public, anon, authenticated;

-- Revoke column grants as well: a former table revoke does not remove those.
do $$
declare t text; col text;
begin
  foreach t in array array['users','working_links','notification_reads','user_groups','user_group_members','admins','feedback_triage','notifications','site_issues'] loop
    for col in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
      execute format('revoke insert (%I), update (%I) on public.%I from public, anon, authenticated', col, col, t);
      if t in ('users','admins','feedback_triage','notifications','site_issues','notification_reads') then
        execute format('revoke select (%I) on public.%I from public, anon, authenticated', col, t);
      end if;
    end loop;
  end loop;
end $$;
revoke select on public.users from public, anon, authenticated;
grant select (id,display_name,flag,bio,total_edits,total_merges,total_splits,
  cells_completed,current_streak,longest_streak,last_edit_date,created_at,
  updated_at,favorite_badge,avatar_json,avatar_thumbnail_url,avatar_coins_spent,
  avatar_updated_at,tutorial_active,tutorial_1_step,tutorial_2_step,tutorial_3_step,
  cave_user_id,username,last_edit_at,last_cave_sync_at) on public.users to anon, authenticated;

-- Existing permissive policies cannot override this restrictive policy.
alter table public.working_links enable row level security;
drop policy if exists security_public_links_only on public.working_links;
create policy security_public_links_only on public.working_links as restrictive
  for select to anon, authenticated using (is_public = true);

-- These are written only by existing service-key jobs.
revoke insert, update, delete on public.cave_edits_mirror,
  public.cave_completions_mirror, public.weekly_winners from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;

-- Expected: false in every column below.
select has_column_privilege('anon','public.users','middleauth_email','SELECT') as email_read,
 has_table_privilege('anon','public.notifications','SELECT') as private_notification_read,
 has_table_privilege('anon','public.feedback_triage','SELECT') as triage_read,
 has_table_privilege('anon','public.users','UPDATE') as profile_write,
 has_table_privilege('anon','public.user_group_members','INSERT') as group_enrollment;
