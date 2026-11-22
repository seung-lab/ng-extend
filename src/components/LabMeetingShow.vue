<script setup lang="ts">
/**
 * Lab meeting preview (Ames 2026-11-22): a 3 minute show for the open lab
 * meeting. Nurro and the Starship fly through what beta players have done
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
import { LabStats, SNAPSHOT, THEN_MONTH, loadLabStats, thenTotals } from '../util/lab_meeting_stats';

const emit = defineEmits<{ (e: 'hide'): void }>();

const stats = ref<LabStats>(SNAPSHOT);
const then = computed(() => thenTotals(stats.value));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Scenes ──────────────────────────────────────────────────────────────────
type SceneId = 'intro' | 'players' | 'tutorials' | 'edits' | 'cells' | 'datasets' | 'community' | 'finale';
interface Scene { id: SceneId; ms: number; pose: string; say: () => string; hue: [string, string, string]; }
const SCENES: Scene[] = [
  { id: 'intro', ms: 15000, pose: nurroSuper, hue: ['#2a6bff', '#9b5cff', '#18d4ff'],
    say: () => "Hi everyone! I'm Nurro, Pyr's guide. Buckle up: here is what our beta players have done since Amy's last lab meeting this spring." },
  { id: 'players', ms: 20000, pose: nurroHome, hue: ['#1f8bff', '#28e0c8', '#7a5cff'],
    say: () => `${fmt(stats.value.signedIn)} people have signed in to the Pyr beta, and ${fmt(stats.value.months[stats.value.months.length - 1].joined)} of them joined this month!` },
  { id: 'tutorials', ms: 22000, pose: nurroLaser, hue: ['#ff5c9a', '#7a5cff', '#2a9dff'],
    say: () => `Before they proofread, players train. ${fmt(stats.value.tutorialPlayers)} players have finished ${fmt(stats.value.tutorialsDone)} tutorials.` },
  { id: 'edits', ms: 24000, pose: nurroCool, hue: ['#18d4ff', '#2a6bff', '#ffcf4a'],
    say: () => `At the last lab meeting we had about ${fmt(Math.round(then.value.edits / 100) * 100)} edits. Now there are ${fmt(stats.value.edits)}. That's ${Math.round(stats.value.edits / Math.max(1, then.value.edits))} times more!` },
  { id: 'cells', ms: 21000, pose: nurroScope, hue: ['#ffb84a', '#ff5c9a', '#18d4ff'],
    say: () => `Every little square is a cell a player finished: ${fmt(stats.value.cells)} so far. The gold ones in the middle were done by spring.` },
  { id: 'datasets', ms: 17000, pose: nurroInspect, hue: ['#28e0c8', '#2a9dff', '#b45cff'],
    say: () => 'Players work across the lab\'s datasets. The retina is the busiest by far.' },
  { id: 'community', ms: 21000, pose: nurroPopcorn, hue: ['#b45cff', '#ff5c9a', '#ffcf4a'],
    say: () => 'Pyr is a real community: chat, achievements, daily streaks, and hundreds of bug reports that make it better every day.' },
  { id: 'finale', ms: 0, pose: nurroParty, hue: ['#ff5c9a', '#ffcf4a', '#2a9dff'],
    say: () => 'Want the full tour? Come to lab meeting on December 7!' },
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

// Nurro's words, typed out.
const spoken = computed(() => {
  const s = scene.value.say();
  if (reduced) return s;
  const n = Math.floor(clamp01((t.value - 700) / (s.length * 32)) * s.length);
  return s.slice(0, n);
});

// ── Players: a little galaxy, one star per person, colored by month joined ──
const MONTH_COLORS = ['#ffcf4a', '#ff9f5a', '#ff7aa8', '#ff5c9a', '#d06cff', '#b45cff', '#7a8cff', '#3fb4ff', '#28e0c8'];
const galaxy = computed(() => {
  const out: { x: number; y: number; r: number; c: string; d: number }[] = [];
  let i = 0;
  const total = stats.value.signedIn;
  stats.value.months.forEach((m, mi) => {
    for (let k = 0; k < m.joined; k++, i++) {
      const arm = i % 2, f = Math.sqrt(i / Math.max(1, total));
      const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const ang = f * Math.PI * 2.4 + arm * Math.PI + jitter * 0.35;
      const rad = 22 + f * 255 + jitter * 16;
      out.push({ x: 300 + Math.cos(ang) * rad, y: 300 + Math.sin(ang) * rad * 0.7, r: 4 + (i * 37 % 5) * 0.6, c: MONTH_COLORS[mi], d: 500 + i * 70 });
    }
  });
  return out;
});
const joinedMonths = computed(() => stats.value.months.map((m, i) => ({ ...m, c: MONTH_COLORS[i] })).filter(m => m.joined > 0));

// ── Tutorials ──────────────────────────────────────────────────────────────
const tutorialBars = computed(() => {
  const rows = stats.value.tutorials.slice(0, 9);
  const max = Math.max(1, ...rows.map(r => r.players));
  return rows.map((r, i) => ({ ...r, w: r.players / max, d: 600 + i * 260, c: MONTH_COLORS[(i * 2 + 3) % MONTH_COLORS.length] }));
});
const moreTutorials = computed(() => Math.max(0, stats.value.tutorials.length - 9));

// ── Edits: the growth curve ─────────────────────────────────────────────────
const CH = { w: 1000, h: 440, l: 30, r: 120, top: 40, b: 50 };
const editCurve = computed(() => {
  const ms = stats.value.months;
  let run = 0;
  const pts = ms.map((m, i) => {
    run += m.edits;
    const x = CH.l + (i / (ms.length - 1)) * (CH.w - CH.l - CH.r);
    return { x, y: 0, v: run, label: m.label, then: m.m === THEN_MONTH };
  });
  const top = Math.max(1, run);
  pts.forEach(p => { p.y = CH.top + (1 - p.v / top) * (CH.h - CH.top - CH.b); });
  // A smooth line through the months (monotone, so it never dips).
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], cx = (a.x + b.x) / 2;
    d += ` C${cx},${a.y} ${cx},${b.y} ${b.x},${b.y}`;
  }
  const area = `${d} L${pts[pts.length - 1].x},${CH.h - CH.b} L${pts[0].x},${CH.h - CH.b} Z`;
  return { pts, d, area, thenPt: pts.find(p => p.then)!, last: pts[pts.length - 1] };
});

// ── Cells: a mosaic, one square per finished cell ───────────────────────────
const mosaic = ref<HTMLCanvasElement | null>(null);
const CELL = 9;
let layout: { n: number; W: number; H: number; pos: [number, number][] } | null = null;
/** Squares laid out as one wide disc, filled from the middle outward, so the
 *  first cells sit in the core and each month adds a ring. */
