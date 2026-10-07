/**
 * A point inside each cell, remembered as you work (Ames 2026-10-07, for the
 * Batch Processor: "save coords within each cell along the way so when you
 * batch complete it auto applies them").
 *
 * Marking a cell complete needs a point that is INSIDE that cell: CAVE works
 * out which cell a mark belongs to from the point. The batch wizard used to
 * make you walk every cell and place the crosshairs by hand. But while you
 * proofread you click on your cells all the time, and each of those clicks
 * is a point inside one.
 *
 * What is kept: whenever you click in the 2D image, and whenever the
 * crosshairs come to rest, the spot is looked up in the image data already on
 * screen. If it lies inside a cell, the spot and the small piece of the cell
 * there (its supervoxel) are remembered. Nothing is asked of any server.
 *
 * What is trusted: nothing, until it is checked. Edits change which cell a
 * piece belongs to, so when points are asked for, every remembered piece is
 * looked up again on the graph server (its CURRENT cell), and a point is
 * handed over only for a cell it is inside right now. That is the same check
 * the Complete button makes for the crosshairs.
 *
 * Kept for this tab and this dataset (sessionStorage), newest first, capped.
 */
import { currentSegLayer } from '../datasets';
import { getRootFromSupervoxel } from '../widgets/pcg_service';

interface Spot { sv: string; pos: [number, number, number]; root: string; at: number; }

const KEY = 'nge-cell-points-v1';
const MAX_SPOTS = 800;

let dataset = '';
let spots = new Map<string, Spot>();        // by supervoxel
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(name: string) {
  dataset = name;
  spots = new Map();
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    for (const s of (all?.[name] ?? []) as Spot[]) {
      if (s && typeof s.sv === 'string' && Array.isArray(s.pos) && s.pos.length === 3) spots.set(s.sv, s);
    }
  } catch { /* nothing kept yet */ }
}
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const all = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {};
      all[dataset] = [...spots.values()].sort((a, b) => b.at - a.at).slice(0, MAX_SPOTS);
      sessionStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* private mode or full: the points still work until the tab closes */ }
  }, 1500);
}

function idString(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'string') return v;
  if (typeof v.low === 'number' && typeof v.toString === 'function') return v.toString();
  if (v.key != null) return idString(v.key);
  if (Array.isArray(v)) return idString(v[0]);
  return null;
}

/** Remember `raw` (viewer coordinates) if the loaded image data says it is inside a cell. */
function note(raw: ArrayLike<number> | null | undefined) {
  const ml = currentSegLayer();
  const layer: any = ml?.layer;
  if (!raw || raw.length < 3 || !layer?.getValueAt) return;
  if ((ml.name || '') !== dataset) load(ml.name || '');
  let value: any = null;
  try { value = layer.getValueAt(raw, { pickedRenderLayer: null }); } catch { return; }
  const sv = idString(value);
  if (!sv || sv === '0') return;
  const pos = [Math.round(Number(raw[0])), Math.round(Number(raw[1])), Math.round(Number(raw[2]))] as [number, number, number];
  if (pos.some(v => !Number.isFinite(v)) || (pos[0] === 0 && pos[1] === 0 && pos[2] === 0)) return;
  // The cell the viewer believes is there, as a hint for which spots to check first.
  let root = '';
  try { const st = layer.displayState?.segmentSelectionState; if (st?.hasSelectedSegment) root = st.selectedSegment.toString(); } catch { /* no hint */ }
  spots.delete(sv);                          // re-insert so the newest is last
  spots.set(sv, { sv, pos, root, at: Date.now() });
  if (spots.size > MAX_SPOTS) spots.delete(spots.keys().next().value as string);
  saveSoon();
}

let started = false;
/** Call once the viewer exists. */
export function startCellPoints() {
  if (started) return;
  started = true;
  const viewer: any = (window as any).viewer;
  // A click in a data panel: the mouse is on the cell being worked on.
  document.addEventListener('mouseup', (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.('.neuroglancer-rendered-data-panel')) return;
    const ms = viewer?.mouseState;
    if (!ms?.active) return;
    try { note(ms.position); } catch { /* not ready */ }
  }, true);
  // The crosshairs at rest.
  let settle: ReturnType<typeof setTimeout> | null = null;
  try {
    viewer?.navigationState?.position?.changed?.add(() => {
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { try { note(viewer.navigationState.position.value); } catch { /* not ready */ } }, 900);
    });
  } catch { /* viewer without a position signal */ }
}

/**
 * A checked point inside each of `roots` that has one. Every candidate piece
 * is looked up on the graph server for the cell it belongs to NOW; a point is
 * returned only where that cell is one that was asked for. `onProgress` gets
 * how many pieces have been checked so far and how many there are.
 */
export async function pointsInsideCells(roots: string[], onProgress?: (done: number, total: number) => void):
    Promise<Record<string, [number, number, number]>> {
  const ml = currentSegLayer();
  if ((ml?.name || '') !== dataset) load(ml?.name || '');
  const want = new Set(roots);
  const out: Record<string, [number, number, number]> = {};
  if (!want.size || !spots.size) return out;
  // Newest first; the ones the viewer already tied to a wanted cell before any others.
  const all = [...spots.values()].sort((a, b) => b.at - a.at);
  // Every spot the viewer tied to a wanted cell is checked; of the rest, the
  // newest 200, so a long session never turns into hundreds of lookups.
  const ordered = [...all.filter(s => want.has(s.root)), ...all.filter(s => !want.has(s.root)).slice(0, 200)];
  let done = 0;
  const CHUNK = 10;
  for (let i = 0; i < ordered.length && Object.keys(out).length < want.size; i += CHUNK) {
    const batch = ordered.slice(i, i + CHUNK);
    const found = await Promise.all(batch.map(s => getRootFromSupervoxel(s.sv).catch(() => null)));
    batch.forEach((s, k) => {
      const now = found[k];
      if (now && want.has(now) && !out[now]) out[now] = s.pos;
      if (now && now !== s.root) { s.root = now; saveSoon(); }   // the piece has moved to another cell: remember where
    });
    done += batch.length;
    onProgress?.(Math.min(done, ordered.length), ordered.length);
  }
  return out;
}

/** How many spots are remembered for the dataset on screen (for tests and hints). */
export function rememberedSpotCount(): number {
  const ml = currentSegLayer();
  if ((ml?.name || '') !== dataset) load(ml?.name || '');
  return spots.size;
}
