-- EyeWire II — Time-windowed leaderboard + weekly-winners tracking
-- Apply in Supabase Dashboard > SQL Editor.
--
-- Before applying this, make sure supabase-cave-user-id-schema.sql has
-- already been run — that adds users.cave_user_id and creates the
-- cave_completions_mirror table that this view references.

-- ═══════════════════════════════════════════════════════════════════
-- 1. View: user_edit_counts
-- ═══════════════════════════════════════════════════════════════════
-- Provides edits_24h, edits_week, edits_alltime AND completions_24h,
-- completions_week, completions_alltime per user. The leaderboard's
-- metric toggle (Edits / Cells) reads from this single view.
--
-- Edits come from the `edit_log` table (split + merge events).
-- Completions come from `cave_completions_mirror` — a 30-min-synced
-- snapshot of CAVE's cell_status_v2 tables. CAVE is the source of
-- truth for cell completions (Spelunker, the lightbulb panel, batch
-- processor, and any third-party CAVE writer all converge there), so
-- the mirror reflects every completion regardless of which tool made
-- it. The mirror is keyed on the writer's cave_user_id which we
-- captured at middleauth login (users.cave_user_id).

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
  -- Edits (split + merge events, attributed via edit_log.user_id → users.id).
  COALESCE(e24.cnt, 0)::INTEGER AS edits_24h,
  COALESCE(e7d.cnt, 0)::INTEGER AS edits_week,
  COALESCE(u.total_edits, 0)::INTEGER AS edits_alltime,
  -- Completions — CAVE-direct via cave_completions_mirror, keyed on
  -- users.cave_user_id. Users who haven't logged in since cave_user_id
  -- shipped will show 0 here until they next authenticate; that's
  -- intentional (we can't ask the browser localStorage on their
  -- behalf — see scripts/backfill-cave-user-ids.mjs for the rare
  -- offline-mapping case).
  COALESCE(c24.cnt, 0)::INTEGER AS completions_24h,
  COALESCE(c7d.cnt, 0)::INTEGER AS completions_week,
  -- All-time stays denormalized on users.cells_completed for now —
  -- the mirror only contains rows for current cave_user_ids and
  -- gets reseeded on every sync, so a COUNT against it would return
  -- the same number anyway. Keeping the existing column avoids an
  -- extra LATERAL scan on every leaderboard render.
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
  FROM cave_completions_mirror m
  WHERE m.cave_user_id = u.cave_user_id
    AND m.completed_at >= NOW() - INTERVAL '24 hours'
) c24 ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM cave_completions_mirror m
  WHERE m.cave_user_id = u.cave_user_id
    AND m.completed_at >= NOW() - INTERVAL '7 days'
) c7d ON true;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Table: weekly_winners
-- ═══════════════════════════════════════════════════════════════════
-- One row per (week, podium-rank, metric). Populated by a weekly cron
-- that snapshots the top-3 from edits_week AND completions_week each
-- Monday 00:05 UTC. The user profile shows two podiums side-by-side:
-- one for edits, one for cells.

CREATE TABLE IF NOT EXISTS weekly_winners (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   DATE    NOT NULL,                   -- Monday of the week
  rank         INTEGER NOT NULL CHECK (rank IN (1, 2, 3)),
  user_id      UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edits        INTEGER NOT NULL,                   -- edits OR completions in that week
  metric       TEXT    NOT NULL DEFAULT 'edits'
                       CHECK (metric IN ('edits', 'completions')),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start, rank, metric)
);

-- Migration helpers — safe to re-run on an existing weekly_winners table.
-- Adds the metric column if missing, and replaces the old (week_start, rank)
-- unique constraint with the wider (week_start, rank, metric) form.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'weekly_winners' AND column_name = 'metric'
  ) THEN
    ALTER TABLE weekly_winners ADD COLUMN metric TEXT NOT NULL DEFAULT 'edits';
    ALTER TABLE weekly_winners ADD CONSTRAINT weekly_winners_metric_check
      CHECK (metric IN ('edits', 'completions'));
  END IF;
END $$;

DO $$
BEGIN
  -- Drop the old 2-col UNIQUE if it exists (created by a previous schema apply)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'weekly_winners_week_start_rank_key'
  ) THEN
    ALTER TABLE weekly_winners DROP CONSTRAINT weekly_winners_week_start_rank_key;
  END IF;
  -- Add the 3-col UNIQUE if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'weekly_winners_week_start_rank_metric_key'
  ) THEN
    ALTER TABLE weekly_winners
      ADD CONSTRAINT weekly_winners_week_start_rank_metric_key
      UNIQUE (week_start, rank, metric);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS weekly_winners_user_idx ON weekly_winners (user_id, rank);
