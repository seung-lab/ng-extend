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
