<script setup lang="ts">
/**
 * "Now entering <dataset>": shown when the dataset switcher is used.
 * Large thumbnail and a loading animation for a couple of seconds (and until
 * the viewer is back, when the switch reloaded the page), then the box zips
 * up with light like the Scout tag mode box, and pops into particles.
 * State lives in util/dataset_transition.ts so it survives the reload.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { datasetTransition, resumeDatasetTransition, endDatasetTransition } from '../util/dataset_transition';
import { runPanelDraw } from '../util/holo_trace';
import { DATASETS } from '../datasets';
import { useProofreadingBackendStore } from '../store';
import { loadContribution, showsAllStats, type DatasetContribution } from '../util/dataset_contribution';

// Your own numbers for the dataset you are entering, from the same helper the
// profile's Datasets tab uses. After a reload the sign in restores a moment
// later, so wait briefly for the user id.
const backend = useProofreadingBackendStore();
const mine = ref<DatasetContribution | null>(null);
// False on datasets worked mostly in other tools: cells lead, zeros are left out.
const mineAll = ref(true);
async function loadMine(id: string) {
  mine.value = null;
  const ds = DATASETS.find(d => d.id === id);
  if (!ds) return;
  mineAll.value = showsAllStats(ds);
  for (let i = 0; i < 20 && !backend.userId; i++) await new Promise(r => setTimeout(r, 150));
  if (!backend.userId || datasetTransition.current?.id !== id) return;
  try { mine.value = await loadContribution(ds, backend.userId); } catch { /* stats are a bonus */ }
}

const boxEl = ref<HTMLElement | null>(null);
const phase = ref<'loading' | 'zip' | null>(null);
/** ms since the switch was clicked. Animations start that far in, so after
 *  the page reloads mid switch they carry on instead of replaying from zero
 *  (the replay was the flash). */
const elapsed = ref(0);
const stepIdx = ref(0);
const DEFAULT_STEPS = ['Loading the volume', 'Fetching cells', 'Aligning the view', 'Almost there'];
const STEPS = computed(() => datasetTransition.current?.steps?.length ? datasetTransition.current.steps : DEFAULT_STEPS);
let timers: number[] = [];
const clearTimers = () => { timers.forEach(t => clearTimeout(t)); timers = []; };

/** Enough time to feel deliberate, and after a reload, until the viewer is up. */
const MIN_MS = 2200;
const MAX_MS = 9000;
const viewerReady = () => {
  const v: any = (window as any).viewer;
  return !!v?.layerManager?.managedLayers?.length;
};

function play() {
  const t = datasetTransition.current;
  if (!t) return;
  clearTimers();
  elapsed.value = Math.max(0, Date.now() - t.t0);
  phase.value = 'loading';
  // A held card paces its steps slower, since it waits for real work.
  const stepMs = t.hold ? 1400 : 650;
  const nSteps = STEPS.value.length;
  stepIdx.value = Math.min(nSteps - 1, Math.floor(elapsed.value / stepMs));
  for (let i = stepIdx.value + 1; i < nSteps; i++) {
    timers.push(window.setTimeout(() => { stepIdx.value = i; }, i * stepMs - elapsed.value));
  }
  const maxMs = t.hold ? 25000 : MAX_MS;
  const tick = () => {
    const age = Date.now() - t.t0;
    const ready = t.hold ? datasetTransition.released : (!datasetTransition.resumed || viewerReady());
    // Signed out: the viewer cannot finish until they log in, so waiting for
    // it would park this card over the sign in box. Get out of the way.
    const loginShowing = !!document.querySelector('.nge-login-blocker');
    if ((age >= MIN_MS && ready) || age >= maxMs || (loginShowing && age >= 600)) { zip(); return; }
    timers.push(window.setTimeout(tick, 150));
  };
  tick();
}

/**
 * The zip: runPanelDraw's two light heads start at the bottom middle, run up
 * both sides, then along the top edge from the corners to the centre while
 * the box clips away from the bottom. Particles stream off the top edge
 * right behind those heads, so the pop follows the zip inward rather than
 * bursting from fixed points.
 */
