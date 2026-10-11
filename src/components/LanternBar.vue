<script setup lang="ts">
/**
 * The Lantern's controls: one slim bar under the top bar while Lantern mode is
 * on. It folds down to a chip, so it never takes more than a line. See
 * util/lantern.ts for what the two settings do.
 */
import { computed, ref } from 'vue';
import { lantern, LANTERN_LIMITS as L } from '../util/lantern';
import { spooky, callGhost, callTheReaper, shoo } from '../util/spooky';
import { useProofreadingBackendStore } from '../store';
import ghostIcon from '../images/ghost-icon.png';
import reaperIcon from '../images/reaper-icon.png';

// The ghost button (Halloween: util/spooky.ts). Everyone has it in Halloween
// week; outside it, admins only, for trying it out.
const backend = useProofreadingBackendStore();
const showGhost = computed(() => spooky.season || backend.isAdmin);

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
        <label class="nge-lantern-set" title="How far the light reaches">
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
        <button v-if="backend.isAdmin" type="button" class="nge-lantern-ghost nge-lantern-ghost--reaper" title="Call the reaper (admins only, for testing)" aria-label="Call the reaper" @click="callTheReaper">
          <img :src="reaperIcon" alt="" draggable="false" />
        </button>
        <button v-if="spooky.on" type="button" class="nge-lantern-mini" title="Send them away" aria-label="Send them away" @click="shoo">shoo</button>
      </span>
      <button type="button" class="nge-lantern-off" title="Turn the Lantern off (Shift+N)" aria-label="Turn the Lantern off" @click="lantern.on = false">×</button>
    </div>
    </Transition>
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
  position: fixed; left: 50%; top: 46px; transform: translateX(-50%); z-index: 900;
  display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 24px); box-sizing: border-box;
  padding: 8px 18px 6px 8px; border: 0; border-radius: 0;
  background: linear-gradient(180deg, var(--lan-edge) 0%, rgba(255, 196, 110, 0.4) 55%, rgba(255, 196, 110, 0.16) 100%);
  clip-path: polygon(6px 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 9px 100%, 0 calc(100% - 9px), 0 6px);
  font: 500 12px/1.2 'Inter', system-ui, sans-serif; color: rgba(239, 244, 251, 0.9);
  user-select: none;
}
.nge-lantern::before {
  content: ''; position: absolute; inset: 1px; z-index: 0; pointer-events: none;
  background: linear-gradient(168deg, #0d1628 0%, var(--lan-fill) 60%, #070c18 100%);
  clip-path: polygon(5.6px 0, calc(100% - 13.4px) 0, 100% 13.4px, 100% 100%, 8.4px 100%, 0 calc(100% - 8.4px), 0 5.6px);
}
/* a trace along the top that ends in a solder point, as on the lit layer tab
   (Ames 2026-10-10: at the TOP of the box, not the bottom) */
.nge-lantern::after {
  content: ''; position: absolute; left: 14px; top: 2px; width: 38%; max-width: 190px; height: 5px; z-index: 0; pointer-events: none;
  background:
    radial-gradient(circle 2px at calc(100% - 2.5px) 50%, #ffd08a 96%, transparent 100%),
    linear-gradient(90deg, rgba(255, 196, 110, 0.15), rgba(255, 196, 110, 0.75)) left center / calc(100% - 4px) 1px no-repeat;
}
.nge-lantern > * { position: relative; z-index: 1; }
.nge-lantern--folded { gap: 4px; padding-right: 14px; }
.nge-lantern--folded::after { width: 46%; }
/* The bar comes in as the lantern lights: a light runs across it from the
   left, once, like the one crossing the cells. */
.nge-lantern-bar-enter-active { animation: nge-lantern-bar-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.nge-lantern-bar-leave-active { animation: nge-lantern-bar-out 0.26s ease-in both; }
@keyframes nge-lantern-bar-in {
  0%   { opacity: 0; filter: brightness(2.6); clip-path: polygon(6px 0, 6px 0, 6px 0, 6px 100%, 9px 100%, 0 calc(100% - 9px), 0 6px); }
  100% { opacity: 1; filter: none; clip-path: polygon(6px 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 9px 100%, 0 calc(100% - 9px), 0 6px); }
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