CREATE INDEX IF NOT EXISTS weekly_winners_week_idx ON weekly_winners (week_start DESC);
CREATE INDEX IF NOT EXISTS weekly_winners_user_metric_idx ON weekly_winners (user_id, metric);

ALTER TABLE weekly_winners ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'weekly_winners' AND policyname = 'read_weekly_winners') THEN
    CREATE POLICY "read_weekly_winners"   ON weekly_winners FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'weekly_winners' AND policyname = 'insert_weekly_winners') THEN
    CREATE POLICY "insert_weekly_winners" ON weekly_winners FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Helper: snapshot_weekly_winners(target_week_start, target_metric)
-- ═══════════════════════════════════════════════════════════════════
-- Idempotent. Computes the top-3 by either edits or completions in the
-- past week and inserts their rows. Safe to call repeatedly for the
-- same week+metric — the UNIQUE (week_start, rank, metric) constraint
-- prevents duplicates.
--
-- target_metric defaults to 'edits' for backward compatibility with
-- callers that pre-date Phase B.

CREATE OR REPLACE FUNCTION snapshot_weekly_winners(
    target_week_start DATE DEFAULT NULL,
    target_metric     TEXT DEFAULT 'edits')
RETURNS TABLE (rank INTEGER, user_id UUID, edits INTEGER, metric TEXT) AS $$
#variable_conflict use_column
DECLARE
  ws DATE;
  m  TEXT;
BEGIN
  -- Default: last completed Monday-to-Sunday week.
  ws := COALESCE(target_week_start, (DATE_TRUNC('week', NOW() - INTERVAL '7 days'))::DATE);
  m  := COALESCE(target_metric, 'edits');
  IF m NOT IN ('edits', 'completions') THEN
    RAISE EXCEPTION 'target_metric must be edits or completions, got %', m;
  END IF;

  IF m = 'edits' THEN
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
      INSERT INTO weekly_winners (week_start, rank, user_id, edits, metric)
      SELECT ws, rk::INTEGER, ranked.user_id, ranked.edits, 'edits'
      FROM ranked
      WHERE rk <= 3
      ON CONFLICT (week_start, rank, metric) DO NOTHING
      RETURNING weekly_winners.rank, weekly_winners.user_id, weekly_winners.edits, weekly_winners.metric
    )
    SELECT inserted.rank, inserted.user_id, inserted.edits, inserted.metric FROM inserted;

  ELSE  -- 'completions'
    RETURN QUERY
    WITH ranked AS (
      SELECT
        u.id AS user_id,
        COUNT(*)::INTEGER AS completions,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rk
      FROM cave_completions_mirror m
      JOIN users u ON u.cave_user_id = m.cave_user_id
      WHERE m.completed_at >= ws
        AND m.completed_at <  ws + INTERVAL '7 days'
      GROUP BY u.id
    ),
    inserted AS (
      INSERT INTO weekly_winners (week_start, rank, user_id, edits, metric)
      SELECT ws, rk::INTEGER, ranked.user_id, ranked.completions, 'completions'
      FROM ranked
      WHERE rk <= 3
      ON CONFLICT (week_start, rank, metric) DO NOTHING
      RETURNING weekly_winners.rank, weekly_winners.user_id, weekly_winners.edits, weekly_winners.metric
    )
    SELECT inserted.rank, inserted.user_id, inserted.edits, inserted.metric FROM inserted;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Schedule: pg_cron weekly snapshot (optional — also doable via
--    GitHub Actions cron in scripts/weekly-winners-snapshot.mjs).
-- ═══════════════════════════════════════════════════════════════════
-- If pg_cron is enabled in your project, uncomment to schedule the
-- snapshot for every Monday at 00:05 UTC. The script does both
-- metrics; the SQL alternative below does the same.

-- SELECT cron.schedule(
--   'weekly-winners-snapshot-edits',
--   '5 0 * * 1',
--   $$ SELECT snapshot_weekly_winners(NULL, 'edits'); $$
-- );
-- SELECT cron.schedule(
--   'weekly-winners-snapshot-completions',
--   '6 0 * * 1',
--   $$ SELECT snapshot_weekly_winners(NULL, 'completions'); $$
-- );
