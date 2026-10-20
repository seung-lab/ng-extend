<script setup lang="ts">
/**
 * Neuron Tetris, the first game in the Pyr Arcade (Ames 2026-10-20).
 *
 * The falling pieces are neuron fragments: a soma, axons, dendrites and
 * spines, drawn as beads joined by neurite in Pyr's segment colours. A full
 * row "merges" (it glows and goes) and Nurro cheers. Arrow keys move and
 * turn, Space drops, P pauses. The best score is kept in this browser.
 *
 * Self-contained: one canvas, no neuroglancer, no network.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import nurroCelebrate from '../../static/nurro/nurro-celebrate.png';
import nurroDance from '../../static/nurro/nurro-dance.png';
import nurroConfetti from '../../static/nurro/nurro-confetti.png';
import nurroPopcorn from '../../static/nurro/nurro-popcorn.png';

const COLS = 10;
const ROWS = 20;
const CELL = 26;
const W = COLS * CELL;
const H = ROWS * CELL;
const BEST_KEY = 'pyr.arcade.neuronTetris.best';

type Kind = 'axon' | 'soma' | 'branch' | 'spine' | 'dendrite';
interface PieceDef { id: string; name: string; kind: Kind; color: string; shape: number[][] }
const PIECES: PieceDef[] = [
  { id: 'I', name: 'Axon', kind: 'axon', color: '#00aaff', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { id: 'O', name: 'Soma', kind: 'soma', color: '#ffd700', shape: [[1, 1], [1, 1]] },
  { id: 'T', name: 'Branch point', kind: 'branch', color: '#ff4fd8', shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  { id: 'S', name: 'Spine', kind: 'spine', color: '#a8f03a', shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  { id: 'Z', name: 'Spine', kind: 'spine', color: '#ff5a4f', shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
  { id: 'L', name: 'Dendrite', kind: 'dendrite', color: '#ff9f1c', shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
  { id: 'J', name: 'Dendrite', kind: 'dendrite', color: '#8b7bff', shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
];

interface Cell { color: string; kind: Kind; pid: number }
interface Active { def: PieceDef; shape: number[][]; x: number; y: number; pid: number }

const canvasEl = ref<HTMLCanvasElement | null>(null);
const nextEl = ref<HTMLCanvasElement | null>(null);
const state = ref<'ready' | 'playing' | 'paused' | 'over'>('ready');
const score = ref(0);
const lines = ref(0);
const level = ref(1);
const best = ref(readBest());
const newBest = ref(false);
const nextName = ref('');
const cheer = ref<{ text: string; img: string } | null>(null);

const levelSpeedMs = computed(() => Math.max(90, 800 - (level.value - 1) * 70));

let board: (Cell | null)[][] = emptyBoard();
let active: Active | null = null;
let queue: PieceDef[] = [];
let pidSeq = 1;
let raf = 0;
let lastTick = 0;
let dropAcc = 0;
let clearing: { rows: number[]; until: number } | null = null;
let cheerTimer: ReturnType<typeof setTimeout> | null = null;

function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function writeBest(n: number) {
  try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* private window */ }
}
function emptyBoard(): (Cell | null)[][] {
  return Array.from({ length: ROWS }, () => Array<Cell | null>(COLS).fill(null));
}

/* ── pieces ── */
function refill() {
  const bag = PIECES.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  queue.push(...bag);
}
function spawn(): boolean {
  if (queue.length < 2) refill();
  const def = queue.shift()!;
  const shape = def.shape.map(r => r.slice());
  active = { def, shape, x: Math.floor((COLS - shape[0].length) / 2), y: def.id === 'I' ? -1 : 0, pid: pidSeq++ };
  nextName.value = queue[0].name;
  drawNext();
  return fits(active.shape, active.x, active.y);
}
function fits(shape: number[][], x: number, y: number): boolean {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const bx = x + c, by = y + r;
      if (bx < 0 || bx >= COLS || by >= ROWS) return false;
      if (by >= 0 && board[by][bx]) return false;
    }
  }
  return true;
}
function rotated(shape: number[][], dir: 1 | -1): number[][] {
  const n = shape.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (dir === 1) out[c][n - 1 - r] = shape[r][c];
    else out[n - 1 - c][r] = shape[r][c];
  }
  return out;
}

