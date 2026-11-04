/**
 * 2D Tools, a prototype (Ames 2026-11-01), after the player script by Nseraf
 * with Krzysztof Kruk and annkri: help across a misalignment in the 2D view.
 *
 *   Jump pairs   two saved spots, A and B, and a jump between them.
 *   Lasso        a colored outline, filled, on one slice.
 *   Compare      two captures of the 2D view, side by side, to download.
 *
 * Kept in this browser, by dataset. The shapes are drawn on a canvas of their
 * own over the 2D panel, from the panel's own camera, so they stay put as it
 * pans and zooms. No script's code is used: only the idea.
 */
import { reactive } from 'vue';
import { currentDatasetTag } from '../datasets';

export interface JumpPair {
  id: string; name: string; a: number[] | null; b: number[] | null;
  /** Scrolling into the slices between A and B lands on the far side instead:
   *  the faulty slices are skipped (Ames 2026-11-02). */
  skip?: boolean;
}
export interface LassoShape { id: string; z: number; color: string; points: number[][]; }

export const LASSO_COLORS = ['#ff5d73', '#ffd24d', '#3dff9a', '#4dd8f0', '#b388ff', '#ff9a3c'];
export const MAX_PAIRS = 20;
export const MAX_SHAPES = 40;
const FILL_ALPHA = 0.4;
/** Points closer than this on screen are one point, to keep a shape small. */
const MIN_STEP_PX = 3;

export const twoD = reactive({
  open: false,
  lasso: false,
  color: LASSO_COLORS[0],
  pairs: [] as JumpPair[],
  shapes: [] as LassoShape[],
  captures: [null, null] as ({ url: string; label: string; w: number; h: number } | null)[],
  z: 0,
  note: '',
});

const viewerOf = (): any => (window as any).viewer;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Saved in this browser, by dataset ────────────────────────────────────
/** Known bad stretches, ready made (Ames 2026-11-02: "black spill issues in
 *  between 149881, 128038, 2649 and 149717, 128044, 2664" on MEC). Skip
 *  starts off: the pair's shift is measured at one place, so skipping
 *  everywhere would throw players elsewhere in the slice sideways. Removing
 *  one keeps it removed. */
const PRESETS: Record<string, JumpPair[]> = {
  pni_mec: [
    { id: 'preset-mec-black-spill-2649', name: 'Black spill, z 2650 to 2663', a: [149881, 128038, 2649], b: [149717, 128044, 2664], skip: false },
  ],
};
let dismissed: string[] = [];
let loadedFor = '';
const storageKey = (tag: string) => `nge_2d_tools_${tag}`;
function save() {
  if (!loadedFor) return;
  try { localStorage.setItem(storageKey(loadedFor), JSON.stringify({ pairs: twoD.pairs, shapes: twoD.shapes, dismissed })); } catch { /* full or blocked */ }
}
function loadForDataset() {
  const tag = currentDatasetTag() || 'unknown';
  if (tag === loadedFor) return;
  loadedFor = tag;
  let saved: any = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey(tag)) || 'null'); } catch { /* start empty */ }
  twoD.pairs = Array.isArray(saved?.pairs) ? saved.pairs : [];
  twoD.shapes = Array.isArray(saved?.shapes) ? saved.shapes : [];
  dismissed = Array.isArray(saved?.dismissed) ? saved.dismissed : [];
  for (const preset of PRESETS[tag] ?? []) {
    if (!dismissed.includes(preset.id) && !twoD.pairs.some(p => p.id === preset.id)) {
      twoD.pairs.unshift({ ...preset, a: preset.a && [...preset.a], b: preset.b && [...preset.b] });
    }
  }
}

// ── The 2D panel and its camera ──────────────────────────────────────────
function slicePanel(): any {
  const panels: any[] = viewerOf()?.display?.panels ? [...viewerOf().display.panels] : [];
  return panels.find(p => p.sliceView && p.element?.clientWidth > 0) ?? null;
}
function position(): number[] | null {
  const p = viewerOf()?.navigationState?.position?.value;
  return p && p.length >= 3 ? Array.from(p as ArrayLike<number>).slice(0, 3) : null;
}
const sliceOf = (pos: number[] | null) => (pos ? Math.floor(pos[2]) : 0);

