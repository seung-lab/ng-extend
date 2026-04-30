-- EyeWire II — CAVE user-id mapping (Phase B leaderboard groundwork)
-- Apply in Supabase Dashboard > SQL Editor.
--
-- The leaderboard's "Cells" metric needs to count completions written to the
-- CAVE annotation tables (eyewire_ii_cell_status_v2, etc.). Those rows are
-- keyed by CAVE's numeric `user_id` (server-injected by AnnotationEngine via
-- the bound_tag_user schema), NOT by ng-extend's Supabase users.id UUID.
--
-- To bridge the two worlds we capture each user's CAVE id at middleauth login
-- (one curl to /auth/api/v1/user/me with the bearer token) and store it on
-- their Supabase users row. The leaderboard view (Phase B step 3) JOINs the
-- mirror table against this column.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cave_user_id BIGINT;

CREATE INDEX IF NOT EXISTS users_cave_user_id_idx
  ON users (cave_user_id);

-- ═══════════════════════════════════════════════════════════════════
-- cave_completions_mirror — Phase B step 3
-- ═══════════════════════════════════════════════════════════════════
-- Periodically synced from CAVE's cell_status_v2 tables across all known
-- datastacks. Populated by .github/workflows/cave-completions-sync.yml
-- running scripts/sync-cave-completions.mjs every ~30 min.
--
-- One row per (cave_user_id, dataset, segment_id). The leaderboard view
-- joins this against users.cave_user_id to compute cell-count metrics
-- across rolling windows (24h / 7d / all-time).

CREATE TABLE IF NOT EXISTS cave_completions_mirror (
  cave_user_id  BIGINT      NOT NULL,
  dataset       TEXT        NOT NULL,
  segment_id    TEXT        NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cave_user_id, dataset, segment_id)
);

CREATE INDEX IF NOT EXISTS cave_completions_mirror_user_idx
  ON cave_completions_mirror (cave_user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS cave_completions_mirror_completed_idx
  ON cave_completions_mirror (completed_at DESC);

ALTER TABLE cave_completions_mirror ENABLE ROW LEVEL SECURITY;
-- Anyone can read for leaderboard rendering; only the service role
-- (used by the sync cron) inserts.
CREATE POLICY "read_cave_completions_mirror"
  ON cave_completions_mirror FOR SELECT USING (true);
CREATE POLICY "insert_cave_completions_mirror"
  ON cave_completions_mirror FOR INSERT WITH CHECK (true);
CREATE POLICY "update_cave_completions_mirror"
  ON cave_completions_mirror FOR UPDATE USING (true);
