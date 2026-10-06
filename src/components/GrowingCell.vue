<script setup lang="ts">
/**
 * GrowingCell: a wait indicator for long waits with no known progress. It
 * grows one cell from its body, names it, lets it fade, and grows the next
 * kind (Ames, 2026-10-06: "it could cycle through different types of cells if
 * it takes a long time"). A short wait shows one cell; a long one becomes a
 * small tour of the seven kinds from the MEC and Retina dataset tours.
 *
 * The seven sets of branching rules, the cell body and the colours are those
 * of "Cells I Met Today" (artforagents.com, work 009), unchanged. No two
 * growths are alike. The order is shuffled on each mount so repeat visitors
 * do not always start on the same cell.
 *
 * For a wait whose steps are known, use GrowingNeuron, which shows them.
 *
 *   <GrowingCell />                    110px square, with the cell's name
 *   <GrowingCell :size="84" :named="false" />
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{ size?: number; named?: boolean }>(), { size: 110, named: true });

const canvas = ref<HTMLCanvasElement | null>(null);
const name = ref('');
const TAU = Math.PI * 2;
const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Seg = [number, number, number, number, number, number]; // x1 y1 x2 y2 width birth
type Rand = () => number;
interface Opts { step: number; wiggle: number; spread: number; jitter: number; decay: number; twig?: number; twigLen?: number; fork?: (r: Rand, depth: number) => number; pull?: (x: number, y: number, a: number) => number; }
interface Grown { segs: Seg[]; soma: number[]; }
interface Kind { name: string; color: string; grow: (r: Rand) => Grown; }

function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One branch as a wandering line in a unit space (-1..1), each segment
 *  stamped with the "time" it appears, so growth runs out from the body. */
function branch(out: Seg[], r: Rand, x: number, y: number, ang: number, len: number, w: number, depth: number, t: number, o: Opts) {
  const steps = Math.max(3, Math.round(len / o.step));
  for (let i = 0; i < steps; i++) {
    ang += (r() - 0.5) * o.wiggle + (o.pull ? o.pull(x, y, ang) : 0);
    const nx = x + Math.cos(ang) * o.step, ny = y + Math.sin(ang) * o.step;
    out.push([x, y, nx, ny, w, t]);
    x = nx; y = ny; t += o.step;
    if (o.twig && r() < o.twig) branch(out, r, x, y, ang + (r() < 0.5 ? 1 : -1) * (0.7 + r() * 0.7), (o.twigLen ?? 0.1) * (0.5 + r()), w * 0.55, 0, t, { ...o, twig: 0 });
  }
  if (depth <= 0) return;
  const n = o.fork ? o.fork(r, depth) : 2;
  for (let k = 0; k < n; k++) {
    const spread = o.spread * (n === 1 ? 0 : (k / (n - 1) - 0.5) * 2);
    branch(out, r, x, y, ang + spread + (r() - 0.5) * o.jitter, len * o.decay * (0.8 + r() * 0.4), w * 0.72, depth - 1, t, o);
  }
}

