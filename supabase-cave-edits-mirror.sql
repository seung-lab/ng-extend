-- ============================================================================
-- cave_edits_mirror — CAVE-sourced edit operations (PRE-BUILT, safe to apply)
-- ----------------------------------------------------------------------------
-- Per Amy's decision: "all edits and all stats should be based on CAVE tables
-- and real edits, not inferred from changes in segID on the page."
--
-- One row per real PyChunkedGraph operation (merge or split), pulled from
--   GET {caveServer}/segmentation/api/v1/table/{table}/user_operations
--       ?user_id=&start_time=&end_time=
-- by scripts/sync-cave-edits.mjs, iterating the cave_user_ids we hold in
-- users.cave_user_id.
--
-- STATUS: the endpoint is permission-gated (needs `admin_view` on the
-- stroeh-mouse-retina auth dataset — see HANDOFF-BUGFIX-WIP.md §3.1). This
-- table is safe to create NOW; it just stays empty until the grant lands and
-- the sync starts. Do NOT apply supabase-cave-edits-view-swap.sql until the
-- mirror has data, or leaderboard edit counts drop to zero.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

CREATE TABLE IF NOT EXISTS cave_edits_mirror (
  cave_user_id  BIGINT      NOT NULL,
  dataset       TEXT        NOT NULL,
  operation_id  BIGINT      NOT NULL,
  is_merge      BOOLEAN     NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset, operation_id)
);

CREATE INDEX IF NOT EXISTS cave_edits_mirror_user_idx
  ON cave_edits_mirror (cave_user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS cave_edits_mirror_time_idx
  ON cave_edits_mirror (timestamp DESC);

ALTER TABLE cave_edits_mirror ENABLE ROW LEVEL SECURITY;

-- Same policy shape as cave_completions_mirror: anyone can read (leaderboard,
-- profile Datasets tab), only the sync cron (service role) writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cave_edits_mirror' AND policyname = 'read_cave_edits_mirror'
  ) THEN
    CREATE POLICY "read_cave_edits_mirror"
      ON cave_edits_mirror FOR SELECT USING (true);
    CREATE POLICY "insert_cave_edits_mirror"
      ON cave_edits_mirror FOR INSERT WITH CHECK (true);
    CREATE POLICY "update_cave_edits_mirror"
      ON cave_edits_mirror FOR UPDATE USING (true);
  END IF;
END $$;
