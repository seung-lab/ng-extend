# Handoff: adding a new dataset to `eyewire-ii-community`

**Branch:** `eyewire-ii-community`
**Written:** 2026-09-22
**Scope:** everything needed to register a new connectome dataset in this app, end to end.
**Companion doc:** `HANDOFF.md` at the repo root is the full project briefing. Section 6 there describes the datasets that exist today. This file is only about adding one.
**Before you start:** claim a card on the shared kanban board (`github-kanban` MCP tools, workflow at `C:\Users\amyle\.hermes\github-kanban\WORKFLOW.md`) and leave a verified handoff on it when you stop.

---

## 1. Read this first: the silent fallback

`getDatasetCaveConfig()` in `src/config.ts:212` resolves a dataset by exact key, then by substring, then it **falls back to `DEFAULT_CAVE_CONFIG`, which is the production retina** (`src/config.ts:176`).

It does not throw and it does not warn. A dataset name that nobody registered resolves to a working config pointing at the wrong volume.

Verified against the real compiled module on 2026-09-22:

```
registered keys: stroeh_mouse_retina, eyewire_ii, pinky_sandbox, pinky_training3,
                 pinky_nf_v2, minnie65_public, minnie65_public_v117, fly_v26,
                 flywire_fafb_sandbox

stroeh_mouse_retina    -> datastack=stroeh_mouse_retina    volume=stroeh_mouse_retina  (exact key)
pinky_nf_v2            -> datastack=pinky_sandbox          volume=pinky100             (exact key)
pinky_training6        -> datastack=stroeh_mouse_retina    volume=stroeh_mouse_retina  *** FELL BACK ***
my_new_dataset         -> datastack=stroeh_mouse_retina    volume=stroeh_mouse_retina  *** FELL BACK ***
minnie65_public        -> datastack=minnie65_public_v117   volume=minnie65_phase3      (exact key)
```

**Consequence.** Until the new dataset has a key in `CAVE_CONFIGS_BY_DATASET`, every CAVE annotation call the app makes while that layer is on screen is addressed to the production retina aligned volume, carrying root IDs from a different volume. Mark complete, cell type, and the lightbulb service all route through this one function.

So: **add the `src/config.ts` entry before loading the new layer in the app, not after.**

Note that `canonicalDataset()` in `src/datasets.ts:151` does prefix matching (`pinky*`, `minnie65*`, `stroeh*`) but `getDatasetCaveConfig()` never calls it. The two resolvers disagree by design and both need the new dataset.

---

## 2. Facts to collect before touching code

Get these from the CAVE admin, Forrest or Derrick in `#shared_cave_seunglab`, and fill the column in as they arrive:

| Fact | Example | Value for the new dataset |
|---|---|---|
| CAVE server | `https://minnie.microns-daf.com` | |
| Datastack name | `pinky_sandbox` | |
| Aligned volume | `pinky100` | |
| PCG segmentation table | `pinky_nf_v2` | |
| Image source | `precomputed://gs://...` | |
| Voxel size, x y z | `16e-9, 16e-9, 4e-8` | |
| cell_status table and schema | `eyewire_ii_cell_status_v2`, `bound_tag_user` | |
| cell_type table and schema | `cell_type_dev`, `bound_tag` | |
| Is the cell_status table materialized? | yes or no | |

Two of these decide later steps:

* **Schema must be `bound_tag_user`** for the leaderboard to attribute completions. `bound_tag` has no `user_id` column, so a completion cannot be credited to a person.
* **Materialization must be running** on the datastack before the dataset joins the completions sync. See trap 3.

---

## 3. Registration checklist

Ten places. The first three are required for the app to work at all. The rest control the switcher, the scheduled jobs, and local dev.

### Required

**1. `src/config.ts:51`, `CAVE_CONFIGS_BY_DATASET`**
Add an entry keyed by the **segmentation layer name** exactly as it appears in the neuroglancer state. Fields are typed by the `DatasetCaveConfig` interface just above. Required: `caveServer`, `datastack`, `alignedVolume`, `cellStatusTable`, `cellTypeTable`, `cellTypeSchema`. Strongly recommended: `cellStatusSchema: 'bound_tag_user'`, `defaultSegments` so the 3D pane is not empty on arrival, and `cellLibrarySheetUrl`.

If the dataset will be reachable under more than one layer name, add a key per alias. That is why `eyewire_ii`, `minnie65_public_v117`, and `pinky_training3` all exist as separate keys.

**2. `src/datasets.ts:20`, `DATASETS`**
Add the entry the Dataset switcher renders: `id`, `label`, `shortLabel`, `description`, and the `layers` array holding the image layer and the graphene segmentation layer. The segmentation layer's `name` is the string that flows into step 1, so keep the two identical.

**3. `src/datasets.ts:151`, `canonicalDataset()`**
Add a prefix branch so every historical alias of the new dataset collapses to one canonical key. This is the value stamped on Supabase rows (tasks, edits, help requests, chat, tags), so getting it wrong splits the new dataset's data across two labels. Update the comment block at `src/datasets.ts:146` listing known variants at the same time.

### Switcher, config, and display

**4. `config/datastack-dataset.json`**
Maps segmentation layer name to CAVE datastack, consumed through the `DATASETS` esbuild define. One line.

**5. `config/default-settings.json`**
Per dataset camera defaults: `dimensions`, `position`, `crossSectionScale`, `projectionOrientation`, `projectionScale`. Without an entry the viewer opens wherever the previous dataset left the camera.

**6. `src/datasets.ts:172`, `EXTRA_SHORT_LABELS`**
Only needed if the dataset is **not** in `DATASETS` but can still appear on old rows. FlyWire is the existing example. Skip this for a dataset that ships in the switcher.

