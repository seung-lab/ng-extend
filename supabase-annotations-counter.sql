-- Annotations counter (Ames 2026-10-01). The app tallies annotations in the
-- browser and sends the tally about once an hour: one edit_log row
-- ('annotate', metadata.count) and one bump of this column.
-- Run in the Supabase SQL editor. Safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_annotations INTEGER NOT NULL DEFAULT 0;
