# Hunt answer keys from proofreading history

Research spike, 2026-10-26. Read only: nothing was deployed and nothing was written to CAVE or Supabase.
Question (Ames): can a Hunt's answer key come from the proofreading steps of cells already marked proofread, in the Sandbox or in MICrONS public?

## Answer

**Yes for MICrONS public.** It is the better source. 2,345 cells are marked proofread, every edit was made by an expert proofreader and is kept, and the cell as it was before any of those edits still loads in Pyr. From real cells a key can be computed in 2 to 18 seconds, with 3 to 33 places per cell (table below).

**Only partly for the Sandbox.** The cells Pyr marked complete in the Sandbox have no edits at all, so they give no key. Cells in the Sandbox's own `neurons` table do carry expert edits from 2020 to 2024. They give small keys (2 to 7 places), mostly extensions. Edits made in the Sandbox since mid 2026 are players' practice edits and tutorial resets, and must not be used as answers.

Two findings change the design:

1. **The "before" moment matters more than anything else.** Many proofread cells started as a soma fragment, and the proofreader built the cell by joining pieces and then cleaning those pieces. Seen from before the first edit, most of those fixes are not visible: one cell has 20 edits, but only 3 can be seen. Seen from the start of the cell's second editing session, 12 can be seen (11 mergers, 1 extension). The button should offer each editing session as a starting point.
2. **A Hunt cell made this way is always an old ID.** Pyr marks an old ID amber and offers "update to the current ID", which would show the proofread cell, and with it every answer. That has to be switched off for Hunt cells while a Hunt runs (see Risks).

## 1. Where the proofread cells are

### MICrONS public (datastack `minnie65_public`)

- Table **`proofreading_status_and_strategy`**, schema `compartment_proofread_status_strategy`, **2,345 rows** at materialization 1926 (2026-09-28). Maintained by Bethanny Danskin with Forrest Collman and Casey Schneider-Mizell.
- `status_dendrite` true for 2,261 rows, `status_axon` true for 2,304, both true for 2,220.
- `strategy_dendrite`: dendrite_extended 2,022, dendrite_clean 239, none 84. `strategy_axon`: axon_partially_extended 1,382, axon_fully_extended 802, axon_interareal 120, none 41.
- **748 cells have dendrite_extended and axon_fully_extended.** These are the best Hunt cells, because the fewest real errors are left in them that the key would not know about.
- Example roots: 864691135686494647, 864691135939998724, 864691136195284556 (all three dendrite_extended, axon_fully_extended).
- `pt_supervoxel_id` is a supervoxel in the soma, which is what finds the cell's own chain of edits (section 3). `pt_position` is in **4 × 4 × 40 nm** voxels (the datastack's viewer resolution), but edit coordinates are in 8 × 8 × 40. Checked: read as 4 nm, the nearest edit lies 8 µm from the soma; read as 8 nm, it lies 814 µm away.

### Sandbox (graphene table `pinky_nf_v2`, datastack `pinky_sandbox`)

What Pyr has marked:
- `ew_cell_completions` holds 3 Sandbox rows: `task:16667` (2026-10-22), `task:2339` (2026-10-16), and root 648518346353084129 (2026-07-21).
- A task maps to its root through Supabase `proofreading_tasks`: `select id, segment_id, final_segment_id` (the profile does the same, `src/components/UserProfilePanel.vue:1273`). `segment_id` is the root the task started from, kept up to date from the claim point and supervoxel (`supabase-schema.sql`). `final_segment_id` is the root the player submitted.
  - Task 16667: segment_id = final_segment_id = 648518346354165433, supervoxel 75085237013000732. **0 edits** in the change log.
  - Task 2339: 648518346352612889 → 648518346355322263. These are **`pinky_training6`** roots, not `pinky_nf_v2` roots: on `pinky_nf_v2` the lineage call fails with 500 `KeyError` (the config notes that root ids do not carry across tables). On `pinky_training6` the change log has 0 rows.
  - Root 648518346353084129: 0 edits.
- CAVE table `eyewire_ii_cell_status_v2` (aligned volume pinky100): 4 rows, all tagged `complete`, made 2026-07-13, 07-14, 10-16 and 10-22. The last two match the two tasks above.
- **None of these has any edit history, so none can give a key.**

What the Sandbox graph does have:
- I listed every operation ever made (`operation_details` for every id from 1 to 12,750; the highest that exists is 2,608): **2,269 operations**, 1,224 merges, 893 splits, 152 of neither kind, 359 undo or redo, and 173 failed (`operation_status` 1 or 2). 770 of them are from October 2026, when Pyr's players and its tutorial practice resets edit this graph. Those are learners' edits and not answers.
- The `neurons` table of `pinky_sandbox` (456 cells, with soma supervoxels) gives the useful cells. Five of the cells with the most edits are in it, and their edits were made from 2020 to 2024 by Forrest Collman, Nuno Maçarico, Keith Wiley and JoAnn. These keys come from experts.