const KINDS: Kind[] = [
  { name: 'Stellate', color: '#67f5cb',
    grow(r) { const s: Seg[] = []; const n = 6; for (let i = 0; i < n; i++) branch(s, r, 0, 0, i / n * TAU + (r() - 0.5) * 0.6, 0.30, 3.2, 3, 0, { step: 0.03, wiggle: 0.35, spread: 0.55, jitter: 0.5, decay: 0.78, twig: 0.05, twigLen: 0.08 }); return { segs: s, soma: [0, 0, 0.055] }; } },
  { name: 'Pyramidal', color: '#3e96f0',
    grow(r) { const s: Seg[] = [];
      branch(s, r, 0, 0.18, -Math.PI / 2, 0.62, 3.4, 2, 0, { step: 0.03, wiggle: 0.12, spread: 0.7, jitter: 0.3, decay: 0.38, twig: 0.16, twigLen: 0.16, fork: () => 3 });
      for (let i = 0; i < 5; i++) branch(s, r, 0, 0.2, Math.PI / 2 + (i / 4 - 0.5) * 2.3 + (r() - 0.5) * 0.2, 0.2, 2.2, 2, 0, { step: 0.03, wiggle: 0.3, spread: 0.5, jitter: 0.4, decay: 0.75 });
      return { segs: s, soma: [0, 0.2, 0.06] }; } },
  { name: 'Astrocyte', color: '#b06fe0',
    grow(r) { const s: Seg[] = []; const n = 8; for (let i = 0; i < n; i++) branch(s, r, 0, 0, i / n * TAU + (r() - 0.5) * 0.5, 0.17, 2.2, 4, 0, { step: 0.022, wiggle: 0.9, spread: 0.8, jitter: 0.9, decay: 0.82, twig: 0.3, twigLen: 0.06, fork: (q) => 2 + (q() < 0.4 ? 1 : 0) }); return { segs: s, soma: [0, 0, 0.07] }; } },
  { name: 'Microglia', color: '#e8823c',
    grow(r) { const s: Seg[] = []; const n = 5; for (let i = 0; i < n; i++) branch(s, r, 0, 0, i / n * TAU + (r() - 0.5) * 0.7, 0.26, 1.8, 3, 0, { step: 0.028, wiggle: 0.55, spread: 0.6, jitter: 0.6, decay: 0.7, twig: 0.12, twigLen: 0.07 }); return { segs: s, soma: [0, 0, 0.05] }; } },
  { name: 'Starburst amacrine', color: '#ff5fb0',
    grow(r) { const s: Seg[] = []; const n = 5; for (let i = 0; i < n; i++) branch(s, r, 0, 0, i / n * TAU + 0.3, 0.2, 1.6, 4, 0, { step: 0.025, wiggle: 0.14, spread: 0.36, jitter: 0.12, decay: 0.86 }); return { segs: s, soma: [0, 0, 0.04] }; } },
  { name: 'Bipolar', color: '#f5b84a',
    grow(r) { const s: Seg[] = [];
      for (let i = 0; i < 3; i++) branch(s, r, 0, -0.62, -Math.PI / 2 + (i - 1) * 0.7, 0.12, 1.6, 1, 0, { step: 0.03, wiggle: 0.4, spread: 0.5, jitter: 0.3, decay: 0.7 });
      branch(s, r, 0, -0.5, Math.PI / 2, 0.95, 2.6, 2, 0, { step: 0.03, wiggle: 0.16, spread: 1.0, jitter: 0.5, decay: 0.16, fork: () => 4, pull: (_x, _y, a) => (Math.PI / 2 - a) * 0.12 });
      return { segs: s, soma: [0, -0.56, 0.075, 1.3] }; } },
  { name: 'Müller glia', color: '#67f5cb',
    grow(r) { const s: Seg[] = [];
      branch(s, r, 0, -0.8, Math.PI / 2, 1.6, 6, 0, 0, { step: 0.03, wiggle: 0.1, spread: 0, jitter: 0, decay: 1, twig: 0.9, twigLen: 0.16, pull: (x, _y, a) => (Math.PI / 2 - a) * 0.3 - x * 0.2 });
      for (let i = 0; i < 4; i++) branch(s, r, 0, 0.78, Math.PI / 2 + (i / 3 - 0.5) * 1.6, 0.1, 2.4, 0, 1.55, { step: 0.03, wiggle: 0.3, spread: 0, jitter: 0, decay: 1 });
      return { segs: s, soma: [0, -0.25, 0.055, 1.9] }; } },
];

interface Shape extends Grown { unit: number; tmax: number; body: Array<[number, number]>; color: string; }

function build(kind: Kind, seed: number): Shape {
  const g = kind.grow(rng(seed));
  let m = 0.001, tmax = 0.001;
  for (const s of g.segs) { m = Math.max(m, Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]), Math.abs(s[3])); tmax = Math.max(tmax, s[5]); }
  // The body: an uneven blob that swells toward each process leaving it.
  const [sx, sy, sr, tall] = g.soma, r = rng(seed * 7 + 3), roots: number[] = [];
  for (const s of g.segs) if (s[5] === 0 && Math.hypot(s[0] - sx, s[1] - sy) <= sr * 1.3) roots.push(Math.atan2(s[3] - sy, s[2] - sx));
  const ph = [r() * TAU, r() * TAU, r() * TAU], body: Array<[number, number]> = [];
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * TAU;
    let rad = 1 + 0.07 * Math.sin(2 * a + ph[0]) + 0.05 * Math.sin(3 * a + ph[1]) + 0.03 * Math.sin(5 * a + ph[2]);
    for (const q of roots) { let d = Math.abs(a - q) % TAU; if (d > Math.PI) d = TAU - d; rad += 0.42 * Math.exp(-(d * d) / 0.09); }
    body.push([sx + Math.cos(a) * sr * rad, sy + Math.sin(a) * sr * rad * (tall || 1)]);
  }
  return { ...g, unit: 0.44 / m, tmax, body, color: kind.color };
}

