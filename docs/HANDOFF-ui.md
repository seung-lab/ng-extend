# Handoff: general UI work in Pyr (EyeWire II)

From Ames, 2026-10-11. Paste this into a new chat to start.

---

You are taking UI requests for Pyr, the citizen science proofreading game
built on neuroglancer. Ames sends them as they come up: a screenshot and a
sentence, several an hour on a busy day. Most are small (wording, size,
colour, a missing button, something that looks wrong on a phone). Call her
Ames.

Repo: `seung-lab/ng-extend`, branch `eyewire-ii-community`. Vue 3 and Pinia
on top of a vendored neuroglancer (`third_party/neuroglancer`).

## How Ames works

- **She prefers action to analysis.** For a small, clear request: build it,
  test it, show her. Ask a question only when the answer changes what you
  build and is hers to decide (a name players will see, which of two
  designs). One question, with options.
- **She says "deploy" when she wants it live.** Nothing goes to the live
  branch without that word, each time. An earlier "deploy" does not cover a
  later change.
- **She tests on the live game and on her phone**, and sends what she sees.
  Expect a second round: "the font is too small", "way too much text".
  Short copy and readable type are the usual corrections.
- **Verify before you say it is done**, and say plainly what you did not
  verify. "Built and measured in a headless browser, not seen on a real
  phone" is a good sentence. "Done" when you only compiled it is not.
- When a request is unclear, look at the screenshot and the code before
  asking. If it is still unclear, do the clear parts and ask about the rest.

## Before you write anything

1. **Claim a card** on the github-kanban board (ToolSearch the
   `mcp__github-kanban__*` tools; agent `claude`, repository
   `seung-lab/ng-extend`). One card for a sitting of small items is fine.
2. **Use your own worktree** off `origin/eyewire-ii-community`. Never work
   in `C:\Users\amyle\ng-extend`: several sessions share it and it is
   usually diverged. A spare one exists at `C:\Users\amyle\ng-extend-leaderboard`
   if no other session holds it (check `git status` and the branch first).
3. In a new worktree: `npm install --legacy-peer-deps` (plain `npm install`
   crashes here), then
   `git checkout -- node_modules package-lock.json`, because
   `node_modules/neuroglancer` is tracked.
4. **Start every item from a fresh branch off the live branch**
   (`git fetch origin` then
   `git checkout -B claude/<item> origin/eyewire-ii-community`). The live
   branch moves many times an hour.

## The words players read

These are rules, and the deploy and Ames both check them.

- The game is **Pyr**. Never "EyeWire II" in anything a player reads. One
  exception she made on 2026-10-10: the retina dataset's short name stays
  "EyeWire II".
- **Achievement**, never "badge", in anything a player reads. Admin screens
  may say badge.
- **No em or en dashes.** Commas and periods.
- No gradient text. No thin italic on dark backgrounds. Unit symbols (µm,
  nm) are never uppercased by `text-transform`.
- Plain sentences a player understands. No code words, no file names.
- Less text. If a line can go into a tooltip, put it there.
- Real data only. Never demo players, sample numbers or a mock in place of
  the real thing, not even while loading. A number that can not be read is
  "not available", never zero.
- Counts of edits and cells are counts, not a score. Only work done in the
  game counts.

## The look

