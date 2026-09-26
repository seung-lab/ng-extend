-- ============================================================================
-- feedback_triage: implement-on-approval loop (2026-09-25)
-- ----------------------------------------------------------------------------
-- After an approve (Slack or Admin Hub), Claude implements the change on a
-- triage/<id8> branch, which deploys a preview App Engine version. The
-- approver is tagged in the Slack thread every 10 minutes until they reply
-- "good" (which merges and deploys eyewire-ii-community) or reply with what
-- is wrong (which sends Claude back to fix it). See docs/TRIAGE-LOOP.md.
--
-- `status` keeps its meaning (proposed / approved / dismissed / done), so
-- nothing that reads it changes. The loop lives in `impl_state`:
--   queued            approved, waiting for the bridge to start Claude
--   implementing      triage-implement.yml is running
--   testing           preview is up, approver is being pinged
--   changes_requested approver replied with a problem; bridge re-queues Claude
--   deploy_queued     approver said good; bridge starts triage-deploy.yml
--   deploying         triage-deploy.yml is running
--   deployed          live; status is also set to 'done'
--   failed            a run failed; Amy is tagged, "Retry" re-queues it
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table feedback_triage add column if not exists approver_slack_id text;
alter table feedback_triage add column if not exists approver_note     text;
alter table feedback_triage add column if not exists decision_slack_ts text;
alter table feedback_triage add column if not exists impl_state        text;
alter table feedback_triage add column if not exists impl_branch       text;
alter table feedback_triage add column if not exists impl_summary      text;
alter table feedback_triage add column if not exists impl_run_url      text;
alter table feedback_triage add column if not exists impl_attempts     int  not null default 0;
alter table feedback_triage add column if not exists impl_started_at   timestamptz;
alter table feedback_triage add column if not exists preview_url       text;
alter table feedback_triage add column if not exists feedback_log      jsonb not null default '[]'::jsonb;
alter table feedback_triage add column if not exists last_reply_ts     text;
alter table feedback_triage add column if not exists last_nag_at       timestamptz;
alter table feedback_triage add column if not exists nag_count         int  not null default 0;
alter table feedback_triage add column if not exists tested_by         text;
alter table feedback_triage add column if not exists tested_at         timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_triage_impl_state_chk') then
    alter table feedback_triage add constraint feedback_triage_impl_state_chk check (
      impl_state is null or impl_state in (
        'queued', 'implementing', 'testing', 'changes_requested',
        'deploy_queued', 'deploying', 'deployed', 'failed'));
  end if;
end $$;

create index if not exists feedback_triage_impl_state_idx on feedback_triage (impl_state) where impl_state is not null;
