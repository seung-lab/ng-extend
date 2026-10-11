# Handoff: an automated proofreading test that grants production access

Written 2026-10-10 from the tutorial worktree (`C:\Users\amyle\ng-extend-tutorial`,
branch `claude/tutorial-audit`, merged into `eyewire-ii-community`). Paste this
into a new chat to start the work.

## The goal

A test a player takes after the tutorials. They are given one demo cell that
has several errors on it, some false merges (need a cut) and some missing
pieces (need a merge), and they proofread it fully. The game scores the result
by itself and, on a pass, grants access to the production dataset(s).

Ames will supply, for the demo cell: the location of every error, whether it
is a cut or a merge, and coordinates of the segments that should end up cut
off or merged on.

Nothing of the test exists yet. Everything below is what the Merge and Cut
tutorials already built, which the test can stand on, and what they do not
cover.

## What exists

| # | Tutorial | File | What the player does |
|---|---|---|---|
| 1 | Get Started | `src/tutorial-1.ts` | Navigation, selecting, no edits |
| 2 | Advanced Interface | `src/tutorial-2.ts` | Layers, coordinates, no edits |
| 3 | Merge | `src/tutorial-3.ts` | Two real merges on a practice cell |
| 4 | Site Tour | `src/site-tour.ts` | No edits |
| 5 | Cut | `src/tutorial-cut.ts` | Two real cuts, one in 3D, one in 2D |
| 9 | Merger Sandbox | `src/merger-sandbox.ts` | Five cuts with no preset points |

`src/components/Tutorial.vue` switches between them (`STEPS_MAP`,
`PRACTICE_TUTORIALS = [3, 5, 9]`), and `TutorialStep.vue` draws the box.
The shared helpers for anything that edits live in `src/tutorial-3.ts` and
`src/practice.ts`.

### Merge (tutorial 3), 8 boxes

1. Welcome.
2. An example of a missing branch.
3. How to Merge: press M. Claims the practice cell.
4. Make the merge, in 3D. Pink gems mark the two spots. Ctrl+click each piece, Submit.
5. Success.
6. A second merge, in 2D, on the same neuron.
7. Success.
8. Done. Awards the **Mini Michelangelo** achievement if both merges landed.

### Cut (tutorial 5), 10 boxes

1. Welcome.
2. What a cut fixes (a yellow axon fused to a purple dendrite). Claims both cells.
3. How to Cut: press C.
4. Place a red point.
5. Press G.
6. Place a blue point, Submit.
7. Success.
8. You can also cut in 2D.
9. Your turn: a cut in 2D on a second cell.
10. Done. Awards **Safety Scissors** if both cuts landed, and leads to the sandbox.

### Merger Sandbox (tutorial 9)

Five fused cells (`SANDBOX_CELLS` in `src/practice_pools.ts`). A player is
handed one free cell at a time and several players work in parallel, one per
cell. No preset points, a "Help me" button shows them. The done box checks the
cell directly and leads to the next one. Which cells a player has cut is kept
in `tutorial_completions` and in localStorage.

## The practice cell system (the part the test will reuse)

### The row

Table `tutorial_practice_examples` (`supabase-tutorial-practice-schema.sql`).
One row is one exercise: **two supervoxels and whether they should end up on
the same segment**.

- `kind`: `cut` (starts fused, done when the two supervoxels have different
  roots) or `merge_then_cut` (starts apart, done when they share a root).
- `supervoxel_a`, `supervoxel_b`: the identity. Segment (root) ids change with
  every edit, supervoxels never do. Never key anything on a root id.
- `root_a`, `root_b`: a convenience copy, refreshed at reset. Stale in between.
- `point_a`, `point_b`: viewer voxel coordinates `[x, y, z]`.
- `state_url`: the starting view.
- `baseline_at`: every operation on the neuron after this instant is undone at reset.
- `status`: `ready`, `in_use`, `needs_reset`, `resetting`, `broken`.
- `claimed_by`, `claim_nonce`, `expires_at`: the claim.

