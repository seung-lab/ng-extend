-- ============================================================================
-- Leaderboard "Cells": count completions from the app's own log (Ames
-- 2026-10-01), instead of the CAVE mirror.
--
-- Why. cave_completions_mirror only fills when CAVE publishes a new
-- materialized version (about every other day), so a completed cell could
-- take two days to reach the board (Annkri's cell of 2026-10-01 09:09 UTC was
-- missing), and datasets whose completions can't be written to CAVE yet (MEC)
-- never reached it. edit_log is written by the server the moment a cell is
-- completed, on every dataset. Checked against live data on 2026-10-01: for
-- every player the log gives the same 7-day count as the mirror (2, 5, 2, 7),
-- plus the cell the mirror had not caught up on.
--
-- Counting rule. A completion logs 'mark_complete' and/or 'complete_task'
-- within seconds of each other, carrying the cell's root id as
-- metadata.root_id / metadata.final_segment_id. One cell = one distinct id per
-- player. A row with no id counts only if no id-carrying completion by the
-- same player sits within two minutes of it (it is then its own cell, keyed
-- by the minute). Failed operations (success = false) never count. A cell
-- whose newest event is 'unmark_complete' (marked, then un-marked) does not
-- count; marked again later, it counts from that later time. Every dataset
-- counts, MEC included (its completions are logged as 'mark_complete').
--
-- Also adds edit_log to the realtime publication, for the chat ticker
-- ("amy completed a cell").
--
-- This is the LIVE definition (supabase-leaderboard-windows-schema.sql: edits
-- from edit_log) with only the two completions columns changed. All-time
-- stays on users.cells_completed. Same columns, same order.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE VIEW user_edit_counts AS
SELECT
  u.id              AS id,
  u.display_name    AS display_name,
  u.flag            AS flag,
  u.bio             AS bio,
  u.total_edits     AS total_edits,
  u.total_merges    AS total_merges,
  u.total_splits    AS total_splits,
  u.cells_completed AS cells_completed,
  u.current_streak  AS current_streak,
  u.longest_streak  AS longest_streak,
  -- Edits (split + merge events, attributed via edit_log.user_id -> users.id).
  COALESCE(e24.cnt, 0)::INTEGER AS edits_24h,
  COALESCE(e7d.cnt, 0)::INTEGER AS edits_week,
  COALESCE(u.total_edits, 0)::INTEGER AS edits_alltime,
  -- Completions: distinct cells from edit_log (see the counting rule above).
  COALESCE(c.c24, 0)::INTEGER AS completions_24h,
  COALESCE(c.c7d, 0)::INTEGER AS completions_week,
  COALESCE(u.cells_completed, 0)::INTEGER AS completions_alltime
FROM users u
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM edit_log
  WHERE user_id = u.id
    AND timestamp >= NOW() - INTERVAL '24 hours'
    AND operation IN ('split', 'merge')
) e24 ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM edit_log
  WHERE user_id = u.id
    AND timestamp >= NOW() - INTERVAL '7 days'
    AND operation IN ('split', 'merge')
) e7d ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE done_at >= NOW() - INTERVAL '24 hours') AS c24,
    COUNT(*) FILTER (WHERE done_at >= NOW() - INTERVAL '7 days') AS c7d
  FROM (
    -- when it was completed: the first completion, or, if it was un-marked
    -- at some point, the first completion after the last un-mark
    SELECT cell, MIN(ts) FILTER (WHERE last_unmark IS NULL OR ts > last_unmark) AS done_at
    FROM (
      SELECT x.ts, x.cell,
        (SELECT MAX(n.timestamp) FROM edit_log n
         WHERE n.user_id = u.id AND n.operation = 'unmark_complete'
           AND n.success IS NOT FALSE AND n.metadata->>'root_id' = x.cell) AS last_unmark
      FROM (
        SELECT
          l.timestamp AS ts,
          COALESCE(
            l.metadata->>'final_segment_id',
            l.metadata->>'root_id',
            l.metadata->>'segment_id',
            CASE WHEN EXISTS (
              SELECT 1 FROM edit_log d
              WHERE d.user_id = l.user_id
                AND d.operation IN ('complete_task', 'mark_complete')
                AND d.success IS NOT FALSE
                AND COALESCE(d.metadata->>'final_segment_id', d.metadata->>'root_id', d.metadata->>'segment_id') IS NOT NULL
                AND d.timestamp BETWEEN l.timestamp - INTERVAL '2 minutes' AND l.timestamp + INTERVAL '2 minutes'
            ) THEN NULL
            ELSE 'at:' || to_char(date_trunc('minute', l.timestamp), 'YYYYMMDDHH24MI') END
          ) AS cell
        FROM edit_log l
        WHERE l.user_id = u.id
          AND l.operation IN ('complete_task', 'mark_complete')
          AND l.success IS NOT FALSE
          AND l.timestamp >= NOW() - INTERVAL '7 days'
      ) x
      WHERE x.cell IS NOT NULL
    ) z
    GROUP BY cell
  ) y
  WHERE done_at IS NOT NULL
) c ON true;

-- Chat ticker: let the app hear completions as they are logged.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'edit_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE edit_log;
  END IF;
END $$;
