# Handoff: staging in the top bar icons for new players

From Ames, 2026-10-06. Written by the UI session (branch `claude/ui-fixes`).

## The ask

The top bar has a lot of icons, and a brand new player sees all of them at
once. Ames wants them staged in: a new player starts with a few, and the rest
arrive later, for example after the Get Started tutorial.

**The first deliverable is a PLAN, not code.** Work out which icons matter
most to a new player and which should be introduced later, and when. Bring
the plan to Ames and wait for her answer before building anything.

## What is in the top bar today

Left side, fixed: the Pyr logo, AI (Nurro), Data (dataset switcher), Share.

Right side, fixed: the streak chip, the bug (Submit an issue), the profile
icon, the burger menu, the display settings sliders. Ames has said of the
burger "don't change the burger it is perfect".

Right side, customisable (the subject of this handoff). Defined in
`src/data/toolbar-icons.ts`; the default order is `DEFAULT_TOOLBAR_ORDER`:

| id | What it opens |
|---|---|
| `cells` | Cell Library (the main way in to real work) |
| `split` | Cut mode |
| `merge` | Merge mode |
| `findPath` | Find Path |
| `highlight` | Highlight mode |
| `recap` | Your Week in Science |
| `leaderboard` | Leaderboard |
| `datasetStats` | Dataset Stats |
| `batch` | Batch Processor |
| `help` | Second Opinion Requests |
| `tags` | Tag mode (scout tags) |
| `layers` | Layer side panel |
| `notif` | Notifications |
| `chat` | Chat |
| `screenshot` | Take a screenshot (injected after `batch` for older accounts) |

Retired and not shown: `quest`, `feed`, `settings`.

## How visibility works now

- Each player's list lives in `prefs.toolbarIcons` (user preferences store in
  `src/store.ts`, synced to the server) and is edited in Profile, Settings,
  "Toolbar Icons" (`src/components/SettingsPanel.vue`).
- `resolveToolbarOrder(saved, injected)` in `src/data/toolbar-icons.ts` turns
  the saved list into what renders. It already has a mechanism for adding an
  icon to accounts that predate it exactly once (`AUTO_INJECT_TOOLBAR_ICONS`,
  `prefs.toolbarIconsInjected`). Staging can probably reuse that idea: it is
  the same problem of "add this icon later without undoing the player's own
  choices".
- `src/components/ExtensionBar.vue` renders the bar and maps ids to actions.
- Nurro knows the icon list (`src/assistant/knowledge.ts`), so it must be
  told about any staging or it will point new players at icons they do not
  have yet.

## Signals available for "how far along is this player"

- Tutorial progress on the user row: `tutorial_active`, `tutorial_1_step`,
  `tutorial_2_step`, `tutorial_3_step`. Get Started is tutorial 1; Cut and
  Merge have their own tutorials and practice cells (`src/practice.ts`,
  `src/tutorial-1.ts`, `src/tutorial-3.ts`).
- Counters: `total_edits`, `cells_completed`, `total_annotations`,
  `total_days` (a day needs real work, see `supabase-days-need-action.sql`).
- Production access, asked of CAVE (`src/util/dataset_access.ts`,
  `editsAny`). Chat names are already coloured by it.
- Dataset in view: Sandbox, View Only or Production (`src/datasets.ts`).

## Questions the plan should answer

1. Which icons does a player need on their very first visit, before any
   tutorial? Give a reason for each one kept.
2. For every other icon: what event brings it in (finishing Get Started,
   finishing the Cut or Merge tutorial, a first edit, a first completed cell,
   production access, a number of days), and why that event?
3. How does an icon arrive? A quiet appearance, a one time highlight, a
   Nurro line, a notification? It should feel like a small reward, not a
   surprise rearrangement.
4. What happens to the accounts that exist today? The safe default is that
   nobody who already has an icon loses it.
5. Can a new player still reach a hidden feature another way (the burger
   menu, Command K, a link in chat)? Hidden from the bar must not mean
   unreachable.
6. How does this interact with the Settings grid, where a player can turn
   icons on and off by hand? A player's own choice should win in both
   directions.
7. Phones have their own bottom navigation (`nge-mnav` in ExtensionBar).
   Is it in scope?
8. Gamemasters and admins: should they skip staging entirely?

## How to decide what matters

Do not guess. Useful evidence:

- What the tutorials already teach, in order: an icon that a tutorial step
  points at has to be visible by that step.
- What new players actually use. `edit_log` shows first actions; triage
  reports (`site_issues`, the Admin Hub Triage board) show where new players
  get lost. Read access goes through the gateway and is limited; say what
  could not be read.
- Ames and Celia's view of the newcomer path. Ask, with a short list of
  concrete options.

## Standing rules that apply

- Call her Ames.
- No em or en dashes in anything a player reads. No gradient text.
- Player facing copy says "Achievement", never "badge".
- Push to the `amy` fork by default. Push to `origin` (production) only when
  Ames says "deploy".
- Iterate on a local build, never against App Engine.
- Several sessions share this repository. Check the branch before every
  commit and commit explicit paths.
- Verify before asserting: a claim about what a new player sees needs a
  fresh account or a headless run with empty preferences behind it.

## Not decided yet

Everything above the line "Questions the plan should answer" is fact. The
staging order itself, the trigger events and the arrival treatment are all
open, and are Ames's to decide from the plan.
