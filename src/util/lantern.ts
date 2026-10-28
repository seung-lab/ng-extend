/**
 * Lantern mode (Krzysztof Kruk's idea, 2026-10-09; first version 2026-10-10).
 *
 * The cell is lit around the centre of your view and greyed to a shadow
 * everywhere else, and the light moves with you. It is for checking a big
 * cell a part at a time. The drawing is in the mesh shader
 * (third_party/neuroglancer/mesh/nge_lantern.ts); this file keeps the
 * settings, follows the view, and remembers the settings in this browser.
 *
 * Settings:
 *   mode    what is lit: "cell", the cell around the centre of the view (the
 *           first Lantern), or "branch", only the branch you click on
 *           (Ames 2026-10-27; see the Clicked branch section below)
 *   size    how far the light reaches, in micrometres ("cell" only)
 *   flame   how bright the lit part is (Ames: "a flame intensity slider")
 * A third, Height (lifting the light toward the eye), was tried and taken out
 * the same day: on screen it read as a smaller Size and needed explaining
 * (Ames 2026-10-10: "I don't understand height", "remove height"). The
 * renderer can still do it (heightNm), it is simply always 0.
 */
import {reactive, watch} from 'vue';
import {setNgeLantern, type NgeLantern, type NgeLanternMask} from 'neuroglancer/mesh/nge_lantern';
import {mat4} from 'neuroglancer/util/geom';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {ngeGrapheneBranchGraph, ngeGrapheneBoxesOf, ngeGraphenePieceOf, ngeGrapheneThickness} from 'neuroglancer/datasource/graphene/frontend';
import {clickedBranch, densestPiece, nearestPiece, type BranchGraph, type Segment} from './branch_tree';
import {knownSomas, pickUnderMouse} from './highlight';
import {currentSegLayer} from '../datasets';

const KEY = 'nge-lantern-v1';
export const LANTERN_LIMITS = {
  sizeUm: {min: 2, max: 80, step: 1, start: 12},
  flame: {min: 50, max: 180, step: 5, start: 115},     // per cent
};
/** How bright the part in shadow is. Dim enough to recede, not so dim that
 *  the shape of the cell is lost. */
const SHADOW = 0.26;

export type LanternMode = 'cell' | 'branch';
interface Saved { on: boolean; mode: LanternMode; sizeUm: number; flame: number; open: boolean; }
const clamp = (v: unknown, r: {min: number; max: number; start: number}) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(r.min, Math.min(r.max, n)) : r.start;
};
function load(): Saved {
  let s: any = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* the defaults */ }
  return {
    on: false,                                   // never on by surprise after a reload
    mode: s.mode === 'branch' ? 'branch' : 'cell',
    sizeUm: clamp(s.sizeUm, LANTERN_LIMITS.sizeUm),
    flame: clamp(s.flame, LANTERN_LIMITS.flame),
    open: s.open !== false,
  };
}

/** The settings, live. The toolbar icon and the small Lantern bar read and write these. */
export const lantern = reactive<Saved>(load());

/** Clicked branch, for the bar: what it is doing, in words a player reads. */
export const lanternBranch = reactive({
  /** Whole cell: where the light is pinned (nm), or null while it follows
   *  the centre of the view (Ames 2026-10-28: "if you move the cell around
   *  the lantern follows you around the cell"). */
  pinnedNm: null as number[] | null,
  /** The gem at the click, in page pixels, while the branch is found. */
  marker: null as {x: number; y: number; at: number; state: 'finding' | 'done' | 'failed'} | null,
  /** idle: nothing clicked yet; finding: asking the server; lit; failed. */
  status: 'idle' as 'idle' | 'finding' | 'lit' | 'failed',
  message: '',
});

let viewer: any = null;
const state: NgeLantern = {
  center: new Float32Array(3), scaleNm: new Float32Array([1, 1, 1]),
  radiusNm: 0, heightNm: 0, intensity: 1, shadow: SHADOW, mask: null,
};

