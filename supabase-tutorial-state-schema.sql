-- EyeWire II — Tutorial state on users
-- Apply in Supabase Dashboard > SQL Editor.
--
-- Persists per-user tutorial progress so it follows the account across
-- browsers, incognito sessions, and devices. Pre-login users still fall
-- back to localStorage; on login the store hydrates the row and syncs
-- subsequent step changes back.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_active   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tutorial_1_step   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tutorial_2_step   INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS tutorial_3_step   INTEGER NOT NULL DEFAULT -1;
