/**
 * The new player intro (Ames 2026-11-07), after the Starship lands on the
 * Sandbox cell: a "transmission received" panel at the bottom walks through
 * the cell, with hologram callouts on its parts (the look of Ames's render:
 * a thin line from the part to a glassy panel).
 *
 *   1 Welcome to Pyr       2 This is a neuron     3 Soma
 *   4 Dendrites            5 Axon (the ship flies along it)
 *   6 Synapse (its partner cell fades in)
 *   7 A neighbor's axon (a cell that synapses onto this one)
 *   8 Action potential (a spark runs down the axon)
 *   9 The connectome, and Start mapping
 *
 * The parts glow by the mesh tint Highlight mode uses (nge_tint.ts), from a
 * map of the cell's parts worked out from its skeleton and its real
 * synapses (static/intro/sandbox-tour.json). Any Highlight tint the player
 * had is put back when the tour ends.
 *
 * Test sites only for now: it plays for a pretend new player (Intro test
 * panel), or with ?starship in the address, or from the rocket.
 */
import {watch} from 'vue';
import {getNgeMeshTint, setNgeMeshTint, type NgeMeshTint} from 'neuroglancer/mesh/nge_tint';
import {setNgeGlow, type NgeGlow} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {cameraAxes, cellDrawn, clearStarship, flyStarship, loadAssets, setStarshipCameraHeld, starshipHop} from './starship';
import {setStatedColor} from '../widgets/widget_utils';
import {IS_LIVE_SITE, simulating} from './toolbar_staging';

type V3 = [number, number, number];
interface Tour {
  segment: string;
  grid: {origin: V3; cell: number; dims: V3; rle: number[]};
  anchors: Record<'soma' | 'dendrite' | 'axon' | 'synapse' | 'presyn', V3>;
  synapsePartner: string; presynPartner: string; presynSynapses: number;
  incomingSynapses: number; outgoingSynapses: number;
  axonFlight: number[][]; axonPath: number[][];
}

/* ── the words ── */
interface Beat {
  key: string;
  header?: string;           // the panel's own title
  callout?: {anchor: keyof Tour['anchors']; title: string};
  body: string;
  next?: string;
  part?: 1 | 2 | 3;          // soma, dendrite, axon glows
  view: {at: keyof Tour['anchors'] | 'cell'; nm: number};
}
const BEATS: Beat[] = [
  {key: 'welcome', header: 'Welcome to Pyr!', view: {at: 'soma', nm: 30_000}, next: 'Take a look around',
    body: "Pyr is a game where citizen scientists map the brain. Players come from all walks of life, and they have one thing in common: they're not neuroscientists! Together they map real neurons, like this one. Want to take a look around?"},
  {key: 'neuron', header: 'This is a neuron', view: {at: 'cell', nm: 260_000},
    body: 'Neurons are the most famous cells of the brain. Yours has about 86 billion of them, in thousands of varieties, and they all share the same basic parts.'},
  {key: 'soma', callout: {anchor: 'soma', title: 'Soma'}, part: 1, view: {at: 'soma', nm: 45_000},
    body: 'The cell body. It holds the nucleus and keeps the whole cell alive.'},
  {key: 'dendrites', callout: {anchor: 'dendrite', title: 'Dendrites'}, part: 2, view: {at: 'cell', nm: 200_000},
    body: 'The branches that listen. They gather signals from other neurons.'},
  {key: 'axon', callout: {anchor: 'axon', title: 'Axon'}, part: 3, view: {at: 'axon', nm: 160_000},
    body: "The neuron's long, thin cable. It carries the cell's own signal out to other cells."},
  {key: 'synapse', callout: {anchor: 'synapse', title: 'Synapse'}, part: 3, view: {at: 'synapse', nm: 24_000},
    body: 'Where two neurons meet and pass a signal across. Here our axon touches the next neuron. This cell receives more than 3,000 synapses of its own.'},
  {key: 'presyn', callout: {anchor: 'presyn', title: "A neighbor's axon"}, part: 2, view: {at: 'presyn', nm: 60_000},
    body: 'This axon belongs to another neuron. It reaches over and makes 11 synapses onto our cell, passing its signals in.'},
  {key: 'spike', callout: {anchor: 'axon', title: 'Action potential'}, part: 3, view: {at: 'cell', nm: 220_000},
    body: 'Neurons talk in quick electric pulses called action potentials. Each one starts near the soma and races down the axon to its synapses. Together, your neurons send hundreds of billions of them every minute.'},
  {key: 'connectome', header: "That's where you come in", view: {at: 'cell', nm: 260_000}, next: 'Start mapping',
    body: 'Mapping every neuron and every synapse gives scientists a wiring diagram of the brain, called a connectome. That takes a lot of eyes, and yours are welcome here!'},
];

