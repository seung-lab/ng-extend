# Trusted pilot access

The public site can be viewed by anyone. Community writes, cell claims, practice sessions, Sheets writeback, uploads, Guide requests and submitted feedback require a verified CAVE identity and explicit pilot membership. Existing administrators retain access. A profile or successful sign-in alone does not grant pilot membership.

In **Admin Hub → Pilot testers**, enter the tester’s actual CAVE sign-in email. Pause access there to revoke future requests. Membership is looked up on every request, separately from the short-lived identity verification cache. New profiles may be created for onboarding, but cannot add themselves to the pilot or write other community data. No existing non-admin profiles are automatically enrolled.

CAVE continues to control access to its own scientific datasets. This application’s invitation list protects its community database and gateways; it does not replace CAVE’s dataset permissions.

## Claims and practice

Cell ownership and assignment records change in one database transaction. Competing claims, duplicate task rows for the same segment/point, another owner’s release/completion, and more than three simultaneous claims are rejected server-side. Expiry uses the same lock and does not clear a newer owner’s active assignment.

Practice claims have session identifiers. A reset obtains its own lease from the saved example, checks it before each undo, and cannot interrupt another learner. An old tab cannot reset a later session, even under the same account. Shared-supervoxel examples remain mutually exclusive. Dirty or expired examples wait for the scheduled reset; the former non-atomic browser rescue path is removed. Browser resets have a two-minute execution limit, while the worker only recovers abandoned reset leases after fifteen minutes. Reviewed fixture manifests and no-redirect CAVE requests are retained.

## Automation and secrets

Supabase legacy JWT keys and the exposed Google service-account key remain disabled. The browser uses only the publishable Supabase key. Sheets uses short-lived, server-side identity delegation. The dedicated Sheet runtime in each Firebase project has rate-limit access and delegation to the existing spreadsheet service account; no private key is created or exported.

Triage models run in jobs without database, Slack, deployment, repository-write or workflow-dispatch credentials. A separate trusted publisher validates inert output and the human’s exact-commit approval. Model output cannot modify the pilot client gateways, server functions, SQL, workflows or reset scripts. Static deployment runs in a job without repository checkout or package execution.

## Rollout and validation

1. Apply `supabase-pilot-access.sql` to install the server-only procedures. Existing data is retained.
2. Deploy the verified gateways from `functions/` to the active Firebase endpoints. The client now targets the EyeWire Firebase project, eyewire-ii-e4d52. Equivalent gateway hardening was also applied to the former ytho endpoints for stale clients; their eventual retirement belongs to the Firebase migration.
3. Deploy the client and reset worker, then apply `supabase-pilot-lockdown.sql`. This revokes direct public table writes and RPC execution, including legacy practice RPCs. Service-role jobs retain access.
4. Deploy the token-requiring Guide and feedback functions after the new client is live. Reload existing browser tabs.

Run `npm ci --prefix functions` and `node --test functions/*.test.js`. The PostgreSQL tests exercise real function bodies with disposable local data: membership, racing requests, rollback on claim-limit failure, owner checks, expiry, overlap protection, stale session/reset identifiers and role privileges. Existing browser security, practice-policy and triage-policy tests also apply. Live verification uses read-only health checks, transaction rollback fixtures, and the scheduled automation runs; do not claim or complete scientific cells merely to test security.

Policy references: [Supabase function privileges](https://supabase.com/docs/guides/database/functions) and [PostgreSQL transaction locks](https://www.postgresql.org/docs/current/explicit-locking.html).

## Live verification, 2026-09-28

PR #113 deployed at `5e177cedd9ce73a21b383d171649c46c49c30b23`. Both SQL stages are installed: catalog checks show zero publicly writable public tables and zero publicly executable public functions. No-match REST probes return 401 for task, practice, edit, help and tag writes, the invite roster and pilot RPCs. The service role can still read practice state and invoke the worker lease procedure. Signed-in admin access to Pilot testers was verified; the list starts empty because existing admins already qualify.

The matching gateways, Guide and feedback functions are deployed in `eyewire-ii-e4d52` and the former endpoints. Anonymous paid/feedback calls return 401. Both registered Sheets pass keyless read/write-permission probes. After lockdown, Sheets run 36433752656 and practice run 36433746482 passed. The original merge and cut exercises have verified starting states.

A concurrently added example, `a4bd2f76-67e9-4093-adc7-e670230d1577` (Axon missing a branch), is reversibly disabled pending review. It had empty stable-piece IDs, shared a piece with existing exercises, and its two pieces were already joined at its proposed merge baseline. Read-only inspection 36434117844 captured the evidence; no scientific edits were made for it.

The initial triage test 36433485794 identified an invalid Anthropic key. Its owner replaced the repository Actions secret; run 36434812157 confirmed model authentication and file tools work. That run also correctly refused synthetic test instructions embedded in an untrusted report file. The synthetic instructions now appear directly in the trusted workflow prompt, selected only by the boolean self-test input. Real report text remains untrusted, and model credential isolation is unchanged. Full output is enabled only for synthetic tests.

Corrected synthetic triage integration run 36435257411 passed model execution, file tools, inert artifact export and trusted validation. It created no real report, message, branch or deployment. Tutorial steps no longer load shared editable fallback cells when a claim is unavailable; automatic tools require a held session, and heartbeat failure pauses the tool instead of silently continuing.
