<script setup lang="ts">
/**
 * EffortCurve: a player's running total since their first day, drawn once.
 *
 * The profile's Edits and Cells completed blocks each show today, the past
 * 7 days and all time; this is the same record as a line, from the first
 * day on the dataset to today. The line draws itself along its own length
 * in 1.4 s (ease out), the area under it is revealed in step, the head
 * carries the total read off the curve at the pen, and one ring marks the
 * arrival. Two shaded bands at the right end are the past 7 days and
 * today, so the three numbers above are also three places on the line.
 * Hover or touch reads any day. A range (All, 90d, 30d, 7d; Ames
 * 2026-10-12) cuts the record to its last days and the line is the running
 * total from that day, so at 7d it ends on the Past 7d number above it.
 *
 * Plays once, on mount and again if the record changes (a dataset switch).
 * A resize redraws it finished, without a replay. Under
 * prefers-reduced-motion the finished curve lands at once. A backstop
 * timer lands it if the first frame never comes (a hidden tab).
 *
 * The svg is built by hand rather than in the template: it is one path
 * and a few marks, and getPointAtLength drives the head. Its parts carry
 * no scoped attribute, so their styles below sit under :deep().
 *
 * Proposal and test page: amyleesterling.github.io/experimental-UI/components/profile.html
 * (Ames 2026-10-11).
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

export interface EffortDay { date: string; n: number }

const props = defineProps<{
  /** One entry per day, oldest first, the last one today, zeros included.
   *  date is 'yyyy-mm-dd' on the player's own calendar. */
  days: EffortDay[];
  /** 'r g b', space separated, for rgb(var(--c) / a). */
  color: string;
  /** The word after a number: 'edits', 'cells'. */
  unit: string;
  /** Drawn height in px; 76 by default, less on a short screen. */
  height?: number;
  /** Days to show, counted back from today; 0 or unset is the whole record. */
  span?: number;
  /** The ranges to offer, in days; 0 is all. Shown when given. */
  spans?: number[];
}>();
const emit = defineEmits<{ (e: 'update:span', days: number): void }>();
function spanLabel(s: number): string { return s ? s + 'd' : 'All'; }

const fig = ref<HTMLElement | null>(null);
const done = ref(false);
const startLabel = ref('');
const summary = ref('');

let raf = 0;
let backstop = 0;
let ro: ResizeObserver | null = null;
let teardown: (() => void) | null = null;
let drawnWidth = 0;
let settle = 0;
/** The animated draw waits until the width has been still for a moment: the
 *  profile's frame is still widening for up to a second after it opens, and
 *  a draw begun early was redrawn finished a quarter second in, which read
 *  as a broken animation on a zoomed in screen (Ames 2026-10-16). A change
 *  that lands mid draw starts the draw again at the new width. */
function scheduleDraw(delay = 250) { clearTimeout(settle); settle = window.setTimeout(() => render(true), delay); }