/* ── colours (cell blue, parts as in the labelled picture) ── */
const PART_RGB: Record<number, V3> = {1: [255, 210, 77], 2: [61, 255, 154], 3: [255, 95, 210]};
const PARTNER_COLOR = 0xffa64d;   // the synapse's partner, orange
const PRESYN_COLOR = 0xb68cff;    // the neighbor's axon, violet
const packed = (hex: number) => ((hex >> 16) & 0xff) | (hex & 0xff00) | ((hex & 0xff) << 16);

const viewerNow = (): any => (window as any).viewer;
function nmPerUnit(): V3 | null {
  const s = viewerNow()?.coordinateSpace?.value?.scales;
  return s && s.length >= 3 ? [0, 1, 2].map(i => (Number(s[i]) || 1e-9) * 1e9) as V3 : null;
}

let tour: Tour | null = null;
let labels: Uint8Array | null = null;
async function loadTour() {
  if (tour) return;
  const res = await fetch('intro/sandbox-tour.json');
  if (!res.ok) throw new Error(`tour ${res.status}`);
  tour = await res.json();
  const g = tour!.grid, n = g.dims[0] * g.dims[1] * g.dims[2];
  labels = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < g.rle.length; i += 2) { const v = g.rle[i], k = g.rle[i + 1]; if (v) labels.fill(v, o, o + k); o += k; }
}

/** The tint for one beat: the part being shown glows, parts already met are
 *  a softer shade of their colour. */
function partsTint(shown: Set<number>, glowing?: number): NgeMeshTint | null {
  const nm = nmPerUnit();
  if (!tour || !labels || !nm || (!shown.size && !glowing)) return null;
  const g = tour.grid, n = labels.length, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = labels[i];
    if (!p || (!shown.has(p) && p !== glowing)) continue;
    const rgb = PART_RGB[p], soft = p !== glowing, a = soft ? 0.7 : 1;
    const k = soft ? 0.72 : 1;
    data[i * 4] = Math.round(rgb[0] * k * a); data[i * 4 + 1] = Math.round(rgb[1] * k * a); data[i * 4 + 2] = Math.round(rgb[2] * k * a);
    data[i * 4 + 3] = Math.round(a * 255);
  }
  const m = mat4.create();
  for (let i = 0; i < 3; i++) { m[i * 5] = nm[i] / (g.dims[i] * g.cell); m[12 + i] = -g.origin[i] / (g.dims[i] * g.cell); }
  return {data, dims: g.dims, gridFromGlobal: m, glow: glowing ? PART_RGB[glowing].map(c => c / 255) as V3 : undefined};
}

