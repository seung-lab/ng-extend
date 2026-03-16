-- EyeWire II Admin Hub Schema
-- Apply this in Supabase Dashboard > SQL Editor > New query
-- Run AFTER the base supabase-schema.sql

-- ═══════════════════════════════════════════
-- ADMIN TABLES
-- ═══════════════════════════════════════════

-- Simple admin allowlist
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User groups (e.g. "Scythes", "Mystics")
CREATE TABLE user_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#4a9eff',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

-- Group membership
CREATE TABLE user_group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  added_by UUID REFERENCES users(id),
  UNIQUE(group_id, user_id)
);

CREATE INDEX idx_group_members_group ON user_group_members(group_id);
CREATE INDEX idx_group_members_user ON user_group_members(user_id);

-- ═══════════════════════════════════════════
-- NOTIFICATION TABLES
-- ═══════════════════════════════════════════

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  thumbnail_url TEXT,
  send_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  target_type TEXT NOT NULL DEFAULT 'all'
    CHECK (target_type IN ('all', 'group', 'user')),
  target_id TEXT,
  post_to_chat BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_notifications_active ON notifications(send_at, expires_at);

CREATE TABLE notification_reads (
  id SERIAL PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(notification_id, user_id)
);

CREATE INDEX idx_notif_reads_user ON notification_reads(user_id);

-- ═══════════════════════════════════════════
-- SPECIAL BADGE TABLES
-- ═══════════════════════════════════════════

CREATE TABLE special_badges (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE special_badge_awards (
  id SERIAL PRIMARY KEY,
  badge_id INTEGER NOT NULL REFERENCES special_badges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ DEFAULT now(),
  awarded_by UUID REFERENCES users(id),
  reason TEXT DEFAULT '',
  UNIQUE(badge_id, user_id)
);

CREATE INDEX idx_badge_awards_user ON special_badge_awards(user_id);
CREATE INDEX idx_badge_awards_badge ON special_badge_awards(badge_id);

-- ═══════════════════════════════════════════
-- ROW-LEVEL SECURITY (MVP: open like other tables)
-- ═══════════════════════════════════════════

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_select" ON admins FOR SELECT USING (true);

ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "groups_select" ON user_groups FOR SELECT USING (true);
CREATE POLICY "groups_insert" ON user_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "groups_update" ON user_groups FOR UPDATE USING (true);
CREATE POLICY "groups_delete" ON user_groups FOR DELETE USING (true);

ALTER TABLE user_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "group_members_select" ON user_group_members FOR SELECT USING (true);
CREATE POLICY "group_members_insert" ON user_group_members FOR INSERT WITH CHECK (true);
CREATE POLICY "group_members_delete" ON user_group_members FOR DELETE USING (true);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (true);
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (true);
CREATE POLICY "notifications_delete" ON notifications FOR DELETE USING (true);

ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_reads_select" ON notification_reads FOR SELECT USING (true);
CREATE POLICY "notif_reads_insert" ON notification_reads FOR INSERT WITH CHECK (true);

ALTER TABLE special_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "special_badges_select" ON special_badges FOR SELECT USING (true);
CREATE POLICY "special_badges_insert" ON special_badges FOR INSERT WITH CHECK (true);
CREATE POLICY "special_badges_update" ON special_badges FOR UPDATE USING (true);

ALTER TABLE special_badge_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "badge_awards_select" ON special_badge_awards FOR SELECT USING (true);
CREATE POLICY "badge_awards_insert" ON special_badge_awards FOR INSERT WITH CHECK (true);
CREATE POLICY "badge_awards_delete" ON special_badge_awards FOR DELETE USING (true);

-- ═══════════════════════════════════════════
-- ENABLE REALTIME
-- ═══════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ═══════════════════════════════════════════
-- SEED ADMIN
-- ═══════════════════════════════════════════

-- Add Amy as admin (update user_id after first login if needed)
INSERT INTO admins (email) VALUES ('amyleerobinson@gmail.com')
ON CONFLICT (email) DO NOTHING;
