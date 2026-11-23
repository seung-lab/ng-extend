<script setup lang="ts">
/**
 * Lab meeting preview (Ames 2026-11-22): a 3 minute show for the open lab
 * meeting. Nurro and the Starship fly through what alpha players have done
 * since Amy's last lab meeting in May, and it ends with an invitation to her
 * lab meeting on December 7 for the full tour. Admins start it from the menu.
 *
 * Keys: Right or Space for next, Left for back, P to pause, Esc to close.
 * Each scene moves on by itself after its time. The final scene stays.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import shipUrl from '../../static/badges/pyr/center-art/exploration/starship.png';
import nurroSuper from '../../static/nurro/nurro-super-v2.png';
import nurroHome from '../../static/nurro/nurro-at-home.png';
import nurroLaser from '../../static/nurro/nurro-laser-teach.png';
import nurroCool from '../../static/nurro/nurro-success.png';
import nurroScope from '../../static/nurro/nurro-microscope.png';
import nurroInspect from '../../static/nurro/nurro-inspector.png';
import nurroPopcorn from '../../static/nurro/nurro-popcorn-card.png';
import nurroParty from '../../static/nurro/nurro-confetti-card.png';
import embRetina from '../images/datasets/retina.png';
import embMec from '../images/datasets/mec.png';
import embFly from '../images/datasets/flywire.png';
import embBanc from '../images/datasets/banc.png';
import embCa3 from '../images/datasets/ca3.png';
import { ensureIntroStyle } from '../util/intro_tour';
import { createNeuronLayer, loadNeuronPoints, projectNeuron, type NeuronLayer } from '../util/lab_neuron';
import icoChat from '../../static/badges/pyr/center-art/exploration/radar-dish.png';
import icoAch from '../../static/badges/pyr/center-art/loyalty/second-spark.png';
import icoBug from '../../static/badges/pyr/center-art/exploration/magnifying-glass.png';
import icoStreak from '../../static/badges/pyr/center-art/loyalty/steady-signal.png';
import icoShip from '../../static/badges/pyr/center-art/exploration/rocket.png';
import { LabStats, SNAPSHOT, loadLabStats } from '../util/lab_meeting_stats';

const emit = defineEmits<{ (e: 'hide'): void }>();

const stats = ref<LabStats>(SNAPSHOT);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Scenes ──────────────────────────────────────────────────────────────────
type SceneId = 'intro' | 'players' | 'tutorials' | 'edits' | 'cells' | 'datasets' | 'community' | 'finale';
interface Scene { id: SceneId; ms: number; pose: string; say: () => string; hue: [string, string, string]; }
const SCENES: Scene[] = [
  { id: 'intro', ms: 15000, pose: nurroSuper, hue: ['#2a6bff', '#9b5cff', '#18d4ff'],
    say: () => "Hi, I'm Nurro, the mascot for Seung Lab's citizen science endeavors. Pyr is our citizen science game that is now in alpha testing." },
  { id: 'players', ms: 20000, pose: nurroHome, hue: ['#1f8bff', '#28e0c8', '#7a5cff'],
    say: () => `${fmt(stats.value.editors)} proofreaders and counting!` },
  { id: 'tutorials', ms: 22000, pose: nurroLaser, hue: ['#ff5c9a', '#7a5cff', '#2a9dff'],
    say: () => 'Training complete, cadets!' },
  { id: 'edits', ms: 24000, pose: nurroCool, hue: ['#18d4ff', '#2a6bff', '#ffcf4a'],
    say: () => 'Look at that curve go!' },
  { id: 'cells', ms: 21000, pose: nurroScope, hue: ['#ffb84a', '#ff5c9a', '#18d4ff'],
    say: () => 'Every dot is a finished cell!' },
  { id: 'datasets', ms: 17000, pose: nurroInspect, hue: ['#28e0c8', '#2a9dff', '#b45cff'],
    say: () => 'So many brains to explore!' },
  { id: 'community', ms: 21000, pose: nurroPopcorn, hue: ['#b45cff', '#ff5c9a', '#ffcf4a'],
    say: () => 'Best crew in the galaxy!' },
  { id: 'finale', ms: 0, pose: nurroParty, hue: ['#ff5c9a', '#ffcf4a', '#2a9dff'],
    say: () => 'See you there!' },
];

const idx = ref(0);
const scene = computed(() => SCENES[idx.value]);
const paused = ref(false);
const now = ref(performance.now());
const sceneStart = ref(performance.now());
let pausedAt = 0;
/** Milliseconds since the scene began, frozen while paused. */
const t = computed(() => paused.value ? pausedAt - sceneStart.value : now.value - sceneStart.value);

function go(i: number) {
  if (i < 0 || i >= SCENES.length) return;
  idx.value = i;
  sceneStart.value = performance.now();
  if (paused.value) pausedAt = sceneStart.value;
  warp = 1;
  sceneEntered(SCENES[i].id);
}
const next = () => go(idx.value + 1);
const prev = () => go(idx.value - 1);
function togglePause() {
  if (paused.value) { sceneStart.value += performance.now() - pausedAt; paused.value = false; }
  else { pausedAt = performance.now(); paused.value = true; }
}

// ── Easing and counters ────────────────────────────────────────────────────
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);
/** A number counting up from `from` to `to` over `dur` ms after `delay`. */
function count(to: number, delay = 0, dur = 2200, from = 0) {
  const q = reduced ? 1 : easeOut(clamp01((t.value - delay) / dur));
  return fmt(from + (to - from) * q);
}
const after = (ms: number) => reduced || t.value >= ms;
/** A line split into words and letters, each letter lighting up in turn. */
function lettered(words: { word: string; cls: string }[], step = 45) {
  let n = 0;
  return words.map(w => ({ ...w, letters: [...w.word].map(ch => ({ ch: ch === ' ' ? '\u00a0' : ch, d: (n++) * step })) }));
}
const FINALE_LINE = lettered([{ word: 'Amy flies you through', cls: 'lm-tag-a' }, { word: 'all of Pyr', cls: 'lm-tag-b' }], 40);
/** "Citizen science connectomics", one letter at a time. */
const TAGLINE = [
  { word: 'Citizen science', cls: 'lm-tag-a' },
  { word: 'connectomics', cls: 'lm-tag-b' },
].map((w, wi) => ({ ...w, letters: [...w.word].map((ch, i) => ({ ch: ch === ' ' ? '\u00a0' : ch, d: (wi * 16 + i) * 45 })) }));

// Nurro's words, typed out.
const spoken = computed(() => {
  const s = scene.value.say();
  if (reduced) return s;
  const n = Math.floor(clamp01((t.value - 1700) / (s.length * 32)) * s.length);
  return s.slice(0, n);
});

const MONTH_COLORS = ['#ffcf4a', '#ff9f5a', '#ff7aa8', '#ff5c9a', '#d06cff', '#b45cff', '#7a8cff', '#3fb4ff', '#28e0c8'];

// ── Tutorials ──────────────────────────────────────────────────────────────
const tutorialBars = computed(() => {
  const rows = stats.value.tutorials.slice(0, 9);
  const max = Math.max(1, ...rows.map(r => r.players));
  return rows.map((r, i) => ({ ...r, w: r.players / max, d: 600 + i * 260, c: MONTH_COLORS[(i * 2 + 3) % MONTH_COLORS.length] }));
});
const moreTutorials = computed(() => Math.max(0, stats.value.tutorials.length - 9));

