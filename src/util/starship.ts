/**
 * The Starship (Ames 2026-11-07), first piece of the new player intro: a ship
 * flies through the branches of the Sandbox's blue pyramidal cell (the one
 * the welcome tutorial uses) and lands on its cell body, while the view
 * turns slowly. Admins only for now, from the palette ("Starship flight").
 *
 * Drawn inside the 3D view itself (third_party/.../nge_props.ts), not on a
 * canvas over it, so a branch in front of the ship hides it, and its fusion
 * engine leaves a trail of glowing particles that the branches hide too.
 *
 * The route is worked out ahead of time from the cell's own mesh
 * (static/intro/sandbox-flight.json, in nanometres): it never comes closer
 * than about 3 um to the membrane until it touches down on an open patch of
 * the soma. The model (static/intro/starship.glb) is Ames's, its nose along
 * +z and its top along +y; any model made that way drops in.
 *
 * Nothing runs until a flight starts. Landed, the engines go quiet (the
 * ship keeps a gentle float and the view keeps drawing) until it is taken
 * away.
 */
import {setNgeGlow, setNgeProps, type NgeGlow, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {mat4, quat} from 'neuroglancer/util/geom';
import {setNgeReveal} from 'neuroglancer/mesh/nge_tint';
import {getObjectKey} from 'neuroglancer/segmentation_display_state/base';
import {setStatedColor} from '../widgets/widget_utils';
import {Uint64} from 'neuroglancer/util/uint64';
import {loadGlbModel} from './glb';
import {findDatasetBySegName, switchToDataset} from '../datasets';
import {useUserPreferencesStore} from '../store';

type V3 = [number, number, number];
interface Flight { path: number[][]; landingStart: number; landNormal: V3; soma: V3; shipLength: number; segment: string; rollAt?: number; rollLen?: number; }

const SANDBOX_LAYER = 'pinky_nf_v2';
const GROUP = 'starship';
/** One full turn of the view every two minutes (Ames). */
const TURN_SECONDS = 120;
/** Seconds of flight before the landing starts, and for the landing. */
const CRUISE_S = 15;
const LANDING_S = 3.2;
/** How much shows from top to bottom of the view: the whole cell, then in
 *  close on the soma for the landing, in nanometres. */
const WIDE_NM = 210_000, CLOSE_NM = 36_000;
/** The portal opens this long before the ship comes through it. */
const PORTAL_S = 1.8;
/** The cell, a clear blue beside the gold soma (Ames 2026-11-08). */
const CELL_BLUE = 0x4f8cff;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

const viewerNow = (): any => (window as any).viewer;

let model: NgePropMesh | null = null;
let flight: Flight | null = null;
export async function loadAssets() {
  if (!model) model = await loadGlbModel('intro/starship.glb');
  if (!flight) {
    const res = await fetch('intro/sandbox-flight.json');
    if (!res.ok) throw new Error(`route ${res.status}`);
    flight = await res.json();
  }
}

/** Nanometres per unit of the viewer's global coordinates, per axis. */
function nmPerUnit(): V3 | null {
  const scales = viewerNow()?.coordinateSpace?.value?.scales;
  if (!scales || scales.length < 3) return null;
  return [0, 1, 2].map(i => (Number(scales[i]) || 1e-9) * 1e9) as V3;
}

/** The camera's right, up and toward-the-eye directions, in nanometres
 *  (unit length), read from the 3D panel's own projection. */
export function cameraAxes(nm: V3): {right: V3; up: V3; toEye: V3} | null {
  const panels = viewerNow()?.display?.panels ?? [];
  let panel: any = null;
  for (const p of panels) if (p?.element?.classList?.contains('nge-3d-panel') && p.projectionParameters?.value) { panel = p; break; }
  if (!panel) for (const p of panels) if (p?.constructor?.name !== 'SliceViewPanel' && p?.projectionParameters?.value?.invViewProjectionMat && p?.navigationState?.pose) { panel = p; break; }
  const inv = panel?.projectionParameters?.value?.invViewProjectionMat;
  if (!inv) return null;
  const back = (a: number, b: number, c: number): V3 => {
    const g = inv[3] * a + inv[7] * b + inv[11] * c + inv[15];
    return [0, 1, 2].map(i => (inv[i] * a + inv[i + 4] * b + inv[i + 8] * c + inv[i + 12]) / g * nm[i]) as V3;
  };
  const o = back(0, 0, 0.5);
  return {right: norm(sub(back(0.01, 0, 0.5), o)), up: norm(sub(back(0, 0.01, 0.5), o)), toEye: norm(sub(back(0, 0, 0.4), o))};
}

/* ── the route, by distance along it ── */
let cum: number[] = [];
function prepare(f: Flight) {
  cum = [0];
  for (let i = 1; i < f.path.length; i++) cum.push(cum[i - 1] + Math.hypot(...sub(f.path[i] as V3, f.path[i - 1] as V3)));
}
function at(f: Flight, s: number): V3 {
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return mix(f.path[lo] as V3, f.path[hi] as V3, t);
}
const routeLength = () => cum[cum.length - 1];
/** Distance along the route at t seconds: eases in, cruises, then the
 *  landing slows to a touch. */
function distanceAt(f: Flight, t: number): number {
  const cruiseEnd = f.landingStart, landLen = routeLength() - cruiseEnd;
  if (t < CRUISE_S) {
    // ease in over the first second and a half
    const ease = 1.5, v = cruiseEnd / (CRUISE_S - ease / 2);
    return t < ease ? v * t * t / (2 * ease) : v * (t - ease / 2);
  }
  const q = Math.min(1, (t - CRUISE_S) / LANDING_S);
  return cruiseEnd + landLen * (1 - Math.pow(1 - q, 3));
}

/* ── the engine trail ── */
const MAX_PARTICLES = 1400;
const LIFE_S = 1.25;
interface Particle { p: V3; v: V3; age: number; size: number; }
let particles: Particle[] = [];
const glow: NgeGlow = {
  positions: new Float32Array(MAX_PARTICLES * 3 + 6), colors: new Float32Array(MAX_PARTICLES * 4 + 8),
  sizesNm: new Float32Array(MAX_PARTICLES + 2), count: 0, nmRight: [1, 0, 0],
};
function writeGlow(nm: V3, right: V3, cores: {p: V3; power: number}[], shipNm: number) {
  let n = 0;
  const put = (p: V3, rgba: number[], size: number) => {
    glow.positions[n * 3] = p[0] / nm[0]; glow.positions[n * 3 + 1] = p[1] / nm[1]; glow.positions[n * 3 + 2] = p[2] / nm[2];
    glow.colors.set(rgba, n * 4);
    glow.sizesNm[n] = size;
    n++;
  };
  for (const q of particles) {
    const k = q.age / LIFE_S;
    // white hot, then cyan, then a fading blue
    const r = 0.55 - 0.45 * k, g = 0.95 - 0.45 * k, b = 1.0;
    put(q.p, [r, g, b, 0.55 * Math.pow(1 - k, 1.6)], q.size * (1 + 1.6 * k));
  }
  for (const c of cores) if (c.power > 0.01) put(c.p, [0.9, 1.0, 1.0, 0.95 * c.power], shipNm * 0.28 * (0.7 + 0.3 * c.power));
  glow.count = n;
  glow.nmRight = [right[0] / nm[0], right[1] / nm[1], right[2] / nm[2]];
  setNgeGlow(n ? glow : null, GROUP);
}

/* ── after landing: the tour takes the camera and sends the ship places ── */
/** The tour (src/util/intro_tour.ts) holds the camera: the flight stops
 *  zooming and panning it (the slow turn goes on). */
let cameraHeld = false;
export function setStarshipCameraHeld(held: boolean) { cameraHeld = held; }
interface Hop { path: V3[]; cum: number[]; start: number; ms: number; }
let hop: Hop | null = null;
/** Docked: the ship holds a spot on screen (fractions of the 3D view from
 *  its centre, x to the right, y up), whatever the camera does, and faces
 *  the cell. It eases there from wherever it was. */
let dock: {fx: number; fy: number; start: number; from: V3 | null} | null = null;
let dockMs = 4200;
/** Dock, taking `ms` to get there (the tour makes it end as the camera does). */
let onPad = true;
export function dockStarship(fx: number, fy: number, ms = 4200) { dockMs = ms; onPad = false; dock = {fx, fy, start: performance.now(), from: shipNow}; hop = null; }
/** How long until the ship is where it is going (ms). */
export function starshipEta(): number {
  const now = performance.now();
  if (hop) return Math.max(0, hop.start + hop.ms - now);
  if (dock) return Math.max(0, dock.start + dockMs - now);
  return 0;
}
export function undockStarship() { dock = null; }
/** The camera is gliding for ms: a parked ship fires its engines meanwhile,
 *  since on screen it is the one travelling (Ames: "not showing thrusters"). */
let cruise = {start: 0, ms: 0};
export function starshipCruise(ms: number) { cruise = {start: performance.now(), ms}; }
/** Is the ship on the move: still flying in, on a hop, or easing to its dock? */
let moving = true;
export function starshipMoving(): boolean { return moving; }
function viewAspect(): number {
  for (const p of viewerNow()?.display?.panels ?? []) if (p?.element?.classList?.contains('nge-3d-panel')) {
    const r = p.element.getBoundingClientRect(); if (r.height > 10) return r.width / r.height;
  }
  return window.innerWidth / Math.max(1, window.innerHeight);
}
/** Once landed: lift off and fly this route (nanometres), easing in and out,
 *  then hover at its end with the jets idling. */
export function starshipHop(route: number[][], seconds: number) {
  if (!shipNow) return;
  // Off the pad, a lift first; routes that start at the pad have their own.
  const lift = hop || !onPad ? [] : [add(shipNow, mul(liftNormal, 4000))];
  const start = route[0] as V3;
  const fromPad = onPad && !hop && Math.hypot(...sub(start, shipNow)) < 3000;
  let turn: V3[] = [];
  if (!onPad && noseNow) {
    const d = sub(start, shipNow), dl = Math.hypot(...d);
    if (dl > 1 && dot(mul(d, 1 / dl), noseNow) < 0.3) {
      let side = sub(d, mul(noseNow, dot(d, noseNow)));
      side = Math.hypot(...side) > dl * 0.05 ? norm(side) : upNow;
      const R = Math.max(2500, Math.min(dl * 0.35, 20000)) * sizeK;
      turn = [add(shipNow, add(mul(noseNow, R * 0.8), mul(side, R * 0.25))),
        add(shipNow, add(mul(noseNow, R * 0.75), mul(side, R * 0.9))),
        add(shipNow, add(mul(noseNow, R * 0.2), mul(side, R * 1.35)))];
    }
  }
  const path: V3[] = [shipNow, ...turn, ...(fromPad ? [] : lift), ...route.map(q => q as V3)];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(...sub(path[i], path[i - 1])));
  dock = null;
  onPad = false;
  hop = {path, cum, start: performance.now(), ms: seconds * 1000};
}
/** Where the ship is now (nm), and which way is up from where it landed. */
let shipNow: V3 | null = null;
/** Which way its nose and its top point now, and how big it is drawn
 *  (parked, it keeps its size on screen as the camera zooms: Ames, "it gets huger"). */
