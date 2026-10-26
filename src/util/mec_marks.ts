/**
 * The lab's four marks on an MEC cell (Ames 2026-10-24), as Highlight mode
 * places them. The lab's legend asks for these on every MEC cell:
 *   AIS        where the axon leaves the cell (none on some cell types)
 *   True End   a branch end where the branch naturally stops
 *   Can't Fix  a branch that should go on, but the next piece can't be found
 *   Hits Edge  a branch that runs into the end of the dataset
 * Each is a point in its own annotation layer. The names and colours are the
 * ones a claimed MEC cell opens with (MEC_LAYERS in mec_layers.ts), so a
 * mark placed here and a point placed by hand land in the same layer.
 *
 * The lab proofreaders start with the axons, and so does this: mark the AIS,
 * colour the axon (everything beyond the AIS), then mark each of its ends.
 */
import { currentDatasetTag } from '../datasets';
import { MEC_LAYERS, mecLayerKey } from './mec_layers';
import { useProofreadingBackendStore } from '../store';
import { Uint64 } from 'neuroglancer/util/uint64';

export interface MecKind { key: string; label: string; layer: string; color: string; hint: string; }
const KIND_INFO: { key: string; label: string; hint: string }[] = [
  { key: 'mec:ais', label: 'AIS', hint: 'Where the axon leaves the cell. Some cell types have none: then skip it.' },
  { key: 'mec:end', label: 'True End', hint: 'A branch end where the branch naturally stops.' },
  { key: 'mec:cantfix', label: "Can't Fix", hint: "A branch that should go on, but you can't find the next piece." },
  { key: 'mec:edge', label: 'Hits Edge', hint: 'A branch that reaches the end of the dataset.' },
];
/** The layer names and colours come from MEC_LAYERS, in the same order. */
const LAB_KINDS: MecKind[] = KIND_INFO.map((k, i) => ({ ...k, layer: MEC_LAYERS[i].name, color: MEC_LAYERS[i].color }));
/** The soma, with its coordinates (Ames 2026-10-24: "They also need a way to
 *  mark Soma with coordinates"). A point in the view's Soma layer, where
 *  Highlight already keeps a soma clicked for To soma and Beyond, so Color the
 *  axon finds it too. Its coordinates go in the sheet's Notes on completion. */
export const MEC_SOMA: MecKind = { key: 'mec:soma', label: 'Soma', layer: 'Soma', color: '#ffd24d',
  hint: 'The starting point is the nucleus, inside the soma. Confirm it, or Ctrl + click the soma to put the mark somewhere else.' };
/** In the order a cell is marked: soma, AIS, then the branch ends. */
export const MEC_KINDS: MecKind[] = [MEC_SOMA, ...LAB_KINDS];
export const MEC_AIS = LAB_KINDS[0];
export const MEC_EDGE = LAB_KINDS[3];
/** The axon, coloured beyond the AIS: a highlight layer of its own, so the
 *  lab's AIS layer holds only the AIS points it expects. */
export const AXON_LAYER = 'Axon';

export const isMec = () => currentDatasetTag() === 'pni_mec';

/** "True End" and "True End 🟢" are the same layer: letters only, any case
 *  (the same rule mec_layers.ts uses to avoid making a second one). */
export const layerKey = mecLayerKey;
/** Only on MEC: Retina cells open with layers of the same names (Soma, True
 *  End, Can't Fix, Hits Edge), which made their points glow there too
 *  (Ames 2026-10-25: "the annotation highlight thing is showing on all cells"). */
export const mecKindOfLayer = (name: string) => (isMec() ? MEC_KINDS.find(k => layerKey(k.layer) === layerKey(name)) : undefined);

/** The four layers in the view, by kind. */
export function mecLayers(): Map<MecKind, any> {
  const out = new Map<MecKind, any>();
  for (const managed of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (managed.archived) continue;
    const kind = mecKindOfLayer(managed.name);
    if (kind && !out.has(kind)) out.set(kind, managed);
  }
  return out;
}

/** How many points each layer holds, placed by Highlight or by hand. */
export function mecCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const k of MEC_KINDS) counts[k.key] = 0;
  for (const [kind, managed] of mecLayers()) {
    try { for (const ann of managed.layer?.localAnnotations ?? []) if (ann.type === 0) counts[kind.key]++; } catch { /* not loaded */ }
  }
  return counts;
}

