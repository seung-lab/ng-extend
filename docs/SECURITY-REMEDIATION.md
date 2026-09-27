# EyeWire II security remediation — 27 September 2026

The production site is https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/.

## Emergency containment

The exposed Google Sheets service-account key was matched by its public-key fingerprint and disabled through Google IAM. Legacy Supabase JWT API keys are disabled; do not select “Re-enable JWT-based API keys,” which would restore the leaked key. The client uses the publishable key. Browser Sheets writeback is temporarily unavailable; application records remain saved separately.

The triage implement, propose, deploy, and Slack bridge workflows were disabled manually. The three model-driven workflows now contain only a security hold. Free-form “good” replies no longer approve deployment, and the bridge no longer invokes a model with repository credentials. Keep these workflows disabled until a reviewed replacement binds explicit approval to a specific commit and separates untrusted feedback from credentials.

## Application and backend changes

Private community reads and protected writes go through the `ewCommunityData` Firebase function, which verifies CAVE identity at fixed trusted endpoints. The server determines profile identity, group membership, notification visibility, saved-link ownership, report author, and chat sender/rank. Clients cannot grant themselves admin status. Historic chat rows without verified identity do not display a staff rank; new chat messages arrive through database change events.

`ewSecureUpload` verifies identity, reserves official uploads for admins, checks image signatures, limits size and frequency, and generates unique paths. The old public screenshot-signing function returns HTTP 410. `ewSecureWrite` verifies admin actions and bounds requests and write frequency.

Guide and notification Markdown share a DOMPurify allowlist; executable markup and remote tracking images are removed. Practice operations accept only named sandbox hosts/tables and do not follow redirects with credentials. Automatic practice resets require a reviewed manifest; the empty manifest deliberately pauses resets until examples are pinned.

Paid model requests have bounded input and atomic per-client/global quotas. Quota storage failures reject requests. Slack bot memory is read-only. Deployment builds run without cloud identity; a separate job uploads a static artifact using pinned Actions and a fixed hosting configuration. Content security, referrer, permissions, and MIME-sniffing headers are set on static responses.

## Rollout order

1. Deploy `ewCommunityData`, `ewSecureUpload`, and the updated Firebase functions from the matching backend security commit.
2. Add `chat_messages.user_id` and enable its Realtime publication (also idempotently included in the migration).
3. Deploy and verify this client on the community site.
4. Apply `supabase-security-private-data.sql` in the project SQL editor. It revokes direct private reads and protected writes, restricts private saved links, and blocks direct writes to the official upload bucket. It does not delete application records.
5. Verify anonymous public profiles still work and anonymous email/internal-notification/triage reads and protected writes fail. Verify a signed-in profile, group administration, chat, and image upload through the gateway.

Tutorial and tags branches must merge the current community branch before rebuilding. They need both the publishable key and the verified gateway integration. Older deployed clients may need reloading after the permission migration. Never undo the database protections or revive leaked keys to support a stale client.

## Validation and remaining work

Production bundling and focused security regression tests pass. Browser rendering tests cover hostile Markdown and ordinary formatting. Backend policy tests cover private data scopes, forged identity, group enrollment, chat roles, and upload signatures. The full TypeScript check remains blocked by extensive vendored Neuroglancer typing errors; it is not reported as passing.

Repository owners still need to enforce protected branches/environments and restrict the Google Workload Identity provider to reviewed deployment refs. The current GitHub account has maintain, not admin, permission. Artifact separation alone cannot stop an authorized repository writer from changing a deployment workflow.

Follow-up work remains: CAVE-authoritative statistics rather than client-reported own counters; ownership enforcement for remaining practice RPCs and community tables; stronger help-reply/Guide-feedback ownership; review of existing bot memory; dependency and vendored typing cleanup; and restoring Sheets integration with a server-held identity. This containment release is not a claim that every review finding is resolved. Do not store private signing keys or service keys in browser source or public Git history.