let noseNow: V3 | null = null;
let upNow: V3 = [0, -1, 0];
let sizeK = 1, dockArrivePs = 0;
/** Where the ship is now (nm), while it is out. */
export function starshipAt(): V3 | null { return running ? shipNow : null; }
let liftNormal: V3 = [0, -1, 0];
function along(path: V3[], cum: number[], s: number): V3 {
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  return mix(path[lo], path[hi], (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1));
}
const easeInOut = (q: number) => q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;

/* ── a flight ── */
let running = false;
let stopRequested = false;
let userTouched = false;
/** On a phone a touch only pauses the turn: it picks up again this long
 *  after the last one (a thumb scrolling past bumps the cell). */
const TOUCH_PAUSE_MS = 4000;
let touchedAt = 0;
let raf = 0;

const inView = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('.neuroglancer-panel, .nge-3d-panel, canvas');
let downAt: [number, number] | null = null;
function onUserTurn(e: Event) {
  if (!inView(e)) return;
  const pe = e as PointerEvent;
  if (pe.pointerType === 'touch') { touchedAt = performance.now(); return; }
  // On a laptop, once the player moves the cell by hand, the view never
  // starts turning on its own again (Ames). A wheel turn counts at once; a
  // mouse press counts only once it drags, so a plain click (on the cell,
  // or to bring the window forward) leaves the turn going.
  if (e.type === 'wheel') { userTouched = true; return; }
  downAt = [pe.clientX, pe.clientY];
}
function onUserDrag(e: PointerEvent) {
  if (e.pointerType === 'touch') { if (e.buttons && inView(e)) touchedAt = performance.now(); return; }
  if (!downAt || !e.buttons) { downAt = null; return; }
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) { userTouched = true; downAt = null; }
}
/** Turning is switched off in Settings > 3D looks ("Turn cells slowly"). */
function turnAllowed(): boolean {
  try { return useUserPreferencesStore().prefs.autoTurn !== false; } catch { return true; }
}
const handsOff = () => !userTouched && performance.now() - touchedAt > TOUCH_PAUSE_MS;

