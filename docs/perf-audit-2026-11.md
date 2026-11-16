# Pyr performance audit, November 2026

Audited 2026-11-14 against `origin/eyewire-ii-community` at d62ee87c, the live code. Two questions:

1. What gets worse when many people map at once?
2. What makes the page itself slow?

## Sources

- The code.
- Read-only database statistics: `pg_stat_statements` since 2026-11-03 (11.6 days), `realtime.subscription`, `pg_publication_tables`, `cron.job`, `pg_indexes`, and row counts.
- The console logs attached to player reports in `site_issues`.
- The live bundle.

Nothing was run that changes the database.

## Fixes on this branch

The fixes are on branch `claude/perf-audit-c0d3ac`, one commit each. Nothing is pushed or deployed.

| Commit | Fix | Finding |
|---|---|---|
| b18ffb39 | Lightbulb: a live query that is refused 3 times in a row is skipped for 5 minutes, and the snapshot is asked straight away. Answers are read exactly as before | S4 |
| 98da4b5b | Freeze lines in the console now say how long neuroglancer's draws took in the last 15 s | C1 |
| 93518d17 | Chat without Realtime: a hidden tab polls once a minute instead of every 8 s | S6 |
| 7d50fdf3 | Radio dock: no layout measuring every 350 ms in hidden tabs | C10 |
| f88a0e7d | The old `pyrdev.eyewire.org` leaderboard loop no longer starts. Nothing showed its data | S3 |
| 88df2ee7 | Invalid-ID check looks only at the IDs just added | C3 |
| eadc456d | Sandbox Hunt veil: one sweep per burst of changes | C3 |
| 7cbbac39 | Highlight: lab points are scanned only when a point is added, not on every drag step | C3 |
| 9bc67fba | View autosave: no JSON made when the view hasn't changed; an oversized view is not serialized again until it changes | C2 |
| 3888b14a | Unread-notifications dot: rewritten only when the count changes | C7 |
| ab4a5e55 | Friendly layer names: titles looked up once per pass; no pass in hidden tabs | C7 |
| 099b9623 | Starship intro: the idle-turn loop ends once the player moves the cell by hand | C8 |
| 64dd9a04 | **Chat joins, leaves and completion lines come from one small table** (`supabase-live-events.sql`). Needs SQL; uses the old subscriptions until it is run | S1, S2 |
| 508a08ea | After an edit, only claims of this dataset seen in the last 30 s have their current ID looked up | S5 |
| 06a96ccf | After a hunt, the awards poll backs off from 5 s to 30 s | S10 |
| d6f8ee65 | Cell Library: the orbiting JUMP dot ticks in its own small component | C7 |

Checks run:

- `node scripts/build-prod.js`: 0 errors after each batch.
- `tsc --noEmit`: no new errors. The ones it reports were there before, in files these commits don't touch. `tsc` does not check `.vue` files.
- `node --test functions/*.test.js`: 455 pass, including the new `functions/live-events.test.js`.

Nothing here was tried in a browser against the live services. Chat and claims need a signed-in player.

---

## Summary

### The database is not under strain today

Over 11.6 days, all statements together used about **2% of one CPU core**:

| Share | What |
|---|---|
| 74% | Supabase Realtime reading the change log (the "WAL poll"): 2.08 M calls at 6.9 ms |
| 10.5% | `refresh_leaderboard_cache()` every minute: 124 ms each |
| 3.1% | `refresh_dataset_stats_cache()` every 30 minutes: 1.1 s each |
| the rest | small; `statusFromEditLog` reads are 0.1 ms thanks to `idx_editlog_segment_after_hash` |

Today's traffic: 16 editors in the last 24 hours, 1,190 `edit_log` rows, a peak of 225 edits an hour, and 6 players online at the time of the audit.

### What will not scale: Realtime "postgres changes"

