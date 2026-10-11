# Handoff: the automated proofreading test

Updated 2026-10-11 (UTC) on branch `claude/proofreading-test` (worktree
`C:\Users\amyle\ng-extend-prooftest`, kanban card t_53a6c12d). The first
version of this file (2026-10-10, commit 7c43513) described the tutorials
and what the test would need; this one says what is built, what was found
out about the demo cell, and what is left for Ames.

**State (2026-10-11 17:00 UTC): LIVE on production, on trial.** The schema,
the registration (8 graph checks) and the trial settings (feedback `detail`,
`grant_pilot` false, `cave_groups` {}) are in the database; the test is
enabled; `ewProofreadingTest` is deployed (health `code`
`2026-10-11-proofreading-test-2`); the app on `eyewire-ii-community` serves
the test (changelog entry "A Proofreading Test, on trial"). Ames took it
once: 3 of 7 (the three cuts), nothing damaged, the cell went back to
`ready`. **Still missing: the branch end checks.** Her 38 points live in her
"end of segmentation (3D)" annotation layer (state
`.../nglstate/api/v1/4816048758980608`, unreadable from this machine); she
copies them with a console `copy(...)` snippet, they go into
`config/proofreading-test.json` under `endpoints`, and
`scripts/proofreading-test-register.py --endpoints-only` prints the SQL.
Radius default 1500 nm; she asked to see it in the game first.

## The goal

A player who has done the tutorials takes a test: one Sandbox cell with
several mistakes on it, nothing marked. They cut off what belongs to other
cells, merge on what is missing and mark the end of every branch with a
point annotation, then submit. The server scores the cell from the
chunkedgraph itself, records the attempt, puts the cell back for the next
person and, on a pass, opens production access.

## How production access is given today (found 2026-10-10, reads only)

Two gates, both must be open:

1. **CAVE edit permission** on the dataset, from middleauth
   (`https://global.daf-apis.com/auth/api/v1`). The app marks a dataset
   "View only" from `GET /user/cache` → `permissions_v2` (`src/util/dataset_access.ts`);
   the server's `ewHasProduction` in `functions/index.js` reads the same for
   chat name colours and Team access. Permissions come from groups:
   - Retina (`stroeh-mouse-retina`, auth dataset 21): **Eyewire_2_Edit, group 203**
     carries view+edit (63 members on 2026-10-10). **Eyewire_2_View, 202** is view
     only (148 members). Group admins of both: M Sorek, Simone Ebert, Jan Lause,
     Julia Fadjukov.
   - MEC (`HiMC`, 24): no citizen group at all. Edit = Seung_Lab, 611, Fiete_Lab,
     Zetta_AI, Zheng_mouse_hippocampus, Dorkenwald Lab. Opening MEC to passers
     needs a HiMC dataset admin (Eric) to give a group edit there.
   - The Sandbox (`pinky100`, 4): group `default` has edit, so every signed in
     account can make the test's edits.
   - Adding a member: `POST /auth/api/v1/group/203/user` with `{"user_id": <CAVE id>}`,
     allowed for a group admin of 203 or a middleauth superadmin
     (`requires_group_admin` in github.com/CAVEconnectome/middle_auth,
     `neuroglancer_auth/server.py`). 422 means already a member. Ames's own
     account (CAVE id 122) is a superadmin (`admin: true`), so her token can
     do it. The server function holds no CAVE token today.
2. **The app's pilot list**, `pilot_members` (Admin Hub > Pilot testers).
   `requirePilot` (`functions/pilot-access.js`) gates every secure write
   except profile creation and personal edits, practice cells included. The
   test's own actions sit before that gate: passing is how a player joins.

Today's human process is connectome.quest/access.html: email to ask,
Sandbox, make 10 annotated example links (7 mergers, 3 splits), email them,
get invited. The test replaces the last three steps.

## What is built

### Database: `supabase-proofreading-test.sql`

Run it in the Supabase SQL editor (print it from the file). Idempotent.

- `proofreading_tests`: one row per test cell. Where it is (Pinky only), its
  start view (`state_url`), `anchor_supervoxel` (on the soma), `baseline_at`
  (every graph operation on the cell after this instant is undone at reset),
  the rules (`hold_minutes` 60, `pass_mark` 100, `damage_fails` true,
  `attempts_allowed` NULL = unlimited, `retry_hours` 0, `feedback`
  none/summary/detail, default summary), what a pass grants (`grant_pilot`
  true, `cave_groups` {203}), the claim columns as for practice cells, and
  `enabled` (default false).