/** The newest soma point in the view, in the view's own coordinates (the
 *  same units as the sheet's Starting XYZ Coords), rounded. */
export function somaXyz(): number[] | null {
  let last: number[] | null = null;
  try {
    for (const ann of mecLayers().get(MEC_SOMA)?.layer?.localAnnotations ?? []) {
      if (ann.type === 0 && ann.point) last = [0, 1, 2].map(i => Math.round(ann.point[i]));
    }
  } catch { /* not loaded */ }
  return last && last.every(Number.isFinite) ? last : null;
}

/**
 * The working cell's starting point: the sheet's Starting XYZ Coords, which
 * the Cell Library keeps as the claim's point. On MEC it is always the
 * nucleus, so always inside the soma (Ames 2026-10-24): the soma mark is a
 * confirmation of it, not a search. The working cell is the one the Cell
 * Library is on, else the player's one open MEC claim. Null if unknown.
 */
export function startXyz(): number[] | null {
  try {
    const backend = useProofreadingBackendStore();
    let id: number | null = null;
    try { id = Number(sessionStorage.getItem('nge_cl_working_task') || localStorage.getItem('nge_cl_working_task')) || null; } catch { /* private mode */ }
    const mine = backend.tasks.filter((t: any) => t.assigned_to === backend.userId && (t.status === 'assigned' || t.status === 'in_progress')
      && t.claim_point_x != null && String(t.dataset ?? 'pni_mec').startsWith('pni_mec'));
    const task: any = (id && backend.tasks.find((t: any) => t.id === id)) || (mine.length === 1 ? mine[0] : null);
    const p = task ? [task.claim_point_x, task.claim_point_y, task.claim_point_z].map(Number) : null;
    return p && p.every(Number.isFinite) ? p : null;
  } catch { return null; }
}
const samePoint = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
/** The soma mark: on the starting point, moved off it, or not placed. */
export function somaState(): { state: 'start' | 'moved' | 'none'; xyz: number[] | null } {
  const soma = somaXyz(), start = startXyz();
  if (!soma) return { state: 'none', xyz: null };
  return { state: start && samePoint(soma, start) ? 'start' : 'moved', xyz: soma };
}

/**
 * The marks on the cell, as a line for the lab's sheet when the cell is
 * completed: "Soma at the starting point. Marks: AIS 1, True End 12, Can't
 * Fix 2, Hits Edge 5". A soma moved off the starting point gives its own
 * coordinates instead. Empty off MEC, or when the view has none of the
 * layers. The marks themselves travel in the Final Link.
 */
export function mecMarkSummary(): string {
  if (!isMec() || !mecLayers().size) return '';
  const c = mecCounts();
  const soma = somaXyz(), start = startXyz();
  const somaLine = !soma ? '' : start && samePoint(soma, start) ? 'Soma at the starting point. ' : `Soma ${soma.join(', ')}. `;
  return somaLine + 'Marks: ' + LAB_KINDS.map(k => `${k.label} ${c[k.key]}`).join(', ');
}

/**
 * The segmentation volume's outer bounds in nanometres, [[x, y, z] low,
 * [x, y, z] high]: where the data ends. From the Hunt (src/hunt.ts
 * layerBoundsNm on the claude/hunt branch): the source's own voxel bounds
 * times its own scales, since the viewer's space can be far larger than the
 * data. Null if unknown.
 */
export function segBoundsNm(ml: any): number[][] | null {
  for (const ds of ml?.layer?.dataSources ?? []) {
    const ls = ds?.loadState;
    const inS = (ls?.dataSource?.modelTransform ?? ls?.transform?.value)?.inputSpace;
    const lo = inS?.bounds?.lowerBounds, hi = inS?.bounds?.upperBounds, sc = inS?.scales, names: string[] = inS?.names ?? [];
    if (!lo || !hi || !sc) continue;
    const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
    if (ix.some(i => i < 0)) continue;
    const L = ix.map(i => Number(lo[i]) * Number(sc[i]) * 1e9), H = ix.map(i => Number(hi[i]) * Number(sc[i]) * 1e9);
    if (L.every((v, k) => Number.isFinite(v) && Number.isFinite(H[k]) && H[k] > v)) return [L, H];
  }
  return null;
}
/**
 * Where the data ends: the part of space that every image and segmentation
 * layer covers (the tightest of their bounds). The segmentation's bounds
 * alone can be larger than the imaged volume (Ames 2026-10-24: "Find edge
 * isn't working" on MEC), and a cell is cut off where the imaging stops.
 */