- Every tab of every signed-in player subscribes to row changes on `chat_presence`, `edit_log`, `chat_messages`, `chat_reactions`, `help_requests` and `issue_tags`.
- With 6 players online there were **161 live subscriptions**, about 2.7 tabs per player.
- For each changed row, Realtime checks every subscriber to that table against row-level security and sends it to each one.
- Presence heartbeats are themselves row changes. So presence traffic grows with the **square** of the number of players: each of N players beats once a minute, and each beat goes to all N.
- Details in S1 and S2.

### The client sends 45–75 requests a minute per active mapper

That is for one visible tab with chat open, 5 open claims, and 3 merges or cuts a minute.

- About 60% go to the lab's servers: the chunkedgraph and CAVE materialize.
- About 15% go to the Firebase gateway. Each gateway call does 4–7 more operations on the backend.
- The rest go to Supabase directly.

See the table under "Requests per minute".

### The Retina freezes are not our scripts

- Nseraf reported 5 s freezes about every 8 s on Firefox, on the Retina, with 21 cells and 1 mark. Each freeze comes 1–6 s after a burst of lightbulb lookups.
- Chrome lines for the same kind of freeze on the Retina (Jingkai_Li, 4.7 s) say `scripts 0ms, render 1ms, blocking 0ms`. The page was waiting, not computing.
- That points at the graphics card.
- A likely contributor: Pyr raises neuroglancer's GPU cache to 2 GB and its system cache to 3 GB for everyone (`src/store.ts:455-456`).
- Details in C1.

---

## Requests per minute

### Per active player

Assumptions for one player: one visible tab, chat open, 5 open claims, 3 merges or cuts a minute, and a completion every 20 minutes.

| What | Where | Requests/min |
|---|---|---|
| Claim root refresh after edits: chunkedgraph `root` + `lineage_graph`, about 2 × claims + 1 per burst | `store.ts:5382-5391` → `refreshLiveRoots` (`5229`), `refreshLaterRoots` | 15–33 |
| Lightbulb status for new roots: CAVE materialize, 2 tables | `lightbulb_service.ts:216` | 12–24 before b18ffb39, **6–12 after** |
| `activity.log` per edit, through the gateway (about 7 backend operations each) | `store.ts:283`, `4317` | 3 |
| `activity_feed` insert per edit | `store.ts:283` → `4605` | 3 |
| Old pyrdev leaderboard + userInfo | `store-pyr.ts:52` | 3 before f88a0e7d, **0 after** |
| Retina lab sheet lookups (`ew_retina_lab_sheet_match`, 72 k calls in 11.6 days) | `util/lab_sheet.ts:144` | 1–3 |
| `user_views` autosave of the whole view | `util/view_autosave.ts:42` | 1–2 (large body) |
| Presence heartbeat, through the gateway | `store.ts:7444` | 1–2 |
| Claim time beat, through the gateway | `util/claim_time.ts:333` | 1 |
| Notifications, leader tab | `store.ts:6379` | 1.2 |
| Who is online, leader tab | `store.ts:7263`, `7456` | 1 |
| Leaderboard (8 queries) | `ChatPanel.vue:402`, `store.ts:4870` | 0.8 (4 with the board open) |
| Small things: version check, teams, visit, claim heartbeat | | < 0.5 |
| **Total** | | **about 45–75** |

### In total

| Players mapping | Requests/min | Requests/sec | Realtime presence deliveries/min (N × tabs × N) |
|---|---|---|---|
| 20 | 900–1,500 | 15–25 | about 1,100 |
| 50 | 2,250–3,750 | 40–60 | about 6,750 |
| 100 | 4,500–7,500 | 75–125 | about 27,000 (450 a second) |

Presence deliveries are counted at 2.7 subscribed tabs per player, as measured today.

### Bursts on top of that

- **After a hunt ends**, every client polls `hunt.current` every 5–7 s until the awards are in, for up to 10 minutes (`hunt.ts:191-193`). At 100 players that is about 1,000 a minute, spread over only 2 s of jitter.
- **During a Realtime outage**, every tab polls chat every 8 s, about 750 a minute at 100 players. Hidden tabs are now slowed (93518d17).