function readScales() {
  try {
    const scales = viewer.coordinateSpace.value.scales;
    for (let i = 0; i < 3; i++) state.scaleNm[i] = (Number(scales[i]) || 1e-9) / 1e-9;
  } catch { /* the view is not up yet */ }
}
function readView() {
  if (!viewer) return;
  readScales();
  if (lantern.mode === 'branch') {
    // The light starts where the branch was clicked, not at the view's centre.
    for (let i = 0; i < 3; i++) state.center[i] = branch.clickNm[i] / state.scaleNm[i];
    return;
  }
  const pin = lanternBranch.pinnedNm;
  if (pin) {
    // Pinned: the light stays on that spot of the cell, however the view moves.
    for (let i = 0; i < 3; i++) state.center[i] = pin[i] / state.scaleNm[i];
    return;
  }
  try {
    const pos = viewer.navigationState.position.value;
    for (let i = 0; i < 3; i++) state.center[i] = Number(pos[i]) || 0;
  } catch { /* the view is not up yet */ }
}

// ── Whole cell, pinned (Ames 2026-10-28) ──────────────────────────────────
// A click on a cell pins the light to that spot: panning, turning and
// zooming the view no longer carry it along, so it stays where the player is
// proofreading. Another click on the cell moves it there; Follow view in the
// bar (or turning the Lantern off) lets it follow the centre of the view
// again. A click on empty space does nothing, so a missed click never loses
// the place.
function pinUnderMouse(x: number, y: number) {
  try { viewer.mouseState.updateUnconditionally(); } catch { /* the last reading */ }
  const pick = pickUnderMouse();
  if ('error' in pick) return;
  readScales();
  lanternBranch.pinnedNm = [0, 1, 2].map(i => pick.global[i] * state.scaleNm[i]);
  // The gem shows where it went, and goes.
  markClick(x, y);
  endMarker('done');
  apply();
}

/** Let the light follow the centre of the view again. */
export function unpinLantern() {
  lanternBranch.pinnedNm = null;
  apply();
}

// ── Lighting it, and putting it out (Ames 2026-10-10: "a cool load in/out") ──
// `lit` runs from 0 (off) to 1 (burning). Lighting: the dark closes in while
// the light swells out from the centre, a little past its size and back, with
// a flare that settles. Putting it out: the light shrinks to a point and the
// daylight comes back. Under "reduce motion" (or Calm screen, which answers
// the same question) it simply switches.
const LIGHT_MS = 720, DOUSE_MS = 480;
let lit = 0;
let tween: number | null = null;
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Is the Lantern burning? In "branch" mode the dark is there from the
 *  start, waiting for a click (Ames 2026-10-27: with the cell left lit until
 *  then, "Clicked branch just lit up the whole cell"). */
const wanted = () => lantern.on;

function apply() {
  const on = wanted();
  const flare = on ? 1 + 0.9 * Math.pow(1 - lit, 2) * (lit > 0 ? 1 : 0) : 1;
  if (lantern.mode === 'branch') {
    // The light runs out along the branch from the click, and back in when
    // it is let go of. With no branch picked, all of it is in shadow.
    const run = easeOut(spread);
    state.radiusNm = branch.mask ? (branch.reachNm + 2000) * run * (on ? 1 : lit * lit) : 0;
    state.intensity = (lantern.flame / 100) * (1 + (branch.keep ? 0.6 * Math.pow(1 - run, 2) : 0));
    state.mask = branch.mask;
  } else {
    // how far through lighting (or dousing) it is
    const swell = on ? easeOutBack(lit) : lit * lit;
    state.radiusNm = lantern.sizeUm * 1000 * Math.max(0, swell);
    state.intensity = (lantern.flame / 100) * flare;
    state.mask = null;
  }
  state.heightNm = 0;
  // the dark closes in a little ahead of the light
  state.shadow = 1 - (1 - SHADOW) * smooth(Math.min(1, lit * 1.25));
  readView();
  setNgeLantern(lit > 0 ? state : null);
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  // For checking from the console and in tests.
  (window as any).__ngeLantern = lit > 0
    ? {mode: lantern.mode, centerNm: Array.from(state.center, (v, i) => v * state.scaleNm[i]), radiusNm: state.radiusNm, heightNm: state.heightNm, intensity: state.intensity, shadow: state.shadow, lit,
       branch: state.mask ? {pieces: branch.pieces, dims: state.mask.dims, cellNm: branch.cellNm, reachNm: branch.reachNm, forkNm: branch.forkNm, somaNm: branch.somaNm, somaFrom: branch.somaFrom, wholeBlocks: branch.wholeBlocks, maskAtNm} : null}
    : null;
}

