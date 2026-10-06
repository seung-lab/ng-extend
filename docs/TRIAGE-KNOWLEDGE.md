# What the triage robot has learned

Every build and every answer the triage robot (docs/TRIAGE-LOOP.md) makes
starts by reading this file. When a build teaches it something that will
matter next time, it adds a line here in the same change as the fix, so a
lesson only lands once a human has tested and approved that fix. People can
edit it too.

Rules for this file: one fact per line, dated, plain words. Say how you know.
Correct or delete a line that turns out wrong rather than adding a
contradiction. Keep it under about 200 lines; fold old detail into short
summaries.

## The product

- EyeWire II Community is a Vue 3 + Pinia extension of neuroglancer. App code
  lives in `src/`; neuroglancer itself is vendored in `third_party/neuroglancer`
  and is ours to change when a fix needs it (seeded 2026-09-25, from the repo).
- The live community site is App Engine version `eyewire-ii-community`; every
  other branch pushed to seung-lab deploys its own preview version with the
  same real data (seeded 2026-09-25, from on_dev_branch_push.yml).
- Datasets are registered in several places; an unregistered dataset name does
  not error, it silently falls back to the production retina volume, so CAVE
  writes land on the wrong aligned volume. Read docs/HANDOFF-new-dataset.md
  before touching dataset config (seeded 2026-09-25, from that doc).
