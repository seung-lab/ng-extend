-- ============================================================================
-- Supabase advisor, 2026-10-05: three views were "Security Definer Views".
--
-- A view made the default way reads its tables as the view's OWNER, so it
-- ignores the row and column rules of whoever is asking. The advisor flags
-- that as critical because a view like that can show more than the tables
-- under it would.
--
-- For these three it showed nothing extra, checked with the public key before
-- the change: the public key reads every row and column they use straight
-- from the tables (edit_log 1,272 edit rows, the same number the board's view
-- counted; users 34 of 34; ew_dataset_key callable). So they are switched to
-- read as the caller, and the numbers do not change.
--
-- If edit_log or the public columns of users are ever closed to the public
-- key, the leaderboard reads through these views and would go empty: move
-- its reads behind the server function at the same time.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
ALTER VIEW public.ew_cell_completions   SET (security_invoker = true);
ALTER VIEW public.user_edit_counts      SET (security_invoker = true);
ALTER VIEW public.cave_edits_watermarks SET (security_invoker = true);