Dataset: all cells are on `pinky_nf_v2` at `https://minnie.microns-daf.com`
(the Pyr sandbox). Viewer voxels are 4x4x40 nm, the segmentation volume is
8x8x40.

### Claim, renew, release

`src/practice.ts`. `beginPractice(kind, view, {slot, only, avoid, ...})`
claims a cell through the server (`practiceAction` in `src/pilot_actions.ts`
calls the `ewSecureWrite` function, which calls the SQL RPC
`pilot_practice_action` with `claim`, `heartbeat`, `begin_reset`,
`check_reset`, `finish_reset`). A claim renews once a minute while the player
is active and is released after idle time (`HOLD_MINUTES`), on exit, or on
finish. `endPractice()` hands everything back and resets it.

Rules the server enforces: one player per cell, and nobody is given a cell on
a neuron someone else holds a cell on. That second rule also blocks a player's
own second cell on the same neuron, which is why the Merge tutorial's second
merge "rides" on the first cell's claim (`RIDES_WITH` in `src/practice.ts`).
**A multi error test cell hits exactly this: many exercises on one neuron need
one claim, not one per error.**

### Detecting an edit

`piecesMerged()` and `cellIsCut(id)` in `src/practice.ts` ask the chunkedgraph
for the current root of each supervoxel (`rootOfSupervoxel`, GET
`/node/{sv}/root`) and compare. `watchPractice(wantMerged, ...)` in
`src/tutorial-3.ts` polls that and advances the box. It also reads server edit
errors and notices "a cut went through but the two are still joined".

This is the whole scoring primitive, and it generalises directly: **a test is
a list of pairs of supervoxels, each with "must be together" or "must be
apart"**.

### Reset

`resetPracticeExample` (browser, on finish) and
`scripts/reset-practice-examples.mjs` (GitHub Actions,
`.github/workflows/tutorial-practice-reset.yml`, every 10 minutes) undo every
operation after `baseline_at`. The job only touches cells listed in
`config/practice-reset-manifest.json`, and the manifest values must equal the
row exactly, `baseline_at` included. A cell is only handed out if it is in
the manifest.

**Cells on one neuron must share one `baseline_at`.** Two different baselines
on one neuron made the cells undo each other's starting state in a loop.

### Turning coordinates into supervoxels

Ames gives coordinates, the system needs supervoxels. Two ways exist:

- Admin Hub practice picker (`src/components/AdminHub.vue`): hover or use the
  crosshair, press A and B.
- `scripts/inspect-practice-coords.py` (cloud-volume lookup at layer 1), run
  through the reset workflow with `inspect=true` and
  `config/practice-inspect-coords.json`.

Lesson from the 2D cut cell: the two check points must sit right beside the
join, one on each side. Arbitrary points elsewhere in each neuron left a
correct cut uncounted (`CHECK_SUPERVOXELS` in `src/practice.ts` is the patch).

### Hints

`CUT_HINT_STATES`, `MERGE_HINT_STATES`, `cutHintFor`, `showWhereToCut`,
`showWhereToClick` in `src/tutorial-3.ts`; markers in `src/markers.ts`. A test
presumably shows none, but the same marker code can show a player their
mistakes afterwards.

### Records

- `tutorial_completions` (`supabase-tutorial-completions.sql`): one row per
  finish, `tutorial`, `item`, `practice_asked`, `practice_made`, written by
  `recordTutorialDone()` through the server, which stamps the player. Built as
  the base for this test. Not yet seen filled by a real run.
- Achievements: `special_badge_awards`; players may self award only the names
  in the allowlist in `functions/index.js`.

## What the test needs that does not exist

1. **A cell with many checks.** Today one row is one pair. The test needs one
   cell with N checks, each a pair of supervoxels and an expected relation,
   plus one claim and one baseline for the lot. Suggested shape: a
   `proofreading_tests` row (cell, start view, baseline, pass mark) and a
   `proofreading_test_checks` table (test, type `cut` or `merge`,
   supervoxel pair, coordinates, label). Reuse claim, heartbeat and reset
   rather than rewriting them.