/* ── moves ── */
function move(dx: number): boolean {
  if (!active || !fits(active.shape, active.x + dx, active.y)) return false;
  active.x += dx;
  return true;
}
function turn(dir: 1 | -1) {
  if (!active || active.def.id === 'O') return;
  const s = rotated(active.shape, dir);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (fits(s, active.x + kick, active.y)) { active.shape = s; active.x += kick; return; }
  }
  if (fits(s, active.x, active.y - 1)) { active.shape = s; active.y -= 1; }
}
function stepDown(): boolean {
  if (!active) return false;
  if (fits(active.shape, active.x, active.y + 1)) { active.y += 1; return true; }
  lock();
  return false;
}
function hardDrop() {
  if (!active) return;
  let n = 0;
  while (fits(active.shape, active.x, active.y + 1)) { active.y += 1; n++; }
  score.value += n * 2;
  lock();
}
function ghostY(): number {
  if (!active) return 0;
  let y = active.y;
  while (fits(active.shape, active.x, y + 1)) y++;
  return y;
}

function lock() {
  if (!active) return;
  const a = active;
  let above = false;
  a.shape.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return;
    const by = a.y + r;
    if (by < 0) { above = true; return; }
    board[by][a.x + c] = { color: a.def.color, kind: a.def.kind, pid: a.pid };
  }));
  active = null;
  if (above) { gameOver(); return; }
  const full: number[] = [];
  for (let r = 0; r < ROWS; r++) if (board[r].every(Boolean)) full.push(r);
  if (full.length) {
    clearing = { rows: full, until: performance.now() + 320 };
    const pts = [0, 100, 300, 500, 800][full.length] * level.value;
    score.value += pts;
    lines.value += full.length;
    level.value = 1 + Math.floor(lines.value / 10);
    cheerFor(full.length);
  } else if (!spawn()) {
    gameOver();
  }
}

function finishClear() {
  if (!clearing) return;
  const rows = new Set(clearing.rows);
  board = [
    ...Array.from({ length: rows.size }, () => Array<Cell | null>(COLS).fill(null)),
    ...board.filter((_, r) => !rows.has(r)),
  ];
  clearing = null;
  if (!spawn()) gameOver();
}

function cheerFor(n: number) {
  const say: Record<number, { text: string; img: string }> = {
    1: { text: 'Merged!', img: nurroCelebrate },
    2: { text: 'Double merge!', img: nurroDance },
    3: { text: 'Triple merge!', img: nurroDance },
    4: { text: 'Pyr-fect! Four rows merged!', img: nurroConfetti },
  };
  cheer.value = say[Math.min(4, n)];
  if (cheerTimer) clearTimeout(cheerTimer);
  cheerTimer = setTimeout(() => { cheer.value = null; }, 1700);
}

function gameOver() {
  state.value = 'over';
  active = null;
  if (score.value > best.value) {
    best.value = score.value;
    newBest.value = true;
    writeBest(score.value);
  }
  cheer.value = null;
  if (cheerTimer) clearTimeout(cheerTimer);
  draw();
}

function start() {
  board = emptyBoard();
  queue = [];
  score.value = 0;
  lines.value = 0;
  level.value = 1;
  newBest.value = false;
  cheer.value = null;
  clearing = null;
  dropAcc = 0;
  state.value = 'playing';
  spawn();
  canvasEl.value?.focus();
}
function togglePause() {
  if (state.value === 'playing') state.value = 'paused';
  else if (state.value === 'paused') { state.value = 'playing'; lastTick = 0; }
}

