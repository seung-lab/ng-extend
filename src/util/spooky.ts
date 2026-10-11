/**
 * Halloween in Pyr (Ames 2026-10-10): easter eggs. They are found, not
 * labelled.
 *
 *   The ghost     While the Lantern is on, in Halloween week, a ghost appears
 *                 near the cell. It hangs in the dark, bobbing, and if you
 *                 bring your view close it dissolves, and turns up somewhere
 *                 else two seconds later.
 *   The reaper    Rare. He arrives the same way, further off, carrying his
 *                 own red lantern: the cell near him is lit red. He stands
 *                 still, and is gone in an instant if you come near. He comes
 *                 by himself on 31 October only.
 *   boo!          Say  boo!  in chat and a ghost pops up in front of you and
 *                 flies off the screen. Your own boo! works all year; in
 *                 Halloween week everyone who sees it gets one.
 *
 * They are real models in the 3D view (perspective_view/nge_props.ts), pinned
 * to places in the data, so a branch in front of one hides it.
 *
 * Cost: while one is on screen the 3D view is redrawn about thirty times a
 * second so it can move. Nothing runs unless there is something to show, and
 * never while the tab is hidden. Each model is fetched the first time it is
 * needed.
 *
 * The Lantern bar carries a ghost button (components/LanternBar.vue): it
 * calls a ghost at once, every time it is pressed. Beside it, once the
 * haunting is on, are the reaper and a way to send them all away. Everyone
 * sees the button in Halloween week; outside it only admins do, for trying
 * things out. (It replaced typed test words: typing b, o, o also pressed
 * neuroglancer's own O key and flipped the view to orthographic.)
 */