The source of truth is `C:\Users\amyle\scifi-ui`
(https://github.com/amyleesterling/scifi-ui). Read its `AGENTS.md` once.

- **Carry real values across.** Open the component in the game that is
  nearest to what you are building, read its whole stylesheet, and use its
  numbers. Do not rebuild a look from how it appears.
- Accents: blue `74 158 255`, cyan `126 224 255`, green `124 255 178` for
  Highlight, amber `255 210 77` for trophies and somas, red for Triage.
- **Only ambient things loop.** Everything else plays once: a number rolls
  up because it loaded, a border is traced because the box arrived. Honour
  `prefers-reduced-motion`.
- When something should draw the eye, use the animations that already ship:
  `src/util/holo_trace.ts` (`runPanelLap`, `runPanelTrace`,
  `runParticleBurst`, `runPanelZip`), `src/util/panel_collapse.ts` (the
  morph into a slim strip and the light beam back), `src/find_path_status.ts`
  (the generative path search loader). The "Ctrl + click the soma" callout
  in `HighlightModePanel.vue` is a recent example of one clear ask, lit once.
- Side panels are narrow panels on desktop, not full screen overlays.
- "Too bold" is a common note. A setting is quiet; a call to action is not.

## Where things are

| Thing | File |
|---|---|
| Top bar, its icons, global shortcuts, the phone bottom nav | `src/components/ExtensionBar.vue` |
| The customisable icons and their tooltips | `src/data/toolbar-icons.ts` |
| Phone layout (everything under `body.nge-mobile`) | `src/mobile.css`, `src/util/mobile.ts` |
| Chat | `src/components/ChatPanel.vue` |
| Notifications feed and the detail window | `src/components/NotificationFeedPanel.vue` |
| Admin Hub (composer, special badges, practice cells) | `src/components/AdminHub.vue` |
| Profile, Trophy Case, Week in Science | `src/components/UserProfilePanel.vue`, `WeeklyRecapPanel.vue` |
| Leaderboard | `src/components/LeaderboardPanel.vue` |
| Cell Library | `src/components/CellLibraryPanel.vue` |
| Highlight mode | `src/components/HighlightModePanel.vue`, `src/util/highlight.ts`, `src/util/branch_tree.ts` |
| Tutorials and the Merger Sandbox | `src/tutorial-*.ts`, `src/merger-sandbox.ts`, `src/components/Tutorial.vue`, `TutorialStep.vue` |
| Datasets and their names | `src/datasets.ts`, `src/config.ts` |
| Restyling neuroglancer's own parts | `src/ng-override.css`, `src/widgets/*.css` |
| All the Pinia stores (one large file) | `src/store.ts` |

Shortcuts taken: Shift+T tags, Shift+L Cell Library, Shift+F flight mode,
Shift+H Highlight, Shift+N Lantern, C cut, M merge, F find path. Plain
letters mostly belong to neuroglancer; check before taking one.

## Things that will bite you

- **Vue files are not type checked by the build.** A misspelled name in a
  `.vue` file ships and then silently does nothing. Check every identifier
  and import by hand, and click the thing in a browser.
- **Never toggle a class by hand on an element Vue renders.** The next
  render wipes it. Bind it with `:class`.
- **A `const` used in a `computed` must be declared above it** if anything
  reads the computed during setup.
- **Shell heredocs here eat backslashes.** A Python or Node script pasted
  through a heredoc turns `\n` into a newline in your source and `\b` into
  a real backspace character (this broke a regular expression silently on
  2026-10-10). Write edit scripts with the Write tool and run the file, or
  use the Edit tool.
- **Files mix CRLF and LF.** Keep each file's own line endings when you
  rewrite it. **Git Bash's `grep` cannot see a CR in a file on disk** (it
  reads in text mode), so `grep -q $'\r' file` says LF for a CRLF file and a
  script that matches multi line text then finds nothing (2026-10-13, 31
  patches missed). The working copy is CRLF for most files (git autocrlf);
  count bytes with Python (`open(f,'rb').read().count(b'\r\n')`), match on LF
  and write back what the file had. The Edit tool handles this by itself.
- **Other sessions are editing at the same time.** Fetch before every
  rebase. If someone already fixed the thing you are fixing, keep theirs.
- **`static/changelog.json` conflicts on almost every rebase**, because
  every session adds its entry at the top. When it does: take the live
  version of the file and add your entry again on top. Do not hand merge
  the conflict markers.
- **After a rebase stops on a conflict you are on a detached HEAD.**
  Pushing `HEAD` then publishes the live tip without your work. Before
  every push, check `git branch --show-current` prints your branch.
- **The Browser pane's tabs can be hidden**, and then
  `requestAnimationFrame` never fires. Test anything animated with
  Playwright instead.
