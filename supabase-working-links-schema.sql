-- EyeWire II — Working Links (saved viewer-state URLs)
-- Apply in Supabase Dashboard > SQL Editor.
--
-- A "working link" is a saved snapshot of the viewer URL plus enough metadata
-- to display, filter, and re-open it without loading the full state.
--
-- Saved from:
--   • Cell Library "Working Links" tab → "+ Save current view"
--   • Cross-dataset jump confirmation modal → "Save before continuing"
--
-- Visibility model (v1):
--   • Each link is owned by a user.
--   • `is_public` = true means anyone can read it.
--   • `shared_group_id` (optional) restricts read to members of one user_group.
--   • Owner can always read/edit/delete their own links regardless of flags.

CREATE TABLE working_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Display
  title TEXT NOT NULL DEFAULT 'Untitled',
  note  TEXT DEFAULT '',
  starred BOOLEAN NOT NULL DEFAULT false,

  -- The actual viewer state — full neuroglancer URL with state fragment.
  -- This is what we open / copy.
  url TEXT NOT NULL,

  -- Snapshot metadata (denormalized from the URL state at save time so we can
  -- filter / sort / show without parsing the URL fragment back).
  dataset TEXT,                      -- segmentation-layer name, e.g. "pinky_nf_v2"
  position_x DOUBLE PRECISION,       -- viewer crosshair position at save
  position_y DOUBLE PRECISION,
  position_z DOUBLE PRECISION,
  visible_segments TEXT[] DEFAULT '{}',  -- root IDs visible in seg layer at save

  -- Sharing
  is_public BOOLEAN NOT NULL DEFAULT false,
  shared_group_id INTEGER REFERENCES user_groups(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Useful indexes
CREATE INDEX working_links_user_id_idx        ON working_links (user_id, created_at DESC);
CREATE INDEX working_links_dataset_idx        ON working_links (dataset);
CREATE INDEX working_links_starred_idx        ON working_links (user_id, starred) WHERE starred = true;
CREATE INDEX working_links_public_idx         ON working_links (is_public) WHERE is_public = true;
CREATE INDEX working_links_shared_group_idx   ON working_links (shared_group_id) WHERE shared_group_id IS NOT NULL;

-- ═══════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ═══════════════════════════════════════════
ALTER TABLE working_links ENABLE ROW LEVEL SECURITY;

-- Anyone can read public links + links shared to their groups + their own links.
-- (We're using anon-key auth elsewhere in the app, so RLS policies are
-- intentionally permissive — gating happens in the JS layer too.)
CREATE POLICY "read_visible_working_links"
  ON working_links FOR SELECT
  USING (
    is_public = true
    OR user_id IN (SELECT id FROM users WHERE id = working_links.user_id)
    OR shared_group_id IN (
      SELECT group_id FROM user_group_members WHERE user_id = working_links.user_id
    )
  );

CREATE POLICY "insert_own_working_links"   ON working_links FOR INSERT WITH CHECK (true);
CREATE POLICY "update_own_working_links"   ON working_links FOR UPDATE USING (true);
CREATE POLICY "delete_own_working_links"   ON working_links FOR DELETE USING (true);

-- ═══════════════════════════════════════════
-- REALTIME
-- ═══════════════════════════════════════════
-- Enable so other clients see updates to shared/public links live.
ALTER PUBLICATION supabase_realtime ADD TABLE working_links;