/** For checking: the branch map's value (0 to 255) at a point, nm. */
function maskAtNm(nm: number[]): number {
  const mask = state.mask;
  if (!mask) return 0;
  const m = mask.gridFromGlobal, idx = [0, 1, 2].map(i => Math.floor((nm[i] / state.scaleNm[i] * m[i * 5] + m[12 + i]) * mask.dims[i]));
  if (idx.some((v, i) => v < 0 || v >= mask.dims[i])) return 0;
  return mask.data[(idx[2] * mask.dims[1] + idx[1]) * mask.dims[0] + idx[0]];
}

/** Run `lit` to 1 (on) or 0 (off). */
function run() {
  if (tween !== null) { cancelAnimationFrame(tween); tween = null; }
  const target = wanted() ? 1 : 0;
  const spreadTarget = lantern.mode === 'branch' && branch.keep ? 1 : 0;
  if (reducedMotion() || document.hidden) { lit = target; spread = spreadTarget; settle(); apply(); return; }
  const from = lit, t0 = performance.now(), ms = (target ? LIGHT_MS : DOUSE_MS) * Math.abs(target - from);
  const spreadFrom = spread, spreadMs = lantern.mode === 'branch' ? SPREAD_MS * Math.abs(spreadTarget - spreadFrom) : 0;
  if (ms <= 0 && spreadMs <= 0) { settle(); apply(); return; }
  const step = (now: number) => {
    const t = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
    const u = spreadMs > 0 ? Math.min(1, (now - t0) / spreadMs) : 1;
    lit = from + (target - from) * t;
    if (spreadMs > 0) spread = spreadFrom + (spreadTarget - spreadFrom) * u;
    apply();
    if (t < 1 || u < 1) { tween = requestAnimationFrame(step); } else { tween = null; settle(); apply(); }
  };
  tween = requestAnimationFrame(step);
}

/** Once its light is out, a branch that was let go of is forgotten. */
function settle() {
  if (!branch.keep && (lit === 0 || spread === 0)) { branch.mask = null; }
}

export function toggleLantern() { lantern.on = !lantern.on; }

// ── Clicked branch (Ames 2026-10-27: "can we make a mode in lantern mode
// where it only highlights the branch you click on?") ─────────────────────
// A click on the cell lights the branch it is on, from the fork where that
// branch leaves its parent out to all its tips, and everything else goes
// into shadow. Another click moves the light; a click on empty space puts it
// out. Turning the mode off brings the usual Lantern back.
//
// How the branch is found: the server already keeps every cell as a map of
// small pieces (a micron or two each) and which piece touches which, the map
// Highlight's "Beyond" uses (branch_tree.ts). Walking that map from the
// clicked piece back toward the soma, the fork is the first place where the
// walk came up the smaller side of a real fork (6 um or more of cable on
// the other side). The soma is a soma on record (Highlight keeps them),
// else the cell's thickest piece, as the server measures it, else its
// densest lump of pieces (the Sandbox keeps no thickness; on the retina
// the lump guess landed 90 um off, 2026-10-27). That takes one request for
// the map and one for its thickness (both kept 5 minutes per cell) and a
// moment of arithmetic, so a second click on the same cell is instant.
// Skeletons would be finer but
// most of our datasets have none, and the map is there for every cell.
//
// How it is drawn: the branch is painted into a small 3D map (one byte a
// cell, a micron or less across) as a tube round the line through its
// pieces, and only inside the blocks of the volume those pieces are in. The
// mesh shader lights what falls inside the map. So nothing is rebuilt but
// that map, and a branch of any size costs the same to draw.

/** Another branch must carry this much cable to count as a fork. */
const MIN_SIDE_NM = 6000;
/** Around the soma, everything within this is the soma. 7 um was too
 *  little for a retina cell: the walk went on into the soma and lit nearly
 *  the whole cell (Ames 2026-10-27, "Clicked branch just lit up the whole
 *  cell"). Thickness cannot tell soma from branch there: its soma measured
 *  625 nm and the swellings along its dendrites 350 to 450. */