### Supabase Pro limits to check in the dashboard

The published Pro Realtime quotas are 500 concurrent connections and 500 messages a second.

- **Before S1 and S2:** 100 players meant about 270 connections and 450+ messages a second from presence alone. At Ames's ceiling of **150 online**, about 400 connections (under the quota) and about 1,000 messages a second (twice the quota). Past the quota Realtime starts refusing, and chat falls back to polling.
- **After S1 and S2** (with step 2 run): presence messages go out only on a join or a leave, so 150 players stay well inside the quota.

---

## Findings: scale

Ranked by how they grow with players.

### S1. Presence is a Realtime row change sent to everyone (N²) (built: 64dd9a04, needs SQL)

- **Where:** `src/store.ts:7924` subscribed to `event:'*'` on `chat_presence`. `store.ts:7262` sends a heartbeat every 60 s from the leader tab **and** from every visible tab, written through the `ewCommunityData` gateway.
- **Cost:** 123 k presence upserts in 11.6 days, about 7 a minute with 6–16 people on. Each one went to every subscribed tab, and Realtime checks each delivery against row-level security inside the WAL poll, the 74% item above.
- **Scaling:** N players × 2.7 tabs × N heartbeats a minute. At Ames's ceiling of 150 online that is about 60,000 a minute, roughly 1,000 a second. That is twice the Pro quota.
- **Why not Realtime Presence:** joins are written by the server so a join line cannot be forged (`supabase-chat-presence-and-link-screenshots.sql`). Presence messages come from the browser and could be forged, so they don't fit.
- **Built:** `supabase-live-events.sql` adds a small table, `pyr_live_events`, that only database triggers write. It gets one row per join (using the same rule as now, `joined_at` moving), one per leave, and one per completion. The site listens to that table only, so routine heartbeats and ordinary edits no longer go out at all.
- **Fallback:** until the SQL is run, the site uses the old subscriptions. It asks once per page whether the table exists.
- **Reloads still announce no one:** "seen lately" now comes from the online list read every minute and from leave events, not from each heartbeat.
- **Tested:** in PGlite, in `functions/live-events.test.js`:
  - the SQL runs twice cleanly;
  - anon can read the events but cannot write them, delete them, or forge a join;
  - a routine heartbeat says nothing;
  - a return after 2 minutes away is a join;
  - a leave carries the name;
  - only `mark_complete` and `complete_task` count, and failed ones and op_key repeats don't;
  - step 2 and the undo run as written.

  Not tested on Supabase itself.
- **Order:** step 1 → deploy → a day later, step 2. Step 2 stops publishing `chat_presence` and `edit_log`. Before running step 2, check that nothing else, such as the connectome.quest admin pages, listens to those two tables over Realtime.

### S2. Every edit_log row passes through Realtime, for one ticker line (built with S1)

- **Where:** `src/store.ts:7925` subscribed to `edit_log` INSERTs filtered to `mark_complete` and `complete_task`.
- **Cost:** `edit_log` is in the `supabase_realtime` publication, so **every** edit row is decoded and matched against every tab's filter, even though only completions are wanted.
- **Built:** with S1. Completions come through `pyr_live_events`, and step 2 takes `edit_log` out of the publication.

### S3. A legacy server was polled every 20 s by every tab (fixed: f88a0e7d)

- **Where:** `src/main.ts:231` called `loopUpdateLeaderboard()` (`src/store-pyr.ts:52`). It fetched `https://pyrdev.eyewire.org/pyr-leaderboard` and `/userInfo` every 20 s, forever. It ran in hidden tabs and signed-out tabs, with no error handling, and each answer took 4.8 s.
- **Readers:** none. `leaderboardEntries` and `userInfo` are shown only by `components/UserProfile.vue`, which nothing mounts.
- **Cost:** 3–6 requests a minute per tab, so 300–600 a minute at 100 players.
- **Fixed:** the loop is not started. The store is left in place.

