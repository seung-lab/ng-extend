-- ============================================================================
-- mobile_welcome_ab — copy beta test on the mobile welcome sheet
-- ----------------------------------------------------------------------------
-- WHY
-- The sheet's Citizen Science Mobile Portal section shows one of three
-- social-proof lines above the LOG IN WITH GOOGLE button (Amy 2026-08-24).
-- Each device is assigned a variant at random and keeps it; the sheet logs
-- one 'shown' per browser session and a 'login_tap' per CTA tap, keyed by an
-- anonymous device id. Conversion per variant:
--
--   select variant,
--          count(distinct device_key) filter (where event = 'shown')     as devices_shown,
--          count(distinct device_key) filter (where event = 'login_tap') as devices_tapped
--   from mobile_welcome_ab group by variant;
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

create table if not exists mobile_welcome_ab (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  -- 'mapped-40k' | 'identified-50k' | 'authors' (see MobileWelcome.vue)
  variant     text not null,
  -- 'shown' (once per browser session) | 'login_tap'
  event       text not null,
  -- Anonymous random id minted client-side; joins impressions to taps.
  -- Deliberately NOT a user id — the sheet only shows this copy pre-login.
  device_key  text,
  user_agent  text
);

create index if not exists mobile_welcome_ab_variant_idx on mobile_welcome_ab (variant, event);
create index if not exists mobile_welcome_ab_created_idx on mobile_welcome_ab (created_at desc);

alter table mobile_welcome_ab enable row level security;

-- INSERT-ONLY for the anon key, same posture as client_errors: nothing here
-- is sensitive, but there is no reason for the public key to read it. Read
-- results from the Supabase dashboard (service role), which bypasses RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'mobile_welcome_ab' and policyname = 'mobile_welcome_ab_insert'
  ) then
    create policy mobile_welcome_ab_insert on mobile_welcome_ab
      for insert with check (true);
  end if;
end $$;
