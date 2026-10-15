-- The leaderboard in one read (2026-10-15).
--
-- The board shows six rankings (Edits or Cells, over 24 hours, 7 days or all
-- time), the top 50 of each. The client read all six separately, 16 columns
-- each, every minute in every tab with the board open: most of Pyr's Supabase
-- egress. This view returns the union of the six top 50s, so the client reads
-- it once with the ten columns it draws. The six rankings overlap heavily,
-- so it is usually 80 to 150 rows.
--
-- Run in the Supabase SQL editor. The client falls back to the six selects
-- while this view is missing, so it can be installed before or after the
-- deploy that reads it. Ties break by id, as the client's selects did.

CREATE OR REPLACE VIEW leaderboard_board AS
WITH ranked AS (
  SELECT u.*,
         row_number() OVER (ORDER BY u.edits_alltime       DESC NULLS LAST, u.id) AS r_edits_alltime,
         row_number() OVER (ORDER BY u.edits_week          DESC NULLS LAST, u.id) AS r_edits_week,
         row_number() OVER (ORDER BY u.edits_24h           DESC NULLS LAST, u.id) AS r_edits_24h,
         row_number() OVER (ORDER BY u.completions_alltime DESC NULLS LAST, u.id) AS r_completions_alltime,
         row_number() OVER (ORDER BY u.completions_week    DESC NULLS LAST, u.id) AS r_completions_week,
         row_number() OVER (ORDER BY u.completions_24h     DESC NULLS LAST, u.id) AS r_completions_24h
  FROM user_edit_counts u
)
SELECT id, display_name, flag, bio,
       total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak,
       edits_24h, edits_week, edits_alltime, completions_24h, completions_week, completions_alltime
FROM ranked
WHERE r_edits_alltime <= 50 OR r_edits_week <= 50 OR r_edits_24h <= 50
   OR r_completions_alltime <= 50 OR r_completions_week <= 50 OR r_completions_24h <= 50;

GRANT SELECT ON leaderboard_board TO anon, authenticated;

-- Check: how many rows the board reads now, and that every ranking's 50th is in it.
-- SELECT count(*) FROM leaderboard_board;