### Scheduled jobs

**7. `scripts/sync-cave-completions.mjs:61`, `DATASTACKS`**
Add a row only when the cell_status table uses `bound_tag_user` **and** materialization is live. Read trap 3 first.

**8. `scripts/sync-sheet-cells.mjs:54`, `SHEETS`**
Add a row if the dataset has a Cell Library Google Sheet. The `dataset` field here must be the **canonical** key from step 3, not the raw layer name.

**9. `.github/workflows/cave-edits-probe.yml:29`**
Only if the new dataset should become the probe default. Usually leave it alone.

### Local development

**10. `scripts/dev-server.js:31` and `scripts/build-prod.js:41`, both named `DATASETS_CONFIG`**
Two separate maps, two separate key sets, two different defaults. `dev-server.js:28` defaults to `stroeh_mouse_retina`, `build-prod.js:38` defaults to `pinky_sandbox`. Add the new dataset to whichever you intend to launch with `DATASET=<key>`.

### Supabase

No schema change needed. `dataset` is a plain `TEXT` column on `proofreading_tasks`, `edit_log`, `help_requests`, `segment_tags`, and `activity_feed`, defaulting to the legacy `'eyewire_ii'`. New rows are stamped by `currentDatasetTag()` in `src/datasets.ts:137`, which returns the canonical key from step 3.

If the new dataset arrives with pre existing rows under a different label, write a one off backfill modelled on `supabase-canonicalize-dataset.sql`.

---

## 4. Traps

**Trap 1, the fallback.** Covered in section 1. The failure mode is silent and it points at production.

**Trap 2, two resolvers.** `getDatasetCaveConfig()` matches raw names, `canonicalDataset()` matches prefixes. A dataset registered in only one of them half works: either the viewer looks right while CAVE writes land elsewhere, or the CAVE writes are correct while the Supabase rows split into two datasets. Always do steps 1 and 3 together.

**Trap 3, the completions sync can fail every 30 minutes forever.** `getLatestVersion()` at `scripts/sync-cave-completions.mjs:103` throws `versions endpoint returned empty array` when a datastack has no materialization running. The job runs on a 30 minute cron, so an unmaterialized datastack in `DATASTACKS` produces a failure email every 30 minutes. That is exactly why the `minnie65_public` row sits commented out at `scripts/sync-cave-completions.mjs:80`. The script handles the narrower "table exists but is not in this version" case gracefully at line 187, but it does not handle "no versions at all".

Confirm materialization is live before adding the row:

```bash
curl -s -H "Authorization: Bearer $CAVE_SERVICE_TOKEN" "https://minnie.microns-daf.com/materialize/api/v3/datastack/DATASTACK_NAME/versions"
```

A non empty JSON array is the go signal. `[]` means do not add the row yet.

**Trap 4, the two build defaults disagree.** `build-prod.js` defaults to `pinky_sandbox` while `dev-server.js` defaults to `stroeh_mouse_retina`, so what you see locally is not what a default production build embeds. Set `DATASET` explicitly whenever it matters.

**Trap 5, `config/ng-extend.json` is a different system.** Its `volumes_enabled` and `volumes_default` currently read `"Zheng CA3"` and drive the upstream ng-extend volume picker fed by `global.daf-apis.com/info/api/v2/ngl_info`. That is not the same list as `DATASETS`. Editing it is usually not part of adding a dataset here, so leave it alone without a specific reason.

---

## 5. How to test before deploying

```bash
DATASET=your_key npm run dev-server-win
```

Then, in the running app:

1. Open the Dataset switcher and confirm the new entry shows its label and description.
2. Switch to it. The console logs `[datasets] Switched to <id>, CAVE: <datastack>, tables: ...` from `src/datasets.ts:195`. **Read that line.** If the datastack says `stroeh_mouse_retina` and you did not expect it, you hit trap 1.
3. Select a segment and mark it complete. Confirm in the network tab that the annotation POST carries the new dataset's `alignedVolume`, not the retina's.
4. Post a chat message or claim a task, then check the Supabase row carries the canonical key from step 3.
5. Run `npm run typecheck`.

Iterate on the dev server, not on App Engine.

---

## 6. Deploy

Use the `deploy-ng-extend` skill. The short version: push to `amy` first, which runs CI. Push to `origin` only when Amy says deploy, because `origin` is what publishes the live App Engine site. A `git push` is not a deploy, so verify from the live URL afterwards.

---

## 7. Open questions for Amy

1. Which dataset is this, and does it already have a CAVE datastack, or does one need provisioning?
2. Does it ship in the switcher for everyone, or stay dev only like the pinky sandbox?
3. Does it need its own Cell Library sheet, or does it launch without one?
4. Should its completions count toward the leaderboard on day one? That needs `bound_tag_user` plus live materialization.

---

## Appendix: what the preceding session found

* **The `pinky_training6` CAVE error.** That layer name is not a key in `CAVE_CONFIGS_BY_DATASET`, so the app silently used the production retina datastack and aligned volume for a pinky segment. It is listed as a known alias in the `canonicalDataset()` comment at `src/datasets.ts:148` but was never given a config entry. This is trap 1 in the wild, and the same class of bug the new dataset will hit if step 1 is skipped. Adding a `pinky_training6` key mirroring `pinky_training3` would fix it.
* **The failing `CAVE Completions Sync` emails.** The runs inspected failed with `The job was not acquired by Runner of type hosted`, an empty `runner_name`, and the job cancelled after roughly 15 minutes. That is GitHub Actions runner provisioning, not this repo's code, and GitHub reported an Actions major outage over that window. A later batch of emails shows a different job, `sync-edits`, failing in about 20 seconds while `sync` succeeded. That one was never diagnosed and is still open.
