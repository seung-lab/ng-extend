-- Screenshot attached to a "Submit an issue" report (FeedbackModal.vue).
-- Holds the public Supabase Storage URL (admin-uploads/help-screenshots/...)
-- produced by ScreenshotDialog in attach mode, the same flow help requests use.
--
-- Until this runs, FeedbackModal retries the insert without the column and
-- appends the link to the message text instead, so no report is lost.
-- Run once in the Supabase SQL editor.

alter table site_issues add column if not exists screenshot_url text;

-- Make PostgREST see the new column immediately.
notify pgrst, 'reload schema';
