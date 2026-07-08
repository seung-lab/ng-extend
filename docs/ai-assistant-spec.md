# EyeWire II — AI Assistant Spec ("Guide")

A natural-language helper embedded in the neuroglancer / EyeWire II community app that
**answers questions AND drives the UI** — opens the right panel, switches to the right
tool, spotlights the right button, or jumps the view to a segment — the way the
ElevenLabs help bot navigates for you.

Status: proposed. This spec is scoped to reuse what ng-extend already has.

---

## 1. Why

Neuroglancer's UI is the single biggest thing that loses new proofreaders. Text help
("go to Settings → Advanced → …") doesn't survive contact with a 3-panel WebGL app.
An assistant that can *show and do* collapses onboarding from "read the docs and hunt"
to "ask in plain English and get taken there."

## 2. What it does (UX)

- A small **"Ask" button** in the ExtensionBar (or a `?`-style launcher) opens a slim
  chat dock (reuse the existing chat panel styling).
- User types e.g. *"how do I fix a merge error?"* or *"take me to the leaderboard"* or
  *"why can't I see my edits?"*
- The assistant replies with a **short answer** and, when useful, **performs UI actions**:
  opens a panel, switches tool mode, spotlights the exact button (existing Tutorial
  glow), or navigates to a segment.
- For anything that *changes data*, it **stages and explains — never auto-executes**
  (see §3).
- Falls back gracefully to a plain text answer when no action fits.

Two interaction tiers:
- **Tier A — Navigate & teach** (MVP): "take me to X", "how do I Y", "what does this
  button do". Read-only + navigation. Safe, high value, ships first.
- **Tier B — Guided actions** (later): "help me split this segment" → it enters split
  mode, spotlights the workflow, and narrates each step while the *user* clicks.

## 3. Non-goals & safety guardrails (important)

This is a proofreading tool feeding a shared connectome. Hard rules:

- **The assistant never performs a merge, split, or any edit that writes to CAVE.** It
  may *enter* a tool mode and *explain*, but the human makes the actual edit.
- **No auto-submitting** completions, help requests, or annotations on the user's behalf
  without an explicit confirm click.
- Every action the assistant can call is an **allow-listed, non-destructive** function
  (§5). There is no generic "run arbitrary code" tool.
- Destructive-adjacent actions (e.g. "mark cell complete") require an in-UI confirm.
- The assistant is stateless about identity; it acts only within the current user's
  already-authenticated session.

## 4. Architecture

Three layers, ~70% of which already exist in ng-extend:

```
 ┌─────────────────────────── browser (Vue) ───────────────────────────┐
 │  AssistantDock.vue        ── chat UI (reuse chat panel styles)       │
 │  assistant/actions.ts     ── ACTION REGISTRY (allow-listed fns)      │
 │  assistant/dispatch.ts    ── executes a tool call → calls an action  │
 │  assistant/context.ts     ── snapshots current app state to send up  │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │  POST { message, history, appContext }
                 ▼
 ┌──────────── Cloud Function (ytho-4bff2, same pattern as whai/Slack) ─┐
 │  - system prompt = KNOWLEDGE BASE + tool schema (§5,§6)              │
 │  - Claude tool-use loop (max ~4 iterations)                         │
 │  - returns { reply, actions: [{name, args}], ... }                  │
 └──────────────────────────────────────────────────────────────────────┘
```

- **Model:** Claude Haiku 4.5 for routing/latency/cost; escalate to Sonnet only if
  answer quality needs it. Tool-use (function calling).
- **Backend:** a new endpoint on the existing `ytho-4bff2` Functions project (mirrors
  the whai `chat` function and the Slack bot's tool-use loop — both already ship native
  `fetch` calls to the Claude API with a tool loop). Secret `ANTHROPIC_API_KEY` already
  exists there.
- **appContext** sent each turn: current tool mode, selected segment id(s), which panel
  is open, dataset, login state, tutorial progress. Lets Claude answer "why can't I see
  my edits" concretely (e.g. "you're on an old materialization version").

## 5. The action tool schema (allow-list)

Claude is given ONLY these tools; `dispatch.ts` maps each to an existing app function.
All are non-destructive.