const SVG = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function dayLabel(s: string): string { return parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function monthLabel(s: string): string { return parseDay(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
function reducedMotion(): boolean { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }

function clear() {
  if (teardown) { teardown(); teardown = null; }
  cancelAnimationFrame(raf); clearTimeout(backstop);
  const old = fig.value?.querySelector('svg'); if (old) old.remove();
  done.value = false;
}

function render(animate: boolean) {
  const host = fig.value;
  clear();
  if (!host) return;
  const all = props.days;
  const span = props.span ?? 0;
  // the past N days and today, as the 7D band counts them
  const cut = span > 0 && all.length > span + 1;
  const days = cut ? all.slice(-(span + 1)) : all;
  const N = days.length;
  if (!N) { startLabel.value = ''; summary.value = ''; return; }
  startLabel.value = cut ? dayLabel(days[0].date) : monthLabel(days[0].date);

  const cum: number[] = []; let s = 0;
  for (let i = 0; i < N; i++) { s += days[i].n; cum.push(s); }
  const total = s, max = Math.max(1, total);
  summary.value = cut ? `${total.toLocaleString()} ${props.unit} in the past ${span} days` : `${total.toLocaleString()} ${props.unit} since ${startLabel.value}`;

  const W = Math.max(120, Math.round(host.getBoundingClientRect().width)) || 400, H = props.height ?? 76;
  drawnWidth = W;
  const P = { l: 1, r: 1, t: 18, b: 4 }, iw = W - P.l - P.r, ih = H - P.t - P.b, base = P.t + ih;
  const X = (i: number) => P.l + (N > 1 ? i / (N - 1) : 1) * iw;
  const Y = (v: number) => P.t + (1 - v / max) * ih;
  const rgb = props.color.trim().split(/\s+/).join(',');
  const id = 'ec' + Math.random().toString(36).slice(2, 8);

  const svg = el('svg', { class: 'nge-effort-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': summary.value });
  const defs = el('defs', {});
  const grad = el('linearGradient', { id: id + 'g', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(el('stop', { offset: '0', 'stop-color': `rgb(${rgb})`, 'stop-opacity': '.26' }));
  grad.appendChild(el('stop', { offset: '1', 'stop-color': `rgb(${rgb})`, 'stop-opacity': '0' }));
  defs.appendChild(grad);
  const clip = el('clipPath', { id: id + 'c' });
  const clipRect = el('rect', { x: 0, y: 0, width: 0, height: H });
  clip.appendChild(clipRect); defs.appendChild(clip);
  svg.appendChild(defs);

  // the windows, as bands: the past 7 days, and today on top of it
  const w0 = Math.max(0, N - 8), t0 = Math.max(0, N - 2);
  if (w0 > 0) {
    svg.appendChild(el('rect', { class: 'nge-effort-band', x: X(w0), y: P.t - 8, width: Math.max(1, X(N - 1) - X(w0)), height: ih + 8 + P.b }));
  }
  svg.appendChild(el('rect', { class: 'nge-effort-band nge-effort-band--today', x: X(t0), y: P.t - 8, width: Math.max(1, X(N - 1) - X(t0)), height: ih + 8 + P.b }));
  if (w0 > 0) {
    svg.appendChild(el('line', { class: 'nge-effort-band-edge', x1: X(w0), y1: P.t - 8, x2: X(w0), y2: base }));
    const bandLabel = el('text', { class: 'nge-effort-band-label', x: X(w0) + 3, y: base - 3, 'text-anchor': 'start' });
    bandLabel.textContent = '7D';
    svg.appendChild(bandLabel);
  }
  svg.appendChild(el('line', { class: 'nge-effort-base', x1: P.l, y1: base, x2: W - P.r, y2: base }));

  // the area and the line
  let d = '';
  for (let k = 0; k < N; k++) d += (k ? ' L' : 'M') + X(k).toFixed(2) + ' ' + Y(cum[k]).toFixed(2);
  svg.appendChild(el('path', { class: 'nge-effort-area', d: `${d} L${X(N - 1).toFixed(2)} ${base} L${X(0).toFixed(2)} ${base} Z`, fill: `url(#${id}g)`, 'clip-path': `url(#${id}c)` }));
  const line = el('path', { class: 'nge-effort-line', d, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 });
  svg.appendChild(line);
  const halo = el('circle', { class: 'nge-effort-halo', r: 4, cx: X(0), cy: Y(cum[0]) });
  const head = el('circle', { class: 'nge-effort-head', r: 3, cx: X(0), cy: Y(cum[0]) });
  svg.appendChild(halo); svg.appendChild(head);
  const totalText = el('text', { class: 'nge-effort-total', x: W - P.r, y: P.t - 5, 'text-anchor': 'end' });
  totalText.textContent = '0';
  svg.appendChild(totalText);

  // the cursor, hidden until a pointer asks
  const cur = el('g', { class: 'nge-effort-cursor', visibility: 'hidden' });
  const curLine = el('line', { x1: 0, y1: P.t - 2, x2: 0, y2: base });
  const curDot = el('circle', { r: 2.5, cx: 0, cy: 0 });
  const curText = el('text', { x: 0, y: P.t - 5 });
  cur.appendChild(curLine); cur.appendChild(curDot); cur.appendChild(curText);
  svg.appendChild(cur);

  host.insertBefore(svg, host.firstChild);

  const len = line.getTotalLength();
  function land(p: number) {
    line.setAttribute('stroke-dashoffset', String(1 - p));
    const pt = line.getPointAtLength(p * len);
    clipRect.setAttribute('width', String(Math.max(0, pt.x + 0.5)));
    head.setAttribute('cx', String(pt.x)); head.setAttribute('cy', String(pt.y));
    halo.setAttribute('cx', String(pt.x)); halo.setAttribute('cy', String(pt.y));
    const idx = Math.max(0, Math.min(N - 1, Math.round(((pt.x - P.l) / iw) * (N - 1))));
    totalText.textContent = cum[idx].toLocaleString();
  }
  let finished = false;
  function arrive() {
    if (finished) return; finished = true;
    cancelAnimationFrame(raf); clearTimeout(backstop);
    land(1);
    done.value = true;
    // a width change missed while drawing: redraw finished at the width it has now
    const now = Math.round(host!.getBoundingClientRect().width);
    if (now && Math.abs(now - drawnWidth) > 1) setTimeout(() => { if (fig.value === host) render(false); }, 0);
  }
  if (!animate || reducedMotion()) {
    arrive();
  } else {
    const start = performance.now(), DUR = 1400;
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / DUR);
      land(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(frame); else arrive();
    };
    raf = requestAnimationFrame(frame);
    backstop = window.setTimeout(arrive, DUR + 600);
  }

  // read any day
  function show(ev: PointerEvent) {
    const r = svg.getBoundingClientRect();
    const fx = (ev.clientX - r.left) * (W / r.width);
    const idx = Math.max(0, Math.min(N - 1, Math.round(((fx - P.l) / iw) * (N - 1))));
    const x = X(idx), y = Y(cum[idx]);
    curLine.setAttribute('x1', String(x)); curLine.setAttribute('x2', String(x));
    curDot.setAttribute('cx', String(x)); curDot.setAttribute('cy', String(y));
    const n = days[idx].n;
    curText.textContent = `${dayLabel(days[idx].date)} · ${cum[idx].toLocaleString()} ${props.unit}${n ? ` (+${n})` : ''}`;
    const left = x < W * 0.55;
    curText.setAttribute('x', String(left ? x + 6 : x - 6));
    curText.setAttribute('text-anchor', left ? 'start' : 'end');
    cur.setAttribute('visibility', 'visible');
    totalText.setAttribute('visibility', left ? 'visible' : 'hidden');
  }
  function hide() { cur.setAttribute('visibility', 'hidden'); totalText.setAttribute('visibility', 'visible'); }
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
  teardown = () => {
    svg.removeEventListener('pointermove', show); svg.removeEventListener('pointerdown', show);
    svg.removeEventListener('pointerleave', hide); svg.removeEventListener('pointercancel', hide);
  };
}

onMounted(() => {
  if (reducedMotion()) render(true); else scheduleDraw(450);  // the frame's opening takes about that long
  if (typeof ResizeObserver !== 'undefined' && fig.value) {
    ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (!w || (drawnWidth && Math.abs(w - drawnWidth) <= 1)) return;  // the width it was drawn at
      // before or during the draw: draw (again) once the width is still; after it: redraw finished, no replay
      if (!fig.value?.querySelector('svg') || !done.value) scheduleDraw(); else render(false);
    });
    ro.observe(fig.value);
  }
});
watch(() => props.days, () => render(true));
watch(() => props.span, () => render(true));
watch(() => props.height, () => render(false));
onBeforeUnmount(() => { clear(); clearTimeout(settle); ro?.disconnect(); ro = null; });
</script>

<template>
  <figure ref="fig" class="nge-effort" :class="{ 'is-done': done }" :style="{ '--c': color, '--h': (height ?? 76) + 'px' }" :aria-label="summary">
    <figcaption class="nge-effort-cap">
      <span class="nge-effort-cap-start">{{ startLabel }}</span>
      <!-- the range: one choice shared by every curve on the page (the parent holds it) -->
      <span v-if="spans && spans.length" class="nge-effort-spans" role="group" aria-label="Range">
        <button v-for="s in spans" :key="s" type="button" class="nge-effort-span" :class="{ 'is-on': (span ?? 0) === s }" :aria-pressed="(span ?? 0) === s" :title="s ? 'The past ' + s + ' days' : 'Since your first day'" @click="emit('update:span', s)">{{ spanLabel(s) }}</button>
      </span>
      <span v-if="startLabel" class="nge-effort-cap-end">Today</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.nge-effort { margin: 10px 0 0; position: relative; min-width: 0; }
.nge-effort :deep(.nge-effort-svg) {
  display: block; width: 100%; height: var(--h, 76px); overflow: visible;
  touch-action: pan-y;
}
.nge-effort :deep(.nge-effort-band) { fill: rgb(var(--c) / .05); }
.nge-effort :deep(.nge-effort-band--today) { fill: rgb(var(--c) / .16); }
.nge-effort :deep(.nge-effort-band-edge) { stroke: rgb(var(--c) / .4); stroke-width: 1; stroke-dasharray: 2 3; }
.nge-effort :deep(.nge-effort-band-label) { font-size: 9px; fill: rgb(var(--c) / .6); letter-spacing: .08em; }
.nge-effort :deep(.nge-effort-base) { stroke: rgba(255, 255, 255, .07); stroke-width: 1; }
.nge-effort :deep(.nge-effort-line) {
  fill: none; stroke: rgb(var(--c) / .95); stroke-width: 1.6;
  stroke-linejoin: round; stroke-linecap: round;
}
.nge-effort :deep(.nge-effort-head) { fill: rgb(var(--c)); }
.nge-effort :deep(.nge-effort-halo) {
  fill: none; stroke: rgb(var(--c) / .85); stroke-width: 1.2; opacity: 0;
  transform-box: fill-box; transform-origin: center;
}
/* the arrival: one ring, once, when the pen reaches today */
.nge-effort.is-done :deep(.nge-effort-halo) { animation: ngeEffortArrive .7s ease-out both; }
@keyframes ngeEffortArrive {
  0%   { opacity: .9; transform: scale(1); }
  100% { opacity: 0;  transform: scale(4.5); }
}
.nge-effort :deep(.nge-effort-total) {
  font: 700 13px ui-monospace, 'Cascadia Code', monospace;
  font-variant-numeric: tabular-nums;
  fill: rgb(var(--c));
}
.nge-effort :deep(.nge-effort-cursor) { pointer-events: none; }
.nge-effort :deep(.nge-effort-cursor line) { stroke: rgba(255, 255, 255, .35); stroke-width: 1; }
.nge-effort :deep(.nge-effort-cursor text) { font-size: 10.5px; fill: #cfd8e8; }
.nge-effort :deep(.nge-effort-cursor circle) { fill: #fff; }
.nge-effort-cap {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  margin: 3px 0 0; font-size: 0.62em; letter-spacing: .04em;
  color: rgba(200, 215, 240, .45);
}
/* the range: four small words in the curve's colour, the chosen one lit */
.nge-effort-spans { display: inline-flex; gap: 1px; margin: 0 auto; }
.nge-effort-span {
  appearance: none; background: none; border: 0; margin: 0; padding: 1px 6px;
  font: inherit; letter-spacing: .08em; text-transform: uppercase; line-height: 1.4;
  color: rgb(var(--c) / .5); border-radius: 3px; cursor: pointer;
  transition: color .15s, background .15s;
}
.nge-effort-span:hover { color: rgb(var(--c) / .9); }
.nge-effort-span.is-on { color: rgb(var(--c)); background: rgb(var(--c) / .12); }
.nge-effort-span:focus-visible { outline: 1px solid rgb(var(--c) / .8); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .nge-effort.is-done :deep(.nge-effort-halo) { animation: none; }
}
</style>