## 2. Edit histories of real cells

"On the cell" counts the edits that changed the cell itself, meaning the object holding the soma (section 3). "Lineage" counts every edit in the final root's history (`filtered=false`), including work on pieces before they were joined. The key counts are after every filter in section 4.

### MICrONS public (minnie65_public, 8 × 8 × 40 nm voxels, L2 chunk 2.05 × 2.05 × 20.5 µm)

| Final root | Status (dendrite / axon) | Lineage | On the cell: splits / merges | Key seen from before the first edit | Best start | Key from the best start | Loads on v117? |
|---|---|---|---|---|---|---|---|
| 864691135646342383 | none / partially extended | 9 | 2 / 3 | 2 cut, 3 extend | 2025-02-21 (only session) | 5 | yes |
| 864691136814060915 | clean / partially extended | 21 | 15 / 5 | 1 cut, 2 extend | 2025-03-26, root 864691135572849645 | 11 cut, 1 extend | no, use Live |
| 864691136120952088 | extended / partially extended | 511 | 6 / 16 | 4 cut, 13 extend | 2020-12-22 (first) | 17 | yes |
| 864691136975583516 | extended / partially extended | 441 | 37 / 29 | 22 cut, 11 extend | 2021-10-13 (first) | 33 | yes |
| 864691137054934902 | extended / partially extended | 190 | 8 / 16 | 0 cut, 1 extend | 2022-12-22, root 864691136041038166 | 3 cut, 10 extend | yes |
| 864691135774177531 | extended / fully extended | 457 | 7 / 12 | 0 cut, 1 extend | 2023-01-24, root 864691136577486612 | 5 cut, 9 extend | yes |

### Sandbox (pinky_nf_v2, 8 × 8 × 40 nm voxels, L2 chunk 4.1 × 4.1 × 5.1 µm; cells from the `neurons` table)

| Final root | Type | Lineage | On the cell: splits / merges | Key seen from before the first edit | Best start | Key from the best start |
|---|---|---|---|---|---|---|
| 648518346351558851 | g | 23 | 2 / 3 | 2 cut, 1 extend | 2021-03-08 (only session) | 3 |
| 648518346353621107 | i | 44 | 0 / 20 | 0 cut, 7 extend | 2023-05-29 (first) | 7 |
| 648518346352953185 | e | 69 | 0 / 28 | 0 cut, 2 extend | 2023-05-23, root 648518346351105361 | 3 extend |
| 648518346353970541 | g | 26 | 2 / 2 | 1 cut, 1 extend | 2020-09-23 (first) | 2 |
| 648518346350659596 | g | 23 | 2 / 5 | 0 cut, 1 extend | 2021-03-09, root 648518346351688185 | 1 cut, 1 extend |

Across all 11 cells:
- **Undo pairs:** none in any of the 11 lineages, by either check in section 4. In the Sandbox's practice edits they are common: 347 undo operations, and 269 splits that remove an edge an earlier merge added. MICrONS public does not mark undos at all: its `operation_details` have no `undo_operation_id` or `redo_operation_id` field (5,255 operations read), so there the edge check is the only one.
- **Distance between edits:** edits on the cell that have another within 3 µm: 0/5, 2/20, 11/22, 34/66, 8/24 and 4/19 (MICrONS); 3/5, 10/20, 2/28, 0/4 and 2/7 (Sandbox). The busy cells (864691136975583516, 864691136120952088) have close pairs. In the keys from the best starts, the median distance from a place to its nearest neighbor is 5 to 52 µm. The closest pairs (0.2 to 0.5 µm) are a cut next to an extension, which both stay.
- **Where the clicks were:** the median gap between a split's source and sink points, or between a merge's two points, is 0.48 to 1.56 µm, so their midpoint is a good place for the key. A few multi-point cuts spread wider (largest 3.9 µm on MICrONS, 13.2 µm in the Sandbox), and those need a look by hand.
- **Size before and after:** cells that started as a soma fragment grew a lot (33 → 9,153 L2 chunks; 46 → 5,650; 28 → 2,091). Cells that started too big shrank (11,862 → 9,138; 9,383 → 5,361), which means mergers were cut off.

## 3. How the key and the before view are made

