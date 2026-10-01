-- Silver favorite badges (Ames 2026-10-01): one gold favorite (favorite_badge)
-- plus up to five silver ones, a JSON list of badge slugs.
-- Run in the Supabase SQL editor. Safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_badges JSONB NOT NULL DEFAULT '[]'::jsonb;
