-- ============================================================================
-- issue_tags — Scout tags: one-click location flags in the volume
-- ----------------------------------------------------------------------------
-- Tag mode lets any user drop a typed flag at the crosshair position:
--   merger          two cells wrongly joined here
--   missing_branch  a branch looks truncated here
-- Scythes (the engineers working the queue, named for EyeWire I's fixer
-- role) browse open tags in the Cell Library's Tags tab and jump straight
-- to the location.
--
-- Same conventions as help_requests: position is a JSON "x, y, z" voxel
-- triple for the tagged dataset, dataset is the canonical tag from
-- src/datasets.ts, RLS is the project's permissive convention, realtime on
-- so new tags appear live.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

CREATE TABLE IF NOT EXISTS issue_tags (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset          TEXT,
  segment_id       TEXT,
  position         TEXT        NOT NULL,
  tag_type         TEXT        NOT NULL CHECK (tag_type IN ('merger', 'missing_branch')),
  note             TEXT,
  user_id          UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_name        TEXT,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_name TEXT,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_tags_status_idx  ON issue_tags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_tags_dataset_idx ON issue_tags (dataset, status);

ALTER TABLE issue_tags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'issue_tags' AND policyname = 'issue_tags_all'
  ) THEN
    CREATE POLICY issue_tags_all ON issue_tags FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'issue_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE issue_tags;
  END IF;
END $$;
