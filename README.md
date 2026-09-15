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

Where the API lives — same precedence as the Candela queue client
(`src/merge_review/mergeQueueClient.ts`):

1. `window.AUTOPROOF_API = "https://<host>/autoproof"` (runtime, no trailing slash)
2. `autoproof_api` in `config/ng-extend.json` (build time; the deploy workflow patches
   it from the `AUTOPROOF_API` repository variable)
3. `http://localhost:8090` (local dev default)

Root ids are strings end to end — they exceed 2^53, so the API serialises them as
strings and the client never `Number()`s one.
