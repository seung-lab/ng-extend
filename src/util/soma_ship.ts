/**
 * The Starship as a soma marker (Ames 2026-11-13, prototype "A"): in the
 * Sandbox some cells come with other somas merged on, and a player can't
 * tell which soma is theirs. The ship button on the slim Cell Library bar
 * sends the intro's Starship (src/util/starship.ts) down onto the player's
 * own soma, and it stays parked there as the marker.
 *
 * Kept light on purpose (Ames: a full flight "might be too much"): a short
 * drop from above, along the camera's up direction, to a spot just outside
 * the soma, then the engines go quiet. It never moves the camera. Once the
 * landing bob has settled nothing keeps redrawing; the ship only refreshes
 * its size and lighting when the view draws anyway, so it costs nothing
 * while the player just looks.
 */
import {setNgeGlow, setNgeProps, type NgeGlow, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {loadGlbModel} from './glb';
import {cameraAxes} from './starship';

type V3 = [number, number, number];
const GROUP = 'soma-ship';
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const viewerNow = (): any => (window as any).viewer;

/** How far from the nucleus point the ship sets down: about a soma's radius
 *  in the Sandbox (the intro's pad on its own cell is 10 um out), a bit up
 *  and a bit toward the viewer, so it sits on the soma's near top. */
const PAD_UP_NM = 8500, PAD_EYE_NM = 4500;
/** The drop: this many ship lengths above the pad, over this long. */
const DROP_LENGTHS = 7, DROP_MS = 2300, SETTLE_MS = 2200;

let model: NgePropMesh | null = null;
let modelLen = 1, nozzles: V3[] = [];
async function loadModel() {
  if (model) return model;
  model = await loadGlbModel('intro/starship.glb');
  let zLo = Infinity, zHi = -Infinity, xHi = 0;
  for (let i = 0; i < model.positions.length; i += 3) { zLo = Math.min(zLo, model.positions[i + 2]); zHi = Math.max(zHi, model.positions[i + 2]); xHi = Math.max(xHi, Math.abs(model.positions[i])); }
  modelLen = (zHi - zLo) || 1;
  nozzles = [[xHi * 0.3, 0, zLo], [-xHi * 0.3, 0, zLo]];
  return model;
}

function nmPerUnit(): V3 | null {
  const scales = viewerNow()?.coordinateSpace?.value?.scales;
  if (!scales || scales.length < 3) return null;
  return [0, 1, 2].map(i => (Number(scales[i]) || 1e-9) * 1e9) as V3;
}
/** The 3D view's height, in nm. */
function viewHeightNm(nm: V3): number {
  return (Number(viewerNow()?.projectionScale?.value) || 1e4) * Math.min(nm[0], nm[1], nm[2]);
}

interface Parked {
  key: string; soma: V3; up: V3; top: V3; fwd: V3; start: number; prop: NgeProp;
  raf: number; unhook: (() => void) | null; particles: {p: V3; age: number; size: number}[];
}
let parked: Parked | null = null;

const glow: NgeGlow = {positions: new Float32Array(400 * 3), colors: new Float32Array(400 * 4), sizesNm: new Float32Array(400), count: 0, nmRight: [1, 0, 0]};

/** Which cell the ship sits on now, if any. */
export function somaShipKey(): string | null { return parked?.key ?? null; }

/** Send the ship down onto this soma (nucleus point in the viewer's voxel
 *  coordinates). key names the cell, so the bar knows when to take it away.
 *  Resolves once it has touched down (false if it could not fly). */
export async function landShipOnSoma(voxel: [number, number, number], key: string): Promise<boolean> {
  clearSomaShip();
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return false;
  let mesh: NgePropMesh;
  try { mesh = await loadModel(); } catch (e: any) { console.warn('[soma ship] no model:', e?.message ?? e); return false; }
  const cam = cameraAxes(nm);
  if (!cam) return false;
  const soma: V3 = [voxel[0] * nm[0], voxel[1] * nm[1], voxel[2] * nm[2]];
  // Landed level on the soma's top as seen now, nose across the screen and a
  // little toward the viewer, so its back shows (the intro's three-quarter view).
  // (its top tipped toward the viewer, so its back shows, not its thin edge)
  const up = cam.up, top = norm(add(mul(cam.up, 0.75), mul(cam.toEye, 0.66)));
  const fwd = norm(sub(add(cam.right, mul(cam.toEye, 0.35)), mul(top, dot(add(cam.right, mul(cam.toEye, 0.35)), top))));
  const prop: NgeProp = {mesh, modelMat: mat4.create(), alpha: 0, dissolve: 0, seed: 0.3, glow: [0.02, 0.04, 0.08], rim: [0.45, 0.85, 1.0], shade: 1.15};
  const p: Parked = {key, soma, up, top, fwd, start: performance.now(), prop, raf: 0, unhook: null, particles: []};
  parked = p;
  setNgeProps([prop], GROUP);
  const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (still) p.start -= DROP_MS + SETTLE_MS;
  // between frames the view may draw for its own reasons (the player turning
  // or zooming): the ship keeps its size on screen and its lighting
  p.unhook = v.display?.updateStarted?.add?.(() => { if (parked === p) place(p, performance.now(), false); }) ?? null;
  return new Promise<boolean>(done => {
    let landed = false, last = performance.now();
    const step = (now: number) => {
      if (parked !== p) { done(landed); return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      place(p, now, true, dt);
      try { v.display.scheduleRedraw(); } catch { /* nothing to redraw */ }
      const t = now - p.start;
      if (!landed && t >= DROP_MS) { landed = true; done(true); }
      // settled and the trail gone: stop asking for frames
      if (t >= DROP_MS + SETTLE_MS && !p.particles.length) { p.raf = 0; setNgeGlow(null, GROUP); return; }
      p.raf = requestAnimationFrame(step);
    };
    p.raf = requestAnimationFrame(step);
  });
}

function place(p: Parked, now: number, moving: boolean, dt = 0) {
  const nm = nmPerUnit();
  const cam = nm && cameraAxes(nm);
  if (!nm || !cam) return;
  // about a twentieth of the view's height, whatever the zoom, never tiny
  const len = Math.max(3500, Math.min(60_000, 0.05 * viewHeightNm(nm)));
  const scale = len / modelLen;
  const t = now - p.start;
  const q = easeOut(t / DROP_MS);
  const pad = add(p.soma, add(mul(p.up, PAD_UP_NM + len * 0.18), mul(norm(sub(cam.toEye, mul(p.up, dot(cam.toEye, p.up)))), PAD_EYE_NM)));
  const settled = Math.max(0, t - DROP_MS) / 1000;
  const bob = settled > 0 ? 0.04 * len * Math.sin(settled * 3) * Math.exp(-settled * 1.6) : 0;
  const pos = add(pad, mul(p.up, (1 - q) * DROP_LENGTHS * len + bob));
  // coming down nose a little low, leveling out as it lands
  const tip = (1 - smooth(t / DROP_MS)) * 0.35;
  const fwd = norm(sub(p.fwd, mul(p.top, tip)));
  const up = norm(cross(fwd, cross(p.top, fwd)));
  const right = norm(cross(up, fwd));
  const m = p.prop.modelMat, axes = [right, up, fwd];
  for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) m[col * 4 + k] = axes[col][k] * scale / nm[k];
  for (let k = 0; k < 3; k++) m[12 + k] = pos[k] / nm[k];
  p.prop.eye = [dot(right, cam.toEye), dot(up, cam.toEye), dot(fwd, cam.toEye)];
  p.prop.alpha = Math.min(1, t / 250);
  if (!moving) return;
  // engines: full on the way down, easing off through the landing
  const power = t < DROP_MS ? 1 - smooth((t - DROP_MS * 0.55) / (DROP_MS * 0.45)) : 0;
  const cores = nozzles.map(z => add(pos, add(add(mul(right, z[0] * scale), mul(up, z[1] * scale)), mul(fwd, z[2] * scale))));
  if (power > 0.02) for (let k = 0; k < 6; k++) {
    const c = cores[k % 2], j: V3 = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    p.particles.push({p: add(c, mul(j, len * 0.05)), age: 0, size: len * (0.12 + Math.random() * 0.08)});
  }
  for (const s of p.particles) s.age += dt;
  p.particles = p.particles.filter(s => s.age < 1.1).slice(-390);
  let n = 0;
  const put = (pt: V3, rgba: number[], size: number) => {
    glow.positions[n * 3] = pt[0] / nm[0]; glow.positions[n * 3 + 1] = pt[1] / nm[1]; glow.positions[n * 3 + 2] = pt[2] / nm[2];
    glow.colors.set(rgba, n * 4); glow.sizesNm[n] = size; n++;
  };
  for (const s of p.particles) { const k = s.age / 1.1; put(s.p, [0.55 - 0.45 * k, 0.95 - 0.45 * k, 1, 0.5 * Math.pow(1 - k, 1.6)], s.size * (1 + 1.4 * k)); }
  if (power > 0.02) for (const c of cores) put(c, [0.9, 1, 1, 0.95 * power], len * 0.26);
  glow.count = n;
  glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
  setNgeGlow(n ? glow : null, GROUP);
}

/** Take the ship away (the cell changed, was completed or released, or the
 *  player left the Sandbox). */
export function clearSomaShip() {
  const p = parked;
  parked = null;
  if (!p) return;
  if (p.raf) cancelAnimationFrame(p.raf);
  try { p.unhook?.(); } catch { /* already gone */ }
  setNgeProps([], GROUP);
  setNgeGlow(null, GROUP);
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

(window as any).pyrSomaShip = {land: landShipOnSoma, clear: clearSomaShip};