import {reactive, watch} from 'vue';
import {setNgeProps, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {setNgeLanternSecond} from 'neuroglancer/mesh/nge_lantern';
import {mat4} from 'neuroglancer/util/geom';
import {lantern} from './lantern';
import {loadGlbModel} from './glb';

const TEST_KEY = 'nge-spooky';
/** 24 October to 1 November, in the player's own time. */
export function inSeason(now = new Date()): boolean {
  const m = now.getMonth(), d = now.getDate();
  return (m === 9 && d >= 24) || (m === 10 && d <= 1);
}
const testOn = () => { try { return localStorage.getItem(TEST_KEY) === '1'; } catch { return false; } };
/** What the ghost button shows: is the haunting on, and is it the season. */
export const spooky = reactive({ on: inSeason() || testOn(), season: inSeason() });
/** The haunting: the Lantern is on, and it is the season (or it was switched on by hand). */
const haunted = () => lantern.on && spooky.on;

type Kind = 'ghost' | 'reaper' | 'boo';
// The ghost and the reaper are sized in the data, in micrometres, within
// limits, so they are always small beside a cell body (about 10 um across)
// and still visible from far off. They turn up at the edge of the
// Lantern's light. (Ames 2026-10-10. Sized by the view the ghost was as big
// as the cell body from far away; sized by the Lantern he was still too big.)
// The boo! ghost is the exception: it pops up in front of you, so its size
// is a share of the view.
const KINDS: Record<Kind, {
  model: 'ghost' | 'reaper';
  sizeUm?: [number, number];       // its height in micrometres: never smaller than the first, never bigger than the second
  sizeOfView: number;              // and, between those, this share of the view when it arrives
  near: number; far: number;       // where it appears: this many Lantern reaches from the centre
  scared: number;                  // it goes when the view centre is this many of its own heights away (0 = never)
  tooBig: number;                  // and when zooming in makes it taller than this share of the view
  appearS: number; vanishS: number; stayS: [number, number];
  gapS: [number, number];          // how long after it has gone before the next visitor
  still: boolean;                  // stands where it is, facing the way it faced when it came
  alpha: number; shade: number; glow: [number, number, number]; rim: [number, number, number];
}> = {
  // The ghost bobs, faces you, and comes back two seconds after it goes,
  // somewhere else. He does not let you zoom right in on him.
  ghost:  { model: 'ghost',  sizeUm: [3.2, 7], sizeOfView: 0.045, near: 0.85, far: 1.1, scared: 2.6, tooBig: 0.13, appearS: 0.9, vanishS: 0.9, stayS: [22, 40], gapS: [2, 2], still: false,
            alpha: 0.86, shade: 1, glow: [0.16, 0.2, 0.26], rim: [0.55, 0.9, 1.0] },
  // The reaper does not move and does not turn to look at you: he stands in
  // the dark past the edge of the light, a shape with a red edge, and his
  // lantern beats slowly. He comes up out of the dark slowly and is gone in
  // an instant. (Ames: "he should not float/move ... he should not always
  // turn to look at you ... more ominous ... he looks too big".)
  reaper: { model: 'reaper', sizeUm: [5, 10], sizeOfView: 0.07, near: 1.15, far: 1.4, scared: 1.5, tooBig: 0.3, appearS: 3.2, vanishS: 0.3, stayS: [18, 30], gapS: [6, 14], still: true,
            alpha: 1, shade: 0.7, glow: [0.03, 0.0, 0.0], rim: [1.0, 0.1, 0.06] },
  boo:    { model: 'ghost',  sizeOfView: 0.15, near: 0, far: 0, scared: 0, tooBig: 0, appearS: 0.34, vanishS: 1.15, stayS: [1.0, 1.0], gapS: [0, 0], still: false,
            alpha: 0.95, shade: 1, glow: [0.2, 0.24, 0.3], rim: [0.6, 0.92, 1.0] },
};
// How near you may come before a visitor goes also depends on how far in you
// are zoomed: zoomed in, you can get closer (Ames). It is the smaller of its
// own "scared" distance and this share of what the view shows right now, and
// never less than about its own height.
const SCARED_OF_VIEW = 0.11;
const FIRST_S: [number, number] = [0.4, 0.9];  // the first, after the Lantern is lit (it was up to 6 s: too long)
// The reaper comes by himself on Halloween itself, 31 October, and on no
// other day (Ames 2026-10-10: "we should plan to deploy grim on halloween
// only"). On that day about one visitor in eight is him. Admins can call him
// from the Lantern bar on any day, to try him out.
const REAPER_ODDS = 0.12;
export function isHalloween(now = new Date()): boolean { return now.getMonth() === 9 && now.getDate() === 31; }
const BOO_EVERY_MS = 6000;
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

interface Visitor {
  kind: Kind; posNm: number[]; sizeNm: number; viewNm: number;
  /** For one that stands still: the way it faced when it came (right, up, toward the eye then). */
  facing: { right: number[]; up: number[]; eye: number[] } | null;
  born: number; leaveAt: number; goneAt: number | null; seed: number;
  drift: number[];                 // nm per second
  nearCell: boolean;               // it was put beside a cell (not just at the edge of the light)
  prop: NgeProp;
}

let viewer: any = null;
const meshes: Partial<Record<'ghost' | 'reaper', NgePropMesh>> = {};
const loadingModel: Partial<Record<'ghost' | 'reaper', boolean>> = {};
const failedModel: Partial<Record<'ghost' | 'reaper', boolean>> = {};
let visitors: Visitor[] = [];
let nextAt = 0;
let callReaper = false;
let nextIsGhost = false;                   // the ghost button asked: a ghost, not the reaper
let summon = false;                        // a button asked for someone now
let quietUntil = 0;                        // sent away: nobody new before this
let lastBoo = 0;
let lastSpot: number[] | null = null;      // where the last one was, so the next is somewhere else
let timer: number | null = null;
const redLight = { posNm: new Float32Array(3), radiusNm: 0, color: [1.0, 0.16, 0.1] as [number, number, number] };

const panel3d = () => {
  for (const p of viewer?.display?.panels ?? []) if (p?.projectionParameters && !('sliceView' in p) && p.element?.isConnected && p.element.offsetWidth > 0) return p;
  return null;
};
const scalesNm = (): number[] => {
  const s = viewer.coordinateSpace.value.scales;
  return [0, 1, 2].map(i => (Number(s[i]) || 1e-9) / 1e-9);
};
const tm = (m: ArrayLike<number>, v: number[]) => {
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] || 1;
  return [0, 1, 2].map(i => (m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]) / w);
};
const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(x => x / l); };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ease = (t: number) => t * t * (3 - 2 * t);