1. **Read the whole history:** `tabular_change_log?filtered=false`. The server's default is `filtered=true`, and that is not enough. On 864691136120952088 it returned 121 rows instead of 511, left out edits on the cell itself, and the chain of edits stopped short of the final root (3 edits found instead of 22). With `filtered=false`, the chain reached the final root on all 11 cells.
2. **Find the cell's own chain of edits:** the soma supervoxel's root just before the first edit (`node/{sv}/root?timestamp=`) is the start root. Go through the edits oldest first. An edit is on the cell when the current root is among its `before_root_ids`, and the next root is `after_root_ids[0]` (the change log lists only the root that was kept). The rest of a large lineage (85 to 96% of it on the four big cells) is work on pieces before they were joined, and that is not shown to players.
3. **Choose the starting moment:** the start of any editing session (edits more than 1 hour apart). The before root is the cell's root at that moment.
4. **Can a player see it from there?** One `POST /roots?timestamp=<start>` call gives the root of every supervoxel the edits touched, as of the start moment.
   - **A split** is a merger to Cut if its cut edges lay inside the before root. If not, it cut something out of a piece joined later, which the player never sees.
   - **A merge** is an extension to Extend if one side of the join was in the before root and the other was not. If neither side was, it extends an extension (a chain along an axon): only the first join of a chain is visible.
5. **Where the place is:** the midpoint of the source and sink points (or their centers, for multi-point cuts), in nm = base voxels × `scales[0].resolution` from the graph's info, [8, 8, 40] on both tables. The key entry is `[x, y, z, 'cut' | 'merge']`, the format `functions/hunts.js` already uses.

Example, MICrONS 864691136814060915 from 2025-03-26, before root 864691135572849645, soma at [235552, 103488, 15304] (4 nm voxels):

```
[1094397, 604041, 830194, "cut"]    op 1599284
[939434,  525192, 605367, "cut"]    op 1639363
[966509,  430224, 617478, "cut"]    op 1639364
[935935,  352314, 711243, "cut"]    op 1639365
[1096651, 447143, 762180, "cut"]    op 1639366
[1087710, 526110, 782899, "cut"]    op 1639367
[1099730, 590905, 787986, "cut"]    op 1639369
[1104519, 615673, 796587, "cut"]    op 1639370
[1114618, 655784, 811493, "cut"]    op 1639371
[1163725, 463602, 779885, "cut"]    op 1639372
[1142665, 444154, 788776, "cut"]    op 1639373
[980672,  371856, 600060, "merge"]  op 1639374
```

Sandbox 648518346353621107 from 2023-05-29, before root 648518346352091576: seven extensions, the first at [194852, 240904, 73000] (op 1378).

### Do the before roots load?

- **2D:** Pyr's graphene layer asks for a root's supervoxels (`/node/{root}/leaves?bounds=`, `third_party/neuroglancer/datasource/graphene/backend.ts:215`), and that works for past roots. `leaves?stop_layer=2` answered 200 for all 12 before roots tested on `minnie65_public` and `pinky_nf_v2`.
- **3D:** the viewer asks for `/meshing/api/v1/table/{table}/manifest/{root}:0?verify=1&prepend_seg_ids=1` (`backend.ts:115`). It answered 200 for all 12. Coverage, meaning the share of the root's L2 chunks that have a mesh: 99.9% (1,410 of 1,412) and 99.9% (4,729 of 4,733) for two MICrONS before roots, and 93.1% (94 of 101) for a Sandbox before root. Today's cells have small gaps as well (97.7%, 337 of 345, for a current Sandbox cell), so old roots are no worse.
- **Which MICrONS card:** Pyr's main MICrONS card reads `minnie65_public_v117`. That table only knows roots that existed at v117 (2021-06-11 08:10 UTC): roots made later answer `401 root_id not valid at timestamp`. Of the best starts in the table above, 5 of 6 load on v117, but 864691135572849645 (2025) does not. Any past root loads on **MICrONS Live** (`minnie65_public`). The button should try v117 first and fall back to Live.

## 4. Filters, and how much each removes

Counts are edits left after each step, seen from before the first edit, for MICrONS cells 975583516, 120952088, 814060915, 646342383, 054934902, 774177531, then Sandbox 353621107, 352953185, 351558851, 353970541, 350659596:

| Step | MICrONS | Sandbox |
|---|---|---|
| Edits on the cell | 66, 22, 20, 5, 24, 19 | 20, 28, 5, 4, 7 |
| Without undone, redone or failed edits | 66, 22, 20, 5, 24, 19 | 20, 28, 5, 4, 7 |
| Only what the player can see from the before root | 48, 20, 3, 5, 1, 1 | 9, 3, 5, 2, 1 |
| Without tiny pieces (the piece joined or cut off is 1 L2 chunk or less) | 40, 19, 3, 5, 1, 1 | 9, 3, 5, 2, 1 |
| One place per kind within 3 µm (the Hunt's default tolerance) | **33, 17, 3, 5, 1, 1** | **7, 2, 3, 2, 1** |

- **Undone edits:** where `operation_details` gives `undo_operation_id` and `redo_operation_id` (the Sandbox), drop both the undo and the edit it undoes, with the same rules as `functions/pcg-history.js` (the practice reset). A split that removes an edge an earlier merge added counts as an undo too, and on MICrONS public that is the only check, because undos are not marked there. Neither check found one in the 11 lineages; on the Sandbox's practice edits they find 347 and 269.
- **Not visible:** this is the filter that matters most, because it decides which starting moment gives a good Hunt.
- **Tiny pieces:** these are spines and crumbs. The "1 L2 chunk" rule is crude, since one chunk is 2 × 2 × 20 µm on MICrONS. A volume rule from the L2 cache would be better where the cache exists.
- **Close places:** of two places of the same kind within the tolerance, keep the first. A cut and an extension close together both stay, because a gem only finds its own kind (`judgeDrop`).
- **Wide multi-point cuts** (clicks more than 3 µm apart) should be flagged for the admin to place by hand.

## 5. API calls that worked

Every call used the CAVE token from `~/.cloudvolume/secrets/cave-secret.json` as `Authorization: Bearer`, on `https://minnie.microns-daf.com` for both datasets. A cell took 17 to 83 calls and 2.2 to 17.9 seconds one after another; reading `leaves` once per edit was the slowest part.

| Call | Notes |
|---|---|
| `GET /segmentation/table/{table}/info` | No `api/v1` in this path. `scales[0].resolution` [8, 8, 40]; `graph.chunk_size` [256, 256, 512] (minnie), [512, 512, 128] (pinky_nf_v2). |
| `GET /segmentation/api/v1/table/{table}/root/{root}/tabular_change_log?filtered=false` | pandas columns `{col: {row: value}}`: operation_id, timestamp (ms), user_id, before_root_ids, after_root_ids, is_merge, user_name, user_affiliation. 0.4 to 4.9 s. |
| `GET .../operation_details?operation_ids=[1599284,...]` | A JSON list, 200 per call. Gives source_coords, sink_coords (base voxels), added_edges or removed_edges, roots, undo_operation_id, redo_operation_id, operation_status. In the browser add `int64_as_str=1`, as `src/practice.ts:247` does. |
| `GET .../node/{supervoxel}/root?timestamp={unix seconds}` | The soma's root before the first edit. |
| `POST .../roots?timestamp={unix seconds}`, body `{"node_ids": [...]}` | Returns `{"root_ids": [...]}`. Up to 1,000 per call. This is the visibility check. |
| `GET .../node/{root}/leaves?stop_layer=2` | L2 count of a piece or a cell. Works for past roots. On v117, a root made after v117 answers 401. |
| `GET /meshing/api/v1/table/{table}/manifest/{root}:0?verify=1&prepend_seg_ids=1` | Whether the before root's meshes load. |
| `POST .../is_latest_roots`, body `{"node_ids": [...]}` | Used to test roots on v117. |
| caveclient `materialize.query_table('proofreading_status_and_strategy', materialization_version=1926)` | The MICrONS list. caveclient 8.0.1 is installed here. |
| caveclient `annotation.get_annotation('eyewire_ii_cell_status_v2', ids)` on `pinky_sandbox` | Pyr's 4 Sandbox `complete` rows. |
| Supabase `GET /rest/v1/proofreading_tasks?select=id,segment_id,final_segment_id,...` and `GET /rest/v1/ew_cell_completions?dataset=eq.pinky_nf_v2` | Read with the publishable key. |

Calls that did not work:
- `lineage_graph`, `tabular_change_log` and `change_log` for 648518346355322263 on `pinky_nf_v2`: 500 `KeyError` (a `pinky_training6` root).
- `root_timestamps` on `minnie65_public_v117`: 405.
- **Meshing outage around 2026-10-26 19:58 to 20:02 UTC:** `/meshing/...` answered 502 and then 503 for every table, including `stroeh_mouse_retina` (live Pyr). It was back by 20:03.

The script behind every number here is `scripts/hunt-from-edits.py`. It is read only and never prints the token. Example:

```bash
python -I scripts/hunt-from-edits.py https://minnie.microns-daf.com minnie65_public 864691136814060915 --sv 97114570682278096 --other minnie65_public_v117 --out key.json
```

## 6. Recommended design: Admin Hub > Hunts > "Make a Hunt from a proofread cell"

**Built 2026-10-26 on `claude/hunt-from-edits`** (Ames approved the mockup). Code: `src/util/hunt_history_steps.ts` (the rules, tested by `scripts/hunt-history-steps.test.mjs`), `src/util/hunt_from_edits.ts` (the calls and the screen), `src/components/HuntFromEdits.vue` (in the editor), `HuntPlacesList.vue`, and `HuntPlacesBox.vue` (the box over the viewer, since the Admin Hub covers it). One change from the plan below: a cut that separated nothing (the graph made only the root kept) is left out with the undone edits. Second change (Ames 2026-10-26, after trying a real MICrONS cell: "places like this not even all of them are marked"): on MICrONS a cut's place is the whole piece cut off, its level 2 points from the L2 cache (rep_coord_nm) thinned to 2 µm, stored as a cloud { pts } on the place (functions/hunts.js placeDist, at most 600 points a place and 3000 a Hunt). On 864691136814060915 from Mar 26 one cut removed 722 graph chunks; the 11 cut places carry 788 points, and a gem 88 µm from where a piece was cut still finds it. The Sandbox graph has no L2 cache, so its cuts stay one spot. The plan as written before the build: The plan reuses what the editor already does, so it needs no server change, no SQL, and no new key format.

**Where:** in the editor's step 1 (The answer key), beside the link box: a root box and a button "Make from a proofread cell".

**Flow:**
1. **Input:** the admin pastes a final root, or selects a cell, on the dataset now open. For the soma, the browser looks up `pt_supervoxel_id` in the dataset's proofread table (MICrONS `proofreading_status_and_strategy`, Sandbox `neurons`). If there is none, the admin puts the crosshair in the soma and the supervoxel under it is used.
2. **Reading:** in the browser, with the admin's CAVE token, the same way `src/util/cell_history.ts` ("Watch it grow") already reads change logs. Parse with `parseBigJson` (18-digit ids). Use `filtered=false` (cell_history.ts leaves it out today, which means filtered).
3. **Choosing the start:** show one line per editing session, for example "Before 2025-03-26: 11 mergers, 1 extension (12 edits after)". Pick by default the session with the most places, up to 60. The admin can choose another.
4. **Filters:** apply the filters from section 4 and show the count each one removed. Flag wide cuts with "check this one".
5. **Output:** a link built like `keyLink()` (`src/components/HuntsAdminTab.vue:211`): the view on the right card (v117 if the before root loads there, else MICrONS Live; `pinky_nf_v2` for the Sandbox), segments = [before root], position at the soma, plus point layers named **Mergers** and **Extensions**. `openLink()` then runs as it does today: the editor ticks and types the layers by name, reads the key, the cells and the view, and runs the edge scan. The admin checks each place in the viewer, moves or deletes points, and saves. Players start from the same view with the annotation layers taken out, as now.
6. **Speed:** 2 to 18 seconds per cell. Most of that is one `leaves` call per edit for the tiny piece filter. A loading line per step is enough.

**Optional later:** run the script once over the 748 fully proofread MICrONS cells (about 10 s each, so about 2 hours) to make a shortlist, so the button can say "Suggest a cell" with each cell's best start and its count of places. The shortlist holds roots and counts only, never places.

## 7. Risks and open questions

- **The answer is one click away (must fix before players see one).** A Hunt cell made this way is an old ID. Pyr's segment button marks old IDs amber and its menu offers "update to the current ID" (`src/widgets/button_service.ts:171` and `:512`), which shows the proofread cell. That gives the answers away even though Hunt cells are frozen against edits (`src/hunt.ts:242`). Switch the marker and the update off for Hunt cells while a Hunt runs.
- **Anyone with the API can find the answers:** the before root leads to its latest root and its change log, with any public token. This seems acceptable for a game, but should be named.
- **Errors left in the cell:** "axon partially extended" means some missing extensions are real but not in the key, and a player who finds one gets a miss. Prefer the 748 fully extended cells, and use the existing Count it tool (a miss on a real error becomes a key place).
- **Chains of extensions:** only the first join of a chain is visible. A later start shows the rest, but then the earlier fixes are gone. One Hunt per start.
- **Sandbox learners:** leave out any cell whose edits after the start include Pyr players' practice edits or practice resets (user list, or edits from 2026). The Sandbox gives few and small keys, so MICrONS public should come first.
- **Meshing outages** like the one seen today would leave a Hunt cell without 3D for a few minutes, the same as any cell.

Data from this spike (per cell JSON with every edit) is in the session scratchpad and is not committed. Rerun the script to get it again.