/* ── loop ── */
function loop(now: number) {
  raf = requestAnimationFrame(loop);
  const dt = lastTick ? Math.min(100, now - lastTick) : 0;
  lastTick = now;
  if (state.value === 'playing') {
    if (clearing) {
      if (now >= clearing.until) finishClear();
    } else {
      dropAcc += dt;
      if (dropAcc >= levelSpeedMs.value) { dropAcc = 0; stepDown(); }
    }
  }
  draw(now);
}

/* ── drawing ── */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** One piece's cells as beads joined by neurite. */
function drawCells(ctx: CanvasRenderingContext2D, cells: Array<{ x: number; y: number; cell: Cell }>, size: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const at = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
  // Neurite first, so the beads sit on top.
  for (const c of cells) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const o = at.get(`${c.x + dx},${c.y + dy}`);
      if (!o || o.cell.pid !== c.cell.pid) continue;
      const thick = c.cell.kind === 'soma' ? 0.9 : c.cell.kind === 'axon' ? 0.28 : 0.4;
      ctx.strokeStyle = shade(c.cell.color, -0.15);
      ctx.lineWidth = size * thick;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo((c.x + 0.5) * size, (c.y + 0.5) * size);
      ctx.lineTo((o.x + 0.5) * size, (o.y + 0.5) * size);
      ctx.stroke();
    }
  }
  for (const c of cells) {
    const cx = (c.x + 0.5) * size, cy = (c.y + 0.5) * size;
    const r = size * (c.cell.kind === 'soma' ? 0.52 : c.cell.kind === 'axon' ? 0.3 : 0.36);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, shade(c.cell.color, 0.55));
    g.addColorStop(0.55, c.cell.color);
    g.addColorStop(1, shade(c.cell.color, -0.35));
    ctx.fillStyle = g;
    ctx.shadowColor = c.cell.color;
    ctx.shadowBlur = size * 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function activeCells(y: number) {
  const out: Array<{ x: number; y: number; cell: Cell }> = [];
  if (!active) return out;
  const a = active;
  a.shape.forEach((row, r) => row.forEach((v, c) => {
    if (v && y + r >= 0) out.push({ x: a.x + c, y: y + r, cell: { color: a.def.color, kind: a.def.kind, pid: a.pid } });
  }));
  return out;
}

