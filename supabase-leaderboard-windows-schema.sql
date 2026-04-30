-- EyeWire II — Time-windowed leaderboard + weekly-winners tracking
-- Apply in Supabase Dashboard > SQL Editor.

-- ═══════════════════════════════════════════════════════════════════
-- 1. View: user_edit_counts
-- ═══════════════════════════════════════════════════════════════════
-- Provides edits_24h, edits_week, edits_alltime per user, derived from
-- the edit_log table. The leaderboard panel reads from this view so its
-- "24h", "Week", and "All Time" tabs return distinct numbers.
--
-- LATERAL joins keep it cheap — Postgres only scans edit_log rows for
-- each user once per timeframe.

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
  -- Edits (split + merge events)
  COALESCE(e24.cnt, 0)::INTEGER AS edits_24h,
  COALESCE(e7d.cnt, 0)::INTEGER AS edits_week,
  COALESCE(u.total_edits, 0)::INTEGER AS edits_alltime,
  -- Completions (mark_complete events from edit_log).
  -- PHASE B: replace with CAVE-direct query once `users.cave_user_id`
  -- mapping is populated at middleauth login. CAVE is the source of
  -- truth for completions; edit_log misses Spelunker / direct API calls.
  COALESCE(c24.cnt, 0)::INTEGER AS completions_24h,
  COALESCE(c7d.cnt, 0)::INTEGER AS completions_week,
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
  SELECT COUNT(*) AS cnt
  FROM edit_log
  WHERE user_id = u.id
    AND timestamp >= NOW() - INTERVAL '24 hours'
    AND operation = 'mark_complete'
) c24 ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM edit_log
  WHERE user_id = u.id
    AND timestamp >= NOW() - INTERVAL '7 days'
    AND operation = 'mark_complete'
) c7d ON true;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Table: weekly_winners
-- ═══════════════════════════════════════════════════════════════════
-- One row per (week, podium-rank). Populated by a weekly cron job that
-- snapshots the top-3 from edits_week each Monday 00:00 UTC. The user
-- profile then shows e.g. "🥇 × 3   🥈 × 1   🥉 × 2".

CREATE TABLE IF NOT EXISTS weekly_winners (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   DATE    NOT NULL,                 -- Monday of the week
  rank         INTEGER NOT NULL CHECK (rank IN (1, 2, 3)),
  user_id      UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edits        INTEGER NOT NULL,                 -- edits in that week
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start, rank)
);

CREATE INDEX IF NOT EXISTS weekly_winners_user_idx ON weekly_winners (user_id, rank);
CREATE INDEX IF NOT EXISTS weekly_winners_week_idx ON weekly_winners (week_start DESC);

ALTER TABLE weekly_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_weekly_winners"   ON weekly_winners FOR SELECT USING (true);
CREATE POLICY "insert_weekly_winners" ON weekly_winners FOR INSERT WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- 3. Helper: snapshot_weekly_winners()
-- ═══════════════════════════════════════════════════════════════════
-- Idempotent. Computes the top-3 by edits in the past week and inserts
-- their rows. Safe to call multiple times for the same week — the
-- UNIQUE (week_start, rank) constraint prevents duplicates.

CREATE OR REPLACE FUNCTION snapshot_weekly_winners(target_week_start DATE DEFAULT NULL)
RETURNS TABLE (rank INTEGER, user_id UUID, edits INTEGER) AS $$
#variable_conflict use_column
DECLARE
  ws DATE;
BEGIN
  -- Default: last completed Monday-to-Sunday week.
  ws := COALESCE(target_week_start, (DATE_TRUNC('week', NOW() - INTERVAL '7 days'))::DATE);

  RETURN QUERY
  WITH ranked AS (
    SELECT
      el.user_id,
      COUNT(*)::INTEGER AS edits,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rk
    FROM edit_log el
    WHERE el.timestamp >= ws
      AND el.timestamp <  ws + INTERVAL '7 days'
      AND el.operation IN ('split', 'merge')
      AND el.user_id IS NOT NULL
    GROUP BY el.user_id
  ),
  inserted AS (
    INSERT INTO weekly_winners (week_start, rank, user_id, edits)
    SELECT ws, rk::INTEGER, ranked.user_id, ranked.edits
    FROM ranked
    WHERE rk <= 3
    ON CONFLICT (week_start, rank) DO NOTHING
    RETURNING weekly_winners.rank, weekly_winners.user_id, weekly_winners.edits
  )
  SELECT inserted.rank, inserted.user_id, inserted.edits FROM inserted;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Schedule: pg_cron weekly snapshot (optional — also doable via
--    GitHub Actions cron in scripts/weekly-recap.mjs).
-- ═══════════════════════════════════════════════════════════════════
-- If pg_cron is enabled in your project, uncomment to schedule the
-- snapshot for every Monday at 00:05 UTC.

-- SELECT cron.schedule(
--   'weekly-winners-snapshot',
--   '5 0 * * 1',
--   $$ SELECT snapshot_weekly_winners(); $$
-- );
