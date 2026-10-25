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
import { MEC_LAYERS } from './mec_layers';
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
export const layerKey = (name: string) => String(name).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
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