| Tool | Args | Maps to (existing) |
|---|---|---|
| `openPanel` | `panel: 'cellLibrary'\|'leaderboard'\|'notifications'\|'settings'\|'help'\|'feed'\|'quest'\|'recap'\|'batch'` | ExtensionBar icon actions / store panel state |
| `closePanel` | `panel` | same |
| `setToolMode` | `mode: 'merge'\|'split'\|'findPath'\|'none'` | existing C / M / F keybind handlers |
| `goToSegment` | `segId: string` | the existing `#SegID` chat-pill loader |
| `spotlight` | `target: <known element id>, note?: string` | Tutorial/site-tour spotlight glow |
| `startTutorial` | `id?: string, step?: number` | Tutorial.vue |
| `openCommandPalette` | `query?: string` | CommandPalette.vue (Ctrl+K) |
| `focusView` | `preset: 'fit'\|'2d'\|'3d'` | viewer layout controls |
| `explainOnly` | — | no-op; assistant just answered in text |

Notably NOT present: `mergeSegments`, `splitSegment`, `submitCompletion`,
`writeAnnotation`. Those stay human-only.

`CommandPalette` is effectively already an action registry — the cleanest MVP is to
have the assistant emit CommandPalette command ids, so we get one source of truth for
"things the app can do."

## 6. Knowledge base

The system prompt is assembled from content that already exists, kept in one folder
(`assistant/knowledge/`) so it's editable without code changes:

- **Tool & UI reference** — one line per toolbar icon / command (label, what it does,
  where it lives). Generate from `toolbar-icons.ts` + CommandPalette command list.
- **Keybindings** — from `config/custom-keybinds.json`.
- **Proofreading how-tos** — merge vs split, when to use each, find-path, marking a cell
  complete, requesting a second opinion. (Pull from the existing Tutorial copy.)
- **FAQ / troubleshooting** — "edits not showing" (materialization version), login /
  CAVE auth, "why is my segment gray", etc.
- **Tone** — the Nurro voice: warm, encouraging, concise; celebrates progress.

Start with a static system prompt (small enough to inline). Move to retrieval only if it
outgrows the context window.

## 7. Reuse map (what already exists)

- Chat UI + styling → **existing chat panel**.
- Action registry → **CommandPalette** command list.
- Spotlight-a-button → **Tutorial / site-tour**.
- "Jump to segment" → **`#SegID` chat pill** loader.
- Claude tool-use backend → **whai `chat` fn + Slack bot** (both on `ytho-4bff2`).
- Auth/session context → **login store**.

## 8. Example turn

> **User:** "my edits aren't showing up"
> *appContext: {datastack: stroeh_mouse_retina, materializationVersion: 340, latest: 343}*
> **Assistant (text):** "You're viewing an older snapshot (v340) than the latest (v343),
> so recent edits aren't in it yet. Want me to open Settings so you can refresh the
> version?"
> **Assistant (action):** `spotlight` the version control, or `openPanel('settings')`.

## 9. Phased rollout

- **P0 — Router MVP (days):** AssistantDock + `openPanel` / `setToolMode` /
  `openCommandPalette` / `goToSegment` / `explainOnly`. Natural language → navigation.
  Proves the loop end-to-end. ("take me to the leaderboard", "turn on merge mode".)
- **P1 — Teach:** add `spotlight` + `startTutorial` + the how-to knowledge base, so it
  explains *and* points.
- **P2 — Context-aware troubleshooting:** send `appContext`, answer "why can't I…"
  questions grounded in real state.
- **P3 — Guided actions (Tier B):** step-through narration for split/merge workflows
  (still human-executed).

## 10. Cost & effort

- Backend: ~1 Cloud Function, reusing the whai/Slack pattern (low).
- Front-end: AssistantDock + dispatcher + context snapshot (moderate).
- Per-message cost: Haiku + short KB ≈ fractions of a cent; cache the system prompt
  (prompt caching) so the KB isn't re-billed every turn.
- Biggest effort is the **knowledge base curation**, not the code.

## 11. Open questions

- Voice? (ElevenLabs did voice; text-first is cheaper and enough for onboarding. TTS is
  an easy add-on later.)
- Should the assistant be gated to logged-in users, or help anonymous visitors too?
- Rate limiting / abuse controls on the public endpoint (the Slack bot's dedup +
  allow-list pattern applies).
- Localization — the site is going multilingual; the assistant should answer in the
  user's chosen language (pass `lang` in appContext).
