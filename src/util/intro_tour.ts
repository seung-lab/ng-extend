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
/* The box, after Ames's scifi-ui hologram panels: a glassy plate with cut
   corners, HUD brackets, a faint circuit board that draws itself in, and a
   build in (a light runs the border, the plate resolves out of a blur, a
   scan line passes down it). */
@property --nge-ring { syntax: '<angle>'; inherits: false; initial-value: 45deg; }
.nge-intro { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 0); z-index: 9500; isolation: isolate;
  width: min(620px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px 20px 16px;
  color: #e6f3ff; font: 15px/1.5 'Inter', 'Roboto', sans-serif; opacity: 0; pointer-events: none; }
.nge-intro--in { pointer-events: auto; animation: nge-holo-in 900ms cubic-bezier(.16,1,.3,1) both; }
@keyframes nge-holo-in {
  0% { opacity: 0; transform: translate(-50%, 18px) scaleY(0.04); filter: blur(8px) brightness(2.2) drop-shadow(0 0 0 rgba(80, 180, 255, 0)); }
  35% { opacity: 1; transform: translate(-50%, 6px) scaleY(1.02); filter: blur(3px) brightness(1.6) drop-shadow(0 0 30px rgba(80, 180, 255, 0.6)); }
  100% { opacity: 1; transform: translate(-50%, 0) scaleY(1); filter: blur(0) brightness(1) drop-shadow(0 0 18px rgba(80, 180, 255, 0.28)); } }
.nge-intro--out { animation: nge-holo-out 420ms ease-in both; }
@keyframes nge-holo-out { to { opacity: 0; transform: translate(-50%, 10px) scaleY(0.04); filter: blur(6px) brightness(2); } }
/* the plate */
.nge-intro-plate-bg { position: absolute; inset: 0; z-index: -2; pointer-events: none;
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  background: linear-gradient(160deg, rgba(14, 34, 66, 0.93), rgba(6, 12, 28, 0.95) 60%, rgba(22, 14, 48, 0.94));
  box-shadow: inset 0 0 40px rgba(80, 180, 255, 0.10); }
.nge-intro-plate-bg::before { content: ''; position: absolute; inset: 0; padding: 1px;
  clip-path: inherit; background: linear-gradient(135deg, rgba(126, 224, 255, 0.75), rgba(74, 150, 224, 0.25) 40%, rgba(138, 96, 230, 0.6));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
/* fine scan lines across the glass */
.nge-intro-plate-bg::after { content: ''; position: absolute; inset: 0; opacity: 0.35;
  background: repeating-linear-gradient(0deg, rgba(126, 224, 255, 0.05) 0 1px, transparent 1px 3px); }
/* the light that runs the border once as it arrives */
.nge-intro-ring { position: absolute; inset: 0; z-index: -1; pointer-events: none; padding: 1.5px; opacity: 0;
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  background: conic-gradient(from var(--nge-ring), #c9f6ff 0deg, rgba(126, 224, 255, 0.5) 16deg, transparent 34deg, transparent 180deg,
    #c9f6ff 180deg, rgba(126, 224, 255, 0.5) 196deg, transparent 214deg, transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-intro--in .nge-intro-ring { animation: nge-ring 1500ms linear 250ms forwards; }
@keyframes nge-ring { 0% { --nge-ring: 45deg; opacity: 1; } 60% { opacity: 1; } 100% { --nge-ring: 405deg; opacity: 0; } }
/* HUD brackets that snap in from outside */
.nge-intro-corner { position: absolute; width: 14px; height: 14px; border: 2px solid #7ee0ff; pointer-events: none;
  filter: drop-shadow(0 0 4px #7ee0ff); opacity: 0; }
.nge-intro-corner.tr { top: -5px; right: -5px; border-left: 0; border-bottom: 0; }
.nge-intro-corner.bl { bottom: -5px; left: -5px; border-right: 0; border-top: 0; }
.nge-intro-corner.tl { top: 6px; left: 6px; width: 8px; height: 8px; border-width: 1px; border-right: 0; border-bottom: 0; }
.nge-intro-corner.br { bottom: 6px; right: 6px; width: 8px; height: 8px; border-width: 1px; border-left: 0; border-top: 0; }
.nge-intro--in .nge-intro-corner { animation: nge-corner 600ms cubic-bezier(.2,1.4,.4,1) 450ms both; }
.nge-intro--in .nge-intro-corner.tr { --dx: 14px; --dy: -14px; } .nge-intro--in .nge-intro-corner.bl { --dx: -14px; --dy: 14px; }
.nge-intro--in .nge-intro-corner.tl { --dx: -10px; --dy: -10px; } .nge-intro--in .nge-intro-corner.br { --dx: 10px; --dy: 10px; }
@keyframes nge-corner { from { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)); } to { opacity: 1; transform: none; } }
/* the circuit board: traces draw in, then sparks run along a few of them */
.nge-intro-circuit { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; overflow: visible;
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  -webkit-mask-image: linear-gradient(100deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.25) 45%, #000 80%);
          mask-image: linear-gradient(100deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.25) 45%, #000 80%); }
.nge-intro-circuit path { fill: none; stroke: rgba(126, 224, 255, 0.32); stroke-width: 1; vector-effect: non-scaling-stroke;
  stroke-dasharray: 1; stroke-dashoffset: 1; }
.nge-intro-circuit circle { fill: rgba(126, 224, 255, 0.55); opacity: 0; }
.nge-intro--in .nge-intro-circuit path { animation: nge-trace 1200ms ease-out both; animation-delay: calc(500ms + var(--i) * 70ms); }
.nge-intro--in .nge-intro-circuit circle { animation: nge-node 300ms ease-out both; animation-delay: calc(1100ms + var(--i) * 70ms); }
@keyframes nge-trace { to { stroke-dashoffset: 0; } }
@keyframes nge-node { to { opacity: 1; } }
.nge-intro-circuit .spark { stroke: #c9f6ff; stroke-width: 2; stroke-dasharray: 0.06 0.94; stroke-dashoffset: 1; opacity: 0;
  filter: drop-shadow(0 0 3px #7ee0ff); }
.nge-intro--in .nge-intro-circuit .spark { animation: nge-spark 3.6s linear infinite; animation-delay: calc(1800ms + var(--i) * 900ms); }
@keyframes nge-spark { 0% { stroke-dashoffset: 1; opacity: 1; } 45% { stroke-dashoffset: 0; opacity: 1; } 46%, 100% { opacity: 0; stroke-dashoffset: 0; } }
/* a scan line passes down the box as it arrives, and again with each new message */
.nge-intro-scan { position: absolute; left: 0; right: 0; top: 0; height: 2px; pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, #c9f6ff 20%, #c9f6ff 80%, transparent); box-shadow: 0 0 12px #7ee0ff; }
.nge-intro--in .nge-intro-scan { animation: nge-scan 800ms ease-in-out 350ms both; }
.nge-intro--beat .nge-intro-scan { animation: nge-scan2 650ms ease-in-out both; }
@keyframes nge-scan { 0% { top: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
@keyframes nge-scan2 { 0% { top: 0; opacity: 0; } 15% { opacity: 0.8; } 85% { opacity: 0.8; } 100% { top: 100%; opacity: 0; } }
.nge-intro--beat .nge-intro-title { animation: nge-flicker 420ms steps(2, end) both; }
@keyframes nge-flicker { 0% { opacity: 0.2; transform: translateX(-3px); } 30% { opacity: 1; transform: none; } 45% { opacity: 0.5; } 60%, 100% { opacity: 1; } }
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
/* Next: a hologram plate from Ames's scifi-ui (blue into violet on the
   diagonal, cut corners, corner ticks), a light band sweeping across it,
   and a glow that wakes on hover. */
.nge-intro-next { position: relative; border: 0; padding: 0; background: none; cursor: pointer; margin-left: auto; color: inherit;
  filter: drop-shadow(0 0 10px rgba(74, 150, 224, 0.45)); transition: filter 0.25s, transform 0.2s; }
.nge-intro-next:hover { filter: drop-shadow(0 0 18px rgba(126, 224, 255, 0.75)); transform: translateY(-1px); }
.nge-intro-next:active { transform: translateY(0) scale(0.98); }
.nge-intro-plate { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 12px; padding: 12px 22px 12px 24px;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  background: linear-gradient(135deg, rgba(74, 150, 224, 0.55) 0%, rgba(74, 150, 224, 0.62) 45%, rgba(138, 96, 230, 0.55) 100%);
  color: #eaf7ff; font: 700 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap;
  text-shadow: 0 0 8px rgba(126, 224, 255, 0.8); transition: background 0.3s; }
.nge-intro-next:hover .nge-intro-plate { background: linear-gradient(135deg, rgba(90, 170, 240, 0.72) 0%, rgba(90, 170, 240, 0.78) 45%, rgba(150, 110, 240, 0.7) 100%); }
/* the hairline frame and corner ticks */
.nge-intro-plate::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, #bff3ff, rgba(126, 224, 255, 0.35) 40%, rgba(180, 150, 255, 0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-intro-plate::after { content: ''; position: absolute; top: 0; bottom: 0; left: -70%; width: 50%; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(201, 246, 255, 0.55), transparent); transform: skewX(-20deg);
  animation: nge-intro-shine 3.4s ease-in-out infinite; }
@keyframes nge-intro-shine { 0%, 50% { left: -70%; } 100% { left: 140%; } }
.nge-intro-tick { position: absolute; width: 6px; height: 6px; border: 1px solid #c9f6ff; pointer-events: none; }
.nge-intro-tick.a { top: 3px; right: 3px; border-left: 0; border-bottom: 0; }
.nge-intro-tick.b { bottom: 3px; left: 3px; border-right: 0; border-top: 0; }
.nge-intro-chev { display: inline-flex; color: #c9f6ff; filter: drop-shadow(0 0 4px #7ee0ff); }
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
@media (prefers-reduced-motion: reduce) { .nge-intro-plate::after, .nge-intro-chev svg, .nge-intro-circuit .spark { animation: none; }
  .nge-intro--in { animation-duration: 1ms; } }
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
/** Where a right-angle trace (M x y, then H and V steps) ends. */
function traceEnd(d: string): [number, number] {
  const m = d.match(/^M\s*(\d+)\s+(\d+)/);
  let x = Number(m?.[1] ?? 0), y = Number(m?.[2] ?? 0);
  for (const g of d.match(/[HV]\s*\d+/g) ?? []) { const v = Number(g.slice(1)); if (g[0] === 'H') x = v; else y = v; }
  return [x, y];
}
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
  if (panel) { const p = panel; p.classList.add('nge-intro--out'); setTimeout(() => p.remove(), 450); panel = null; }
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
  // the circuit board: right-angle traces, denser on the right, away from the words
  const TRACES = ['M430 8 H520 V40 H600', 'M470 70 H540 V110 H612', 'M560 10 V60', 'M380 130 H450 V170 H560 V196',
    'M500 150 H612', 'M20 190 H120 V160 H200', 'M300 8 H360 V30', 'M590 130 V190', 'M60 6 V30 H140'];
  const circuit = `<svg class="nge-intro-circuit" viewBox="0 0 620 200" preserveAspectRatio="none" aria-hidden="true">${
    TRACES.map((d, k) => `<path pathLength="1" style="--i:${k}" d="${d}"/>`).join('')}${
    [0, 1, 3].map((k, n) => `<path class="spark" pathLength="1" style="--i:${n}" d="${TRACES[k]}"/>`).join('')}${
    TRACES.map((d, k) => { const [x, y] = traceEnd(d); return `<circle style="--i:${k}" cx="${x}" cy="${y}" r="2.2"/>`; }).join('')}</svg>`;
  const TICKS = '<i class="nge-intro-tick a"></i><i class="nge-intro-tick b"></i>';
  panel.innerHTML = `<span class="nge-intro-plate-bg"></span>${circuit}<span class="nge-intro-ring"></span><span class="nge-intro-scan"></span>
    <i class="nge-intro-corner tl"></i><i class="nge-intro-corner tr"></i><i class="nge-intro-corner bl"></i><i class="nge-intro-corner br"></i>
    <div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Pyr<span class="nge-intro-bars"><i></i><i></i><i></i><i></i></span><button class="nge-intro-x" type="button" aria-label="Leave the introduction">${X_SVG}</button></div>
    <div class="nge-intro-title"></div><p class="nge-intro-body" aria-live="polite"></p>
    <div class="nge-intro-row"><button class="nge-intro-back" type="button">${BACK}Back</button><button class="nge-intro-next nge-intro-go" type="button"><span class="nge-intro-plate">${TICKS}<span class="nge-intro-label"></span>${CHEV}</span></button></div>
    <div class="nge-intro-confirm" role="alertdialog" aria-label="Leave the introduction?"><p>Leave the introduction?</p><small>You can start mapping right away.</small>
      <div class="nge-intro-row"><button class="nge-intro-leave" type="button">Leave</button><button class="nge-intro-next nge-intro-stay" type="button"><span class="nge-intro-plate">${TICKS}Keep going${CHEV}</span></button></div></div>`;
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
    if (from >= 0 && panel) { panel.classList.remove('nge-intro--beat'); void panel.offsetWidth; panel.classList.add('nge-intro--beat'); }
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