function mosaicLayout(n: number) {
  if (layout && layout.n === n) return layout;
  const ry = Math.ceil(Math.sqrt((n * 1.04) / (Math.PI * 2))) + 1, rx = ry * 2;
  const all: [number, number, number][] = [];
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x / rx) ** 2 + (y / ry) ** 2;
    if (d <= 1) all.push([x, y, d + Math.atan2(y, x) * 0.0004]);
  }
  all.sort((p, q) => p[2] - q[2]);
  const pos = all.slice(0, n).map(([x, y]) => [(x + rx) * CELL, (y + ry) * CELL] as [number, number]);
  layout = { n, W: (2 * rx + 1) * CELL, H: (2 * ry + 1) * CELL, pos };
  return layout;
}
function drawMosaic() {
  const cv = mosaic.value;
  if (!cv) return;
  const total = stats.value.cells, L = mosaicLayout(total), dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== L.W * dpr) { cv.width = L.W * dpr; cv.height = L.H * dpr; cv.style.width = `${L.W}px`; cv.style.height = `${L.H}px`; }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, L.W, L.H);
  const thenN = then.value.cells;
  const lit = reduced ? total : Math.floor(thenN + easeOut(clamp01((t.value - 2600) / 7000)) * (total - thenN));
  const goldIn = reduced ? 1 : clamp01((t.value - 900) / 900);
  const novStart = total - stats.value.months[stats.value.months.length - 1].cells;
  for (let i = 0; i < total; i++) {
    const [x, y] = L.pos[i];
    if (i < thenN) { ctx.globalAlpha = goldIn; ctx.fillStyle = '#ffcf4a'; }
    else if (i < lit) { ctx.globalAlpha = 1; ctx.fillStyle = i >= novStart ? '#ff7aa8' : '#3fd8ff'; }
    else { ctx.globalAlpha = 0.12; ctx.fillStyle = '#9fc4ff'; }
    ctx.fillRect(x, y, CELL - 2, CELL - 2);
  }
  // The growing edge glows.
  if (!reduced && lit < total && lit > thenN) {
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10; ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 40 && lit - k > thenN; k++) {
      const [x, y] = L.pos[lit - k];
      ctx.fillRect(x, y, CELL - 2, CELL - 2);
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
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
    { icon: '💬', n: s.chats, label: 'chat messages' },
    { icon: '🏆', n: s.achievements, label: 'achievements earned' },
    { icon: '🏷️', n: s.tags, label: 'cell tags' },
    { icon: '🐞', n: s.reports, label: 'bug reports and ideas from players' },
    { icon: '🔥', n: s.topStreak, label: 'day longest streak' },
  ];
  if (s.deploys) out.push({ icon: '🚀', n: s.deploys, label: 'updates shipped to players' });
  else out.push({ icon: '📅', n: s.playerDays, label: 'player days of proofreading' });
  return out;
});

