/**
 * A point inside each cell, saved BY THE PLAYER as they work (Ames 2026-10-07,
 * for the Batch Processor: "it should let you place the cross-hairs and label
 * them, not guess").
 *
 * Marking a cell complete needs a point that is INSIDE that cell: CAVE works
 * out which cell a mark belongs to from the point. The batch wizard made you
 * walk every cell at the end and place the crosshairs one by one. Now a point
 * can be saved for a cell the moment you are on it: put the crosshairs in the
 * cell, press Save point, and it is labelled. Batch complete then uses the
 * points you saved.
 *
 * Nothing here is guessed. A point exists only because the player pressed
 * Save point with the crosshairs there, and the cell it belongs to is looked
 * up on the graph server at that moment (cellAtCrosshair, the same check the
 * Complete button makes). Edits change which cell a spot belongs to, so when
 * a batch is completed every saved point is looked up once more and used only
 * for the cell it is inside right now.
 *
 * Kept for this tab and this dataset (sessionStorage).
 */
import { reactive } from 'vue';
import { currentSegLayer } from '../datasets';
import { getRootFromSupervoxel } from '../widgets/pcg_service';
import { cellAtCrosshair } from './crosshair_cell';

interface Spot { sv: string; pos: [number, number, number]; root: string; at: number; }

const KEY = 'nge-cell-points-v2';
const MAX_SPOTS = 2000;

let dataset = '';
let spots = new Map<string, Spot>();                       // by supervoxel
/** Cell (root id, as known when the point was saved) to its point, for the panel's marks. */
export const savedCellPoints = reactive<Record<string, [number, number, number]>>({});

function publish() {
  for (const k of Object.keys(savedCellPoints)) delete savedCellPoints[k];
  for (const s of [...spots.values()].sort((a, b) => a.at - b.at)) savedCellPoints[s.root] = s.pos;   // newest wins
}
function load(name: string) {
  dataset = name;
  spots = new Map();
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    for (const s of (all?.[name] ?? []) as Spot[]) {
      if (s && typeof s.sv === 'string' && typeof s.root === 'string' && Array.isArray(s.pos) && s.pos.length === 3) spots.set(s.sv, s);
    }
  } catch { /* nothing saved yet */ }
  publish();
}
function save() {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {};
    all[dataset] = [...spots.values()].sort((a, b) => b.at - a.at).slice(0, MAX_SPOTS);
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode or full: the points still work until the tab closes */ }
  publish();
}
function sync() {
  const name = currentSegLayer()?.name || '';
  if (name !== dataset) load(name);
}

/** Make sure the marks in the panel are those of the dataset on screen. */
export function refreshCellPoints() { sync(); }

/**
 * Save the crosshairs as the point for the cell they are in. The cell is
 * looked up on the graph server first; when the crosshairs are not inside a
 * cell (or it can not be checked) nothing is saved and the reason is given.
 */
export async function saveCellPointAtCrosshair():
    Promise<{ root: string; position: [number, number, number] } | { problem: string }> {
  sync();
  const at = await cellAtCrosshair();
  if (!at.root || !at.supervoxel) return { problem: at.problem || 'The crosshairs are not inside a cell.' };
  if (at.position.every(v => v === 0)) return { problem: 'Place the crosshairs in the cell first.' };
  // One point per cell: a newer point for the same cell replaces the older one.
  for (const [sv, s] of spots) if (s.root === at.root) spots.delete(sv);
  spots.set(at.supervoxel, { sv: at.supervoxel, pos: at.position, root: at.root, at: Date.now() });
  save();
  return { root: at.root, position: at.position };
}

/** Forget the saved point of a cell. */
export function forgetCellPoint(root: string) {
  sync();
  let changed = false;
  for (const [sv, s] of spots) if (s.root === root) { spots.delete(sv); changed = true; }
  if (changed) save();
}

/**
 * The saved point of each of `roots` that still has a good one. Every saved
 * point is looked up again on the graph server for the cell it is inside
 * NOW, so a point is returned only where that is a cell that was asked for
 * (an edit since it was saved may have moved it to another cell).
 */
export async function pointsInsideCells(roots: string[], onProgress?: (done: number, total: number) => void):
    Promise<Record<string, [number, number, number]>> {
  sync();
  const want = new Set(roots);
  const out: Record<string, [number, number, number]> = {};
  // The points labelled for the wanted cells first, then the rest (an edit may
  // have carried one of those into a wanted cell).
  const newest = [...spots.values()].sort((a, b) => b.at - a.at);
  const all = [...newest.filter(s => want.has(s.root)), ...newest.filter(s => !want.has(s.root))];
  if (!want.size || !all.length) return out;
  let done = 0;
  let moved = false;
  const CHUNK = 10;
  for (let i = 0; i < all.length && Object.keys(out).length < want.size; i += CHUNK) {
    const batch = all.slice(i, i + CHUNK);
    const found = await Promise.all(batch.map(s => getRootFromSupervoxel(s.sv).catch(() => null)));
    batch.forEach((s, k) => {
      const now = found[k];
      if (now && want.has(now) && !out[now]) out[now] = s.pos;
      if (now && now !== s.root) { s.root = now; moved = true; }   // an edit moved it: keep the label on the right cell
    });
    done += batch.length;
    onProgress?.(Math.min(done, all.length), all.length);
  }
  if (moved) save();
  return out;
}