- The MEC dataset (`pni_mec`, server hc.himc-cave.com) was missing its
  annotation and materialize registration as of 2026-09-23, so Mark Complete,
  cell typing and the leaderboard fail there while viewing and merge or split
  work (seeded 2026-09-25, from the Slack bot's notes).

## Building and checking

- Check the build with `node scripts/build-prod.js`. `npm run typecheck`
  reports six old tsconfig errors about removed options; ignore those, add no
  new ones (seeded 2026-09-25).
- Vue templates here are compiled as JavaScript: TypeScript syntax inside a
  template (`x!`, `as Type`) breaks the production build. Put typed logic in
  the script block (seeded 2026-09-25, broke CI twice that day).

## How the team wants things

- User-facing copy: no em or en dashes; commas and periods instead. No
  gradient text. No thin italic text on dark backgrounds; keep small text
  readable (seeded 2026-09-25, Amy's standing rules).
- Change only what the approved spec asks. Amy reviews the result on a
  preview; unrelated tidying makes that harder (seeded 2026-09-25).

## Learned from builds

(The robot adds lines here as fixes are approved.)

- "Use scifi-ui" means reuse what is already ported in this repo, not a new
  dependency: `runPanelTrace` in `src/util/holo_trace.ts` (beam on arrival)
  and the softened `nge-holo-materialize` keyframes in TagModePanel.vue.
  A panel centred with `translate(-50%, -50%)` must repeat that translate in
  every materialize keyframe or it jumps off centre (2026-09-26, dataset
  panel build, from reading WeeklyRecapPanel and TagModePanel).
- Per-user counts must come from shared records, never the local stats tally:
  `useUserStatsStore` daily counts live in one browser's storage and miss
  edits made elsewhere. Count from `edit_log` (merges and splits, skip
  `success = false`) or `user_edit_counts` (CAVE mirror, rolling 7 days).
  Say which window a number covers (2026-09-26, recap showed 6 edits where
  edit_log and CAVE had 13).
- Tutorials: `TutorialStep.vue` listens for Enter and Space on `window` in the
  capture phase and swallows them. A step that tells the user to press Enter in
  the viewer (Cut, Merge and Find Path submit on Enter) only works because the
  handler now steps aside while a viewer tool is active (2026-09-26, from the
  tutorial audit build).
- There is no Ctrl+Z undo in the app or in neuroglancer. PyChunkedGraph does
  have `POST /table/{table}/undo` with `{operation_id}`, and merge and split
  responses include `operation_id`; the practice cell reset uses it
  (2026-09-26, checked against the PyChunkedGraph routes).
- Close a layer side panel with `viewer.selectedLayer.visible = false` (or the
  panel state's `location.visible`). Setting `display:none` on side panel
  elements leaves them unopenable until reload (2026-09-26, from the tutorial
  audit).
- In this neuroglancer the visible root set is
  `layer.displayState.segmentationGroupState.value.visibleSegments`;
  `displayState.rootSegments` does not exist, so code that used it was a
  silent no-op (2026-09-26, checked in the browser on the preview).
- The Browser pane counts as a hidden tab: requestAnimationFrame never fires
  there, so neuroglancer will not redraw or open panels in it. Verify panel
  changes on a real screen (2026-09-26, from the tutorial audit).
- A hover animation on a parent (transform/scale/rotate) carries through to
  any child popup or tooltip absolutely positioned inside it, since CSS
  transforms apply to the whole rendered box including descendants. Put the
  animation on an inner wrapper around just the icon, not the element that
  also contains the tooltip. Found in ExtensionBar.vue's `.nge-streak-chip`
  flame hover, which was spinning the `.nge-streak-tip` card with it
  (2026-09-30, streak tooltip fix).
- Annotation layers the app draws from shared data (Scout tags and pins, AI
  candidates, shards, heat, proposed split) are named in `useIssueTagStore`
  and recognised by its `isTagStoreLayer(name)`; any other layer with
  `localAnnotations` is the player's own (their points and boxes, highlight
  strokes, script layers). `finishMenuCompletion` only runs for Cell Library
  cells, so a CAVE only completion does not reach code placed there
  (2026-10-02, clear markup on complete build, from reading the callers).
- `backend.completeTask` does not touch `backend.tasks`; a completed claim
  only leaves `myOpenClaims` once the background `loadTasks()` in
  `completeCell` lands. Code that runs right after a Complete must skip the
  finished claim itself, not trust the list (2026-10-04, auto next claim
  build, from reading store.ts).
- An inline `#!{...}` hash restores layers synchronously in
  `hashBinding.updateFromUrlHash()`, but a state link hash (`#!https://...`,
  `#!middleauth+...`) is fetched async, so boot code that checks
  `activeLayers` sees it empty. Neuroglancer also rewrites the hash soon after
  boot, so judge "what the page opened on" from `BOOT_HASH` in store.ts, not
  `window.location.hash` (2026-10-05, refresh keeps view build, from reading
  url_hash_binding.ts).
- Chat length is capped by `CHAT_MAX_CHARS` (140) and counted with
  `chatTextLength` in store.ts, which skips `https?://` links, so a native
  `maxlength` cannot enforce it. `sendMessage` drops over limit text except
  announcements (`notificationId` set), and "Share my view" appends long
  links to the caption, which is why links must stay uncounted (2026-10-05,
  chat limit build, approver note "140 characters, exclude links").
- Practice cell picks (`sampleHover` in AdminHub.vue) take the segment and
  supervoxel from the mouse hover but the point from the crosshair
  (`viewer.navigationState.position.value`). `placeMergeLine` in practice.ts
  pairs `point_a`/`point_b` with `supervoxel_a`/`supervoxel_b`, so a pick is
  only consistent if the crosshair sits on the hovered piece (2026-10-05,
  crosshair pick build, from reading practice.ts).
- Chat history is read once in `connect()`; realtime only pushes live
  inserts. Supabase rejoins a dropped channel by itself and fires
  `SUBSCRIBED` again, so any repeat `SUBSCRIBED` is where gaps are backfilled
  (`loadMissed`). `fetchPage` moves `oldestLoadedAt` and `hasMoreHistory`, so
  do not reuse it for newer rows (2026-10-05, chat reconnect build, from
  reading store.ts).
- Neuroglancer's `VirtualList` measures a row's height once, right when it
  renders it, so anything main.ts injects into a segment row later makes the
  list undercount. `src/move_to_segment_patch.ts` patches `VirtualList` from
  src (tags `element.__nge_virtualList`, adds `remeasureItem(row)`); extend
  that patch rather than editing third_party when an automatic build may only
  touch src/ (2026-10-05, segment list scroll build, from reading
  virtual_list.ts and the patch).
- Boot order in main.ts: `setupViewer()` runs `hashBinding.updateFromUrlHash()`
  before `initializeWithViewer()`, so anything `initializeWithViewer` sets
  (like layout) overwrites what the URL just restored unless it checks
  `BOOT_HASH` first (2026-10-06, layout after refresh build, from reading
  main.ts and store.ts).
- The split error flash is fed by `checkStatusMessages` in main.ts, which
  re-raises it from neuroglancer's `#statusContainer` once its 3s cooldown
  passes. Graphene's error status stays until its own Dismiss button is
  clicked, so clearing `resultFlash` alone brings the flash back; the store's
  `dismissResult` clicks that button too (2026-10-06, dismiss split error
  build, from reading status.ts and graphene frontend.ts).
- Earlier builds of a spec may not be in the checkout even when the thread
  says "deployed": check the code before marking BLOCKED (2026-10-06, the
  dismiss button from three prior builds was absent).