export function dataBoundsNm(): number[][] | null {
  let lo: number[] | null = null, hi: number[] | null = null;
  const each: { name: string; bounds: number[][] }[] = [];
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    const type = ml?.layer?.type ?? ml?.layer?.constructor?.type;
    if (ml?.archived || (type !== 'image' && type !== 'segmentation')) continue;
    let b: number[][] | null = null;
    try { b = segBoundsNm(ml); } catch { /* not loaded */ }
    if (!b) continue;
    each.push({ name: ml.name, bounds: b });
    lo = lo ? lo.map((v, i) => Math.max(v, b![0][i])) : b[0].slice();
    hi = hi ? hi.map((v, i) => Math.min(v, b![1][i])) : b[1].slice();
  }
  lastBounds = { layers: each, used: lo && hi ? [lo, hi] : null };
  return lo && hi && lo.every((v, i) => hi![i] > v) ? [lo, hi] : null;
}
let lastBounds: { layers: { name: string; bounds: number[][] }[]; used: number[][] | null } | null = null;
// For checking from the console: what Pyr reads as the edge of the data.
try {
  (window as any).__ngeMecEdge = () => {
    const used = dataBoundsNm();
    const um = (b: number[][] | null) => b ? b[0].map((v, i) => `${'xyz'[i]} ${(v / 1000).toFixed(1)} to ${(b[1][i] / 1000).toFixed(1)} um`) : null;
    // The cells on screen, from their loaded meshes: where they actually reach.
    const cells: Record<string, string[] | null> = {};
    try {
      const seg = (window as any).viewer.layerManager.managedLayers.find((l: any) => !l.archived && l.layer?.type === 'segmentation');
      for (const id of seg?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments ?? []) {
        const root = id.toString();
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const rl of seg.layer.renderLayers ?? []) {
          const src = rl?.source;
          if (!src?.fragmentSource?.chunks || !src?.chunks) continue;
          const u = new Uint64(); if (!u.tryParseString(root)) continue;
          const key = `${u.low},${u.high}`;
          for (const fid of src.chunks.get(key)?.fragmentIds ?? []) {
            const vp: Float32Array | undefined = src.fragmentSource.chunks.get(src.getFragmentKey(key, fid).key)?.meshData?.vertexPositions;
            if (!vp) continue;
            for (let p = 0; p + 2 < vp.length; p += 3) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], vp[p + i]); hi[i] = Math.max(hi[i], vp[p + i]); }
          }
        }
        cells[root] = Number.isFinite(lo[0]) ? um([lo, hi]) : null;
      }
    } catch (e) { cells.error = [String(e)]; }
    let scales: number[] | null = null;
    try { scales = Array.from((window as any).viewer.coordinateSpace.value.scales as ArrayLike<number>).map(x => x / 1e-9); } catch { /* none */ }
    return { edge: um(used), layers: (lastBounds?.layers ?? []).map(l => ({ name: l.name, bounds: um(l.bounds) })), cells, viewerScalesNm: scales };
  };
} catch { /* no window */ }

/** The Hunt's rule: this close to the bounds is the edge of the dataset. */
export const EDGE_NM = 5000;

/**
 * Where a cell runs out of the data, read from its meshes on screen: the
 * Hunt's meshEdgeSpots (src/hunt.ts on the claude/hunt branch), for when the
 * server has no branch map. Vertices within marginNm of a face, grouped on a
 * grid and joined where they touch, one spot per place, in nanometres.
 * `pieces`/`loaded`: the cells' mesh pieces in all, and on hand now.
 */