// ── The sky: stars, nebula, the Starship and sparks, on one canvas ─────────
const sky = ref<HTMLCanvasElement | null>(null);
const root = ref<HTMLElement | null>(null);
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
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
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
  const b = el.getBoundingClientRect();
  burst(b.left + b.width / 2, b.top + b.height / 2, n, SCENES[idx.value].hue.concat('#ffffff'));
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
  ctx.fillStyle = '#050a1f';
  ctx.fillRect(0, 0, W, H);
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
    gr.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},0.28)`);
    gr.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  });
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
      ctx.rotate(ang + Math.PI / 2);
      ctx.shadowColor = 'rgba(90,200,255,0.9)'; ctx.shadowBlur = 24;
      ctx.drawImage(shipImg, -size / 2, -size / 2, size, size);
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

  if (scene.value.id === 'cells') drawMosaic();
  // Moving on by itself.
  const ms = scene.value.ms;
  if (ms && !paused.value && st > ms) next();
}

// Sparks when a big number lands.
const BURSTS: Partial<Record<SceneId, [number, string][]>> = {
  intro: [[2600, '.lm-title']],
  players: [[3000, '.lm-big']],
  tutorials: [[2800, '.lm-big']],
  edits: [[3200, '.lm-curve-end'], [5200, '.lm-times']],
  cells: [[2600, '.lm-big'], [9800, '.lm-mosaic']],
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
let hudTimer = 0;
const hudOn = ref(true);
function poke() {
  hudOn.value = true;
  clearTimeout(hudTimer);
  hudTimer = window.setTimeout(() => { hudOn.value = false; }, 2500);
}
function close() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  emit('hide');
}

onMounted(() => {
  resize();
  stars = Array.from({ length: Math.round(Math.min(700, innerWidth * innerHeight / 3000)) }, () => newStar());
  addEventListener('resize', resize);
  addEventListener('keydown', onKey, true);
  void root.value?.requestFullscreen?.().catch(() => { /* fine in a window too */ });
  go(0);
  poke();
  raf = requestAnimationFrame(frame);
  void loadLabStats().then(s => { stats.value = s; });
});
onUnmounted(() => {
  cancelAnimationFrame(raf);
  removeEventListener('resize', resize);
  removeEventListener('keydown', onKey, true);
  clearTimeout(hudTimer);
});
</script>

<template>
  <div ref="root" class="lm-root" :class="{ 'lm-reduced': reduced }" @mousemove="poke" @click="poke">
    <canvas ref="sky" class="lm-sky" aria-hidden="true" />

    <transition name="lm-scene" mode="out-in">
      <!-- 1. Hello -->
      <section v-if="scene.id === 'intro'" key="intro" class="lm-scene lm-center">
        <div class="lm-kicker" :class="{ on: after(600) }">Seung Lab · open lab meeting</div>
        <h1 class="lm-title" :class="{ on: after(1800) }">PYR</h1>
        <div class="lm-sub" :class="{ on: after(3200) }">Citizen science connectomics</div>
        <div class="lm-since" :class="{ on: after(4800) }">
          <span>since the last lab meeting this spring</span>
        </div>
      </section>

      <!-- 2. Players -->
      <section v-else-if="scene.id === 'players'" key="players" class="lm-scene lm-split">
        <div class="lm-copy">
          <div class="lm-kicker on">The crew</div>
          <div class="lm-big">{{ count(stats.signedIn, 600, 2400) }}</div>
          <div class="lm-label">players signed in to the beta</div>
          <div class="lm-line" :class="{ on: after(3600) }">
            <b>{{ count(stats.editors, 3600, 1600) }}</b> of them have made proofreading edits
          </div>
          <div class="lm-months" :class="{ on: after(5200) }">
            <span v-for="m in joinedMonths" :key="m.m" class="lm-month-chip" :style="{ '--c': m.c }">
              <i />{{ m.label }} <b>+{{ m.joined }}</b>
            </span>
          </div>
        </div>
        <svg class="lm-galaxy" viewBox="0 0 600 600" aria-hidden="true">
          <defs>
            <radialGradient id="lm-core"><stop offset="0" stop-color="#fff" stop-opacity=".9" /><stop offset=".4" stop-color="#9fdcff" stop-opacity=".35" /><stop offset="1" stop-color="#9fdcff" stop-opacity="0" /></radialGradient>
          </defs>
          <g class="lm-galaxy-spin">
            <circle cx="300" cy="300" r="90" fill="url(#lm-core)" />
            <circle v-for="(s, i) in galaxy" :key="i" class="lm-star" :cx="s.x" :cy="s.y" :r="s.r" :fill="s.c"
              :style="{ animationDelay: `${s.d}ms`, color: s.c }" />
          </g>
        </svg>
      </section>

      <!-- 3. Tutorials -->
      <section v-else-if="scene.id === 'tutorials'" key="tutorials" class="lm-scene lm-split lm-split--wide">
        <div class="lm-copy">
          <div class="lm-kicker on">Training</div>
          <div class="lm-big">{{ count(stats.tutorialsDone, 600, 2200) }}</div>
          <div class="lm-label">tutorials finished</div>
          <div class="lm-line" :class="{ on: after(3000) }">by <b>{{ count(stats.tutorialPlayers, 3000, 1400) }}</b> players, across {{ stats.tutorials.length }} tutorials</div>
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
          <div class="lm-big lm-big--wide">{{ count(stats.edits, 900, 2600, then.edits) }}</div>
          <div class="lm-times" :class="{ on: after(5200) }">{{ Math.round(stats.edits / Math.max(1, then.edits)) }}× more since spring</div>
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
            <circle :cx="editCurve.thenPt.x" :cy="editCurve.thenPt.y" r="9" />
            <text :x="editCurve.thenPt.x" :y="editCurve.thenPt.y - 64" class="lm-then-label">Last lab meeting</text>
            <text :x="editCurve.thenPt.x" :y="editCurve.thenPt.y - 34" class="lm-then-n">{{ fmt(then.edits) }}</text>
          </g>
          <g class="lm-curve-end" :class="{ on: after(3200) }">
            <circle :cx="editCurve.last.x" :cy="editCurve.last.y" r="12" />
            <circle :cx="editCurve.last.x" :cy="editCurve.last.y" r="12" class="lm-ping" />
            <text :x="editCurve.last.x + 22" :y="editCurve.last.y + 8" class="lm-now-label">Now</text>
          </g>
        </svg>
      </section>

      <!-- 5. Cells -->
      <section v-else-if="scene.id === 'cells'" key="cells" class="lm-scene lm-stack">
        <div class="lm-head">
          <div class="lm-kicker on">Cells completed</div>
          <div class="lm-big">{{ count(stats.cells, 600, 2000) }}</div>
        </div>
        <canvas ref="mosaic" class="lm-mosaic" aria-hidden="true" />
        <div class="lm-legend" :class="{ on: after(1800) }">
          <span style="--c: #ffcf4a"><i />{{ fmt(then.cells) }} by the end of May</span>
          <span style="--c: #3fd8ff"><i />June to October</span>
          <span style="--c: #ff7aa8"><i />November</span>
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
            <span class="lm-tile-icon">{{ tile.icon }}</span>
            <b>{{ count(tile.n, 1800 + i * 500, 1500) }}</b>
            <span>{{ tile.label }}</span>
          </div>
        </div>
      </section>

      <!-- 8. See you December 7 -->
      <section v-else key="finale" class="lm-scene lm-center">
        <div class="lm-kicker on">Want the full tour?</div>
        <div class="lm-finale-join" :class="{ on: after(400) }">Join lab meeting</div>
        <div class="lm-finale-date" :class="{ on: after(900) }">December 7</div>
        <div class="lm-sub on" :class="{ on: after(2200) }">Amy flies you through all of Pyr</div>
      </section>
    </transition>

    <!-- Nurro, the guide -->
    <transition name="lm-nurro" mode="out-in">
      <div :key="scene.id" class="lm-guide" :class="{ 'lm-guide--finale': scene.id === 'finale' }">
        <img class="lm-guide-pic" :src="scene.pose" alt="" draggable="false" />
        <div class="lm-bubble">
          <div class="lm-bubble-name">Nurro</div>
          <div class="lm-bubble-text">{{ spoken }}<span class="lm-caret" /></div>
        </div>
      </div>
    </transition>

    <!-- Controls, shown when the mouse moves -->
    <div class="lm-hud" :class="{ on: hudOn || paused }">
      <button type="button" class="lm-hud-btn" title="Back (Left)" @click.stop="prev">‹</button>
      <span class="lm-dots">
        <button v-for="(s, i) in SCENES" :key="s.id" type="button" class="lm-dot" :class="{ on: i === idx, done: i < idx }" :title="s.id" @click.stop="go(i)">
          <i v-if="i === idx && s.ms" :style="{ width: `${clamp01(t / s.ms) * 100}%` }" />
        </button>
      </span>
      <button type="button" class="lm-hud-btn" :title="paused ? 'Play (P)' : 'Pause (P)'" @click.stop="togglePause">{{ paused ? '▶' : '❚❚' }}</button>
      <button type="button" class="lm-hud-btn" title="Next (Right)" @click.stop="next">›</button>
      <button type="button" class="lm-hud-btn lm-hud-close" title="Close (Esc)" @click.stop="close">✕</button>
    </div>
  </div>
</template>

<style scoped>
.lm-root {
  position: fixed; inset: 0; z-index: 2147483000; overflow: hidden;
  background: #050a1f; color: #eaf4ff; cursor: default;
  font-family: Inter, system-ui, sans-serif; user-select: none;
}
.lm-sky { position: absolute; inset: 0; width: 100%; height: 100%; }

/* Scenes */
.lm-scene { position: absolute; inset: 0 0 210px; display: flex; padding: 6vh 7vw 0; box-sizing: border-box; }
.lm-center { flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.lm-split { align-items: center; justify-content: space-between; gap: 4vw; }
.lm-stack { flex-direction: column; align-items: center; justify-content: center; gap: 2.4vh; }
.lm-scene-enter-active { transition: opacity .7s ease, transform .9s cubic-bezier(.2, .9, .2, 1), filter .7s; }
.lm-scene-leave-active { transition: opacity .45s ease, transform .5s ease-in, filter .45s; }
.lm-scene-enter-from { opacity: 0; transform: scale(.82) translateZ(0); filter: blur(14px); }
.lm-scene-leave-to { opacity: 0; transform: scale(1.25); filter: blur(10px); }

.lm-kicker {
  font: 600 clamp(12px, 1.05vw, 18px) Orbitron, Inter, sans-serif; letter-spacing: .38em; text-transform: uppercase;
  color: #9fdcff; opacity: 0; transform: translateY(10px); transition: all .8s ease;
}
.lm-kicker.on, .on > .lm-kicker { opacity: 1; transform: none; }
.lm-title {
  margin: 1vh 0 0; font: 900 clamp(90px, 15vw, 260px)/1 Orbitron, Inter, sans-serif; letter-spacing: .12em;
  background: linear-gradient(100deg, #9fdcff 0%, #ffffff 35%, #ffcf4a 55%, #ff7aa8 75%, #9fdcff 100%);
  background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 30px rgba(90, 190, 255, .55));
  opacity: 0; transform: scale(.6); transition: opacity 1s, transform 1.4s cubic-bezier(.2, 1.4, .3, 1);
  animation: lm-shine 6s linear infinite;
}
.lm-title.on { opacity: 1; transform: none; }
@keyframes lm-shine { to { background-position: -250% 0; } }
.lm-sub, .lm-since {
  margin-top: 2vh; font: 600 clamp(20px, 2.3vw, 40px) Inter, sans-serif; color: #dff0ff;
  opacity: 0; transform: translateY(14px); transition: all .9s ease;
}
.lm-since { font: 600 clamp(14px, 1.3vw, 22px) Orbitron, Inter, sans-serif; letter-spacing: .2em; text-transform: uppercase; color: #ffcf4a; }
.lm-since span { padding: .6em 1.4em; border: 1px solid rgba(255, 207, 74, .5); border-radius: 999px; background: rgba(255, 207, 74, .08); box-shadow: 0 0 30px rgba(255, 207, 74, .2); }
.lm-sub.on, .lm-since.on { opacity: 1; transform: none; }

.lm-copy { flex: 0 0 40%; }
.lm-big {
  font: 800 clamp(80px, 11vw, 200px)/1 Orbitron, Inter, sans-serif; font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #ffffff, #9fdcff); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 26px rgba(90, 200, 255, .55)); margin: 1vh 0;
}
.lm-big--wide { font-size: clamp(70px, 9vw, 170px); }
.lm-label { font: 600 clamp(20px, 2vw, 36px) Inter, sans-serif; color: #dff0ff; }
.lm-line { margin-top: 2.4vh; font: 500 clamp(16px, 1.5vw, 26px) Inter, sans-serif; color: #cfe3ff; opacity: 0; transform: translateY(10px); transition: all .8s; }
.lm-line b { color: #ffcf4a; font-family: Orbitron, Inter, sans-serif; }
.lm-line.on { opacity: 1; transform: none; }
.lm-title-s { font: 700 clamp(26px, 3vw, 52px) Inter, sans-serif; opacity: 0; transform: translateY(12px); transition: all .9s; }
.lm-title-s.on { opacity: 1; transform: none; }

/* Players */
.lm-months { margin-top: 3vh; display: flex; flex-wrap: wrap; gap: 10px; opacity: 0; transition: opacity .8s; }
.lm-months.on { opacity: 1; }
.lm-month-chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: rgba(255, 255, 255, .07); border: 1px solid rgba(255, 255, 255, .14); font: 600 clamp(13px, 1.1vw, 18px) Inter, sans-serif; }
.lm-month-chip i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
.lm-month-chip b { color: var(--c); }
.lm-galaxy { flex: 1 1 auto; height: min(70vh, 60vw); max-width: 56vw; overflow: visible; }
.lm-galaxy-spin { transform-origin: 300px 300px; animation: lm-spin 60s linear infinite; }
@keyframes lm-spin { to { transform: rotate(360deg); } }
.lm-star { opacity: 0; transform-box: fill-box; transform-origin: center; filter: drop-shadow(0 0 6px currentColor); animation: lm-pop .7s cubic-bezier(.2, 1.6, .4, 1) forwards, lm-twinkle 3s ease-in-out infinite alternate; }
@keyframes lm-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
@keyframes lm-twinkle { from { filter: drop-shadow(0 0 3px currentColor); } to { filter: drop-shadow(0 0 10px currentColor); } }

/* Tutorials */
.lm-split--wide .lm-copy { flex-basis: 34%; }
.lm-bars { flex: 1 1 auto; display: flex; flex-direction: column; gap: 1.5vh; }
.lm-bar { display: grid; grid-template-columns: minmax(180px, 34%) 1fr 70px; align-items: center; gap: 16px; opacity: 0; transform: translateX(30px); transition: all .6s cubic-bezier(.2, .9, .2, 1); }
.lm-bar.on { opacity: 1; transform: none; }
.lm-bar-name { font: 600 clamp(14px, 1.25vw, 22px) Inter, sans-serif; text-align: right; color: #dff0ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-bar-track { height: clamp(16px, 2.2vh, 26px); border-radius: 999px; background: rgba(255, 255, 255, .07); overflow: hidden; }
.lm-bar-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--c), #ffffff); box-shadow: 0 0 18px var(--c); transition: width 1.4s cubic-bezier(.2, .9, .2, 1); }
.lm-bar-n { font: 700 clamp(16px, 1.5vw, 26px) Orbitron, Inter, sans-serif; font-variant-numeric: tabular-nums; }
.lm-bar-more { margin-left: calc(34% + 16px); font: 500 clamp(13px, 1.1vw, 18px) Inter, sans-serif; color: #9fbfe6; opacity: 0; transition: opacity .6s; }
.lm-bar-more.on { opacity: 1; }

/* Edits */
.lm-head { text-align: center; }
.lm-chart { width: min(70vw, 92vh); height: auto; overflow: visible; }
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
  font: 800 clamp(26px, 3.2vw, 56px) Orbitron, Inter, sans-serif; color: #ffcf4a; text-shadow: 0 0 24px rgba(255, 207, 74, .6);
  opacity: 0; transform: scale(.5); transition: opacity .6s, transform .9s cubic-bezier(.2, 1.6, .3, 1);
}
.lm-times.on { opacity: 1; transform: none; }

/* Cells */
.lm-mosaic { max-width: 88vw; max-height: 46vh; object-fit: contain; filter: drop-shadow(0 0 18px rgba(63, 216, 255, .25)); }
.lm-legend { display: flex; gap: 26px; font: 600 clamp(14px, 1.2vw, 20px) Inter, sans-serif; opacity: 0; transition: opacity .8s; }
.lm-legend.on { opacity: 1; }
.lm-legend span { display: inline-flex; align-items: center; gap: 8px; }
.lm-legend i { width: 14px; height: 14px; border-radius: 3px; background: var(--c); box-shadow: 0 0 10px var(--c); }

/* Datasets */
.lm-ring { position: relative; width: min(64vh, 70vw); height: min(64vh, 70vw); margin-top: 2vh; }
.lm-ring::before { content: ''; position: absolute; inset: 12%; border-radius: 50%; border: 2px dashed rgba(159, 220, 255, .25); animation: lm-spin 40s linear infinite; }
.lm-ring-core { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; }
.lm-ring-n { font: 900 clamp(70px, 9vh, 130px)/1 Orbitron, Inter, sans-serif; color: #fff; text-shadow: 0 0 30px rgba(90, 200, 255, .8); }
.lm-ring-l { font: 600 clamp(14px, 1.3vw, 22px) Orbitron, Inter, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #9fdcff; }
.lm-orbit { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform: rotate(var(--a)); animation: lm-orbit 50s linear infinite; }
@keyframes lm-orbit { from { transform: rotate(var(--a)); } to { transform: rotate(calc(var(--a) + 360deg)); } }
.lm-planet {
  position: absolute; left: calc(min(32vh, 35vw) * .76); top: 0; width: 180px; margin: -70px 0 0 -90px; text-align: center;
  transform: rotate(calc(-1 * var(--a))); animation: lm-counter 50s linear infinite, lm-planet-in .9s cubic-bezier(.2, 1.5, .4, 1) var(--d) both;
}
@keyframes lm-counter { from { rotate: 0deg; } to { rotate: -360deg; } }
@keyframes lm-planet-in { from { opacity: 0; scale: .2; } to { opacity: 1; scale: 1; } }
.lm-planet img { width: clamp(64px, 8vh, 110px); height: auto; filter: drop-shadow(0 0 16px rgba(90, 200, 255, .7)); }
.lm-planet b { display: block; font: 700 clamp(14px, 1.2vw, 20px) Inter, sans-serif; margin-top: 4px; }
.lm-planet span { display: block; font: 500 clamp(12px, 1vw, 16px) Inter, sans-serif; color: #ffcf4a; }
.lm-ring-foot { margin-top: 1vh; }

/* Community */
.lm-tiles { display: grid; grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 2.2vh 2vw; width: min(80vw, 1300px); margin-top: 2vh; }
.lm-tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 2.4vh 1vw; border-radius: 22px;
  background: linear-gradient(160deg, rgba(255, 255, 255, .1), rgba(255, 255, 255, .03)); border: 1px solid rgba(255, 255, 255, .16);
  box-shadow: 0 10px 40px rgba(0, 0, 0, .25), inset 0 0 30px rgba(120, 180, 255, .08);
  opacity: 0; transform: translateY(30px) scale(.9); transition: all .7s cubic-bezier(.2, 1.4, .4, 1);
}
.lm-tile.on { opacity: 1; transform: none; }
.lm-tile-icon { font-size: clamp(30px, 3.4vh, 48px); }
.lm-tile b { font: 800 clamp(34px, 3.6vw, 64px) Orbitron, Inter, sans-serif; font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 0 18px rgba(90, 200, 255, .6); }
.lm-tile span:last-child { font: 600 clamp(13px, 1.15vw, 20px) Inter, sans-serif; color: #cfe3ff; text-align: center; }

/* Finale */
.lm-finale-join { font: 700 clamp(30px, 3.6vw, 64px) Orbitron, Inter, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #dff0ff; margin-top: 2vh; opacity: 0; transform: translateY(20px); transition: all .9s; }
.lm-finale-join.on { opacity: 1; transform: none; }
.lm-finale-date {
  font: 900 clamp(80px, 11vw, 210px)/1.05 Orbitron, Inter, sans-serif; letter-spacing: .04em;
  background: linear-gradient(100deg, #ffcf4a, #ff7aa8 40%, #b45cff 60%, #3fd8ff 85%, #ffcf4a); background-size: 250% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 34px rgba(255, 140, 200, .5));
  opacity: 0; transform: scale(.4); transition: opacity .8s, transform 1.3s cubic-bezier(.2, 1.5, .3, 1); animation: lm-shine 5s linear infinite;
}
.lm-finale-date.on { opacity: 1; transform: none; }

/* Nurro */
.lm-guide { position: absolute; left: 2.5vw; bottom: 2.5vh; display: flex; align-items: flex-end; gap: 14px; max-width: min(760px, 62vw); pointer-events: none; }
.lm-guide-pic { width: clamp(170px, 22vh, 260px); margin-bottom: -2vh; height: auto; filter: drop-shadow(0 6px 20px rgba(0, 0, 0, .4)) drop-shadow(0 0 22px rgba(120, 200, 255, .35)); animation: lm-bob 3.2s ease-in-out infinite; }
@keyframes lm-bob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
.lm-bubble {
  position: relative; margin-bottom: 3vh; padding: 14px 20px 16px; border-radius: 18px 18px 18px 4px;
  background: rgba(10, 22, 58, .78); border: 1px solid rgba(140, 210, 255, .45); backdrop-filter: blur(8px);
  box-shadow: 0 0 30px rgba(60, 170, 255, .25); min-height: 2.6em;
}
.lm-bubble-name { font: 700 12px Orbitron, Inter, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #ffcf4a; margin-bottom: 6px; }
.lm-bubble-text { font: 500 clamp(15px, 1.35vw, 22px)/1.45 Inter, sans-serif; color: #fff; }
.lm-caret { display: inline-block; width: .5em; height: 1em; margin-left: 2px; vertical-align: -2px; background: #9fdcff; animation: lm-blink 1s steps(1) infinite; }
@keyframes lm-blink { 50% { opacity: 0; } }
.lm-nurro-enter-active { transition: opacity .5s .3s, transform .7s cubic-bezier(.2, 1.4, .4, 1) .3s; }
.lm-nurro-leave-active { transition: opacity .3s, transform .3s; }
.lm-nurro-enter-from { opacity: 0; transform: translate(-60px, 40px) scale(.8); }
.lm-nurro-leave-to { opacity: 0; transform: translate(-30px, 20px); }

/* Controls */
.lm-hud {
  position: absolute; right: 2vw; bottom: 2.4vh; display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: 999px; background: rgba(10, 22, 58, .6); border: 1px solid rgba(140, 210, 255, .25);
  opacity: 0; transition: opacity .6s;
}
.lm-hud.on { opacity: 1; }
.lm-hud-btn { all: unset; cursor: pointer; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; color: #dff0ff; font: 700 16px Inter, sans-serif; }
.lm-hud-btn:hover { background: rgba(255, 255, 255, .12); }
.lm-hud-close { color: #ff9fbf; }
.lm-dots { display: flex; gap: 6px; }
.lm-dot { all: unset; cursor: pointer; position: relative; width: 22px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .2); overflow: hidden; }
.lm-dot.done { background: rgba(159, 220, 255, .7); }
.lm-dot.on { width: 40px; background: rgba(255, 255, 255, .25); }
.lm-dot i { position: absolute; inset: 0 auto 0 0; background: #ffcf4a; }

.lm-reduced *, .lm-reduced *::before { animation: none !important; transition: none !important; }
.lm-reduced .lm-star { opacity: 1; }
</style>