// ── Edits: the growth curve ─────────────────────────────────────────────────
const CH = { w: 1000, h: 440, l: 30, r: 120, top: 40, b: 50 };
const ALPHA_MONTH = '2026-09';
/** Cumulative edits since alpha opened on September 28: Sep 28, Oct 1, Nov 1, now. */
const editCurve = computed(() => {
  const ms = stats.value.months;
  const before = ms.filter(m => m.m < ALPHA_MONTH).reduce((a, m) => a + m.edits, 0);
  let run = before;
  const vals = [{ label: 'Sep 28', v: before }];
  const names: Record<string, string> = { '2026-09': 'Oct 1', '2026-10': 'Nov 1', '2026-11': 'Now' };
  for (const m of ms.filter(m => m.m >= ALPHA_MONTH)) { run += m.edits; vals.push({ label: names[m.m] ?? m.label, v: run }); }
  const top = Math.max(1, run);
  const pts = vals.map((p, i) => ({ ...p, x: CH.l + (i / (vals.length - 1)) * (CH.w - CH.l - CH.r), y: CH.top + (1 - p.v / top) * (CH.h - CH.top - CH.b) }));
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], cx = (p0.x + p1.x) / 2;
    d += ` C${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`;
  }
  const area = `${d} L${pts[pts.length - 1].x},${CH.h - CH.b} L${pts[0].x},${CH.h - CH.b} Z`;
  return { pts, d, area, start: pts[0], last: pts[pts.length - 1] };
});

// ── Cells: one glowing dot per finished cell, on the real neuron ──────────
/** Points on the turning neuron, soma first, so lighting them in order grows the cell. */
let cloud: Float32Array | null = null, cloudN = 0;
function ensureCloud() {
  const n = stats.value.cells;
  if (cloudN === n) return;
  cloudN = n;
  void loadNeuronPoints(n).then(c => { if (cloudN === n) cloud = c; }, () => {});
}
function drawCellDots(ctx: CanvasRenderingContext2D) {
  if (!cloud) return;
  const total = cloud.length / 3;
  const lit = reduced ? total : Math.floor(easeOut(clamp01((t.value - 1200) / 8000)) * total);
  const novStart = total - Math.min(total, stats.value.months[stats.value.months.length - 1].cells);
  const aspect = W / Math.max(1, H);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < total; i++) {
    const [u, v, z] = projectNeuron(cloud[i * 3], cloud[i * 3 + 1], cloud[i * 3 + 2], neuronAng, aspect, neuronShift);
    const x = u * W, y = v * H, r = 1.6 + (0.5 - z * 0.5) * 0.9;
    if (i < lit) {
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = lit - i < 60 && lit < total ? '#ffffff' : i >= novStart ? '#ff7aa8' : '#3fd8ff';
    } else { ctx.globalAlpha = 0.1; ctx.fillStyle = '#9fc4ff'; }
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ── Datasets ────────────────────────────────────────────────────────────────
const datasets = computed(() => [
  { name: 'Mouse retina', img: embRetina, line: `${fmt(stats.value.byDataset.retina)} edits` },
  { name: 'Entorhinal cortex', img: embMec, line: `${fmt(stats.value.byDataset.mec)} edits` },
  { name: 'FlyWire', img: embFly, line: 'Fly brain' },
  { name: 'BANC', img: embBanc, line: 'Fly brain and nerve cord' },
  { name: 'CA3', img: embCa3, line: 'Hippocampus' },
]);

// ── Community ───────────────────────────────────────────────────────────────
const tiles = computed(() => {
  const s = stats.value;
  const out = [
    { icon: icoChat, n: s.chats, label: 'chat messages' },
    { icon: icoAch, n: s.achievements, label: 'achievements earned' },
    { icon: icoBug, n: s.reports, label: 'bug reports and ideas from players' },
    { icon: icoStreak, n: s.topStreak, label: 'day longest streak' },
  ];
  if (s.deploys) out.push({ icon: icoShip, n: s.deploys, label: 'updates shipped to players' });
  return out;
});

// ── The sky: stars, nebula, the Starship and sparks, on one canvas ─────────
const sky = ref<HTMLCanvasElement | null>(null);
const root = ref<HTMLElement | null>(null);
/** The popup itself: everything is laid out and drawn inside it. */
const stage = ref<HTMLElement | null>(null);
/** A real MICrONS neuron turning behind everything (Ames: "Need a neuron rotating in the background"). */
const neuronCv = ref<HTMLCanvasElement | null>(null);
let neuron: NeuronLayer | null = null, neuronAng = 0.4, neuronIn = 0, neuronShift = 0;
/** Brighter on the title and the finale, fainter behind charts so they read;
 *  on the cells scene a ghost, with the cells as dots on it. */
const NEURON_GLOW: Record<string, number> = { intro: 0.75, players: 0.55, tutorials: 0.35, edits: 0.3, cells: 0.14, datasets: 0.45, community: 0.35, finale: 0.7 };
const NEURON_SHIFT: Record<string, number> = { cells: 0.3 };
let neuronGlow = 0.6;
let raf = 0, warp = 1, W = 0, H = 0, dpr = 1;
interface Star { x: number; y: number; z: number; px: number; py: number; }
interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; r: number; c: string; }
let stars: Star[] = [];
let sparks: Spark[] = [];
const shipImg = new Image();
shipImg.src = shipUrl;
let hue = SCENES[0].hue.map(hexRgb), hueTo = hue;

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function resize() {
  const cv = sky.value!;
  dpr = Math.min(2, devicePixelRatio || 1);
  W = stage.value?.clientWidth || innerWidth; H = stage.value?.clientHeight || innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  neuron?.resize();
}
function newStar(far = false): Star {
  return { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: far ? 1 : Math.random(), px: NaN, py: NaN };
}

/** Where the ship is at time s (ms into the scene), or null when away. */
type Flight = { from: number; ms: number; at: (q: number) => [number, number]; scale: number };
let flights: Flight[] = [];
function sceneEntered(id: SceneId) {
  hueTo = SCENES[idx.value].hue.map(hexRgb);
  flights = [];
  const arc = (x0: number, y0: number, x1: number, y1: number, lift: number) =>
    (q: number): [number, number] => [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * lift];
  if (id === 'intro') {
    flights.push({ from: 200, ms: 3600, scale: 1.25, at: q => {
      // In from the lower left, a loop around the title, away to the upper right.
      const a = -Math.PI * 0.9 + q * Math.PI * 2.4;
      const r = 0.34 + (1 - q) * 0.5;
      return [W * (0.5 + Math.cos(a) * r * 0.9), H * (0.46 + Math.sin(a) * r * 0.55)];
    } });
  } else if (id === 'finale') {
    flights.push({ from: 600, ms: 1e9, scale: 0.9, at: q => {
      const s = q * 1e9 / 5200 * Math.PI * 2;
      return [W * (0.5 + Math.sin(s) * 0.38), H * (0.42 + Math.sin(s * 2) * 0.2)];
    } });
  } else {
    // A quick pass across the screen, alternating sides.
    const path = idx.value % 2 === 1 ? arc(-0.1, 0.85, 1.1, 0.12, 0.1) : arc(1.1, 0.8, -0.1, 0.18, 0.1);
    flights.push({ from: 150, ms: 2300, scale: 0.75, at: q => { const [x, y] = path(q); return [x * W, y * H]; } });
  }
}
function burst(x: number, y: number, n: number, colors: string[], speed = 1) {
  if (reduced) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (120 + Math.random() * 380) * speed;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.9 + Math.random() * 0.9, r: 1.5 + Math.random() * 2.5, c: colors[i % colors.length] });
  }
}
/** Sparks from the middle of an element, in the scene's colors. */
function burstAt(sel: string, n = 70) {
  const el = root.value?.querySelector(sel) as HTMLElement | null;
  if (!el) return;
  const b = el.getBoundingClientRect(), o = stage.value!.getBoundingClientRect();
  burst(b.left - o.left + b.width / 2, b.top - o.top + b.height / 2, n, SCENES[idx.value].hue.concat('#ffffff'));
}

