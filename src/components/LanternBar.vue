<script setup lang="ts">
/**
 * The Lantern's controls: one slim bar under the top bar while Lantern mode is
 * on. It folds down to a chip, so it never takes more than a line. See
 * util/lantern.ts for what the two settings do.
 */
import { computed, ref } from 'vue';
import { lantern, lanternBranch, LANTERN_LIMITS as L } from '../util/lantern';
import { isTouchRef } from '../util/mobile';
import { spooky, callGhost, callTheReaper, shoo } from '../util/spooky';
import { useProofreadingBackendStore } from '../store';
import ghostIcon from '../images/ghost-icon.png';
import reaperIcon from '../images/reaper-icon.png';

// The ghost button (Halloween: util/spooky.ts). Everyone has it in Halloween
// week; outside it, admins only, for trying it out.
const backend = useProofreadingBackendStore();

// What the bar says in Clicked branch mode.
const branchHint = computed(() => {
  const tap = isTouchRef.value ? 'Tap' : 'Click';
  if (lanternBranch.message) return lanternBranch.message;
  if (lanternBranch.status === 'finding') return 'Finding the branch';
  if (lanternBranch.status === 'lit') return `${tap} another branch, or empty space to put it out`;
  return `${tap} a branch to light it`;
});
const showGhost = computed(() => spooky.season || backend.showAdminUi);

