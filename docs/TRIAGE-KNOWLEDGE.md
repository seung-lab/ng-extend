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
