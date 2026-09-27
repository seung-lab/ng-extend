<script setup lang="ts">
/**
 * "Now entering <dataset>": shown when the dataset switcher is used.
 * Large thumbnail and a loading animation for a couple of seconds (and until
 * the viewer is back, when the switch reloaded the page), then the box zips
 * up with light like the Scout tag mode box, and pops into particles.
 * State lives in util/dataset_transition.ts so it survives the reload.
 */
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { datasetTransition, resumeDatasetTransition, endDatasetTransition } from '../util/dataset_transition';
import { runPanelTrace, runPanelDraw, runParticleBurst } from '../util/holo_trace';

const boxEl = ref<HTMLElement | null>(null);
const phase = ref<'loading' | 'zip' | null>(null);
const stepIdx = ref(0);
const STEPS = ['Loading the volume', 'Fetching cells', 'Aligning the view', 'Almost there'];
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
  phase.value = 'loading';
  stepIdx.value = 0;
  for (let i = 1; i < STEPS.length; i++) timers.push(window.setTimeout(() => { stepIdx.value = i; }, i * 650));
  nextTick(() => { if (boxEl.value) runPanelTrace(boxEl.value, 6); });
  const tick = () => {
    const age = Date.now() - t.t0;
    const ready = !datasetTransition.resumed || viewerReady();
    if ((age >= MIN_MS && ready) || age >= MAX_MS) { zip(); return; }
    timers.push(window.setTimeout(tick, 150));
  };
  tick();
}

function zip() {
  const box = boxEl.value;
  phase.value = 'zip';
  if (!box) { endDatasetTransition(); phase.value = null; return; }
  const total = runPanelDraw(box, 'up', frac => {
    if (boxEl.value) boxEl.value.style.clipPath = `inset(0 0 ${(frac * 100).toFixed(2)}% 0)`;
    if (frac >= 1) pop();
  });
  if (!total) pop(); // reduced motion: straight to the end
}

let popped = false;
function pop() {
  if (popped) return;
  popped = true;
  const box = boxEl.value;
  if (box) {
    const r = box.getBoundingClientRect();
    runParticleBurst(r.left + r.width / 2, r.top + 6, '66,213,236');
  }
  timers.push(window.setTimeout(() => { endDatasetTransition(); phase.value = null; popped = false; }, 120));
}

watch(() => datasetTransition.current, t => { if (t) { popped = false; play(); } });
onMounted(() => { resumeDatasetTransition(); if (datasetTransition.current) play(); });
onBeforeUnmount(clearTimers);
</script>

<template>
  <Teleport to="body">
    <div v-if="datasetTransition.current && phase" class="nge-dst" :class="{ 'nge-dst--zip': phase === 'zip' }" aria-live="polite">
      <div ref="boxEl" class="nge-dst-box">
        <div class="nge-dst-eyebrow"><span class="nge-dst-dot"></span>Now entering</div>
        <div class="nge-dst-title">{{ datasetTransition.current.label }}</div>
        <div class="nge-dst-thumb" :class="{ 'nge-dst-thumb--empty': !datasetTransition.current.thumbnail }">
          <img v-if="datasetTransition.current.thumbnail" :src="datasetTransition.current.thumbnail" alt="" />
          <span class="nge-dst-scan" aria-hidden="true"></span>
          <span class="nge-dst-grid" aria-hidden="true"></span>
        </div>
        <div class="nge-dst-status">
          <span class="nge-dst-step">{{ STEPS[stepIdx] }}</span>
          <span class="nge-dst-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <div class="nge-dst-bar" aria-hidden="true"><span></span></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-dst {
  position: fixed; inset: 0; z-index: 10050;
  display: grid; place-items: center;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(2, 6, 14, 0.55), rgba(2, 6, 14, 0.2) 70%, transparent);
  animation: nge-dst-fade 0.3s ease both;
}
.nge-dst--zip { background: transparent; transition: background 0.3s; }
@keyframes nge-dst-fade { from { opacity: 0; } to { opacity: 1; } }

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

.nge-dst-thumb {
  position: relative; overflow: hidden;
  aspect-ratio: 16 / 9; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: #04070d;
}
.nge-dst-thumb img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  animation: nge-dst-reveal 2s cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* The render resolves from blurred and dim to sharp while it "loads". */
@keyframes nge-dst-reveal {
  0%   { filter: blur(10px) brightness(0.45) saturate(0.6); transform: scale(1.08); }
  100% { filter: blur(0) brightness(1) saturate(1.1); transform: scale(1); }
}
.nge-dst-thumb--empty { background: radial-gradient(circle at 50% 50%, rgba(66, 213, 236, 0.18), #04070d 70%); }
/* A bright scan line sweeps down the image, over and over. */
.nge-dst-scan {
  position: absolute; left: 0; right: 0; top: 0; height: 30%;
  background: linear-gradient(180deg, transparent, rgba(120, 220, 255, 0.10) 70%, rgba(180, 240, 255, 0.55) 98%, transparent);
  mix-blend-mode: screen;
  animation: nge-dst-sweep 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes nge-dst-sweep { from { transform: translateY(-100%); } to { transform: translateY(340%); } }
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
}
@keyframes nge-dst-fill { from { transform: scaleX(0.04); } to { transform: scaleX(1); } }

@media (prefers-reduced-motion: reduce) {
  .nge-dst-box, .nge-dst-thumb img, .nge-dst-scan, .nge-dst-dot, .nge-dst-dots i, .nge-dst-bar span { animation: none; }
}
</style>