async function showSandboxCell(f: Flight): Promise<boolean> {
  const v = viewerNow();
  const sandbox = () => (v?.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived &&
    String(m?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf') && m.layer?.displayState?.segmentationGroupState?.value?.visibleSegments);
  if (!sandbox()) {
    const ds = findDatasetBySegName(SANDBOX_LAYER);
    if (!ds || !(await switchToDataset(ds, {forJump: true}))) return false;
  }
  for (let tries = 0; tries < 40; tries++) {
    const ml = sandbox();
    if (ml) {
      ml.setVisible?.(true);
      const g = ml.layer.displayState.segmentationGroupState.value;
      // just the one cell: anything left from before (a partner shown by an
      // earlier tour, a cell the player had up) steps aside for the flight
      g.visibleSegments.clear();
      g.visibleSegments.add(Uint64.parseString(f.segment));
      try {
        const hex = CELL_BLUE, packed = ((hex >> 16) & 0xff) | (hex & 0xff00) | ((hex & 0xff) << 16);
        setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, Uint64.parseString(f.segment), packed);
      } catch { /* keep its colour */ }
      oneBoundingBox();
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

/** Two boxes were drawn round the volume (the image's and the
 *  segmentation's); the intro keeps just the segmentation's (Ames). */
export function oneBoundingBox() {
  for (const ml of viewerNow()?.layerManager?.managedLayers ?? []) {
    for (const ds of ml?.layer?.dataSources ?? []) {
      const ls = ds?.loadState;
      if (String(ds?.spec?.url ?? '').includes('/segmentation/')) {
        // and the one left is drawn a deep, dark blue (Ames)
        try { ml.layer.annotationDisplayState.color.value = Float32Array.from([0.05, 0.1, 0.34]); } catch { /* keep its color */ }
        continue;
      }
      if (!ls?.subsources) continue;
      let changed = false;
      for (const sub of ls.subsources) if (sub?.subsourceEntry?.id === 'bounds' && sub.enabled) { sub.enabled = false; changed = true; }
      if (changed) try { ls.enabledSubsourcesChanged.dispatch(); } catch { /* leave it */ }
    }
  }
}

/** The portal (Ames 2026-11-08: "exactly 1,000,000x cooler"). Always
 *  facing the viewer: an iris of light draws itself round, two rims spin
 *  against each other (cyan and magenta), six arms of an accretion disk
 *  swirl in to a white hot core, sparks are flung off the rim. As the ship
 *  bursts through, a flash and a shockwave ring; then the rims spiral in,
 *  the whole thing zips shut and a last spark pops. */
const PORTAL_MAX = 900;
const portalGlow: NgeGlow = {positions: new Float32Array(PORTAL_MAX * 3), colors: new Float32Array(PORTAL_MAX * 4), sizesNm: new Float32Array(PORTAL_MAX), count: 0, nmRight: [1, 0, 0]};
const ZIP_AT = 4.1;
const SPARKS = Array.from({length: 48}, (_, k) => ({th: k * 2.399, sp: 0.7 + ((k * 37) % 11) / 11, off: ((k * 53) % 17) / 17}));
function drawPortal(nm: V3, right: V3, up: V3, c: V3, R: number, tp: number) {
  let n = 0;
  const put = (p: V3, rgba: number[], size: number) => {
    if (n >= PORTAL_MAX || rgba[3] <= 0.01) return;
    portalGlow.positions.set([p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]], n * 3);
    portalGlow.colors.set(rgba, n * 4);
    portalGlow.sizesNm[n] = size; n++;
  };
  const at2 = (r: number, th: number): V3 => add(c, add(mul(right, Math.cos(th) * r), mul(up, Math.sin(th) * r)));
  // (the ring itself is Ames's art, drawn over the view below)
  const open = smooth((tp - 0.3) / 1.0);         // the disk opening
  const zip = Math.max(0, (tp - ZIP_AT) / 0.7);  // closing
  const shut = smooth(Math.min(1, zip));
  const life = 1 - shut;
  const thrust = Math.max(0, tp - PORTAL_S);     // since the ship came through
  const cyan = [0.45, 0.9, 1], mag = [1, 0.4, 0.95], vio = [0.62, 0.45, 1], white = [1, 1, 1];
  const RR = R * (1 - 0.85 * shut);
  if (zip < 1.3) {
    // the disk: six arms curling in, spinning fast, twinkling
    const ARMS = 6, PER = 34;
    for (let a = 0; a < ARMS; a++) for (let k = 0; k < PER; k++) {
      const u = (k + 1) / PER;
      const th = a * 2 * Math.PI / ARMS + (1 - u) * 3.2 * Math.PI - tp * (3.2 - 1.6 * u) - shut * 9 * (1 - u);
      const col = a % 2 ? cyan : vio, tw = 0.65 + 0.35 * Math.sin(tp * 11 + k * 1.7 + a);
      put(at2(RR * open * u * 0.94, th), [col[0], col[1], col[2], 0.8 * open * life * tw * (0.35 + 0.65 * u)], R * (0.05 + 0.12 * u));
    }
    // sparks flung off the rim, curving away and fading
    for (const sp of SPARKS) {
      const q = ((tp * sp.sp + sp.off) % 1);
      const r = RR * (0.25 + 0.7 * q), th = sp.th + tp * 1.3 + q * 1.2;
      const col = sp.off > 0.5 ? cyan : mag;
      put(at2(r, th), [col[0], col[1], col[2], open * life * (1 - q) * 0.9], R * 0.07 * (1 - 0.5 * q));
    }
    // the core: white hot, breathing, with a violet halo
    const breathe = 1 + 0.12 * Math.sin(tp * 5);
    put(c, [vio[0], vio[1], vio[2], 0.45 * open * life], R * 2.6 * open * breathe);
    put(c, [cyan[0], cyan[1], cyan[2], 0.6 * open * life], R * 1.4 * open * breathe);
    put(c, [1, 1, 1, 0.95 * open * life], R * 0.55 * open * breathe);
  }
  // the ship bursts through: a flash and a shockwave ring
  if (thrust > 0 && thrust < 1.3) {
    const q = thrust / 1.3;
    put(c, [1, 1, 1, (1 - q) * 0.9], R * (1.5 + 2.5 * q));
    for (let j = 0; j < 72; j++) {
      const th = j / 72 * 2 * Math.PI;
      put(at2(R * (1 + 2.6 * q), th), [white[0], 0.95, 1, (1 - q) * 0.8], R * 0.12 * (1 - 0.5 * q));
    }
  }
  // shut: one last pop and a ring that falls in
  if (zip >= 1 && zip < 2) {
    const q = zip - 1;
    put(c, [1, 0.95, 1, 1 - q], R * (0.4 + 1.6 * q));
    for (let j = 0; j < 48; j++) put(at2(R * 1.6 * (1 - q), j / 48 * 2 * Math.PI + q * 3), [mag[0], mag[1], mag[2], (1 - q) * 0.8], R * 0.1);
  }
  portalGlow.count = n;
  portalGlow.nmRight = [right[0] / nm[0], right[1] / nm[1], right[2] / nm[2]];
  setNgeGlow(n ? portalGlow : null, 'starship-portal');
  placePortalArt(nm, right, c, R, open, shut, zip, thrust);
}
/** The ship's place on screen and size there, so the ring can let it show in
 *  front as it comes through (the ring is drawn over the view). */
let shipScreen: {x: number; y: number; r: number} | null = null;
/** The ring itself (Ames's art, static/intro/portal.png), laid over the view
 *  where the portal is: it opens with a little overshoot, wobbles as the ship
 *  bursts through, and shrinks away as the portal zips shut. Its opening is
 *  about half its width, so it is drawn twice the vortex's size. */
let portalArt: HTMLImageElement | null = null;
function placePortalArt(nm: V3, right: V3, c: V3, R: number, open: number, shut: number, zip: number, thrust: number) {
  const a = toScreenNm(nm, c), b = toScreenNm(nm, add(c, mul(right, R)));
  if (!a || !b || zip >= 1.1) { removePortalArt(); return; }
  if (!portalArt) {
    portalArt = document.createElement('img');
    portalArt.src = 'intro/portal.png';
    portalArt.alt = '';
    portalArt.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:50;transform-origin:50% 50%;filter:drop-shadow(0 0 18px rgba(80,220,255,0.55));';
    document.body.appendChild(portalArt);
  }
  const rPx = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pop = open < 1 ? 1 + 0.12 * Math.sin(Math.PI * open) : 1;
  const kick = thrust > 0 && thrust < 0.6 ? 1 + 0.06 * Math.sin(thrust / 0.6 * Math.PI) : 1;
  const k = Math.max(0, open * pop * kick * (1 - shut));
  const w = rPx * 2 / 0.5;
  portalArt.style.width = `${w.toFixed(1)}px`;
  portalArt.style.opacity = String(Math.min(1, open * 1.5) * (1 - shut));
  // a window in the ring where the ship is, so it passes in front of it
  if (shipScreen && open > 0.2) {
    // (the ring is scaled about its centre, so a point on screen sits at
    // (screen - centre) / scale + half its size in the ring's own box)
    const kk = Math.max(k, 0.01);
    const mx = (shipScreen.x - a[0]) / kk + w / 2, my = (shipScreen.y - a[1]) / kk + w * 0.4570;
    const rr = shipScreen.r * 1.25 / kk;
    const m = `radial-gradient(circle at ${mx.toFixed(1)}px ${my.toFixed(1)}px, transparent ${rr.toFixed(1)}px, #000 ${(rr + 4 / kk).toFixed(1)}px)`;
    portalArt.style.setProperty('mask-image', m); portalArt.style.setProperty('-webkit-mask-image', m);
  } else { portalArt.style.removeProperty('mask-image'); portalArt.style.removeProperty('-webkit-mask-image'); }
  portalArt.style.transform = `translate(${(a[0] - w / 2).toFixed(1)}px, ${(a[1] - w * 0.4570 ).toFixed(1)}px) scale(${k.toFixed(3)}) rotate(${(shut * 140).toFixed(1)}deg)`;
}
function removePortalArt() { portalArt?.remove(); portalArt = null; }
/** A point (nm) on screen, in CSS pixels, through the 3D view's projection. */
function toScreenNm(nm: V3, p: V3): [number, number] | null {
  for (const pn of viewerNow()?.display?.panels ?? []) {
    if (!pn?.element?.classList?.contains('nge-3d-panel')) continue;
    const m = pn.projectionParameters?.value?.viewProjectionMat;
    if (!m) return null;
    const x = p[0] / nm[0], y = p[1] / nm[1], z = p[2] / nm[2];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0) return null;
    const r = pn.element.getBoundingClientRect();
    return [r.left + (cx / cw + 1) / 2 * r.width, r.top + (1 - cy / cw) / 2 * r.height];
  }
  return null;
}

/** Hide the cell until its mesh has arrived, then draw it out from the soma
 *  with a bright growing edge. */
async function growCell(f: Flight, nm: V3) {
  const key = getObjectKey(Uint64.parseString(f.segment));
  const center: [number, number, number] = [f.soma[0] / nm[0], f.soma[1] / nm[1], f.soma[2] / nm[2]];
  const redraw = () => { try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ } };
  setNgeReveal({only: key, center, radiusNm: 0, edgeNm: 6000});
  redraw();
  // wait for the mesh: until some of it is drawn, then a moment more for the rest
  for (let k = 0; k < 120 && !cellDrawn(); k++) await new Promise(r => setTimeout(r, 250));
  await new Promise(r => setTimeout(r, 1500));
  // the tour's loading screen can go now (Ames: it "just stays black")
  window.dispatchEvent(new Event('nge-intro-ready'));
  const FAR = 320_000, MS = 2600, t0 = performance.now();
  await new Promise<void>(done => {
    const step = (now: number) => {
      const q = Math.min(1, (now - t0) / MS), e = 1 - Math.pow(1 - q, 2.2);
      setNgeReveal({only: key, center, radiusNm: 3000 + FAR * e, edgeNm: 6000 + 10_000 * e});
      redraw();
      if (q < 1 && !stopRequested) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  setNgeReveal(null);
  redraw();
}

/** The slow turn on its own, before any flight (Ames: "it should just
 *  rotate"): one turn every two minutes, with the same rule for hands, a
 *  drag on a laptop stops it for good, a touch on a phone pauses it. */
let idleRaf = 0;
export function startIdleTurn() {
  if (idleRaf) return;
  userTouched = false; touchedAt = 0;
  window.addEventListener('pointerdown', onUserTurn, true);
  window.addEventListener('wheel', onUserTurn, true);
  window.addEventListener('pointermove', onUserDrag, true);
  let last = performance.now();
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (running) { idleRaf = 0; return; }      // the flight turns it from here
    const v = viewerNow();
    if (v && handsOff() && turnAllowed() && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      try { v.perspectiveNavigationState.pose.rotateRelative(Float32Array.from([0, 1, 0]), 2 * Math.PI / TURN_SECONDS * dt); } catch { /* no view yet */ }
    }
    idleRaf = requestAnimationFrame(step);
  };
  idleRaf = requestAnimationFrame(step);
}

/** Fly the Starship into the Sandbox cell and land it on the soma.
 *  onLanded runs once, as it touches down. */
export async function flyStarship(onLanded?: () => void, skip = false, cameo = 0): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  cameraHeld = false;
  hop = null;
  shipNow = null;
  let landedCalled = false;
  userTouched = false;
  touchedAt = 0;
  try {
    await loadAssets();
    const f = flight!, mesh = model!;
    // cameo: no flight, no Sandbox; the ship just comes along and parks on
    // screen, this many times its usual size (MICrONS, Ames: "why no ship?")
    if (cameo) skip = true;
    if (!cameo && !(await showSandboxCell(f))) throw new Error('the Sandbox did not open');
    prepare(f);
    const v = viewerNow();
    const nm = nmPerUnit();
    if (!nm) throw new Error('no coordinates yet');
    // the cell first, grown out from its soma, then the portal (Ames: "load
    // cell first! and it is supposed to load from soma outward")
    if (!cameo && !skip) await growCell(f, nm);
    // The model's own length along its nose, so it is shipLength nm long.
    let zLo = Infinity, zHi = -Infinity, xHi = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) { zLo = Math.min(zLo, mesh.positions[i + 2]); zHi = Math.max(zHi, mesh.positions[i + 2]); xHi = Math.max(xHi, Math.abs(mesh.positions[i])); }
    const scale = f.shipLength * (cameo || 1) / ((zHi - zLo) || 1);
    // The two engines sit at the back, a third of the way out to each side.
    const nozzles: V3[] = [[xHi * 0.3, 0, zLo], [-xHi * 0.3, 0, zLo]];

    if (!cameo) try { v.layout.restoreState('3d'); } catch { /* keep the layout */ }
    // the layer side panel closes for the flight (Ames)
    try { v.selectedLayer.visible = false; } catch { /* no panel */ }
    // A clean picture, like the dataset tours: no axis lines (Ames 2026-11-07,
    // screen recording on a phone, where there is no key to hide them).
    try { v.showAxisLines.value = false; } catch { /* keep them */ }
    // where the view was, to ease from (Ames: no sudden changes)
    const q0 = quat.clone(v.projectionOrientation.orientation);
    const p0 = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
    const s0 = v.projectionScale.value;
    if (!cameo) v.projectionOrientation.restoreState([0, 0, 0, 1]);
    // The cell turns slowly in flight, a quarter of its usual speed, and
    // starts turned back by just that much: at touchdown it is square on, so
    // the pad (on the viewer's side of the soma) faces the camera (Ames).
    const FLIGHT_TURN = TURN_SECONDS * 4;
    // (plus a half turn: square on, the camera looks from the far side, Ames saw the ship land behind)
    if (!cameo) try { v.perspectiveNavigationState.pose.rotateRelative(Float32Array.from([0, 1, 0]), Math.PI - 2 * Math.PI / FLIGHT_TURN * (CRUISE_S + LANDING_S)); } catch { /* no view */ }
    const qStart = quat.clone(v.projectionOrientation.orientation);
    v.projectionOrientation.restoreState(Array.from(q0));
    // cameo: it arrives through its portal, high on the right, and curves
    // in to park (Ames: "it needed its portal")
    const cameoT0 = performance.now();
    let cameoPortal: V3 | null = null;
    if (cameo) { cameraHeld = true; onPad = false; dockMs = 3800; dock = {fx: 0.62, fy: -0.3, start: cameoT0 + PORTAL_S * 1000, from: null}; }
    let flightAngle = 0;
    // after landing the cell rocks gently either side of square on rather
    // than turning all the way round, so it stays broadside, the wide view
    // (Ames), and the pad stays on the viewer's side; it leaves the flight's
    // turn at the same speed, so there is no lurch
    const ROCK_P = 150, ROCK_A = (2 * Math.PI / FLIGHT_TURN) * ROCK_P / (2 * Math.PI);
    let rockT = 0;
    const BLEND_S = 1.6;
    // no colour flashing as the turning cell slides under the mouse
    setHoverHighlight(false);
    // projectionScale is in the coordinate space's smallest unit
    const unit = Math.min(nm[0], nm[1], nm[2]);
    const WIDE = WIDE_NM / unit, CLOSE = CLOSE_NM / unit;
    const somaAt: V3 = [...f.soma] as V3;
    liftNormal = norm(f.landNormal);
    const padAt = at(f, Infinity);

    const prop: NgeProp = {mesh, modelMat: mat4.create(), alpha: 1, dissolve: 0, seed: 0.3, glow: [0.02, 0.04, 0.08], rim: [0.45, 0.85, 1.0], shade: 1.15};
    setNgeProps([prop], GROUP);
    particles = [];
    window.addEventListener('pointerdown', onUserTurn, true);
    window.addEventListener('wheel', onUserTurn, true);
    window.addEventListener('pointermove', onUserDrag, true);

    const total = CRUISE_S + LANDING_S;
    let keepScale = 0;
    // the portal sits a little ahead of where the route begins, facing along it
    // the portal sits where the route begins
    const portalAt = at(f, 0);
    const portalR = f.shipLength * 0.75;
    const EMERGE_S = 1.7;
    let portalShown = true;
    const zoomAt = (tt: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(Math.max(0, Math.min(1, tt / total)), 1.5));
    const aspect0 = Math.max(0.5, Math.min(1, window.innerWidth / Math.max(1, window.innerHeight)));
    const ROOM_DT = 0.1, room: number[] = [];
    for (let tt = 0; tt <= total + ROOM_DT; tt += ROOM_DT) {
      const ctr = mix(somaAt, padAt, zoomAt(tt) * 0.5);
      const off = Math.hypot(...sub(at(f, distanceAt(f, Math.min(tt, total))), ctr));
      room.push((2.1 * off / aspect0 + 9000) / unit);
    }
    for (let k = room.length - 2; k >= 0; k--) room[k] = Math.max(room[k], room[k + 1]);   // the widest still to come
    const roomAt = (tt: number) => {
      const x = Math.max(0, tt) / ROOM_DT, k = Math.min(room.length - 2, Math.floor(x)), q = Math.min(1, x - k);
      return room[k] + (room[k + 1] - room[k]) * q;
    };
    // skip: already landed (for testing the tour's later steps)
    const start = performance.now() - (skip ? (PORTAL_S + total + 0.5) * 1000 : 0);
    let last = start, emitDebt = 0;
    let prevCores: V3[] | null = null;
    let prevUp: V3 | null = null;
    let prevFwd: V3 | null = null;
    let prevPos: V3 | null = null;
    let dockBend: V3 = [0, 0, 0];
    await new Promise<void>(done => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const tAll = (now - start) / 1000, t = tAll - PORTAL_S;
        if (stopRequested) { done(); return; }
        const blend = smooth(tAll / BLEND_S);
        const cam = cameraAxes(nm);
        if (!cam) { raf = requestAnimationFrame(step); return; }

        // the slow turn, until someone takes hold of the cell
        if (handsOff() && turnAllowed() && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          let da = t > 0 ? 2 * Math.PI / FLIGHT_TURN * dt : 0;
          if (t >= total) { const w = 2 * Math.PI / ROCK_P; da = ROCK_A * (Math.sin(w * (rockT + dt)) - Math.sin(w * rockT)); rockT += dt; }
          // while the tour talks the cell holds still, so the ship and its
          // hologram do not drift (Ames)
          if (cameraHeld && t >= total) da = 0;
          if (tAll < BLEND_S) {
            // easing in from the old view: set the turn outright
            flightAngle += da;
            const r = quat.setAxisAngle(quat.create(), [0, 1, 0], flightAngle), qf = quat.multiply(quat.create(), qStart, r);
            const q = quat.slerp(quat.create(), q0, qf, blend);
            try { v.projectionOrientation.restoreState(Array.from(q)); } catch { /* no view */ }
          } else if (da) {
            try { v.perspectiveNavigationState.pose.rotateRelative(Float32Array.from([0, 1, 0]), da); } catch { /* no view */ }
          }
        }
        // in on the soma, slowly, all the way in (Ames: the camera zooms in
        // as the ship flies in), a touch faster at the end
        // (the camera holds still otherwise, it does not chase the ship, so
        // the zoom stays wide while the ship weaves and closes in late)
        // late, and easing to a stop as it lands, so the welcome view picks up
        // from rest
        const zoom = zoomAt(t);
        if (handsOff() && !cameraHeld) {
          // never so close that the ship leaves the frame (Ames), and never
          // backing out again: in flight it only closes in
          let sc = Math.max(WIDE * Math.pow(CLOSE / WIDE, zoom), t < total ? roomAt(t) : 0);
          if (keepScale && t > 0 && t < total) sc = Math.min(sc, keepScale);
          // eased, and never faster than about 35% a second, so no jumps
          if (!keepScale || tAll < BLEND_S) keepScale = sc;
          else { const step = Math.max(-0.35 * dt, Math.min(0.35 * dt, Math.log(sc / keepScale) * Math.min(1, dt * 2))); keepScale *= Math.exp(step); }
          // and over toward the landing pad, so ship and soma share the frame
          let c = mix(somaAt, padAt, zoom * 0.5), scNow = keepScale;
          if (tAll < BLEND_S) { c = mix(p0, c, blend); scNow = s0 * Math.pow(keepScale / s0, blend); }
          v.projectionScale.value = scNow;
          v.navigationState.position.value = Float32Array.from(c.map((x, i) => x / nm[i]));
        }

        if (t >= total && !landedCalled) { landedCalled = true; try { onLanded?.(); } catch (e) { console.warn('[starship] after landing:', e); } }
        // On the first route, or a hop the tour asked for since.
        const h = hop;
        const hq = h ? Math.min(1, (now - h.start) / h.ms) : 0;
        const pathAt = h ? (d: number) => along(h.path, h.cum, d) : (d: number) => at(f, d);
        const s = h ? h.cum[h.cum.length - 1] * easeInOut(hq) : distanceAt(f, Math.max(0, Math.min(t, total)));
        let pos = pathAt(s);
        const ahead = pathAt(s + 1500), behind = pathAt(s - 1500);
        let fwd = Math.hypot(...sub(ahead, behind)) > 50 ? norm(sub(ahead, behind)) : (prevFwd ?? norm(sub(ahead, behind)));
        // out of the portal: through its core toward the viewer, growing as
        // it comes, then turning onto its way through the cell (Ames)
        let grow = 1;
        if (!h && !dock && t < EMERGE_S) grow = 0.25 + 0.75 * smooth(Math.max(0, t) / 0.8);
        const tc = cameo ? (now - cameoT0) / 1000 : 0;
        if (cameo && dock && !cameoPortal) {
          const ctr0 = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
          const H0 = v.projectionScale.value * Math.min(nm[0], nm[1], nm[2]), W0 = H0 * viewAspect();
          cameoPortal = add(ctr0, add(mul(cam.right, W0 * 0.36), mul(cam.up, H0 * 0.3)));
          dock.from = cameoPortal;
        }
        if (cameo) grow = 0.25 + 0.75 * smooth(Math.max(0, tc - PORTAL_S) / 0.8);
        // riding along with a camera move counts as moving: its hologram waits
        moving = h ? hq < 1 : dock ? now - dock.start < dockMs || now - cruise.start < cruise.ms : t < total;
        {
          const ps = v.projectionScale.value;
          let target = 1;
          if (dock && now - dock.start >= dockMs) {
            if (!dockArrivePs) dockArrivePs = ps;
            target = Math.max(0.2, Math.min(4, ps / dockArrivePs));
          } else dockArrivePs = 0;
          sizeK += (target - sizeK) * Math.min(1, dt * (dock ? 30 : 1.5));
        }
        if (dock) {
          const ctr = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
          const H = v.projectionScale.value * Math.min(nm[0], nm[1], nm[2]), Wd = H * viewAspect();
          const target = add(ctr, add(mul(cam.right, dock.fx * Wd / 2), mul(cam.up, dock.fy * H / 2)));
          const dq = smooth((now - dock.start) / dockMs);
          // a banked curve: out past the spot and swinging back round to it,
          // so it arrives nose first, facing the cell (Ames: it flew backwards)
          const ctrl = add(target, add(mul(cam.right, Wd * 0.32), mul(cam.up, H * 0.2)));
          const B = (u: number): V3 => {
            if (!dock!.from) return target;
            const a1 = mix(dock!.from, ctrl, u), b1 = mix(ctrl, target, u);
            return mix(a1, b1, u);
          };
          pos = B(dq);
          dockBend = sub(sub(B(Math.min(1, dq + 0.04)), pos), sub(pos, B(Math.max(0, dq - 0.04))));
          // nose on the way it is going, turning to face the cell only as it
          // arrives (Ames: it flew backwards)
          // the nose along the curve itself, from its very first moment (out
          // of the portal the ship barely moves, so its speed says nothing:
          // Ames, "flies BACKWARDS OUT OF THE PORTAL")
          const tan = sub(B(Math.min(1, dq + 0.02)), B(Math.max(0, dq - 0.02)));
          const goDir = dq < 1 && dock.from && Math.hypot(...tan) > 1 ? norm(tan) : (prevFwd ?? fwd);
          fwd = norm(mix(goDir, mul(cam.right, -1), smooth((dq - 0.9) / 0.1)));
        }
        // ending a hop the ship levels out, nose sideways across the screen,
        // not parked standing on end (Ames)
        // (only once it has stopped: in flight the nose always points the
        // way it goes, Ames)
        if (h && hq >= 1) {
          const lv = smooth((now - h.start - h.ms) / 900);
          let flat = sub(sub(fwd, mul(cam.up, dot(fwd, cam.up))), mul(cam.toEye, dot(fwd, cam.toEye) * 0.6));
          if (Math.hypot(...flat) < 0.25) flat = mul(cam.right, dot(fwd, cam.right) < 0 ? -1 : 1);
          if (lv > 0) fwd = norm(mix(fwd, norm(flat), lv));
        }
        if (prevFwd && (h || dock)) fwd = norm(mix(prevFwd, fwd, Math.min(1, dt * (dock ? 20 : h && hq < 1 ? 16 : 6))));
        prevPos = pos;
        prevFwd = fwd;
        // banking: roll into the turn
        let bend: V3 = dock ? mul(dockBend, 6) : sub(sub(pathAt(s + 4000), pos), sub(pos, pathAt(s - 4000)));
        const bl = Math.hypot(...bend) / 2500;
        if (bl > 0.9) bend = mul(bend, 0.9 / bl);
        let up = norm(add(sub(cam.up, mul(fwd, dot(cam.up, fwd))), mul(bend, 1 / 2500)));
        if (dock) up = norm(mix(up, cam.toEye, smooth(((now - dock.start) / dockMs - 0.6) / 0.4)));
        // the landing: level onto the pad, nose kept flat to it
        const land = h || dock ? 0 : smooth((t - CRUISE_S - LANDING_S * 0.2) / (LANDING_S * 0.7));
        if (land > 0) {
          up = norm(mix(up, f.landNormal, land));
          const flat = sub(fwd, mul(up, dot(fwd, up)));
          if (Math.hypot(...flat) > 1e-3) fwd = norm(mix(fwd, norm(flat), land));
        }
        if (prevUp) up = norm(mix(prevUp, up, Math.min(1, dt * 6)));
        prevUp = up;   // (the roll below is added after this, so it is not smoothed away)
        fwd = norm(sub(fwd, mul(up, dot(fwd, up))));
        // a quick barrel roll partway along the weave (Ames: "a little tiny
        // quick flip"), about the ship's own length
        if (!h && !dock && f.rollAt !== undefined) {
          const rq = (s - f.rollAt) / (f.rollLen ?? 20000);
          if (rq > 0 && rq < 1) {
            const a = 4 * Math.PI * smooth(rq), side = cross(fwd, up);   // two rolls (Ames: a little longer)
            up = norm(add(mul(up, Math.cos(a)), mul(side, Math.sin(a))));
          }
        }
        const right = norm(cross(up, fwd));
        // a gentle bob once down; hovering at a hop's end, a slow float
        const settled = Math.max(0, t - total);
        const bob: V3 = h ? (hq >= 1 ? mul(up, 90 * Math.sin((now - h.start - h.ms) / 1000 * 1.1)) : [0, 0, 0])
          : settled > 0 ? mul(f.landNormal, 120 * Math.sin(settled * 3) * Math.exp(-settled * 1.6)) : [0, 0, 0];
        const at3 = add(pos, bob);
        shipNow = pos;

        const m = prop.modelMat;
        const axes = [right, up, fwd];
        noseNow = fwd; upNow = up;
        for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) m[col * 4 + k] = axes[col][k] * scale * grow * sizeK / nm[k];
        for (let k = 0; k < 3; k++) m[12 + k] = at3[k] / nm[k];
        prop.eye = [dot(right, cam.toEye), dot(up, cam.toEye), dot(fwd, cam.toEye)];

        // engine: full while cruising, easing down through the landing and
        // off once it stops (Ames 2026-11-08: engines off when stopped); the
        // trail left behind fades on its own
        const IDLE = 0;
        const dockQ = dock ? (now - dock.start) / dockMs : 1;
        const cq = (now - cruise.start) / Math.max(1, cruise.ms);
        const ride = dock && cq < 1 ? Math.min(1, Math.sin(Math.PI * Math.max(0, cq)) * 1.6) : 0;
        const down = dock ? Math.max(ride, dockQ < 1 ? Math.min(1, Math.sin(Math.PI * dockQ) * 1.6) : IDLE)
          : h ? (hq < 1 ? Math.max(IDLE, Math.min(1, Math.sin(Math.PI * hq) * 1.6)) : IDLE)
          : t < 0 ? 0 : t < CRUISE_S ? 1 : Math.max(IDLE, 1 - (t - CRUISE_S) / (LANDING_S * 0.9) * (1 - IDLE));
        // through the portal: the ship shows as it comes out of the light
        prop.alpha = cameo ? (tc < PORTAL_S ? 0 : Math.min(1, (tc - PORTAL_S) / 0.25)) : t < 0 ? 0 : Math.min(1, t / 0.25);
        if (cameo && cameoPortal && tc < ZIP_AT + 1.5) {
          const sp = toScreenNm(nm, at3), se = toScreenNm(nm, add(at3, mul(cam.right, f.shipLength * cameo * 0.6 * grow)));
          shipScreen = sp && se && tc > PORTAL_S ? {x: sp[0], y: sp[1], r: Math.hypot(se[0] - sp[0], se[1] - sp[1])} : null;
          drawPortal(nm, cam.right, cam.up, cameoPortal, f.shipLength * cameo * 0.75, tc);
        } else if (cameo && cameoPortal && tc < ZIP_AT + 2) { setNgeGlow(null, 'starship-portal'); removePortalArt(); }
        if (tAll < ZIP_AT + 1.5) {
          const sp = toScreenNm(nm, at3), se = toScreenNm(nm, add(at3, mul(cam.right, f.shipLength * 0.6 * grow)));
          shipScreen = sp && se && t > -0.05 ? {x: sp[0], y: sp[1], r: Math.hypot(se[0] - sp[0], se[1] - sp[1])} : null;
        }
        if (tAll < ZIP_AT + 1.5) drawPortal(nm, cam.right, cam.up, portalAt, portalR, tAll);
        else if (portalShown && !cameo) { portalShown = false; setNgeGlow(null, 'starship-portal'); removePortalArt(); }
        const power = !dock && t < 0 ? 0 : t > CRUISE_S ? down * (0.9 + 0.1 * Math.sin(t * 23) * Math.sin(t * 7.3)) : down;
        const sg = scale * grow * sizeK;
        const toWorld = (q: V3): V3 => add(at3, add(add(mul(right, q[0] * sg), mul(up, q[1] * sg)), mul(fwd, q[2] * sg)));
        const cores = nozzles.map(q => ({p: toWorld(q), power}));
        // Released all along the way the engines moved since the last frame,
        // not in a clump at each frame, so the trail is one smooth streak.
        emitDebt += dt * 520 * power;
        while (emitDebt >= 1 && particles.length < MAX_PARTICLES) {
          emitDebt -= 1;
          const k = Math.random() < 0.5 ? 0 : 1, along = Math.random();
          const c = prevCores ? mix(prevCores[k], cores[k].p, along) : cores[k].p;
          const jitter: V3 = [(Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)];
          const L = f.shipLength * (cameo || 1) * sizeK;
          if (ride > 0 && dockQ >= 1) continue;
          particles.push({p: add(c, mul(jitter, L * 0.03)), v: add(mul(fwd, -L * (0.4 + Math.random() * 0.3)), mul(jitter, L * 0.12)), age: (1 - along) * dt, size: L * (0.14 + Math.random() * 0.1)});
        }
        prevCores = cores.map(c => c.p);
        for (const q of particles) { q.age += dt; q.p = add(q.p, mul(q.v, dt)); q.v = mul(q.v, Math.max(0, 1 - dt * 2.2)); }
        particles = particles.filter(q => q.age < LIFE_S);
        // flames sized to the ship as drawn (nine times bigger in MICrONS: Ames, "no thrusters")
        writeGlow(nm, cam.right, cores, f.shipLength * (cameo || 1) * sizeK);

        try { v.display.scheduleRedraw(); } catch { /* nothing to redraw */ }
        // Landed, it keeps floating (and drawing) until it is taken away.
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    setNgeGlow(null, GROUP);
    if (stopRequested) setNgeProps([], GROUP);
    try { v.display.scheduleRedraw(); } catch { /* nothing to redraw */ }
  } catch (e: any) {
    console.warn('[starship] no flight:', e?.message ?? e);
    setNgeProps([], GROUP);
    setNgeGlow(null, GROUP);
  } finally {
    window.dispatchEvent(new Event('nge-intro-ready'));
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerdown', onUserTurn, true);
    window.removeEventListener('wheel', onUserTurn, true);
    window.removeEventListener('pointermove', onUserDrag, true);
    running = false;
  }
}

/** Take the Starship away (it stays on the soma after landing until then). */
/** The Sandbox layer's hover highlight, off for the intro and back after. */
let savedHover: boolean | null = null;
export function setHoverHighlight(on: boolean) {
  for (const ml of viewerNow()?.layerManager?.managedLayers ?? []) {
    const hh = ml?.layer?.displayState?.hoverHighlight;
    if (!hh || !String(ml?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf')) continue;
    if (!on) { if (savedHover === null) savedHover = !!hh.value; hh.value = false; }
    else if (savedHover !== null) { hh.value = savedHover; savedHover = null; }
  }
}

export function clearStarship() {
  setNgeReveal(null);
  removePortalArt();
  setHoverHighlight(true);
  stopRequested = true;
  setNgeProps([], GROUP);
  setNgeGlow(null, GROUP);
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

/** Is enough of the Sandbox cell drawn to fly into? The same test the
 *  pumpkins use: most of the cell's mesh pieces are on the graphics card. */
export function cellDrawn(): boolean {
  const v = viewerNow();
  for (const ml of v?.layerManager?.managedLayers ?? []) {
    if (!String(ml?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf')) continue;
    const segs = ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (!segs?.size) continue;
    for (const rl of ml.layer.renderLayers ?? []) {
      const src = rl?.source;
      if (!src?.chunks?.get || !src.fragmentSource?.chunks?.get || typeof src.getFragmentKey !== 'function') continue;
      for (const seg of segs) {
        const key = `${seg.low},${seg.high}`;
        const ids: string[] = src.chunks.get(key)?.fragmentIds ?? [];
        if (!ids.length) continue;
        let drawn = 0;
        for (const id of ids) if (src.fragmentSource.chunks.get(src.getFragmentKey(key, id).key)?.state === 0) drawn++;
        if (drawn / ids.length >= 0.6) return true;
      }
    }
  }
  return false;
}

(window as any).pyrStarship = {fly: flyStarship, clear: clearStarship};
