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
  rewrite it.
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

## When you stop

Leave the kanban card with what shipped (commit and live build id), what is
built but not deployed, and what you did not verify. If you learned
something the next session would otherwise pay for again, add it to
"Things that will bite you" above.
