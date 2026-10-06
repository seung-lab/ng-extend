<script setup lang="ts">
/**
 * GrowingNeuron: a wait indicator that grows a neuron from its cell body.
 *
 * The cells come from "Cells I Met Today" (artforagents.com, work 009), where
 * each one grows by a few branching rules and is different every time. Ames,
 * 2026-10-06: "would you like to use these growing neurons somewhere, maybe
 * as some of the loading icons in the game?"
 *
 * Two ways to use it:
 *
 *   <GrowingNeuron :stage="2" :stages="3" />
 *     Growth follows real progress. Dendrites, then the axon, then the
 *     terminals, a third of the way for each finished stage, creeping a
 *     little inside the stage that is still running so it never looks stuck.
 *
 *   <GrowingNeuron loop />
 *     No known progress: grow a cell, hold it, let it fade, grow another.
 *
 * `arrived` lights the finished cell end to end and releases at the
 * terminals, once. Give a waiting instance and its arrived twin the same
 * `seed` and they are the same cell.
 *
 * Drawn on a canvas, sized by its container (aspect 360 : 100).
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  /** Stages finished so far. */
  stage?: number;
  /** Stages in all. */
  stages?: number;
  /** The work is done: light the cell and release at the terminals. */
  arrived?: boolean;
  /** Grow, hold, fade, grow another. For waits with no known progress. */
  loop?: boolean;
  /** Same seed, same cell. Left out, each mount grows a new one. */
  seed?: number;
}>(), { stage: 0, stages: 3, arrived: false, loop: false });

const canvas = ref<HTMLCanvasElement | null>(null);
const W = 360, H = 100, TAU = Math.PI * 2;
const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Seg = [number, number, number, number, number, number]; // x1 y1 x2 y2 width birth(0..1)
interface Cell { segs: Seg[]; axon: Array<[number, number, number]>; boutons: Array<[number, number]>; body: Array<[number, number]>; }

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Births are 0..0.30 for dendrites, 0.30..0.74 for the axon, 0.74..1 for the terminals. */
function grow(seed: number): Cell {
  const r = rng(seed), segs: Seg[] = [];
  const sx = 34, sy = 50, sr = 7.5;
  // Dendrites: a fan on the side away from the axon.
  const roots: number[] = [0];
  const twig = (x: number, y: number, ang: number, len: number, w: number, depth: number, t0: number, t1: number) => {
    const steps = Math.max(2, Math.round(len / 3.2)), dt = (t1 - t0) / (steps * (depth + 1));
    let t = t0;
    for (let i = 0; i < steps; i++) {
      ang += (r() - 0.5) * 0.5;
      const nx = x + Math.cos(ang) * 3.2, ny = y + Math.sin(ang) * 3.2;
      if (ny < 5 || ny > H - 5 || nx < 4) break;
      segs.push([x, y, nx, ny, w, t]); x = nx; y = ny; t += dt;
    }
    if (depth > 0) for (const s of [-1, 1]) twig(x, y, ang + s * (0.35 + r() * 0.35), len * 0.7, w * 0.7, depth - 1, t, t1);
  };
  const n = 5 + (r() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.52 + 0.96 * (i + 0.5) / n) + (r() - 0.5) * 0.25;
    roots.push(a);
    twig(sx, sy, a, 13 + r() * 7, 1.9, 2, 0.02 + r() * 0.05, 0.30);
  }
  // Axon: wanders to the right, never the same way twice.
  const a1 = 9 + r() * 9, a2 = 3 + r() * 5, p1 = r() * TAU, p2 = r() * TAU, f1 = 1.1 + r() * 0.9, f2 = 2.6 + r() * 1.4;
  const x0 = sx + sr - 1, x1 = 292, N = 64, axon: Cell['axon'] = [];
  const yAt = (u: number) => sy + Math.sin(u * Math.PI) * (a1 * Math.sin(u * f1 * TAU + p1) + a2 * Math.sin(u * f2 * TAU + p2));
  let px = x0, py = sy;
  for (let i = 1; i <= N; i++) {
    const u = i / N, x = x0 + (x1 - x0) * u, y = yAt(u), t = 0.30 + 0.44 * u;
    segs.push([px, py, x, y, 2.6 - 1.0 * Math.min(1, u * 4), t]);
    axon.push([x, y, t]); px = x; py = y;
  }
  // Terminals, each ending in a bouton.
  const boutons: Cell['boutons'] = [], m = 3 + (r() < 0.5 ? 1 : 0);
  for (let i = 0; i < m; i++) {
    let ang = (i / (m - 1) - 0.5) * 1.5 + (r() - 0.5) * 0.2, x = px, y = py;
    const steps = 6 + Math.floor(r() * 3);
    for (let k = 0; k < steps; k++) {
      ang += (r() - 0.5) * 0.3;
      const nx = x + Math.cos(ang) * 4, ny = Math.max(8, Math.min(H - 8, y + Math.sin(ang) * 4));
      segs.push([x, y, nx, ny, 1.5, 0.74 + 0.22 * (k + 1) / steps]); x = nx; y = ny;
    }
    boutons.push([x, y]);
  }
  // The body: an uneven blob that swells toward each process leaving it.
  const ph = [r() * TAU, r() * TAU], body: Cell['body'] = [];
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU;
    let rad = 1 + 0.07 * Math.sin(2 * a + ph[0]) + 0.05 * Math.sin(3 * a + ph[1]);
    for (const q of roots) { let d = Math.abs(a - q) % TAU; if (d > Math.PI) d = TAU - d; rad += 0.34 * Math.exp(-(d * d) / 0.1); }
    body.push([sx + Math.cos(a) * sr * rad, sy + Math.sin(a) * sr * rad]);
  }
  return { segs, axon, boutons, body };
}