// One cycle: grow, hold, fade, then the next kind.
const GROW = 2400, HOLD = 1300, FADE = 500;
let order: number[] = [], at = 0, shape: Shape | null = null, t0 = 0, raf = 0, alive = false;

function next(now: number) {
  const kind = KINDS[order[at % order.length]]; at += 1;
  shape = build(kind, Math.floor(Math.random() * 1e9));
  name.value = kind.name;
  t0 = now;
}

function draw(progress: number, alpha: number) {
  const el = canvas.value, sh = shape;
  if (!el || !sh) return;
  const size = el.clientWidth;
  if (!size) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (el.width !== Math.round(size * dpr)) { el.width = Math.round(size * dpr); el.height = Math.round(size * dpr); }
  const ctx = el.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const k = sh.unit * size, cx = size / 2, cy = size / 2, tNow = progress * sh.tmax;
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round'; ctx.strokeStyle = sh.color; ctx.fillStyle = sh.color;
  ctx.shadowColor = sh.color; ctx.shadowBlur = 5;
  let tip: [number, number] | null = null, tipT = -1;
  for (const s of sh.segs) {
    if (s[5] > tNow) continue;
    // A process is thickest where it leaves the body, then tapers.
    ctx.lineWidth = Math.max(0.5, s[4] * size / 300) * (1 + 1.1 * Math.exp(-s[5] / 0.05));
    ctx.beginPath(); ctx.moveTo(cx + s[0] * k, cy + s[1] * k); ctx.lineTo(cx + s[2] * k, cy + s[3] * k); ctx.stroke();
    if (s[5] > tipT) { tipT = s[5]; tip = [cx + s[2] * k, cy + s[3] * k]; }
  }
  // Body, lit from the upper left, with a darker nucleus a little off centre.
  const B = sh.body, bx = cx + sh.soma[0] * k, by = cy + sh.soma[1] * k, br = Math.max(2.5, sh.soma[2] * k);
  ctx.shadowBlur = 9;
  ctx.beginPath();
  for (let i = 0; i <= B.length; i++) {
    const a = B[i % B.length], b = B[(i + 1) % B.length], mx = cx + (a[0] + b[0]) / 2 * k, my = cy + (a[1] + b[1]) / 2 * k;
    if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(cx + a[0] * k, cy + a[1] * k, mx, my);
  }
  ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); ctx.shadowBlur = 0;
  const lit = ctx.createRadialGradient(bx - br * 0.45, by - br * 0.5, br * 0.1, bx, by, br * 2.2);
  lit.addColorStop(0, 'rgba(255,255,255,0.42)'); lit.addColorStop(0.45, 'rgba(255,255,255,0.04)'); lit.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = lit; ctx.fillRect(bx - br * 4, by - br * 4, br * 8, br * 8);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(bx + br * 0.08, by + br * 0.1 * (sh.soma[3] || 1), br * 0.5, br * 0.5 * Math.min(1.4, sh.soma[3] || 1), 0, 0, TAU); ctx.fill();
  ctx.restore();
  // The growing tip.
  if (tip && progress < 0.995) {
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 1.5, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}

function frame(now: number) {
  if (!alive) return;
  let e = now - t0;
  if (e > GROW + HOLD + FADE) { next(now); e = 0; }
  const g = Math.min(1, e / GROW), p = g * g * (3 - 2 * g);
  const alpha = e <= GROW + HOLD ? 1 : Math.max(0, 1 - (e - GROW - HOLD) / FADE);
  draw(p, alpha);
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  // Shuffled, so a second wait does not begin on the same cell as the first.
  order = KINDS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const now = performance.now();
  next(now);
  if (still) { draw(1, 1); return; }   // one finished cell, nothing moving
  alive = true; raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => { alive = false; cancelAnimationFrame(raf); });
</script>

<template>
  <span class="nge-growing-cell" :style="{ '--nge-gc-size': props.size + 'px' }">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <span v-if="props.named" class="nge-growing-cell-name" aria-hidden="true">{{ name }}</span>
  </span>
</template>

<style scoped>
.nge-growing-cell { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; }
.nge-growing-cell canvas { display: block; width: var(--nge-gc-size); height: var(--nge-gc-size); }
/* The name is a caption for the picture, not status: the wait's own words
   sit beside it and are what a screen reader hears. */
.nge-growing-cell-name {
  min-height: 1.2em;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 9.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(196, 228, 255, 0.6);
  white-space: nowrap;
}
</style>
