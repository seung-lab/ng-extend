-- ============================================================================
-- site_issues + feedback_triage — the feedback triage pipeline
-- ----------------------------------------------------------------------------
-- 1. site_issues: every "Submit an issue" report, mirrored into Supabase by
--    the client (the Cloud Function relay to Slack/Firestore stays as-is;
--    this gives the triage agent something it can actually read).
-- 2. feedback_triage: one row per agent recommendation. A scheduled agent
--    reads new site_issues (and recent client_errors), decides what each
--    deserves (nothing / message / bug fix spec / new feature), and inserts
--    a proposal here. Amy or Celia approve, edit, or dismiss in
--    Admin Hub > Triage. Nothing executes without that human step.
--
-- RLS follows the project's permissive convention (all gating in JS; the
-- anon key ships in the bundle). client_errors stays INSERT-only; these
-- tables hold user-submitted reports, which the app already shows freely.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_issues (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT        NOT NULL DEFAULT 'Bug',
  message     TEXT        NOT NULL,
  url         TEXT,
  dataset     TEXT,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_issues_created_idx ON site_issues (created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_triage (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the recommendation is about.
  source         TEXT        NOT NULL CHECK (source IN ('site_issue', 'client_error', 'guide_feedback', 'help_request')),
  source_id      TEXT        NOT NULL,
  source_excerpt TEXT,
  -- The agent's proposal.
  recommendation TEXT        NOT NULL CHECK (recommendation IN ('nothing', 'message', 'bug_fix_spec', 'new_feature')),
  rationale      TEXT,
  -- recommendation = 'message': the reply to send the reporter.
  proposed_message TEXT,
  -- recommendation = 'bug_fix_spec' or 'new_feature': the spec text.
  spec           TEXT,
  -- Human review state. Only Amy or Celia flip this.
  status         TEXT        NOT NULL DEFAULT 'proposed'
                             CHECK (status IN ('proposed', 'approved', 'dismissed', 'done')),
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One proposal per feedback item.
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS feedback_triage_status_idx ON feedback_triage (status, created_at DESC);

ALTER TABLE site_issues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_triage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'site_issues' AND policyname = 'site_issues_all') THEN
    CREATE POLICY site_issues_all ON site_issues FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback_triage' AND policyname = 'feedback_triage_all') THEN
    CREATE POLICY feedback_triage_all ON feedback_triage FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
