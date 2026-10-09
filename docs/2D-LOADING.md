# 2D image loading: causes, measurements and fixes

Written 2026-10-09 from the investigation that followed `HANDOFF-2d-loading.md`
("investigate why 2D is loading slowly across the site in many places"). Ames
named the Sandbox and Retina. Nik (on Firefox, two game tabs open) is the
reporting player.

## How to measure

`scripts/measure-2d-loading.cjs` drives a visible Chromium through Playwright
(gstack's `playwright-core`, browsers in `%LOCALAPPDATA%\ms-playwright`), loads
a `#!state`, polls every image layer's `layerChunkProgressInfo`, and reports
when the viewer appeared, when the first visible chunk arrived and when every
visible chunk was present for 500 ms ("full"), with requests by host and by
scale, bytes, concurrency, failures and main thread long tasks.

```bash
node scripts/measure-2d-loading.cjs --base http://localhost:3490/ --state sandbox-image --label sandbox --after "z+1,z+16,x+700" --throttle 20000,50 --out results.jsonl --shots shots
```

States: `sandbox-image`, `retina-image`, `sandbox-full`, `retina-full`, `none`
(the build's default). `--scale` overrides crossSectionScale, `--after` runs
steps (one slice, the next 16-slice slab, a 700 px pan, `zoom*2`),
`--throttle` emulates a link (it does throttle the worker's fetches),
`--companion` opens a second tab, `--fake-login` removes the login overlay for
screenshots, `--prefetch false` and `--concurrent N` set neuroglancer's own
state knobs. A hidden tab never draws, so keep the window visible. Plain
neuroglancer at neuroglancer-demo.appspot.com or spelunker.cave-explorer.org
is the control that separates the data from the game.

`PORT=3490 npm run dev-server-win` picks the dev server port (several
checkouts run dev servers at once).

## What the data looks like

| | Sandbox (pinky EM) | Retina |
|---|---|---|
| Source | bossdb S3, HTTP/1.1 only | GCS, HTTP/2 |
| Chunks | 512x512x16 raw uint8, gzip at rest (3.7 MB each, 11% saving), at all nine scales | 128x128x16, sharded; JXL at 16, 32, 64 nm, JPEG at 128, 256 nm |
| 16 nm level | | lossless JXL, 174 KB per chunk |
| 64 nm level | | 48 to 70 KB per chunk |

The game matches plain neuroglancer for the same state: the costs are in the
data layout and in how the fork asks for it.

## Causes, pinned to code

1. **The whole pyramid was fetched as a fallback.**
   `third_party/neuroglancer/sliceview/base.ts` `filterVisibleSources` walks
   from the coarsest scale toward the target and keeps every scale walked as a
   visible fallback, with the coarsest given the highest download priority.
   On the Sandbox each of the nine scales stores 3.7 MB chunks, so a 1600x835
   view asked for 28 chunks and 100 MB, of which 16 chunks and 55 MB were
   fallbacks the screen cannot resolve, queued ahead of the fine chunks.
2. **Prefetch crowded the link.** `sliceview/backend.ts` predicted up to six
   slabs ahead and four behind at every visible scale (cap 32 per direction),
   a leftward pan was never skipped (no `Math.abs`), and within the PREFETCH
   tier every coarse chunk six slabs away outranked the finest chunk of the
   next slab. A slab crossing fired 200 to 500 requests (15 to 56 MB). The
   100-slot pool only cancels prefetch when it is full; on the Sandbox it never
   fills, so stale 3.7 MB prefetch streams kept downloading: a half-screen pan
   at 20 Mbps waited about 50 s behind them.
3. **Failures were silent and permanent.** A network error (fetch rejects,
   reported as status 0) was treated as "not found" on unsharded chunks and on
   the Retina shard-index read, so the chunk was drawn as an opaque fill
   block, counted as loaded, and never retried; a failure on the minishard
   index or the data range left the chunk FAILED for the session
   (`chunk_manager/backend.ts`, `util/http_request.ts`).
4. **Meshes could cancel image downloads.** Mesh manifests (+100) and
   fragments (+50) outrank 2D image chunks in the same tier, and a full pool
   cancels the lowest in-flight download, so a 3.7 MB chunk could be refetched
   from zero.
5. **The first Retina chunk waited for a 3 MB worker script.** The minishard
   index is gzip and was inflated in the async computation pool, whose bundle
   carried the 1.7 MB JPEG XL decoder as base64; the first pool worker's start
   sat on the critical path (0.16 to 0.78 s per cold load).
6. **A saved view can carry `crossSectionRenderScale` above 1**, which draws
   the image at a coarser level, counts as fully loaded and never sharpens
   (the practice views had this; `src/practice.ts` fixed it there only).

Things that were checked and are not causes: the game's own main-thread work
(long tasks total about 1 s, no duplicate chunk requests from the panel
rebuilds), the GCS JSON API host versus the XML host, the random cache-busting
query (every image chunk on gs:// datasets is a sharded range request, which
Chrome must fetch with no-store because of Chromium bug 969828), spreading
Sandbox requests over several S3 hostnames (this link is not connection bound
and a slow link gains nothing), and releasing the download slot during JXL
decode (the pool never fills at the overview zoom).

## Measured before the fixes

Dev server, cold cache, 1600x835 panel, this desktop (fast link), one run per
cell. "full" is the time until every visible chunk is present.

| View | full | per slab crossing | per 700 px pan | bytes per view |
|---|---|---|---|---|
| Sandbox, fast link | 8.4 s | 5.8 s | 18.5 s | 100 MB |
| Sandbox, 20 Mbps | 46.9 s | 43.7 s | 69 s (production) | 100 MB |
| Retina zoom 3 (64 nm), fast link | 3.3 s | 1.3 s | 0.9 s | 6.5 MB |
| Retina zoom 3, 20 Mbps | 9.1 s | 3.7 s | 2.9 s | 6.5 MB |
| Retina zoom 1 (16 nm), 20 Mbps | 16.1 s | 10.4 s | 7.7 s | 24.5 MB |

A second game tab loading the Sandbox beside Retina added about 0.5 s to the
Retina view on this link.

## The fixes (this branch)

All in `third_party/neuroglancer` (the vendored fork) unless noted, each
marked "Pyr" in the code with a comment that says why.

- **Byte-aware fallback pyramid** (`sliceview/base.ts` `selectFallbackScales`,
  flag plumbed through `sliceview/renderlayer.ts`, `sliceview/backend.ts` and
  `sliceview/volume/image_renderlayer.ts`): an image layer keeps the target
  scale, at most one coarser scale whose uncompressed chunk exceeds 1 MiB, and
  the coarsest scale (one clipped chunk that covers the panel and paints
  first). Cheap pyramids (Retina) are unchanged; segmentation layers keep
  their full pyramid. Sandbox: 28 chunks and 100 MB per view became 17 and
  60 MB.
- **Prefetch waits for the visible set** (`chunk_manager/backend.ts`): no
  PREFETCH download starts at a queue level while a VISIBLE one is in flight,
  and when a VISIBLE chunk is promoted the speculative downloads still in
  flight are cancelled unless they have become visible themselves.
- **Prefetch is bounded** (`sliceview/backend.ts`): two slabs or chunk
  columns per direction instead of 32, a negative velocity is skipped like a
  positive one, and prefetch priority ranks the nearest slab first.
- **In-flight visible downloads are never cancelled** for another request
  (`chunk_manager/backend.ts` `evictableDownloads`).
- **Transient failures are retried** (`util/http_request.ts`): a network
  error or a 5xx on a GET gets three more tries with 0.5 to 4 s backoff,
  including a body that dies mid-transfer; cancellations are never retried.
  A chunk that still ends FAILED is tried again after 10 s while it is wanted
  (`chunk_manager/backend.ts`, `chunk_manager/generic_file_source.ts`).
- **The minishard index is inflated with DecompressionStream** in the chunk
  worker (`datasource/precomputed/backend.ts`), with the pool as fallback.
- **wasm modules are emitted as files** (`scripts/patch-esbuild-loaders.js`):
  the async computation bundle went from 3.2 MB to 0.8 MB and the chunk
  worker from 0.94 MB to 0.75 MB; each decoder fetches its module on first
  use and the browser caches it.
- **Game: detail is clamped to 1** on every image layer whenever a layer
  appears or the value changes (`src/store.ts` `initializeWithViewer`).

## Measured after the fixes

Same dev server, same states, same desktop, one run per cell, measured
2026-10-09 with the fixes above (before / after).

| View | full | per slab crossing | per 700 px pan | requests and bytes per view |
|---|---|---|---|---|
| Sandbox, fast link | 8.4 s / 5.1 s | 5.8 s / 1.3 s | 18.5 s / 1.5 s | 29 and 100 MB / 18 and 60 MB |
| Sandbox, 20 Mbps | 46.9 s / 30.3 s | 43.7 s / 23.6 s | | same |
| Retina zoom 3, fast link | 3.3 s / 2.9 s | 1.3 s / 0.9 s | 0.9 s / 0.45 s | 103 and 6.5 MB, unchanged |
| Retina zoom 3, 20 Mbps | 9.1 s / 8.8 s | 3.7 s / 3.3 s | 2.9 s / 1.3 s | unchanged |
| Retina zoom 1, 20 Mbps | 16.1 s / 16.2 s | 10.4 s / 10.5 s | 7.7 s / 4.1 s | 186 and 24.5 MB, unchanged |

Requests fired by a Retina slab crossing on the fast link fell from 388 (29 MB)
to 258 (21 MB), and by a pan from 189 to 164. The Retina cold view and slab
crossing at tracing zoom are bound by the 24.5 MB of lossless 16 nm data and
do not move; only the data side can.

## What only the data can fix

Every client fix together leaves the Sandbox at about 60 MB per view, 20 s or
more at 20 Mbps, because every chunk the screen can resolve is 3.7 MB. The
lever is a 2D-friendly copy of the pinky EM: JPEG quality 85, 512x512x4
chunks, the 8 nm level as mip 0, cut to the pinky_nf_v2 segmentation box
(x 36192 to 122118, y 30558 to 81628, z 21 to 2157 at 4 nm), unsharded, on a
public GCS bucket referenced as `precomputed://https://storage.googleapis.com/...`
so the browser cache works. Estimated 1 TB, one to three hours on a 56-core
GCE VM in the bucket's region, about 4.6 MB per cold view and 1.1 MB per
slice (today 100 MB and 6.5 MB). Igneous commands are in the session's
data-recipes notes.

Retina at tracing zoom draws the lossless 16 nm level (174 KB per chunk,
24.5 MB per view, 10 s per slab crossing at 20 Mbps). A JPEG quality 85 copy
of that level in 256x256x8 chunks would cut it to about 8.8 MB per view and
a third of the requests. Whether the 16 nm level may be lossy is the dataset
owners' decision.

## Open items

- The curated production start states (nglstate 5631012797153280 and
  5672815546073088) need a login to read; every Sandbox number above uses the
  build's default state (position [73631, 63170, 344], crossSectionScale 1.1).
- No run had a claimed cell with meshes (the graphene layers need a login), so
  the mesh-versus-image contention was not measured.
- Firefox was not measured (Playwright's Firefox build is not installed).
- Phones get the 3D layout with no slice view, so none of this applies there.
