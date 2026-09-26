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

- `npm run typecheck` is plain `tsc --noEmit`: it never reads `.vue` files, and
  its output is now dozens of vendored neuroglancer errors (spec globals, jpgjs),
  none under `src/`. Check `npm run typecheck 2>&1 | grep "^src/"` is empty; the
  esbuild prod build is what actually compiles components (2026-09-26, ran both).
- For a short user-facing notice, `StatusMessage.showTemporaryMessage(msg, ms)`
  from `neuroglancer/status` works from Vue components and outlives a panel that
  closes itself; there is no generic app toast (AchievementToast is badge-only)
  (2026-09-26, dataset switch fix).
- `switchToDataset` in src/datasets.ts is synchronous under its async signature,
  so any "loading" state set just before calling it never paints unless you yield
  first (2026-09-26, read the code).
