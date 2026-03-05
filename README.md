# ng-extend — EyeWire II Community Edition

<p align="center">
  <img src="docs/neuron-render.png" alt="Stunning 3D neuron reconstruction from connectomics data" width="700"/>
  <br/>
  <em>3D neuron reconstructions from connectomics data — the visual cortex mapped by citizen scientists</em>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/login-window.mp4" alt="Holographic login window with animated neuron" width="400" autoplay loop muted></video>
</p>

https://github.com/user-attachments/assets/login-window.mp4

A [neuroglancer](https://github.com/google/neuroglancer) overlay that transforms connectomics proofreading into a community-driven science game. Built on the [CAVE](https://github.com/CAVEconnectome) annotation framework, EyeWire II adds gamification, daily quests, annotation tools, and a holographic sci-fi interface — all without modifying neuroglancer core.

> **Branch:** All EyeWire II community work lives on [`eyewire-ii-community`](https://github.com/seung-lab/ng-extend/tree/eyewire-ii-community).

---

## Quick Start

```bash
git clone https://github.com/seung-lab/ng-extend.git
cd ng-extend
git checkout eyewire-ii-community
npm install
npm run dev-server          # Linux / macOS
npm run dev-server-win      # Windows
```

Open **http://localhost:9000** — loads the Minnie65 mouse cortex dataset by default.

```bash
DATASET=flywire_sandbox npm run dev-server   # switch to FlyWire Drosophila
npm run build                                # production build → dist/min/
```

**Prerequisites:** Node.js >= 18, a CAVE-enabled neuroglancer deployment with middleauth auth.

---

## Features

### User Profile

<p align="center">
  <img src="docs/profile.png" alt="User Profile with stats, badges, streak chart, and cells mapped" width="700"/>
  <br/>
  <em>Three-column profile: contribution stats, badges & streak, and cell visualization</em>
</p>

### Holographic Sci-Fi Interface

<p align="center">
  <img src="docs/demo.gif" alt="Status pips and label badges" width="600"/>
</p>

Every panel uses a cohesive dark-blue holographic theme with:

- **Floating particle backdrops** with slow drift animation
- **Glowing border halos** that pulse subtly
- **Materialize entrance animations** (blur → focus, brightness → normal)
- Consistent color palette: cyan accents, purple highlights, green success states

The **login screen** features an animated pyramidal neuron SVG with:
- Pulsing soma glow (3 blur layers on different rhythms)
- Calcium spark flashes on the cell body
- 8 synaptic sparks traveling along dendrite branches toward the soma
- Action potential ripples radiating outward
- Dual counter-rotating rings

### Segment Annotation & Proofreading

**Status pip indicators** on every segment in the sidebar:

| Pip | Meaning |
|-----|---------|
| Magenta | Complete and cell type labelled |
| Orange | Cell type annotated, not yet marked complete |
| Grey | No annotation |

A **legend** in the top bar explains the colours at a glance.

**Inline label badges** display next to the segment ID:
- `✓ RGC` — complete + labelled
- `⊙ Amacrine` — annotated, not complete
- `—` — no annotation yet

**Context menu** — click the `...` button on any segment to:
- Toggle **Mark Complete / Unmark Complete**
- Set or update the **Cell Type** (preset dropdown or free-text)
- Open the segment's **Change Log** on CAVE

**Annotation Panel** — a floating HUD panel appears when a segment is selected:
- Completion status with one-click toggle
- Cell type picker (presets + custom input)
- Copy segment ID to clipboard
- Request a second opinion (with issue type + notes)

All writes go to CAVE annotation tables via middleauth API, with localStorage fallback for offline/dev use.

### Quest Board — Daily Proofreading Missions

<p align="center">
  <img src="docs/quest-board.png" alt="Quest Board with daily quests" width="320"/>
</p>

A draggable floating panel that turns proofreading into structured daily missions:

- **3 daily quests** — a fresh set of neurons each day, date-seeded so every user gets a unique selection
- **Neuron nicknames** — every segment gets a memorable name like *"Cosmic Spark"* or *"Shadow Whisper"* (deterministic hash from 40 Archetypes x 40 Sprites = 1,600 unique combos)
- **All-tasks list view** — toggle between daily card view and a scrollable list of every neuron with status pips
- **Guided workflow** — Claim (enter soma coords) → Jump to cell → Set final seg ID → Mark complete
- **Progress tracking** — daily + overall progress bars, celebration message on daily completion
- **Google Sheets integration** — paste any published Sheet URL to load a task queue

### Community & Gamification

**User Profile** — contribution stats (edits, merges, splits), streak tracking, earned badges, and cell history with favorites and nicknames.

**Leaderboard** — ranked community view with Week / Month / All Time tabs, medal display, badges, and user bios.

**Weekly Recap** — "Your Week in Science" summary with stats, streak info, community contribution percentage, and science facts.

**Achievement System** — 19 badge milestones from First Merge (1 edit) to Legend (250,000 edits), with animated holographic toast notifications on unlock. Streak milestones at 7, 14, 30, 60, 100, 200, and 365 days.

**Second Opinion Requests** — flag any segment for community review with an issue category (Extension, Merge, Black Spill, Doublecheck). Reviewers can jump directly to the flagged cell.

**Merge/Split Celebrations** — satisfying animated burst in the toolbar when a merge or split operation completes, with particle sparks and color-coded feedback.

### Command Palette

**Ctrl+K / Cmd+K** opens a fuzzy-search command palette:
- Annotation actions (mark complete, set cell type, copy ID, ask for help)
- Panel navigation (profile, leaderboard, recap, settings, quest board)
- Tools (reset view, clear segments)
- Cell history search

### Authentication

**Login Modal** — intercepts neuroglancer's native middleauth prompts and presents a holographic center-screen modal. Features:
- Animated neuron icon with synaptic activity
- Multi-server auth detection (auto-discovers all middleauth servers)
- Aggressive re-scanning after first login (6 retry intervals)
- Post-login auto-selects the segmentation layer and opens the Seg. panel
- Bypass option for offline/dev work

### Custom Tools

| Key | Tool |
|-----|------|
| **M** | Graphene merge segments |
| **C** | Graphene multicut (split) |
| **T** | Free-rotate cube annotation |

Configurable via `config/custom-keybinds.json`.

### Annotation Measurement

Line and box annotations display computed distances (in nm) directly in the annotation list, calculated from the layer's voxel scale.

---

## Datasets

### Minnie65 (default)

Mouse visual cortex — 11 pre-loaded demo segments spanning pyramidal cells, inhibitory interneurons, and glia.

| Property | Value |
|----------|-------|
| EM source | `precomputed://...bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em` |
| Segmentation | `graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie65_public_v117` |
| Voxel size | 8 nm x 8 nm x 40 nm |
| CAVE server | `https://minnie.microns-daf.com` |

### FlyWire Sandbox

Drosophila whole-brain (FAFB). Requires auth at edit.flywire.ai.

| Property | Value |
|----------|-------|
| EM source | `precomputed://gs://microns-seunglab/drosophila_v0/alignment/image_rechunked` |
| Segmentation | `graphene://middleauth+https://prodv1.flywire-daf.com/segmentation/1.0/fly_v26` |
| Voxel size | 4 nm x 4 nm x 40 nm |
| CAVE server | `https://global.daf-apis.com` |

Switch datasets with the `DATASET` env var:
```bash
DATASET=flywire_sandbox npm run dev-server
```

---

## Configuration

### CAVE annotation tables

Edit `src/config.ts`:

```ts
export const EYEWIRE_II_CAVE_CONFIG = {
  cellStatusTable: 'cell_status',     // completion flags
  cellTypeTable:   'cell_type',       // cell type labels
  datastack:       'your_datastack',
  caveServerOverride: 'https://your-cave-server.com',
  caveServerByDataset: {
    your_layer_name: 'https://your-cave-server.com',
  },
};
```

### Cell type presets

Edit the `RETINAL_CELL_TYPES` array in `src/config.ts` to match your cell vocabulary. Users can also free-type custom values.

### Custom keybindings

Edit `config/custom-keybinds.json`:

```json
{
  "keym": { "layer": "segmentation", "tool": "grapheneMergeSegments", "provider": "graphene" },
  "keyc": { "layer": "segmentation", "tool": "grapheneMulticutSegments", "provider": "graphene" },
  "keyt": { "layer": "annotation", "tool": "freeRotateCubeAnnotationTool" }
}
```

---

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| UI framework | Vue 3 + Pinia (state management) |
| Bundler | esbuild (via neuroglancer's config) |
| Viewer | neuroglancer (git submodule) |
| Backend | CAVE annotation API + Supabase + middleauth |
| Persistence | localStorage (offline fallback) + Supabase (cloud) |

### How it works

1. Vue app mounts around `#neuroglancer-container`
2. `ExtensionBar` merges with neuroglancer's native top bar
3. `MutationObserver` in `main.ts` watches for segment list entries
4. When a segment appears, a menu button + status badge is injected
5. Clicking the button shows a context menu with completion/cell-type controls
6. The floating `AnnotationPanel` surfaces when a segment is selected
7. All data persists to CAVE API (with localStorage fallback)
8. Supabase backend tracks edit logs, user stats, and activity feed

### Key files

| File | Purpose |
|------|---------|
| `scripts/dev-server.js` | Dev server launcher with dataset switching and layer config |
| `src/main.ts` | ExtendViewer class, DOM observer, segment injection, favicon |
| `src/store.ts` | 10+ Pinia stores (layers, stats, prefs, annotations, queue, etc.) |
| `src/config.ts` | CAVE config, per-dataset server URLs, cell type list |
| `src/supabase.ts` | Supabase client for cloud persistence |

### Components (`src/components/`)

| Component | Purpose |
|-----------|---------|
| `App.vue` | Root shell — renders ExtensionBar + neuroglancer container |
| `ExtensionBar.vue` | Top bar: logo, volumes, status legend, streak, dashboard buttons, merge/split celebration |
| `LoginModal.vue` | Holographic login modal with animated neuron + multi-server auth |
| `AnnotationPanel.vue` | Floating panel for selected segment — status, cell type, second opinion |
| `ProofreadingQueuePanel.vue` | Quest Board — daily quests, nicknames, task list, progress tracking |
| `UserProfilePanel.vue` | Three-column profile: stats, badges, cell history with favorites |
| `WeeklyRecapPanel.vue` | "Your Week in Science" — stats, streaks, community %, science facts |
| `LeaderboardPanel.vue` | Community rankings — All Time / Month / Week tabs, medal display |
| `CommandPalette.vue` | Ctrl+K command palette — fuzzy search actions, cells, panels |
| `HelpRequestsPanel.vue` | Second opinion requests — pending + resolved lists, jump-to-cell |
| `SettingsPanel.vue` | Profile settings — flag emoji picker, bio textarea, toolbar customization |
| `ActivityFeedPanel.vue` | Real-time activity feed from Supabase |
| `AchievementToast.vue` | Badge unlock notification toast |
| `ModalOverlay.vue` | Base modal wrapper — holographic particle backdrop, border glow |

### Pinia stores (`src/store.ts`)

| Store | Key state | Persistence |
|-------|-----------|-------------|
| `useLoginStore` | sessions[], active auth tokens | localStorage `auth_token_v2_*` |
| `useLayersStore` | activeLayers, viewer ref, CAVE URL detection | Runtime |
| `useUserStatsStore` | edits/merges/splits (day/week/month/all), streak, edit events | localStorage `nge_stats_v1` |
| `useUserPreferencesStore` | flag emoji, bio, toolbar icons | localStorage `nge_prefs_v1` |
| `useSegmentAnnotationStore` | activeSegId, CAVE URL, annotation state | Runtime |
| `useCellHistoryStore` | cells[], favorites, nicknames, dataset, jumpToCell() | localStorage `nge_cell_history_v1` |
| `useHelpRequestStore` | requests[], pending[], add/resolve | localStorage `nge_help_requests_v1` |
| `useProofreadingQueueStore` | items[], proofread Set, localEdits, CSV parser | localStorage `nge_queue_*` |
| `useProofreadingBackendStore` | Supabase sync, edit logging, leaderboard, activity feed | Supabase |
| `useVolumesStore` | volumes[] from CAVE API | Runtime |
| `useDropdownListStore` | activeDropdowns, getDropdownId() | Runtime |

---

## CAVE Integration

ng-extend reads and writes to two CAVE annotation tables:

| Table | Purpose | Key fields |
|-------|---------|------------|
| `cell_status` | Completion flags | `root_id`, `tag: "complete"`, `pt.position` |
| `cell_type` | Cell type labels | `root_id`, `tag: "<type>"`, `pt.position` |

**API endpoints:**
- `GET .../annotation/?filter_equal=root_id:{id}` — read status
- `POST .../annotation/` — create annotation
- `PUT .../annotation/{id}` — update
- `DELETE .../annotation/{id}` — remove

**Auth:** Bearer token from middleauth (Google OAuth, stored in `auth_token_v2_*` localStorage keys).

**CAVE URL detection priority:**
1. Extract from `middleauth+` layer datasource URL (production)
2. `caveServerByDataset` config map keyed by layer name (dev)
3. `caveServerOverride` global fallback (last resort)

---

## Screenshots

To update the screenshots referenced in this README, save images to the `docs/` folder:

| File | Content |
|------|---------|
| `docs/neuron-render.png` | 3D neuron reconstruction render |
| `docs/profile.png` | User profile panel |
| `docs/login-window.mp4` | Login modal video |
| `docs/quest-board.png` | Quest Board panel with daily quests and nicknames |
| `docs/demo.gif` | Status pips and label badges in segment list |

---

*Based on the [neuroglancer dependent-project example](https://github.com/google/neuroglancer/tree/master/examples/dependent-project), using a git submodule instead of npm due to [neuroglancer#172](https://github.com/google/neuroglancer/issues/172).*