### S4. Lightbulb asked twice for every cell on the Retina (fixed: b18ffb39)

- **Where:** `src/widgets/lightbulb_service.ts:216` (`queryOnce`).
- **What happened:** the live query to `eyewire_ii_cell_status_v2` and `eyewire_ii_cell_type_v2` answers **400** on the Retina. Only a 5xx error was remembered, so every lookup batch sent the failing live query first and then the snapshot query: 4 requests per batch instead of 2.
- **Fixed:** after 3 refusals in a row for a table, the live query is skipped for 5 minutes. 401 and 403 are not counted. Empty snapshot answers are read exactly as before, so the hi529 #451 behavior is unchanged.
- **Still open: why the live query is refused.** The console logs keep warnings only, so no report shows a successful live query. Every Retina report since 2026-11-10 shows the 400s. Next steps:
  - Ask the lab, or run one live query with a CAVE token. A `timestamp` later than the live table's horizon is a common cause.
  - **Querying both tables in parallel** (`getCellStatusFresh` asks them one after the other at `666` and `704`) would halve the wait. That is an S change.

### S5. Every edit looked up the root of every open claim (fixed: 508a08ea)

- **Where:** `src/store.ts:5382-5391`. On each `nge-graph-edit`, 1.5 s after the burst, it ran `refreshLiveRoots()` (`5229`), then `refreshLaterRoots()` again at 10 s.
- **Cost:** `refreshLiveRoots` resolved **every** active claim (`myActiveClaims()`, no dataset filter). That is a `root` lookup per claim, plus a `lineage_graph` when the anchor doesn't fit, so about 2 × claims + 1 chunkedgraph requests per edit burst, or about 15–33 a minute per player.
- **It was also wrong across datasets:** claims from another dataset were looked up against the current dataset's chunkedgraph.
- **Fixed:** after an edit, only claims of the current dataset seen on screen in the last 30 s are looked up. That is the rule `refreshLaterRoots` already used, and it covers the claim whose old ID a cut just removed. The others keep what they had. The Cell Library still refreshes all of them when it asks.
- **Test before the next deploy:** split and merge on a claimed cell and check that active time keeps counting (AzureJay #344).
- **Next (S):** clear `descendantsSeen` only for the roots the edit touched.

### S6. Chat polls every 8 s while Realtime is down (partly fixed: 93518d17)

- **Where:** `src/store.ts:7190` (`POLL_MS = 8000`) and `loadMissed` (`7705`).
- **Cost:** 7.5 requests a minute per tab, and only during a Realtime outage. Tabs come and go from Realtime together, so all of them poll at once.
- **Fixed:** a hidden tab now polls once a minute, which is still enough for @mention notifications.
- **Next (S):** add ±2 s of jitter, and back off to 20 s when two polls in a row bring nothing.

### S7. The gateway re-reads who you are on every call

- **Where:**
  - `functions/index.js:2701` (`ewCommunityData`) and `1797` (`ewSecureWrite`).
  - `functions/pilot-access.js:9` (`pilotContext`): 3 reads.
  - Plus a `user_group_members` read (`index.js:2714`), and a CAVE `auth/user/me` call that is cached only per instance for 5 minutes.
- **Cost:** every protected read or write does 4–5 extra Supabase reads before its own work. That covers presence heartbeats, `user_views`, chat history, `claim_time` beats and `activity.log`.
- **Scaling:** about 8 gateway calls a minute per player, so about 4,000 extra reads a minute at 100 players.
- **Fix (M):**
  - Keep `{me, isAdmin, isPilot, groups}` per email in a `Map` in each function instance for 60 s.
  - Cache only when `me` exists. A brand-new player has no `users` row until their first profile POST, and caching "no row" would block them.
  - Clear the entry after any write to `users`, `admins`, `pilot_members` or `user_group_members` made through the same instance.
- **Not built here:** it is approved in the October DB load notes, but it changes who-can-do-what timing and needs its own test in `functions/community-data.test.js`.

### S8. The leaderboard costs 8 queries

- **Where:** `src/store.ts:4870` (`loadLeaderboard`): `leaderboard_board` plus `user_edit_counts` plus 6 `count: 'exact'` head queries for ranks.
- **When:** every 5 minutes when the stored copy is stale (`ChatPanel.vue:402`), and every 2 minutes while the board is open (`LeaderboardPanel.vue:139`).
- **Fix (S, SQL + client):** add rank columns to `leaderboard_cache` in `refresh_leaderboard_cache()`, which already runs every minute, and read them in one query.

### S9. The leaderboard refresh (already fine)

- `refresh_leaderboard_cache()` already returns early when `max(edit_log.id)` hasn't moved and the last refresh is under 10 minutes old (`ew_cache_marks`). The 124 ms average is the refreshes that had new edits to count.
- It does not grow with players, only with how many edits come in. Nothing to do.

### S10. Smaller per-edit writes

| Where | What | Fix |
|---|---|---|
| `store.ts:283` → `4605` | An `activity_feed` insert per edit. The feed panel is closed by default, and the same edit already goes into `edit_log` | Batch these, or derive the feed from `edit_log` (S) |
| `util/view_autosave.ts:42` | `user_views` upsert of the whole view, at most every 30 s | Raise the gap to 2 minutes, and skip changes that are only camera moves (S) |
| `util/claim_time.ts:333` | Gateway call every 60 s per counted claim | Every 2–3 minutes (S) |
| `hunt.ts:191-193` | `hunt.current` every 5–7 s after a hunt ends, until the awards are in | Back off from 5 s to 60 s, or announce "awarded" on the chat channel (S) |
| `util/team_session.ts:618-630` | Team `pos` broadcast every 250 ms while the view moves | 1 s, or when the view settles (S) |

### S11. A function capped at one instance

- **Where:** `functions/index.js:2953` (`ewSheetSync`): `maxInstances: 1, concurrency: 1, timeoutSeconds: 90`.
- **Cost:** every completion, claim and release on the Retina and MEC calls it (`src/sheet_sync.ts:61`), and they queue one at a time. With many completions in the same minute, players wait. Past the queue limit, Cloud Run answers 429. The client says the cell is saved, so nothing is lost, but the sheet lags.
- **Fix (S):** raise `concurrency` if the Sheets writes are safe in parallel. If one at a time is what keeps rows from colliding, queue the sync on the server instead (an outbox table and a scheduled function).

---

## Findings: page slowness

### C1. Retina freezes of 5–13 s, about every 8 s, while idle

**Evidence from `site_issues`:**

- **Nseraf**, 2026-11-14 11:34 UTC, "Lag during + after merge". Firefox, `stroeh_mouse_retina`, 7 layers, 21 cells, 1 mark, tab open 0–2 minutes.
  - Freezes of 13.1, 5.1, 8.1, 5.6, 5.3, 4.8, 5.3, 5.7 and 5.3 s, each ending 8–9 s after the last.
  - Between freezes the log shows only lightbulb live-query 400s (2–8 per gap) and two `[pcg] lineage_graph 500`s.
  - The freezes stopped when the lookups stopped (13:33:55 to 13:34:10).
- **Jingkai_Li**, Chrome, Retina, 2026-11-07 and 11-13. Freezes of 4.7 s with `scripts 0ms (0), render 1ms, layout 0ms, blocking 0ms`. The next line is a separate 2 s `FileReader.onload`: that is the report's own screenshot, `page_capture.ts:61`.
- MEC freezes of 2.5 s with 13,000 marks are the `highlight.ts` loop already fixed in d62ee87c.

**Reading:**

- In Chrome, a 4.7 s long frame with no script time, no render time and no blocking means the main thread was idle while the frame waited. That is a graphics-process stall.
- Firefox runs WebGL calls on the main thread and blocks when the graphics queue is full, which matches a stall that names no script.
- Each lookup burst updates the segment list's labels and pips, and a lookup result can redraw the viewer. If one draw costs seconds on that machine, every burst produces a freeze.

**Likely contributor:**

- `src/store.ts:455-456` sets `gpuMemory.sizeLimit = 2e9` and `systemMemory.sizeLimit = 3e9` for every player. Neuroglancer's defaults are 1 GB and 2 GB.
- On a laptop whose graphics share system memory, a 2 GB chunk cache means the driver pages textures in and out. The Retina's 4 nm image and its "Sections" in 3D fill the cache quickly.

**What to do:**

1. Ship 98da4b5b. Freeze lines will end with `N draws in 15 s, slowest X ms`. A slowest draw close to the freeze length confirms the graphics card.
2. Ask Nseraf to set **GPU memory limit** to 1000000000 in Viewer settings. That is saved per player by `util/viewer_perf.ts`, so no deploy is needed. Then ask whether the freezes stop.
3. If they do, change the default at `store.ts:455`: use 1e9 and 2e9, or about a quarter of `navigator.deviceMemory` where the browser gives it (Firefox does not). A player's own setting still wins. Size S.

### C2. The whole view is turned into JSON on every change, sometimes twice (view autosave fixed: 9bc67fba)

- **Where:**
  - `third_party/neuroglancer/ui/url_hash_binding.ts:76-90`: the address hash, 200 ms after each change.
  - `src/util/view_autosave.ts:36-38`: 12 s after changes stop.
  - `src/util/claim_autosave.ts:55`: every 90 s.
- **Cost:** 100 ms to 1 s per stringify with thousands of marks. That is the "after every edit" freeze in Nseraf report 383, which was partly fixed by not writing an oversized hash. In view_autosave, a state over 240 KB never sets `lastSaved`, so it re-serializes after every change for the rest of the session.
- **Scaling:** marks × changes.
- **Fix (S):**
  - Debounce the hash at 1 s with `maxWait` 5 s.
  - In view_autosave, remember "too big", and reuse `getCachedJson(viewer.state)` (the cached text reload_guard already uses) instead of calling `toJSON` again.

### C3. Segment watchers redo the whole list on every change (3 of 4 fixed: 88df2ee7, eadc456d, 7cbbac39)

Each change to the visible or selected segments walks the whole set. Loading a view, pasting a list, or a merge or cut fires many changes in a row.

| Where | What it does per change | Who |
|---|---|---|
| `src/util/invalid_segment_watch.ts:47-50` | Allocates 2 `Uint64` per visible segment | Every player |
| `src/hunt_build.ts:210` | Schedules a sweep of visible + selected segments | Sandbox, non-admins |
| `src/util/segment_marks_prompt.ts:85-99` | Rebuilds a Set of all selected IDs and spreads `known` up to 3 times | Every player |
| `src/util/highlight.ts:107-114` | Walks every annotation in a lab layer on each add or drag step (14 k for Nseraf) | Players with Highlight marks |

- **Fix (S each):** use the changed IDs the signal passes (as `src/util/undelete.ts:93` already does), or merge each burst into one check per task.
- **Left:** `segment_marks_prompt.ts`. Its rule tells a merge arriving in two steps from a player adding a segment by the order of single changes, so merging them would change what it decides. It only costs much with hundreds of cells selected.

### C4. MEC mark counts are rebuilt about twice a second

- **Where:**
  - `components/HighlightModePanel.vue:591`: every 1.5 s, `refresh()` builds and sorts the full `listHighlights()` (`highlight.ts:847`) to read `.length`, and walks every mark again.
  - `components/MecMarkStatus.vue:198`: `mecCounts()` on its own 1.5 s timer.
- **Fix (S/M):** recount when the annotation layer changes (debounced 300 ms), and keep the counts in one shared ref.

### C5. Chat grows without limit and redraws in full

- **Where:**
  - `src/store.ts:7118`: `chatMessages` is never capped, and it is deep-reactive.
  - `components/ChatPanel.vue:1582`: every message is rendered, with no virtual list.
  - `ChatPanel.vue:233-249`: `isFresh()` reads `freshTick` while rendering, so each arrival, and again 12 s later, re-renders the whole list.
  - `ChatPanel.vue:628` and `:1103`: an O(n) pass per render.
  - `loadMissed` (`store.ts:7705`): `Math.max(...spread)`, then a resort of the whole array.
- **Scaling:** session length × chat activity, which grows with players.
- **Fix (M):**
  - Cap the array at 300 messages and set `hasMoreHistory`.
  - Use a `shallowRef` and replace the whole array.
  - Keep "fresh" message IDs in a small Set.
  - Keep a running "newest seen" time.

### C6. Page-wide mutation observers react to almost every DOM change

Neuroglancer rewrites the mouse coordinates and status line on every mouse move, so each of these runs on every mouse move:

| Where | Work per batch of changes |
|---|---|
| `src/no_four_panel.ts:96` | Page-wide `querySelectorAll` |
| `src/tutorial-3.ts:1213-1224` | Scans the records, even with no tutorial running |
| `src/find_path_status.ts:307-311` | Debounced page rescan |
| `src/main.ts:916` (`detectMutation`) | `injectSegmentLegend()` |
| `src/main.ts:1334-1344` (`scanToolState`) | 4 page-wide queries, plus every 500 ms |

- **Cost:** a few ms per mouse move, growing with the size of the DOM (chat, segment list).
- **Fix (M):** observe only the containers that matter (layout controls, `#statusContainer`, the layer panel). Return early on unrelated records. Start tutorial-3's observer only during the tutorial.

### C7. Timers that redraw large components (3 of 5 fixed: 3888b14a, ab4a5e55, d6f8ee65)

| Where | Cost | Fix |
|---|---|---|
| `src/hunt.ts:218` with `ExtensionBar.vue:487-496` | During any announced, live or just-ended hunt, `huntState.now` ticks every second and `huntPill` returns a new object, so the whole 2.9 k-line top bar re-renders every second | Move the pill into a small child component (S) |
| `components/CellLibraryPanel.vue:145-148` | `orbitSeq` ticks every 2.8 s and is read in the template, so every row of the open Cell Library re-renders | CSS animation, or state per row (S/M) |
| `components/ExtensionBar.vue:1284` | Every second while notifications are tucked away: rewrites the dot's SVG, a `querySelectorAll`, a forced layout | Redraw only when the count changes (S) |
| `src/tutorial-3.ts:1208` | Layer renaming every second for everyone: DOM queries, layers × chips | The observer already covers it; slow it to 10 s (S) |
| `src/util/color_families.ts:106` | Every 700 ms with color families on: walks all visible segments; the `given` set only grows | Hook the visible-segments signal (S) |

### C8. The Starship intro's idle turn changes the view every frame (loop end fixed: 099b9623)

- **Where:** `src/util/starship.ts:550-566`.
- **While it turns:** every frame changes the view, which sets off about eight state listeners (hash, autosave, reload guard, script API, quests, claim autosave, claim time, image hint) and redraws the 3D view nonstop. That is by design during the intro, but it costs the most on the slowest machines, at a new player's first moment.
- **After a drag:** the turn stops, but the frame loop keeps running empty for the rest of the visit. That costs little.
- **Fix (S):**
  - End the loop (`cancelAnimationFrame`, remove the listeners) when the turn stops for good.
  - While turning, skip the view autosave and the hash, or turn every second frame.

### C9. One 5.4 MB script, cached for 10 minutes

- **Where:** the build uses neuroglancer's esbuild script without code splitting (`node_modules/neuroglancer/config/esbuild.js:220-248`). `components/ExtensionBar.vue:6-68` imports about 50 panels up front, among them CellLibraryPanel (6.9 k lines), AdminHub (5.6 k), TodoBoard (3.5 k), ChatPanel, the intro tour and hunts.
- **Live:** `main.bundle.js` is 5.39 MB, 1.96 MB gzipped, served with `cache-control: public, max-age=600`. Startup parse of 350–420 ms shows in M Sorek's lines (`DOMWindow.onDOMContentLoaded`).
- **Fix:**
  - Small: the file name carries `?v=` (only `index.html` loads it), so it can be served with `expiration: "365d"` so returning players don't download it again (S). **Where:** the deploy step writes its own `app.yaml` from a fixed block in `.github/workflows/on_dev_branch_push.yml` (about line 113), not from `appengine/frontend/app.yaml`. The handler goes in that block, ahead of `- url: /`. It was not changed here because it is the deploy job; it needs Ames's yes.
  - Larger: turn on esbuild `splitting` with ESM output, and load admin, To do, blog and tutorial panels with `defineAsyncComponent` (L).

### C10. Radio dock measured layout three times a second (fixed for hidden tabs: 7d50fdf3)

- **Where:** `components/RadioPlayer.vue:360`. `measureDock` runs page queries, `getBoundingClientRect` and `getComputedStyle` every 350 ms for every signed-in player with the radio shown.
- **Fixed:** hidden tabs now skip it.
- **Next (S):** use a `ResizeObserver` on the docked panels instead of the timer.

### C11. Smaller items

- **Never removed:**
  - `src/util/segment_marks_prompt.ts:109` and `src/hunt_build.ts:210` add listeners to every new segment group, so old groups stay in memory after dataset switches.
  - `widgets/button_service.ts:206` adds a `document` listener for each status button. A status event without data re-fetches once per leaked button.
- **Always on but cheap:**
  - `SplitMergeOverlay.vue:108`: 300 ms.
  - `hunt.ts:1109-1155`: gem watch every 400 ms from sign-in, O(gems × folder IDs) during hunts. Stop it when no hunt is live.
  - `claim_time.ts:332`: 1 s tick.
- **The report screenshot itself freezes the page for 0.6–2 s** (`page_capture.ts:61`, `FileReader.onload` in the console lines). It shows up in the console of every report. Harmless, but it makes report logs look worse than play was.

---

## Checked and fine

- **Timers clear on close:** AdminHub, TodoBoard, BetaGate, LeaderboardPanel, TeamsTab, HuntPanel, HighlightModePanel and MecMarkStatus all clear their timers when unmounted.
- **One tab per browser:** notifications (60 s) and the online list are read by one tab per browser (`util/tabs.ts` leadership).
- **Long intervals with hidden-tab guards:** `version_watch`, teams and the segmentation watch.
- **Already backed off:** `activity_outbox` and `cave_outbox` (exponential), `sendActivity`, release, `practiceAction`, `_retryButtonStatus` (6 tries at most), and lightbulb 5xx handling.
- **Lightbulb batching:** at most 50 cells per query, 3 in flight per table, duplicates shared.
- **`statusFromEditLog` (MEC):** served by `idx_editlog_segment_after_hash`, 0.1 ms per call.
- **Out of season:** Hits Edge auto-detect is off, leaves are off until 2027, Halloween effects are off, and the turkey runs only in Thanksgiving week.
- **Deep watchers:** the five `deep: true` watchers watch small objects.

## Suggested order

1. **Run step 1 of `supabase-live-events.sql`, then deploy this branch.** A day later, run step 2.
2. **Ask Nseraf:**
   - for a Retina report with the new draw line;
   - to try the 1 GB GPU limit (C1).
3. **Check active time after a split** on a claimed cell (S5, AzureJay #344).
4. **Next code items:**
   - S7: gateway identity cache.
   - C5: chat cap. It has to work with chat search.
   - C6: mutation observers.
   - C4: MEC counts on change.
   - C9: cache header, in the deploy workflow.
   - S8: leaderboard ranks in the cache.