const SOMA_RADIUS_NM = 15000;
/** A branch is never more than this share of the cell's pieces. */
const MAX_SHARE = 0.4;
/** How far round the line through the branch's pieces the light reaches. */
const TUBE_NM = 3200;
/** A branch piece's block of the volume is lit, within WIDE_NM of the
 *  branch's line, unless a side of it is longer than WHOLE_BLOCK_NM. */
const WHOLE_BLOCK_NM = 30000;
const WIDE_NM = 6000;
/** The map's budget: 8 MB at most. */
const MAX_CELLS = 8e6;
/** How long the light takes to run out along a new branch. */
const SPREAD_MS = 650;

const branch = {
  mask: null as NgeLanternMask | null,
  /** False once the player let go of it (a click on empty space). */
  keep: false,
  clickNm: [0, 0, 0],
  /** From the click to the farthest lit point, nm: how far the light runs. */
  reachNm: 0,
  pieces: 0,
  cellNm: 0,
  /** For checking: where the fork and the soma were taken to be, nm. */
  forkNm: null as number[] | null,
  somaNm: null as number[] | null,
  somaFrom: '' as '' | 'on record' | 'thickest' | 'guessed',
  /** How many of its pieces were lit block by block (no exact position). */
  wholeBlocks: 0,
};
let spread = 1;
let asked = 0;

/** A cell's branch map, and its thickest piece (the soma, where the dataset
 *  says how thick each piece is; asked only when no soma is on record, as it
 *  is a second pass over every piece). Kept for 5 minutes; an edit gives the
 *  cell a new id, so a kept map is never a stale one. */
interface GraphEntry { at: number; graph: BranchGraph; thickest?: Promise<string | undefined>; }
const graphs = new Map<string, GraphEntry>();
async function graphOf(layer: SegmentationUserLayer, root: string): Promise<GraphEntry> {
  const kept = graphs.get(root);
  if (kept && Date.now() - kept.at < 5 * 60 * 1000) return kept;
  const graph = await ngeGrapheneBranchGraph(layer, root);
  if (!graph.points.size) throw new Error('The server has no branch map for this cell.');
  const entry: GraphEntry = {at: Date.now(), graph};
  graphs.set(root, entry);
  if (graphs.size > 6) graphs.delete(graphs.keys().next().value!);
  return entry;
}
function thickestOf(layer: SegmentationUserLayer, entry: GraphEntry): Promise<string | undefined> {
  entry.thickest ??= ngeGrapheneThickness(layer, [...entry.graph.points.keys()]).then(thickness => {
    let thickest: string | undefined, most = 0;
    for (const [id, nm] of thickness) if (nm > most) { most = nm; thickest = id; }
    return thickest;
  }, () => undefined);
  return entry.thickest;
}

/** Paint the branch into a map: a tube round its segments, kept inside its
 *  pieces' blocks of the volume when those are known. `wholeBoxes` are lit
 *  whole: the blocks of pieces with no exact position, whose point is only
 *  the block's middle and can lie microns off the branch (MEC came out
 *  "splotchy", Ames 2026-10-27). A piece is always inside its block. */
