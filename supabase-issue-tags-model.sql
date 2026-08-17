-- ============================================================================
-- AI-seeded scout tags: model-detected merge-error candidates
-- ----------------------------------------------------------------------------
-- The Seung Lab detection model (Fuming's merge-error detector) exports
-- per-neuron window files: sample windows along the neuron, each with a
-- verify_prob (0..1) and, for suspect windows, a proposed split partition
-- (25 labeled sample points). scripts/import-model-tags.mjs ingests those
-- files:
--   suspect windows  -> issue_tags rows (source 'model', tag_type 'merger')
--   ALL windows      -> model_windows rows (feeds the per-neuron heat layer)
--
-- issue_tags gains three columns:
--   source      'human' (default) or 'model'; the Tags tab shows human tags,
--               the AI tab shows model tags
--   confidence  the model's verify_prob for the window (0..1)
--   model_data  JSONB payload for the split overlay:
--               { windowIdx, centerUm, posRelUm, labels, spectralScore }
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

ALTER TABLE issue_tags ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'human';
ALTER TABLE issue_tags ADD COLUMN IF NOT EXISTS confidence REAL;
ALTER TABLE issue_tags ADD COLUMN IF NOT EXISTS model_data JSONB;

CREATE INDEX IF NOT EXISTS issue_tags_source_idx ON issue_tags (source, dataset, status);

-- Every sample window the model looked at, suspect or not, for the dense
-- per-neuron heat layer. batch identifies the export file so re-imports of
-- a newer export for the same neuron can replace cleanly.
CREATE TABLE IF NOT EXISTS model_windows (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset     TEXT        NOT NULL,
  root_id     TEXT        NOT NULL,
  window_idx  INT         NOT NULL,
  position    TEXT        NOT NULL,  -- JSON "[x,y,z]" voxel triple, same convention as issue_tags
  verify_prob REAL        NOT NULL,
  is_suspect  BOOLEAN     NOT NULL DEFAULT false,
  batch       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset, root_id, window_idx)
);

CREATE INDEX IF NOT EXISTS model_windows_root_idx ON model_windows (dataset, root_id);

ALTER TABLE model_windows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'model_windows' AND policyname = 'model_windows_all'
  ) THEN
    CREATE POLICY model_windows_all ON model_windows FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