function draw(now = performance.now()) {
  const cv = canvasEl.value;
  if (!cv) return;
  const ctx = cv.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The tissue: dark, with a faint grid.
  ctx.fillStyle = '#060b16';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120,170,255,0.06)';
  ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CELL + 0.5, 0); ctx.lineTo(c * CELL + 0.5, H); ctx.stroke(); }
  for (let r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * CELL + 0.5); ctx.lineTo(W, r * CELL + 0.5); ctx.stroke(); }

  const placed: Array<{ x: number; y: number; cell: Cell }> = [];
  board.forEach((row, y) => row.forEach((cell, x) => { if (cell) placed.push({ x, y, cell }); }));
  drawCells(ctx, placed, CELL);

  if (clearing) {
    // The merge: the full rows glow and fade to white.
    const t = 1 - Math.max(0, clearing.until - now) / 320;
    for (const r of clearing.rows) {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, `rgba(91,227,255,${0.2 + 0.6 * t})`);
      g.addColorStop(Math.min(1, t), `rgba(255,255,255,${0.35 + 0.6 * t})`);
      g.addColorStop(1, `rgba(91,227,255,${0.15 * t})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, r * CELL, W, CELL);
    }
  }

  if (active && state.value !== 'over') {
    drawCells(ctx, activeCells(ghostY()), CELL, 0.18);
    drawCells(ctx, activeCells(active.y), CELL);
  }
}

function drawNext() {
  const cv = nextEl.value;
  if (!cv || !queue[0]) return;
  const ctx = cv.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const size = 20;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, 4 * size, 3 * size);
  const def = queue[0];
  const cells: Array<{ x: number; y: number; cell: Cell }> = [];
  const rows = def.shape.filter(r => r.some(Boolean));
  const width = Math.max(...rows.map(r => r.lastIndexOf(1) + 1));
  const first = Math.min(...rows.map(r => r.indexOf(1)).filter(i => i >= 0));
  rows.forEach((row, r) => row.forEach((v, c) => { if (v) cells.push({ x: c - first, y: r, cell: { color: def.color, kind: def.kind, pid: -1 } }); }));
  ctx.save();
  ctx.translate((4 * size - (width - first) * size) / 2, (3 * size - rows.length * size) / 2);
  drawCells(ctx, cells, size);
  ctx.restore();
}

function setupCanvas(cv: HTMLCanvasElement | null, w: number, h: number) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
}

/* ── keys ── */
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'z', 'Z', 'x', 'X', 'p', 'P', 'Enter']);
function onKeyDown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (!GAME_KEYS.has(e.key)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (state.value === 'ready' || state.value === 'over') {
    if (e.key === 'Enter' || e.key === ' ') start();
    return;
  }
  if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
  if (state.value !== 'playing' || clearing) return;
  switch (e.key) {
    case 'ArrowLeft': move(-1); break;
    case 'ArrowRight': move(1); break;
    case 'ArrowDown': if (stepDown()) score.value += 1; dropAcc = 0; break;
    case 'ArrowUp': case 'x': case 'X': turn(1); break;
    case 'z': case 'Z': turn(-1); break;
    case ' ': hardDrop(); break;
  }
}
function onBlur() { if (state.value === 'playing') state.value = 'paused'; }

defineExpose({ pause: () => { if (state.value === 'playing') state.value = 'paused'; } });

/** Local test builds only: fill the bottom rows but one gap, to see a merge. */
function installTestHook() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  (window as any).__pyrTetrisFill = (rows = 4, gap = 0) => {
    for (let r = ROWS - rows; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        board[r][c] = c === gap ? null : { color: PIECES[(r + c) % PIECES.length].color, kind: 'dendrite', pid: 9000 + r };
      }
    }
  };
}

onMounted(() => {
  installTestHook();
  setupCanvas(canvasEl.value, W, H);
  setupCanvas(nextEl.value, 80, 60);
  refill();
  nextName.value = queue[0].name;
  drawNext();
  raf = requestAnimationFrame(loop);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onBlur);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  if (cheerTimer) clearTimeout(cheerTimer);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('blur', onBlur);
});
</script>

<template>
  <div class="nge-tetris">
    <div class="nge-tetris-well">
      <canvas ref="canvasEl" class="nge-tetris-canvas" tabindex="0"></canvas>
      <div v-if="state !== 'playing'" class="nge-tetris-overlay">
        <template v-if="state === 'ready'">
          <div class="nge-tetris-big">Neuron Tetris</div>
          <p>Stack the neuron pieces. Fill a row to merge it.</p>
          <button class="nge-tetris-start" @click="start">Start</button>
          <div class="nge-tetris-small">or press Enter</div>
        </template>
        <template v-else-if="state === 'paused'">
          <div class="nge-tetris-big">Paused</div>
          <button class="nge-tetris-start" @click="togglePause">Keep playing</button>
          <div class="nge-tetris-small">or press P</div>
        </template>
        <template v-else>
          <img class="nge-tetris-over-nurro" :src="nurroPopcorn" alt="Nurro with popcorn" />
          <div class="nge-tetris-big">Game over</div>
          <p>{{ score.toLocaleString() }} points, {{ lines }} {{ lines === 1 ? 'row' : 'rows' }} merged</p>
          <p v-if="newBest" class="nge-tetris-best-note">Your best yet!</p>
          <button class="nge-tetris-start" @click="start">Play again</button>
        </template>
      </div>
      <transition name="nge-tetris-cheer">
        <div v-if="cheer" class="nge-tetris-cheer" :key="cheer.text">
          <img :src="cheer.img" alt="Nurro" />
          <span>{{ cheer.text }}</span>
        </div>
      </transition>
    </div>

    <div class="nge-tetris-side">
      <div class="nge-tetris-stat"><span>Score</span><b>{{ score.toLocaleString() }}</b></div>
      <div class="nge-tetris-stat"><span>Best</span><b>{{ best.toLocaleString() }}</b></div>
      <div class="nge-tetris-stat"><span>Rows merged</span><b>{{ lines }}</b></div>
      <div class="nge-tetris-stat"><span>Level</span><b>{{ level }}</b></div>
      <div class="nge-tetris-next">
        <span>Next: {{ nextName }}</span>
        <canvas ref="nextEl"></canvas>
      </div>
      <ul class="nge-tetris-keys">
        <li><kbd>←</kbd><kbd>→</kbd> move</li>
        <li><kbd>↑</kbd> or <kbd>X</kbd> turn, <kbd>Z</kbd> back</li>
        <li><kbd>↓</kbd> faster</li>
        <li><kbd>Space</kbd> drop</li>
        <li><kbd>P</kbd> pause</li>
      </ul>
    </div>
  </div>
</template>

<style>
.nge-tetris { display: flex; gap: 16px; align-items: flex-start; }
.nge-tetris-well { position: relative; border-radius: 10px; overflow: hidden; box-shadow: 0 0 0 1px rgba(91, 227, 255, 0.25), 0 0 24px rgba(0, 170, 255, 0.12); }
.nge-tetris-canvas { display: block; outline: none; }
.nge-tetris-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 20px; text-align: center; background: rgba(4, 8, 18, 0.72); color: #dfe8f6;
}
.nge-tetris-overlay p { margin: 0; font-size: 13px; color: #b8c4d6; line-height: 1.4; }
.nge-tetris-big { font-size: 22px; font-weight: 700; color: #9fdcff; letter-spacing: 0.02em; }
.nge-tetris-over-nurro { width: 110px; height: auto; margin-bottom: 4px; }
.nge-tetris-best-note { color: #ffd700 !important; font-weight: 600; }
.nge-tetris-start {
  margin-top: 6px; padding: 8px 20px; border-radius: 10px; cursor: pointer; font: inherit; font-weight: 600;
  color: #fff; background: rgba(53, 181, 255, 0.3); border: 1px solid rgba(53, 181, 255, 0.6);
}
.nge-tetris-start:hover { background: rgba(53, 181, 255, 0.45); }
.nge-tetris-small { font-size: 11px; color: #7f8ca3; }
.nge-tetris-side { display: flex; flex-direction: column; gap: 8px; min-width: 150px; color: #dfe8f6; }
.nge-tetris-stat { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.04); }
.nge-tetris-stat span { font-size: 12px; color: #93a1b8; }
.nge-tetris-stat b { font-size: 16px; font-variant-numeric: tabular-nums; }
.nge-tetris-next { display: flex; flex-direction: column; gap: 4px; padding: 6px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.04); font-size: 12px; color: #93a1b8; }
.nge-tetris-next canvas { align-self: center; }
.nge-tetris-keys { list-style: none; margin: 4px 0 0; padding: 0; font-size: 11.5px; color: #93a1b8; line-height: 1.9; }
.nge-tetris-keys kbd {
  display: inline-block; min-width: 18px; padding: 0 4px; margin-right: 2px; text-align: center;
  border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.06);
  font: 11px/16px Roboto, system-ui, sans-serif; color: #dfe8f6;
}
.nge-tetris-cheer {
  position: absolute; left: 50%; top: 34%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none;
}
.nge-tetris-cheer img { width: 120px; height: auto; filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.6)); }
.nge-tetris-cheer span {
  padding: 4px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.92); color: #10203a;
  font-weight: 700; font-size: 14px; white-space: nowrap; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.nge-tetris-cheer-enter-active { transition: transform 0.25s cubic-bezier(.2, 1.6, .4, 1), opacity 0.2s; }
.nge-tetris-cheer-leave-active { transition: opacity 0.35s; }
.nge-tetris-cheer-enter-from { opacity: 0; transform: translate(-50%, -30%) scale(0.6); }
.nge-tetris-cheer-leave-to { opacity: 0; }
</style>