/* ── camera ── */
let camRaf = 0;
function moveCamera(center: V3, viewNm: number, ms = 1600) {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return;
  cancelAnimationFrame(camRaf);
  const unit = Math.min(nm[0], nm[1], nm[2]);
  const p0 = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
  const s0 = v.projectionScale.value, s1 = viewNm / unit;
  const t0 = performance.now();
  const step = (now: number) => {
    const q = Math.min(1, (now - t0) / ms), e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
    v.navigationState.position.value = Float32Array.from([0, 1, 2].map(i => (p0[i] + (center[i] - p0[i]) * e) / nm[i]));
    v.projectionScale.value = s0 * Math.pow(s1 / s0, e);
    if (q < 1) camRaf = requestAnimationFrame(step);
  };
  camRaf = requestAnimationFrame(step);
}
/** The 3D view's panel. */
function threeDPanel(): any {
  for (const pn of viewerNow()?.display?.panels ?? []) if (pn?.element?.classList?.contains('nge-3d-panel')) return pn;
  return null;
}
/** Where to put the camera so the subject sits in the middle of the open
 *  space above the transmission panel, not behind it (Ames: on a phone the
 *  neuron should be centred in the top two thirds). */
function framed(at: V3, viewNm: number): V3 {
  const nm = nmPerUnit(), pe = threeDPanel()?.element as HTMLElement | undefined;
  const cam = nm && cameraAxes(nm);
  if (!cam || !pe || !panel) return at;
  const r = pe.getBoundingClientRect();
  if (r.height < 50) return at;
  const bottom = Math.min(r.bottom, panel.offsetTop - 10);
  const px = (r.top + bottom) / 2 - (r.top + r.bottom) / 2;   // negative: above the middle
  const k = px * viewNm / r.height;
  return [0, 1, 2].map(i => at[i] + cam.up[i] * k) as V3;
}
function cellCenter(t: Tour): V3 {
  const g = t.grid;
  return [0, 1, 2].map(i => g.origin[i] + g.dims[i] * g.cell * 0.45) as V3;
}

/* ── partner cells ── */
function sandboxLayer(): any {
  return (viewerNow()?.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived &&
    String(m?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf') && m.layer?.displayState?.segmentationGroupState?.value?.visibleSegments);
}
const added: string[] = [];
function showCell(id: string, color: number) {
  const ml = sandboxLayer();
  if (!ml) return;
  try {
    const seg = Uint64.parseString(id);
    const vis = ml.layer.displayState.segmentationGroupState.value.visibleSegments;
    if (!vis.has(seg)) { vis.add(seg); added.push(id); }
    setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, seg, packed(color));
  } catch (e) { console.warn('[intro] could not show', id, e); }
}

function hideCell(id: string) {
  const k = added.indexOf(id), ml = sandboxLayer();
  if (k < 0 || !ml) return;
  try { ml.layer.displayState.segmentationGroupState.value.visibleSegments.delete(Uint64.parseString(id)); added.splice(k, 1); }
  catch (e) { console.warn('[intro] could not hide', id, e); }
}

/* ── the action potential spark ── */
let sparkRaf = 0;
function runSpark(t: Tour) {
  const nm = nmPerUnit();
  if (!nm) return;
  const path = t.axonPath as V3[];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
  const L = cum[cum.length - 1], TRAIL = 14;
  const glow: NgeGlow = {positions: new Float32Array(TRAIL * 3), colors: new Float32Array(TRAIL * 4), sizesNm: new Float32Array(TRAIL), count: TRAIL, nmRight: [1 / nm[0], 0, 0]};
  const at = (s: number): V3 => {
    s = Math.max(0, Math.min(L, s));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const q = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [0, 1, 2].map(k => path[i - 1][k] + (path[i][k] - path[i - 1][k]) * q) as V3;
  };
  const t0 = performance.now(), RUN = 1700, GAP = 700;
  const step = (now: number) => {
    const phase = ((now - t0) % (RUN + GAP)) / RUN;
    for (let j = 0; j < TRAIL; j++) {
      const s = (phase - j * 0.012) * L, on = phase <= 1 && s >= 0 ? 1 : 0;
      const p = at(s);
      glow.positions.set([p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]], j * 3);
      const fade = on * Math.pow(1 - j / TRAIL, 1.5);
      glow.colors.set([1, 0.95, 0.75, fade], j * 4);
      glow.sizesNm[j] = j === 0 ? 7000 : 4500 * (1 - j / TRAIL) + 1200;
    }
    const cam = cameraAxes(nm);
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(glow, 'intro-spark');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    sparkRaf = requestAnimationFrame(step);
  };
  sparkRaf = requestAnimationFrame(step);
}
function stopSpark() { cancelAnimationFrame(sparkRaf); setNgeGlow(null, 'intro-spark'); }

