-- EyeWire II Proofreading Management Schema
-- Apply this in Supabase Dashboard > SQL Editor > New query

-- ═══════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  middleauth_email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  flag TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  total_edits INTEGER DEFAULT 0,
  total_merges INTEGER DEFAULT 0,
  total_splits INTEGER DEFAULT 0,
  cells_completed INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_edit_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE proofreading_tasks (
  id SERIAL PRIMARY KEY,
  segment_id TEXT NOT NULL,
  dataset TEXT NOT NULL DEFAULT 'eyewire_ii',
  nucleus_coords TEXT,
  soma_coords TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'skipped')),
  assigned_to UUID REFERENCES users(id),
  priority INTEGER DEFAULT 0,
  final_segment_id TEXT,
  final_nucleus_id TEXT,
  notes TEXT,
  source_sheet_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_status ON proofreading_tasks(status);
CREATE INDEX idx_tasks_assigned ON proofreading_tasks(assigned_to);
CREATE INDEX idx_tasks_segment ON proofreading_tasks(segment_id);

CREATE TABLE task_assignments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES proofreading_tasks(id),
  user_id UUID NOT NULL REFERENCES users(id),
  claimed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 minutes'),
  released_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'expired', 'released'))
);

CREATE INDEX idx_assignments_active ON task_assignments(status, expires_at)
  WHERE status = 'active';

CREATE TABLE edit_log (
  id BIGSERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES proofreading_tasks(id),
  user_id UUID REFERENCES users(id),
  operation TEXT NOT NULL
    CHECK (operation IN ('split', 'merge', 'undo_split', 'undo_merge',
                          'mark_complete', 'unmark_complete', 'set_cell_type',
                          'claim_task', 'release_task', 'complete_task')),
  timestamp TIMESTAMPTZ DEFAULT now(),
  segment_before TEXT,
  segment_after TEXT,
  coordinates TEXT,
  metadata JSONB,
  dataset TEXT DEFAULT 'eyewire_ii',
  success BOOLEAN DEFAULT true
);

CREATE INDEX idx_editlog_user ON edit_log(user_id, timestamp DESC);
CREATE INDEX idx_editlog_task ON edit_log(task_id);
CREATE INDEX idx_editlog_time ON edit_log(timestamp DESC);

CREATE TABLE activity_feed (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  user_name TEXT,
  action TEXT NOT NULL,
  segment_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_feed_time ON activity_feed(timestamp DESC);

CREATE TABLE help_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_name TEXT,
  segment_id TEXT NOT NULL,
  position TEXT NOT NULL,
  note TEXT DEFAULT '',
  issue_type TEXT NOT NULL,
  dataset TEXT DEFAULT 'eyewire_ii',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolved_by_name TEXT,
  cell_type TEXT,
  nickname TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  response_note TEXT,
  response_url TEXT,
  response_annotation_layer TEXT
);

CREATE INDEX idx_help_dataset ON help_requests(dataset, resolved);
CREATE INDEX idx_help_time ON help_requests(created_at DESC);

-- ═══════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ═══════════════════════════════════════════

-- For MVP: enable RLS but allow all operations via anon key.
-- We'll tighten policies once we add Edge Function auth proxy.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select" ON users FOR SELECT USING (true);
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "users_update" ON users FOR UPDATE USING (true);

ALTER TABLE proofreading_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_select" ON proofreading_tasks FOR SELECT USING (true);
CREATE POLICY "tasks_insert" ON proofreading_tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "tasks_update" ON proofreading_tasks FOR UPDATE USING (true);

ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignments_select" ON task_assignments FOR SELECT USING (true);
CREATE POLICY "assignments_insert" ON task_assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "assignments_update" ON task_assignments FOR UPDATE USING (true);

ALTER TABLE edit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "editlog_select" ON edit_log FOR SELECT USING (true);
CREATE POLICY "editlog_insert" ON edit_log FOR INSERT WITH CHECK (true);

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_select" ON activity_feed FOR SELECT USING (true);
CREATE POLICY "feed_insert" ON activity_feed FOR INSERT WITH CHECK (true);

ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "help_select" ON help_requests FOR SELECT USING (true);
CREATE POLICY "help_insert" ON help_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "help_update" ON help_requests FOR UPDATE USING (true);
CREATE POLICY "help_delete" ON help_requests FOR DELETE USING (true);

-- ═══════════════════════════════════════════
-- AUTO-EXPIRY FUNCTION
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION expire_stale_assignments() RETURNS void AS $$
BEGIN
  -- Release expired assignments
  UPDATE task_assignments
  SET status = 'expired', released_at = now()
  WHERE status = 'active' AND expires_at < now();

  -- Set tasks back to pending
  UPDATE proofreading_tasks
  SET status = 'pending', assigned_to = NULL, updated_at = now()
  WHERE status = 'assigned' AND id IN (
    SELECT task_id FROM task_assignments
    WHERE status = 'expired' AND released_at >= now() - INTERVAL '1 minute'
  );
END;
$$ LANGUAGE plpgsql;

-- To schedule auto-expiry, enable pg_cron extension in Supabase Dashboard:
--   Database > Extensions > search "pg_cron" > Enable
-- Then run:
--   SELECT cron.schedule('expire-assignments', '*/5 * * * *', 'SELECT expire_stale_assignments()');

-- ═══════════════════════════════════════════
-- ENABLE REALTIME
-- ═══════════════════════════════════════════

-- Enable realtime for these tables (also do this in Dashboard > Database > Replication):
ALTER PUBLICATION supabase_realtime ADD TABLE activity_feed;
ALTER PUBLICATION supabase_realtime ADD TABLE proofreading_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE task_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE help_requests;
