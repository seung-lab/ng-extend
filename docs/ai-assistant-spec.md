# EyeWire II Guide — AI Assistant Spec (build-ready)

A natural-language helper embedded in the EyeWire II neuroglancer app that
**answers questions AND drives the UI**: it opens the right panel, switches to
the right tool, spotlights the right button, or jumps the view to a segment, the
way the ElevenLabs help bot navigates for you.

Status: proposed. This spec is scoped to **reuse what ng-extend already has**,
and is grounded in real files/functions so it can be built directly. Repo:
`ng-extend` on branch `eyewire-ii-community`.

---

## 1. Why

Neuroglancer's 3-panel WebGL UI is the single biggest thing that loses new
proofreaders. Text help ("go to Settings, then Advanced, then...") does not
survive contact with the interface. An assistant that can *show and do*
collapses onboarding from "read the docs and hunt" to "ask in plain English and
get taken there."

## 2. What it does (UX)

- A small **"Ask" button** in the ExtensionBar opens a slim chat dock (reuse the
  existing chat panel styling from `ChatPanel.vue`).
- User types e.g. *"how do I fix a merge error?"*, *"take me to the
  leaderboard"*, or *"why can't I see my edits?"*
- The assistant replies with a **short answer** and, when useful, **performs UI
  actions**: opens a panel, switches tool mode, spotlights the exact button
  (existing Tutorial glow), or navigates to a segment.
- Falls back gracefully to a plain text answer when no action fits.

Two interaction tiers:
- **Tier A, Navigate & teach (MVP):** "take me to X", "how do I Y", "what does
  this button do". Read-only plus navigation. Safe, high value, ships first.
- **Tier B, Guided actions (later):** "help me split this segment" enters split
  mode, spotlights the workflow, and narrates each step while the *user* clicks.

## 3. Non-goals & safety guardrails (hard rules)

This is a proofreading tool feeding a shared connectome. These are absolute:

- **The assistant never performs a merge, split, or any edit that writes to
  CAVE.** It may *enter* a tool mode and *explain*, but the human makes the
  actual edit.
- **No auto-submitting** completions, help requests, or annotations on the
  user's behalf without an explicit human confirm click.
- Every action the assistant can call is an **allow-listed, non-destructive**
  function (section 6). There is no generic "run arbitrary code" tool.
- The assistant is stateless about identity; it acts only within the current
  user's already-authenticated session.

Explicitly NOT in the tool list: `mergeSegments`, `splitSegment`,
`submitCompletion`, `writeAnnotation`, `markCellComplete`. Those stay
human-only. `setToolMode('merge')` only *enters* the mode; it never commits.

## 4. Architecture

```
 +--------------------------- browser (Vue) ----------------------------+
 |  AssistantDock.vue        chat UI (reuse ChatPanel styles)           |
 |  assistant/context.ts     snapshot current app state (appContext)   |
 |  assistant/dispatch.ts    execute a tool call, call an action       |
 |  assistant/actions.ts     ACTION REGISTRY (allow-listed fns)        |
 +---------------+------------------------------------------------------+
                 |  POST { message, history, appContext }
                 v
 +----------- Cloud Function (ytho-4bff2, same pattern as whai/Slack) --+
 |  system prompt = KNOWLEDGE BASE + tool schema (sections 6,7,9)       |
 |  Claude tool-use loop (max ~4 iterations)                           |
 |  returns { reply, actions: [{name, args}] }                         |
 +----------------------------------------------------------------------+
```

- **Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for routing,
  latency, and cost. Escalate to Sonnet 5 (`claude-sonnet-5`) only if answer
  quality needs it. Uses tool-use (function calling).
- **Backend:** a new endpoint on the existing `ytho-4bff2` Firebase Functions
  project. It mirrors the whai `chat` function and the Slack bot's tool-use loop
  (both already ship native `fetch` calls to the Claude API). The most recent
  function there, `signScreenshotUpload`, is the cleanest copy-paste template
  for a new `onRequest` handler (CORS, public invoker). Secret
  `ANTHROPIC_API_KEY` already exists in that project.

## 5. appContext (sent each turn)

Built by `assistant/context.ts`. Every field maps to something already in the
app, so this is a read-only snapshot:

| Field | Source (real) |
|---|---|
| `dataset`, `datastack` | `getDatasetCaveConfig()` in `src/config.ts` (active layer name) |
| `caveServer` | `getCaveServerUrl()` in `src/store.ts` (`useLayersStore`) |
| `toolMode` | current neuroglancer tool (merge/split/findPath/none) |
| `selectedSegments` | viewer visible segments on the segmentation layer |
| `openPanel` | which panel refs are true in `ExtensionBar.vue` |
| `loggedIn`, `userName` | `useLoginStore` / `useProofreadingBackendStore` |
| `tutorialProgress` | `useTutorialStore` (`store-pyr.ts`) |
| `materializationVersion`, `latestVersion` | CAVE `.../materialize/api/v3/datastack/{ds}/versions` (answers "edits not showing") |
| `lang` | user language preference (site is going multilingual) |

## 6. The action tool schema (allow-list)

Claude is given ONLY these tools. `dispatch.ts` maps each to an existing app
function. All are non-destructive.

| Tool | Args | Maps to (real code) |
|---|---|---|
| `openPanel` | `panel: 'cellLibrary'\|'leaderboard'\|'notifications'\|'settings'\|'chat'\|'recap'\|'batch'\|'datasetSelector'` | the `show*` refs in `ExtensionBar.vue` (e.g. `showLeaderboard`, `showCellLibrary`). Dispatch flips the ref via a `nge:assistant-action` CustomEvent that ExtensionBar listens for. |
| `closePanel` | `panel` | same refs, set false |
| `setToolMode` | `mode: 'merge'\|'split'\|'findPath'\|'none'` | `activateTool('merge'\|'multicut'\|'findPath')` in `ExtensionBar.vue` (dispatches the C/M/F keybinds to the viewer). `'none'` clears. **Enters mode only, never commits.** |
| `goToSegment` | `segId: string` | the existing segment loader used by the `#SegID` chat pill (`jump_to_list.ts` / `move_to_segment_patch.ts`): add the root id to visible segments and recenter |
| `openCommandPalette` | `query?: string` | `cmdPalette.open()` on `CommandPalette.vue` (Ctrl+K), optionally pre-filling `query` |
| `spotlight` | `target: <known element id>, note?: string` | the Tutorial/site-tour spotlight glow (`Tutorial.vue`, `TutorialStep.vue`, `site-tour.ts`) |
| `startTutorial` | `id?: number, step?: number` | `useTutorialStore().activeTutorial = id; setTutorialStep(step)` (same call the ExtensionBar hamburger uses) |
| `focusView` | `preset: 'fit'\|'2d'\|'3d'` | viewer layout controls |
| `explainOnly` | none | no-op; the assistant just answered in text |

`CommandPalette` is effectively already an action registry. The cleanest MVP has
the assistant emit CommandPalette command ids where possible, so there is one
source of truth for "things the app can do."

## 7. Backend contract

New Firebase function `guideAssistant` on `ytho-4bff2`
(`philogelos/functions/index.js`), an `onRequest` handler like
`signScreenshotUpload`.

**Request** (POST JSON):
```json
{
  "message": "take me to the leaderboard",
  "history": [{ "role": "user|assistant", "content": "..." }],
  "appContext": { "dataset": "stroeh_mouse_retina", "toolMode": "none", "...": "..." }
}
```

**Response** (JSON):
```json
{
  "reply": "Opening the leaderboard for you.",
  "actions": [{ "name": "openPanel", "args": { "panel": "leaderboard" } }]
}
```

Server logic:
1. Assemble system prompt = knowledge base (section 9) + the section-6 tool
   schema + the `appContext`.
2. Run a Claude tool-use loop (max ~4 iterations) against
   `claude-haiku-4-5-20251001`. Prompt-cache the system prompt so the KB is not
   re-billed each turn.
3. Collect the model's tool calls into `actions` (validated against the
   allow-list, unknown tools dropped) and its final text into `reply`.
4. Rate-limit and dedup using the same pattern as the Slack bot.

CORS: allow the App Engine origins
(`*-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`), mirroring
`signScreenshotUpload`.

## 8. Knowledge base

Assembled from content that already exists, kept in one folder
(`src/assistant/knowledge/`) so it is editable without code changes:

- **Tool & UI reference:** one line per toolbar icon / command. Generate from
  `src/data/toolbar-icons.ts` plus the CommandPalette command list.