let lastFrame = performance.now(), lastShip: [number, number] | null = null, nextFirework = 0;
function frame(nowMs: number) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  now.value = nowMs;
  const cv = sky.value;
  if (!cv) return;
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Nebula, easing toward the scene's colors.
  hue = hue.map((c, i) => c.map((v, k) => v + (hueTo[i][k] - v) * Math.min(1, dt * 1.5)) as [number, number, number]);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  const tt = nowMs / 1000;
  const blobs: [number, number, number][] = [
    [0.22 + Math.sin(tt * 0.05) * 0.05, 0.3, 0.55],
    [0.8, 0.7 + Math.cos(tt * 0.04) * 0.05, 0.6],
    [0.6 + Math.cos(tt * 0.03) * 0.08, 0.15, 0.4],
  ];
  ctx.globalCompositeOperation = 'lighter';
  blobs.forEach(([bx, by, br], i) => {
    const [r, g, b] = hue[i];
    const gr = ctx.createRadialGradient(bx * W, by * H, 0, bx * W, by * H, br * Math.max(W, H));
    gr.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},0.2)`);
    gr.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  });
  // The neuron, turning; it spins up with the warp at each scene change.
  if (neuron) {
    neuronIn = Math.min(1, neuronIn + dt / 2.5);
    if (!reduced) neuronAng += dt * ((paused.value ? 0.03 : 0.14) + warp * warp * 2.2);
    const lift = (c: [number, number, number]) => c.map(v => v * 0.75 + 70) as [number, number, number];
    neuronGlow += ((NEURON_GLOW[scene.value.id] ?? 0.5) - neuronGlow) * Math.min(1, dt * 1.2);
    neuronShift += ((NEURON_SHIFT[scene.value.id] ?? 0) - neuronShift) * Math.min(1, dt * 1.6);
    neuron.draw(neuronAng, lift(hue[1]), lift(hue[0]), neuronGlow * neuronIn, neuronShift);
  }
  if (scene.value.id === 'cells') { ensureCloud(); drawCellDots(ctx); }
  // Stars flying toward us; a warp on every scene change.
  warp = Math.max(0, warp - dt * 1.1);
  const speed = reduced ? 0 : (paused.value ? 0.02 : 0.06) + warp * warp * 1.6;
  const f = Math.min(W, H) * 0.9, cx = W / 2, cy = H / 2;
  for (const s of stars) {
    s.z -= speed * dt;
    if (s.z <= 0.02) { Object.assign(s, newStar(true)); continue; }
    const sx = cx + (s.x / s.z) * f, sy = cy + (s.y / s.z) * f;
    if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) { Object.assign(s, newStar(true)); continue; }
    const a = Math.min(1, (1 - s.z) * 1.4), w = Math.max(0.6, (1 - s.z) * 2.4);
    ctx.strokeStyle = `rgba(220,235,255,${a})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    if (warp > 0.08 && !Number.isNaN(s.px)) ctx.moveTo(s.px, s.py); else ctx.moveTo(sx - 0.01, sy);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    s.px = sx; s.py = sy;
  }
  // The Starship and its engine light.
  const st = t.value;
  let shipAt: [number, number] | null = null, shipScale = 1;
  for (const fl of flights) {
    const q = (st - fl.from) / fl.ms;
    if (q >= 0 && q <= 1) { shipAt = fl.at(q); shipScale = fl.scale; }
  }
  if (shipAt && !reduced) {
    const size = Math.max(70, Math.min(150, W * 0.075)) * shipScale;
    const [x, y] = shipAt;
    const [px, py] = lastShip ?? [x - 1, y];
    const ang = Math.atan2(y - py, x - px);
    for (let k = 0; k < 5; k++) {
      const side = (k % 2 ? 1 : -1) * size * 0.17, back = size * 0.4;
      sparks.push({
        x: x - Math.cos(ang) * back - Math.sin(ang) * side, y: y - Math.sin(ang) * back + Math.cos(ang) * side,
        vx: -Math.cos(ang) * 60 + (Math.random() - 0.5) * 40, vy: -Math.sin(ang) * 60 + (Math.random() - 0.5) * 40,
        age: 0, life: 0.5 + Math.random() * 0.4, r: size * (0.02 + Math.random() * 0.03), c: k % 3 ? '#5fd0ff' : '#ffffff',
      });
    }
    if (shipImg.complete) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(x, y);
      // A halo first, pulsing a little, so the ship glows.
      const pulse = 0.85 + Math.sin(nowMs / 180) * 0.15;
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.95);
      halo.addColorStop(0, `rgba(140,225,255,${0.55 * pulse})`);
      halo.addColorStop(0.45, `rgba(70,160,255,${0.25 * pulse})`);
      halo.addColorStop(1, 'rgba(70,160,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, size * 0.95, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // The picture's nose points down, so turn it to lead along the path.
      ctx.rotate(ang - Math.PI / 2);
      ctx.shadowColor = 'rgba(120,215,255,1)'; ctx.shadowBlur = 34 * pulse;
      ctx.drawImage(shipImg, -size / 2, -size / 2, size, size);
      ctx.shadowBlur = 14; ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(shipImg, -size / 2, -size / 2, size, size);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
    lastShip = shipAt;
  } else lastShip = null;
  // Fireworks at the end.
  if (scene.value.id === 'finale' && !paused.value && nowMs > nextFirework && st > 1500) {
    nextFirework = nowMs + 900 + Math.random() * 900;
    burst(W * (0.15 + Math.random() * 0.7), H * (0.12 + Math.random() * 0.35), 90, ['#ff5c9a', '#ffcf4a', '#3fd8ff', '#b45cff', '#ffffff'], 0.8);
  }
  // Sparks.
  ctx.globalCompositeOperation = 'lighter';
  sparks = sparks.filter(p => (p.age += dt) < p.life);
  for (const p of sparks) {
    p.vx *= 1 - dt * 1.6; p.vy = p.vy * (1 - dt * 1.6) + 60 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const a = 1 - p.age / p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Moving on by itself.
  const ms = scene.value.ms;
  if (ms && !paused.value && st > ms) next();
}

// Sparks when a big number lands.
const BURSTS: Partial<Record<SceneId, [number, string][]>> = {
  intro: [[2600, '.lm-title']],
  players: [[3000, '.lm-big']],
  tutorials: [[2800, '.lm-big']],
  edits: [[3200, '.lm-curve-end']],
  cells: [[2600, '.lm-big']],
  datasets: [[1400, '.lm-ring-core']],
  community: [[2200, '.lm-tile:nth-child(1)'], [2700, '.lm-tile:nth-child(2)'], [3200, '.lm-tile:nth-child(3)'], [3700, '.lm-tile:nth-child(4)'], [4200, '.lm-tile:nth-child(5)'], [4700, '.lm-tile:nth-child(6)']],
  finale: [[900, '.lm-finale-date'], [2400, '.lm-finale-date']],
};
let fired = new Set<string>();
watch(idx, () => { fired = new Set(); });
watch(t, v => {
  for (const [at, sel] of BURSTS[scene.value.id] ?? []) {
    const key = `${at}${sel}`;
    if (v >= at && !fired.has(key)) { fired.add(key); burstAt(sel, scene.value.id === 'community' ? 40 : 80); }
  }
});

