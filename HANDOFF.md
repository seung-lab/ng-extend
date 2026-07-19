# EyeWire II Community — Engineering Handoff

> **Purpose of this document.** A complete, from-zero briefing for an engineer or AI agent who will build on this branch (`eyewire-ii-community`) with **no prior knowledge** of the project, connectomics, or neuroglancer. It explains the science, the platform it plugs into, the full architecture, every major feature, how to build/run/deploy, and the current state of the tree. Read it top to bottom once; thereafter use the table of contents.
>
> This file is a snapshot of the codebase as committed on branch `eyewire-ii-community` (HEAD around commit `a0a26d1`). Where a value is likely to drift (icon sizes, exact pixel dimensions), trust the source file over this document and update this document when you change it.

---

## Table of Contents

1. [What this project is (one paragraph)](#1-what-this-project-is)
2. [Connectomics primer — the science](#2-connectomics-primer)
3. [The connectome projects this platform touches](#3-the-connectome-projects)
4. [Neuroglancer primer — the viewer we extend](#4-neuroglancer-primer)
5. [CAVE primer — the connectome backend](#5-cave-primer)
6. [Datasets configured in this app](#6-datasets)
7. [High-level architecture](#7-high-level-architecture)
8. [Build, run, deploy & infrastructure](#8-build-run-deploy)
9. [Data layer — stores, config, Supabase](#9-data-layer)
10. [Core & viewer-integration components](#10-core-components)
11. [Social, gamification, tutorial & misc components](#11-social-components)
12. [Services / widgets & the AI Guide](#12-services-and-guide)
13. [Visual design system & CSS](#13-design-system)
14. [Repo history, working state & top-level extras](#14-repo-history)
15. [Known issues, tech debt & security notes](#15-known-issues)
16. [Glossary](#16-glossary)

---

## 1. What this project is

**EyeWire II Community** (`ng-extend`) is a **Vue 3 + TypeScript** application that wraps Google's **neuroglancer** 3D brain-image viewer and turns it into a **gamified, community-driven "proofreading" platform** for connectomics. Volunteers ("citizen scientists") and researchers view electron-microscopy (EM) brain volumes with an automatically-computed neuron segmentation, and **correct the segmentation** — merging pieces of a neuron that were wrongly split apart and splitting apart neurons that were wrongly merged — while the app tracks their contributions, awards badges, ranks them on leaderboards, lets them chat, claim cells to work on, request second opinions, and follow guided tutorials. It is the spiritual successor to the original **EyeWire** citizen-science game.

The app is architecturally a **neuroglancer fork/extension**: it imports neuroglancer as a library, subclasses its `Viewer`, injects a Vue UI around it, and **merges its own top bar into neuroglancer's**. Data lives in two backends: **CAVE** (the connectomics segmentation + annotation infrastructure) and **Supabase** (community/gamification data: users, chat, notifications, leaderboards, tasks). It deploys as a static bundle to **Google App Engine** via GitHub Actions.

---

## 2. Connectomics primer

**Connectomics** is the science of mapping the **connectome** — the complete wiring diagram of a nervous system: every neuron and every synaptic connection between them. The dominant modern pipeline is:

1. **Tissue preparation & sectioning.** A piece of brain (or a whole small brain, e.g. a fly's) is chemically fixed, stained with heavy metals, and either sliced into thousands of ultra-thin sections or imaged block-face.
2. **Electron-microscopy (EM) imaging.** Each section is imaged at **nanometer resolution** (fine enough to see individual synapses and the thin "wires" — axons and dendrites). This produces enormous 3D image volumes: **terabytes to petabytes** of grayscale EM data.
3. **Automated segmentation.** Deep-learning models label every voxel with which neuron it belongs to, producing a **segmentation**: each neuron becomes a 3D **segment** identified by a numeric **root ID** (a.k.a. segment ID). Automated segmentation is imperfect.
4. **Proofreading (what this app is for).** Humans review and correct the segmentation. The two core operations:
   - **Merge** — join two segments that are actually the same neuron (the algorithm split it).
   - **Split** (a.k.a. **cut** / **multicut**) — separate a segment that actually contains two neurons fused together (the algorithm merged them).
   Proofreaders also mark neurons **complete**, assign **cell types**, and add annotations.
5. **Synapse detection & analysis.** Once neurons are reconstructed, synapses and cell types are catalogued, and the wiring diagram is analyzed.

Because a neuron can span a huge volume, the segmentation is stored as a **hierarchical graph**: tiny "supervoxels" are grouped into the current neuron via a graph structure (**PyChunkedGraph / PCG**), so a merge or split is a fast graph edit rather than a re-labeling of billions of voxels. **Every edit changes a neuron's root ID** — the ID is a pointer to a particular version of the graph. This has a key consequence the app must handle: **materialization lag**. Spatial annotations (synapses, cell-type tags, completion flags) reference root IDs; after edits, a periodic "materialization" job re-links annotations to current root IDs on a schedule (often daily), so a proofreader's most recent edits may not be reflected in queries/counts immediately. (The in-app AI Guide explicitly grounds "my edits aren't showing up" answers in this lag.)

---

## 3. The connectome projects

This platform is developed in the orbit of the **Seung Lab** (Princeton) and **Murthy Lab** (Princeton, FlyWire) and can point at several real connectome datasets:

- **EyeWire (2012, original).** The Seung Lab citizen-science game that mapped neurons in a small **mouse retina** EM volume. Players "colored in" 3D neuron reconstructions; the crowd's work produced real neuroscience (e.g. how starburst amacrine cells compute motion direction). Hundreds of thousands of players participated. **EyeWire II (this project)** is its modern successor, rebuilt on neuroglancer + CAVE with real merge/split proofreading rather than a coloring game.
- **Stroeh mouse retina** (`stroeh_mouse_retina`). The **production dataset for EyeWire II** — a newer mouse-retina EM volume with a graphene (PCG) segmentation hosted on `minnie.microns-daf.com`. This is what the public site defaults to. Cell types of interest are retinal (ganglion, amacrine incl. starburst, bipolar, horizontal, photoreceptors, Müller glia — see the picker list in `src/config.ts`).
- **FlyWire** (`flywire_fafb_sandbox`, `fly_v26`). The complete **adult *Drosophila* (fruit fly) brain** connectome, reconstructed from the **FAFB** ("Full Adult Fly Brain") EM dataset — ~130,000+ neurons, published 2024. Developed at Princeton (Seung + Murthy labs); **Codex** (`codex.flywire.ai`) is its query/data portal. (The document author, Amy, works on FlyWire at the Murthy Lab.) The app can point at a FlyWire sandbox via CAVE server `global.daf-apis.com`.
- **BANC** ("Brain And Nerve Cord"). FlyWire's follow-on: the fly's **entire central nervous system** — brain + ventral nerve cord together (>100,000 neurons) — so a signal can be traced from sensing to movement. Referenced from the connectome.quest landing site, not a default dataset here.
- **MICrONS / minnie65** (`minnie65_public_v117`). ~1 mm³ of **mouse visual cortex** from the IARPA **MICrONS** program (structure + function). Hosted on `minnie.microns-daf.com`.
- **pinky / pinky100** (`pinky_sandbox`, `pinky_training3`, `pinky_nf_v2`). A smaller (~100 µm) mouse visual-cortex EM volume used here as the **dev/sandbox & tutorial** dataset.

---

## 4. Neuroglancer primer

**neuroglancer** is Google's open-source, **WebGL/GPU-accelerated, browser-based viewer** for very large volumetric datasets, purpose-built for connectomics. Key concepts an engineer must know:

- **Panels.** It renders **2D cross-sections** (the `xy`, `xz`, `yz` orthogonal slices) and a **3D view** (meshes / volume rendering), in configurable layouts (`xy`, `4panel`, `3d`, `xy-3d`, etc.).
- **Layers.** Data is organized into layers, each of a type:
  - **image** — the raw EM grayscale.
  - **segmentation** — the neuron labels; selecting a segment shows its 3D **mesh**. A **graphene** segmentation (source `graphene://`) is backed by CAVE's PyChunkedGraph and **supports proofreading edits** (merge/multicut).
  - **annotation** — points, lines, boxes, ellipsoids the user places.
- **Data sources.** `precomputed://` (chunked format on GCS/S3), `graphene://` (CAVE PCG, editable), plus `n5`, `zarr`, `precomputed`, etc. Segmentation URLs here use the `graphene://middleauth+https://…` form; the `middleauth+` prefix is **required** for authenticated CAVE data (a bare `graphene://` silently fails auth).
- **State in the URL.** The entire viewer state (position, layers, layout, selected segments, camera) is serialized as **JSON in the URL hash** (`#!{…}`). This makes any view a shareable link. Long links are shortened via a **state server**.
- **Auth: middleauth.** Gated datasets require Google-OAuth-based **middleauth**; neuroglancer prompts "middleauth server X login required," opens an auth popup, and stores bearer tokens in `localStorage` (`auth_token_v2_*`). This app has a custom `LoginModal` that drives that flow.
- **How we extend it.** neuroglancer is vendored as a library at `node_modules/neuroglancer`, symlinked to `third_party/neuroglancer` (see [§8](#8-build-run-deploy)). The app defines **`ExtendViewer extends Viewer`** (in `src/main.ts`), mounts a Vue app around the viewer container, and **merges neuroglancer's native top bar** into the Vue `ExtensionBar`. Neuroglancer's own UI is restyled via CSS overrides (`src/ng-override.css`) rather than forked.

---

## 5. CAVE primer

**CAVE** — the **Connectome Annotation Versioning Engine** — is the backend infrastructure (developed for MICrONS/FlyWire, run on hosts like `minnie.microns-daf.com` and `global.daf-apis.com`) that makes proofreadable connectomes work. Its parts:

- **PyChunkedGraph (PCG)** — the versioned segmentation graph. Serves `graphene://` layers, executes merges/splits, and maps supervoxels → current root IDs. (`src/widgets/pcg_service.ts` reads change logs / latest-root info from it.)
- **AnnotationEngine** — spatial annotation tables (synapses, cell types, completion flags). Tables have **schemas**; this app uses `bound_tag`, `bound_tag_user` (a `bound_tag` where the server injects the authenticated `user_id`), and legacy `cell_type_local`. See per-dataset config in [§6](#6-datasets).
- **Materialization** — periodic snapshots that re-link annotations to current root IDs (source of the **materialization lag** described in [§2](#2-connectomics-primer)).
- **Auth (middleauth)** — the OAuth gateway shared with neuroglancer.
- **datastack / aligned_volume** — a *datastack* bundles a segmentation + annotation DB + imagery under a name (e.g. `stroeh_mouse_retina`, `minnie65_public_v117`); an *aligned_volume* names the image space (e.g. `pinky100`, `minnie65_phase3`).

The app auto-detects the CAVE server from the `middleauth+` layer URL, then falls back to a per-dataset config map, then to a hard-coded override — see `getDatasetCaveConfig()` and `EYEWIRE_II_CAVE_CONFIG` in `src/config.ts`.

---

## 6. Datasets

All dataset → CAVE wiring lives in **`src/config.ts`** (`CAVE_CONFIGS_BY_DATASET`). Each entry maps a dataset/layer name to its CAVE server, datastack, aligned volume, the cell-status & cell-type annotation tables (+ their schemas), optional default view (segments, colors, position, saved-state URL), and its per-dataset **Cell Library Google Sheet**. Summary of what's configured today:

| Dataset key(s) | Science | CAVE server | datastack / aligned_volume | cell_status table (schema) | cell_type table (schema) | Cell Library sheet |
|---|---|---|---|---|---|---|
| `stroeh_mouse_retina`, `eyewire_ii` | **EyeWire II production** — mouse retina | `minnie.microns-daf.com` | `stroeh_mouse_retina` / `stroeh_mouse_retina` | `eyewire_ii_cell_status_v2` (`bound_tag_user`) | `eyewire_ii_cell_type_v2` (`bound_tag_user`) | sheet `1H9KV0-…JbFWc` gid `37544110` |
| `pinky_sandbox`, `pinky_training3`, `pinky_nf_v2` | **dev/sandbox & tutorial** — mouse visual cortex (pinky100) | `minnie.microns-daf.com` | `pinky_sandbox` / `pinky100` | `eyewire_ii_cell_status_v2` (`bound_tag_user`) | `cell_type_dev` (`bound_tag`) | sheet `1SdepJz…UAJjU` |
| `minnie65_public`, `minnie65_public_v117` | **MICrONS** — mouse visual cortex | `minnie.microns-daf.com` | `minnie65_public_v117` / `minnie65_phase3` | `eyewire_ii_cell_status_v2` (`bound_tag_user`) | `cell_type_dev` (`bound_tag`) | — |
| `fly_v26`, `flywire_fafb_sandbox` | **FlyWire** — fly brain (FAFB) | `global.daf-apis.com` | `flywire_fafb_sandbox` / `fafb_seung_import` | `cell_status_dev` | `cell_type_dev` (`bound_tag`) | — |

Notes:
- **Default dataset** = `stroeh_mouse_retina` (`DEFAULT_CAVE_CONFIG`). The stroeh & pinky entries carry a `defaultStateUrl` (a saved neuroglancer state on `global.brain-wire-test.org/nglstate/api/v1/…`) so a switch lands the user on a curated view; `skipStateUrlIfTutorialActive` avoids disrupting Tutorial 1 on the pinky sandbox.
- The **retinal cell-type picker** list is `RETINAL_CELL_TYPES` in `src/config.ts` (RGC, amacrine incl. starburst, bipolar ON/OFF, horizontal, rod/cone, Müller glia, astrocyte, microglia, vascular, interplexiform, other/unknown); users can also free-type.
- **State/volumes servers**: volumes info & state shortening run on `global.brain-wire-test.org` (see `config/ng-extend.json`, `config/state_servers.json`).

---

<!-- SECTION-ANCHOR-7 -->
## 7. High-level architecture

### Runtime shape
- **`ExtendViewer extends Viewer`** (`src/main.ts:742`) subclasses neuroglancer's `Viewer`, adding a `ButtonService` and `AnnotationService`. It is stored on the global **`window['viewer']`** — the single object almost every component reads/mutates for layers, tools, navigation, and the canvas. **This is not reactive**; only explicit Pinia refs (and `useLayersStore().activeLayers`) update Vue.
- On `DOMContentLoaded` (`src/main.ts:67`) the app creates Pinia + the Vue app (`App.vue`), mounts at **`<div id="app">`**, calls `setupViewer()` / `initializeWithViewer()` / `loadVolumes()`, then `mergeTopBars()` moves neuroglancer's native top bar into the Vue element **`#insertNGTopBar`** inside `ExtensionBar`. Config is injected at build time as esbuild `--define` globals (`CONFIG`, `DATASETS`, `DEFAULT_SETTINGS`, `STATE_SERVERS`, `CUSTOM_BINDINGS`, `NEUROGLANCER_DEFAULT_STATE_FRAGMENT`).
- Two `MutationObserver`s on `#content` (`src/main.ts`) drive the UI: one injects the per-segment "lightbulb" menu + jump button + status badge into each `.neuroglancer-segment-list-entry`; the other scrapes the graphene multicut/merge tool DOM into `useSplitMergeOverlayStore` so the custom `SplitMergeOverlay` can mirror it.

### The four external systems
1. **CAVE** (`minnie.microns-daf.com`, `global.daf-apis.com`) — EM imagery (`precomputed://`), editable segmentation (`graphene://middleauth+…`, via PyChunkedGraph), and annotation tables for **completion status** and **cell type** (per-dataset, see [§6](#6-datasets)). Reached through `src/widgets/lightbulb_service.ts` (annotations) and `pcg_service.ts` (change logs, supervoxel→root).
2. **Supabase** (`javthknksdcrlhiaaptj.supabase.co`) — all community/gamification data: `users`, tasks/claims, `edit_log`, `activity_feed`, `help_requests`, chat, notifications, groups, special badges, leaderboard views, working links. Client in `src/supabase.ts` (anon key, **RLS is fully permissive** — see [§15](#15-known-issues)).
3. **Google Sheets** — per-dataset **Cell Library** task lists (read as CSV export; write-back via a hardcoded service-account JWT — see [§15](#15-known-issues)).
4. **Google Cloud Functions** (project `ytho-4bff2`) — the AI **Guide** (`guideAssistant` / `guideFeedback`) and the screenshot signer (`signScreenshotUpload`).

### Core data flow
EM + segmentation stream from CAVE into neuroglancer, which renders 2D slices + 3D meshes. The user proofreads with the **Cut (multicut/`C`)**, **Merge (`M`)**, and **Find Path (`F`)** graphene tools. `watchSegmentEdits()` (`src/store.ts:171`) listens to `visibleSegments.changed` (3 s debounce): a net-negative segment count → merge, positive → split; it bumps `useUserStatsStore` counters and logs to Supabase `edit_log` + `activity_feed`. Marking a cell **complete** or setting its **cell type** writes a CAVE annotation (with a localStorage mirror to bridge materialization lag) and fires celebrations. Gamification (badges, streaks, leaderboards, notifications) reacts to those store changes.

### Cross-component communication
Three buses: (a) **`window['viewer']`** for viewer state; (b) **Pinia stores** ([§9](#9-data-layer)); (c) a lightweight **custom-DOM-event bus** — notably `middleauthlogin`, `nge:cave-auth-expired`, `nge:seg-status-changed`, `nge:assistant-action`, `nge:open-profile`, `nge:close-all-panels`.

### Architectural cautions (read before building)
- `window['viewer']` and the layers-store `viewer` are **non-reactive**; components detect the active segmentation layer by class-name/`'Segmentation'` heuristics, not reactive bindings.
- **Materialization lag**: CAVE completion/type reads may miss recent writes; a localStorage mirror (`nge_local_annotations_v3`) bridges the gap, and the Guide explains it to users.
- **`'eyewire_ii'`** is written as the `dataset` string on most Supabase rows regardless of the active dataset (it's an alias of `stroeh_mouse_retina`).
- Two legacy/parallel subsystems remain inert or superseded: `store-pyr.ts`'s `useStatsStore` (old EyeWire leaderboard poller), `seg_management.ts`'s `SubmitDialog`, and `AnnotationPanel.vue`/`TagPanel.vue` (not mounted).

---

<!-- SECTION-ANCHOR-8 -->
## 8. Build, run, deploy

### Stack & toolchain
Vue 3 + Pinia + TypeScript, bundled with **neuroglancer's own esbuild tooling** (not the repo's `webpack.config.js`, which is **legacy/unused** — no `webpack` npm script exists). neuroglancer is an **npm dependency pinned to a commit** — `github:seung-lab/neuroglancer#737a902c8740ff37500ba0f2f658beacbbdd7c5a` — installed into `node_modules/neuroglancer` (the README calling it a "git submodule" is inaccurate). `tsconfig.json` maps `neuroglancer/*` → `third_party/neuroglancer/*`; in this checkout `third_party/neuroglancer` is a **committed vendored copy** (557 files). `fix_symlink.js` (run manually) can instead point it at `node_modules/neuroglancer/src/neuroglancer` as a Windows junction — relevant when bumping the neuroglancer pin (the vendored copy can drift). Other key deps: `vue ^3.2`, `pinia ^2.0`, `@supabase/supabase-js ^2.98`, `marked ^15` (markdown).

### `npm install` side effects
`postinstall` runs two idempotent patches against `node_modules/neuroglancer`: `scripts/patch-bundle-config.js` (bundles the JPEG-XL decoder into the async worker) and `scripts/patch-esbuild-loaders.js` (registers `.jpg/.jpeg` with esbuild's `file` loader). These re-run after every install.

### Build (production — what CI runs)
```bash
npm install                         # runs postinstall patches
node scripts/build-prod.js          # → dist/min/   (default DATASET=pinky_sandbox)
DATASET=minnie65 node scripts/build-prod.js   # options: stroeh_mouse_retina | minnie65 | flywire_sandbox | pinky_sandbox
```
`build-prod.js` injects the five `config/*.json` files as esbuild `--define`s (plus a `NEUROGLANCER_DEFAULT_STATE_FRAGMENT` built from the chosen dataset), runs `--config=min --no-typecheck`, copies badge PNGs into `dist/min/center-art/`, and copies every `static/*.html` (standalone CAVE-table viewer pages) into `dist/min/`. ⚠️ Plain `npm run build` produces a bundle but **omits the config defines** — always prefer `build-prod.js` for anything real.

### Run the dev server
- **Windows:** `npm run dev-server-win`  •  **Linux/macOS:** `npm run dev-server`
- Open **http://localhost:8080** (esbuild's default port; the launcher binds `0.0.0.0` and passes no `--port`). Watch + rebuild is automatic.
- Switch dataset: `DATASET=minnie65 npm run dev-server-win`. **Dev-server default dataset = `stroeh_mouse_retina`** (note: differs from build-prod's `pinky_sandbox` default). Node ≥ 18 (CI uses Node 20).
- ⚠️ The `README.md` claim of "localhost:9000, Minnie65 default" is **stale** — trust port **8080** and the dataset defaults above.

### `config/` files (esbuild defines)
- `ng-extend.json` — volumes info URL (`middleauth+https://global.daf-apis.com/info/api/v2/ngl_info`), `volumes_enabled: ["Zheng CA3"]`, `leaderboard_url` (legacy pyrdev).
- `state_servers.json` — neuroglancer state server `middleauth+https://global.brain-wire-test.org/nglstate/api/v1/post` (`default:true`).
- `default-settings.json` — per-datastack default camera state (dimensions/position/scale) for stroeh, minnie65, fly_v26, flywire sandbox, etc.
- `datastack-dataset.json` — seg-layer name → datastack name map.
- `custom-keybinds.json` — `M` merge, `C` multicut, `T` freeRotateCube, `F` findPath; disables `X`, `Ctrl+Shift+X` clear, `[`/`]` prev/next.

### Deploy — two independent paths (don't confuse them)
1. **App Engine (primary, automatic).** Workflow `.github/workflows/on_dev_branch_push.yml` triggers on push to **any branch except `master`**. It installs, typechecks (non-blocking), runs `build-prod.js`, copies `dist/min` into `appengine/frontend/static/`, and deploys via **Workload Identity Federation** — provider `projects/483670036293/…/workloadIdentityPools/neuroglancer-github/providers/github`, service account `chris-apps-deploy@seung-lab.iam.gserviceaccount.com` (no JSON key). Deploy is **`promote: false`** (staging version, no live-traffic switch). Target: **`https://{version}-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`** where `version` = branch name with `/`,`_`→`-` (this branch → `eyewire-ii-community`). App Engine config `appengine/frontend/app.yaml`: `runtime: python312`, `service: brain-wire`, static-only (`/$`→`static/index.html`), `secure: always`.
   - **Deploy protocol (repo convention):** remote `amy` = the author's fork `amyleesterling/ng-extend` (CI runs but the WIF condition rejects the deploy → CI-only); remote `origin` = `seung-lab/ng-extend` (**authorized deploy target**). So "deploy it" = `git push origin eyewire-ii-community`.
2. **GitHub Pages (manual).** `npm run deploy` → `scripts/deploy-gh-pages.sh` builds, clones `amyleesterling/eyewire-ii`, copies `dist/min/*`, pushes to `main` → `https://amyleesterling.github.io/eyewire-ii/`. `SKIP_PUSH=1` = dry run.

### Scheduled GitHub Actions (data sync / notifications)
- `cave-completions-sync.yml` — every 30 min; `scripts/sync-cave-completions.mjs` pulls CAVE materialized completions → Supabase `cave_completions_mirror` (feeds the leaderboard "Cells" metric). Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CAVE_SERVICE_TOKEN`.
- `weekly-recap.yml` — Sat 23:00 UTC; sends "Your Week in Science" notifications.
- `weekly-winners-snapshot.yml` — Mon 00:05 UTC; snapshots top-3 (`weekly_winners`) then broadcasts top-10 to chat.
- Repo Actions secrets required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CAVE_SERVICE_TOKEN` (App Engine deploy uses WIF, no secret).

---

<!-- SECTION-ANCHOR-9 -->
## 9. Data layer

State lives in **Pinia setup-stores** in `src/store.ts` (~3760 lines) and `src/store-pyr.ts`, persisted to **localStorage (LS)**, **Supabase (SB)**, or **runtime-only (RT)**. Build-time globals `CONFIG`, `DEFAULT_SETTINGS`, `DATASETS` are declared ambient at the top of `store.ts`.

### Pinia stores
| Store (`use…`) | Persist | Purpose |
|---|---|---|
| `useDropdownListStore` | RT | Coordinates which dropdown in a group is open. |
| `useLoginStore` | LS (read) | Reads middleauth sessions from `auth_token_v2_*` keys. |
| `useLayersStore` | RT | Wraps the neuroglancer `Viewer`; layer selection, CAVE-server derivation, `watchSegmentEdits`. |
| `useUserStatsStore` | LS | Edit/merge/split/streak counters + 30-day daily log (week starts Mon UTC). |
| `useUserPreferencesStore` | LS | Flag, bio, toolbar-icon order, chat mute. |
| `useSegmentAnnotationStore` | RT | Currently selected segment + its CAVE status. |
| `useCellHistoryStore` | LS | Cells the user worked on; **seeds 11 demo minnie65 cells if empty**. |
| `useHelpRequestStore` | SB (+LS fallback) | Second-opinion requests, realtime. |
| `useWorkingLinksStore` | SB | Saved viewer-state URLs, realtime. |
| `useProofreadingQueueStore` | LS + Google Sheet | Brain-Quest review queue. |
| `useSplitMergeOverlayStore` | RT | Mirrors the multicut/merge tool DOM state. |
| `useProofreadingBackendStore` | SB | **The big one**: users, tasks, claims, edit log, activity feed, admin, notifications, groups, badges, leaderboard, celebrations. |
| `useVolumesStore` | RT | Legacy volume list (from `CONFIG.volumes_url`). |
| `useChatStore` | SB Realtime + `chat_messages` | Community chat on channel `'eyewire-ii-chat'`. |
| `useStatsStore` (store-pyr) | RT | **Legacy** EyeWire leaderboard poller (20 s loop; has a never-resolving-Promise quirk). |
| `useTutorialStore` (store-pyr) | LS + SB | Four-tutorial step tracking; hydrates from `users.tutorial_*` with `Math.max` merge. |

Key behaviors: `useLayersStore.initializeWithViewer` sets GPU/system memory limits (`2e9`/`3e9`) and layout `xy-3d`; `selectLayers` short-circuits to a dataset's `defaultStateUrl` (unless a tutorial is active) and re-applies `defaultSegments`/`segmentColors` after 200 ms (async mount clears them). `watchSegmentEdits` debounce = 3000 ms. `MAX_CLAIMS = 3`; task assignments expire after 30 min with a 10-min heartbeat. `captureCaveUserId` fetches the numeric CAVE id from `…/auth/api/v1/user/me`.

### localStorage keys (canonical list)
`auth_token_v2_<login_url>` (middleauth tokens) · `nge_stats_v1` · `nge_daily_log_v1` · `nge_prefs_v1` · `nge_cell_history_v1` · `nge_help_requests_v1` · `nge_queue_sheet_url_v1` · `nge_queue_reviewed<hash>` / `nge_queue_edits<hash>` · `nge_dataset_preference` · `nge-notification-dismissals` · `nge_chat_visible_v1` · `nge_local_annotations_v3` (CAVE mirror) · `nge_awarded_badges_v1` · `nge_batch_groups_v1` · `nge-leaderboard-metric` · `nge_recap_notif_{uid}_{isoWeek}` · tutorial: `nge-active-tutorial`, `nge-tutorial-step`, `nge-tutorial-2-step`, `nge-tutorial-3-step`, `nge-tutorial-4-step`, `nge-badge-citizen-scientist`, `nge-badge-advanced-operator`.

### `src/main.ts` helpers (beyond bootstrap — see [§7](#7-high-level-architecture))
- **Escape-key handler** (capture phase, `window`+`document`) exits graphene split/merge tools.
- **`autoSelectSegLayer`** retries 5× (2/4/6/8/10 s) to select the seg layer and click the "Seg." tab.
- **Segment injection** (`observeSegmentSelect`): per `.neuroglancer-segment-list-entry`, injects `.nge-segment-button.menu` (lightbulb), `.nge-jump-btn`, and a label badge; also a sticky pip legend.
- **`observeSplitMergeTools`**: `MutationObserver` + 500 ms poll scraping `.graphene-multicut`/`.graphene-merge-segments` into the overlay store.
- **`move_to_segment_patch.ts`** patches neuroglancer so right-click "jump to segment" works on graphene `MeshLayer` (upstream only handled `MultiscaleMeshLayer`); **`jump_to_list.ts`** adds Alt+click to scroll the segment list to the hovered segment; **`request.ts`** = a small `authFetch(url, token)` bearer helper.

### Supabase (`src/supabase.ts` + `*.sql` at repo root)
Client: `SUPABASE_URL = https://javthknksdcrlhiaaptj.supabase.co`, hardcoded **anon** JWT (client-safe under RLS — but see [§15](#15-known-issues)). Schema files and their tables:
- **`supabase-schema.sql`** — `users` (id UUID PK, `middleauth_email` unique, display_name, flag, bio, total_edits/merges/splits, cells_completed, current/longest_streak, last_edit_date), `proofreading_tasks` (+ migration adds `claim_point_x/y/z`, `supervoxel_id`), `task_assignments` (30-min `expires_at`), `edit_log` (operation enum, metadata JSONB), `activity_feed`, `help_requests` (segment_id, position, note, issue_type, resolved…, response_note/url/annotation_layer; code also uses `screenshot_url` — added by a later migration).
- **`supabase-admin-schema.sql`** — `admins` (seeds `amyleerobinson@gmail.com`), `user_groups`, `user_group_members`, `notifications` (target_type all/group/user, post_to_chat), `notification_reads`, `special_badges`, `special_badge_awards`. Storage bucket `admin-uploads` referenced by code (not created here).
- **`supabase-cave-user-id-schema.sql`** — `users.cave_user_id BIGINT`; `cave_completions_mirror` (PK cave_user_id+dataset+segment_id; synced ~30 min from CAVE).
- **`supabase-chat-history-schema.sql`** — `chat_messages` (name, rank, text, created_at).
- **`supabase-leaderboard-windows-schema.sql`** — view `user_edit_counts` (edits_24h/week/alltime from `edit_log`; completions_* from `cave_completions_mirror`); table `weekly_winners` (week_start, rank 1-3, metric edits/completions); `snapshot_weekly_winners()` fn.
- **`supabase-tutorial-state-schema.sql`** — `users.tutorial_active`, `tutorial_1_step`, `tutorial_2_step`, `tutorial_3_step`.
- **`supabase-working-links-schema.sql`** — `working_links` (url, dataset, position_x/y/z, visible_segments TEXT[], is_public, shared_group_id).

> **RLS is fully permissive (`USING (true)`) on every table** — all access control is client-side JS. See [§15](#15-known-issues).

---

<!-- SECTION-ANCHOR-10 -->
## 10. Core & viewer-integration components

All components are Vue 3 `<script setup lang="ts">`, namespace styles with `nge-`, reach the viewer via `window['viewer']`, and communicate over the custom-event bus. Most panels `Teleport to="body"` and emit a single `hide`.

- **`App.vue`** — root layout: `#vueMain` → `.ng-extend` (`<Tutorial v-if="sessions.length>0">`, `<ExtensionBar>`), `<SplitMergeOverlay>`, `#content > #neuroglancer-container`, and the CAVE **auth-expired banner** (the "Eye of Sauron" themed alert, `z-index 10000`, shown on `nge:cave-auth-expired`; its Refresh button does a cache-busting `hardReload`). Imports the global CSS (`common.css`, `ng-override.css`, `responsive.css`).
- **`ExtensionBar.vue`** — the top bar (`#extensionBar`, `height 40px`, `z-index 30`) and the app's command center. Hosts the Pyr logo (click = cache-bust refresh), `#insertNGTopBar` (where NG's native bar is merged), a holographic **Share toast** (Screenshot/Email/X/Facebook), the **Ask** button (AI Guide dock), the **Dataset** button, streak chip, the drag-reorderable **toolbar icons**, profile button, and the hamburger menu — and it declares the boolean `show*` flags and mounts nearly every panel/modal. `activateTool()` selects the seg layer then dispatches a synthetic keydown (`multicut→c`, `merge→m`, `findPath→f`). `DEFAULT_TOOLBAR_ORDER = ['split','merge','findPath','recap','leaderboard','cells','batch','help','notif','chat','settings']`; `quest` and `feed` icons are retired (still defined). Badge counters come from queue/help/notif/chat stores. It also owns **`handleAssistantAction`** (the only place Guide intent touches app state — see [§12](#12-services-and-guide)). Support files: `src/data/toolbar-icons.ts` (single source of icon SVGs, `TOOLBAR_ICON_DEFS`, shared with SettingsPanel) and `src/drag_reorder.ts` (document-level drag-reorder of NG segment-list rows, threshold 4px, rebuilds the `Uint64OrderedSet` without triggering the remove-cascade).
- **`LoginModal.vue`** — center-screen holographic middleauth login. A `MutationObserver` on `#statusContainer` catches NG "middleauth server X login required" messages, hides the native element, and lists each server with a CONNECT button. `doLogin` opens the auth popup from the user gesture and hands it to NG's own handler; re-scans at `[500,1500,3000,5000,8000,12000]` ms for late auth servers. Proactively primes CAVE auth via `sticky_auth` (`global.daf-apis.com/sticky_auth`). Has a **BYPASS** skip. `z-index 10000`.
- **`CommandPalette.vue`** (Ctrl/Cmd+K) — fuzzy command palette. Builds actions across `action|navigate|tool|help|shortcut|cell`; **dynamically ingests neuroglancer keybindings** from `viewer.inputEventBindings` and tool bindings; segment-dependent actions appear only when a segment is selected. `defineExpose`s `open/close/toggle/commandCatalog` (the Guide reads `commandCatalog`). Extra shortcuts: `Ctrl+Shift+C` mark complete, `Ctrl+Shift+P` profile, `Ctrl+Shift+L` leaderboard, `Ctrl+D` dataset.
- **`CellLibraryPanel.vue`** (~2785 lines, largest) — the primary proofreading surface. Draggable/resizable, tabs `My Cells / Available / Claimed / All / Completed / Help / My Saved Links`. Merges each dataset's **Google-Sheet** cell list with Supabase task state (Supabase wins), scoped to the active dataset. Claim/complete/release flow writes to Supabase **and** CAVE (`setCellComplete`) and back to the sheet via **`writeToSheetColumn`** (quote-aware CSV parse; **only fills empty cells, never overwrites**; Sheets v4 PUT with a service-account token). Help tab = quick-add second-opinion requests (issue types Unsure/Merge error/Split error/Missing branch/Other, optional screenshot), grouped by dataset, with threaded responses. Cross-dataset "jump" shows a confirm modal (offers save-as-working-link). Mounts `<ScreenshotDialog mode="attach">`. `z-index 10010`.
- **`ProofreadingQueuePanel.vue`** ("Brain Quest") — gamified daily quests: 3 date-seeded neurons/day, deterministic per-segment **nickname generator**, claim (soma coords) → set final seg ID → mark complete (writes CAVE + auto-releases claim), celebration + share-on-X. Draggable, `z-index 9000`. Reached mainly via Command Palette (toolbar icon retired).
- **`DatasetSelectorPanel.vue`** — compact runtime dataset switcher (card per `DATASETS` entry); detects the current dataset from managed-layer names; delegates to `switchToDataset`. `top 32px; right 8px; width 300px`.
- **`SplitMergeOverlay.vue`** — bottom status bar + companion panels mirroring the active graphene tool (mode badge, red/blue multicut group pills with point counts, context hints, Clear/`G` swap/`Enter` submit/`Esc` cancel; merge adds an auto-submit checkbox + a left merge-queue panel). Fully store-driven from `useSplitMergeOverlayStore`; manipulates NG's real DOM controls. `z-index` bar 9500 / merge panel 9501 / result flash 9600.
- **`VolumesOverlay.vue`** — older modal volume/source picker; builds layer specs and calls `selectLayers`, persisting `nge_dataset_preference`. Shown via `v-visible="showModal"`.
- **`ScreenshotDialog.vue`** — renders the WebGL canvas to PNG with resolution presets (720p–4K, 16–8192px), transparency, hide-bounding-box, a neuroglancer-accurate **scale bar**, and freehand **pen markup** (strokes stored in 0..1 image space). Two modes: **download** (to disk) or **attach** (POST to the `signScreenshotUpload` Cloud Function → signed PUT → public URL, for Second Opinion). `z-index 10010`.
- **`AnnotationPanel.vue`** & **`TagPanel.vue`** — legacy per-segment panels (CAVE status/edits/cell-type form; and a Supabase segment-tag panel). **Neither is currently mounted** — documented as reference; users act via the Cell Library / lightbulb menu instead.

**z-index ladder (high→low):** LoginModal / CommandPalette / App banner `10000`; CellLibrary & ScreenshotDialog `10010`; NotificationFeed lightbox `10001`; DatasetSelector / Share toast `9999`; SplitMerge flash `9600` / merge `9501` / bar `9500`; Notification detail `9500`; ProofreadingQueue / Chat `9000`; NotificationFeed panel `8000`; ModalOverlay backdrop `99`; ExtensionBar `30`.

---

<!-- SECTION-ANCHOR-11 -->
## 11. Social, gamification, tutorial & misc components

**Shared chrome:** `ModalOverlay.vue` = the dimmed holographic backdrop + centered panel used by most modals (backdrop `z-index 99`, drifting particle field, cyan border glow; it emits `hide` on backdrop click). `Overlay.vue` = an 8-line click/mousedown-stopping wrapper. `DropdownList.vue` = generic single-open-per-group dropdown (via `useDropdownListStore`).

- **`UserProfilePanel.vue`** (~2782 lines) — the "Researcher Profile" hub. Tabs: **Overview** (3 columns: editable identity + edit/cell stats + recent cells · badge grids for Building & Exploration tracks + Special Awards · favorite/latest badge viz + weekly podium + streak + 14-day activity chart), **Trophy Case**, **Week in Science** (embeds `WeeklyRecapPanel`), **Admin Hub** (embeds `AdminHub`, admin-only). Also renders other users' public profiles (opened via `nge:open-profile`). Flags render from `flagcdn.com`. Weekly-recap notification dedupe key `nge_recap_notif_{uid}_{isoWeek}`. Badge preview caps at 8 (7 + "View All").
- **`AdminHub.vue`** — admin control panel (embedded in the profile's Admin tab, gated by `backend.isAdmin`). Sub-tabs: **Notifications** (compose: title/body/target all-group-user/schedule/post-to-chat/image → `createNotification`), **Groups** (create + member management with debounced user search), **Special Badges** (create with image + award to user/group; awarding also fires a "✨ New Achievement!" notification). All writes go through `useProofreadingBackendStore` → Supabase.
- **`WeeklyRecapPanel.vue`** — "Your Week in Science" recap card (hero edit number, streak, month grid, cell activity, community contribution %, next badge, rotating science fact). Standalone modal **or** `embedded` (drops the ModalOverlay chrome). 580px.
- **`LeaderboardPanel.vue`** — right-edge full-height sidebar (360px). Time tabs `24h/Week/All Time`, metric toggle `Edits/Cells`, ranked table (medal, flag+name+streak, value, top badge). Row click → detail view + "View Full Profile". Data from the `user_edit_counts` view (falls back to `DEMO_USERS`). Metric persisted in `nge-leaderboard-metric`.
- **`SettingsPanel.vue`** — **user preferences** (not admin): country/flag, bio (280 chars), toolbar-icon toggle grid + reset, "mute chat unread badge", and an Advanced 2×2 grid poking `window.viewer` internals (Viewer Settings / Edit JSON State / Layer List / Selection Details) + logins list. 460px.
- **`NotificationFeedPanel.vue`** — the 🔔 bell feed (`top 42px; right 8px; width 340px; z-index 8000`) + detail overlay (markdown via `marked`, HTML-escaped first) + image lightbox. Realtime-subscribed; badge notifications trigger the AchievementToast hero; help notifications show "Open in Help tab →" (emits `open-help`). Mounts pre-auth via `v-show`.
- **`ChatPanel.vue`** — floating draggable/resizable real-time chat (default 280×200, `bottom 36px; left 8px; z-index 9000`). Supabase Realtime broadcast on `'eyewire-ii-chat'` + `chat_messages` history. Rank-colored names (admin gold / eyewirer teal / researcher green), trophy for top-3, clickable `#segId` (loads the segment) and names (open profile). Visibility persisted in `nge_chat_visible_v1`.
- **`ActivityFeedPanel.vue`** — live community activity stream (Supabase realtime `activity_feed`), 480px modal.
- **`HelpRequestsPanel.vue`** — browse/resolve second-opinion requests grouped by dataset (current dataset expanded; cross-dataset warnings on jump).
- **`AchievementToast.vue`** (~1756 lines) — the **celebration engine**. Watches stores and fires: toast stack (`top 52px; right 16px; z-index 9999`, 5 s auto-dismiss), a full-screen **hero badge overlay** (`z-index 10000`, hex grid + rings + particles), and single/batch cell-completion overlays (batch = "Asgardian" hero with a procedural Web-Audio chime). Idempotent via `nge_awarded_badges_v1`; an 8 s post-mount `initialized` guard prevents already-earned badges toasting on load. Milestone tables: edits `[100,500,1k,5k,10k,25k,50k,100k]`, streaks `[7,14,30,60,100,200,365]`, daily quest = 3. Other components signal it indirectly via `backend.pendingBadgeCelebration` / `pendingCellCelebration`.
- **`ConfettiCelebration.vue`** — full-screen canvas confetti + "calcium-imaging" sparkle (60fps); `defineExpose`s `trigger(palette, intensity)` / `sparkle(intensity)`. `z-index 99999`.
- **`BatchProcessorPanel.vue`** (~1473 lines) — create named segment-ID groups and bulk-act (recolor / complete / annotate / copy / remove), sectioned by dataset, persisted in `nge_batch_groups_v1`. Includes a **guided "Mark Complete" wizard** (place a crosshair per segment so CAVE resolves the right `pt_root_id`; solo-mode; fires ONE batch celebration). `z-index 10010`.

**Tutorial / onboarding system** — one engine (`Tutorial.vue` controller + `TutorialStep.vue` renderer) driven by `useTutorialStore` (`store-pyr.ts`) over four content modules:
- **`tutorial-1.ts`** ("Basics", ~19 steps) — connectomics intro on the MICrONS/pinky sandbox: 3D navigation, split-screen (SPACE), 2D EM navigation, find-and-fix an AI-missed branch; awards "Citizen Scientist".
- **`tutorial-2.ts`** ("Advanced Interface") — awards "Advanced Operator".
- **`tutorial-3.ts`** ("Cut & Merge" proofreading operations).
- **`site-tour.ts`** (Tutorial 4, 22 steps) — UI walkthrough run from the hamburger; each step `highlight`s a real selector (`.nge-pyr-logo`, `.nge-dataset-btn`, `[title^="Cut Mode"]`, `#profileBtn`, `#hamburger`, …) with the matching toolbar SVG; `closeAllPanels()` dispatches `nge:close-all-panels`. **Local-only, never synced to Supabase.**

The `Step` interface (`store-pyr.ts:142`) supports element-anchored or fractional positioning, markdown/HTML/video/image, `state` (a NG state URL to load), `onEnter` hooks, and `highlight`. Steps hydrate from `users.tutorial_*` on login (`Math.max` merge) with a debounced write-back. Badge awards set `backend.pendingBadgeCelebration` (fires the hero overlay) and upsert `special_badge_awards`.

---

<!-- SECTION-ANCHOR-12 -->
## 12. Services / widgets & the AI Guide

### `src/widgets/` — the service layer
**CAVE auth token** is read from localStorage: `lightbulb_service.ts` uses the single realm key `auth_token_v2_https://global.daf-apis.com/sticky_auth` (all CAVE writes authenticate through `sticky_auth`; state-server tokens are **not** valid for CAVE); `pcg_service.ts` and `assistant/materialization.ts` iterate all `auth_token_v2_*` keys and hostname-match.

- **`lightbulb_service.ts`** (core CAVE annotation service) — `getCellStatus`, `setCellComplete`, `saveCellType`, plus `NURRO_IMAGES` (10 mascot PNGs). Endpoints (under `${caveServer}`): materialization versions `/materialize/api/v3/datastack/{datastack}/versions`, live/frozen query `/materialize/api/v3/…/query`, annotation write `/annotation/api/v2/aligned_volume/{alignedVolume}/table/{table}/annotations`. **Notable:** query bodies are hand-built JSON strings so `pt_root_id` stays an unquoted int (JS `Number` can't hold IDs > 2^53). For legacy `bound_tag`/`cell_type_local` schemas (no user column) the writer is encoded in the tag with delimiter `|by:` (`complete|by:<user>`); for `bound_tag_user` the server injects `user_id` and no suffix is written. Mirrors to localStorage `nge_local_annotations_v3` (keyed `seg:<rootId>`) to bridge materialization lag; on **401** dispatches `nge:cave-auth-expired` (and does NOT fake-save). Fires `nge:seg-status-changed` so pips update live.
- **`button_service.ts`** — the `ButtonService` that injects the per-segment "⋯" lightbulb button + "Cell Profile" popup and a jump (↗) button. **Pip state machine** (`_applyStatus`): purple = complete **and** typed, blue = complete only, green = typed only, gray = neither; gold ring overlay = claimed. The 6-section menu: Completion Status, Cell Type (`RETINAL_CELL_TYPES` + free-text), Segment Color (9 presets + custom, packs `0xBBGGRR` into `segmentStatedColors`), Claim Cell (`MAX_CLAIMS`, stores viewer position + supervoxel anchor), Second Opinion, and a Change-Log link (`/segmentation/api/v1/table/{table}/root/{id}/lineage_graph`).
- **`pcg_service.ts`** (PyChunkedGraph client, **never writes**) — `getChangeLog` (merge/split/contributor counts), `getTabularChangeLog`, `getRootFromSupervoxel(s)` (supervoxels are immutable → resolve current root after splits), `isLatestRoots`, `getLatestRoots`.
- **`tag_service.ts`** — CRUD for the Supabase `segment_tags` table (**not CAVE**); `KNOWN_TAGS` (OFF-SAC/ON-SAC/SAC/Bipolar/Amacrine/…); `importFromSheet` (CSV, batches of 500).
- **`google_sheets_auth.ts`** — client-side Google **service-account** RS256 JWT → access token (scope `spreadsheets`). ⚠️ **The service account (`eyewire-ii-spreadsheet@eyewire-ii.iam.gserviceaccount.com`) and its RSA private key are hardcoded and ship to the browser** — see [§15](#15-known-issues).
- **`annotation_service.ts`** — `calculateDistance` display helper for line/box annotations (nm). **`widget_utils.ts`** — `getLayerScales`, `openSegPanel`. **`graphene_tool_utils.ts`** — `exitGrapheneTool()` (shared Escape cleanup, 4 fallback strategies). **`axis_aligned_cube_annotation.ts` / `free_rotate_cube_annotation.ts`** — two registered NG `LayerTool`s that emit a bounding box / 12 rotated edge lines (`T` binds free-rotate). **`seg_management.ts`** — *misnamed*: a legacy FlyWire-style `SubmitDialog` ("Mark Complete" via `/neurons/api/v1/mark_completion`), largely commented out / inert; superseded by the CAVE lightbulb flow.
- **`badge_definitions.ts`** (auto-generated, "do not edit") — 200 badges: **Building** (ids 1–100, keyed on `editsAllTime`, thresholds 1→1,000,000) and **Exploration** (101–200, keyed on `cellsSubmitted`, 1→50,000). `badgesForTrack`, `statKeyForTrack`. **`badge_images.ts`** maps `imageKey → center-art/{imageKey}.png`.

### `src/assistant/` — the AI "Guide"
A slim "Ask" chat dock (`AssistantDock.vue`) that answers questions **and** drives the UI, with hard safety guardrails. Spec: `docs/ai-assistant-spec.md`.

- **Backend** (Google Cloud Function, project `ytho-4bff2`, running a Claude Haiku tool-use loop server-side): `guideAssistant` (chat, overridable via `window.__NGE_GUIDE_URL`) and `guideFeedback`. The model, system prompt, and safety prose live **server-side** (not in this repo).
- **Request/response** (`AssistantDock.vue`): POST `{ message, history(last 8), appContext, uiReference, stream:true }`; response is **NDJSON** — `{type:"text",delta}` streams tokens, `{type:"done",reply,logId,actions}` finalizes + dispatches actions, `{type:"error"}` / 429 return a friendly `reply`. `guideFeedback` takes `{logId, verdict:"up"|"down", correction,…}`.
- **`context.ts`** `buildAppContext` — a **read-only** snapshot each turn (dataset/datastack/caveServer, up to 25 visible segment IDs, open panels, tool mode, login/user, tutorial progress, `navigator.language`, materialization info). Nothing mutates.
- **`knowledge.ts`** `buildUiReference` — **auto-generates** the Guide's factual UI reference from real sources (`TOOLBAR_ICON_DEFS`, `custom-keybinds.json`, the command-palette catalog) so it never drifts.
- **`actions.ts` — the safety core.** `ACTION_REGISTRY` is the **allow-list of everything the assistant may do**, all non-destructive: `openPanel`/`closePanel` (whitelisted panels), `setToolMode` (merge/split/findPath/none — only *enters* the mode; the human performs the edit), `goToSegment` (`/^\d+$/`), `openCommandPalette`, `spotlight` (whitelisted targets only), `startTutorial` (1–4). Each entry validates+cleans args or returns `null`. **There is deliberately no action that merges, splits, submits a completion, or writes to CAVE** ("Do not add write actions to this file"). Valid actions emit `nge:assistant-action`.
- **`dispatch.ts`** — the single choke point (`runAction` per action). **`spotlight.ts`** — rings a control with the tour glow (`nge-tour-target`) for 6 s. **`materialization.ts`** — fetches the latest CAVE materialization version/timestamp so the Guide can answer "why aren't my edits showing?" concretely (3-min cache).
- **Execution:** `ExtensionBar.vue`'s `handleAssistantAction` is the **only** place validated Guide actions touch app state (a `switch` over the allow-listed names). **Safety model:** the LLM can only affect the UI through validated, allow-listed, non-destructive actions — no code path exists for it to write to CAVE, submit completions, merge/split, or click irreversible controls.

---

<!-- SECTION-ANCHOR-13 -->
## 13. Visual design system & CSS

The UI layers a **"holographic sci-fi" dark-navy theme** over neuroglancer's native DOM. Almost every override uses `!important` because it fights neuroglancer's hardcoded white icon strokes and red (`#db4437`) hovers.

### Color palette
- **Dominant accent: `#4a9eff` (cornflower blue)** — the theme's signature, used almost entirely as low-alpha `rgba(74,158,255, …)` for borders (0.05–0.65) and fills/hovers (0.06–0.18); solid `#4a9eff` only for active/checked states and the active top-bar underline. Bright text variants: `#cfdcef` (idle icon), `#e0ecff` (hover), `#7df`/`#b0c8e8` (input/dimension text).
- **Base navy backgrounds:** near-black gradients like `linear-gradient(135deg, rgba(4,6,14,0.97), rgba(8,12,24,0.95))` (top row, side panel titlebar) and the 3-stop modal body in `ModalOverlay.vue`.
- **Semantic status colors** (cell state, `lightbulb_menu.css`): purple `#CE93D8` (complete+typed), green `#4CAF50` (typed only), blue `#42A5F5` (complete only), gold `#FFD700` (claimed), orange `#ff9800` (ask-for-help), gray `#9e9e9e` (incomplete). The "to-do" pip is a hollow outlined triangle (`▲` via `-webkit-text-stroke`).
- **Legacy EyeWire brand:** a teal→green gradient (`--gradient-highlight`, `--color-flywire-dark-green #0fb18b`) survives on legacy buttons.
- Design tokens live in `src/common.css` `:root` (note: `--color-dark-bg: hsl(230 0% 14%)` renders grey, not blue — an inert leftover; the real backgrounds are the navy `rgba` gradients).

### Shared holographic effects (`ModalOverlay.vue`)
Backdrop `radial-gradient(rgba(0,12,30,0.82)→rgba(0,0,0,0.92))` + `backdrop-filter: blur(6px) saturate(1.2)`; a 6-dot drifting particle field (`ngeHoloModalDrift` 25s); panel border `rgba(0,180,255,0.18)` with layered glow box-shadows; `border-radius: 20px`. The **"materialize" entrance** (fade + scale + blur + brightness flash, eased `cubic-bezier(0.16,1,0.3,1)`) is a **convention copied per-panel** (SettingsPanel, WeeklyRecap, UserProfile, LoginModal, AchievementToast, SplitMergeOverlay), **not** a single shared class — so it can drift; only backdrop/particles/border-glow are centralized.

### Typography
UI sans `'Inter', system-ui`; monospace `'Consolas','Monaco'` / `'JetBrains Mono'` for IDs, coordinates, keybinds. Section headers are the recurring idiom: ~10–12px, weight 700, `letter-spacing 0.08–0.12em`, uppercase, dim blue.

### Neuroglancer overrides (`src/ng-override.css`)
Retargets NG classes: `.neuroglancer-viewer-top-row` (navy gradient, borderless icons, boxed Share CTA, blue active-underline), **hides** native settings/JSON/layer-list buttons (moved into the custom Settings panel), `.neuroglancer-position-widget` (blue x/y/z readout), the layer bar, the entire right side panel, `.neuroglancer-segment-list-entry` (two-row flex layout + 2px accent bar + hover/selected states + jump-flash/drag-drop animations), and an **icon-color fight** overriding NG's white strokes / red hovers to the blue family. **The `.neuroglancer-mouse-position-widget` rule (`min-width:0; overflow:hidden`) is the "shake fix"** — the orange hover-coordinate readout was `flex:1; white-space:pre`, so its changing width reflowed the whole top row and made the 2D/3D panels appear to shake.

### Responsive layer (`src/responsive.css`)
Makes the top bar adapt to laptops (esp. 125–150% OS scaling → ~1000–1230px effective width) **without shrinking the toolbar icons**. Strategy: `#extensionBar { max-width:100vw }` + `min-width:0` on `#vueMain`/`.ng-extend` so flex-shrink engages; discrete controls `flex-shrink:0` while the coordinate zone (`#insertNGTopBar.flex-fill`) and `.nge-toolbar-icons` are elastic (`flex-shrink:1; min-width:0`), the icon row getting `overflow-x:auto` as a scroll safety valve so profile/hamburger never clip. Breakpoints: **≤1366px** collapse the Dataset label to its glyph + tighten the coordinate readout; **≤1120px** hide the streak chip; **≤1600px** tighten icon spacing and bump NG/profile glyphs. **Specificity gotcha (documented in the file):** `#extensionBar button { font-size:10pt }` (specificity 1,0,1) had been silently overriding `.nge-icon-btn { font-size:22px }` (0,1,0) down to ~13px — so icon-size rules **must** be scoped under `#extensionBar` (1,1,0) to win. Panels/modals are clamped to the viewport (`.nge-overlay-content` and the edge-pinned side panels get `max-width: calc(100vw - Npx)` / `max-height: calc(100vh - Npx)`). *(The exact current toolbar-icon size lives in `ExtensionBar.vue`; treat that source as authoritative since it's a volatile value.)*

### Widget CSS
`lightbulb_menu.css` (Cell Profile popup + the full pip-color system + loading/to-do pulse animations), `annotations_restyle.css`, `help_panel_restyle.css`, `render_tab_restyle.css` (custom sliders/checkboxes at `#4a9eff`), `seg_management.css` (legacy PNG bulb icons + teal button). The `.nge-tour-target` glow (reused by the Guide spotlight) is defined in `TutorialStep.vue`.

**Signature timings:** micro-transitions 0.12–0.2s; entrance easing `cubic-bezier(0.16,1,0.3,1)` everywhere; ambient loops — particle drift 25s, login border 6s, loading pulse 1.2s, to-do pulse 2.4s.

---

## 14. Repo history

**Branch:** `eyewire-ii-community` (the working & deploy branch), tracking `origin/eyewire-ii-community` (`seung-lab/ng-extend`). A second remote `amy` is the author's fork (used for CI-only pushes; `origin` is the authorized deploy target). The working tree is currently **clean**; two `git stash` entries exist (WIP not on the tree — confirm before assuming anything there is dead).

**Recent development arc (newest first, themed):**
- **EyeWire II Guide — in-app AI assistant** (largest recent thrust): a natural-language helper that answers questions *and* drives the neuroglancer UI (navigate, spotlight controls, start tutorials) but **never** performs destructive edits. Token-streamed, multilingual, with a user "flag a wrong answer" correction loop, and a knowledge base auto-generated from real app sources. Spec at `docs/ai-assistant-spec.md`.
- **Cell Library + CAVE completions**: per-dataset cell lists loaded from Google Sheets, dataset-scoped, with completion writing to per-dataset CAVE `cell_status` tables; sheet write-back **only fills empty cells** (never overwrites).
- **Chat / notifications / feedback**: chat history + unread pip + mute + remembered close-state; markdown in notification bodies; a "Submit Issue" feedback button; "Week in Science" surfaced as a profile tab.
- **Top-bar / toolbar responsive polish** (includes this session's responsive work + subsequent icon-rhythm/viewBox-crop refinements).
- **Screenshot & Second Opinion**: screenshot dialog with preview, pen markup, and custom scale-bar overlay; attach a screenshot to a Second Opinion request.
- **Batch celebrations & leaderboard**: hero/"Asgardian" batch-completion celebrations; weekly champions broadcast (top editors + completers).
- **Site tour & tutorial**: onboarding tour + multi-step tutorials.

**Top-level extras (not part of the app bundle):**
- `README.md` — product-facing readme (note: some values, e.g. a `localhost:9000` port and "Minnie65 default," are **stale** vs. current config; trust `src/config.ts` and [§8](#8-build-run-deploy)).
- `docs/ai-assistant-spec.md` + `docs/architecture/*.mermaid` (five diagrams: architecture, data-flow, database-schema, deployment, frontend-components).
- `architecture-diagram.html` (self-contained HTML data-flow diagram) and `presentation/eyewire-ii-overview.html` (standalone technical-overview slide page).
- `.pptx` decks at repo root (`EyeWire-II-Technical-Overview.pptx` ~53 MB, `EyeWire-II-New-Slides.pptx`, three title-option decks) + generators `create-new-slides.cjs`, `make-pptx.js`.
- App entry: `src/index.html` / `src/index.tpl` both mount the Vue app at `<div id="app">`; `main.bundle.js` / `main.bundle.css` are injected by the build; bootstrap lives in `src/main.ts`.

---

<!-- SECTION-ANCHOR-15 -->
## 15. Known issues, tech debt & security notes

### Security
- **Hardcoded secrets ship to the browser.** (1) A **Google Sheets API key** `AIzaSyDEZ…` in `src/config.ts:204`. (2) A **Google service-account private RSA key** + email `eyewire-ii-spreadsheet@eyewire-ii.iam.gserviceaccount.com` in `src/widgets/google_sheets_auth.ts` (full `spreadsheets` scope). (3) The Supabase **anon** JWT in `src/supabase.ts`. Items 1–2 are real leaked-credential risks (GitGuardian-flagged per project history). **Action:** rotate, move signing/writes server-side, and stop adding secrets to source.
- **Supabase RLS is fully permissive (`USING (true)`) on every table** — all gating is client-side JS. Any holder of the anon key can read/write all user, task, badge, and admin-allowlist data. Documented as "MVP" in the SQL; needs real row-level security before this is trusted with sensitive data.

### Correctness / data-model flags
- **`help_requests.screenshot_url`** is read/written by code but is **absent from `supabase-schema.sql`** — a migration exists outside these files or the column must be added.
- **`useCellHistoryStore` seeds 11 fake demo minnie65 cells** when empty (real UI shows placeholders until the user acts). `UserProfilePanel` similarly seeds demo stats when `editsAllTime === 0`.
- **`'eyewire_ii'`** is written as the `dataset` on most Supabase rows regardless of the active dataset.
- **`store-pyr.ts` `useStatsStore`** has a `new Promise(() => setTimeout(loop, 20000))` whose resolver never fires (harmless fire-and-forget recursion, but a smell). It's the **legacy** EyeWire leaderboard poller, parallel to the Supabase leaderboard.
- **Non-reactive viewer references** (`window['viewer']`, the layers-store `viewer`) are used widely; do not expect Vue reactivity from them.
- **Leaderboard hack:** the `24h` window is stored in the repurposed `editsThisMonth` field (documented in `LeaderboardPanel.vue`).

### Inert / legacy code to be aware of
- **`AnnotationPanel.vue`** and **`TagPanel.vue`** are not mounted anywhere.
- **`seg_management.ts`** (`SubmitDialog`) is a FlyWire-style mark-complete overlay, mostly commented out, `isCoordInRoot()` stubbed to `false`; superseded by the CAVE lightbulb flow.
- **`webpack.config.js`** and **`tslint.json`** are legacy (build uses esbuild, lint uses ESLint).
- **`third_party/neuroglancer`** is a committed vendored copy that can drift from the `node_modules/neuroglancer` pin — re-vendor or run `fix_symlink.js` when bumping the neuroglancer commit hash.
- **`README.md`** is stale on run details (says port 9000 / Minnie65 default and calls neuroglancer a submodule). Trust this document + source instead.

### Open questions worth confirming with the team
- Whether the two `git stash` entries on this branch hold wanted WIP.
- The intended default dataset (dev-server = `stroeh_mouse_retina` vs build-prod = `pinky_sandbox`).
- Some README-referenced `docs/*.png` images appear missing.

---

## 16. Glossary

- **Connectome** — the complete map of neurons and their synaptic connections.
- **EM (electron microscopy)** — nanometer-resolution imaging that produces the raw brain volumes.
- **Segmentation** — per-voxel neuron labels; each neuron = a **segment** with a **root ID**.
- **Root ID / segment ID** — numeric identifier for a neuron in a specific graph version; changes on every edit.
- **Supervoxel** — the smallest segmentation unit; grouped into neurons by the PCG graph.
- **Proofreading** — human correction of segmentation via **merge** and **split/cut (multicut)**.
- **PCG (PyChunkedGraph)** — CAVE's versioned segmentation graph service (`graphene://`).
- **CAVE** — Connectome Annotation Versioning Engine: PCG + AnnotationEngine + materialization + auth.
- **Materialization (lag)** — periodic re-linking of annotations to current root IDs; recent edits lag.
- **Datastack / aligned_volume** — CAVE names bundling segmentation+annotations+imagery / the image space.
- **middleauth** — the OAuth gateway for gated CAVE/neuroglancer data.
- **neuroglancer** — Google's WebGL viewer this app extends.
- **Cell** — in app parlance, a neuron a user works on (claims, completes, types).
- **Second Opinion** — a help request asking other users to review a cell.
