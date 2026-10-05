# The triage loop: from a user report to a tested, live fix

Set up 25 September 2026. Since 1 October 2026 every automated step runs on
Amy's own Anthropic API key (the `ANTHROPIC_API_KEY` repo secret, prepaid
credit). Moving it back to the Princeton Claude subscription
(amylr@princeton.edu, `CLAUDE_CODE_OAUTH_TOKEN`) is on the to do list.

## Exact replies

These are the replies the robot only understands when they are typed exactly
(capitals, bold and a full stop at the end do not matter). Reply in the
report's Slack thread, as the whole message unless it says otherwise. The
build ID is the 12 characters in the preview announcement; the Admin Hub card
shows the same commands with a Copy button.

| Reply | When | What it does |
|---|---|---|
| `approve` | a suggestion is waiting | Accepts it and Claude starts building. Words after it are kept as your note for Claude: `approve, use gold`. `approved` and `accept` work too. |
| `dismiss` | a suggestion is waiting | Turns it down. Nothing is built. |
| `good <build ID>` | a preview is up | Puts that exact build on the live site. A bare `good`, `looks good` or `lgtm` is only saved as a note and deploys nothing. |
| `ship to test <build ID>` | a preview is up | Puts it on the live site as a test, for things only the live site can show. |
| `good <build ID>` | it is live as a test | Keeps it live and closes the report. |
| `revert <build ID>` | it is live as a test | Takes it off the live site. |
| `change: your words` | a preview is up, a step failed, or it is live as a test | Sends your words to Claude and starts a new build. This is the only way to ask for a change: it costs a Claude run, so nothing else starts one. |
| `rebuild` | a preview is up | Builds again with everything said in the thread. |
| `retry` | a step failed | Runs the failed step again. After a failed deploy, `good <build ID>` also works. |
| `note: your words` | a preview is up | Saved for Claude's next attempt. Nothing is rebuilt. |
| `shipped` | anytime | Closes a report that was fixed by hand, outside the robot: marks it done, cancels any running build, posts "Change shipped" and sends the reporter their thank you. Say what was built after a colon: `shipped: annotations now clear on complete`. Works on a report dismissed in the last 4 days too. |
| `stop` | anytime, except while live as a test | Ends all work on the report and stops the reminders. `cancel`, `close` and `dismiss` do the same. A reason can follow a colon: `stop: already fixed`. |
| `hand off @name` | a preview or question is waiting | Makes that approver the tester. Start the message with `hand off`, `reassign` or `pass`. |
| `update sender` | anytime | Drafts a note to the person who sent the report. `update reporter` and `update submitter` are the same. Nothing is sent yet. |
| `send update` | after a draft | Sends the draft to them as an in-game notification. |
| `update: your words` | anytime | Sends your own words to them. |

Anything else is not a command. A reply that ends with a question mark is
answered by Claude without a rebuild. Every other reply is **saved as a note
and nothing is rebuilt**, so "thanks, will test later" costs nothing. To ask
for a change, start the reply with `change:`.

**Deploying from the triage board.** A card with a tested preview has a
**Deploy to the live site** button (and **Live test**), which does the same
as replying `good <build ID>` in Slack. The server checks that you are an
admin and signs the approval for that exact build; the deploy step verifies
the signature before it touches the live site. Keeping or reverting a live
test is still done in the Slack thread.

**When the live site changed after your preview was built.** You do not
test again. When you reply `good <build ID>`, the robot puts the approved
change onto the current live code as it is (the same files, the same
contents, no Claude run) and deploys once. Only when the live code changed
one of the very files your fix touches does it rebuild and ask you to test
the new preview.

## What happens

1. **Report.** A user submits an issue. `submitIssue` posts it to
   #citsci_feedback and the app saves it into Supabase `site_issues`
   (through the `ewCommunityData` server function).
2. **Proposal.** Saving the report starts `triage-propose.yml` straight away,
   and so does the bridge the next time it sees a report waiting. Claude
   reads the code and writes one `feedback_triage` row: no action, send a
   message, bug fix spec, or new feature. Every admin gets a 🗂️ "Feedback
   triage: new suggestion" notification in the app when it is posted.
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
6. **Shipped.** When the tester replies `good <build ID>`, it is merged into
   `eyewire-ii-community` and deployed live. The thread gets "Change
   shipped" with a link to the change. In the game, the person who reported
   it and every admin get a "🎉 Fixed!" notification (confetti Nurro, mint and
   gold card) saying what changed. The reporter also gets a note when their
   report is accepted and being built. Only they are told, never everyone.

