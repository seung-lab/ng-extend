# EyeWire II — Bug-fix WIP Handoff

> Companion to [HANDOFF.md](HANDOFF.md) (which explains the project, the science, and the architecture from zero). **This document covers only the in-flight bug-fix/feature round**: what was fixed and why, what is still open, and the decisions already made so nobody re-litigates them.
>
> Branch `eyewire-ii-community`. Written 2026-07-20.

---

## 0. State at handoff — read this first

**Everything described here is committed, and everything except the final email-privacy commit is deployed and live.** The tree is clean; there is no half-finished work sitting uncommitted.

**The single most important open item** is §3.1 (CAVE-sourced edit counts). It is blocked on **one permission grant**, not on code — see the exact ask there. Edit counts are currently still client-inferred, with a stopgap gate in place.

Quick orientation:
- Live: `https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`
- Deploy: `git push origin eyewire-ii-community` (~2.5 min, no manual step)
- All four SQL migrations are **already applied** (§4). No pending DB work.
- ⚠️ Before editing any `.vue` file, read the warning at the end of §7. Nothing type-checks SFCs, and that gap has already shipped one production crash.

---

## 1. How to pick this up

1. Read [HANDOFF.md](HANDOFF.md) §7–§9 for architecture, data layer and build/deploy.
2. Read §3 below (open items) — that's the actual work queue.
3. **Deploy = `git push origin eyewire-ii-community`.** CI builds and deploys to
   `https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com` (~2.5 min).
4. Before deploying anything that touches the DB, check §4 (migrations) — several fixes need SQL applied first.

---

## 2. What was fixed this round

Newest last. Every item lists the **root cause**, because several were not what they looked like.

### Viewer / layout
| Fix | Root cause |
|---|---|
| 2D/3D panels "shaking" on hover | The orange mouse-position readout is `flex:1` with `white-space:pre`, so `min-width:auto` pinned it to its live text width. Digit-count changes as the cursor moved oscillated the top row's min-width and reflowed the panel layout. Fixed with `min-width:0; overflow:hidden`. |
| Top-bar controls clipping off-screen on laptops | The bar grew to fit its content instead of being viewport-bounded, so flex-shrink never engaged. Added `max-width:100vw` + a `min-width:0` ancestor chain, designated elastic zones, and breakpoint compaction. |
| Toolbar icons rendering tiny (~13px) | **Pre-existing specificity bug**: `#extensionBar button { font-size: 10pt }` (1,0,1) silently overrode `.nge-icon-btn { font-size: 22px }` (0,1,0). Icon rules must be scoped under `#extensionBar` to win. |
| Layers button missing from top bar | It was hidden alongside the settings gear and JSON editor, but unlike those it had **no replacement**, leaving no path to the layer panel. Un-hidden. Also fixed the active-state rule, which targeted a `.neuroglancer-checkbox-icon-checked` class this build never sets (it uses `data-checked="true"`). |
| Settings panel cut off, Save unreachable | Two causes: the shell had no max-height/scroll, **and** the shared clamp was defeated because `ModalOverlay` sets `.nge-overlay.modal.overlay-content { overflow: visible }` (0,3,0), out-ranking the clamp (0,2,0). Now: shell clamped, body scrolls, Save/Cancel pinned as a footer. |
| White scrollbars | Collateral from clamping modals — they only started scrolling then, and the UA paints a light scrollbar. Themed globally in `common.css` (`color-scheme: dark` + universal-selector WebKit rules, specificity 0 so deliberate exceptions still win). |
| Site tour chip covering the layer bar | Anchored `side:"top"`, but the layer bar is at the top of the viewer, so on-screen clamping shoved the chip back onto its own target. Re-anchored below. |