// The bar can be dragged anywhere by its grip (Ames 2026-10-10: "I need to be
// able to move the lantern box"). Its place is remembered in this browser;
// a double click on the grip puts it back under the top bar.
const POS_KEY = 'nge-lantern-bar-pos';
const bar = ref<HTMLElement | null>(null);
const pos = ref<{ x: number; y: number } | null>(null);
try {
  const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) pos.value = { x: saved.x, y: saved.y };
} catch { /* the usual place */ }
const clamp = (x: number, y: number) => {
  const w = bar.value?.offsetWidth ?? 420, h = bar.value?.offsetHeight ?? 34;
  return { x: Math.max(4, Math.min(window.innerWidth - w - 4, x)), y: Math.max(4, Math.min(window.innerHeight - h - 4, y)) };
};
const placed = computed(() => {
  if (!pos.value) return {};
  const p = clamp(pos.value.x, pos.value.y);
  return { left: p.x + 'px', top: p.y + 'px', transform: 'none' };
});
function startDrag(e: PointerEvent) {
  if (e.button !== 0 || !bar.value) return;
  e.preventDefault();
  const box = bar.value.getBoundingClientRect();
  const dx = e.clientX - box.left, dy = e.clientY - box.top;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
    moved = true;
    pos.value = clamp(ev.clientX - dx, ev.clientY - dy);
  };
  const up = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    if (moved && pos.value) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos.value)); } catch { /* not remembered */ } }
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
}
function resetPlace() {
  pos.value = null;
  try { localStorage.removeItem(POS_KEY); } catch { /* nothing to clear */ }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-lantern-bar">
    <div v-if="lantern.on" ref="bar" class="nge-lantern" :class="{ 'nge-lantern--folded': !lantern.open }" :style="placed" role="group" aria-label="Lantern mode">
      <span class="nge-lantern-grip" title="Drag to move. Double click to put it back." aria-hidden="true"
            @pointerdown="startDrag" @dblclick="resetPlace">⠿</span>
      <button type="button" class="nge-lantern-name" :aria-expanded="lantern.open"
              :title="lantern.open ? 'Fold the Lantern settings away' : 'Show the Lantern settings'" @click="lantern.open = !lantern.open">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M6 2.2h4M8 2.2V1M5.2 4.4h5.6l.9 7.2H4.3l.9-7.2ZM4.6 13.6h6.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 6.4c1 1.1 1.5 1.9 1.5 2.7a1.5 1.5 0 0 1-3 0c0-.8.5-1.6 1.5-2.7Z" fill="currentColor"/>
        </svg>
        Lantern
      </button>
      <template v-if="lantern.open">
        <!-- What is lit: the cell round the middle of the view, or only the branch you click (Ames 2026-10-27). -->
        <span class="nge-lantern-mode" role="radiogroup" aria-label="What the Lantern lights">
          <button type="button" role="radio" :aria-checked="lantern.mode === 'cell'" :class="{ 'is-on': lantern.mode === 'cell' }"
                  title="Light the cell around the middle of your view" @click="lantern.mode = 'cell'">Whole cell</button>
          <button type="button" role="radio" :aria-checked="lantern.mode === 'branch'" :class="{ 'is-on': lantern.mode === 'branch' }"
                  title="Light only the branch you click on" @click="lantern.mode = 'branch'">Clicked branch</button>
        </span>
        <span v-if="lantern.mode === 'branch'" class="nge-lantern-hint" :class="{ 'is-failed': lanternBranch.status === 'failed' }" aria-live="polite">
          <span v-if="lanternBranch.status === 'finding'" class="nge-lantern-spin" aria-hidden="true"></span>{{ branchHint }}
        </span>
        <label v-if="lantern.mode === 'cell'" class="nge-lantern-set" title="How far the light reaches">
          <span>Size</span>
          <input type="range" v-model.number="lantern.sizeUm" :min="L.sizeUm.min" :max="L.sizeUm.max" :step="L.sizeUm.step" @keydown.stop />
          <output>{{ lantern.sizeUm }} <span class="nge-lantern-unit">µm</span></output>
        </label>
        <label class="nge-lantern-set" title="How bright the lit part is">
          <span>Flame</span>
          <input type="range" v-model.number="lantern.flame" :min="L.flame.min" :max="L.flame.max" :step="L.flame.step" @keydown.stop />
          <output>{{ lantern.flame }}%</output>
        </label>
      </template>
      <span v-if="showGhost" class="nge-lantern-spooky">
        <button type="button" class="nge-lantern-ghost" :class="{ 'is-on': spooky.on }" title="Call a ghost" aria-label="Call a ghost" @click="callGhost">
          <img :src="ghostIcon" alt="" draggable="false" />
        </button>
        <!-- The reaper is held back from players for now: admins only, to try him out. -->
        <button v-if="backend.showAdminUi" type="button" class="nge-lantern-ghost nge-lantern-ghost--reaper" title="Call the reaper (admins only, for testing)" aria-label="Call the reaper" @click="callTheReaper">
          <img :src="reaperIcon" alt="" draggable="false" />
        </button>
        <button v-if="spooky.on" type="button" class="nge-lantern-mini" title="Send them away" aria-label="Send them away" @click="shoo">shoo</button>
      </span>
      <button type="button" class="nge-lantern-off" title="Turn the Lantern off (Shift+N)" aria-label="Turn the Lantern off" @click="lantern.on = false">×</button>
    </div>
    </Transition>
    <!-- The gem where the branch was clicked: it glows while the branch is
         found, and goes once it lights (Ames 2026-10-27). -->
    <div v-if="lantern.on && lanternBranch.marker" :key="lanternBranch.marker.at" class="nge-lantern-gem"
         :class="'is-' + lanternBranch.marker.state" :style="{ left: lanternBranch.marker.x + 'px', top: lanternBranch.marker.y + 'px' }" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path d="M7 4h10l4 5-9 11L3 9z" fill="#ffc878"/>
        <path d="M7 4h10l-2 5H9z" fill="#fff2d6" opacity="0.75"/>
        <path d="M3 9h18M7 4l5 16M17 4l-5 16" stroke="#8a5512" stroke-width="0.8" fill="none" opacity="0.55"/>
      </svg>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-lantern {
  /* The same cut as the layer tabs (ng-override.css): a circuit board part,
     with a long diagonal on the top right, a short one top left, a third on
     the bottom left and one corner left square, so no two corners match
     (Ames 2026-10-10: "a cool scifi circuit vibe like the layers tabs"). A
     clipped box cannot carry a border, so the edge is the box's own
     background showing round a slightly smaller fill (::before). In the
     Lantern's amber, where the layer tabs are blue. */
  --lan-edge: rgba(255, 196, 110, 0.62);
  --lan-fill: #0a1120;
  --lan-trace: #ffd08a;
  /* where the two pads sit, measured along the top edge (6px in, 14px short) */
  --lan-pad-x: calc(6px + (100% - 20px) * 0.75);
  --lan-cut: polygon(
    6px 3px, calc(var(--lan-pad-x) - 8px) 3px, calc(var(--lan-pad-x) - 8px) 0,
    calc(var(--lan-pad-x) + 8px) 0, calc(var(--lan-pad-x) + 8px) 3px,
    calc(100% - 14px) 3px, 100% 17px, 100% 100%, 9px 100%, 0 calc(100% - 9px), 0 9px);
  position: fixed; left: 50%; top: 43px; transform: translateX(-50%); z-index: 900;
  display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 24px); box-sizing: border-box;
  /* 3px of headroom above the shape: the pads sit ON the top edge, half above it */
  padding: 10px 18px 7px 8px; border: 0; border-radius: 0;
  /* The trace turns the corners and runs on down the sides, fading out as it
     nears the foot (Ames 2026-10-10). It never paints the headroom. */
  background: linear-gradient(180deg, var(--lan-trace) 0%, rgba(255, 204, 128, 0.85) 30%, rgba(255, 196, 110, 0.3) 72%, rgba(255, 196, 110, 0.05) 100%) no-repeat left bottom / 100% calc(100% - 3px);
  clip-path: var(--lan-cut);
  font: 500 12px/1.2 'Inter', system-ui, sans-serif; color: rgba(239, 244, 251, 0.9);
  user-select: none;
}
.nge-lantern::before {
  /* reaches the shape's very top, so the trace is the only top edge */
  content: ''; position: absolute; inset: 3px 1px 1px 1px; z-index: 0; pointer-events: none;
  background: linear-gradient(168deg, #0d1628 0%, var(--lan-fill) 60%, #070c18 100%);
  clip-path: polygon(5px 0, calc(100% - 13px) 0, 100% 14px, 100% 100%, 8.4px 100%, 0 calc(100% - 8.4px), 0 6.4px);
}
/* The top edge IS the circuit trace, as on the selected layer tab (Ames
   2026-10-10: "the circuit line at the top IS the top bar, not in addition to
   the top bar"). It runs inward along the edge from either side; the two runs
   do not join, each ends on a pad, and the pads sit either side of a small
   gap three quarters of the way across. */
.nge-lantern::after {
  content: ''; position: absolute; z-index: 1; pointer-events: none;
  left: 6px; right: 14px; top: 0; height: 7px;
  background:
    radial-gradient(circle at calc(75% - 4.5px) 3.7px, #1a1408 0 0.9px, var(--lan-trace) 1.3px 2.1px, transparent 2.5px),
    radial-gradient(circle at calc(75% + 4.5px) 3.7px, #1a1408 0 0.9px, var(--lan-trace) 1.3px 2.1px, transparent 2.5px),
    linear-gradient(var(--lan-trace), var(--lan-trace)) left 0 top 3px / calc(75% - 6.8px) 1.4px no-repeat,
    linear-gradient(var(--lan-trace), var(--lan-trace)) right 0 top 3px / calc(25% - 6.8px) 1.4px no-repeat;
}
.nge-lantern > * { position: relative; z-index: 1; }
.nge-lantern--folded { gap: 4px; padding-right: 14px; }
/* The bar comes in as the lantern lights: a light runs across it from the
   left, once, like the one crossing the cells. */
.nge-lantern-bar-enter-active { animation: nge-lantern-bar-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.nge-lantern-bar-leave-active { animation: nge-lantern-bar-out 0.26s ease-in both; }
@keyframes nge-lantern-bar-in {
  0%   { opacity: 0; filter: brightness(2.6); clip-path: polygon(6px 3px, 6px 3px, 6px 0, 6px 0, 6px 3px, 6px 3px, 6px 17px, 6px 100%, 6px 100%, 0 calc(100% - 9px), 0 9px); }
  100% { opacity: 1; filter: none; clip-path: var(--lan-cut); }
}
@keyframes nge-lantern-bar-out {
  0%   { opacity: 1; filter: none; }
  100% { opacity: 0; filter: brightness(0.5); }
}
@media (prefers-reduced-motion: reduce) { .nge-lantern-bar-enter-active, .nge-lantern-bar-leave-active { animation: none; } }
.nge-lantern-grip { margin-right: -8px; padding: 3px 4px; border-radius: 5px; cursor: grab; font-size: 13px; line-height: 1; color: rgba(255, 200, 120, 0.55); touch-action: none; }
.nge-lantern-grip:hover { color: #ffc878; background: rgba(255, 196, 110, 0.1); }
.nge-lantern-grip:active { cursor: grabbing; }
.nge-lantern-name {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid transparent; border-radius: 6px;
  background: none; cursor: pointer; font: 600 11px/1 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #ffc878;
}
.nge-lantern-name:hover, .nge-lantern-name:focus-visible { border-color: rgba(255, 196, 110, 0.45); outline: none; }
.nge-lantern-mode { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid rgba(255, 196, 110, 0.28); border-radius: 7px; }
.nge-lantern-mode button {
  padding: 3px 8px; border: 0; border-radius: 5px; background: none; cursor: pointer;
  font: 500 11px/1.2 'Inter', system-ui, sans-serif; color: rgba(190, 205, 225, 0.85); white-space: nowrap;
}
.nge-lantern-mode button:hover, .nge-lantern-mode button:focus-visible { color: #fff; outline: none; background: rgba(255, 196, 110, 0.1); }
.nge-lantern-mode button.is-on { color: #1a1206; background: #ffc878; }
.nge-lantern-hint { font-size: 11px; color: rgba(190, 205, 225, 0.8); white-space: nowrap; }
.nge-lantern-spin {
  display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; box-sizing: border-box;
  border: 2px solid rgba(255, 200, 120, 0.25); border-top-color: #ffc878; border-radius: 50%;
  animation: nge-lantern-spin 0.8s linear infinite;
}
@keyframes nge-lantern-spin { to { transform: rotate(360deg); } }
/* The gem at the click: its tip on the point, a ring going out from it while
   the branch is found; it rises and fades once the branch lights. */
.nge-lantern-gem { position: fixed; z-index: 899; width: 0; height: 0; pointer-events: none; }
.nge-lantern-gem svg { position: absolute; left: -11px; top: -24px; filter: drop-shadow(0 0 6px rgba(255, 200, 120, 0.9)); animation: nge-lantern-gem-bob 0.9s ease-in-out infinite alternate; }
.nge-lantern-gem::after {
  content: ''; position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; box-sizing: border-box;
  border: 2px solid rgba(255, 200, 120, 0.85); border-radius: 50%; animation: nge-lantern-gem-ring 1.1s ease-out infinite;
}
.nge-lantern-gem.is-done svg { animation: nge-lantern-gem-done 0.65s ease-out forwards; }
.nge-lantern-gem.is-done::after, .nge-lantern-gem.is-failed::after { display: none; }
.nge-lantern-gem.is-failed svg { animation: nge-lantern-gem-fail 0.6s ease-in forwards; }
@keyframes nge-lantern-gem-bob { from { transform: translateY(0); } to { transform: translateY(-4px); } }
@keyframes nge-lantern-gem-ring { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.8); opacity: 0; } }
@keyframes nge-lantern-gem-done { 0% { transform: scale(1); opacity: 1; filter: drop-shadow(0 0 6px rgba(255, 200, 120, 0.9)) brightness(1); } 35% { transform: scale(1.35); filter: drop-shadow(0 0 12px rgba(255, 220, 160, 1)) brightness(1.6); } 100% { transform: translateY(-14px) scale(0.6); opacity: 0; } }
@keyframes nge-lantern-gem-fail { to { transform: translateY(6px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .nge-lantern-spin { animation: none; border-color: #ffc878; border-top-color: #ffc878; opacity: 0.8; }
  .nge-lantern-gem svg, .nge-lantern-gem.is-done svg, .nge-lantern-gem.is-failed svg { animation: none; }
  .nge-lantern-gem::after { animation: none; transform: scale(1.3); opacity: 0.6; }
}
.nge-lantern-hint.is-failed { color: #ffb4a0; white-space: normal; max-width: 260px; }
.nge-lantern-set { display: inline-flex; align-items: center; gap: 7px; color: rgba(190, 205, 225, 0.85); }
.nge-lantern-set > span:first-child { font: 500 10px/1 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255, 208, 138, 0.72); }
.nge-lantern-set input[type='range'] { width: 92px; accent-color: #ffc878; }
.nge-lantern-set output { min-width: 44px; font-variant-numeric: tabular-nums; color: #f3f6fb; }
/* a unit symbol is never upper-cased by a parent */
.nge-lantern-unit { text-transform: none; color: rgba(190, 205, 225, 0.7); }
/* The ghost button, and what comes with it once the haunting is on */
.nge-lantern-spooky { display: inline-flex; align-items: center; gap: 4px; padding-left: 10px; border-left: 1px solid rgba(196, 228, 255, 0.14); }
.nge-lantern-ghost { width: 28px; height: 28px; padding: 2px; border: 1px solid transparent; border-radius: 7px; background: none; cursor: pointer; transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease; }
.nge-lantern-ghost img { width: 100%; height: 100%; object-fit: contain; display: block; opacity: 0.7; transition: opacity 0.15s ease, filter 0.15s ease; }
.nge-lantern-ghost:hover, .nge-lantern-ghost:focus-visible { transform: translateY(-2px); border-color: rgba(160, 225, 255, 0.5); background: rgba(160, 225, 255, 0.08); outline: none; }
.nge-lantern-ghost:hover img, .nge-lantern-ghost:focus-visible img, .nge-lantern-ghost.is-on img { opacity: 1; filter: drop-shadow(0 0 5px rgba(160, 225, 255, 0.8)); }
.nge-lantern-ghost:active { transform: scale(0.9); }
.nge-lantern-mini { height: 24px; padding: 0 7px; border: 1px solid rgba(196, 228, 255, 0.2); border-radius: 6px; background: none; cursor: pointer; font: inherit; font-size: 11px; color: rgba(190, 205, 225, 0.85); display: inline-flex; align-items: center; }
.nge-lantern-mini:hover, .nge-lantern-mini:focus-visible { color: #fff; border-color: rgba(196, 228, 255, 0.5); outline: none; }
.nge-lantern-ghost--reaper:hover, .nge-lantern-ghost--reaper:focus-visible { border-color: rgba(255, 120, 110, 0.6); background: rgba(255, 120, 110, 0.08); }
.nge-lantern-ghost--reaper:hover img, .nge-lantern-ghost--reaper:focus-visible img { filter: drop-shadow(0 0 5px rgba(255, 90, 70, 0.85)); }
@media (prefers-reduced-motion: reduce) { .nge-lantern-ghost { transition: none; } .nge-lantern-ghost:hover { transform: none; } }
.nge-lantern-off {
  padding: 1px 7px; border: 1px solid transparent; border-radius: 6px; background: none; cursor: pointer;
  font: inherit; font-size: 16px; line-height: 1; color: rgba(190, 205, 225, 0.8);
}
.nge-lantern-off:hover, .nge-lantern-off:focus-visible { color: #fff; border-color: rgba(196, 228, 255, 0.4); outline: none; }
@media (max-width: 760px) {
  .nge-lantern { flex-wrap: wrap; gap: 6px 12px; justify-content: center; }
  .nge-lantern-set input[type='range'] { width: 74px; }
}
</style>