function buildMask(segments: Segment[], boxes: number[][], scalesNm: number[], wholeBoxes: {box: number[]; near: boolean}[] = []): {mask: NgeLanternMask; cellNm: number} | null {
  if (!segments.length && !wholeBoxes.length) return null;
  const r = TUBE_NM;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const [a, b] of segments) for (const p of [a, b]) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], p[i] - r); hi[i] = Math.max(hi[i], p[i] + r);
  }
  for (const {box} of wholeBoxes) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], box[i]); hi[i] = Math.max(hi[i], box[i + 3]);
  }
  const ext = [0, 1, 2].map(i => hi[i] - lo[i]);
  let cell = Math.max(250, Math.cbrt((ext[0] * ext[1] * ext[2]) / MAX_CELLS));
  let dims = ext.map(e => Math.max(2, Math.ceil(e / cell)));
  while (Math.max(...dims) > 1024) { cell *= 1.25; dims = ext.map(e => Math.max(2, Math.ceil(e / cell))); }
  const [nx, ny, nz] = dims;
  const data = new Uint8Array(nx * ny * nz);
  const soft = Math.max(cell, r * 0.25);
  // Cells within the wide reach of the branch's line: a whole block is lit
  // only there, so a long block does not light far along another branch.
  const wide = new Uint8Array(nx * ny * nz);
  const rw = Math.max(r, WIDE_NM);
  for (const [a, b] of segments) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    const i0 = [0, 1, 2].map(i => Math.max(0, Math.floor((Math.min(a[i], b[i]) - rw - lo[i]) / cell)));
    const i1 = [0, 1, 2].map(i => Math.min(dims[i] - 1, Math.ceil((Math.max(a[i], b[i]) + rw - lo[i]) / cell)));
    for (let z = i0[2]; z <= i1[2]; z++) {
      const pz = lo[2] + (z + 0.5) * cell - a[2];
      for (let y = i0[1]; y <= i1[1]; y++) {
        const py = lo[1] + (y + 0.5) * cell - a[1];
        let o = (z * ny + y) * nx + i0[0];
        for (let x = i0[0]; x <= i1[0]; x++, o++) {
          const px = lo[0] + (x + 0.5) * cell - a[0];
          let t = (px * d[0] + py * d[1] + pz * d[2]) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - t * d[0], ey = py - t * d[1], ez = pz - t * d[2];
          const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (dist < rw) wide[o] = 1;
          if (dist >= r) continue;
          const v = Math.round(Math.min(1, (r - dist) / soft) * 255);
          if (v > data[o]) data[o] = v;
        }
      }
    }
  }
  for (const {box, near} of wholeBoxes) {
    const b0 = [0, 1, 2].map(i => Math.max(0, Math.floor((box[i] - lo[i]) / cell)));
    const b1 = [0, 1, 2].map(i => Math.min(dims[i] - 1, Math.ceil((box[i + 3] - lo[i]) / cell) - 1));
    for (let z = b0[2]; z <= b1[2]; z++) for (let y = b0[1]; y <= b1[1]; y++) {
      const row = (z * ny + y) * nx;
      if (!near) { data.fill(255, row + b0[0], row + b1[0] + 1); continue; }
      for (let o = row + b0[0]; o <= row + b1[0]; o++) if (wide[o]) data[o] = 255;
    }
  }
  // Only inside the branch's own blocks: a tube is round, the cell is not, and
  // a neighbouring branch that passes close by is in other blocks.
  if (boxes.length) {
    const inside = new Uint8Array(data.length);
    for (const box of boxes) {
      const b0 = [0, 1, 2].map(i => Math.max(0, Math.floor((box[i] - lo[i]) / cell)));
      const b1 = [0, 1, 2].map(i => Math.min(dims[i] - 1, Math.ceil((box[i + 3] - lo[i]) / cell) - 1));
      for (let z = b0[2]; z <= b1[2]; z++) for (let y = b0[1]; y <= b1[1]; y++) {
        inside.fill(1, (z * ny + y) * nx + b0[0], (z * ny + y) * nx + b1[0] + 1);
      }
    }
    for (let i = 0; i < data.length; i++) if (!inside[i]) data[i] = 0;
  }
  const m = mat4.create();
  for (let i = 0; i < 3; i++) {
    m[i * 5] = scalesNm[i] / (dims[i] * cell);
    m[12 + i] = -lo[i] / (dims[i] * cell);
  }
  return {mask: {data, dims: [nx, ny, nz], gridFromGlobal: m}, cellNm: cell};
}

/** Put the branch light out (a click on empty space). */
export function letGoOfBranch() {
  asked++;
  branch.keep = false;
  lanternBranch.status = 'idle';
  lanternBranch.message = '';
  lanternBranch.marker = null;
  run();
}

/** The gem where the player clicked, kept until the branch lights. */
function markClick(x: number, y: number) {
  lanternBranch.marker = {x, y, at: Date.now(), state: 'finding'};
}
function endMarker(state: 'done' | 'failed') {
  const m = lanternBranch.marker;
  if (!m) return;
  lanternBranch.marker = {...m, state};
  setTimeout(() => { if (lanternBranch.marker?.at === m.at) lanternBranch.marker = null; }, reducedMotion() ? 0 : 700);
}