/** The view right now, in nanometres: its centre, the directions that are
 *  right, up and toward the eye on screen, and its height. Read off the 3D
 *  view's own matrices, so it is right whatever the layout or projection. */
function viewFrame() {
  const p = panel3d();
  if (!p) return null;
  const P = p.projectionParameters.value, s = scalesNm();
  const c = Array.from(viewer.navigationState.position.value as ArrayLike<number>).slice(0, 3).map(Number);
  const depth = tm(P.viewProjectionMat, c)[2];
  const toNm = (g: number[]) => g.map((x, i) => (x - c[i]) * s[i]);
  const up = toNm(tm(P.invViewProjectionMat, [0, 1, depth]));
  const right = toNm(tm(P.invViewProjectionMat, [1, 0, depth]));
  const a = tm(P.invViewMatrix, [0, 0, 0]), b = tm(P.invViewMatrix, [0, 0, 1]);
  const eye = norm([0, 1, 2].map(i => (b[i] - a[i]) * s[i]));
  const heightNm = Math.hypot(up[0], up[1], up[2]) * 2;
  return heightNm > 0 ? { centreNm: c.map((x, i) => x * s[i]), up: norm(up), right: norm(right), eye, heightNm, s } : null;
}
type Frame = NonNullable<ReturnType<typeof viewFrame>>;

function load(model: 'ghost' | 'reaper') {
  if (meshes[model] || loadingModel[model] || failedModel[model]) return;
  loadingModel[model] = true;
  loadGlbModel(`halloween/${model}.glb`).then(
    m => { meshes[model] = m; },
    e => { failedModel[model] = true; console.warn(`[spooky] the ${model} could not be loaded:`, e?.message); },
  ).finally(() => { loadingModel[model] = false; });
}

/**
 * Points on the cells that are on screen right now, in nanometres.
 *
 * A visitor should be beside a cell, not out in the empty dark (Ames
 * 2026-10-10, on a retina bipolar cell: "he shouldn't be too far away from
 * the cells"). The 3D view keeps the depth of everything it last drew, so a
 * scatter of screen points that have something drawn at them, turned back
 * into places in the data, is a scatter of points on the visible surfaces.
 * Read once, when someone is about to arrive.
 */
function surfacePoints(f: Frame): number[][] {
  const p = panel3d();
  if (!p || typeof p.getDepthArray !== 'function') return [];
  let depth: Float32Array | undefined, w = 0, h = 0;
  try { depth = p.getDepthArray(); w = p.renderViewport.width; h = p.renderViewport.height; } catch { return []; }
  if (!depth || !(w > 8) || !(h > 8) || depth.length < w * h) return [];
  const inv = p.projectionParameters.value.invViewProjectionMat;
  const step = Math.max(3, Math.round(Math.min(w, h) / 90));
  const at = (x: number, y: number) => depth![y * w + x];
  const out: number[][] = [];
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const z = at(x, y);
      // something drawn here, and beside it too: a branch, not a one pixel line
      if (!(z > 0) || !(at(x + 1, y) > 0) || !(at(x, y + 1) > 0) || !(at(x + 1, y + 1) > 0)) continue;
      // the view stores 1 minus the window depth
      const g = tm(inv, [(x + 0.5) / w * 2 - 1, (y + 0.5) / h * 2 - 1, 2 * (1 - z) - 1]);
      out.push(g.map((v, i) => v * f.s[i]));
    }
  }
  return out;
}