- `proofreading_test_checks`: the answers. `kind` is `cut` (a and b start fused,
  must end apart), `merge` (start apart, must end together), `keep` (a real
  part of the cell, must stay with it), `apart` (a neighbour, must stay off)
  or `endpoint` (a branch end: a point annotation within `radius_nm` of
  `point_a`). Two supervoxels, their viewer coordinates, a label, a weight.
- `proofreading_test_attempts`: one row per try, server written: outcome
  pass/fail/abandoned/expired/error, found, errors, damaged, percent, every
  check's result, the player's points, what was granted.
- `pilot_test_action(p_user, p_action, p_args)`: `status`, `claim`,
  `heartbeat`, `cleaned`, `record`. Service role only. No pilot membership
  needed, only a profile. One player at a time; a reload resumes the same
  hold; an expired hold closes the attempt as `expired` and the cell waits
  for a reset; a pass upserts the player's email into `pilot_members` in the
  same transaction; three failed resets in a row mark the cell `broken`.
- Only `proofreading_tests_public` (id, title, status, claimed_by,
  expires_at, hold_minutes of enabled tests) is readable with the public
  key. The checks and attempts are not.

### Server: `functions/proofreading-test.js`

Served by **its own function, `ewProofreadingTest`** (`functions/index.js`), as
`test.status`, `test.start`, `test.heartbeat`, `test.submit`, `test.abandon`,
with no pilot gate. It is not inside `ewSecureWrite` on purpose: several
checkouts on Ames's machine deploy that shared function, and on 2026-10-11
the test's code was deployed there twice and overwritten within two minutes
both times (the audit log in `firebase functions:log` showed the second
UpdateFunction 86 s after the first). Deploy the test's function with
`firebase deploy --only functions:ewProofreadingTest --project eyewire-ii-e4d52`;
its health answer carries `code`, so a deploy can be checked from outside. `functions/pcg-history.js` is the CommonJS copy of the practice
reset job's history rules (a test keeps it in step with
`scripts/practice-reset-policy.mjs`).

- `test.start`: claim, then put the cell back to its start (undo every
  operation after the baseline, with the server's token, then confirm every
  check is in its start state), then hand over the test row without
  answers, the hold's session id, the counts of things to find, and the
  cell's current root. A resumed session skips the reset.
- `test.submit`: prove the hold, read the current root of every check
  supervoxel, score (every cut, merge and endpoint check is worth its
  weight; a broken keep or apart check is damage), on a pass add the player
  to each CAVE group, put the cell back, record the attempt, clear the
  production access cache, and answer by the test's feedback setting: `none`
  says pass or fail only; `summary` adds the counts; `detail` adds each
  check's result and, for a miss, where to look.