/** The numbers to go between the view's voxels and the panel. */
function camera(panel: any): { vp: Float32Array; inv: Float32Array; f: number[] } | null {
  const pp = panel?.sliceView?.projectionParameters?.value;
  const factors = pp?.displayDimensionRenderInfo?.canonicalVoxelFactors;
  if (!pp?.viewProjectionMat || !pp?.invViewProjectionMat || !factors) return null;
  return { vp: pp.viewProjectionMat, inv: pp.invViewProjectionMat, f: Array.from(factors as ArrayLike<number>) };
}
/** Voxels to a place in the panel, 0 to 1 across and down. */
function toPanel(cam: NonNullable<ReturnType<typeof camera>>, p: number[]): [number, number] {
  const x = p[0] * cam.f[0], y = p[1] * cam.f[1], z = p[2] * cam.f[2], m = cam.vp;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2, (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2];
}
/** A place in the panel to voxels, on the slice being looked at. */
function fromPanel(cam: NonNullable<ReturnType<typeof camera>>, u: number, v: number, sliceZ: number): number[] {
  const nx = u * 2 - 1, ny = 1 - v * 2, m = cam.inv;
  const at = (nz: number) => {
    const w = m[3] * nx + m[7] * ny + m[11] * nz + m[15];
    return [(m[0] * nx + m[4] * ny + m[8] * nz + m[12]) / w, (m[1] * nx + m[5] * ny + m[9] * nz + m[13]) / w, (m[2] * nx + m[6] * ny + m[10] * nz + m[14]) / w];
  };
  const p = at(0);
  return [p[0] / cam.f[0], p[1] / cam.f[1], sliceZ + 0.5];
}

// ── The overlay ──────────────────────────────────────────────────────────
// ── The offer at a known bad stretch (Ames 2026-11-02: "add the skip button
// if user is in that section") ───────────────────────────────────────────
// On the 2D view, whether or not this box is open: on those slices, or a
// couple either side, and near where the stretch was measured, a button to
// jump over it. Nobody is moved without choosing to.
const OFFER_SLICES = 2;
const OFFER_RADIUS = 6000;   // voxels from where the pair was measured
let offerEl: HTMLDivElement | null = null;
let offerFor: JumpPair | null = null;
function offerPair(): JumpPair | null {
  const at = position();
  if (!at) return null;
  for (const p of twoD.pairs) {
    if (!p.id.startsWith('preset-') || !p.a || !p.b) continue;
    const [lo, hi] = p.a[2] < p.b[2] ? [p.a, p.b] : [p.b, p.a];
    if (at[2] < lo[2] - OFFER_SLICES || at[2] > hi[2] + OFFER_SLICES) continue;
    const near = Math.hypot(at[0] - lo[0], at[1] - lo[1]) < OFFER_RADIUS || Math.hypot(at[0] - hi[0], at[1] - hi[1]) < OFFER_RADIUS;
    if (near) return p;
  }
  return null;
}
function showOffer() {
  if (!offerEl) return;
  const p = offerPair();
  if (p !== offerFor) {
    offerFor = p;
    if (p) {
      const z = [p.a![2], p.b![2]].sort((x, y) => x - y);
      (offerEl.firstChild as HTMLElement).textContent = `${p.name.startsWith('Black spill') ? 'Black spill' : 'Bad slices'}: z ${z[0] + 1} to ${z[1] - 1}`;
    }
  }
  offerEl.style.display = p ? '' : 'none';
}

let canvas: HTMLCanvasElement | null = null;
let button: HTMLButtonElement | null = null;
let attachedTo: HTMLElement | null = null;
let drawing: number[][] | null = null;