export function meshEdgeSpots(roots: string[], bounds: number[][] | null, marginNm = EDGE_NM, binNm = 3000, countOnly = false): { spots: number[][]; pieces: number; loaded: number; closestNm: number } {
  /** closestNm: how near the cell comes to the edge anywhere, to say so. */
  const out = { spots: [] as number[][], pieces: 0, loaded: 0, closestNm: Infinity };
  if (!bounds || !roots.length) return out;
  const [lo, hi] = bounds;
  const bins = new Map<string, { n: number; x: number; y: number; z: number; i: number; j: number; k: number }>();
  // The mesh layer keys a cell by its id's low and high words (getObjectKey).
  const keyOf = (root: string) => { const u = new Uint64(); return u.tryParseString(root) ? `${u.low},${u.high}` : ''; };
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (ml?.layer?.type !== 'segmentation') continue;
    for (const rl of ml.layer.renderLayers ?? []) {
      const src = rl?.source;
      if (!src?.fragmentSource?.chunks || !src?.chunks || typeof src.getFragmentKey !== 'function') continue;
      for (const root of roots) {
        const key = keyOf(root);
        const manifest = key ? src.chunks.get(key) : undefined;
        if (!manifest?.fragmentIds) continue;
        for (const fid of manifest.fragmentIds) {
          out.pieces++;
          const frag = src.fragmentSource.chunks.get(src.getFragmentKey(key, fid).key);
          const vp: Float32Array | undefined = frag?.meshData?.vertexPositions;
          if (!vp) continue;
          out.loaded++;
          if (countOnly) continue;   // how much has loaded, not where
          for (let p = 0; p + 2 < vp.length; p += 3) {
            const x = vp[p], y = vp[p + 1], z = vp[p + 2];
            const d = Math.min(x - lo[0], hi[0] - x, y - lo[1], hi[1] - y, z - lo[2], hi[2] - z);
            if (d < out.closestNm) out.closestNm = d;
            if (!(d <= marginNm)) continue;
            const i = Math.floor(x / binNm), j = Math.floor(y / binNm), k = Math.floor(z / binNm);
            const bk = `${i},${j},${k}`;
            const b = bins.get(bk);
            if (b) { b.n++; b.x += x; b.y += y; b.z += z; } else bins.set(bk, { n: 1, x, y, z, i, j, k });
          }
        }
      }
    }
  }
  // Touching bins are one place: its spot is the middle of their vertices.
  const seen = new Set<string>();
  for (const [bk, b0] of bins) {
    if (seen.has(bk)) continue;
    seen.add(bk);
    let n = 0, sx = 0, sy = 0, sz = 0;
    const queue = [b0];
    while (queue.length) {
      const b = queue.pop()!;
      n += b.n; sx += b.x; sy += b.y; sz += b.z;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const nk = `${b.i + di},${b.j + dj},${b.k + dk}`;
        const nb = bins.get(nk);
        if (nb && !seen.has(nk)) { seen.add(nk); queue.push(nb); }
      }
    }
    if (n >= 8) out.spots.push([Math.round(sx / n), Math.round(sy / n), Math.round(sz / n)]);
  }
  out.spots = out.spots.slice(0, 200);
  return out;
}