## Talking to the robot

Everything happens in the report's Slack thread. Replies are read by fixed
rules, not by a model: the commands in **Exact replies** above must be typed
exactly, a reply ending in a question mark is a question, and anything else
is taken as a change request for Claude.

| When | You want to | Say something like | What happens |
|---|---|---|---|
| Approving | approve, with details | `approve, use a warm gold and leave the tag layer blue` | the text after approve goes to Claude with the spec, and shows in the Admin Hub |
| | turn it down | `dismiss` | nothing is built |
| Claude is building | add details | `also check it on the MEC dataset` | saved as a note, never lost; the preview message lists any that came too late for that build |
| Claude asked a question | answer it | `gold, not lemon yellow` | Claude carries on with your answer |
| Preview is up | ship it | `good <build ID>` | merged and deployed live. A bare `good` is only a note |
| | ask about it | `where do I click to see it?` | Claude answers from what it built; nothing is rebuilt |
| | ask for changes | `change: the yellow is too bright` | Claude fixes it and posts a new preview |
| | add details without a rebuild | `note: Celia prefers amber` | saved for Claude's next attempt |
| | build again now | `rebuild` | a new build with everything in the thread |
| | test on the live site | `ship to test <build ID>` | goes live for a real-data test (sync jobs, Cloud Functions, what other users see) |
| Live test | keep it | `good <build ID>` | stays live, row closed |
| | take it off | `revert <build ID>` | the live site goes back; reply `change: ...` and Claude tries again |
| | report a problem | `change: it broke the tag panel` | recorded; reply `revert <build ID>` to take it off the live site, then Claude builds the correction |
| Anytime | stop everything (already fixed, duplicate, changed your mind) | `stop`, `dismiss`, `cancel`, `close it`, or `stop: already fixed` as the whole reply | any running build is cancelled, nobody is tagged again, the row shows as dismissed in the Admin Hub (approve it there to restart). **Dismiss** in the Admin Hub does the same, at any stage before it goes live. Only an approver or the tester can stop. Not while it is on the live site as a test: `revert` first. Do not start it with @Amy's Claude, which is the Q&A bot |
| | pass the testing on | `hand off to @Celia` | that person becomes the tester and gets the reminders |
| | leave a remark | `note: will test after lunch` | saved, nothing rebuilds. Without `note:` it would be read as a change request |
| | tell the person who reported it | `update sender`, then `send update` or `update: your words` | they get an in-game notification |
| Something failed | try again | `retry` | the failed step runs again |
| | correct it | `change: it's in ExtensionBar.vue, not the settings panel` | Claude tries again with that |

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
| bridge (Slack, sync, clock) | `scripts/slack-triage-bridge.mjs`, `.github/workflows/slack-triage-bridge.yml` | a pass every 45 s through each 10 min slot; also started by a Slack thread reply or an Admin Hub decision |
| proposer | `.github/workflows/triage-propose.yml` | started when a report is saved, or by the bridge when one waits; its own cron is the backstop |
| event wake ups | `wakeWorkflow()` in `functions/index.js` (Firebase `eyewire-ii-e4d52`) | on events, at most once per workflow per 20 s |
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
- Scheduled runs often start 5 to 25 minutes late, so nothing that needs a
  quick answer waits for a cron. Events start the workflows through the
  `GITHUB_DISPATCH_TOKEN` Firebase secret (a fine-grained token: Actions read
  and write on ng-extend only; it needs a seung-lab owner's approval, and a
  403 in the function logs means it is not approved yet). Until then the
  bridge's 45 s passes keep replies within about a minute.

## Safety

- Report text is public input. Claude is told to treat it as data. Its
  session has no push credentials and can only run the build and read-only
  git commands. The workflow pushes one branch after Claude finishes.
- Nothing reaches the live site without a human replying `good` after
  testing the preview.
- Replaces the implementer role in
  `Documents\New project\eyewire-community-agents\TEAM.md` for triage rows.