- **Keybindings:** from `config/custom-keybinds.json`.
- **Proofreading how-tos:** merge vs split, when to use each, find-path, marking
  a cell complete, requesting a second opinion. Pull from the existing Tutorial
  copy in `tutorial-1/2/3.ts` and `site-tour.ts`.
- **FAQ / troubleshooting:** "edits not showing" (materialization version),
  login / CAVE auth, "why is my segment gray", etc.
- **Tone:** the Nurro voice: warm, encouraging, concise, celebrates progress.

Start with a static system prompt (small enough to inline). Move to retrieval
only if it outgrows the context window.

## 9. Reuse map (what already exists, with paths)

- Chat UI + styling: `src/components/ChatPanel.vue`
- Panel open/close state: the `show*` refs in `src/components/ExtensionBar.vue`
- Tool mode enter: `activateTool()` in `src/components/ExtensionBar.vue`
- Action registry: `src/components/CommandPalette.vue`
- Spotlight a button: `src/components/Tutorial.vue`, `TutorialStep.vue`,
  `src/site-tour.ts`
- Jump to segment: `src/jump_to_list.ts`, `src/move_to_segment_patch.ts`
- CAVE server + dataset context: `getCaveServerUrl()` in `src/store.ts`,
  `getDatasetCaveConfig()` in `src/config.ts`
- Claude tool-use backend template: the whai `chat` fn, the Slack bot, and
  `signScreenshotUpload` in `philogelos/functions/index.js` (all on `ytho-4bff2`)
- Auth/session context: `useLoginStore` in `src/store.ts`

## 10. Implementation blueprint (P0)

**New files**
- `src/components/AssistantDock.vue` — the chat dock. Reuse `ChatPanel.vue`
  styling. Posts to the backend, renders replies (markdown via `marked`, already
  a dep), calls `dispatch(actions)`.
- `src/assistant/context.ts` — `buildAppContext()`, the section-5 snapshot.
- `src/assistant/actions.ts` — the allow-listed registry: one function per
  section-6 tool, each calling real app code. No other functions exported.
- `src/assistant/dispatch.ts` — `dispatch(actions)`: validate each `{name,args}`
  against the registry, run it, ignore anything not allow-listed.

**Modified files**
- `src/components/ExtensionBar.vue` — add the "Ask" launcher button; mount
  `<AssistantDock/>`; add a `nge:assistant-action` CustomEvent listener that
  flips the panel `show*` refs and calls `activateTool()` for `setToolMode`.

**Backend**
- `philogelos/functions/index.js` — add `exports.guideAssistant = onRequest(...)`
  per section 7. Deploy with `firebase deploy --only functions:guideAssistant`.

## 11. P0 acceptance criteria

Ship P0 when all of these hold, logged in on `stroeh_mouse_retina`:
- "take me to the leaderboard" opens the Leaderboard panel.
- "turn on merge mode" enters merge mode (does not merge anything).
- "open the command palette" opens CommandPalette.
- "go to segment 720575940569107563" loads that segment and recenters.
- "how do I split a segment?" returns a short text answer, no action.
- An ambiguous or out-of-scope prompt returns `explainOnly` text, never a
  destructive action.
- No path in `actions.ts` can merge, split, submit, or write to CAVE.

## 12. Phased rollout

- **P0, Router MVP (days):** AssistantDock + `openPanel` / `setToolMode` /
  `openCommandPalette` / `goToSegment` / `explainOnly`. Proves the loop
  end-to-end.
- **P1, Teach:** add `spotlight` + `startTutorial` + the how-to knowledge base.
- **P2, Context-aware troubleshooting:** send full `appContext`, answer "why
  can't I..." grounded in real state (e.g. old materialization version).
- **P3, Guided actions (Tier B):** step-through narration for split/merge, still
  human-executed.

## 13. Cost & open questions

- Backend: ~1 Cloud Function, reusing the whai/Slack pattern (low).
- Per-message cost: Haiku plus a short cached KB is fractions of a cent.
- Biggest effort is knowledge-base curation, not the code.

Open questions:
- Voice? (text-first is cheaper and enough for onboarding; TTS is an easy add
  later).
- Gate to logged-in users, or help anonymous visitors too?
- Rate limiting on the public endpoint (the Slack bot's dedup + allow-list
  pattern applies).
- Localization: pass `lang` in `appContext` and answer in the user's language.
