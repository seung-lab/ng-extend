# Restored automation

Sheets import runs at midnight Eastern and only adds new Cell Library rows. Claims, completions and corrected coordinates go through `ewSheetSync`, which verifies the CAVE sign-in and task owner, chooses one of two registered spreadsheets, matches the exact segment row, and fills empty cells using RAW values. A dedicated runtime identity obtains short-lived Google access tokens; there is no browser private key.

Practice reset runs every ten minutes and verifies ready examples. The reviewed manifest pins the sandbox, exercise kind, immutable supervoxels and baseline. Active sessions, including overlapping exercises, are skipped. A conditional lease prevents a stale job from overwriting a changed session. Complete history is paired with CAVE operation details to cancel completed undo pairs, preserving later learner edits and avoiding repeated replay of old resets. Unknown or ambiguous history fails closed; reset success requires checking the resulting roots. `inspect=true` is read-only fixture discovery; `dry_run=true` lists planned operations without changing CAVE or the database.

Triage has separate prepare, model and publish jobs. The model receives no database, Slack, cloud, repository-write or workflow-dispatch credentials. A fresh trusted publisher validates a small source/static/document file artifact, rejects credential material and protected paths, and creates a preview commit through the GitHub API. A separate job builds without deployment credentials; the deployment job serves only static output and fixed hosting configuration.

After testing a preview, its assigned approver uses the exact command shown in Slack: `good <12-character build ID>` or `ship to test <12-character build ID>`. A live test can be undone with `revert <12-character build ID>`. The release job independently reads Slack, verifies the tester and preview announcement, and requires the branch to still name the approved commit. If production changed meanwhile, triage rebuilds for fresh approval. Changes to dependencies, workflows, server policy or authentication need a reviewed pull request.

Scheduled workflows must also be registered on `main`. They check out trusted community code with pinned actions. Register changes to the divergent default branch using `[skip ci]`; do not deploy its old application source. Never re-enable leaked legacy keys.

## Verified on 27 September 2026

- The [first import](https://github.com/seung-lab/ng-extend/actions/runs/36322892723) added 2,331 cells. A [repeat import](https://github.com/seung-lab/ng-extend/actions/runs/36325274733) added zero, with zero failures. The production Cell Library displays the imported cells.
- `ewSheetSync` health checks verify read access and perform identity replacements on actual write columns, without changing cell values. Both source sheets pass. Protected reference columns stay protected. Backend commit `61389a1` records the deployed integration checks.
- The [model integration self-test](https://github.com/seung-lab/ng-extend/actions/runs/36324845098) passed file editing, export and trusted artifact validation, with no real report, Slack message, branch or deployment created. Run Triage Implement with `self_test=true` to repeat it. Proposer and Slack bridge also completed their first runs; their queues were empty.
- [Read-only practice inspection](https://github.com/seung-lab/ng-extend/actions/runs/36324841990) verified the pinned starting states. The complete history query exposed practice merge 1667, omitted by the default filtered query; the [dry run](https://github.com/seung-lab/ng-extend/actions/runs/36325272131) selected only that post-baseline operation.
- The [real practice reset](https://github.com/seung-lab/ng-extend/actions/runs/36325372302) undid that single merge and verified the restored starting state. The [production build and deployment](https://github.com/seung-lab/ng-extend/actions/runs/36325271073) passed.

No production release approval was fabricated to test triage. The isolated model path and static deployment path were tested separately. A real report still requires its assigned tester's explicit approval before release.

The security task's local `STATUS.md` records final reset and rollout results. The September 28 pilot update moves task ownership and practice leases behind verified invitations; `PILOT-SECURITY.md` describes the transaction tests and enrollment. Repository-owner controls remain documented in `SECURITY-REMEDIATION.md`.
