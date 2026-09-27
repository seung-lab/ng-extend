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

## Practice cells (built 2026-09-26, needs Amy's examples)

Tutorial 3's two "Your Turn" steps hand each learner a real sandbox cell,
one learner at a time, and put it back afterwards.

- `supabase-tutorial-practice-schema.sql`: table `tutorial_practice_examples`
  plus `claim_practice_example` and `release_practice_example`. Apply it in
  the Supabase SQL editor before testing.
- `src/practice.ts`: claim, show the two pieces at their current roots, poll
  whether they share a root, and on finish or exit undo every PyChunkedGraph
  operation since the example's baseline (newest first) with the learner's
  own token.
- `scripts/reset-practice-examples.mjs` and
  `.github/workflows/tutorial-practice-reset.yml`: the same undo with
  `CAVE_SERVICE_TOKEN` for expired claims and failed client resets, every
  10 minutes once the workflow is on the default branch.
- Admin Hub > Practice cells: register an example from the current view
  (hover the cell, "Use hovered as A"; hover the piece, "Use hovered as B"),
  check it, reset it now, disable or delete it.
- Two kinds: `cut` (A and B start fused; hover each side of the join) and
  `merge_then_cut` (a merge example: B starts disconnected; the name is
  historical, the learner only merges). The UI calls them cut example and
  merge example. Amy's first cut example
  (2026-09-26) is a fused axon in the sandbox; its three states (marked,
  points placed, split) are the illustration states in tutorial-3.ts steps
  9, 12 and 14. Register the same cell as a `cut` practice example from the
  first state. More examples: register them in the tab, nothing is hard
  coded.
- Cut candidates from Amy, 2026-09-26 (state links on global.brain-wire-test.org,
  `nglstate/api/v1/<id>`):
  1. Fused axon into a dendrite: marked 5679121900240896, points placed
     5745573634244608, after the split 5675806990794752. Used as the
     illustration states in tutorial-3.ts.
  2. Root 648518346355200442, view 5763166390714368. Amy already split it
     into 648518346357382467 and 648518346351477006 (view 5674918603653120),
     so merge the two back together before registering it as a `cut`
     example; the registration takes the fused state as the baseline.
- Before and after pictures on step 1 (`src/images/cut-before.jpg`,
  `cut-after.jpg`): cell 648518346350730372 with a fused axon, view
  5090441737273344, then after Amy's cut: axon 648518346357382723, corrected
  cell 648518346351477262. Amy wants this fused axon as the cut practice
  cell: merge 648518346357382723 back onto 648518346351477262, then register
  the merged cell as a `cut` example (A on the axon, B on the cell).
- Cut candidate 3 from Amy, 2026-09-26: 648518346353862024 has several
  merges that need cutting, annotated in view 6280196063756288. Amy's pick
  for the cut example is view 5646028774572032 (register it as `cut`).
- Merge candidate from Amy, 2026-09-26: a branch cut in half, view
  5653391690694656, pieces 648518346350730372 and 648518346351348401.
  Register it as `merge_then_cut` from that view (hover the cell for A, the
  cut-off branch for B). tutorial-3.ts also loads this view on the merge
  steps when no practice cell can be claimed.

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