- **`npm run build` alone gives a bundle with no dataset.** It leaves
  `CONFIG` undefined, so the page opens with no segmentation layer, the
  profile has no dataset scope, and every per dataset number stays zero.
  For a headless test that needs a dataset, build with
  `DATASET=pinky_sandbox node scripts/build-prod.js`, which bakes the
  config and the default state into `dist/min` (2026-10-11).
- **A cut or merge bar set through the store alone vanishes within half a
  second.** `observeSplitMergeTools` in `src/main.ts` polls for the tool's
  own box (`.graphene-multicut`, `.graphene-merge-segments`) and resets the
  store when it is missing. In a headless test without a sign in the graph
  never loads, so pressing C does nothing. Stand in for the tool with a
  hidden `<div class="graphene-multicut">` and the bar stays up and behaves
  (2026-10-12).
- **Testing the triage board headless:** open `?triage=board` with a fake
  sign in (localStorage `auth_token_v2_https://global.daf-apis.com/sticky_auth`
  = `{"accessToken":"x"}`, and answer `daf-apis.com/auth/api/v1/user/me` with
  an email). Private tables never hit Supabase directly: `src/community_fetch.ts`
  POSTs `{table, method, query}` to the `ewCommunityData` function and expects
  `{status, headers, body}` back, with `body` the JSON **text** of the rows.
  Answer that in the test. On the board a card shows its buttons only once it
  is selected (click its meta row first), the Done and Later columns start
  folded, and the decision comment box shares the class
  `nge-triage-comment` with the submitter draft, so find the draft inside
  `.nge-triage-reporter` (2026-10-12).
- **A column's last section loses its border and bottom margin** (the
  profile's stylesheet strips them from `:last-child`). Stamp sections in
  as direct children of the column; a wrapper `div` around two of them
  makes the second one "last" and it sits tight on whatever follows.

## Building and testing

- `npm run build` writes `dist/min`. It prints about a thousand type errors
  from neuroglancer's spec and benchmark files; that is old noise. What
  matters is any `X [ERROR]` line and any error under `src/` or in a
  `third_party` file you touched.
- Serve it: `python -m http.server <port> --directory dist/min` (stop it
  when you are done).
- Playwright is at `C:/Users/amyle/hidden-worlds/node_modules/playwright`,
  Chrome at
  `C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
  (add `--use-angle=swiftshader --enable-unsafe-swiftshader` for 3D).
- **Get past the login screen** by setting the stores through
  `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
  (`_s.get('login').sessions = [...]`, `_s.get('proofreadingBackend').userId`,
  `.isAdmin`). Hide `.nge-login-blocker, .nge-login-modal` with a style tag.
  On a phone sized page also hide `.nge-mw-blocker` (the welcome sheet).
- **Intercept every server call in a test**: route
  `cloudfunctions.net` and `run.app` to a canned answer, and answer every
  non GET request to `supabase.co` yourself. A test must never be able to
  write to production.
- **Phone:** `devices['iPhone 13']`. The on-screen keyboard can be faked by
  replacing `window.visualViewport` in an init script (see how
  `src/util/mobile.ts` reads it). A faked keyboard proves the layout, not
  the real iPhone; say so.
- **Measure, then look.** Read sizes and text out of the page, and also
  take a screenshot and look at it. Check the empty state, the busy state
  and phone width.
- A real cell in 3D needs a real sign in and is rarely needed for UI work.
  If you do need one, ask Ames first.

## Shipping

- Remote `amy` is her fork: push there freely. Remote `origin` is the lab's
  repo, and **every push to `eyewire-ii-community` there deploys the live
  game.** Only on her "deploy".
- **The changelog.** A push that changes `src/`, `static/` or
  `third_party/` must add a new entry at the top of
  `static/changelog.json` in the same push, or the deploy stops. `at` is
  the push time in UTC, never in the future, and later than the entry
  below it. Items are plain sentences for players. For a change players
  can not notice (admin screens, refactors) put `[no player change]` in a
  commit message instead. Read CHANGELOG-RULE in `README.md`.
