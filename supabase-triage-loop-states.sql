-- ============================================================================
-- feedback_triage.impl_state: states for questions, live tests and reverts
-- (2026-09-25). Run after supabase-triage-loop-columns.sql. Safe to re-run.
--   needs_info        Claude asked a question; waiting on a human answer
--   answer_queued     the tester asked a question; Claude will answer it
--   answering         triage-implement.yml is answering
--   live_test_queued  tester replied "ship to test"; going live to test
--   live_testing      live for a real-data test; tester says good or revert
--   revert_queued     taking it off the live site
--   reverting         triage-deploy.yml is reverting
-- ============================================================================

alter table feedback_triage drop constraint if exists feedback_triage_impl_state_chk;
alter table feedback_triage add constraint feedback_triage_impl_state_chk check (
  impl_state is null or impl_state in (
    'queued', 'implementing', 'needs_info', 'testing', 'changes_requested',
    'answer_queued', 'answering',
    'deploy_queued', 'deploying', 'deployed',
    'live_test_queued', 'live_testing', 'revert_queued', 'reverting',
    'failed'));
