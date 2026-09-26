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
3. **Decision.** The proposal is posted in the report's Slack thread. An
   approver (Amy or Celia) approves or dismisses it, in Slack or in Admin Hub
   > Triage. Both places always show the same rows.
4. **Build.** Claude implements an approved fix on branch
   `triage/<first 8 of row id>`, checks the production build, and deploys a
   **preview**: `https://triage-<id8>-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/`.
   The preview uses the real data (same CAVE, accounts and database). The
   live site is untouched.
5. **Test.** The bot posts the preview in the thread and tags the person who
   approved it. **That person must test it**, and is tagged every 10 minutes
   until they reply (see below).
6. **Shipped.** When the tester says it is good, it is merged into
   `eyewire-ii-community` and deployed live. The thread gets "Change
   shipped" with a link to the change. In the game, the person who reported
   it and every admin get a "🎉 Fixed!" notification (confetti Nurro, mint and
   gold card) saying what changed. The reporter also gets a note when their
   report is accepted and being built. Only they are told, never everyone.

## Talking to the robot

Everything happens in the report's Slack thread. **Just reply in your own
words**: each reply is read in the context of the whole thread by a small
Claude model (Haiku, on the Princeton subscription), which works out what you
mean and answers like a person. The keywords below always work too, and are
the fallback if the model is unavailable (`TRIAGE_UNDERSTAND=off` forces them).

| When | You want to | Say something like | What happens |
|---|---|---|---|
| Approving | approve, with details | `approve, use a warm gold and leave the tag layer blue` | the text after approve goes to Claude with the spec, and shows in the Admin Hub |
| | turn it down | `dismiss` | nothing is built |
| Claude is building | add details | `also check it on the MEC dataset` | saved as a note, never lost; the preview message lists any that came too late for that build |
| Claude asked a question | answer it | `gold, not lemon yellow` | Claude carries on with your answer |
| Preview is up | ship it | `good`, `looks good`, `lgtm` | merged and deployed live |
| | ask about it | `where do I click to see it?` | Claude answers from what it built; nothing is rebuilt |
| | ask for changes | `works, but the yellow is too bright` | Claude fixes it and posts a new preview |
| | add details without a rebuild | `note: Celia prefers amber` | saved for Claude's next attempt |
| | build again now | `rebuild` | a new build with everything in the thread |
| | test on the live site | `ship to test` | goes live for a real-data test (sync jobs, Cloud Functions, what other users see) |
| Live test | keep it | `good` | stays live, row closed |
| | take it off | `revert` | the live site goes back; say what to change and Claude tries again |
| | report a problem | `it broke the tag panel` | taken off the live site first, then back to Claude |
| Anytime | pass the testing on | `hand off to @Celia`, `can Celia check this` | that person becomes the tester and gets the reminders |
| | just chat | `thanks, will test after lunch` | nothing changes, nothing rebuilds |
| Something failed | try again | `retry` | the failed step runs again |
| | correct it | `it's in ExtensionBar.vue, not the settings panel` | Claude tries again with that |

Comments from other people in the thread are passed to Claude as background,
but only the tester moves a fix forward (an approver can also answer Claude,
retry, or hand off). Messages that mention **@Amy's Claude** go to the Q&A
bot, which can tell you where any fix is; the robot ignores them. Claude can
also ask *you* a question when a spec can be read two ways, instead of
guessing.

## How the robot learns

Each build starts from nothing but the code, so what earlier builds learned is
kept in **[docs/TRIAGE-KNOWLEDGE.md](TRIAGE-KNOWLEDGE.md)**:

- **Every build, answer and proposal reads it first**: the app's traps, how to
  check a build, and how the team wants things (no dashes in copy, readable
  text, change only what the spec asks).
- **Every build adds to it.** When a build teaches Claude something the next
  one should know (a trap in the code, how to test a feature, what the tester
  actually wanted when the spec said otherwise), it adds one dated line in the
  same change as the fix.
- **Lessons only land when a human approves.** The knowledge file rides along
  with the fix, so a lesson is saved only when its tester says the fix is
  good. A rejected build's lessons are dropped with it, and anyone can edit
  or correct the file directly.
- **Your replies are the best teachers.** When you send a fix back with what
  was wrong, that correction is exactly the kind of thing that gets written
  down, so the next build does not make the same mistake.
- The Slack Q&A bot can read the same file, so both agents share what has
  been learned.

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
| what it has learned | `docs/TRIAGE-KNOWLEDGE.md` | read by every build; each build may add a line |
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
