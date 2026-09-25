# The triage loop: from a user report to a tested, live fix

Set up 25 September 2026. Every automated step runs on Amy's Princeton
Claude subscription (amylr@princeton.edu) through the
`CLAUDE_CODE_OAUTH_TOKEN` repo secret.

## What happens

1. **Report.** A user submits an issue. `submitIssue` posts it to
   #citsci_feedback and the app mirrors it into Supabase `site_issues`.
2. **Proposal.** `triage-propose.yml` (every 10 min, only when a report is
   waiting) has Claude read the code and write one `feedback_triage` row:
   no action, send a message, bug fix spec, or new feature.
3. **Decision.** The bridge posts the proposal in the report's Slack thread.
   An approver (Amy or Celia) replies `approve` or `dismiss`, in Slack or in
   Admin Hub > Triage. Text after `approve` is kept as a note and given to
   Claude with the spec. Both places show the same rows: a decision made in
   the Admin Hub is echoed into the Slack thread.
4. **Build.** An approved fix or feature goes to `triage-implement.yml`.
   Claude implements it on branch `triage/<first 8 of row id>` and runs the
   production build. Pushing the branch deploys a **preview**:
   `https://triage-<id8>-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/`.
   The live site is untouched.
5. **Test.** The bot posts the preview link in the thread and tags the person
   who approved it. **That person must test it.** The preview uses the real
   data (same CAVE, accounts and database). They are tagged again every 10
   minutes until they reply:
   - `good` (or `looks good`, `lgtm`): the fix is merged into
     `eyewire-ii-community` and deployed live by `triage-deploy.yml`.
   - `ship to test`: for things only the live site does (sync jobs, Cloud
     Functions, what other users see). It goes live, and the tester is tagged
     until they reply `good` (it stays) or `revert` (it comes off). Any other
     reply also takes it off, then goes to Claude as what to fix.
   - a question ending in `?`: Claude answers it in the thread from what it
     built. Nothing is rebuilt.
   - anything else: taken as what is wrong. Claude gets it, fixes the
     branch, and posts a new preview. Tagging starts again.
   - `note: ...`: extra information saved for Claude's next attempt.
     Nothing rebuilds.
   - `rebuild`: build again with everything in the thread.
   - `hand off to @someone`: that person becomes the tester.
   Replies posted while Claude is still building are kept as notes, never
   lost. The next preview message lists any that arrived too late for that
   build, so the tester can reply `rebuild` or test as is.
   Comments from anyone else in the thread are passed to Claude as context,
   but only the tester's reply moves the fix forward. Messages that mention
   @Amy's Claude are questions for the Q&A bot and are left alone.

   **When Claude has a question.** If the spec can be read two ways, Claude
   builds nothing and asks in the thread. The tester is tagged every 10
   minutes; the first reply from them or an approver goes back to Claude,
   which carries on. The same happens after a failure or a refusal: reply
   `retry`, or reply with what to do differently.
6. **Shipped.** The row becomes `done` and the thread gets "Change shipped",
   tagging the approvers.

## Where Claude's work is

- The Slack thread: every step posts there, with links.
- GitHub Actions in seung-lab/ng-extend: "Triage Implement" runs. Each one is
  a full Claude Code session log.
- The branch `triage/<id8>` on seung-lab/ng-extend, and its preview site.
- Admin Hub > Triage: the same state, with the preview, the note, the tester's
  replies, and Retry buttons.

## Moving parts

| piece | file | runs |
|---|---|---|
| bridge (Slack, sync, clock) | `scripts/slack-triage-bridge.mjs`, `.github/workflows/slack-triage-bridge.yml` | every 10 min |
| proposer | `.github/workflows/triage-propose.yml` | every 10 min, if reports wait |
| implementer | `.github/workflows/triage-implement.yml` | dispatched by the bridge |
| deployer | `.github/workflows/triage-deploy.yml` | dispatched by the bridge |
| shared steps | `scripts/triage-loop.mjs` | inside those workflows |
| schema | `supabase-triage-loop-columns.sql` | once, in the SQL editor |
| review UI | `src/components/AdminHub.vue`, Triage tab | in the app |

Row state is `feedback_triage.impl_state` (see supabase-triage-loop-states.sql): queued, implementing, needs_info, testing, answer_queued, answering, live_test_queued, live_testing, revert_queued, reverting,
changes_requested, deploy_queued, deploying, deployed, failed. `status`
keeps its old meaning. A run stuck over 90 minutes is marked failed and
Amy is tagged.

## Switches (repo variables, Settings > Secrets and variables > Actions)

| variable | effect |
|---|---|
| `TRIAGE_LOOP=on` | approvals are built, testers are chased. Off: the bridge only posts, reads decisions, and syncs with the Admin Hub. |
| `TRIAGE_PROPOSER=on` | the proposer runs. Turn off the old :42 claude.ai routine at the same time. |
| `CLAUDE_TOKEN_REMIND_AT` | optional; from this date Amy is tagged daily to renew the Princeton token. Default 2027-08-25. |
| `APPROVER_NAME_MAP` | optional JSON, first name of an Admin Hub reviewer to Slack id. Default `{"amy":"U02FH1DRC","celia":"U033NHWDE"}`. |

## Rules GitHub imposes

- Workflows can only be dispatched, and crons only fire, if the file is also
  on `main`. Register changes there with a `[skip ci]` commit, as before.
- A push made with `GITHUB_TOKEN` does not trigger other workflows, so the
  implementer and deployer start `on_dev_branch_push.yml` themselves.
- Scheduled runs can start a few minutes late when GitHub is busy, so "every
  10 minutes" is a floor, not a promise.

## Safety

- Report text is public input. Claude is told to treat it as data. Its
  session has no push credentials and can only run the build and read-only
  git commands. The workflow pushes one branch after Claude finishes.
- Nothing reaches the live site without a human replying `good` after
  testing the preview.
- Replaces the implementer role in
  `Documents\New project\eyewire-community-agents\TEAM.md` for triage rows.