2. **Damage checks.** Finding every error is half of it. A player who cuts a
   real branch off, or merges a neighbour on, must not pass. Add "must stay
   together" pairs along the true cell and "must stay apart" pairs for close
   neighbours, or compare the final segment against a reference list of
   supervoxels.
3. **Scoring on the server.** Everything today is checked in the browser and
   the record is written by the player's own client, which is fine for an
   achievement and not for an access grant. The roots must be read by a server
   function (`functions/`, Firebase `eyewire-ii-e4d52`) with its own
   chunkedgraph token, and the grant written there. The list of error
   locations should also stay out of the client bundle, or the answers ship
   with the app.
4. **The grant itself.** I do not know how production access is given today
   (middleauth group, CAVE permission, or a flag in `users`). Find that first,
   it decides what "pass" can actually do.
5. **Throughput.** Edits are real edits on a shared graph, so one cell serves
   one player at a time, and a full proofread is long. Either several copies
   of the test (different cells) or a queue (`joinWaitlist`,
   `waitForTutorial` in `src/practice.ts` already queue for Merge and Cut).
6. **Time.** The idle release is tuned for a five minute exercise. A test
   needs a longer hold and a clear "you will lose your place" warning.
7. **Attempts.** How many tries, and what a failed player sees. Not decided.

## Known weak spots to design around

- **Session loss.** Claims and renewals failed intermittently under several
  testers, most likely the write limiter in `functions/index.js`
  (`rateLimit`, a Firestore transaction on one shared counter that fails
  closed). Since 2026-10-09 the client retries and no longer drops the cell on
  a busy answer. Not yet confirmed fixed by a real run. A test that grants
  access cannot lose a player's hour to this.
- **Mesh lag.** After an edit the new mesh takes a while (the "black box").
  Roots are right at once, the picture is not.
- **Headless testing cannot edit.** Practice views need real auth, so real
  merges and cuts have only ever been tested by Ames and testers by hand.
- **Other sessions.** Many sessions push to `eyewire-ii-community`. Work in
  your own worktree, commit explicit paths, never touch
  `C:\Users\amyle\ng-extend`.

## Is the demo cell free?

Checked 2026-10-10 for `648518346354385062` (pinky sandbox): it is a current
root, and none of the 21 rows in `tutorial_practice_examples` has a supervoxel
on it, nor do the 8 segment ids written into the tutorial code. Not checked:
the segments inside the tutorials' saved view links (they could not be read
with the local token). The check is cheap to repeat: current root of every
row's two supervoxels against the cell's root.

Before registering it, pick its `baseline_at` after the cell is in its
intended broken state, and keep every check on it under that one baseline.

## Working rules

- Player text: the game is **Pyr**, the word is **Achievement** never badge,
  no em or en dashes.
- Deploy: merge `origin/eyewire-ii-community`, `node scripts/build-prod.js`,
  push `amy`, then `origin HEAD:eyewire-ii-community`. A deploy players can
  notice needs a new entry at the top of `static/changelog.json`. Verify from
  the served bundle, never from the push.
- Functions: `npm ci --prefix functions --legacy-peer-deps`,
  `node --test functions/*.test.js`, then
  `firebase deploy --only functions --project eyewire-ii-e4d52`.
- Database: sessions have read access only. Give Ames complete SQL to run in
  the Supabase SQL Editor, printed from the file, never retyped.
- `npm install` needs `--legacy-peer-deps` on this machine.

## What to ask Ames for

1. The demo cell's start view and, per error: type, the coordinate on the
   piece to cut off or merge on, and a coordinate on the main cell beside it.
2. Which datasets a pass unlocks, and how access is given today.
3. The pass mark, whether damage fails the test outright, and how many tries.
4. Whether hints or feedback are shown during or after.