// ── The edge of MEC's data, from the lab's image mask (Ames 2026-10-26: "got
// a mask!", "tissue mask / resin mask") ──────────────────────────────────────
// MEC's imaged area is not a box: a cell was cut off at y 2333.2 um, and the
// image mask there ends at y 2331.6 um, inside a segmentation box reaching
// 2380.9 um. The mask (the lab's alignment mask, 512 x 512 x 45 nm, one byte a
// voxel, 1 where there is image and 0 where there is none) is served from the
// lab's own server, gzipped, one 2048 x 2048 tile of a section per file
// (about 10 to 35 kB). A section missing from it is not "no image": the
// nearest section that is there is read instead. The resin mask in the same
// view (where there is no tissue) is not used: the end of the image is where a
// branch can't be followed any further.
export const MEC_IMAGE_MASK = {
  base: 'https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/masks/v2/warped_match_offsets_512nm/512_512_45',
  resNm: [512, 512, 45],
  tile: 2048,
  size: [10240, 10240, 9949],
};
const maskTiles = new Map<string, Promise<Uint8Array | null>>();
/** One tile of one section: the bytes, or null when the mask has none. */
function maskTile(tx: number, ty: number, z: number): Promise<Uint8Array | null> {
  const { base, tile, size } = MEC_IMAGE_MASK;
  const key = `${tx},${ty},${z}`;
  let p = maskTiles.get(key);
  if (!p) {
    const x0 = tx * tile, y0 = ty * tile;
    const url = `${base}/${x0}-${Math.min(x0 + tile, size[0])}_${y0}-${Math.min(y0 + tile, size[1])}_${z}-${z + 1}`;
    p = fetch(url).then(async r => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
    maskTiles.set(key, p);
    // Each tile is 4 MB unpacked: keep only the last few.
    if (maskTiles.size > 12) maskTiles.delete(maskTiles.keys().next().value as string);
  }
  return p;
}

/** How much of a cell's mesh has loaded: its pieces in all, and on hand. */
export function cellMeshLoad(root: string): { pieces: number; loaded: number } {
  const { pieces, loaded } = cellVertices(root);
  return { pieces, loaded };
}
/** How much of the (2w+1)-pixel square around (x, y) the mask says is empty,
 *  reading every `step`th pixel; beyond the mask's own sides counts as empty. */
function emptyShare(tiles: Map<string, Uint8Array | null>, x: number, y: number, w: number, step: number): number {
  const { tile, size } = MEC_IMAGE_MASK;
  let empty = 0, all = 0;
  for (let wy = y - w; wy <= y + w; wy += step) for (let wx = x - w; wx <= x + w; wx += step) {
    all++;
    if (wx < 0 || wy < 0 || wx >= size[0] || wy >= size[1]) { empty++; continue; }
    const t = tiles.get(`${Math.floor(wx / tile)},${Math.floor(wy / tile)}`);
    if (t && t[(wy % tile) * tile + (wx % tile)] === 0) empty++;
  }
  return all ? empty / all : 0;
}

/**
 * For checking from the console: each Hits Edge mark in view, and what the
 * mask says around it (its section, the nearest empty pixel, and how empty
 * the 8 um and 40 um squares around that pixel are). Ames runs
 * JSON.stringify(await __ngeMecEdgeWhy()) and sends the result.
 */
async function edgeWhy() {
  const { resNm, tile, size } = MEC_IMAGE_MASK;
  const out: any[] = [];
  const edge = mecLayers().get(MEC_EDGE);
  for (const ann of edge?.layer?.localAnnotations ?? []) {
    if (ann.type !== 0 || !ann.point) continue;
    // Points are in the viewer's units (16, 16, 45 nm on MEC); the mask is 512, 512, 45.
    let scales = [16, 16, 45];
    try { scales = Array.from((window as any).viewer.coordinateSpace.value.scales as ArrayLike<number>).map(v => v / 1e-9); } catch { /* default */ }
    const nm = [0, 1, 2].map(i => ann.point[i] * scales[i]);
    const px = Math.floor(nm[0] / resNm[0]), py = Math.floor(nm[1] / resNm[1]), z = Math.round(nm[2] / resNm[2]);
    const tiles = new Map<string, Uint8Array | null>();
    for (const dx of [-60, 0, 60]) for (const dy of [-60, 0, 60]) {
      const tx = Math.floor((px + dx) / tile), ty = Math.floor((py + dy) / tile), k = `${tx},${ty}`;
      if (!tiles.has(k) && tx >= 0 && ty >= 0) tiles.set(k, await maskTile(tx, ty, z));
    }
    let near: number[] | null = null;
    for (let d = 0; d <= 20 && !near; d++) for (let dy = -d; dy <= d && !near; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) { near = [x, y]; break; }
      const t = tiles.get(`${Math.floor(x / tile)},${Math.floor(y / tile)}`);
      if (t && t[(y % tile) * tile + (x % tile)] === 0) { near = [x, y]; break; }
    }
    out.push({
      um: nm.map(v => +(v / 1000).toFixed(1)), section: z, sectionInMask: !!tiles.get(`${Math.floor(px / tile)},${Math.floor(py / tile)}`),
      nearestEmptyUm: near ? +(Math.hypot(near[0] - px, near[1] - py) * resNm[0] / 1000).toFixed(1) : null,
      empty8um: near ? +emptyShare(tiles, near[0], near[1], 8, 1).toFixed(2) : null,
      empty40um: near ? +emptyShare(tiles, near[0], near[1], 40, 2).toFixed(2) : null,
      by: String(ann.description ?? ''),
    });
  }
  return out;
}
try { (window as any).__ngeMecEdgeWhy = edgeWhy; } catch { /* no window */ }

/** Every vertex of a cell's meshes on screen, in nanometres, and how much of
 *  the cell has loaded. */
function cellVertices(root: string): { verts: Float32Array[]; pieces: number; loaded: number } {
  const out = { verts: [] as Float32Array[], pieces: 0, loaded: 0 };
  const u = new Uint64();
  if (!u.tryParseString(root)) return out;
  const key = `${u.low},${u.high}`;
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (ml?.layer?.type !== 'segmentation') continue;
    for (const rl of ml.layer.renderLayers ?? []) {
      const src = rl?.source;
      if (!src?.fragmentSource?.chunks || !src?.chunks || typeof src.getFragmentKey !== 'function') continue;
      for (const fid of src.chunks.get(key)?.fragmentIds ?? []) {
        out.pieces++;
        const vp: Float32Array | undefined = src.fragmentSource.chunks.get(src.getFragmentKey(key, fid).key)?.meshData?.vertexPositions;
        if (vp) { out.loaded++; out.verts.push(vp); }
      }
    }
  }
  return out;
}