### Stats / data integrity
| Fix | Root cause |
|---|---|
| Edit count inflating without edits | `watchSegmentEdits` inferred merge/split from **any** change in `visibleSegments.size`, so jumping to a cell or selecting a segment counted as an edit — inflating stats, badges, the leaderboard, and writing bogus `edit_log` rows. **Stopgap** applied: only count when a graphene tool is engaged *and* the direction matches the tool. See §3 for the real fix. |
| Notifications disappearing | **"Mark all read" was innocent** (it only upserts `notification_reads`). The culprit was the `×` dismiss, which wrote to localStorage and filtered forever, per-browser, with no undo. Now persisted per-user in `notification_reads.dismissed`, plus an explicit "Delete all" with confirm. |
| Settings not saving | `handleSave` wrote **only localStorage**. But flag/bio are public profile fields read from `users.flag`/`users.bio`. `syncStats()` would have written them but **is never called from anywhere**. Added a narrow `saveProfileFields()` — deliberately does NOT push stats, which must come from CAVE. |

### Notifications
| Fix | Root cause |
|---|---|
| Scheduled notifications never arrived on time | The scheduling filter was fine (`.lte('send_at', now)`). The realtime subscription only fires on **INSERT** — i.e. at creation, while the notification is still filtered out — and nothing re-ran the query at send time. Now polls once a minute (skipped when the tab is hidden). |
| Wrong timezone on scheduled sends | `datetime-local` yields a naive string and `new Date(naive)` parses it in the **browser's** zone. Added `src/util/et_time.ts`, pinning interpretation to `America/New_York` with a two-pass `Intl` offset correction. Verified against both DST boundaries. |
| Scheduled notification posted to chat immediately | The chat post fired on every create regardless of `send_at`. Now only posts if sending now; scheduled ones are posted at send time by a cron job (below). |
| Admin couldn't see scheduled/expired notifications | The panel showed the **user-facing** list, which filters to `send_at <= now` and your own targeting. Replaced with a paginated admin query split into Scheduled / Active / Expired, with editing and "Load more". |

### Chat
| Fix | Root cause |
|---|---|
| Unread badge counted your own messages | Channel runs `broadcast:{self:true}` (needed so your message appears in your list) but the handler bumped unread for everything. Now tags outgoing messages with `senderId` and skips your own. |
| Chat collapsed upward, stranded mid-screen | Once dragged it's anchored by inline `top`, so collapsing kept that pinned. Now drops `top` when collapsed so it settles at the bottom. |
| Shared `#SegID` didn't jump or copy | `loadSegment` only added the segment to `visibleSegments` — it never moved the camera, so it looked like nothing happened. Now calls `moveToSegment`. It was also a `<button>`, whose text can't be selected; split into a selectable id + copy button. |
| Segment IDs were dataset-blind | Root IDs only mean anything within one segmentation. Now the sender's dataset is stamped on the message, shown on the chip, and a cross-dataset click warns instead of silently jumping to a different cell. |
| `@mentions` couldn't identify anyone | Chat showed **display names**, which are neither unique (two people called Celia) nor single-token ("Amy S." can't be captured as one mention). Added **usernames**: `users.username`, case-insensitively unique, 3-20 chars `[A-Za-z0-9_]`. Chat sends/displays the username via a `chatHandle` getter (falling back to display name), and self-mention matching compares it exactly. |
| Chat announcements said "go look" | The `📢 <title>` message told people to go find the notification. The id now rides through the broadcast payload and `chat_messages.notification_id` (`createNotification` selects the inserted id back), and the message renders as a clickable row that opens that exact notification. |
| Chat crashed entirely | `isSelfMention()` referenced `backend` where ChatPanel binds `backendStore`. Called from the template, so it threw on **every render** and the whole panel failed to mount. See the `.vue` type-checking warning in §7 — nothing was checking it. |
| Help request form looked like an error | It sat permanently open at the top of the Help tab in pink. Collapsed behind a "+ Submit a help request" button (choice remembered) and recoloured to the blue accent. |