// ── Keys and lifetime ──────────────────────────────────────────────────────
function onKey(e: KeyboardEvent) {
  const k = e.key;
  if (k === 'Escape') { close(); }
  else if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') next();
  else if (k === 'ArrowLeft' || k === 'PageUp') prev();
  else if (k === 'p' || k === 'P') togglePause();
  else if (k === 'Home') go(0);
  else if (k === 'End') go(SCENES.length - 1);
  else return;
  e.preventDefault();
  e.stopPropagation();
}
/** The controls: Pyr's command keys, each with its own little circuit. */
const keys = computed(() => [
  { label: 'Back', title: 'Back (Left)', act: prev, alt: true },
  { label: paused.value ? 'Play' : 'Pause', title: 'Pause or play (P)', act: togglePause, alt: true },
  { label: 'Next', title: 'Next (Right)', act: next, alt: false },
  { label: 'Close', title: 'Close (Esc)', act: close, alt: true },
].map((k, i) => ({ ...k, trace: i % 2 ? 'M2 2 V12 H18 L26 28 H58' : 'M2 28 V18 H22 L30 2 H58' })));
let hudTimer = 0;
const hudOn = ref(true);
function poke() {
  hudOn.value = true;
  clearTimeout(hudTimer);
  hudTimer = window.setTimeout(() => { hudOn.value = false; }, 2500);
}
function close() {
  emit('hide');
}

onMounted(() => {
  ensureIntroStyle(); // Pyr's command keys (.nge-go), from the Starship tour
  resize();
  stars = Array.from({ length: Math.round(Math.min(700, W * H / 3000)) }, () => newStar());
  addEventListener('resize', resize);
  addEventListener('keydown', onKey, true);
  go(0);
  poke();
  raf = requestAnimationFrame(frame);
  void loadLabStats().then(s => { stats.value = s; });
  if (neuronCv.value) void createNeuronLayer(neuronCv.value).then(l => { neuron = l; }, () => { /* no neuron: the sky alone */ });
});
onUnmounted(() => {
  cancelAnimationFrame(raf);
  neuron?.dispose(); neuron = null;
  removeEventListener('resize', resize);
  removeEventListener('keydown', onKey, true);
  clearTimeout(hudTimer);
});
</script>