/**
 * Where a cell reaches the end of MEC's data: the parts of its mesh within
 * reachNm of a place the image mask says has no image (in the section the
 * part is in, read every `everySections`), or within EDGE_NM of the top or
 * bottom of the stack. Neighbouring parts are one place: one spot each, in
 * nanometres. `pieces`/`loaded`: the cell's mesh pieces in all, and on hand.
 */
let lastEdgeStats: any = null;
try { (window as any).__ngeMecEdgeDebug = () => lastEdgeStats; } catch { /* no window */ }
export async function maskEdgeSpots(root: string, zBoundsNm: number[] | null, reachNm = 2000, binNm = 2000, everySections = 20,
                                    stillWanted: () => boolean = () => true,
                                    onProgress?: (done: number, total: number) => void): Promise<{ spots: number[][]; pieces: number; loaded: number }> {
  const { verts, pieces, loaded } = cellVertices(root);
  const out = { spots: [] as number[][], pieces, loaded };
  // What happened at each step, for window.__ngeMecEdgeDebug().
  const st = { parts: 0, partsAtTopOrBottom: 0, sections: 0, unknownTiles: 0, zeroNear: 0, looksOutside: 0, rejectedByNeighbours: 0, marked: 0,
    cellUm: null as string[] | null, maskZ: [] as number[] };
  lastEdgeStats = st;
  if (!loaded) return out;
  const { resNm, tile, size } = MEC_IMAGE_MASK;
  // The cell in 2 um parts: the middle of each part's vertices.
  const bins = new Map<string, { n: number; x: number; y: number; z: number; i: number; j: number; k: number; edge?: boolean }>();
  for (const vp of verts) {
    for (let p = 0; p + 2 < vp.length; p += 3) {
      const x = vp[p], y = vp[p + 1], z = vp[p + 2];
      const i = Math.floor(x / binNm), j = Math.floor(y / binNm), k = Math.floor(z / binNm);
      const bk = `${i},${j},${k}`;
      const b = bins.get(bk);
      if (b) { b.n++; b.x += x; b.y += y; b.z += z; } else bins.set(bk, { n: 1, x, y, z, i, j, k });
    }
  }
  // Group the parts by the mask section that is read for them.
  const bySection = new Map<number, typeof bins extends Map<string, infer B> ? B[] : never>();
  for (const b of bins.values()) {
    b.x /= b.n; b.y /= b.n; b.z /= b.n;
    st.parts++;
    if (zBoundsNm && (b.z - zBoundsNm[0] <= EDGE_NM || zBoundsNm[1] - b.z <= EDGE_NM)) { b.edge = true; st.partsAtTopOrBottom++; continue; }
    const s = Math.round(b.z / resNm[2] / everySections) * everySections;
    const list = bySection.get(s);
    if (list) list.push(b); else bySection.set(s, [b]);
  }
  const r = Math.ceil(reachNm / resNm[0]);
  const sections = [...bySection.keys()];
  // A few sections at a time, so the tiles in hand stay few.
  // The mask has holes inside the tissue (56 small ones near one cell, and
  // larger patches, Ames: "it marked a ton of points inside", then "no" to
  // 8 um). A 0 counts only when the 40 um square around it is mostly empty, as
  // it is past the real edge: there 47% at least and about half as a rule, in
  // the holes 26% at most (section 4667, 2026-10-26). Read every 2nd pixel.
  const W = 40, STEP = 2, EMPTY = 0.38, AGREE = 10;
  const outside = new Map<string, boolean>();
  for (let at = 0; at < sections.length; at += 3) {
    onProgress?.(at, sections.length);
    if (!stillWanted()) return out;
    await Promise.all(sections.slice(at, at + 3).map(async s => {
      const list = bySection.get(s)!;
      // The nearest section the mask has, up to five either way.
      const tileOf = async (tx: number, ty: number, at = s) => {
        for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
          const z = at + d;
          if (z < 0 || z >= size[2]) continue;
          const t = await maskTile(tx, ty, z);
          if (t) return t;
        }
        return null;
      };
      // The tiles this section needs, fetched first, then every part checked.
      const need = new Set<string>();
      for (const b of list) {
        const px = Math.floor(b.x / resNm[0]), py = Math.floor(b.y / resNm[1]);
        for (const x of [px - r - W, px, px + r + W]) for (const y of [py - r - W, py, py + r + W]) {
          if (x >= 0 && y >= 0 && x < size[0] && y < size[1]) need.add(`${Math.floor(x / tile)},${Math.floor(y / tile)}`);
        }
      }
      const tiles = new Map<string, Uint8Array | null>();
      await Promise.all([...need].map(async k => { const [tx, ty] = k.split(',').map(Number); tiles.set(k, await tileOf(tx, ty)); }));
      const found: { b: (typeof list)[number]; x: number; y: number }[] = [];
      for (const b of list) {
        const px = Math.floor(b.x / resNm[0]), py = Math.floor(b.y / resNm[1]);
        let touches: number[] | false = false;
        for (let dy = -r; dy <= r && !touches; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = px + dx, y = py + dy;
          if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) { touches = [Math.max(0, Math.min(x, size[0] - 1)), Math.max(0, Math.min(y, size[1] - 1))]; break; }
          const t = tiles.get(`${Math.floor(x / tile)},${Math.floor(y / tile)}`);
          if (!t) { st.unknownTiles++; continue; }   // nothing known here
          if (t[(y % tile) * tile + (x % tile)] !== 0) continue;
          // Is this the outside, or a hole in the tissue?
          const ok = `${s},${x},${y}`;
          let isOut = outside.get(ok);
          if (isOut === undefined) {
            isOut = emptyShare(tiles, x, y, W, STEP) >= EMPTY;
            outside.set(ok, isOut);
          }
          st.zeroNear++;
          if (isOut) { touches = [x, y]; break; }
        }
        if (touches) found.push({ b, x: touches[0], y: touches[1] });
      }
      // A damaged section can be mostly empty inside the tissue (section 5480
      // is 93% empty at one soma, Ames: "nope", a line of marks across a cell
      // at one depth). The real edge stays from section to section: the same
      // place must look like the outside AGREE sections above and below too.
      for (const f of found) {
        let agree = true;
        for (const at of [s - AGREE, s + AGREE]) {
          if (at < 0 || at >= size[2]) continue;
          const near = new Map<string, Uint8Array | null>();
          for (const x of [f.x - W, f.x + W]) for (const y of [f.y - W, f.y + W]) {
            if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) continue;
            const k = `${Math.floor(x / tile)},${Math.floor(y / tile)}`;
            if (!near.has(k)) near.set(k, await tileOf(Math.floor(x / tile), Math.floor(y / tile), at));
          }
          if (![...near.values()].some(Boolean)) continue;   // nothing known there
          if (emptyShare(near, f.x, f.y, W, STEP) < EMPTY) { agree = false; break; }
        }
        st.looksOutside++;
        if (agree) f.b.edge = true; else st.rejectedByNeighbours++;
      }
    }));
  }
  // Touching parts are one place: its spot is the middle of their parts.
  const seen = new Set<string>();
  for (const [bk, b0] of bins) {
    if (!b0.edge || seen.has(bk)) continue;
    seen.add(bk);
    let n = 0, sx = 0, sy = 0, sz = 0;
    const queue = [b0];
    while (queue.length) {
      const b = queue.pop()!;
      n++; sx += b.x; sy += b.y; sz += b.z;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const nk = `${b.i + di},${b.j + dj},${b.k + dk}`;
        const nb = bins.get(nk);
        if (nb?.edge && !seen.has(nk)) { seen.add(nk); queue.push(nb); }
      }
    }
    out.spots.push([Math.round(sx / n), Math.round(sy / n), Math.round(sz / n)]);
  }
  out.spots = out.spots.slice(0, 100);
  st.sections = sections.length;
  st.marked = out.spots.length;
  {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const b of bins.values()) for (const [i, v] of [b.x, b.y, b.z].entries()) { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }
    st.cellUm = [0, 1, 2].map(i => `${'xyz'[i]} ${(lo[i] / 1000).toFixed(1)} to ${(hi[i] / 1000).toFixed(1)}`);
    st.maskZ = zBoundsNm ? zBoundsNm.map(v => +(v / 1000).toFixed(1)) : [];
  }
  return out;
}
