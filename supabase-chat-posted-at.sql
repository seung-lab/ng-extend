-- ============================================================================
-- notifications.chat_posted_at — idempotency marker for scheduled chat posts
-- ----------------------------------------------------------------------------
-- A notification created with "Also post to chat" AND a future send_at should
-- announce itself in chat when it actually sends, not when it was created.
-- That has to be done by exactly one actor: the admin's browser only knows
-- about it at creation time, and every other client polls, so letting clients
-- post would produce one duplicate per connected user.
--
-- scripts/post-due-chat-announcements.mjs handles it on a schedule and stamps
-- this column, so a re-run or an overlapping schedule can never double-post.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

alter table if exists notifications
  add column if not exists chat_posted_at timestamptz;

-- Partial index: the job only ever asks for rows still awaiting a post.
create index if not exists notifications_pending_chat_idx
  on notifications (send_at)
  where post_to_chat and chat_posted_at is null;

-- Backfill: anything already sent is considered handled, so turning this on
-- doesn't suddenly announce a backlog of old notifications in chat.
update notifications
   set chat_posted_at = coalesce(send_at, now())
 where post_to_chat
   and chat_posted_at is null
   and send_at <= now();