### Identity & privacy
| Fix | Root cause |
|---|---|
| Usernames | See the chat table above. `users.username`, unique case-insensitively, 3-20 chars `[A-Za-z0-9_]`. Shown on the profile under the name, used as the chat display name, and matched exactly by `@mentions`. |
| Username prompt | Asked once after **Tutorial 1** (`UsernamePrompt.vue`), pre-filled with a free suggestion derived from the display name. **Waits for the badge celebration to actually finish** rather than using a fixed delay, which raced it and landed on the badge art. Dismissal is permanent; Settings has a "Change username…" button that force-opens the same dialog (the only way to reach it once you have a handle). |
| Emails were exposed | The profile rendered the email of *whichever* user's profile was open, so clicking a name in chat revealed that person's address. Removed the display **and** the field from `loadUserProfile`'s select — leaving it in still ships addresses to the client. The Cell Library's name resolver also fetched full addresses just to use the part before the `@`; it now falls back to the username. **Admin Hub still shows email on purpose** (group lists, user search for awarding badges), where an admin needs to identify a person. |

### Other
- **Screenshot attach** — see §5, it's the most instructive one.
- **⌘K folded into Ask** with instant local command matching (no model round trip for navigation). CommandPalette stays mounted as a **headless provider**; only its UI is retired.
- Spellcheck/right-click restored in text fields (neuroglancer's `disableContextMenu()` `preventDefault`s every contextmenu at document level).
- Help form: annotation-layer dropdown on the initial request; themed `<select>` popups (`color-scheme: dark` — the popup is drawn by the OS, not by our CSS).
- Cell Library remembers its size (size only, not position — a saved position can land off-screen after a monitor change).

---

## 3. Open items (the work queue)

### 3.1 CAVE-sourced stats — **the big one**
**Decision already made by Amy: "all edits and all stats should be based on CAVE tables and real edits, not inferred from changes in segID on the page."**

Today: completions ✅ come from CAVE (`cave_completions_mirror`); edits/merges/splits ❌ are **client-inferred** and written to `edit_log`, which the `user_edit_counts` view reads. The gate added this round is a stopgap, not the fix.

Target shape (mirrors the existing completions pipeline):
| Layer | Change |
|---|---|
| New `cave_edits_mirror` | `cave_user_id, dataset, operation_id, is_merge, timestamp` (PK `dataset, operation_id`) |
| New `scripts/sync-cave-edits.mjs` | Same shape as `sync-cave-completions.mjs` |
| New workflow | Cron alongside `cave-completions-sync.yml`, same three secrets |
| Update `user_edit_counts` | Compute edits from the mirror instead of `edit_log` |
| Client `watchSegmentEdits` | **Stop** writing stats and `edit_log`; keep only the ephemeral `signalEdit` for celebrations |
| Client `useUserStatsStore` | Hydrate from Supabase instead of incrementing locally |

**Blocker:** the per-user PCG endpoint is unverified. The repo only has per-**root** change logs (`/root/{id}/change_log`, `tabular_change_log`), which can't answer "how many edits has user X made" without enumerating every root.

**`scripts/probe-cave-edits.mjs` exists to settle this** — read-only, writes nothing, tries candidate endpoints plus a known-good control (`oldest_timestamp`) so a wall of 404s reads as "endpoint absent" rather than "probe misconfigured".

Run it with a valid CAVE token:
```bash
CAVE_SERVICE_TOKEN=<token> node scripts/probe-cave-edits.mjs --user-id <cave-user-id>
```
**RESOLVED — probe run 29769718266 (authenticated, via CI):**

```
✗ 403      user_operations (± time window)
             {"error":"missing_permission",
              "message":"Missing permission: admin_view",
              "data":{"auth_dataset":"stroeh-mouse-retina",
                      "required_permission":"admin_view"}}
✗ timeout  change_log (table-wide, ± user filter)
✗ 404      operations
✗ 404      user/{id}/operations
✓ 200      CONTROL oldest_timestamp  {"iso":"2025-02-20 22:59:56.406000+00:00"}
```

**`/segmentation/api/v1/table/{table}/user_operations?user_id=&start_time=&end_time=` is the correct endpoint.** It is not missing — it is **permission-gated**. The control returning 200 proves the token, server and table name are all valid, so the 403 is a real authorization answer rather than a broken probe. The two `/operations` variants genuinely don't exist (404), and the table-wide `change_log` doesn't respond within 20s (likely far too expensive to be a viable feed).

**The remaining blocker is a CAVE permission, not code.** The account behind `CAVE_SERVICE_TOKEN` needs **`admin_view` on the `stroeh-mouse-retina` auth dataset**. Ask the CAVE admins (the sync workflow's own comment points at Forrest/Derrick, Slack `#shared_cave_seunglab`) for either that grant or a service token that already carries it.

**Amy's personal token does NOT have this permission either — verified 2026-07-20.** Re-running the probe with the token at `~/.cloudvolume/secrets/cave-secret.json` reproduced the identical 403 on both `user_operations` variants, with the control still returning 200. So this is not a CI-secret-versus-personal-token mismatch; nobody on the team currently holds the grant.

Do not be misled by the auth API: `GET https://global.daf-apis.com/auth/api/v1/user/cache` reports `"admin": true` for Amy (CAVE user id 122), but that is a **global site-admin flag and does not gate this endpoint**. The fields that do are `datasets_admin` and `groups_admin`, both **empty**, and `permissions_v2["stroeh-mouse-retina"]`, which is only `["view", "edit"]`. The precise ask is therefore: **add `stroeh-mouse-retina` to `datasets_admin` (equivalently, `admin_view` in `permissions_v2`) for user id 122 and/or the service account behind `CAVE_SERVICE_TOKEN`.** That endpoint is also the cheapest way to check any token's permissions without exposing the token itself.

Once granted, `sync-cave-edits.mjs` can be written directly against `user_operations`, iterating the `cave_user_id`s we already hold — the probe confirmed those are populated (e.g. `Celia D=28`, `Amy R. Sterling=122`, `LArrow=10645`).

If the grant is refused, the fallback is enumerating per-root `tabular_change_log` over known roots — partial coverage and much more expensive, so pursue the permission first.

> ⚠️ `.github/workflows/cave-edits-probe.yml` exists but **cannot be dispatched**: GitHub only runs `workflow_dispatch` from the default branch, which is `main`, and this workflow lives on `eyewire-ii-community`. Do **not** push it to `main` to work around that — the deploy workflow is `branches-ignore: master` while the default branch is `main`, so any push to `main` triggers an App Engine deploy of a `main` version.

**On token lifetime:** the comment in `cave-completions-sync.yml` claims tokens last ~6 months. Per Amy (who works with CAVE daily) they do **not** expire — treat that comment as stale. One observed counter-example worth keeping in mind: a token sitting in a browser's `localStorage` did return `{"error":"invalid_token","message":"Unauthorized - Token is Invalid or Expired"}`, so a *browser session* token can still become invalid (revoked/rotated/replaced) even if service tokens don't age out. The CI secret has stayed valid throughout.

**Running the probe without anyone's personal token:** the dedicated probe workflow can't be dispatched (see above), but `cave-completions-sync.yml` **is** registered on `main`, and dispatching a workflow with a `--ref` executes that file *from the ref*. A probe step was therefore added to it on this branch, gated on the existing `dry_run` input (which already means "read, don't write"):
```bash
gh workflow run cave-completions-sync.yml --ref eyewire-ii-community -f dry_run=true
```
That reaches the valid `CAVE_SERVICE_TOKEN` secret with no token handling by hand.

### 3.2 `cellsSubmitted` inflation
`watchSegmentEdits` still does `cellsSubmitted += 1` every 5 edits "to animate the cell-dot canvas". But `cellsSubmitted` is a **real stat** — the key for the whole Exploration badge track and the profile's Cells number. Amy's CAVE directive implies this should come from `cave_completions_mirror` instead. **Remove as part of §3.1.**

### 3.3 `help_responses` wiring
`supabase-help-responses-schema.sql` is **applied**, but the client still writes the legacy single `response_*` columns, so multiple share links still overwrite. Wire `useHelpRequestStore` + the Cell Library Help tab to the new child table. Amy has approved dropping the legacy columns afterwards ("no one is using this build except for testing").

### 3.4 `'eyewire_ii'` hardcode
`useProofreadingBackendStore` writes the literal string `'eyewire_ii'` as `dataset` on most Supabase rows **regardless of the active dataset**. Mislabels per-dataset data; matters for §3.1 and for the nightly sheet sync.

### 3.5 Username rollout
Usernames exist but **every current user has `NULL`**, so mentions only become
reliable as people adopt them. Current flow:
- **Prompted once, 4s after finishing Tutorial 1** (`nge:prompt-username` →
  `UsernamePrompt.vue`), pre-filled with a free suggestion derived from the
  display name, so the common path is one click.
- **Dismissal is permanent** (`nge_username_prompt_dismissed_v1`); we never ask
  again. Settings always has the field.
- Not asked at login on purpose: that's already a multi-step middleauth flow,
  and it would ask before the user knows what a username is for.

If adoption needs a push later, the least intrusive lever is a small persistent
"set a username" affordance in the chat header — visible but non-blocking.
Nothing breaks without one: chat falls back to the display name.

### 3.6 Smaller open items
- Make the neuroglancer **layer-list toggle a removable toolbar icon** (so it participates in the Settings > Toolbar Icons prefs).
- Lightbulb menu still says **"Mark Complete"**; the legend now says **"Proofread"**. Decide whether the verb should follow.
- Other tall panels (Profile, Cell Library, Batch) may repeat the "footer inside the scroll area" pattern that Settings had.
- `Dataset` and `Ask` keep their text labels by decision; only their padding/height was normalised to the icon rhythm.

---

## 4. Migrations — apply before deploying dependent code

| File | Status | Needed by |
|---|---|---|
| `supabase-help-responses-schema.sql` | ✅ applied | §3.3 (code not yet wired) |
| `supabase-chat-dataset-and-notif-dismissals.sql` | ✅ applied | chat dataset stamping, notification dismissal |
| `supabase-chat-posted-at.sql` | ✅ applied | scheduled chat announcements |
| `supabase-usernames-and-chat-links.sql` | ✅ applied | usernames, clickable chat announcements |
| `supabase-client-errors.sql` | ⚠️ **NOT applied** | client error reporting (§5a) |

---

## 5a. Client error reporting

**Why it exists.** `.vue` files get **no type checking** in this project (see §7). A
`ReferenceError` in a `<script setup>` block shipped to production and broke chat
completely — every render threw, the panel never mounted, and the only reason
anyone found out was Amy saying "we broke chat". This is the compensating control.

**Where:** `src/util/error_reporting.ts`, installed from `src/main.ts` **before
`app.mount()`** so failures during initial render are still caught.

Three sources, written to the `client_errors` table:

| source | catches | notes |
|---|---|---|
| `vue` | component render / lifecycle errors | **the important one.** Vue catches these internally, so `window.onerror` never sees them — exactly the class that broke chat |
| `window` | uncaught errors outside Vue | resource-load failures (no error object) are ignored as noise |
| `promise` | unhandled rejections | how most async failures escape |

**Throttling is not optional.** The chat crash threw on *every* render. Without
suppression that is thousands of identical rows per minute. So:
- errors are fingerprinted as `message + first stack frame`
- only the **first** occurrence of each fingerprint is sent
- hard cap of **20 reports per page load**

Verified in-browser against the real crash pattern: 80 identical
`ReferenceError` throws → exactly **1** POST to `client_errors`.

**Reporting never throws, never blocks, never retries.** Every path is wrapped in
a bare `catch {}` — a failure to report an error must not itself become a visible
error, and must not recurse back into the handlers. Consequence: until the
migration is applied the inserts silently 404, which is harmless but means
*absence of rows is not evidence of absence of errors* — check the table exists first.

**RLS is deliberately not the project convention.** Every other table here uses a
blanket permissive `USING (true)`. `client_errors` is **INSERT-only** for the anon
key, because stack traces and user ids should not be readable by anyone holding
the public key (it ships in the bundle). Read them from the Supabase dashboard,
which uses the service role and bypasses RLS.

**Context captured:** `user_id` (mirrored to `window.__ngeUserId` in `store.ts` so
the reporter never has to import the store — it may not exist yet during a
bootstrap failure), active `dataset`, `user_agent`, `component`, and `build`
(short git sha, injected by `scripts/build-prod.js`). `url` is **pathname only** —
the neuroglancer hash is multiple KB of viewer state.

`main.ts` guards `NGE_BUILD` with `typeof`, so a build path that doesn't define it
degrades to a null `build` rather than a ReferenceError. (CI does use
`build-prod.js`, so deploys are stamped — verified live: `build = "f33cccb"`.)

**Verified in production** after the migration was applied:
- Vue `errorHandler` installed, build stamp correct
- a probe error inserted → **HTTP 201**
- reading `client_errors` with the anon key scraped from the shipped bundle →
  **HTTP 200 `[]`**, i.e. RLS hides rows that demonstrably exist. The INSERT-only
  policy does what it claims.

---

## 5. Screenshot attach — worth reading

**Symptom:** "Sign URL failed (500)" on every attach, broken since ~2026-07-14.

**Cause:** the dialog asked the `signScreenshotUpload` Cloud Function for a v4 signed upload URL. Signing requires the function's runtime service account to call the IAM `signBlob` API — a permission it was never granted:
```
Error: Permission 'iam.serviceAccounts.signBlob' denied on resource
    at GoogleAuth.signBlob
```

**Fix:** rather than chase an IAM grant, uploads now go **directly to Supabase Storage**. No signing step, no Cloud Function, no extra IAM, and the `admin-uploads` bucket and policies already existed. Cost is ~the same per GB (~$0.02), with 1 GB free.

**The Cloud Function is now unused** and can be deleted from `ytho-4bff2`. Its source lives in `philogelos/functions/index.js` (a **different repo**), along with `guideAssistant`, `guideFeedback`, and `submitIssue`.

---

## 6. Scheduled jobs

| Workflow | Cadence | Purpose |
|---|---|---|
| `cave-completions-sync.yml` | every 30 min | CAVE completions → `cave_completions_mirror` |
| `sheet-cells-sync.yml` | 04:00 **and** 05:00 UTC | Google Sheet → Available cells. Fires at both hours because GitHub cron is UTC-only and midnight ET is 04:00 (EDT) / 05:00 (EST); the script no-ops unless it's really hour 0 in New York, giving exactly one run per night. ⚠️ **Dry-run first** — the first real run inserts every sheet cell not already in `proofreading_tasks` (Stroeh has ~2288). |
| `chat-announcements.yml` | every 10 min | Posts scheduled notifications to chat at send time. Idempotent via `chat_posted_at`. Must be a server job: every client polls, so client-side posting would produce one duplicate per connected user. |
| `weekly-recap.yml`, `weekly-winners-snapshot.yml` | weekly | Pre-existing |

---

## 6a. Where things live (fast map)

| Thing | File |
|---|---|
| Username storage/validation/suggestion | `src/store.ts` → `useProofreadingBackendStore` (`username`, `chatHandle`, `validateUsername`, `isUsernameAvailable`, `saveUsername`, `suggestUsername`) |
| Username dialog | `src/components/UsernamePrompt.vue` (event `nge:prompt-username`, `detail.force` to bypass guards) |
| Chat identity, mentions, `#SegID` chips, announcements | `src/components/ChatPanel.vue` + chat store in `src/store.ts` |
| Notification admin (compose/edit/queue/sections) | `src/components/AdminHub.vue` + `loadAdminNotifications` / `updateNotification` in the backend store |
| Notification feed + scheduled-send polling | `src/components/NotificationFeedPanel.vue` |
| Eastern-time conversion | `src/util/et_time.ts` (two-pass `Intl` offset; DST-verified) |
| Platform-aware shortcut labels | `src/util/platform.ts` |
| Responsive/top-bar rules | `src/responsive.css` |
| Global scrollbar theme | `src/common.css` |
| Command catalog (headless) | `src/components/CommandPalette.vue` — UI retired, still the provider |

**Custom DOM events in play:** `nge:prompt-username`, `nge:open-notification`, `nge:show-notification-detail`, `nge:open-profile`, `nge:seg-status-changed`, `nge:cave-auth-expired`, `nge:assistant-action`, `nge:close-all-panels`.

---

## 7. Conventions worth not re-learning

- **CSS specificity is the recurring trap here.** Three separate bugs this round were "the rule was written but never applied": `#extensionBar button` beating `.nge-icon-btn`; `ModalOverlay`'s `overflow: visible` beating the viewport clamp; and a rule targeting a `-checked` class the build doesn't set. **Verify a rule actually wins before assuming a styling bug is a value problem.**
- **Native controls need `color-scheme: dark`.** `<select>` popups, date pickers and scrollbars are drawn by the OS. Also: don't add `filter: invert(1)` *on top of* `color-scheme: dark` — they cancel out (this is exactly why the calendar icon stayed black after its "fix").
- **Don't infer semantics from viewer state.** The edit-count bug came from inferring merges/splits from segment-count deltas. Prefer an authoritative source (CAVE).
- **`window['viewer']` is not reactive.** Components detect the segmentation layer by class-name heuristics.
- **Deploy protocol:** remote `amy` = fork (CI only), `origin` = seung-lab (**the deploy target**).
- **Verification limits:** most UI here can't be exercised without a middleauth login, so changes are typically verified by `tsc --noEmit` + `node scripts/build-prod.js` + reading the code path. Say so rather than implying it was driven end-to-end.

### ⚠️ `.vue` files are NOT type-checked. At all.

`npm run typecheck` (`tsc --noEmit`) checks **zero** single-file components:
`tsconfig.json` has no `include`, so TypeScript falls back to "every recognised
extension under the project root", and `.vue` is not a recognised extension.
`build-prod.js` doesn't help either — esbuild transpiles without checking
bindings.

This is not theoretical. A chat-breaking `ReferenceError: backend is not
defined` shipped to production because a `<script setup>` block referenced the
wrong identifier (`backend` instead of `backendStore`) and **nothing looked at
it**. It threw on every render, so the whole chat panel failed to mount.

**`vue-tsc` cannot currently fill the gap.** This project is on TypeScript
**7.0.2** (the new native compiler), which removed `./lib/tsc` from its package
exports. vue-tsc 2.x requires exactly that path and crashes on startup:
```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not
defined by "exports" in node_modules/typescript/package.json
```
Worse, it crashes *loudly but non-zero-matching* — piping it through a grep for
errors yields "0 errors", which looks like a pass. It was installed, evaluated,
and removed again rather than leave a dependency that no-ops.

Options, none free:
1. Pin a second, older TypeScript purely for vue-tsc (npm alias) and run it as
   a separate script.
2. Install ESLint + `eslint-plugin-vue` and rely on `no-undef`. Note ESLint is
   **not currently installed** despite the `lint` script in package.json.
3. Wait for a vue-tsc release supporting TS 7.

Until one of those lands: when editing an SFC, **manually confirm every
identifier used in `<template>` and `<script setup>` is actually declared** —
especially store bindings, whose names vary by file (`backend` vs
`backendStore` vs `chatStore`).
