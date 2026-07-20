-- ============================================================================
-- 1. chat_messages.dataset — which segmentation a shared #SegID belongs to
-- 2. notification_reads.dismissed — per-user, persistent notification dismissal
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

-- ── 1. Chat: record the sender's dataset ────────────────────────────────────
-- Root IDs are only meaningful inside ONE segmentation. Sharing "#720575..."
-- in chat was previously dataset-blind, so clicking it loaded that id into
-- whatever dataset the reader happened to have open — a different cell, or
-- nothing at all. Stamping the sender's dataset lets the client show it and
-- offer to switch instead of silently jumping somewhere wrong.
-- NULL means "sent before we recorded this" — the client warns rather than
-- assuming it matches.
alter table if exists chat_messages add column if not exists dataset text;

-- ── 2. Notifications: persistent, per-user read + dismissed state ───────────
-- Dismissal used to live in browser localStorage and hid a notification
-- FOREVER, per-browser, with no undo — one stray click on the × (which sits
-- next to the admin 🗑) wiped it from that user's feed permanently.
--
-- Moving dismissal into notification_reads makes it:
--   * per USER rather than per browser (follows you between machines)
--   * explicit and inspectable rather than invisible client state
--   * separable from "read" — you can mark all read without deleting, or
--     delete all without having read them.
alter table if exists notification_reads
  add column if not exists dismissed boolean not null default false;
alter table if exists notification_reads
  add column if not exists dismissed_at timestamptz;

create index if not exists notification_reads_user_dismissed_idx
  on notification_reads (user_id, dismissed);

-- Existing rows are "read but not dismissed", which is what the default gives
-- us, so no backfill is required.
