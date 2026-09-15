Based on https://github.com/google/neuroglancer/tree/master/examples/dependent-project
but using git submodule instead of npm because of https://github.com/google/neuroglancer/issues/172

Installation Instructions

```console
$ npm i
$ npm run dev-server
```

## Auto-proofread panel (MERGER FREE)

The review UI can submit a root id to the auto-proofread pipeline
(`CAVEconnectome/Candela` → `autoproof-pipeline/`, Flask on `:8090`), watch the job run, and load its
`candidates.json` straight into the review — no file import needed.

- Welcome overlay: type a root id, press Enter or **Run auto-proofread**. The status
  line shows the job, a coloured status dot (queued → preprocessing → inferring →
  done/failed/cancelled), **Cancel** while it runs, **Retry** on failure. When the job
  finishes and nothing is loaded yet, the results load automatically.
- **Run** first picks up the job that already exists for that root (this browser
  remembers it under `localStorage["autoproof_job_<rootId>"]`, else the API's
  `GET /roots/<rootId>/jobs` is asked) — so after a page reload, Run on the same id
  resumes the earlier job (a finished one loads straight into the review) instead of
  queueing a duplicate. Press **Run** again on the same root to submit a fresh job.
- Top bar (compact): the same control, prefilled with the loaded neuron's root; when
  a bundle for a root comes in (file import), that root's existing job is picked up
  the same way, and once it is done a **Load results** button swaps the bundle in.
- The bundle built from pipeline results carries the manifest's `datastack` (the
  table the job was computed on), so the segmentation layer opens the same one the
  ids belong to.

### Loading results: bundle first

`loadAutoproofResults()` asks `GET /jobs/<job>/roots/<root>/bundle` first
(`fetchAutoproofBundle` in `src/merge_review/autoproofClient.ts`). That is the
review bundle the inference stage writes in this UI's own format:

- `neuron.latest_root_id`, `neuron.datastack` (segmentation source) and
  `neuron.anchor_sv` — the supervoxel the preprocess stage resolved on the neuron.
  The store adopts it as the cut-queue anchor as soon as the bundle activates
  (status line "Anchor set from pipeline (supervoxel …)"; the Decision panel shows
  `Anchor: set ✓ (from pipeline)`). Hovering the nucleus and pressing **A** still
  overrides it. No position is known for an adopted anchor, so the white entrance
  route only appears after a re-pick.
- one window per candidate, with `tokens` (`pos_rel_um` in µm relative to
  `center_um`, one integer `label` per point) when the scorer produced them, so
  **SPLIT WHICH** / **⏱ Queue cut** work on a pipeline window exactly like on a
  classic bundle window: marking a window **YES** and moving on (or pressing Queue
  cut with clusters highlighted) posts the split to Candela's cut queue.
- `pipeline.job_id` / `model_version` / `params_hash` as provenance.

A 404 — results written before `bundle.json` existed, or an older API — falls back
to `GET …/manifest` + `GET …/candidates` as before (`bundleFromPipelineCandidates`);
a candidate that carries `tokens` passes them through on that path too.

## Decisions sync (Candela `review_decisions`)

Every decision (merge verdict, split clusters, notes) is written to
`localStorage["decisions.<root>"]` first, as always. It is then mirrored into the
Candela service next to the cut queue (`src/merge_review/decisionsClient.ts`):

- mutations mark the touched fields dirty; 500 ms after the last one, ONE
  `PUT /candela/api/v1/datastack/<ds>/decisions` goes out with
  `{source_root_id, session_id, autoproof_job_id?, decisions: {window_id: {merge?,
  split?, notes?}}}` — only the dirty fields, `null` for a field the reviewer
  cleared. `autoproof_job_id` is the pipeline job the loaded bundle came from.
  The reviewer is whoever the bearer token identifies (server side).
- when a bundle activates, the store `GET`s the server's decisions for that root
  and fills in windows that have no local decision (local always wins; the newest
  row per window when several reviewers recorded one).
- fire-and-forget: no spinner; the Decision panel's anchor row shows
  `saving… / saved / not synced`; the first failure per session shows a status
  message, later ones only log. Failed fields stay dirty and go out with the next
  flush; `pagehide` flushes anything still pending with `keepalive`.

Root ids are strings on the wire (they exceed 2^53); the server `int()`s them.

## Where the APIs live

Same precedence for the Candela queue/decisions client
(`src/merge_review/mergeQueueClient.ts`) and the autoproof client:

1. runtime globals set before the app loads:
   `window.CANDELA_API`, `window.CANDELA_DATASTACK`, `window.AUTOPROOF_API`
   (no trailing slash)
2. `candela_api` / `candela_datastack` / `autoproof_api` in `config/ng-extend.json`
   as baked in at build time — **environment variables override the file**:

   ```console
   $ CANDELA_API=http://localhost:8080/candela \
     CANDELA_DATASTACK=minnie65_phase3_v1 \
     AUTOPROOF_API=http://localhost:8090 \
     npm run dev-server        # or: npm run build
   ng-extend config: candela_api = http://localhost:8080/candela (from $CANDELA_API)
   …
   ```

   `webpack.config.js` merges `CANDELA_API → candela_api`,
   `CANDELA_DATASTACK → candela_datastack`, `AUTOPROOF_API → autoproof_api` into the
   `CONFIG` global (a set variable wins, an unset one leaves the file's value). The
   deploy workflow passes the repository variables the same way; `demo/run_local.sh`
   uses it to point the dev server at the local stack.
3. local dev defaults: `http://localhost:8080/candela` (datastack
   `minnie65_phase3_v1`) and `http://localhost:8090`.

Root ids are strings end to end — they exceed 2^53, so the API serialises them as
strings and the client never `Number()`s one.
