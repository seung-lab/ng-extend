-- ============================================================================
-- Site texts (2026-10-20): instructions the lab edits in the game, without a
-- deploy (Celia: "an admin-only edit option for instructions ... similar to
-- how you'd edit a blog post or Notification").
--
-- One row per text, by key ('quest.retina_cilia.steps', 'howto.retina', ...).
-- A key with no row shows the text written in the code, so nothing changes
-- until an admin saves. Deleting a row puts the code's text back.
--
-- Reads and writes go through the ewCommunityData Cloud Function
-- (functions/community-data.js): anyone reads, admins write. The public key
-- has no access here.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.site_texts (
  key             text primary key check (key ~ '^[a-z0-9_.-]{1,64}$'),
  body            text not null check (length(body) <= 20000),
  updated_by      uuid references public.users(id) on delete set null,
  updated_by_name text,
  updated_at      timestamptz not null default now()
);

alter table public.site_texts enable row level security;
revoke all on public.site_texts from anon, authenticated;
