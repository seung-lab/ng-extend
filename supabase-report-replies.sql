-- ============================================================================
-- Report replies (Ames 2026-10-13): an approver can ask the person who filed
-- a report for a reply, from the "Update submitter" form on the triage board.
-- The player answers once, in the notification itself.
--
-- Three nullable columns on notifications:
--   reply_triage_id  the triage card the reply belongs to. Set only on a
--                    notification sent with "Ask for a reply" ticked; every
--                    other notification leaves it empty and looks as before.
--   reply_text       what the player wrote back (text only).
--   replied_at       when. Set once; a second reply is refused.
--
-- The app never writes these directly: the ewReportReply function does, after
-- checking the caller is the submitter of that report (functions/report-reply.js).
-- The browser's key stays read only on this table.
--
-- Run BEFORE ewReportReply is deployed and before the app update goes live.
-- Out of order nothing breaks: until this runs, a send with the box ticked is
-- refused with a message saying so (nothing is sent), and no player sees a
-- reply box. Safe to re-run.
-- ============================================================================

alter table public.notifications
  add column if not exists reply_triage_id uuid references public.feedback_triage(id) on delete set null,
  add column if not exists reply_text text,
  add column if not exists replied_at timestamptz;

-- Check: three rows.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'notifications'
  and column_name in ('reply_triage_id', 'reply_text', 'replied_at')
order by column_name;