function drawOverlay(panel: any) {
  if (!canvas) return;
  const el: HTMLElement = panel.element;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const cam = camera(panel);
  if (!cam) return;
  const z = sliceOf(position());
  twoD.z = z;
  const trace = (points: number[][]) => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const [u, v] = toPanel(cam, p);
      if (i) ctx.lineTo(u * w, v * h); else ctx.moveTo(u * w, v * h);
    });
  };
  for (const s of twoD.shapes) {
    if (s.z !== z || s.points.length < 3) continue;
    trace(s.points);
    ctx.closePath();
    ctx.globalAlpha = FILL_ALPHA;
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = s.color;
    ctx.stroke();
  }
  if (drawing && drawing.length > 1) {
    trace(drawing);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = twoD.color;
    ctx.stroke();
  }
}

function pointerPlace(e: MouseEvent, el: HTMLElement): [number, number] {
  const r = el.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}
function onDown(e: MouseEvent) {
  if (!twoD.lasso || e.button !== 0 || e.ctrlKey || !attachedTo) return;
  const target = e.target as HTMLElement;
  if (target.closest?.('button, input, label')) return;
  // The panel's own mouse handling sits on this same element, so stopping the
  // event's travel is not enough: this is what keeps the view from panning.
  e.stopImmediatePropagation();
  e.preventDefault();
  const panel = slicePanel();
  const cam = camera(panel);
  if (!cam) return;
  if (twoD.shapes.length >= MAX_SHAPES) { twoD.note = `${MAX_SHAPES} shapes is the most here. Remove one first.`; return; }
  const z = sliceOf(position());
  const [u, v] = pointerPlace(e, attachedTo);
  drawing = [fromPanel(cam, u, v, z)];
  let last = [e.clientX, e.clientY];
  const move = (m: MouseEvent) => {
    m.stopPropagation();
    if (!drawing || !attachedTo) return;
    if (Math.hypot(m.clientX - last[0], m.clientY - last[1]) < MIN_STEP_PX) return;
    last = [m.clientX, m.clientY];
    const [mu, mv] = pointerPlace(m, attachedTo);
    drawing.push(fromPanel(cam, mu, mv, z));
  };
  const up = (m: MouseEvent) => {
    m.stopPropagation();
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    if (drawing && drawing.length >= 3) {
      twoD.shapes.push({ id: newId(), z, color: twoD.color, points: drawing.map(p => p.map(n => Math.round(n * 10) / 10)) });
      save();
    }
    drawing = null;
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
}
const swallow = (e: Event) => { if (twoD.lasso && (e as MouseEvent).button === 0 && !(e.target as HTMLElement).closest?.('button, input, label')) e.stopImmediatePropagation(); };

function attach(panel: any) {
  const el: HTMLElement = panel.element;
  if (attachedTo === el) return;
  detach();
  attachedTo = el;
  canvas = document.createElement('canvas');
  canvas.className = 'nge-2d-canvas';
  el.appendChild(canvas);
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'nge-2d-open';
  button.textContent = '2D Tools';
  button.title = 'Jump across a misalignment, lasso a shape, compare two slices';
  button.addEventListener('mousedown', e => e.stopPropagation());
  button.addEventListener('click', e => { e.stopPropagation(); twoD.open = !twoD.open; if (!twoD.open) twoD.lasso = false; });
  el.appendChild(button);
  offerEl = document.createElement('div');
  offerEl.className = 'nge-2d-offer';
  offerEl.style.display = 'none';
  const offerText = document.createElement('span');
  const offerGo = document.createElement('button');
  offerGo.type = 'button';
  offerGo.textContent = 'Jump over';
  offerGo.title = 'Go to the matching place on the far side (J)';
  offerGo.addEventListener('mousedown', e => e.stopPropagation());
  offerGo.addEventListener('click', e => { e.stopPropagation(); if (offerFor) jumpAcross(offerFor); });
  // Its (i): what this is, in a line, on hover or tap.
  const offerInfo = document.createElement('button');
  offerInfo.type = 'button';
  offerInfo.className = 'nge-2d-offer-i';
  offerInfo.textContent = 'i';
  const why = 'These slices are damaged (a black spill), so the cell seems to break here. Jump over takes you to the matching place on the far side, at the same zoom. The J key does the same. More in 2D Tools.';
  offerInfo.title = why;
  offerInfo.setAttribute('aria-label', why);
  offerInfo.addEventListener('mousedown', e => e.stopPropagation());
  offerInfo.addEventListener('click', e => { e.stopPropagation(); twoD.open = true; });
  offerEl.append(offerText, offerInfo, offerGo);
  el.appendChild(offerEl);
  el.addEventListener('mousedown', onDown, true);
  el.addEventListener('pointerdown', swallow, true);
}
function detach() {
  canvas?.remove();
  button?.remove();
  offerEl?.remove();
  offerEl = null;
  offerFor = null;
  attachedTo?.removeEventListener('mousedown', onDown, true);
  attachedTo?.removeEventListener('pointerdown', swallow, true);
  canvas = button = attachedTo = null;
}

let started = false;
export function startTwoDTools() {
  if (started) return;
  started = true;
  const frame = () => {
    requestAnimationFrame(frame);
    if (!viewerOf()?.display) return;
    const panel = slicePanel();
    if (!panel) { detach(); return; }
    loadForDataset();
    attach(panel);
    if (attachedTo) attachedTo.style.cursor = twoD.lasso ? 'crosshair' : '';
    drawOverlay(panel);
    showOffer();
  };
  frame();
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && twoD.lasso) twoD.lasso = false;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'j' || e.key === 'J') && slicePanel()) {
      const pair = nearestPair();
      if (pair) { e.preventDefault(); e.stopPropagation(); jumpAcross(pair); }
    }
  }, true);
  const watchPosition = () => {
    const nav = viewerOf()?.navigationState?.position;
    if (!nav?.changed) { setTimeout(watchPosition, 500); return; }
    nav.changed.add(onPositionChanged);
  };
  watchPosition();
}