let cell: Cell, seedNow = 0;
let p = 0;                 // how much of the cell is grown, 0..1
let stageAt = 0;           // when the running stage began
let arrivedAt = -1;        // when the cell was lit
let loopAt = 0;            // start of the current loop cycle
let last = 0, raf = 0, alive = false;

const BLUE = [150, 185, 255], GREEN = [126, 240, 200];
const mix = (k: number) => BLUE.map((b, i) => Math.round(b + (GREEN[i] - b) * k));
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function draw(now: number) {
  const el = canvas.value;
  if (!el) return;
  const cw = el.clientWidth;
  if (!cw) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), k = cw / W;
  if (el.width !== Math.round(cw * dpr)) { el.width = Math.round(cw * dpr); el.height = Math.round(cw * H / W * dpr); }
  const ctx = el.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Lighting: a front runs from the body to the terminals, then they release.
  const sinceLit = arrivedAt < 0 ? -1 : (still ? 9 : (now - arrivedAt) / 1000);
  const litTo = sinceLit < 0 ? -1 : Math.min(1, sinceLit / 0.6);
  const fade = props.loop && !props.arrived ? loopFade(now) : 1;

  ctx.globalAlpha = fade;
  ctx.lineCap = 'round';
  let tip: [number, number] | null = null, tipT = -1;
  for (const s of cell.segs) {
    if (s[5] > p) continue;
    const lit = litTo >= 0 && s[5] <= litTo;
    const c = lit ? GREEN : BLUE;
    ctx.strokeStyle = rgba(c, lit ? 0.95 : 0.8);
    ctx.shadowColor = rgba(c, 0.9); ctx.shadowBlur = lit ? 6 : 3;
    ctx.lineWidth = s[4] * (1 + 0.9 * Math.exp(-s[5] / 0.04));
    ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
    if (s[5] > tipT) { tipT = s[5]; tip = [s[2], s[3]]; }
  }
  // Cell body.
  const bodyC = litTo >= 0 ? mix(Math.min(1, litTo * 3)) : BLUE;
  ctx.shadowColor = rgba(bodyC, 0.9); ctx.shadowBlur = 8;
  ctx.fillStyle = rgba(bodyC, 0.95);
  ctx.beginPath();
  const B = cell.body;
  for (let i = 0; i <= B.length; i++) {
    const a = B[i % B.length], b = B[(i + 1) % B.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(a[0], a[1], mx, my);
  }
  ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); ctx.shadowBlur = 0;
  const g = ctx.createRadialGradient(31, 46, 1, 34, 50, 16);
  g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.5, 'rgba(255,255,255,0.03)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = g; ctx.fillRect(14, 30, 40, 40);
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.arc(34.6, 50.8, 3.4, 0, TAU); ctx.fill();
  ctx.restore();

  // Boutons: hollow while the cell waits, filled once it is lit.
  if (p > 0.97) {
    cell.boutons.forEach(([x, y], i) => {
      const since = sinceLit < 0 ? -1 : sinceLit - 0.6 - i * 0.09;
      if (since < 0) {
        ctx.shadowBlur = 0; ctx.lineWidth = 1.3;
        ctx.strokeStyle = rgba(GREEN, 0.85); ctx.fillStyle = rgba(GREEN, 0.18);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill(); ctx.stroke();
        return;
      }
      // A pop that overshoots and settles, and two rings let go.
      const pop = since < 0.45 ? 1 + 0.5 * Math.sin(Math.min(1, since / 0.45) * Math.PI) : 1;
      for (const [dur, col] of [[1.1, GREEN], [1.5, [126, 224, 255]]] as Array<[number, number[]]>) {
        const u = since / dur;
        if (u < 1) { ctx.shadowBlur = 0; ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(col, 0.9 * (1 - u)); ctx.beginPath(); ctx.arc(x, y, 3 + u * 16, 0, TAU); ctx.stroke(); }
      }
      ctx.shadowColor = rgba(GREEN, 1); ctx.shadowBlur = 8; ctx.fillStyle = '#7ef0c8';
      ctx.beginPath(); ctx.arc(x, y, 3.4 * pop, 0, TAU); ctx.fill();
    });
  }

  if (!still && arrivedAt < 0) {
    // The growing tip.
    if (tip && p < 0.995) {
      ctx.shadowColor = 'rgba(126,224,255,1)'; ctx.shadowBlur = 10; ctx.fillStyle = '#e6f8ff';
      ctx.beginPath(); ctx.arc(tip[0], tip[1], 1.9, 0, TAU); ctx.fill();
    }
    // A signal runs down as much of the axon as exists, so a wait inside one
    // stage still shows the cell is alive.
    const grown = cell.axon.filter(a => a[2] <= p);
    if (grown.length > 6) {
      const u = (now / 1100) % 1, at = grown[Math.min(grown.length - 1, Math.floor(u * grown.length))];
      ctx.shadowColor = 'rgba(126,224,255,0.95)'; ctx.shadowBlur = 7; ctx.fillStyle = 'rgba(223,246,255,0.95)';
      ctx.beginPath(); ctx.arc(at[0], at[1], 2.4, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}

// Loop mode: 2.6 s to grow, hold, fade out, then a new cell.
const LOOP_GROW = 2600, LOOP_HOLD = 900, LOOP_FADE = 500;
function loopFade(now: number) {
  const e = now - loopAt - LOOP_GROW - LOOP_HOLD;
  return e <= 0 ? 1 : Math.max(0, 1 - e / LOOP_FADE);
}

function target(now: number) {
  if (props.arrived) return 1;
  if (props.loop) return Math.min(1, (now - loopAt) / LOOP_GROW);
  const n = Math.max(1, props.stages), d = Math.max(0, Math.min(n, props.stage));
  // Inside the running stage, creep toward 80% of it and never arrive.
  const creep = d >= n ? 0 : 0.8 * (1 - Math.exp(-(now - stageAt) / 2500));
  return Math.min(1, (d + creep) / n);
}

function frame(now: number) {
  if (!alive) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (props.loop && !props.arrived && now - loopAt > LOOP_GROW + LOOP_HOLD + LOOP_FADE) {
    seedNow += 1; cell = grow(seedNow); loopAt = now; p = 0;
  }
  const t = target(now);
  p = props.loop && !props.arrived ? t : p + (t - p) * Math.min(1, dt * (props.arrived ? 9 : 3.5));
  draw(now);
  // Once lit and released there is nothing left to move.
  if (arrivedAt >= 0 && now - arrivedAt > 2600 && p > 0.999) { alive = false; return; }
  raf = requestAnimationFrame(frame);
}

function start() {
  const now = performance.now();
  stageAt = now; loopAt = now; last = now;
  if (still) { p = target(now + 1e6); if (props.arrived) arrivedAt = now; draw(now); return; }
  if (!alive) { alive = true; raf = requestAnimationFrame(frame); }
}

watch(() => props.stage, () => { stageAt = performance.now(); if (still) { p = target(stageAt + 1e6); draw(stageAt); } });
watch(() => props.arrived, (v) => { if (v && arrivedAt < 0) { arrivedAt = performance.now(); start(); } });

let ro: ResizeObserver | null = null;
onMounted(() => {
  seedNow = props.seed ?? Math.floor(Math.random() * 1e9);
  cell = grow(seedNow);
  if (props.arrived) { p = 1; arrivedAt = performance.now(); }
  start();
  if (canvas.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (!alive) draw(performance.now()); });
    ro.observe(canvas.value);
  }
});
onBeforeUnmount(() => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); });
</script>

<template>
  <canvas ref="canvas" class="nge-growing-neuron" aria-hidden="true"></canvas>
</template>

<style scoped>
.nge-growing-neuron {
  display: block;
  width: 100%;
  max-width: 360px;
  aspect-ratio: 360 / 100;
}
</style>