function zip() {
  const box = boxEl.value;
  phase.value = 'zip';
  if (!box) { finish(); return; }
  const r = box.getBoundingClientRect();
  const emitter = startEdgeEmitter(r);
  // Share of the path spent on the top edge: half the width out of (w + h).
  const topStart = 1 - (r.width / 2) / (r.width + r.height);
  let last = topStart;
  const total = runPanelDraw(box, 'up', frac => {
    if (boxEl.value) boxEl.value.style.clipPath = `inset(0 0 ${(frac * 100).toFixed(2)}% 0)`;
    if (frac > topStart && emitter) {
      // Fill every step since the last frame so the stream has no gaps.
      const a = (last - topStart) / (1 - topStart), b = (Math.min(frac, 1) - topStart) / (1 - topStart);
      emitter.emitSpan(a, b);
      last = frac;
    }
    if (frac >= 1) { emitter?.stop(); timers.push(window.setTimeout(finish, 120)); }
  });
  if (!total) { emitter?.stop(); finish(); } // reduced motion: straight to the end
}

function finish() { endDatasetTransition(); phase.value = null; }

/** Particles along the box's top edge. emitSpan(a, b) spawns them between
 *  progress a and b of the corner to centre run, on both halves at once. */
function startEdgeEmitter(r: DOMRect) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const PADX = 60, PADT = 170, PADB = 90;
  const W = r.width + PADX * 2, H = PADT + PADB;
  const cv = document.createElement('canvas');
  cv.style.cssText = `position:fixed;left:${r.left - PADX}px;top:${r.top - PADT}px;width:${W}px;height:${H}px;pointer-events:none;z-index:100000;`;
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return null; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const y0 = PADT, half = r.width / 2, cx = PADX + half;
  type P = { x: number; y: number; vx: number; vy: number; life: number; age: number; s: number; hue: number };
  const parts: P[] = [];
  const spawn = (x: number, inward: number) => {
    const up = Math.random() < 0.78;
    parts.push({
      x, y: y0,
      vx: inward * (0.25 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.7,
      vy: up ? -(0.6 + Math.random() * 2.4) : 0.3 + Math.random() * 1.1,
      life: 650 + Math.random() * 650, age: 0,
      s: 0.8 + Math.random() * 1.9,
      hue: Math.random(),
    });
  };
  let stopped = false, raf = 0, prev = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(40, now - prev); prev = now;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      const k = dt / 16.7;
      p.x += p.vx * k; p.y += p.vy * k;
      p.vy += 0.018 * k; p.vx *= 0.985;
      const t = p.age / p.life, a = (1 - t) * (1 - t);
      // cyan into violet, like the progress bar
      const rC = Math.round(66 + (201 - 66) * p.hue), gC = Math.round(213 + (139 - 213) * p.hue), bC = Math.round(236 + (255 - 236) * p.hue);
      ctx.fillStyle = `rgba(${rC},${gC},${bC},${(a * 0.9).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - t * 0.4), 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(${rC},${gC},${bC},${(a * 0.18).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 3.2, 0, 6.283); ctx.fill();
    }
    if (stopped && !parts.length) { cv.remove(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    emitSpan(a: number, b: number) {
      const PER_PX = 0.55;                       // particles per pixel of edge, per side
      const x0 = a * half, x1 = b * half;         // distance travelled from each corner
      const n = Math.max(1, Math.round((x1 - x0) * PER_PX));
      for (let i = 0; i < n; i++) {
        const d = x0 + (x1 - x0) * Math.random();
        spawn(PADX + d, +1);                      // left head, moving right (inward)
        spawn(PADX + r.width - d, -1);            // right head, moving left (inward)
      }
      if (b >= 1) for (let i = 0; i < 26; i++) spawn(cx + (Math.random() - 0.5) * 16, Math.random() < 0.5 ? 1 : -1); // the meeting point pops
    },
    stop() { stopped = true; },
    cancel() { cancelAnimationFrame(raf); cv.remove(); },
  };
}

watch(() => datasetTransition.current, t => { if (t) { play(); loadMine(t.id); } });
onMounted(() => { resumeDatasetTransition(); if (datasetTransition.current) { play(); loadMine(datasetTransition.current.id); } });
onBeforeUnmount(clearTimers);
</script>

<template>
  <Teleport to="body">
    <div v-if="datasetTransition.current && phase" class="nge-dst"
         :class="{ 'nge-dst--zip': phase === 'zip', 'nge-dst--resumed': datasetTransition.resumed }"
         :style="{ '--dst-in': `-${elapsed}ms` }" aria-live="polite">
      <div ref="boxEl" class="nge-dst-box">
        <div class="nge-dst-eyebrow"><span class="nge-dst-dot"></span>{{ datasetTransition.current.eyebrow || 'Now entering' }}</div>
        <div class="nge-dst-title">{{ datasetTransition.current.label }}</div>
        <Transition name="nge-dst-stats">
          <div v-if="mine" class="nge-dst-stats">
            <template v-if="mine.edits || mine.completions || mine.helpRequests">
              <span class="nge-dst-stats-label">Your work here</span>
              <span v-if="mineAll || mine.edits" class="nge-dst-stat"><b>{{ mine.edits.toLocaleString() }}</b> edit{{ mine.edits === 1 ? '' : 's' }}</span>
              <span class="nge-dst-stat" :class="{ 'nge-dst-stat--cells': mine.completions }"><b>{{ mine.completions.toLocaleString() }}</b> cell{{ mine.completions === 1 ? '' : 's' }} proofread</span>
              <span v-if="mine.helpRequests" class="nge-dst-stat"><b>{{ mine.helpRequests.toLocaleString() }}</b> help request{{ mine.helpRequests === 1 ? '' : 's' }}</span>
            </template>
            <span v-else class="nge-dst-stats-first">Your first visit here. Welcome, scientist!</span>
          </div>
        </Transition>
        <div class="nge-dst-thumb" :class="{ 'nge-dst-thumb--empty': !datasetTransition.current.thumbnail, 'nge-dst-thumb--contain': datasetTransition.current.contain }">
          <img v-if="datasetTransition.current.thumbnail" :src="datasetTransition.current.thumbnail" alt="" />
          <span class="nge-dst-scan" aria-hidden="true"></span>
          <span class="nge-dst-grid" aria-hidden="true"></span>
        </div>
        <div class="nge-dst-status">
          <span class="nge-dst-step">{{ STEPS[stepIdx] }}</span>
          <span class="nge-dst-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <div class="nge-dst-bar" :class="{ 'nge-dst-bar--hold': datasetTransition.current.hold }" aria-hidden="true"><span></span></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-dst {
  /* Below the sign in box (.nge-login-blocker, 10000): never cover login. */
  position: fixed; inset: 0; z-index: 9990;
  display: grid; place-items: center;
  pointer-events: none;
  animation: nge-dst-fade 0.3s ease both;
}
/* The haze behind the card is its own layer so it can fade out smoothly
   (a gradient background cannot transition, so it used to blink off). */
.nge-dst::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(2, 6, 14, 0.55), rgba(2, 6, 14, 0.2) 70%, transparent);
  transition: opacity 0.45s ease;
}
.nge-dst--zip::before { opacity: 0; }
@keyframes nge-dst-fade { from { opacity: 0; } to { opacity: 1; } }
.nge-dst--resumed, .nge-dst--resumed .nge-dst-box { animation: none; }

/* scifi-ui holopanel surface, with the soft materialize the app uses. */
.nge-dst-box {
  position: relative;
  width: min(560px, 88vw);
  padding: 20px 22px 18px;
  border-radius: 14px;
  border: 1px solid rgba(74, 150, 224, 0.35);
  background: linear-gradient(158deg, rgba(15, 18, 24, 0.97), rgba(6, 10, 18, 0.98));
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6), 0 0 70px rgba(66, 213, 236, 0.10), inset 0 1px 0 rgba(196, 228, 255, 0.12);
  animation: nge-dst-materialize 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
@keyframes nge-dst-materialize {
  0%   { opacity: 0; transform: scale(1.025) translateY(-8px); filter: blur(14px); }
  60%  { opacity: 1; transform: scale(0.995); filter: blur(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
}

.nge-dst-eyebrow {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600;
  color: rgba(140, 200, 245, 0.95);
}
.nge-dst-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #42d5ec;
  box-shadow: 0 0 10px #42d5ec; animation: nge-dst-pulse 1.1s ease-in-out infinite;
}
@keyframes nge-dst-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.nge-dst-title {
  margin: 6px 0 14px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em;
  color: #fff; text-shadow: 0 0 22px rgba(120, 190, 255, 0.35);
}

.nge-dst-stats {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px;
  margin: -6px 0 12px; font-size: 13.5px; color: rgba(214, 228, 242, 0.85);
}
.nge-dst-stats-label { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; color: rgba(201, 139, 255, 0.95); }
.nge-dst-stat b { color: #fff; font-weight: 700; font-size: 15px; margin-right: 2px; }
.nge-dst-stat--cells { color: #fff; font-weight: 600; }
.nge-dst-stat--cells b { color: #5fe3f5; font-weight: 800; font-size: 17px; }
.nge-dst-stats-first { color: #ffd35a; font-weight: 600; }
.nge-dst-stats-enter-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.nge-dst-stats-enter-from { opacity: 0; transform: translateY(4px); }
.nge-dst-thumb {
  position: relative; overflow: hidden;
  aspect-ratio: 16 / 9; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: #04070d;
}
.nge-dst-thumb img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  /* Revealed top to bottom exactly as the scan line passes (same timing). */
  animation: nge-dst-wipe 0.95s cubic-bezier(0.4, 0, 0.3, 1) both;
  animation-delay: calc(var(--dst-in, 0ms) + 0.25s);
}
@keyframes nge-dst-wipe {
  from { clip-path: inset(0 0 100% 0); filter: brightness(1.6); }
  to   { clip-path: inset(0 0 0 0); filter: brightness(1); }
}
.nge-dst-thumb--empty { background: radial-gradient(circle at 50% 50%, rgba(66, 213, 236, 0.18), #04070d 70%); }
/* One fast bright line down the image; the image appears behind it. Its
   top edge tracks the wipe's edge (same duration, easing and delay). */
.nge-dst-scan {
  position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: rgba(200, 245, 255, 0.95);
  box-shadow: 0 0 14px 3px rgba(120, 220, 255, 0.8), 0 -18px 30px rgba(120, 220, 255, 0.25);
  animation: nge-dst-sweep 0.95s cubic-bezier(0.4, 0, 0.3, 1) both;
  animation-delay: calc(var(--dst-in, 0ms) + 0.25s);
}
@keyframes nge-dst-sweep {
  0%   { top: 0; opacity: 1; }
  92%  { opacity: 1; }
  100% { top: calc(100% - 2px); opacity: 0; }
}
.nge-dst-grid {
  position: absolute; inset: 0; opacity: 0.18; pointer-events: none;
  background-image:
    linear-gradient(rgba(140, 210, 255, 0.5) 1px, transparent 1px),
    linear-gradient(90deg, rgba(140, 210, 255, 0.5) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse at center, transparent 35%, #000 90%);
}

.nge-dst-status {
  display: flex; align-items: center; gap: 8px; margin: 14px 0 8px;
  font-size: 13px; color: rgba(214, 228, 242, 0.85);
}
.nge-dst-dots { display: inline-flex; gap: 4px; }
.nge-dst-dots i { width: 4px; height: 4px; border-radius: 50%; background: #42d5ec; animation: nge-dst-pulse 0.9s ease-in-out infinite; }
.nge-dst-dots i:nth-child(2) { animation-delay: 0.15s; }
.nge-dst-dots i:nth-child(3) { animation-delay: 0.3s; }
.nge-dst-bar { height: 3px; border-radius: 3px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.nge-dst-bar span {
  display: block; height: 100%; width: 100%; transform-origin: left;
  background: linear-gradient(90deg, #42d5ec, #c98bff);
  box-shadow: 0 0 12px rgba(66, 213, 236, 0.7);
  animation: nge-dst-fill 2.2s cubic-bezier(0.3, 0.1, 0.2, 1) both;
  animation-delay: var(--dst-in, 0ms);
}
@keyframes nge-dst-fill { from { transform: scaleX(0.04); } to { transform: scaleX(1); } }
/* A held card cannot know how long it will take: fill most of the way over
   a few seconds, then creep, so it never sits full while still working. */
.nge-dst-bar--hold span { animation: nge-dst-fill-hold 14s cubic-bezier(0.1, 0.7, 0.2, 1) both; }
@keyframes nge-dst-fill-hold { 0% { transform: scaleX(0.04); } 25% { transform: scaleX(0.7); } 100% { transform: scaleX(0.96); } }
/* A drawing, not a photo: show all of it, softly lit. */
.nge-dst-thumb--contain {
  background: radial-gradient(ellipse at 45% 55%, rgba(66, 213, 236, 0.16), #04070d 72%);
}
.nge-dst-thumb--contain img { object-fit: contain; padding: 10px 14px; box-sizing: border-box; }

@media (prefers-reduced-motion: reduce) {
  .nge-dst-box, .nge-dst-thumb img, .nge-dst-scan, .nge-dst-dot, .nge-dst-dots i, .nge-dst-bar span { animation: none; }
}
</style>