/** Light the branch under the mouse. */
async function lightBranchUnderMouse(x: number, y: number) {
  // What is under the pointer is normally read on the next frame; read it
  // now, or a click right after the pointer arrives finds nothing there.
  try { viewer.mouseState.updateUnconditionally(); } catch { /* the last reading */ }
  const pick = pickUnderMouse();
  if ('error' in pick) {
    lanternBranch.marker = null;
    // Empty space: back to the normal view.
    if (pick.error.startsWith('Click on a cell')) {
      if (branch.mask || lanternBranch.status !== 'idle') letGoOfBranch();
    } else {
      lanternBranch.status = 'failed';
      lanternBranch.message = pick.error;
    }
    return;
  }
  const layer = currentSegLayer()?.layer;
  if (!(layer instanceof SegmentationUserLayer)) return;
  const mine = ++asked;
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).slice(0, 3).map(x => x / 1e-9);
  const toNm = (g: ArrayLike<number>) => [0, 1, 2].map(i => g[i] * (scalesNm[i] || 1));
  const clickNm = toNm(pick.global);
  lanternBranch.status = 'finding';
  lanternBranch.message = '';
  markClick(x, y);
  try {
    // The map and the clicked piece are asked for at the same time.
    const pieceAsked = ngeGraphenePieceOf(layer, pick.selection);
    const entry = await graphOf(layer, pick.root);
    const {graph} = entry;
    if (mine !== asked) return;
    // The piece clicked: asked of the server, else the nearest one.
    let from = await pieceAsked;
    if (mine !== asked) return;
    if (!from || !graph.points.has(from)) from = nearestPiece(graph, clickNm)?.id;
    if (!from) throw new Error('That point is not on a mapped part of this cell.');
    // The soma: one on record that lies on this cell, else the cell's
    // thickest piece, else its biggest lump of pieces.
    let ref: string | undefined, somaNm: number[] | undefined, best = 25000;
    for (const s of knownSomas(pick.root)) {
      const near = nearestPiece(graph, toNm(s));
      if (near && near.distNm < best) { best = near.distNm; ref = near.id; somaNm = toNm(s); }
    }
    const thickest = ref ? undefined : await thickestOf(layer, entry);
    if (mine !== asked) return;
    const somaFrom = ref ? 'on record' : thickest ? 'thickest' : 'guessed';
    if (!ref) { ref = thickest ?? densestPiece(graph); somaNm = ref ? graph.points.get(ref) : undefined; }
    if (!ref) throw new Error('This cell\'s branch map is empty.');
    const found = clickedBranch(graph, from, ref, {minSideNm: MIN_SIDE_NM, somaNm, somaRadiusNm: SOMA_RADIUS_NM, maxShare: MAX_SHARE});
    const ids = [...found.pieces];
    if (found.fork) ids.push(found.fork);
    let boxes: number[][] = [];
    const wholeBoxes: {box: number[]; near: boolean}[] = [];
    try {
      for (const [id, box] of await ngeGrapheneBoxesOf(layer, ids)) {
        boxes.push(box);
        // A piece of the branch is lit block and all, as near the branch's
        // line as WIDE_NM: it is always inside its block, and the straight
        // lines between pieces cut the corners of a bending dendrite (MEC
        // came out "splotchy", Ames 2026-10-27). A piece whose point is just
        // its block's middle (no exact position) lights its whole block, as
        // the line can miss it altogether. A huge block is left to the tube.
        const p = graph.points.get(id);
        if (!found.pieces.has(id)) continue;
        const middle = !!p && [0, 1, 2].every(i => Math.abs(p[i] - (box[i] + box[i + 3]) / 2) < 1);
        const huge = [0, 1, 2].some(i => box[i + 3] - box[i] > WHOLE_BLOCK_NM);
        if (middle) wholeBoxes.push({box, near: huge});
        else if (!huge) wholeBoxes.push({box, near: true});
      }
    } catch { boxes = []; /* the tube alone */ }
    if (mine !== asked) return;
    const built = buildMask(found.segments, boxes, scalesNm, wholeBoxes);
    branch.wholeBlocks = wholeBoxes.length;
    if (!built) throw new Error('The server has no positions for that part of the cell.');
    let reach = 0;
    for (const [a, b] of found.segments) for (const p of [a, b]) reach = Math.max(reach, Math.hypot(p[0] - clickNm[0], p[1] - clickNm[1], p[2] - clickNm[2]));
    branch.mask = {...built.mask, objectKey: `${pick.selection.rootId.low},${pick.selection.rootId.high}`};
    branch.cellNm = built.cellNm;
    branch.clickNm = clickNm;
    branch.reachNm = reach + TUBE_NM;
    branch.pieces = found.pieces.size;
    branch.forkNm = (found.fork && graph.points.get(found.fork)) || null;
    branch.somaNm = somaNm ?? null;
    branch.somaFrom = somaFrom;
    branch.keep = true;
    spread = 0;
    lanternBranch.status = 'lit';
    lanternBranch.message = found.soma ? 'The soma is lit.' : '';
    endMarker('done');
    run();
  } catch (e: any) {
    if (mine !== asked) return;
    console.warn('[lantern] could not find the branch:', e);
    lanternBranch.status = 'failed';
    lanternBranch.message = String(e?.message || e).slice(0, 160) || 'That branch could not be found.';
    endMarker('failed');
  }
}