- **To deploy:** fetch, rebase, build, confirm you are on your branch,
  `git push origin HEAD:refs/heads/eyewire-ii-community`. Find the run by
  its head SHA
  (`gh run list -R seung-lab/ng-extend --workflow on_dev_branch_push.yml --json databaseId,headSha,headBranch`),
  watch it, then confirm from the live site
  (`https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`):
  grep the bundle or `changelog.json` for a string only your build has. A
  push is not a deploy. If the deploy step fails with an internal error
  from Google, rerun the run; the live site stays on the old build
  meanwhile.
- **A test link for her phone:** push the branch to `origin` under any
  other name and it builds at
  `https://<name>-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`. Delete
  the branch afterwards.
- **Server code** (`functions/`, Firebase `eyewire-ii-e4d52`) is deployed
  separately and UI work should not need it. If it does: rebase first so
  you do not undo another session's server change, and test the state the
  system will be in after your change, not only the one it is in. On
  2026-10-05 a server branch that woke up after a database change broke
  every profile read for about twenty minutes.
- Never rewrite history or force push the live branch. Undo with a revert.
- Never print keys or tokens.

## Open UI items

Known and not done as of 2026-10-11. Ask Ames which she wants; do not
assume the order.

- **Phone top bar:** the Share button is clipped to "Sh" beside the profile
  icon. Hide it on phones or make it an icon.
- **BANC is listed under View Only but can be edited** (Krzysztof Kruk).
  Either the label or the editing is wrong.
- **The dataset list is the same for everyone.** Krzysztof asked for it to
  follow each person's permissions.
- **Chat formatting:** `*text*` and `**text**` are not rendered in chat.
  Check that a message written with Shift+Enter shows as several lines.
- **A cell ID from another dataset in chat** still links as if it were in
  the reader's dataset when the message carries no dataset.
- **Highlight:** the colour is round at the click and spills about the
  colour reach past it. Squaring the start off is a change to how the tint
  is painted (`buildTint` in `src/util/highlight.ts`).
- **Notification detail, long text with a wide picture:** the text column
  is 568 px in a 1082 px card. It could be given more.
- **Top bar icons for new players:** see `docs/HANDOFF-topbar-staging.md`.
  The first deliverable there is a plan, not code.

Three larger things Ames has asked to be reminded of on Wednesday
2026-10-14, none of them yours to start unasked: a staging copy of the
server and database, one file per changelog entry, and type checking the
Vue files.

## Annotation Quests (prototype, 2026-10-12)

Ames: "Make annotating a cell a Quest in addition to completing a cell."
Retina first: find and mark every cilium on a starburst amacrine cell. Built
on `claude/annotation-quests`, not deployed.

- **The record is the lab's Cilia sheet**
  (`1CXRPE4rmH1SRQ3nqdyp9ULsMdQygJ-Ldjn3jN_jcqRU`, tab gid 0, 93 cells). Its
  "Input for Website" tab says what each column is for: J Start Link is read;
  K Cilium status and L Cilium split or merged? are chosen at submit from the
  sheet's own dropdowns; M Annotation share link, P Date and Q Annotator Notes
  are written at submit; O Annotator Name is written at claim; N is skipped.
  No game table is involved: whose cell it is comes from column O.
- **Server:** `functions/sheet-policy.js` (`QUESTS`, `questRows`,
  `planQuestUpdate`, tests in `sheet-policy.test.js`), `functions/sheet-sync.js`
  (`questList`, `syncQuest`), and the `input.quest` branch of `ewSheetSync` in
  `functions/index.js`. Actions `quest_list`, `quest_claim`, `quest_release`,
  `quest_submit`. The dropdown lists are copied character for character; the
  server refuses anything else.