<template>
  <div ref="root" class="lm-root" :class="{ 'lm-reduced': reduced }" @mousemove="poke" @click="poke">
   <div ref="stage" class="lm-stage">
    <canvas ref="neuronCv" class="lm-neuron" aria-hidden="true" />
    <canvas ref="sky" class="lm-sky" aria-hidden="true" />

    <transition name="lm-scene" mode="out-in">
      <!-- 1. Hello -->
      <section v-if="scene.id === 'intro'" key="intro" class="lm-scene lm-center">
        <div class="lm-kicker" :class="{ on: after(600) }">Seung Lab · open lab meeting</div>
        <h1 class="lm-title" :class="{ on: after(1800) }">PYR</h1>
        <div class="lm-tagline" :class="{ on: after(3200) }">
          <svg class="lm-trace lm-trace--l" viewBox="0 0 220 24" aria-hidden="true"><path d="M218 12 H120 L104 4 H6" pathLength="1" /><circle cx="6" cy="4" r="3.2" /><circle cx="218" cy="12" r="2.4" /></svg>
          <span class="lm-tag-words">
            <span v-for="w in TAGLINE" :key="w.word" class="lm-tag-word" :class="w.cls">
              <span v-for="(l, i) in w.letters" :key="i" class="lm-tag-l" :style="{ transitionDelay: `${l.d}ms` }">{{ l.ch }}</span>
            </span>
          </span>
          <svg class="lm-trace lm-trace--r" viewBox="0 0 220 24" aria-hidden="true"><path d="M2 12 H100 L116 20 H214" pathLength="1" /><circle cx="214" cy="20" r="3.2" /><circle cx="2" cy="12" r="2.4" /></svg>
        </div>
        <div class="lm-date" :class="{ on: after(5200) }">November 23, 2026</div>
      </section>

      <!-- 2. Players -->
      <section v-else-if="scene.id === 'players'" key="players" class="lm-scene lm-center">
        <div>
          <div class="lm-kicker on">The crew</div>
          <div class="lm-big">{{ count(stats.editors, 600, 2400) }}</div>
          <div class="lm-label">players have made proofreading edits</div>
          <div class="lm-line" :class="{ on: after(3600) }">Alpha testing began <b>September 28</b></div>
        </div>
      </section>

      <!-- 3. Tutorials -->
      <section v-else-if="scene.id === 'tutorials'" key="tutorials" class="lm-scene lm-split lm-split--wide">
        <div class="lm-copy">
          <div class="lm-kicker on">Training</div>
          <div class="lm-big">{{ count(13, 600, 1600) }}</div>
          <div class="lm-label">tutorials</div>
          <div class="lm-para" :class="{ on: after(2200) }">From the basics of the Neuroglancer interface, which we've completely redone to make it friendlier, all the way to resettable cuts and merges, and even real-time accuracy in the sandbox.</div>
          <div class="lm-line" :class="{ on: after(4200) }"><b>{{ count(stats.tutorialsDone, 4200, 1600) }}</b> finished by <b>{{ count(stats.tutorialPlayers, 4200, 1400) }}</b> players</div>
        </div>
        <div class="lm-bars">
          <div v-for="b in tutorialBars" :key="b.name" class="lm-bar" :class="{ on: after(b.d) }">
            <span class="lm-bar-name">{{ b.name }}</span>
            <span class="lm-bar-track"><span class="lm-bar-fill" :style="{ width: after(b.d) ? `${Math.max(4, b.w * 100)}%` : '0%', '--c': b.c }" /></span>
            <span class="lm-bar-n">{{ count(b.players, b.d, 1400) }}</span>
          </div>
          <div v-if="moreTutorials" class="lm-bar-more" :class="{ on: after(600 + 9 * 260) }">and {{ moreTutorials }} more</div>
        </div>
      </section>

      <!-- 4. Edits -->
      <section v-else-if="scene.id === 'edits'" key="edits" class="lm-scene lm-stack">
        <div class="lm-head">
          <div class="lm-kicker on">Proofreading edits</div>
          <div class="lm-big lm-big--wide">{{ count(stats.edits, 900, 2600) }}</div>
        </div>
        <svg class="lm-chart" :viewBox="`0 0 ${CH.w} ${CH.h}`" aria-hidden="true">
          <defs>
            <linearGradient id="lm-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fd8ff" stop-opacity=".45" /><stop offset="1" stop-color="#3fd8ff" stop-opacity="0" /></linearGradient>
            <linearGradient id="lm-stroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffcf4a" /><stop offset=".55" stop-color="#3fd8ff" /><stop offset="1" stop-color="#ff7aa8" /></linearGradient>
          </defs>
          <line v-for="p in editCurve.pts" :key="'g' + p.label" :x1="p.x" :x2="p.x" :y1="CH.top - 10" :y2="CH.h - CH.b" class="lm-grid" />
          <text v-for="p in editCurve.pts" :key="'l' + p.label" :x="p.x" :y="CH.h - CH.b + 30" class="lm-axis">{{ p.label }}</text>
          <path :d="editCurve.area" fill="url(#lm-area)" class="lm-area" :class="{ on: after(2600) }" />
          <path :d="editCurve.d" class="lm-curve" :class="{ on: after(600) }" pathLength="1" stroke="url(#lm-stroke)" />
          <g class="lm-then" :class="{ on: after(1200) }">
            <circle :cx="editCurve.start.x" :cy="editCurve.start.y" r="9" />
            <text :x="editCurve.start.x + 4" :y="editCurve.start.y - 64" class="lm-then-label">Alpha opens</text>
            <text :x="editCurve.start.x + 4" :y="editCurve.start.y - 34" class="lm-then-n">Sep 28</text>
          </g>
          <g class="lm-curve-end" :class="{ on: after(3200) }">
            <circle :cx="editCurve.last.x" :cy="editCurve.last.y" r="12" />
            <circle :cx="editCurve.last.x" :cy="editCurve.last.y" r="12" class="lm-ping" />
            <text :x="editCurve.last.x + 22" :y="editCurve.last.y + 8" class="lm-now-label">Now</text>
          </g>
        </svg>
      </section>

      <!-- 5. Cells -->
      <section v-else-if="scene.id === 'cells'" key="cells" class="lm-scene lm-split">
        <div class="lm-copy lm-copy--narrow">
          <div class="lm-kicker on">Cells completed</div>
          <div class="lm-big">{{ count(stats.cells, 600, 2000) }}</div>
          <div class="lm-label">one glowing dot for every cell a player finished</div>
          <div class="lm-legend lm-legend--col" :class="{ on: after(1800) }">
            <span style="--c: #3fd8ff"><i />Through October</span>
            <span style="--c: #ff7aa8"><i />November, at the tips</span>
          </div>
        </div>
      </section>

      <!-- 6. Datasets -->
      <section v-else-if="scene.id === 'datasets'" key="datasets" class="lm-scene lm-center">
        <div class="lm-kicker on">Across the lab's data</div>
        <div class="lm-ring">
          <div class="lm-ring-core">
            <div class="lm-ring-n">{{ datasets.length }}</div>
            <div class="lm-ring-l">datasets</div>
          </div>
          <div v-for="(d, i) in datasets" :key="d.name" class="lm-orbit" :style="{ '--a': `${i * (360 / datasets.length) - 90}deg`, '--d': `${400 + i * 350}ms` }">
            <div class="lm-planet">
              <img :src="d.img" alt="" draggable="false" />
              <b>{{ d.name }}</b>
              <span>{{ d.line }}</span>
            </div>
          </div>
        </div>
        <div class="lm-line on lm-ring-foot" :class="{ on: after(2600) }">plus <b>{{ fmt(stats.byDataset.sandbox) }}</b> practice edits in the training sandbox</div>
      </section>

      <!-- 7. Community -->
      <section v-else-if="scene.id === 'community'" key="community" class="lm-scene lm-stack">
        <div class="lm-head">
          <div class="lm-kicker on">A community</div>
          <div class="lm-title-s" :class="{ on: after(500) }">Players talk, play and build Pyr with us</div>
        </div>
        <div class="lm-tiles">
          <div v-for="(tile, i) in tiles" :key="tile.label" class="lm-tile" :class="{ on: after(1800 + i * 500) }">
            <img class="lm-tile-icon" :src="tile.icon" alt="" draggable="false" />
            <b>{{ count(tile.n, 1800 + i * 500, 1500) }}</b>
            <span>{{ tile.label }}</span>
          </div>
        </div>
      </section>

      <!-- 8. See you December 7 -->
      <section v-else key="finale" class="lm-scene lm-center">
        <div class="lm-kicker on">Want the full tour?</div>
        <div class="lm-finale-join" :class="{ on: after(400) }">Join lab meeting</div>
        <div class="lm-finale-date" :class="{ on: after(900) }"><span class="lm-fd-month">December</span><span class="lm-fd-day">7</span></div>
        <div class="lm-tagline" :class="{ on: after(2200) }">
          <svg class="lm-trace lm-trace--l" viewBox="0 0 220 24" aria-hidden="true"><path d="M218 12 H120 L104 4 H6" pathLength="1" /><circle cx="6" cy="4" r="3.2" /><circle cx="218" cy="12" r="2.4" /></svg>
          <span class="lm-tag-words lm-tag-words--s">
            <span v-for="w in FINALE_LINE" :key="w.word" class="lm-tag-word" :class="w.cls">
              <span v-for="(l, i) in w.letters" :key="i" class="lm-tag-l" :style="{ transitionDelay: `${l.d}ms` }">{{ l.ch }}</span>
            </span>
          </span>
          <svg class="lm-trace lm-trace--r" viewBox="0 0 220 24" aria-hidden="true"><path d="M2 12 H100 L116 20 H214" pathLength="1" /><circle cx="214" cy="20" r="3.2" /><circle cx="2" cy="12" r="2.4" /></svg>
        </div>
      </section>
    </transition>

    <!-- Nurro, the guide -->
    <transition name="lm-nurro" mode="out-in">
      <div :key="scene.id" class="lm-guide" :class="{ 'lm-guide--finale': scene.id === 'finale', 'lm-guide--intro': scene.id === 'intro' }">
        <img class="lm-guide-pic" :src="scene.pose" alt="" draggable="false" />
        <div class="lm-bubble">
          <div class="lm-bubble-name">Nurro</div>
          <div class="lm-bubble-text">{{ spoken }}<span class="lm-caret" /></div>
        </div>
      </div>
    </transition>

    <!-- Controls, shown when the mouse moves -->
    <div class="lm-hud" :class="{ on: hudOn || paused }">
      <span class="lm-dots">
        <button v-for="(s, i) in SCENES" :key="s.id" type="button" class="lm-dot" :class="{ on: i === idx, done: i < idx }" :title="s.id" @click.stop="go(i)">
          <i v-if="i === idx && s.ms" :style="{ width: `${clamp01(t / s.ms) * 100}%` }" />
        </button>
      </span>
      <button v-for="(k, ki) in keys" :key="ki" type="button" class="nge-go lm-key" :class="{ 'nge-go--alt': k.alt }" :title="k.title" :style="{ '--k': ki }" @click.stop="k.act()">
        <span class="nge-go-label">{{ k.label }}</span>
        <svg class="lm-key-circuit" viewBox="0 0 60 30" aria-hidden="true">
          <path :d="k.trace" pathLength="1" />
          <path class="lm-key-spark" :d="k.trace" pathLength="1" />
          <circle cx="58" :cy="ki % 2 ? 28 : 2" r="2.6" />
        </svg>
      </button>
    </div>
   </div>
  </div>
</template>

<style scoped>
.lm-root {
  position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
  background: radial-gradient(ellipse at center, rgba(3, 6, 20, .15), rgba(3, 6, 20, .55));
  color: #eaf4ff; cursor: default; font-family: Inter, system-ui, sans-serif; user-select: none;
  animation: lm-fade .6s ease both;
}
/* A popup in front of Pyr: Pyr and its neuron show around it and through it. */
.lm-stage {
  position: relative; overflow: hidden; container-type: size;
  width: min(92vw, 163vh); height: min(51.75vw, 92vh);
  border-radius: 26px; background: linear-gradient(160deg, rgba(8, 16, 48, .62), rgba(5, 10, 31, .5));
  border: 1px solid rgba(140, 210, 255, .4);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .04) inset, 0 0 60px rgba(70, 160, 255, .35), 0 30px 90px rgba(0, 0, 0, .45);
  animation: lm-pop-in .8s cubic-bezier(.2, 1.3, .4, 1) both;
}
@keyframes lm-fade { from { opacity: 0; } }
@keyframes lm-pop-in { from { opacity: 0; transform: scale(.85); } }
.lm-sky { position: absolute; inset: 0; width: 100%; height: 100%; }
.lm-neuron { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; mix-blend-mode: screen; }

