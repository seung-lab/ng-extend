/**
 * Halloween in Lantern mode (Ames 2026-10-10): an easter egg. While the
 * Lantern is on, during the Halloween week, a ghost now and then appears near
 * the cell. It hangs in the dark, bobbing, and if you bring your view too
 * close it dissolves and is gone. It is found, not labelled.
 *
 * The ghost is a real model in the 3D view (perspective_view/nge_props.ts),
 * pinned to a place in the data, so a branch in front of it hides it.
 *
 * Cost: while a ghost is on screen the 3D view is redrawn about thirty times
 * a second so it can move. Nothing here runs unless the Lantern is on, it is
 * the season (or the test switch is set), and the tab is showing. The model
 * is fetched the first time it is needed.
 *
 * Testing outside the season: with the Lantern on, type  boo  (not in a text
 * box). Type it again to stop. Or set localStorage 'nge-spooky' to '1'.
 */
import {watch} from 'vue';
import {setNgeProps, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
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
const active = () => lantern.on && (inSeason() || testOn());

// How the ghost behaves. Distances are in units of the view's height when it
// appeared, so it is a sensible size whatever the zoom.
const SIZE = 0.065;              // its height (half the first try: Ames, "he needs to be smaller")
const NEAR = 0.24, FAR = 0.40;   // how far from the centre it appears
const SCARED = 2.2;              // it flees when the centre is this many of its own heights away
const APPEAR_S = 1.1, VANISH_S = 0.9;
const STAY_S: [number, number] = [22, 40];     // how long it stays if left alone
const GAP_S: [number, number] = [9, 26];       // how long before the next one
const FIRST_S: [number, number] = [2.5, 6];    // the first one, after the Lantern is lit
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

interface Ghost { posNm: [number, number, number]; sizeNm: number; born: number; leaveAt: number; goneAt: number | null; seed: number; }

let viewer: any = null;
let mesh: NgePropMesh | null = null;
let loading = false;
let ghost: Ghost | null = null;
let nextAt = 0;
let timer: number | null = null;
const prop: NgeProp = { mesh: null as any, modelMat: mat4.create(), alpha: 0, dissolve: 1, seed: 0, glow: [0.16, 0.2, 0.26], rim: [0.55, 0.9, 1.0] };

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

/** The view right now, in nanometres: its centre, the directions that are
 *  right, up and toward the eye on screen, and half its height. Read off the
 *  3D view's own matrices, so it is right whatever the layout or projection. */
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
  return { centreNm: c.map((x, i) => x * s[i]), up: norm(up), right: norm(right), eye, halfHeightNm: Math.hypot(up[0], up[1], up[2]), s };
}

function spawn(now: number) {
  const f = viewFrame();
  if (!f || !(f.halfHeightNm > 0)) return;
  const h = f.halfHeightNm * 2;
  const angle = Math.random() * Math.PI * 2, far = (NEAR + Math.random() * (FAR - NEAR)) * h;
  const depth = (Math.random() - 0.5) * 0.16 * h;
  const pos = [0, 1, 2].map(i => f.centreNm[i] + (f.right[i] * Math.cos(angle) + f.up[i] * Math.sin(angle)) * far + f.eye[i] * depth) as [number, number, number];
  ghost = { posNm: pos, sizeNm: SIZE * h, born: now, leaveAt: now + between(STAY_S) * 1000, goneAt: null, seed: Math.random() * 40 };
}

const ease = (t: number) => t * t * (3 - 2 * t);