function arrive(kind: Kind, f: Frame, now: number) {
  const k = KINDS[kind], h = f.heightNm;
  // where it appears is measured in Lantern reaches
  const unit = Math.max(1000, lantern.sizeUm * 1000);
  // A share of the view, held between two real sizes: big enough to see
  // from far off, never as big as a cell body. (A fixed 2.4 um was right up
  // close and a speck from far away: Ames, "he is so tiny! maybe too tiny".)
  const sizeNm = k.sizeUm ? Math.max(k.sizeUm[0] * 1000, Math.min(k.sizeUm[1] * 1000, k.sizeOfView * h)) : k.sizeOfView * h;
  const at = (x: number, y: number, z: number) => [0, 1, 2].map(i => f.centreNm[i] + f.right[i] * x + f.up[i] * y + f.eye[i] * z);
  let pos: number[] = [], drift = [0, 0, 0], nearCell = false;
  if (kind === 'boo') {
    // right in front of you, a little below the middle
    pos = at(0, -0.1 * h, 0.14 * h);
  } else {
    // Beside a cell: a point on a visible surface about as far from the
    // centre as this visitor likes to be (the ghost at the edge of the light,
    // the reaper out past it), and not where the last one was.
    const want = (k.near + k.far) / 2 * unit, slack = (k.far - k.near) / 2 * unit + 0.25 * unit;
    const points = surfacePoints(f);
    const fresh = lastSpot ? points.filter(q => dist(q, lastSpot!) > Math.max(0.7 * unit, 3 * sizeNm)) : points;
    const pool = fresh.length ? fresh : points;
    const ring = pool.filter(q => Math.abs(dist(q, f.centreNm) - want) <= slack);
    let on: number[] | null = null;
    if (ring.length) on = ring[Math.floor(Math.random() * ring.length)];
    else if (pool.length) {
      // nothing at that distance: the nearest to it, from a handful picked at random
      const few = Array.from({ length: Math.min(24, pool.length) }, () => pool[Math.floor(Math.random() * pool.length)]);
      on = few.reduce((best, q) => Math.abs(dist(q, f.centreNm) - want) < Math.abs(dist(best, f.centreNm) - want) ? q : best);
    }
    if (on) {
      // just in front of the cell there, and a little above it, never inside it
      pos = [0, 1, 2].map(i => on![i] + f.eye[i] * 0.8 * sizeNm + f.up[i] * 0.45 * sizeNm);
      nearCell = true;
    } else {
      // no cell on screen at all: at the edge of the light
      const angle = Math.random() * Math.PI * 2, far = (k.near + Math.random() * (k.far - k.near)) * unit;
      pos = at(Math.cos(angle) * far, Math.sin(angle) * far, (Math.random() - 0.5) * 0.3 * unit);
    }
  }
  visitors.push({
    kind, posNm: pos, sizeNm, viewNm: h,
    facing: k.still ? { right: [...f.right], up: [...f.up], eye: [...f.eye] } : null, born: now, leaveAt: now + between(k.stayS) * 1000, goneAt: null,
    seed: Math.random() * 40, drift, nearCell,
    prop: { mesh: meshes[k.model]!, modelMat: mat4.create(), alpha: k.alpha, dissolve: 1, seed: 0, glow: k.glow, rim: k.rim, shade: k.shade },
  });
}

/** Stand a model at a place, facing the eye, leaning by `tilt`. */
function stand(m: mat4, f: Frame, posNm: number[], sizeNm: number, tilt: number, facing: Visitor['facing'] = null) {
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  // facing the eye now, or the way it faced when it came
  const b = facing ?? f;
  for (let i = 0; i < 3; i++) {
    const x = b.right[i] * cosT + b.up[i] * sinT, y = b.up[i] * cosT - b.right[i] * sinT;
    // nanometres to the viewer's own units, one axis at a time
    m[i] = x * sizeNm / f.s[i];
    m[4 + i] = y * sizeNm / f.s[i];
    m[8 + i] = b.eye[i] * sizeNm / f.s[i];
    m[12 + i] = posNm[i] / f.s[i];
  }
  m[3] = m[7] = m[11] = 0; m[15] = 1;
}