/* Scenes */
.lm-scene { position: absolute; inset: 0 0 13cqh; display: flex; padding: 6cqh 7cqw 0; box-sizing: border-box; }
.lm-center { flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.lm-split { align-items: center; justify-content: space-between; gap: 4cqw; }
.lm-stack { flex-direction: column; align-items: center; justify-content: center; gap: 2.4cqh; }
.lm-scene-enter-active { transition: opacity .7s ease, transform .9s cubic-bezier(.2, .9, .2, 1), filter .7s; }
.lm-scene-leave-active { transition: opacity .45s ease, transform .5s ease-in, filter .45s; }
.lm-scene-enter-from { opacity: 0; transform: scale(.82) translateZ(0); filter: blur(14px); }
.lm-scene-leave-to { opacity: 0; transform: scale(1.25); filter: blur(10px); }

.lm-kicker {
  font: 600 clamp(12px, 1.05cqw, 18px) Orbitron, Inter, sans-serif; letter-spacing: .38em; text-transform: uppercase;
  color: #9fdcff; opacity: 0; transform: translateY(10px); transition: all .8s ease;
}
.lm-kicker.on, .on > .lm-kicker { opacity: 1; transform: none; }
.lm-title {
  margin: 1cqh 0 0; font: 900 clamp(90px, 15cqw, 260px)/1 Orbitron, Inter, sans-serif; letter-spacing: .12em;
  color: #f4fbff; -webkit-text-stroke: 1px rgba(160, 230, 255, .9);
  text-shadow: 0 0 18px rgba(120, 215, 255, .85), 0 0 60px rgba(60, 150, 255, .55), 5px 5px 0 rgba(60, 150, 255, .35);
  opacity: 0; transform: scale(.6); transition: opacity 1s, transform 1.4s cubic-bezier(.2, 1.4, .3, 1);
}
.lm-title.on { opacity: 1; transform: none; }
@keyframes lm-shine { to { background-position: -250% 0; } }
.lm-sub, .lm-since {
  margin-top: 2cqh; font: 600 clamp(20px, 2.3cqw, 40px) Inter, sans-serif; color: #dff0ff;
  opacity: 0; transform: translateY(14px); transition: all .9s ease;
}
.lm-since { font: 600 clamp(14px, 1.3cqw, 22px) Orbitron, Inter, sans-serif; letter-spacing: .2em; text-transform: uppercase; color: #ffcf4a; }
.lm-since span { padding: .6em 1.4em; border: 1px solid rgba(255, 207, 74, .5); border-radius: 999px; background: rgba(255, 207, 74, .08); box-shadow: 0 0 30px rgba(255, 207, 74, .2); }
.lm-sub.on, .lm-since.on { opacity: 1; transform: none; }
/* The tagline: a circuit lockup, its letters lighting up one by one. */
.lm-tagline { display: flex; align-items: center; gap: 1.4cqw; margin-top: 3cqh; }
.lm-trace { width: clamp(70px, 10cqw, 200px); height: auto; overflow: visible; }
.lm-trace path { fill: none; stroke: rgba(126, 224, 255, .75); stroke-width: 1.6; stroke-dasharray: 1; stroke-dashoffset: 1; filter: drop-shadow(0 0 4px rgba(126, 224, 255, .8)); }
.lm-tagline.on .lm-trace path { stroke-dashoffset: 0; transition: stroke-dashoffset 1.3s cubic-bezier(.5, 0, .2, 1) .2s; }
.lm-trace circle { fill: #0a1834; stroke: #9fe9ff; stroke-width: 1.6; opacity: 0; transition: opacity .4s 1.3s; }
.lm-tagline.on .lm-trace circle { opacity: 1; }
.lm-tag-words { display: flex; gap: .7em; font: 700 clamp(16px, 1.9cqw, 36px) Orbitron, Inter, sans-serif; letter-spacing: .3em; text-transform: uppercase; white-space: nowrap; }
.lm-tag-l { display: inline-block; opacity: 0; transform: translateY(.4em); filter: blur(6px); transition: opacity .35s, transform .5s cubic-bezier(.2, 1.5, .4, 1), filter .4s; }
.lm-tagline.on .lm-tag-l { opacity: 1; transform: none; filter: none; }
.lm-tag-a { color: #eaf6ff; text-shadow: 0 0 12px rgba(140, 210, 255, .5); }
.lm-tag-b { color: #7ee0ff; text-shadow: 0 0 14px rgba(70, 200, 255, .9), 0 0 34px rgba(60, 150, 255, .5); }
.lm-date {
  margin-top: 3.4cqh; font: 600 clamp(13px, 1.3cqw, 24px) Orbitron, Inter, sans-serif; letter-spacing: .34em; text-transform: uppercase; color: #ffcf4a;
  text-shadow: 0 0 16px rgba(255, 207, 74, .55); opacity: 0; transform: translateY(10px); transition: all .9s ease;
}
.lm-date::before, .lm-date::after { content: ''; display: inline-block; width: 7px; height: 7px; margin: 0 1.1em .18em; border-radius: 50%; background: #ffcf4a; box-shadow: 0 0 10px #ffcf4a; }
.lm-date.on { opacity: 1; transform: none; }

.lm-copy { flex: 0 0 40%; }
.lm-big {
  font: 800 clamp(80px, 11cqw, 200px)/1 Orbitron, Inter, sans-serif; font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #ffffff, #9fdcff); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 26px rgba(90, 200, 255, .55)); margin: 1cqh 0;
}
.lm-big--wide { font-size: clamp(70px, 9cqw, 170px); }
.lm-label { font: 600 clamp(20px, 2cqw, 36px) Inter, sans-serif; color: #dff0ff; }
.lm-line { margin-top: 2.4cqh; font: 500 clamp(16px, 1.5cqw, 26px) Inter, sans-serif; color: #cfe3ff; opacity: 0; transform: translateY(10px); transition: all .8s; }
.lm-line b { color: #ffcf4a; font-family: Orbitron, Inter, sans-serif; }
.lm-line.on { opacity: 1; transform: none; }
.lm-para { margin-top: 2.2cqh; max-width: 34em; font: 500 clamp(15px, 1.35cqw, 24px)/1.5 Inter, sans-serif; color: #dbeaff; opacity: 0; transform: translateY(10px); transition: all .8s; }
.lm-para.on { opacity: 1; transform: none; }
.lm-copy--narrow { flex-basis: 34%; }
.lm-copy--narrow .lm-label { font-size: clamp(16px, 1.5cqw, 26px); max-width: 16em; }
.lm-legend--col { flex-direction: column; gap: 12px; margin-top: 3cqh; }
.lm-title-s { font: 700 clamp(26px, 3cqw, 52px) Inter, sans-serif; opacity: 0; transform: translateY(12px); transition: all .9s; }
.lm-title-s.on { opacity: 1; transform: none; }

/* Players */
.lm-months { margin-top: 3cqh; display: flex; flex-wrap: wrap; gap: 10px; opacity: 0; transition: opacity .8s; }
.lm-months.on { opacity: 1; }
.lm-month-chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: rgba(255, 255, 255, .07); border: 1px solid rgba(255, 255, 255, .14); font: 600 clamp(13px, 1.1cqw, 18px) Inter, sans-serif; }
.lm-month-chip i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
.lm-month-chip b { color: var(--c); }
@keyframes lm-spin { to { transform: rotate(360deg); } }
.lm-star { opacity: 0; transform-box: fill-box; transform-origin: center; filter: drop-shadow(0 0 6px currentColor); animation: lm-pop .7s cubic-bezier(.2, 1.6, .4, 1) forwards, lm-twinkle 3s ease-in-out infinite alternate; }
@keyframes lm-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
@keyframes lm-twinkle { from { filter: drop-shadow(0 0 3px currentColor); } to { filter: drop-shadow(0 0 10px currentColor); } }

/* Tutorials */
.lm-split--wide .lm-copy { flex-basis: 34%; }
.lm-bars { flex: 1 1 auto; display: flex; flex-direction: column; gap: 1.5cqh; }
.lm-bar { display: grid; grid-template-columns: minmax(180px, 34%) 1fr 70px; align-items: center; gap: 16px; opacity: 0; transform: translateX(30px); transition: all .6s cubic-bezier(.2, .9, .2, 1); }
.lm-bar.on { opacity: 1; transform: none; }
.lm-bar-name { font: 600 clamp(14px, 1.25cqw, 22px) Inter, sans-serif; text-align: right; color: #dff0ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-bar-track { height: clamp(16px, 2.2cqh, 26px); border-radius: 999px; background: rgba(255, 255, 255, .07); overflow: hidden; }
.lm-bar-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--c), #ffffff); box-shadow: 0 0 18px var(--c); transition: width 1.4s cubic-bezier(.2, .9, .2, 1); }
.lm-bar-n { font: 700 clamp(16px, 1.5cqw, 26px) Orbitron, Inter, sans-serif; font-variant-numeric: tabular-nums; }
.lm-bar-more { margin-left: calc(34% + 16px); font: 500 clamp(13px, 1.1cqw, 18px) Inter, sans-serif; color: #9fbfe6; opacity: 0; transition: opacity .6s; }
.lm-bar-more.on { opacity: 1; }

/* Edits */
.lm-head { text-align: center; }
.lm-chart { width: min(70cqw, 92cqh); height: auto; overflow: visible; }
.lm-grid { stroke: rgba(160, 200, 255, .12); stroke-width: 1; }
.lm-axis { fill: #9fbfe6; font: 600 18px Orbitron, Inter, sans-serif; text-anchor: middle; }
.lm-curve { fill: none; stroke-width: 7; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; filter: drop-shadow(0 0 10px rgba(63, 216, 255, .8)); }
.lm-curve.on { transition: stroke-dashoffset 2.8s cubic-bezier(.6, 0, .3, 1); stroke-dashoffset: 0; }
.lm-area { opacity: 0; transition: opacity 1.2s; }
.lm-area.on { opacity: 1; }
.lm-then, .lm-curve-end { opacity: 0; transition: opacity .6s; }
.lm-then.on, .lm-curve-end.on { opacity: 1; }
.lm-then circle { fill: #ffcf4a; filter: drop-shadow(0 0 8px #ffcf4a); }
.lm-then-label { fill: #ffcf4a; font: 600 18px Orbitron, Inter, sans-serif; text-anchor: middle; letter-spacing: .12em; text-transform: uppercase; }
.lm-then-n { fill: #fff; font: 700 26px Orbitron, Inter, sans-serif; text-anchor: middle; }
.lm-curve-end circle { fill: #ff7aa8; filter: drop-shadow(0 0 10px #ff7aa8); }
.lm-curve-end .lm-ping { fill: none; stroke: #ff7aa8; stroke-width: 3; transform-box: fill-box; transform-origin: center; animation: lm-ping 1.6s ease-out infinite; }
@keyframes lm-ping { from { transform: scale(1); opacity: 1; } to { transform: scale(4); opacity: 0; } }
.lm-now-label { fill: #ff7aa8; font: 700 22px Orbitron, Inter, sans-serif; letter-spacing: .1em; }
.lm-times {
  font: 800 clamp(26px, 3.2cqw, 56px) Orbitron, Inter, sans-serif; color: #ffcf4a; text-shadow: 0 0 24px rgba(255, 207, 74, .6);
  opacity: 0; transform: scale(.5); transition: opacity .6s, transform .9s cubic-bezier(.2, 1.6, .3, 1);
}
.lm-times.on { opacity: 1; transform: none; }

/* Cells */
.lm-legend { display: flex; gap: 26px; font: 600 clamp(14px, 1.2cqw, 20px) Inter, sans-serif; opacity: 0; transition: opacity .8s; }
.lm-legend.on { opacity: 1; }
.lm-legend span { display: inline-flex; align-items: center; gap: 8px; }
.lm-legend i { width: 14px; height: 14px; border-radius: 3px; background: var(--c); box-shadow: 0 0 10px var(--c); }

/* Datasets */
.lm-ring { position: relative; width: min(64cqh, 70cqw); height: min(64cqh, 70cqw); margin-top: 2cqh; }
.lm-ring::before { content: ''; position: absolute; inset: 12%; border-radius: 50%; border: 2px dashed rgba(159, 220, 255, .25); animation: lm-spin 40s linear infinite; }
.lm-ring-core { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; }
.lm-ring-n { font: 900 clamp(70px, 9cqh, 130px)/1 Orbitron, Inter, sans-serif; color: #fff; text-shadow: 0 0 30px rgba(90, 200, 255, .8); }
.lm-ring-l { font: 600 clamp(14px, 1.3cqw, 22px) Orbitron, Inter, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #9fdcff; }
.lm-orbit { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform: rotate(var(--a)); animation: lm-orbit 50s linear infinite; }
@keyframes lm-orbit { from { transform: rotate(var(--a)); } to { transform: rotate(calc(var(--a) + 360deg)); } }
.lm-planet {
  position: absolute; left: calc(min(32cqh, 35cqw) * .76); top: 0; width: 180px; margin: -70px 0 0 -90px; text-align: center;
  transform: rotate(calc(-1 * var(--a))); animation: lm-counter 50s linear infinite, lm-planet-in .9s cubic-bezier(.2, 1.5, .4, 1) var(--d) both;
}
@keyframes lm-counter { from { rotate: 0deg; } to { rotate: -360deg; } }
@keyframes lm-planet-in { from { opacity: 0; scale: .2; } to { opacity: 1; scale: 1; } }
.lm-planet img { width: clamp(64px, 8cqh, 110px); height: auto; filter: drop-shadow(0 0 16px rgba(90, 200, 255, .7)); }
.lm-planet b { display: block; font: 700 clamp(14px, 1.2cqw, 20px) Inter, sans-serif; margin-top: 4px; }
.lm-planet span { display: block; font: 500 clamp(12px, 1cqw, 16px) Inter, sans-serif; color: #ffcf4a; }
.lm-ring-foot { margin-top: 1cqh; }

/* Community */
.lm-tiles { display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); gap: 2.2cqh 2cqw; width: min(80cqw, 1300px); margin-top: 2cqh; }
.lm-tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 2.4cqh 1cqw; border-radius: 22px;
  background: linear-gradient(160deg, rgba(255, 255, 255, .1), rgba(255, 255, 255, .03)); border: 1px solid rgba(255, 255, 255, .16);
  box-shadow: 0 10px 40px rgba(0, 0, 0, .25), inset 0 0 30px rgba(120, 180, 255, .08);
  opacity: 0; transform: translateY(30px) scale(.9); transition: all .7s cubic-bezier(.2, 1.4, .4, 1);
}
.lm-tile.on { opacity: 1; transform: none; }
.lm-tile { grid-column: span 2; }
.lm-tile:nth-child(4) { grid-column: 2 / span 2; }
.lm-tile-icon { width: clamp(48px, 7cqh, 84px); height: auto; filter: drop-shadow(0 0 14px rgba(110, 200, 255, .45)); }
.lm-tile b { font: 800 clamp(34px, 3.6cqw, 64px) Orbitron, Inter, sans-serif; font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 0 18px rgba(90, 200, 255, .6); }
.lm-tile span:last-child { font: 600 clamp(13px, 1.15cqw, 20px) Inter, sans-serif; color: #cfe3ff; text-align: center; }

/* Finale */
.lm-finale-join { font: 700 clamp(24px, 2.8cqw, 52px) Orbitron, Inter, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #dff0ff; margin-top: 2cqh; opacity: 0; transform: translateY(20px); transition: all .9s; }
.lm-finale-join.on { opacity: 1; transform: none; }
.lm-finale-date {
  display: flex; align-items: center; gap: .3em; margin: 1cqh 0 .5cqh; font: 900 clamp(70px, 9.5cqw, 190px)/1.05 Orbitron, Inter, sans-serif; letter-spacing: .06em;
  opacity: 0; transform: scale(.4); transition: opacity .8s, transform 1.3s cubic-bezier(.2, 1.5, .3, 1);
}
.lm-finale-date.on { opacity: 1; transform: none; }
.lm-fd-month { color: #f4fbff; -webkit-text-stroke: 1px rgba(160, 230, 255, .9);
  text-shadow: 0 0 18px rgba(120, 215, 255, .85), 0 0 60px rgba(60, 150, 255, .55), 5px 5px 0 rgba(60, 150, 255, .35); }
.lm-fd-day { position: relative; display: grid; place-items: center; width: 1.25em; height: 1.25em; color: #ffcf4a;
  text-shadow: 0 0 20px rgba(255, 207, 74, .9), 0 0 50px rgba(255, 160, 60, .5); }
.lm-fd-day::before { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 3px solid rgba(255, 207, 74, .75);
  box-shadow: 0 0 24px rgba(255, 207, 74, .55), inset 0 0 24px rgba(255, 207, 74, .25); animation: lm-ring-pulse 2.4s ease-in-out infinite; }
.lm-fd-day::after { content: ''; position: absolute; inset: -10%; border-radius: 50%; border: 2px dashed rgba(255, 207, 74, .35); animation: lm-spin 18s linear infinite; }
@keyframes lm-ring-pulse { 50% { box-shadow: 0 0 40px rgba(255, 207, 74, .8), inset 0 0 30px rgba(255, 207, 74, .35); } }
.lm-tag-words--s { font-size: clamp(14px, 1.5cqw, 28px); }

/* Nurro */
.lm-guide { position: absolute; left: 1.6cqw; bottom: 1.8cqh; display: flex; align-items: flex-end; gap: 6px; pointer-events: none; }
.lm-guide-pic { width: clamp(84px, 12cqh, 140px); height: auto; filter: drop-shadow(0 4px 14px rgba(0, 0, 0, .4)) drop-shadow(0 0 16px rgba(120, 200, 255, .35)); animation: lm-bob 2.6s ease-in-out infinite; }
@keyframes lm-bob { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-8px) rotate(3deg); } }
.lm-bubble {
  position: relative; margin-bottom: 7cqh; padding: 8px 14px 9px; border-radius: 14px 14px 14px 3px;
  background: rgba(10, 22, 58, .78); border: 1px solid rgba(140, 210, 255, .45); backdrop-filter: blur(8px);
  box-shadow: 0 0 24px rgba(60, 170, 255, .25); white-space: nowrap;
}
.lm-guide--intro .lm-bubble { white-space: normal; max-width: min(34em, 46cqw); }
.lm-bubble-name { display: none; }
.lm-bubble-text { font: 700 clamp(13px, 1.15cqw, 20px)/1.4 Inter, sans-serif; color: #fff; }
.lm-caret { display: inline-block; width: .5em; height: 1em; margin-left: 2px; vertical-align: -2px; background: #9fdcff; animation: lm-blink 1s steps(1) infinite; }
@keyframes lm-blink { 50% { opacity: 0; } }
.lm-nurro-enter-active { transition: opacity .4s 1.2s, transform .8s cubic-bezier(.2, 1.7, .4, 1) 1.2s; }
.lm-nurro-leave-active { transition: opacity .3s, transform .3s; }
.lm-nurro-enter-from { opacity: 0; transform: translate(-40px, 60px) scale(.5) rotate(-12deg); }
.lm-nurro-leave-to { opacity: 0; transform: translate(-30px, 20px); }

/* Controls */
.lm-hud {
  position: absolute; right: 2.2cqw; bottom: 3.4cqh; display: flex; align-items: center; gap: 16px;
  opacity: 0; transition: opacity .6s;
}
/* Pyr's command keys, each with a little circuit off its corner and a spark running along it. */
.lm-hud .lm-key { margin-left: 0; height: 40px; overflow: visible; }
.lm-hud .lm-key .nge-go-label { padding: 0 18px; font-size: 11px; letter-spacing: .24em; }
.lm-hud .nge-go--alt .nge-go-label { background: linear-gradient(180deg, rgba(126, 224, 255, .1), rgba(40, 110, 200, .08)); }
.lm-hud .nge-go--alt .nge-go-label::before { opacity: .7; }
.lm-key-circuit { position: absolute; left: -30px; bottom: calc(100% - 8px); width: 40px; height: 20px; overflow: visible; pointer-events: none; }
.lm-key-circuit path { fill: none; stroke: rgba(126, 224, 255, .5); stroke-width: 1.2; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.lm-hud.on .lm-key-circuit path:not(.lm-key-spark) { animation: lm-trace-in .9s ease-out both; animation-delay: calc(var(--k) * 120ms); }
.lm-key-circuit .lm-key-spark { stroke: #e2fbff; stroke-width: 2.2; stroke-dasharray: .16 .84; stroke-dashoffset: 1.16; filter: drop-shadow(0 0 3px #7ee0ff); opacity: 0; }
.lm-hud.on .lm-key-circuit .lm-key-spark { opacity: 1; animation: lm-spark 2.4s linear infinite; animation-delay: calc(1s + var(--k) * 600ms); }
.lm-key-circuit circle { fill: #0a1834; stroke: #9fe9ff; stroke-width: 1.4; opacity: 0; transition: opacity .3s; }
.lm-hud.on .lm-key-circuit circle { opacity: 1; transition-delay: calc(.8s + var(--k) * 120ms); }
.lm-key:hover .lm-key-circuit path { stroke: #9fe9ff; }
@keyframes lm-trace-in { to { stroke-dashoffset: 0; } }
@keyframes lm-spark { from { stroke-dashoffset: 1.16; } to { stroke-dashoffset: 0; } }
.lm-hud.on { opacity: 1; }
.lm-dots { display: flex; gap: 6px; }
.lm-dot { all: unset; cursor: pointer; position: relative; width: 22px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .2); overflow: hidden; }
.lm-dot.done { background: rgba(159, 220, 255, .7); }
.lm-dot.on { width: 40px; background: rgba(255, 255, 255, .25); }
.lm-dot i { position: absolute; inset: 0 auto 0 0; background: #ffcf4a; }

.lm-reduced *, .lm-reduced *::before { animation: none !important; transition: none !important; }
.lm-reduced .lm-star { opacity: 1; }
</style>
