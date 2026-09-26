# Handoff: clean up and expand the EyeWire II tutorials

Paste this into a new chat to start the work.

---

Working on the EyeWire II in-app tutorials: clean up what's there, then expand.
Repo: seung-lab/ng-extend, branch eyewire-ii-community. My main checkout
C:\Users\amyle\ng-extend is in use by another chat (new dataset work, with an
uncommitted src/config.ts change you must not touch), so make your own worktree
from origin/eyewire-ii-community. Claim a card on the github-kanban board first.

## What exists

- `src/tutorial-1.ts`: Basics, about 22 steps.
- `src/tutorial-2.ts`: Advanced interface (Celia's), about 33 steps.
- `src/tutorial-3.ts`: Cut & Merge. 9 TODOs wait on Amy: 7 neuroglancer state
  URLs (a clear 3D neuron, a practice merge, a practice cut, and so on) and 2
  illustrations (merge, cut).
- `src/site-tour.ts`: the Site Tour.
- `src/components/Tutorial.vue` (switches between tutorials) and
  `TutorialStep.vue` (the sci-fi tooltip: progress bar, confetti, keyboard
  nav, waitForElement with a 3 s poll).
- Progress is saved per user in Supabase `users.tutorial_active`,
  `tutorial_1_step`, `tutorial_2_step`, `tutorial_3_step`
  (`supabase-tutorial-state-schema.sql`), plus localStorage.
- The in-app Guide can start tutorials (`src/assistant/actions.ts`,
  startTutorial 1 to 3, 4 = Site Tour), so keep those ids stable.
- Mascot art: `static/nurro/README.md` catalogs every Nurro and what it fits
  (inspector Nurro for "look closer", laser pointer Nurro for teaching steps,
  the struggling-with-the-map Nurro for hard steps, confetti for finishing).
  Web copies in `static/nurro`, originals in `static/nurro/originals`.

## Step 1: audit before changing anything

The toolbar and panels were redesigned recently (for example the hamburger
menu became an open book in ebce314), so steps that point at old buttons may be
broken. Run each tutorial end to end on a preview and list, per tutorial:
steps whose target is missing or wrong, wrong or outdated text, dead links,
images that no longer match the UI, and anything confusing. Show Amy the list
and a plan before rewriting.

## Step 2: clean up, then expand

Fix broken targets and copy first. Then propose new content: Tutorial 3's
missing states (say exactly which neuron views are needed and Amy will pick
them), MEC dataset coverage if it makes sense, and Nurro art on the steps
where it helps.

## Rules

- Copy: no em or en dashes (commas and periods), no gradient text, no thin
  italic on dark backgrounds, keep small text readable.
- Vue templates are compiled as JavaScript: TypeScript syntax in a template
  (`x!`, `as Type`) breaks the production build.
- Check with `node scripts/build-prod.js`. `npm run typecheck` prints many old
  errors from the bundled neuroglancer; add none in `src/`
  (see `docs/TRIAGE-KNOWLEDGE.md`).
- Push branches to `amy` (Amy's fork) for CI. A branch pushed to `origin`
  (seung-lab) gets its own preview site; pushing `eyewire-ii-community` itself
  deploys the live community site, so ask Amy first.
- Read `docs/TRIAGE-KNOWLEDGE.md`. User reports about tutorials may arrive
  through the triage robot (`docs/TRIAGE-LOOP.md`); if you learn something
  about the app, add a dated line to that file.
- Related: connectome.quest had a separate "Learn how to map the brain"
  prototype tutorial embed that was removed on 2026-07-07 (restore from
  seunglabdata commit f15589a). Ask Amy before restoring it.
