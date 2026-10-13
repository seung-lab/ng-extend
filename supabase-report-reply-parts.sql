-- ============================================================================
-- Report replies carry what a report carries (Ames 2026-10-13): a screenshot,
-- the player's view, and their recent console messages, beside the text.
-- Run AFTER supabase-report-replies.sql. Safe to run more than once.
--
-- notifications is readable with the game's public key, like the reply text
-- already on it. A screenshot link and a view link are fine there: the first
-- is a public picture, the second opens only for someone signed in to CAVE.
-- Console messages are not: they stay in a table of their own that only the
-- server reads, and it hands them to admins alone (ewReportReply, action
-- reply.console), the same way a report's console messages are kept.
--
-- Out of order nothing breaks: until this runs, a reply is saved as text only
-- and the player is told the attachments were not kept.
-- ============================================================================

alter table public.notifications
  add column if not exists reply_screenshot_url text,
  add column if not exists reply_view_url text,
  add column if not exists reply_dataset text,
  add column if not exists reply_build text;

alter table public.notifications drop constraint if exists notifications_reply_view_https;
alter table public.notifications add constraint notifications_reply_view_https
  check (reply_view_url is null or (reply_view_url ~ '^https://[^[:space:]"''<>]+$' and length(reply_view_url) <= 2000));

create table if not exists public.report_reply_console (
  notification_id bigint primary key references public.notifications(id) on delete cascade,
  console_log     text not null,
  created_at      timestamptz not null default now()
);
alter table public.report_reply_console enable row level security;
revoke all on public.report_reply_console from anon, authenticated;

-- Check: four column rows, then the private table with its row count.
select column_name as name, data_type as detail from information_schema.columns
where table_schema = 'public' and table_name = 'notifications'
  and column_name in ('reply_screenshot_url', 'reply_view_url', 'reply_dataset', 'reply_build')
union all
select 'report_reply_console', count(*)::text || ' rows' from public.report_reply_console
order by name;