// ── Jump pairs ───────────────────────────────────────────────────────────
export function addPair() {
  if (twoD.pairs.length >= MAX_PAIRS) { twoD.note = `${MAX_PAIRS} pairs is the most here. Remove one first.`; return; }
  twoD.pairs.push({ id: newId(), name: `Jump ${twoD.pairs.length + 1}`, a: position(), b: null, skip: true });
  twoD.note = 'A is set here. Go to the other side, then press Set B.';
  save();
}
export function setSide(pair: JumpPair, side: 'a' | 'b') { pair[side] = position(); twoD.note = ''; save(); }
export function renamePair(pair: JumpPair, name: string) { pair.name = name.slice(0, 40) || pair.name; save(); }
export function removePair(pair: JumpPair) {
  twoD.pairs = twoD.pairs.filter(p => p.id !== pair.id);
  if (pair.id.startsWith('preset-') && !dismissed.includes(pair.id)) dismissed.push(pair.id);
  save();
}
/** Straight there, keeping the zoom, with no reload of the view (Krzysztof's
 *  point: it is what makes going back and forth quick). */
export function goTo(p: number[] | null) {
  const nav = viewerOf()?.navigationState?.position;
  if (!p || !nav?.value) return;
  const next = Float32Array.from(nav.value as ArrayLike<number>);
  for (let i = 0; i < 3; i++) next[i] = p[i];
  nav.value = next;
}
/** To whichever side you are not on. From where you are, so a place you
 *  moved to on one side lands on the matching place on the other (the pair's
 *  shift between A and B). */
export function jumpAcross(pair: JumpPair) {
  if (!pair.a || !pair.b) return;
  const at = position();
  if (!at) return;
  const fromA = Math.abs(at[2] - pair.a[2]) <= Math.abs(at[2] - pair.b[2]);
  const [from, to] = fromA ? [pair.a, pair.b] : [pair.b, pair.a];
  goTo([at[0] + to[0] - from[0], at[1] + to[1] - from[1], to[2]]);
}
export function toggleSkip(pair: JumpPair) { pair.skip = !pair.skip; save(); }

