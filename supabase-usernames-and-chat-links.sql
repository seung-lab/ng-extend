-- ============================================================================
-- 1. users.username — unique handle for @mentions and chat display
-- 2. chat_messages.notification_id — makes an announcement open its notification
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

-- ── 1. Usernames ────────────────────────────────────────────────────────────
-- Chat currently shows display names ("Amy S."), which are neither unique nor
-- single-token. That breaks @mentions two ways: with two people called Celia
-- there is no way to tell which one "@celia" meant, and a display name with a
-- space can't be captured as one mention token at all.
--
-- A username is unique, has no spaces, and is therefore unambiguous by
-- construction. Uniqueness is enforced case-insensitively, so "Celia" and
-- "celia" can't both exist and a mention can be matched without guessing case.
alter table if exists users add column if not exists username text;

create unique index if not exists users_username_lower_idx
  on users (lower(username))
  where username is not null;

-- Shape is also enforced client-side; this is the backstop.
-- 3-20 chars, letters/digits/underscore only.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_username_format'
  ) then
    alter table users add constraint users_username_format
      check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');
  end if;
end $$;

-- ── 2. Link chat announcements to their notification ───────────────────────
-- The "📢 <title> — check your notifications for details!" message told people
-- to go looking rather than taking them there. Carrying the id lets the client
-- render it as a clickable announcement that opens that exact notification.
-- NULL for ordinary messages.
alter table if exists chat_messages add column if not exists notification_id bigint;