// A plain click (no drag, no Ctrl or Shift) in the view, while the Lantern
// is on: in Clicked branch it lights the branch, in Whole cell it pins the
// light there. A drag still turns the view, and Ctrl+click is still the
// other tools' own. The click is not taken from neuroglancer: a double click
// still shows or hides a cell as it always did.
// In Whole cell the light is placed with a plain LEFT click, as in Clicked
// branch (Ames 2026-10-28: "I meant to say left click!"; a right click was
// tried for a few minutes). A drag still turns the view.
let down: {x: number; y: number; t: number; id: number; button: number} | null = null;
const inViewer = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.neuroglancer-rendered-data-panel');
function onDown(e: PointerEvent) {
  down = null;
  if (!lantern.on || e.button !== 0) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !inViewer(e.target)) return;
  down = {x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, button: e.button};
}
function onUp(e: PointerEvent) {
  const d = down;
  down = null;
  if (!d || d.id !== e.pointerId || !lantern.on) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 600) return;
  if (lantern.mode === 'branch') void lightBranchUnderMouse(e.clientX, e.clientY);
  else pinUnderMouse(e.clientX, e.clientY);
}

/** Call once the viewer exists. */
export function startLantern(v: any) {
  if (viewer) return;
  viewer = v;
  // The light follows the centre of the view. The state object is shared with
  // the renderer, so a move only has to rewrite three numbers.
  const moved = () => { if (lit > 0 && lantern.mode === 'cell' && !lanternBranch.pinnedNm) { readView(); (window as any).__ngeLantern && ((window as any).__ngeLantern.centerNm = Array.from(state.center, (c, i) => c * state.scaleNm[i])); } };
  try { viewer.navigationState.position.changed.add(moved); } catch { /* no position to follow */ }
  try { viewer.coordinateSpace.changed.add(() => { if (lit > 0) apply(); }); } catch { /* fixed scales */ }
  watch(() => lantern.on, on => {
    // Turned off: the branch goes with it, so turning it on again starts clean.
    if (!on) { asked++; branch.keep = false; lanternBranch.status = 'idle'; lanternBranch.message = ''; lanternBranch.marker = null; lanternBranch.pinnedNm = null; }
    run();
  });
  watch(() => lantern.mode, () => {
    // Back to the whole cell, or over to branches: the light starts afresh.
    asked++;
    branch.keep = false;
    branch.mask = null;
    lanternBranch.status = 'idle';
    lanternBranch.message = '';
    lanternBranch.marker = null;
    lanternBranch.pinnedNm = null;
    lit = 0;
    run();
  });
  watch(lantern, () => {
    if (tween === null) apply();
    try { localStorage.setItem(KEY, JSON.stringify({mode: lantern.mode, sizeUm: lantern.sizeUm, flame: lantern.flame, open: lantern.open})); } catch { /* not remembered */ }
  }, {deep: true});
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  lit = lantern.on ? 1 : 0;
  apply();
}