/** J: across the pair nearest the slice you are on. */
function nearestPair(): JumpPair | null {
  const at = position();
  if (!at) return null;
  let best: JumpPair | null = null, bestD = Infinity;
  for (const p of twoD.pairs) {
    if (!p.a || !p.b) continue;
    const d = Math.min(Math.abs(at[2] - p.a[2]), Math.abs(at[2] - p.b[2]));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Skipping the faulty slices: scrolling from A's side into the slices between
// A and B lands on B's side, shifted as the pair is, and the same coming back.
// Only a step that crosses into the gap triggers it, so a jump into the middle
// (a link, a search) stays put.
let lastZ: number | null = null;
let skipping = false;
function onPositionChanged() {
  const at = position();
  if (!at) return;
  const z = at[2], before = lastZ;
  lastZ = z;
  if (skipping || before === null || before === z) return;
  for (const p of twoD.pairs) {
    if (!p.skip || !p.a || !p.b || p.a[2] === p.b[2]) continue;
    const [lo, hi] = p.a[2] < p.b[2] ? [p.a, p.b] : [p.b, p.a];
    if (!(z > lo[2] && z < hi[2])) continue;
    let to: number[] | null = null, from: number[] | null = null;
    if (before <= lo[2]) { from = lo; to = hi; }
    else if (before >= hi[2]) { from = hi; to = lo; }
    if (!to || !from) continue;
    skipping = true;
    try { goTo([at[0] + to[0] - from[0], at[1] + to[1] - from[1], to[2]]); } finally { skipping = false; }
    lastZ = to[2];
    return;
  }
}

// ── Lasso ────────────────────────────────────────────────────────────────
export function removeShape(id: string) { twoD.shapes = twoD.shapes.filter(s => s.id !== id); save(); }
export function clearSlice() { const z = twoD.z; twoD.shapes = twoD.shapes.filter(s => s.z !== z); save(); }

// ── Compare ──────────────────────────────────────────────────────────────
export function capture(index: 0 | 1) {
  const viewer = viewerOf(), panel = slicePanel();
  const source: HTMLCanvasElement | undefined = viewer?.display?.canvas;
  if (!panel || !source) return;
  try { viewer.display.draw(); } catch { /* the last frame will do */ }
  drawOverlay(panel);
  const cr = source.getBoundingClientRect(), pr = panel.element.getBoundingClientRect();
  const kx = source.width / cr.width, ky = source.height / cr.height;
  const out = document.createElement('canvas');
  out.width = Math.round(pr.width * kx);
  out.height = Math.round(pr.height * ky);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, (pr.left - cr.left) * kx, (pr.top - cr.top) * ky, out.width, out.height, 0, 0, out.width, out.height);
  if (canvas) ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const pos = position();
  const label = pos ? `x ${Math.round(pos[0])}  y ${Math.round(pos[1])}  z ${Math.round(pos[2])}` : '';
  twoD.captures[index] = { url: out.toDataURL('image/jpeg', 0.92), label, w: out.width, h: out.height };
}
const loadImage = (url: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
export async function downloadCompare() {
  const shots = twoD.captures.filter(Boolean) as { url: string; label: string; w: number; h: number }[];
  if (!shots.length) return;
  const gap = 12, band = 34;
  const out = document.createElement('canvas');
  out.width = shots.reduce((sum, s) => sum + s.w, 0) + gap * (shots.length - 1);
  out.height = Math.max(...shots.map(s => s.h)) + band;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, out.width, out.height);
  let x = 0;
  for (const s of shots) {
    ctx.drawImage(await loadImage(s.url), x, band);
    ctx.fillStyle = '#e8eef5';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(s.label, x + 8, 23);
    x += s.w + gap;
  }
  const a = document.createElement('a');
  a.href = out.toDataURL('image/jpeg', 0.92);
  a.download = `pyr-2d-compare-z${Math.round(twoD.z)}.jpg`;
  a.click();
}