function frame() {
  const now = performance.now();
  if (document.hidden) { stop(); return; }
  const haunting = haunted();
  // whoever belongs to the haunting leaves with it
  if (!lantern.on) visitors = visitors.filter(v => v.kind === 'boo');
  if (!haunting && !visitors.length) { stop(); return; }
  const f = viewFrame();
  if (!f) return;

  // someone new?
  if (haunting && !visitors.some(v => v.kind !== 'boo') && (summon || now >= nextAt)) {
    const kind: Kind = callReaper || (!nextIsGhost && isHalloween() && Math.random() < REAPER_ODDS) ? 'reaper' : 'ghost';
    const model = KINDS[kind].model;
    if (meshes[model]) { arrive(kind, f, now); callReaper = false; nextIsGhost = false; summon = false; }
    else if (failedModel[model]) { callReaper = false; summon = false; nextAt = now + 4000; }
    else load(model);
  }

  let red = 0;
  const live: Visitor[] = [];
  for (const v of visitors) {
    const k = KINDS[v.kind];
    const age = (now - v.born) / 1000;
    const away = dist(f.centreNm, v.posNm);
    const tooNear = Math.max(0.9 * v.sizeNm, Math.min(k.scared * v.sizeNm, SCARED_OF_VIEW * f.heightNm));
    // too near, zoomed in too far on it, or its time is up: it goes
    const zoomedIn = k.tooBig > 0 && v.sizeNm > k.tooBig * f.heightNm;
    if (v.goneAt === null && age > Math.min(k.appearS, 1) && ((k.scared > 0 && away < tooNear) || zoomedIn || now > v.leaveAt)) v.goneAt = now;
    const out = v.goneAt === null ? 0 : Math.min(1, (now - v.goneAt) / (k.vanishS * 1000));
    if (out >= 1) {
      if (v.kind !== 'boo') { lastSpot = v.posNm; nextAt = Math.max(quietUntil, now + between(k.gapS) * 1000); }
      continue;
    }

    let pos = v.posNm, size = v.sizeNm, tilt: number, dissolve: number;
    if (v.kind === 'boo') {
      // pops up, wobbles, then shoots off up and to the side, spinning
      const pop = Math.min(1, age / k.appearS);
      if (pop < 1) size *= 1.28 * Math.sin(pop * Math.PI * 0.5) - 0.28 * pop * pop;
      const fly = out * out, side = v.seed > 20 ? 1 : -1;
      pos = [0, 1, 2].map(i => v.posNm[i] + (f.up[i] * (0.75 * fly + 0.012 * Math.sin(age * 9)) + f.right[i] * side * 0.95 * fly + f.eye[i] * 0.25 * fly) * v.viewNm);
      tilt = Math.sin(age * 7) * 0.16 * (1 - out) + side * -2.6 * fly;
      size *= 1 - 0.45 * fly;
      dissolve = 0;
    } else if (k.still) {
      // The reaper: comes up out of the dark slowly, does not move, is gone at once.
      dissolve = v.goneAt === null ? 1 - ease(Math.min(1, age / k.appearS)) : out;
      tilt = 0;
    } else {
      // forms out of patches; goes the same way, rising a little
      dissolve = v.goneAt === null ? 1 - ease(Math.min(1, age / k.appearS)) : ease(out);
      const bob = Math.sin(age * 1.7) * 0.06 + 0.35 * out * out, sway = Math.sin(age * 0.9 + v.seed) * 0.05;
      pos = [0, 1, 2].map(i => v.posNm[i] + (f.up[i] * bob + f.right[i] * sway) * v.sizeNm);
      tilt = Math.sin(age * 1.3 + v.seed) * 0.12;
      size *= 1 + 0.22 * out;
    }
    stand(v.prop.modelMat, f, pos, size, tilt, v.facing);
    v.prop.mesh = meshes[k.model]!;
    v.prop.dissolve = dissolve;
    v.prop.seed = v.seed;
    if (v.kind === 'reaper') {
      // His lantern: the cell near him is lit red, in a slow double beat like
      // a heart, for as long as he is there.
      const beat = (age * 0.62) % 1;
      const pulse = Math.exp(-Math.pow((beat - 0.08) / 0.07, 2)) + 0.7 * Math.exp(-Math.pow((beat - 0.3) / 0.08, 2));
      red = (1 - dissolve) * (0.5 + 0.5 * pulse);
      redLight.posNm.set(pos);
      redLight.radiusNm = v.sizeNm * 3.4 * (1 - dissolve) * (0.82 + 0.18 * pulse);
      redLight.color = [1.0 * (0.55 + 0.45 * pulse), 0.1, 0.06];
      // The same lantern lights the front of him, so the figure can be made out
      // (Ames: "the model seems impossible to see, maybe it needs a light on
      // the front of him"): steadily, and brighter on each beat.
      v.prop.shade = 0.62 + 0.3 * pulse;
    }
    live.push(v);
  }
  visitors = live;
  setNgeProps(visitors.map(v => v.prop));
  setNgeLanternSecond(red > 0.01 ? redLight : null);
  redraw();
  // for checking from the console and in tests
  const main = visitors.find(v => v.kind !== 'boo');
  (window as any).__ngeGhost = main ? { kind: main.kind, nearCell: main.nearCell, posNm: main.posNm, sizeNm: main.sizeNm, dissolve: main.prop.dissolve, leaving: main.goneAt !== null,
    awayNm: dist(f.centreNm, main.posNm), tooNearNm: Math.max(0.9 * main.sizeNm, Math.min(KINDS[main.kind].scared * main.sizeNm, SCARED_OF_VIEW * f.heightNm)) } : null;
  (window as any).__ngeVisitors = visitors.map(v => v.kind);
  // and for putting one somewhere on purpose (tests: in front of, or behind, a surface)
  (window as any).__ngeGhostPlace = (posNm: number[]) => { const v = visitors.find(x => x.kind !== 'boo'); if (v) { v.posNm = posNm; v.drift = [0, 0, 0]; v.leaveAt = performance.now() + 60_000; } };
}