- `test.abandon`: put the cell back, record `abandoned`.
- New secret **`EW_CAVE_TOKEN`**: a CAVE token whose account has edit on
  `pinky100` (any account) and is a group admin of Eyewire_2_Edit or a
  middleauth superadmin (Ames's is). Set on 2026-10-11 (version 1). The
  function's timeout is 120 s (scoring reads the graph and undoes the
  player's edits).
- Tests: `functions/proofreading-test.test.js` (a fake chunkedgraph: start,
  resume, a wrongly registered cell, a pass with grant and reset, damage,
  feedback levels, an ended hold, abandon), `functions/pcg-history.test.js`,
  `functions/proofreading-test-sql.test.js` (PGlite: the whole function,
  tries, waits, expiry, broken, public roles). All 111 function tests pass.

### Client: `src/proofreading-test.ts`, tutorial 11

Four boxes and a bar (Ames's changes while taking it, 2026-10-11). Box 1:
what the test is, one player at a time, the rules, the player's own record
(tries, last score, wait), whether a pass grants anything (`grants` in the
public shape), "Start the test". Box 2: how to work the cell: follow every
branch with Highlight, place a point in the End layer at every branch end,
cut off what does not belong and extend what is missing. Box 3 ("Getting
your cell") claims the cell behind the "Moving you to the Sandbox" card,
loads the start view, shows the cell by its current root, makes an empty
annotation layer named **End**, then closes itself; it stays only when the
claim is refused ("Try again"). From then on a **bar at the top left**
(`#nge-test-hud`) carries an "i" that opens the instructions, the count of
things to fix, a countdown of the quiet time left (the hold renews once a
minute while the player moves; the last five minutes warn), and **Submit for
scoring**, which opens box 4. Box 4 scores, celebrates a pass only
(`Step.noConfetti`), explains the score by the feedback level, pins each miss
for two minutes on `detail`, says "branch ends are not scored yet" while no
endpoint check exists, refreshes the dataset permissions, "Try again" or
"done". No forced 2D view.

Leaving the tutorial (x, menu, another tutorial) hands the cell back
unscored. The burger menu lists "5 Proofreading Test" under Tutorials once
the server says a test is enabled, with "(passed)" or "(in use)". Touched:
`Tutorial.vue`, `TutorialStep.vue`, `ExtensionBar.vue`, `store-pyr.ts`
(tutorial 11 step, not stored: a reload starts from the menu and resumes the
hold), `secure_write.ts`, `util/dataset_access.ts` (`refreshDatasetPermissions`),
`practice.ts` (`showOnly` exported).

Typecheck: no new errors (992 before and after, all pre existing).
`node scripts/build-prod.js` passes. Not run in a browser: the actions need
the deployed function and a sign in.

### Registering a test: `config/proofreading-test.json` and `scripts/proofreading-test-register.py`

The config holds the cell (root, start view, anchor = soma), the rules and
one line per check as viewer coordinates (a side left out is the anchor).
The script looks each coordinate up (cloud-volume, layer 1), reads every
root as of the baseline, checks each check is in its start state, and prints
the SQL. Reads only. `--inspect` to look without SQL, `--at <ISO or epoch ms>`
for the baseline (default now), `--anchor x,y,z` for a run without the soma
in the config.

## The demo cell (Ames, 2026-10-10): what the lookup found

Cell `648518346354385062`, start view
`middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5070860612272128`.
Neither saved view can be read from this machine: the state server takes a
brain-wire-test.org token, not the daf-apis one, and the Browser pane is not
signed in. So the **soma coordinate (the anchor) and the endpoint coordinates
are still needed** (the second link, `4621344067026944`, presumably holds
the endpoints).

Every check, looked up on the live graph (`--at 1791680205000`, the instant
before Ames's edits today):

| # | kind | a | b | supervoxels | at that instant | now |
|---|---|---|---|---|---|---|
| 1 | cut | spine 114845, 43659, 1323 | neighbour 115030, 43688, 1335 | 77406443900505418, 77406443900530593 | together on …385062 | apart (b on …1214033) |
| 2 | keep | spine | anchor | | together | together |
| 3 | cut | anchor | neighbour 115058, 43701, 1342 | 77476812644775941 | together | apart (same neighbour, …1214033) |
| 4 | merge | 70213, 43077, 1372 | 69468, 42916, 1430 | 74380587901009110, 74310219223543039 | **together** (not a missing piece then) | apart (b on …2779742) |
| 5 | merge | 67130, 53339, 744 | 67448, 53329, 809 | 74170168527749567, 74170168594634695 | apart | apart |
| 6 | merge | 66310, 53395, 542 | anchor | 74099799716192083 | apart | apart |
| 7 | merge | 65491, 41642, 525 | anchor | 74028606271584335 | apart | apart |

(`--anchor 70213,43077,1372` stood in for the soma in that run.)

**Ames made six edits on this cell today**, all as CAVE user 122, operations
1863 to 1868 (`tabular_change_log`, `operation_details`):

- 1863 (00:56:45 UTC) a multicut around 114000 to 115000, 43400 to 43600:
  the second and third joins (error 2).
- 1864 (00:57:16) a split at 114826, 43696, 1325 / 115002, 43680, 1328: the
  first join (error 1). The neighbour is now root `648518346351214033`.
- 1865 to 1868 (00:59 to 01:01) splits (and one merge back) around 69400 to
  71000, 42800 to 43700: the piece at 69468, 42916, 1430 is now cut off,
  root `648518346352779742`.

So the cell as it is now has the neighbour already cut off (errors 1 and 2
done) and the piece for error 3 missing (error 3 created). No single past
instant has both the neighbour fused and that piece loose. **To get the start
you described, undo operations 1864 and 1863** (they put the neighbour's
original edges back; the later operations do not touch those supervoxels),
then set the baseline to just after. Say the word and I run those two undos
with your token (`POST …/pinky_nf_v2/undo {"operation_id": 1864}`, then
1863), re-run the lookup, and print the registration SQL. If instead the
test should start from the cell as it is now, drop checks 1 to 3 from the
config and register with `--at` now.

Also worth a look: the spine point 114845, 43659, 1323 is 90 voxels (360 nm)
from the cut location 114936, 43650, 1324. Check 1 pairs the spine with the
neighbour, so a cut on the wrong side of the spine counts as a missed cut
and as damage (check 2). That is intended.

## Rollout order

1. SQL: `supabase-proofreading-test.sql` in the Supabase editor.
2. Secret: `firebase functions:secrets:set EW_CAVE_TOKEN --project eyewire-ii-e4d52`
   (an account that is group admin of Eyewire_2_Edit or superadmin). Then
   `npm ci --prefix functions --legacy-peer-deps`, `node --test functions/*.test.js`,
   `firebase deploy --only functions:ewSecureWrite --project eyewire-ii-e4d52`.
3. Register: put the soma and the endpoints in `config/proofreading-test.json`,
   fix the cell's start (above), run the script, paste its SQL. The row is
   `enabled = false` until the last line.
4. App: merge `origin/eyewire-ii-community`, `node scripts/build-prod.js`,
   push `amy`, then `origin HEAD:eyewire-ii-community` when Ames says deploy.
   A changelog entry is needed when the test goes live (not before: nothing
   shows until a test is enabled), for example: "Proofreading Test: one
   Sandbox cell with several mistakes, scored by the server. Pass it and the
   retina opens to you." in `static/changelog.json`.
5. First real run by Ames (an admin may take it any time, and again after
   passing): the cell loads at its start, cuts and merges go through, Submit
   scores, the attempt row, the `pilot_members` row, `GET /user/cache` shows
   `stroeh-mouse-retina` edit, the dataset switcher drops "View only" (maybe
   after a sign out and in: middleauth caches permissions).

## Decisions still open (defaults are in the SQL and the config)

- Pass mark 100 percent and damage fails outright; tries unlimited, no wait
  between tries; feedback `summary` (counts, no locations); 60 quiet minutes.
- Which datasets a pass opens: Retina (group 203) only. MEC needs Eric.
- Whether the counts of things to find are shown during the test (they are,
  unless feedback is `none`).
- Whether a stray endpoint annotation (near no branch end) should cost
  anything (it is counted and reported, not penalised).

## Known limits

- One cell, one player at a time, no queue: the menu says "(in use)".
- Scoring is the root relation of each registered pair, so a cut at a
  slightly different place with the same effect passes; a cut that strands a
  registered point fails. Endpoints are a distance test in nm (viewer voxels
  are 4 x 4 x 40).
- The undo at start and at submit runs inside one request (120 s). Many
  operations could still time out; the attempt is then recorded as `error`
  (not counted as a try), the cell waits for the next start to retry, and
  after three failures it is `broken` for an admin.
- Real edits were not made from a headless browser (no sign in); the server
  is tested against a fake graph, the SQL in PGlite.
- `tutorial_completions` is not written for the test; its record is
  `proofreading_test_attempts` (service role only; no Admin Hub page yet).
- A player who passes and later edits badly keeps access: no revocation.

## What the tutorials already provide (from the 2026-10-10 handoff, still true)

Merge (`src/tutorial-3.ts`), Cut (`src/tutorial-cut.ts`) and the Merger
Sandbox (`src/merger-sandbox.ts`) run on resettable practice cells
(`src/practice.ts`, `supabase-tutorial-practice-schema.sql`,
`pilot_practice_action` in `supabase-pilot-access.sql`): one row is two
supervoxels and whether they should end up together. The test generalises
that to many pairs on one cell under one claim and one baseline, scored on
the server. The practice reset job (`scripts/reset-practice-examples.mjs`)
is untouched; the test cell has its own reset in the server function.

## Working rules

- Player text: the game is **Pyr**, the word is **Achievement** never badge,
  no em or en dashes.
- Database: sessions have read access only; give Ames complete SQL printed
  from the file.
- `npm install` needs `--legacy-peer-deps` on this machine.
- Other sessions push `eyewire-ii-community` constantly: fetch and merge
  before pushing; commit explicit paths.