/* ── the synapse marker: a soft pulse ── */
let pulseRaf = 0;
function runPulse(at: V3) {
  const nm = nmPerUnit();
  if (!nm) return;
  const glow: NgeGlow = {positions: Float32Array.from([at[0] / nm[0], at[1] / nm[1], at[2] / nm[2]]), colors: new Float32Array(4), sizesNm: new Float32Array(1), count: 1, nmRight: [1 / nm[0], 0, 0]};
  const t0 = performance.now();
  const step = (now: number) => {
    const k = 0.5 + 0.5 * Math.sin((now - t0) / 1000 * 4);
    glow.colors.set([0.85, 1, 1, 0.6 + 0.4 * k]);
    glow.sizesNm[0] = 2600 + 1600 * k;
    const cam = cameraAxes(nm);
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(glow, 'intro-pulse');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    pulseRaf = requestAnimationFrame(step);
  };
  pulseRaf = requestAnimationFrame(step);
}
function stopPulse() { cancelAnimationFrame(pulseRaf); setNgeGlow(null, 'intro-pulse'); }

/* ── the panel and the callout ── */
function ensureStyle() {
  if (document.getElementById('nge-intro-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-intro-style';
  st.textContent = `
.nge-intro { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 140%); z-index: 9500;
  width: min(620px, calc(100vw - 24px)); box-sizing: border-box; padding: 14px 18px 16px;
  border: 1px solid rgba(126, 210, 255, 0.55); border-radius: 12px;
  background: linear-gradient(180deg, rgba(10, 22, 44, 0.92), rgba(6, 12, 26, 0.94));
  box-shadow: 0 0 28px rgba(80, 180, 255, 0.22), inset 0 0 22px rgba(80, 180, 255, 0.08);
  color: #e6f3ff; font: 15px/1.5 'Inter', 'Roboto', sans-serif; transition: transform 0.55s cubic-bezier(.2,.9,.3,1.15); }
.nge-intro--in { transform: translate(-50%, 0); }
body.nge-mobile .nge-intro, .nge-intro--phone { bottom: calc(86px + env(safe-area-inset-bottom)); }
.nge-intro-head { display: flex; align-items: center; gap: 8px; font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; color: #7ecaff; text-transform: uppercase; }
.nge-intro-dot { width: 8px; height: 8px; border-radius: 50%; background: #7ecaff; box-shadow: 0 0 8px #7ecaff; animation: nge-intro-blink 1.1s infinite; }
@keyframes nge-intro-blink { 50% { opacity: 0.25; } }
.nge-intro-bars { display: inline-flex; gap: 2px; align-items: flex-end; margin-left: auto; }
.nge-intro-bars i { width: 3px; background: #7ecaff; border-radius: 1px; animation: nge-intro-bar 1.2s infinite ease-in-out; }
.nge-intro-bars i:nth-child(1) { height: 5px; } .nge-intro-bars i:nth-child(2) { height: 8px; animation-delay: .15s; }
.nge-intro-bars i:nth-child(3) { height: 11px; animation-delay: .3s; } .nge-intro-bars i:nth-child(4) { height: 14px; animation-delay: .45s; }
@keyframes nge-intro-bar { 50% { opacity: 0.35; } }
.nge-intro-title { margin: 8px 0 4px; font: 700 22px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 14px rgba(126, 210, 255, 0.55); }
.nge-intro-body { margin: 0; min-height: 3em; color: #d6e8fb; }
.nge-intro-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
.nge-intro-x { flex: none; width: 26px; height: 26px; margin: -4px -6px -4px 6px; display: grid; place-items: center; padding: 0;
  border: 1px solid rgba(126, 210, 255, 0.35); border-radius: 50%; background: rgba(126, 210, 255, 0.06); color: #9fc6ea; cursor: pointer; }
.nge-intro-x:hover { color: #fff; border-color: rgba(126, 210, 255, 0.8); background: rgba(126, 210, 255, 0.16); }
.nge-intro-back { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 8px 4px; cursor: pointer;
  color: #8fb6dc; font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; }
.nge-intro-back:hover { color: #e6f3ff; }
.nge-intro-back[hidden] { display: inline-flex; visibility: hidden; }
/* Next: a glowing arrow plate, notched at the back and pointed at the
   front, with a light that sweeps across it now and then. */
.nge-intro-next { position: relative; border: 0; padding: 0; background: none; cursor: pointer; margin-left: auto;
  filter: drop-shadow(0 0 10px rgba(95, 212, 255, 0.55)); transition: filter 0.2s, transform 0.15s; }
.nge-intro-next:hover { filter: drop-shadow(0 0 16px rgba(120, 225, 255, 0.85)); }
.nge-intro-next:active { transform: scale(0.97); }
.nge-intro-plate { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 10px; padding: 11px 30px 11px 24px;
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 10px 50%);
  background: linear-gradient(100deg, #3fb8f5 0%, #7fe3ff 55%, #c9f6ff 100%);
  color: #04172b; font: 700 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; }
.nge-intro-plate::after { content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 45%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.75), transparent); transform: skewX(-20deg);
  animation: nge-intro-shine 3.2s ease-in-out infinite; }
@keyframes nge-intro-shine { 0%, 55% { left: -60%; } 100% { left: 130%; } }
.nge-intro-chev { display: inline-flex; }
.nge-intro-chev svg { animation: nge-intro-nudge 1.4s ease-in-out infinite; }
@keyframes nge-intro-nudge { 50% { transform: translateX(3px); } }
.nge-intro-next:focus-visible, .nge-intro-back:focus-visible, .nge-intro-x:focus-visible, .nge-intro-confirm button:focus-visible { outline: 2px solid #7ecaff; outline-offset: 3px; }
/* Leaving asks first. */
.nge-intro-confirm { display: none; }
.nge-intro--asking .nge-intro-title, .nge-intro--asking .nge-intro-body, .nge-intro--asking > .nge-intro-row { display: none; }
.nge-intro--asking .nge-intro-confirm { display: block; }
.nge-intro-confirm p { margin: 10px 0 2px; font: 700 18px 'Orbitron', 'Inter', sans-serif; color: #fff; }
.nge-intro-confirm small { display: block; color: #a9c3de; font-size: 13px; }
.nge-intro-leave { background: none; border: 1px solid rgba(255, 140, 170, 0.6); color: #ffc2d2; border-radius: 6px; padding: 8px 16px; cursor: pointer;
  font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-intro-leave:hover { background: rgba(255, 120, 160, 0.14); color: #fff; }
@media (prefers-reduced-motion: reduce) { .nge-intro-plate::after, .nge-intro-chev svg { animation: none; } }
/* Phones: a smaller panel, so the cell gets the room (Ames 2026-11-08). */
.nge-intro--phone { padding: 10px 14px 12px; font-size: 13.5px; line-height: 1.42; }
.nge-intro--phone .nge-intro-head { font-size: 9.5px; letter-spacing: 0.18em; }
.nge-intro--phone .nge-intro-title { margin: 5px 0 2px; font-size: 17px; }
.nge-intro--phone .nge-intro-row { margin-top: 8px; }
.nge-intro--phone .nge-intro-plate { padding: 9px 26px 9px 20px; font-size: 12px; }
/* and the layer tabs row steps aside while it runs, so the top bar is one line */
body.nge-mobile.nge-intro-on .neuroglancer-layer-panel { display: none !important; }
.nge-callout { position: fixed; left: 0; top: 0; z-index: 9400; pointer-events: none; opacity: 0; transition: opacity 0.4s; }
.nge-callout--in { opacity: 1; }
.nge-callout svg { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; }
.nge-callout-box { position: fixed; min-width: 150px; max-width: 240px; padding: 8px 12px 10px 12px;
  border: 1px solid rgba(126, 210, 255, 0.75); border-radius: 4px 12px 4px 4px;
  background: rgba(8, 24, 52, 0.62); backdrop-filter: blur(3px); box-shadow: 0 0 18px rgba(80, 180, 255, 0.3); }
.nge-callout-title { display: flex; align-items: center; gap: 8px; font: 600 15px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #fff; }
.nge-callout-ic { width: 18px; height: 18px; border-radius: 50%; border: 1px solid #7ecaff; box-shadow: 0 0 8px #7ecaff; flex: none; }
`;
  document.head.appendChild(st);
}

let panel: HTMLElement | null = null;
let callout: HTMLElement | null = null;
let calloutRaf = 0;
let typeTimer: ReturnType<typeof setInterval> | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

function type(el: HTMLElement, text: string) {
  if (typeTimer) clearInterval(typeTimer);
  el.textContent = '';
  let i = 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { el.textContent = text; return; }
  typeTimer = setInterval(() => {
    i = Math.min(text.length, i + 2);
    el.textContent = text.slice(0, i);
    if (i >= text.length && typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  }, 22);
  // a tap on the text finishes it at once
  el.onclick = () => { if (typeTimer) { clearInterval(typeTimer); typeTimer = null; } el.textContent = text; };
}

/** The 3D panel and a point in nanometres, to a point on screen. */
function toScreen(p: V3): [number, number] | null {
  const nm = nmPerUnit();
  const panelEl = threeDPanel();
  const vp = panelEl?.projectionParameters?.value?.viewProjectionMat;
  if (!vp || !nm) return null;
  const g = [p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]];
  const w = vp[3] * g[0] + vp[7] * g[1] + vp[11] * g[2] + vp[15];
  if (w <= 0) return null;
  const x = (vp[0] * g[0] + vp[4] * g[1] + vp[8] * g[2] + vp[12]) / w, y = (vp[1] * g[0] + vp[5] * g[1] + vp[9] * g[2] + vp[13]) / w;
  const r = panelEl.element.getBoundingClientRect();
  return [r.left + (x + 1) / 2 * r.width, r.top + (1 - y) / 2 * r.height];
}

function showCallout(anchor: V3, title: string) {
  hideCallout();
  callout = document.createElement('div');
  callout.className = 'nge-callout';
  callout.innerHTML = `<svg aria-hidden="true"><line stroke="rgba(160,225,255,0.9)" stroke-width="1.2"/><circle r="4" fill="#bff0ff" /></svg>
    <div class="nge-callout-box"><div class="nge-callout-title"><span class="nge-callout-ic"></span>${title}</div></div>`;
  document.body.appendChild(callout);
  const line = callout.querySelector('line')!, dot = callout.querySelector('circle')!, box = callout.querySelector('.nge-callout-box') as HTMLElement;
  requestAnimationFrame(() => callout?.classList.add('nge-callout--in'));
  const step = () => {
    const s = toScreen(anchor);
    if (s && callout) {
      const W = window.innerWidth, panelTop = panel ? panel.getBoundingClientRect().top : window.innerHeight;
      const bw = box.offsetWidth, bh = box.offsetHeight;
      const right = s[0] < W * 0.55;
      let bx = right ? s[0] + 70 : s[0] - 70 - bw;
      let by = s[1] - 110 - bh / 2;
      bx = Math.max(10, Math.min(W - bw - 10, bx));
      by = Math.max(70, Math.min(panelTop - bh - 16, by));
      box.style.left = `${bx}px`; box.style.top = `${by}px`;
      const lx = right ? bx : bx + bw, ly = by + bh;
      line.setAttribute('x1', String(s[0])); line.setAttribute('y1', String(s[1]));
      line.setAttribute('x2', String(lx)); line.setAttribute('y2', String(ly));
      dot.setAttribute('cx', String(s[0])); dot.setAttribute('cy', String(s[1]));
    }
    calloutRaf = requestAnimationFrame(step);
  };
  calloutRaf = requestAnimationFrame(step);
}
function hideCallout() {
  cancelAnimationFrame(calloutRaf);
  callout?.remove();
  callout = null;
}

/* ── running the tour ── */
let active = false;
let savedTint: NgeMeshTint | null = null;

function endTour() {
  if (!active) return;
  active = false;
  hideCallout(); stopSpark(); stopPulse();
  cancelAnimationFrame(camRaf);
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  if (onKey) { window.removeEventListener('keydown', onKey, true); onKey = null; }
  setNgeMeshTint(savedTint);
  setStarshipCameraHeld(false);
  document.body.classList.remove('nge-intro-on');
  if (panel) { const p = panel; p.classList.remove('nge-intro--in'); setTimeout(() => p.remove(), 600); panel = null; }
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

export async function startIntroTour() {
  if (active) return;
  try { await loadTour(); } catch (e) { console.warn('[intro] no tour:', e); return; }
  const t = tour!;
  active = true;
  savedTint = getNgeMeshTint();
  setStarshipCameraHeld(true);
  ensureStyle();
  panel = document.createElement('section');
  panel.className = 'ng-extend nge-intro' + (window.innerWidth < 700 ? ' nge-intro--phone' : '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Welcome to Pyr');
  const X_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const CHEV = '<span class="nge-intro-chev"><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1.5 1.5L6 6l-4.5 4.5M7.5 1.5L12 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  const BACK = '<svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><path d="M6.5 1.5L2 6l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  panel.innerHTML = `<div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Pyr<span class="nge-intro-bars"><i></i><i></i><i></i><i></i></span><button class="nge-intro-x" type="button" aria-label="Leave the introduction">${X_SVG}</button></div>
    <div class="nge-intro-title"></div><p class="nge-intro-body" aria-live="polite"></p>
    <div class="nge-intro-row"><button class="nge-intro-back" type="button">${BACK}Back</button><button class="nge-intro-next nge-intro-go" type="button"><span class="nge-intro-plate"><span class="nge-intro-label"></span>${CHEV}</span></button></div>
    <div class="nge-intro-confirm" role="alertdialog" aria-label="Leave the introduction?"><p>Leave the introduction?</p><small>You can start mapping right away.</small>
      <div class="nge-intro-row"><button class="nge-intro-leave" type="button">Leave</button><button class="nge-intro-next nge-intro-stay" type="button"><span class="nge-intro-plate">Keep going${CHEV}</span></button></div></div>`;
  document.body.appendChild(panel);
  document.body.classList.add('nge-intro-on');
  requestAnimationFrame(() => panel?.classList.add('nge-intro--in'));
  const titleEl = panel.querySelector('.nge-intro-title') as HTMLElement;
  const bodyEl = panel.querySelector('.nge-intro-body') as HTMLElement;
  const nextEl = panel.querySelector('.nge-intro-go') as HTMLButtonElement;
  const labelEl = panel.querySelector('.nge-intro-label') as HTMLElement;
  const backEl = panel.querySelector('.nge-intro-back') as HTMLButtonElement;
  const stayEl = panel.querySelector('.nge-intro-stay') as HTMLButtonElement;
  const ask = (on: boolean) => {
    panel?.classList.toggle('nge-intro--asking', on);
    (on ? stayEl : nextEl).focus({preventScroll: true});
  };
  (panel.querySelector('.nge-intro-x') as HTMLButtonElement).onclick = () => ask(true);
  (panel.querySelector('.nge-intro-leave') as HTMLButtonElement).onclick = endTour;
  stayEl.onclick = () => ask(false);
  onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    ask(!panel?.classList.contains('nge-intro--asking'));
  };
  window.addEventListener('keydown', onKey, true);

  const indexOf = (key: string) => BEATS.findIndex(b => b.key === key);
  const AXON = indexOf('axon'), SYN = indexOf('synapse'), PRE = indexOf('presyn');
  let i = -1;
  let shipOut = false;   // the ship is out along the axon
  const go = (n: number) => {
    if (!active || n < 0) return;
    if (n >= BEATS.length) { endTour(); return; }
    const from = i;
    i = n;
    const b = BEATS[i];
    titleEl.textContent = b.header ?? b.callout?.title ?? '';
    labelEl.textContent = b.next ?? 'Next';
    backEl.hidden = i === 0;
    // Size the panel for the whole text first, so it holds still while the
    // words type in and the camera can frame the cell above it.
    bodyEl.style.minHeight = '';
    bodyEl.textContent = b.body;
    bodyEl.style.minHeight = `${bodyEl.offsetHeight}px`;
    type(bodyEl, b.body);
    hideCallout(); stopSpark(); stopPulse();
    // the parts: ones met before this beat stay softly coloured, this one glows
    const shown = new Set<number>();
    for (let k = 0; k < i; k++) { const p = BEATS[k].part; if (p) shown.add(p); }
    setNgeMeshTint(partsTint(shown, b.part));
    // the camera, framing the subject in the open space above the panel
    const center = b.view.at === 'cell' ? cellCenter(t) : t.anchors[b.view.at];
    moveCamera(framed(center, b.view.nm), b.view.nm, b.key === 'welcome' ? 10 : 1700);
    // the partner cells are there from their beat on, and gone if we step back
    if (i < SYN) hideCell(t.synapsePartner);
    if (i < PRE) hideCell(t.presynPartner);
    // what happens in this beat
    if (b.key === 'axon' && from < AXON) { starshipHop(t.axonFlight, 6); shipOut = true; }
    if (i < AXON && shipOut) { starshipHop([...t.axonFlight].reverse(), 4); shipOut = false; }
    if (b.key === 'synapse') { showCell(t.synapsePartner, PARTNER_COLOR); runPulse(t.anchors.synapse); }
    if (b.key === 'presyn') showCell(t.presynPartner, PRESYN_COLOR);
    if (b.key === 'spike') runSpark(t);
    if (b.callout) setTimeout(() => { if (active && i === n) showCallout(t.anchors[b.callout!.anchor], b.callout!.title); }, 900);
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  };
  nextEl.onclick = () => go(i + 1);
  backEl.onclick = () => go(i - 1);
  go(0);
}

/** The whole intro: the Starship flies in and lands, then the tour. */
export function playIntro() {
  endTour();
  clearStarship();
  setTimeout(() => { void flyStarship(() => { void startIntroTour(); }); }, 150);
}

/**
 * Test sites only for now (never the live site): the intro plays by itself
 * for a pretend new player (the Intro test panel's "Pretend I am a new
 * player"), on load and the moment the box is ticked, or with ?starship in
 * the address. It waits for the cell to be drawn first, for up to twenty
 * seconds.
 */
let playedThisLoad = false;
export function startStarshipIntro() {
  if (IS_LIVE_SITE) return;
  const wanted = () => simulating.value || /[?&]starship\b/.test(location.search);
  const go = async () => {
    if (!wanted() || playedThisLoad) return;
    playedThisLoad = true;
    await Promise.all([loadAssets(), loadTour()]).catch(() => {});
    for (let k = 0; k < 80 && !cellDrawn(); k++) await new Promise(r => setTimeout(r, 250));
    if (wanted()) playIntro();
  };
  setTimeout(go, 1500);
  watch(simulating, on => { if (on) { playedThisLoad = false; void go(); } });
}

(window as any).pyrIntro = {play: playIntro, tour: startIntroTour, end: endTour};