const redraw = () => { try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ } };

function start() {
  if (timer !== null || !viewer) return;
  timer = window.setInterval(frame, 33);
}
function stop() {
  if (timer !== null) { clearInterval(timer); timer = null; }
  visitors = [];
  setNgeProps([]);
  setNgeLanternSecond(null);
  (window as any).__ngeGhost = null;
  (window as any).__ngeVisitors = [];
  redraw();
}
function sync() {
  if (document.hidden) { stop(); return; }
  if (haunted()) {
    load('ghost');                 // fetched now, so the first one is not kept waiting
    if (timer === null) nextAt = performance.now() + between(FIRST_S) * 1000;
    start();
  } else if (!visitors.length) stop();
}

/** boo! A ghost pops up in front of you and flies off the screen. */
export function booGhost() {
  const now = performance.now();
  if (!viewer || document.hidden || now - lastBoo < BOO_EVERY_MS) return;
  lastBoo = now;
  const go = (tries: number) => {
    if (meshes.ghost) {
      const f = viewFrame();
      if (f) { arrive('boo', f, performance.now()); start(); }
    } else if (!failedModel.ghost && tries > 0) { load('ghost'); setTimeout(() => go(tries - 1), 250); }
  };
  go(24);
}
/** Is this chat line a boo? (boo!, Boo!!, booo !) */
export const isBoo = (text: string) => /(^|[^a-z])bo{2,}\s*!/i.test(text);

/** Call once the viewer exists. */
export function startSpooky(v: any) {
  if (viewer) return;
  viewer = v;
  watch(() => lantern.on, sync, {immediate: true});
  document.addEventListener('visibilitychange', sync);
}

/** The ghost button: switch the haunting on if it is not, and bring a ghost now. */
export function callGhost() {
  spooky.on = true;
  try { localStorage.setItem(TEST_KEY, '1'); } catch { /* this session only */ }
  const now = performance.now();
  // whoever is here makes way, and the new one comes at once, somewhere else
  for (const x of visitors) if (x.kind !== 'boo' && x.goneAt === null) x.goneAt = now;
  quietUntil = 0;
  summon = true;
  nextIsGhost = true;
  sync();
}
/** Call the reaper now. */
export function callTheReaper() {
  spooky.on = true;
  try { localStorage.setItem(TEST_KEY, '1'); } catch { /* this session only */ }
  const now = performance.now();
  for (const x of visitors) if (x.kind !== 'boo' && x.goneAt === null) x.goneAt = now;
  callReaper = true;
  failedModel.reaper = false;
  quietUntil = 0;
  summon = true;
  sync();
}
/** Send them all away. Outside the season that also switches the haunting off. */
export function shoo() {
  try { localStorage.removeItem(TEST_KEY); } catch { /* nothing to clear */ }
  const now = performance.now();
  for (const x of visitors) if (x.goneAt === null) x.goneAt = now;
  summon = false; callReaper = false;
  // Outside the season the haunting is off until the ghost is called again;
  // in it, they stay away for a minute. (Those leaving finish dissolving.)
  quietUntil = inSeason() ? now + 60_000 : Infinity;
  nextAt = quietUntil;
  if (!inSeason()) setTimeout(() => { if (quietUntil === Infinity) spooky.on = false; }, 1600);
}

