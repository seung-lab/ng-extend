# Restored automation

Sheets import runs at midnight Eastern and only adds new Cell Library rows. Claims, completions and corrected coordinates go through `ewSheetSync`, which verifies the CAVE sign-in and task owner, chooses one of two registered spreadsheets, matches the exact segment row, and fills empty cells using RAW values. A dedicated runtime identity obtains short-lived Google access tokens; there is no browser private key.

Practice reset runs every ten minutes and verifies ready examples. The reviewed manifest pins the sandbox, exercise kind, immutable supervoxels and baseline. Active sessions, including overlapping exercises, are skipped. A conditional lease prevents a stale job from overwriting a changed session. Unknown operation-history formats fail closed; reset success requires checking the resulting roots. `inspect=true` is read-only fixture discovery; `dry_run=true` lists planned operations without changing CAVE or the database.

Triage has separate prepare, model and publish jobs. The model receives no database, Slack, cloud, repository-write or workflow-dispatch credentials. A fresh trusted publisher validates a small source/static/document file artifact, rejects credential material and protected paths, and creates a preview commit through the GitHub API. A separate job builds without deployment credentials; the deployment job serves only static output and fixed hosting configuration.

After testing a preview, its assigned approver uses the exact command shown in Slack: `good <12-character build ID>` or `ship to test <12-character build ID>`. A live test can be undone with `revert <12-character build ID>`. The release job independently reads Slack, verifies the tester and preview announcement, and requires the branch to still name the approved commit. If production changed meanwhile, triage rebuilds for fresh approval. Changes to dependencies, workflows, server policy or authentication need a reviewed pull request.

Scheduled workflows must also be registered on `main`. They check out trusted community code with pinned actions. Register changes to the divergent default branch using `[skip ci]`; do not deploy its old application source. Never re-enable leaked legacy keys.

Verification and rollout results are recorded in the security task's `STATUS.md` and GitHub Actions run links.