function frame() {
  const now = performance.now();
  if (!active() || document.hidden) { stop(); return; }
  if (!mesh) { void load(); return; }
  if (!ghost) {
    if (now >= nextAt) spawn(now);
    if (!ghost) { setNgeProps([]); return; }
  }
  const g = ghost, f = viewFrame();
  if (!f) return;
  // too close, or its time is up: it goes
  const away = Math.hypot(f.centreNm[0] - g.posNm[0], f.centreNm[1] - g.posNm[1], f.centreNm[2] - g.posNm[2]);
  if (g.goneAt === null && now - g.born > APPEAR_S * 1000 && (away < SCARED * g.sizeNm || now > g.leaveAt)) g.goneAt = now;

  const age = (now - g.born) / 1000;
  let dissolve = 1 - ease(Math.min(1, age / APPEAR_S)), lift = 0, grow = 1;
  if (g.goneAt !== null) {
    const t = Math.min(1, (now - g.goneAt) / (VANISH_S * 1000));
    dissolve = ease(t); lift = 0.35 * t * t; grow = 1 + 0.22 * t;
    if (t >= 1) { ghost = null; nextAt = now + between(GAP_S) * 1000; setNgeProps([]); redraw(); return; }
  }
  // it bobs, sways a little, and always faces you
  const bob = Math.sin(age * 1.7) * 0.06 + lift, sway = Math.sin(age * 0.9 + g.seed) * 0.05, tilt = Math.sin(age * 1.3 + g.seed) * 0.12;
  const size = g.sizeNm * grow;
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  const m = prop.modelMat;
  for (let i = 0; i < 3; i++) {
    const x = f.right[i] * cosT + f.up[i] * sinT, y = f.up[i] * cosT - f.right[i] * sinT;
    // nanometres to the viewer's own units, one axis at a time
    m[i] = x * size / f.s[i];
    m[4 + i] = y * size / f.s[i];
    m[8 + i] = f.eye[i] * size / f.s[i];
    m[12 + i] = (g.posNm[i] + (f.up[i] * bob + f.right[i] * sway) * g.sizeNm) / f.s[i];
  }
  m[3] = m[7] = m[11] = 0; m[15] = 1;
  prop.mesh = mesh;
  prop.alpha = 0.86;
  prop.dissolve = dissolve;
  prop.seed = g.seed;
  setNgeProps([prop]);
  redraw();
  // for checking from the console and in tests
  (window as any).__ngeGhost = { posNm: g.posNm, sizeNm: g.sizeNm, awayNm: away, dissolve, leaving: g.goneAt !== null };
  // and for putting it somewhere on purpose (tests: in front of, or behind, a surface)
  (window as any).__ngeGhostPlace = (posNm: [number, number, number]) => { if (ghost) { ghost.posNm = posNm; ghost.leaveAt = performance.now() + 60_000; } };
}

const redraw = () => { try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ } };

async function load() {
  if (loading || mesh) return;
  loading = true;
  try { mesh = await loadGlbModel('halloween/ghost.glb'); }
  catch (e: any) { console.warn('[spooky] the ghost could not be loaded:', e?.message); stop(true); }
  finally { loading = false; }
}

function start() {
  if (timer !== null || !viewer) return;
  nextAt = performance.now() + between(FIRST_S) * 1000;
  timer = window.setInterval(frame, 33);
}
function stop(forGood = false) {
  if (timer !== null) { clearInterval(timer); timer = null; }
  ghost = null;
  setNgeProps([]);
  (window as any).__ngeGhost = null;
  redraw();
  if (forGood) failed = true;
}
let failed = false;
const sync = () => { if (active() && !document.hidden && !failed) start(); else stop(); };

/** Call once the viewer exists. */
export function startSpooky(v: any) {
  if (viewer) return;
  viewer = v;
  watch(() => lantern.on, sync, {immediate: true});
  document.addEventListener('visibilitychange', sync);
  // "boo": the test switch, outside the season.
  let typed = '';
  window.addEventListener('keydown', e => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    typed = (typed + e.key.toLowerCase()).slice(-3);
    if (typed !== 'boo' || !lantern.on) return;
    typed = '';
    try { if (testOn()) localStorage.removeItem(TEST_KEY); else localStorage.setItem(TEST_KEY, '1'); } catch { /* this session only */ }
    failed = false;
    sync();
  }, true);
}