- **Client:** `src/annotation_quests.ts` (the calls and the same lists),
  `src/components/AnnotationQuestsTab.vue`, a Quests tab in the Cell Library's
  Cells row (`questsHere`: retina only). Claim writes the name and opens the
  Start Link in place (the lab's own annotation layers come with it, one per
  part of a cilium, typo "Daugther" included); ↗ shows only that cell at its
  soma; Submit needs the crosshairs inside the cell (`cellAtCrosshair`, with
  `ancestorAmong` for a cell edited since the sheet was made), takes the
  status from a dropdown, mints a share link of the view
  (`mintShortStateLink`) and sends status, split or merged, notes and the
  link. "Completed by you" counts the sheet rows with the player's name and a
  status (Ames 2026-10-13 asked for a count; the profile does not have one,
  that needs a record in the game's own tables). **Whose row it is comes
  from the server's `you`** (the name it writes, `users.display_name`), not
  from the client's `backend.userName` (the CAVE name): the two differed
  ("Amy R. Sterling" vs "Amy Sterling") and the count showed 0. The row last
  clicked, opened or jumped to is marked like the Cell Library's last jump.
  Completing fires `nge:quest-complete` on `document` with the Complete
  button's screen point; `AchievementToast.vue` turns it into a large quest
  toast (460 px, 8 s) with the annotation and quest counts, and confetti
  from that point in shades of one random colour (`ConfettiCelebration.vue`
  `trigger('mono', 2.5, origin)`). The profile's Scout report has a Quests
  column: the sheet rows with the player's name and a status, read through
  `listQuests`; "not available" when the sheet cannot be read.
  The tab shows on every dataset; off Retina it says where quests are and
  offers `switchToDataset` (the standard switch, which may open the dataset's
  intro for a first visit).
- **The lab's layers:** after Claim or Open, `dressQuestLayers` waits for the
  Start Link's own annotation layers (the state load REPLACES every layer with
  a fresh instance, so anything done to the layers on screen at click time is
  undone a moment later; it waits for lab layers that were not there before
  the link was opened), colours them from the colour key (next) and adds a
  `Cilium centerline` polyline layer when the view has none. Nothing of the
  lab's is removed or renamed.
- **The colour key** is the top bar's icon accents in `src/data/toolbar-icons.ts`:
  Highlight green `#7CFFB2`, red `#e06060`, gold `#f5d142`, mint `#3ddc97`,
  purple `#c8a4ff`, sky `#35b5ff`. The quest layers use it, in this order:
  Cilium centerline green, Daughter centriole red, Basal body gold
  (`QUEST_LAYER_COLORS`, reordered with `reorderManagedLayer`); the Quests
  tab's number is the Highlight green. The lab's own layer names are kept,
  typo included: the lab's own checks may read them. The layer we add is
  spelled as the lab's own views spell it, `Cilium centerline` (lower case
  c; it was `Cilium Centerline` until 2026-10-13, so views saved from the
  test site before then carry the capital). Layers are matched by pattern,
  never by exact name, so both are found.
- **The polyline annotation** (2026-10-13) is a port from the lab's
  neuroglancer (`seung-lab/neuroglancer`, branch `cj-polyline-test-fix`) into
  our older vendored copy, so a centerline drawn in Pyr is the same
  annotation the lab's viewer makes (`{"type": "polyline", "points": [...]}`
  in a share link) and theirs open here. Where it lives:
  `annotation/index.ts` (the type, its JSON, its buffer: one instance per
  line, each starting with a uint32 whose low 31 bits are the line's index and
  whose high bit marks the last line), `annotation/polyline.ts` (the
  renderer), `annotation/type_handler.ts` (the shader prelude:
  `setLineColor`, `setLineWidth` and the endpoint setters now fan out to
  `setSingleLine*` and `setPolyLine*`; user shaders are unchanged),
  `annotation/renderlayer.ts` and `frontend_source.ts` (draw and pick by
  instance: `typeToSize`, `typeToInstanceCounts`), `ui/annotations.ts`
  (`MultiStepAnnotationTool`, `PlacePolylineTool`, the button, the hint).
  Different from the lab's: Enter, Backspace and Esc are listened for only
  while a polyline is being drawn (their build binds them for the whole
  viewer, which would take Enter from the cut and merge bars); the click's
  own position becomes the point; a polyline of one point is not kept.
  Not ported: polylines in precomputed sources and in sources edited chunk
  by chunk (no such source in Pyr). The button is in every annotation layer,
  on every dataset. Test: `scripts/polyline.test.cjs` (26 checks: load, draw
  counted in pixels against an empty control, the tool and its keys, picking
  beside a point, a line, a box and an ellipsoid, save and reload).
