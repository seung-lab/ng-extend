-- EyeWire II — Resettable practice cells for the Cut & Merge tutorial
-- Apply in Supabase Dashboard > SQL Editor.
--
-- A practice example is a sandbox cell (root A) with a piece nearby (root B)
-- that the AI left disconnected. Tutorial 3 hands one example to one user at
-- a time: they merge B onto A, then cut it off again. Whatever they did, the
-- example is put back exactly as registered by undoing every PyChunkedGraph
-- operation made on it since `baseline_at`, newest first. The client tries
-- that itself when the user finishes or leaves; the reset job
-- (scripts/reset-practice-examples.mjs) covers abandoned sessions and
-- failed client resets with the service token.
--
-- Roots change with every edit, so the immutable supervoxels are the record
-- of the example. Current roots are resolved from them at claim time and
-- after every reset.

CREATE TABLE IF NOT EXISTS tutorial_practice_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',

  -- Where the example lives
  dataset    TEXT NOT NULL,   -- segmentation layer name, e.g. pinky_nf_v2
  pcg_server TEXT NOT NULL,   -- e.g. https://minnie.microns-daf.com
  pcg_table  TEXT NOT NULL,   -- e.g. pinky_nf_v2
  state_url  TEXT NOT NULL,   -- short middleauth state link of the start view

  -- The two pieces. Supervoxels never change; roots are refreshed.
  supervoxel_a TEXT NOT NULL,
  supervoxel_b TEXT NOT NULL,
  root_a TEXT NOT NULL,
  root_b TEXT NOT NULL,

  -- Operations after this instant are undone at reset.
  baseline_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'in_use', 'needs_reset', 'resetting', 'broken')),
  enabled BOOLEAN NOT NULL DEFAULT true,

  claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  uses INTEGER NOT NULL DEFAULT 0,
  reset_failures INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ,
  last_error TEXT,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutorial_practice_examples_status_idx
  ON tutorial_practice_examples (status, enabled);

ALTER TABLE tutorial_practice_examples ENABLE ROW LEVEL SECURITY;
-- Same model as the other app tables: anon-key auth, gating in the JS layer.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutorial_practice_examples' AND policyname = 'tutorial_practice_examples_all') THEN
    CREATE POLICY tutorial_practice_examples_all ON tutorial_practice_examples FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- CLAIM: one user per example, atomically
-- ═══════════════════════════════════════════
-- Picks the least used ready example, or one whose claim expired, or the one
-- this user already holds (a reload mid tutorial keeps the same cell).
-- Returns no row when every example is busy.
CREATE OR REPLACE FUNCTION claim_practice_example(p_user UUID, p_minutes INTEGER DEFAULT 45)
RETURNS SETOF tutorial_practice_examples AS $$
DECLARE
  v_row tutorial_practice_examples%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM tutorial_practice_examples
   WHERE enabled
     AND (
       (status = 'in_use' AND claimed_by = p_user)
       OR status = 'ready'
       OR (status = 'in_use' AND expires_at < now())
     )
   ORDER BY (status = 'in_use' AND claimed_by = p_user) DESC, uses ASC, created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- An expired claim by someone else means their edits are still on the
  -- cell. Hand it to the reset job, not to the next user.
  IF v_row.status = 'in_use' AND v_row.claimed_by IS DISTINCT FROM p_user THEN
    UPDATE tutorial_practice_examples
       SET status = 'needs_reset', claimed_by = NULL, claimed_at = NULL,
           expires_at = NULL, updated_at = now()
     WHERE id = v_row.id;
    RETURN;
  END IF;

  UPDATE tutorial_practice_examples
     SET status = 'in_use',
         claimed_by = p_user,
         claimed_at = COALESCE(CASE WHEN claimed_by = p_user THEN claimed_at END, now()),
         expires_at = now() + make_interval(mins => p_minutes),
         updated_at = now()
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════
-- RELEASE: the holder is done
-- ═══════════════════════════════════════════
-- p_clean = true means the client undid every operation and confirmed the
-- two pieces are separate again; the refreshed roots come with it. Anything
-- else lands in needs_reset for the job.
CREATE OR REPLACE FUNCTION release_practice_example(
  p_id UUID, p_user UUID, p_clean BOOLEAN,
  p_root_a TEXT DEFAULT NULL, p_root_b TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM tutorial_practice_examples
   WHERE id = p_id AND claimed_by = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE tutorial_practice_examples
     SET status = CASE WHEN p_clean THEN 'ready' ELSE 'needs_reset' END,
         root_a = CASE WHEN p_clean AND p_root_a IS NOT NULL THEN p_root_a ELSE root_a END,
         root_b = CASE WHEN p_clean AND p_root_b IS NOT NULL THEN p_root_b ELSE root_b END,
         last_reset_at = CASE WHEN p_clean THEN now() ELSE last_reset_at END,
         last_error = p_error,
         claimed_by = NULL, claimed_at = NULL, expires_at = NULL,
         uses = uses + 1,
         updated_at = now()
   WHERE id = p_id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
