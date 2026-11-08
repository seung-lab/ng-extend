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
 * Nothing runs until a flight starts, and nothing is redrawn once it ends.
 */
import {setNgeGlow, setNgeProps, type NgeGlow, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {loadGlbModel} from './glb';
import {findDatasetBySegName, switchToDataset} from '../datasets';

type V3 = [number, number, number];
interface Flight { path: number[][]; landingStart: number; landNormal: V3; soma: V3; shipLength: number; segment: string; }

const SANDBOX_LAYER = 'pinky_nf_v2';
const GROUP = 'starship';
/** One full turn of the view every two minutes (Ames). */
const TURN_SECONDS = 120;
/** Seconds of flight before the landing starts, and for the landing. */
const CRUISE_S = 14;
const LANDING_S = 3.2;
/** How much shows from top to bottom of the view: the whole cell, then in
 *  close on the soma for the landing, in nanometres. */
const WIDE_NM = 260_000, CLOSE_NM = 30_000;

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
async function loadAssets() {
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
function cameraAxes(nm: V3): {right: V3; up: V3; toEye: V3} | null {
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

/* ── a flight ── */
let running = false;
let stopRequested = false;
let userTouched = false;
let raf = 0;

function onUserTurn(e: Event) {
  // On a laptop, once the player moves the cell by hand, the view never
  // starts turning on its own again (Ames).
  if ((e.target as HTMLElement | null)?.closest?.('.neuroglancer-panel, .nge-3d-panel, canvas')) userTouched = true;
}

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
      if (g.visibleSegments.size === 0) g.visibleSegments.add(Uint64.parseString(f.segment));
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

/** Fly the Starship into the Sandbox cell and land it on the soma. */
export async function flyStarship(): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  userTouched = false;
  try {
    await loadAssets();
    const f = flight!, mesh = model!;
    if (!(await showSandboxCell(f))) throw new Error('the Sandbox did not open');
    prepare(f);
    const v = viewerNow();
    const nm = nmPerUnit();
    if (!nm) throw new Error('no coordinates yet');
    // The model's own length along its nose, so it is shipLength nm long.
    let zLo = Infinity, zHi = -Infinity, xHi = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) { zLo = Math.min(zLo, mesh.positions[i + 2]); zHi = Math.max(zHi, mesh.positions[i + 2]); xHi = Math.max(xHi, Math.abs(mesh.positions[i])); }
    const scale = f.shipLength / ((zHi - zLo) || 1);
    // The two engines sit at the back, a third of the way out to each side.
    const nozzles: V3[] = [[xHi * 0.3, 0, zLo], [-xHi * 0.3, 0, zLo]];

    try { v.layout.restoreState('3d'); } catch { /* keep the layout */ }
    v.navigationState.position.value = Float32Array.from(f.soma.map((c, i) => c / nm[i]));
    v.projectionOrientation.restoreState([0, 0, 0, 1]);
    // projectionScale is in the coordinate space's smallest unit
    const unit = Math.min(nm[0], nm[1], nm[2]);
    const WIDE = WIDE_NM / unit, CLOSE = CLOSE_NM / unit;
    v.projectionScale.value = WIDE;
    const somaAt: V3 = [...f.soma] as V3;
    const padAt = at(f, Infinity);

    const prop: NgeProp = {mesh, modelMat: mat4.create(), alpha: 1, dissolve: 0, seed: 0.3, glow: [0.02, 0.04, 0.08], rim: [0.45, 0.85, 1.0], shade: 1.15};
    setNgeProps([prop], GROUP);
    particles = [];
    window.addEventListener('pointerdown', onUserTurn, true);
    window.addEventListener('wheel', onUserTurn, true);

    const total = CRUISE_S + LANDING_S;
    const start = performance.now();
    let last = start, emitDebt = 0;
    let prevCores: V3[] | null = null;
    let prevUp: V3 | null = null;
    await new Promise<void>(done => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = (now - start) / 1000;
        if (stopRequested) { done(); return; }
        const cam = cameraAxes(nm);
        if (!cam) { raf = requestAnimationFrame(step); return; }

        // the slow turn, until someone takes hold of the cell
        if (!userTouched && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          try { v.perspectiveNavigationState.pose.rotateRelative(Float32Array.from([0, 1, 0]), 2 * Math.PI / TURN_SECONDS * dt); } catch { /* no view */ }
        }
        // in on the soma as the ship comes home
        const zoom = smooth((t - (CRUISE_S - 4)) / (4 + LANDING_S));
        if (!userTouched) {
          v.projectionScale.value = WIDE * Math.pow(CLOSE / WIDE, zoom);
          // and over toward the landing pad, so the ship lands mid screen
          const c = mix(somaAt, padAt, zoom * 0.85);
          v.navigationState.position.value = Float32Array.from(c.map((x, i) => x / nm[i]));
        }

        const s = distanceAt(f, Math.min(t, total));
        const pos = at(f, s);
        const ahead = at(f, s + 1500), behind = at(f, s - 1500);
        let fwd = norm(sub(ahead, behind));
        // banking: roll into the turn
        const bend = sub(sub(at(f, s + 4000), pos), sub(pos, at(f, s - 4000)));
        let up = norm(add(sub(cam.up, mul(fwd, dot(cam.up, fwd))), mul(bend, 1 / 2500)));
        // the landing: level onto the pad, nose kept flat to it
        const land = smooth((t - CRUISE_S - LANDING_S * 0.2) / (LANDING_S * 0.7));
        if (land > 0) {
          up = norm(mix(up, f.landNormal, land));
          const flat = sub(fwd, mul(up, dot(fwd, up)));
          if (Math.hypot(...flat) > 1e-3) fwd = norm(mix(fwd, norm(flat), land));
        }
        if (prevUp) up = norm(mix(prevUp, up, Math.min(1, dt * 6)));
        prevUp = up;
        fwd = norm(sub(fwd, mul(up, dot(fwd, up))));
        const right = norm(cross(up, fwd));
        // a gentle bob once down
        const settled = Math.max(0, t - total);
        const bob = settled > 0 ? mul(f.landNormal, 120 * Math.sin(settled * 3) * Math.exp(-settled * 1.6)) : [0, 0, 0] as V3;
        const at3 = add(pos, bob);

        const m = prop.modelMat;
        const axes = [right, up, fwd];
        for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) m[col * 4 + k] = axes[col][k] * scale / nm[k];
        for (let k = 0; k < 3; k++) m[12 + k] = at3[k] / nm[k];
        prop.eye = [dot(right, cam.toEye), dot(up, cam.toEye), dot(fwd, cam.toEye)];

        // engine: full while cruising, powering down through the landing
        const power = t < CRUISE_S ? 1 : Math.max(0, 1 - (t - CRUISE_S) / (LANDING_S * 0.9));
        const toWorld = (q: V3): V3 => add(at3, add(add(mul(right, q[0] * scale), mul(up, q[1] * scale)), mul(fwd, q[2] * scale)));
        const cores = nozzles.map(q => ({p: toWorld(q), power}));
        // Released all along the way the engines moved since the last frame,
        // not in a clump at each frame, so the trail is one smooth streak.
        emitDebt += dt * 520 * power;
        while (emitDebt >= 1 && particles.length < MAX_PARTICLES) {
          emitDebt -= 1;
          const k = Math.random() < 0.5 ? 0 : 1, along = Math.random();
          const c = prevCores ? mix(prevCores[k], cores[k].p, along) : cores[k].p;
          const jitter: V3 = [(Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)];
          particles.push({p: add(c, mul(jitter, f.shipLength * 0.03)), v: add(mul(fwd, -f.shipLength * (0.4 + Math.random() * 0.3)), mul(jitter, f.shipLength * 0.12)), age: (1 - along) * dt, size: f.shipLength * (0.14 + Math.random() * 0.1)});
        }
        prevCores = cores.map(c => c.p);
        for (const q of particles) { q.age += dt; q.p = add(q.p, mul(q.v, dt)); q.v = mul(q.v, Math.max(0, 1 - dt * 2.2)); }
        particles = particles.filter(q => q.age < LIFE_S);
        writeGlow(nm, cam.right, cores, f.shipLength);

        try { v.display.scheduleRedraw(); } catch { /* nothing to redraw */ }
        // done once landed, settled, and the last of the trail has faded
        if (t > total + 2.2 && particles.length === 0) { done(); return; }
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
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerdown', onUserTurn, true);
    window.removeEventListener('wheel', onUserTurn, true);
    running = false;
  }
}

/** Take the Starship away (it stays on the soma after landing until then). */
export function clearStarship() {
  stopRequested = true;
  setNgeProps([], GROUP);
  setNgeGlow(null, GROUP);
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

(window as any).pyrStarship = {fly: flyStarship, clear: clearStarship};