- **The quest's description and instructions are the lab's own** (Celia,
  2026-10-13): `QUEST_LEAD` and the six steps in `AnnotationQuestsTab.vue`,
  with `QUEST_GUIDE_URL` (a SharePoint deck, opens signed out) and
  `QUEST_VIDEO_URL` (the training video on YouTube, from where the cilia part
  starts; left empty, step 2 does not mention a video). One sentence in step
  3, on the centerline's keys, is ours. The Instructions button is lit once
  per browser, three seconds after the tab first opens
  (`nge-cilia-quest-intro-seen` in localStorage, `runPanelLap` and one CSS
  glow; it never loops).
- **"Here's a reference" opens the lab's real examples in Pyr** (Ames
  2026-10-13: "a ng link that has layers/annotations and descriptions to
  demo the various things on real cell with real example annotations"), not
  the lab's sheet. `src/annotation_quest_examples.ts` holds them and is
  **generated, never edited**: `python -I scripts/make-quest-examples.py
  <a folder outside the repo>` reads the lab's reference sheet (Status, When
  to use, Example) and the saved view of each example, and writes the file.
  What it gives:
  - `QUEST_STATUS_GUIDE`, the lab's "when to use" per status. The Submit
    form shows it under the status chosen (`.nge-aq-status-hint`). The sheet
    explains eight of the nine statuses; `No cilium (one centriole)` has no
    line, so it shows none. Nothing is written in its place.
  - `openQuestExamples()`: one view, in a NEW TAB (the view in hand and its
    annotations are not replaced), built as a `#!` state link to this site.
    It holds the three example cells and the lab's own annotations in the
    quest's three layers, named as the lab names them, in the colour key.
    Each basal body's description is `Example: <status>. <when to use>`, so
    the Basal body list, open on arrival, is the index. The arrows over the
    list step from example to example (they select and move); a click on a
    row only selects; the row's jump button moves. The view opens on the
    lab's own framing of the first example, the tip of its cilium.
  - The sheet gives an example for three statuses only. The other five have
    no example anywhere, and none is invented.
  **Where the views live.** The sheet first linked views on the CAVE state
  server (`global.daf-apis.com`), read with the CAVE token on this machine.
  On 2026-10-13 the lab re-pointed the Example column at Pyr share links on
  the TEST site (`annotation-quests-dot-...appspot.com/#!middleauth+https://
  global.brain-wire-test.org/nglstate/...`). Pyr's state server answers only
  a signed in player (signed out it returns a sign in page, status 200), and
  the CAVE token must never be sent there. So the script falls back to the
  lab's original view of the same status and says so; someone signed in can
  save a view as `state-<id>.json` in the downloads folder and the script
  uses that instead (the script's header says how). **The same number is a
  different view on each state server:** read the server from the link.
  **Because the lab's sheet links the test site, do not delete the
  `annotation-quests` test branch at deploy time without telling Ames:** the
  sheet's links would die, and they need the live address instead.
  The example cells are named by root id; all three were current on
  2026-10-13. An edit to one later leaves the example showing the cell as it
  was annotated.
- **A description reads whole in every annotation list** (2026-10-13,
  `annotations_restyle.css`, marker `nge-ann-description-whole`): it wraps,
  at 13px, up to eight lines, where it used to be one line cut with an
  ellipsis. This is every annotation layer on every dataset, not only the
  quest. The row's jump and delete buttons sit on the first line so they do
  not lie over the words.
- **The quest's words:** the action is Submit, never Complete (Ames
  2026-10-13: Complete is proofreading's word). A player holds at most three
  cells at once (`claimLimit` in `QUESTS`, `questClaimRoom` on the server,
  `QUEST_CLAIM_LIMIT` in the tab). The Quests tab's number is the cells open
  to claim, in green; `questState` in `src/annotation_quests.ts` is the one
  shared read for the tab, that number and the profile.
- **Server code on a branch gets wiped.** On 2026-10-13 another session's
  `firebase deploy` from the live branch replaced `ewSheetSync` with code
  that had no quest branch, and the tab said "This dataset has no registered
  source sheet" for Ames mid test. Firebase serves whatever checkout last ran
  the deploy, so a function changed on an unmerged branch is live only until
  the next deploy from anywhere else. Merge `functions/` to the live branch
  (`[no player change]`) before or right after deploying it, even while the
  UI that uses it stays on the branch.
- **To go live, in this order:** (1) Ames shares the sheet with the Sheets
  identity `eyewire-ii-spreadsheet@eyewire-ii.iam.gserviceaccount.com` as an
  editor (it is not on the sheet as of 2026-10-12, so reads and writes fail);
  (2) deploy the function:
  `firebase deploy --only functions:ewSheetSync --project eyewire-ii-e4d52`
  from a rebased checkout, then `action: 'health'` still passes and a
  `quest_list` returns rows; (3) deploy the UI with a changelog entry marked
  headline. The UI before the function shows an error in the tab.
- **Testing the tab headless:** `scripts/quests-tab.test.cjs` (build with
  `DATASET=stroeh_mouse_retina node scripts/build-prod.js`, serve `dist/min`
  on 3488), and `scripts/quest-examples.test.cjs` for the examples view (16
  checks: the links, the new tab, the lab's points and nine point polyline,
  the descriptions, the arrows, and the centerline and basal body counted in
  pixels against the same view with the quest layers hidden). **To hide a
  layer in a test call `managedLayer.setVisible(false)`:** assigning
  `managedLayer.visible = false` only sets the flag, tells the viewer
  nothing and raises nothing, so the layer stays drawn and a control built
  on it compares a picture with itself. A new tab opened by
  the test's made-up player gets the Welcome tutorial over the view; the
  test puts away whatever floats over the views before it measures.
  The tab test answers every server: the gateway, the state servers, and
  every middleauth host. **One 401 with a fake token wedges the middleauth
  provider:** it then waits for a login for good and every later signed
  request (the share link included) hangs with no error. Stub every
  middleauth host with a catch-all registered first, and keep the
  segmentation server unreachable (abort), never 401.
- **Off Retina the Quests tab names the dataset as the top bar does**
  (Ames 2026-10-13: "this should say Switch to Retina"): `questDatasetName`
  in `CellLibraryPanel.vue` is `datasetAbbrev(...)`, "Retina". The dataset's
  `shortLabel` reads "EyeWire II", which is what `datasetDisplayName` gives.
  **The switch reloads the page** into the dataset's start view
  (`selectLayers` in `store.ts`), so anything meant to happen afterwards has
  to be left for the next page: `rememberAfterSwitch(undefined, 'quests')`
  writes `nge_cl_after_switch` in sessionStorage, `ExtensionBar.vue` reopens
  the Cell Library on that tab once the player is known, and the panel
  clears the note when it mounts. The same note carries Help requests across
  a switch. Test: `scripts/quests-elsewhere.test.cjs` on a
  `DATASET=pinky_sandbox` build (10 checks, through the reload).
- **The server allows each player 60 quest list reads a day, 8 a minute**
  (`rateLimit(..., "read:quests")` in `functions/index.js` falls to the
  anonymous tier), and 1500 a day for everyone together. Past that the tab
  shows "Please wait a moment." So `listQuests()` in `annotation_quests.ts`
  shares one request among callers that ask together, answers from a read
  that finished within three seconds, and starts afresh after any write.
  Opening the library on Quests costs one read (it cost two, and four after
  a switch). **Not changed: the cap itself.** A keen player can still reach
  60 in a day; raising it is a server change and needs Ames's word.
- Not done: the Slack bridge, the Guide's knowledge and the Slack bot do not
  know about quests yet; no stats or Achievement count a quest.

## When you stop

Leave the kanban card with what shipped (commit and live build id), what is
built but not deployed, and what you did not verify. If you learned
something the next session would otherwise pay for again, add it to
"Things that will bite you" above.
