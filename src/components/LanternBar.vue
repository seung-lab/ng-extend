<script setup lang="ts">
/**
 * The Lantern's controls: one slim bar under the top bar while Lantern mode is
 * on. It folds down to a chip, so it never takes more than a line. See
 * util/lantern.ts for what the three settings do.
 */
import { computed, ref } from 'vue';
import { lantern, LANTERN_LIMITS as L } from '../util/lantern';

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
        <label class="nge-lantern-set" title="Lift the lantern off the centre, toward you, so it lights the side of the cell you are looking at">
          <span>Height</span>
          <input type="range" v-model.number="lantern.heightUm" :min="L.heightUm.min" :max="L.heightUm.max" :step="L.heightUm.step" @keydown.stop />
          <output>{{ lantern.heightUm }} <span class="nge-lantern-unit">µm</span></output>
        </label>
        <label class="nge-lantern-set" title="How bright the lit part is">
          <span>Flame</span>
          <input type="range" v-model.number="lantern.flame" :min="L.flame.min" :max="L.flame.max" :step="L.flame.step" @keydown.stop />
          <output>{{ lantern.flame }}%</output>
        </label>
      </template>
      <button type="button" class="nge-lantern-off" title="Turn the Lantern off (Shift+N)" aria-label="Turn the Lantern off" @click="lantern.on = false">×</button>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-lantern {
  position: fixed; left: 50%; top: 46px; transform: translateX(-50%); z-index: 900;
  display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 24px); box-sizing: border-box;
  padding: 5px 6px 5px 4px; border-radius: 10px;
  background: linear-gradient(158deg, rgba(15, 18, 24, 0.95), rgba(6, 10, 18, 0.97));
  border: 1px solid rgba(255, 196, 110, 0.34);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(196, 228, 255, 0.08);
  font: 500 12px/1.2 'Inter', system-ui, sans-serif; color: rgba(239, 244, 251, 0.9);
  user-select: none;
}
.nge-lantern--folded { gap: 4px; }
.nge-lantern-grip { margin-right: -8px; padding: 3px 4px; border-radius: 5px; cursor: grab; font-size: 13px; line-height: 1; color: rgba(255, 200, 120, 0.55); touch-action: none; }
.nge-lantern-grip:hover { color: #ffc878; background: rgba(255, 196, 110, 0.1); }
.nge-lantern-grip:active { cursor: grabbing; }
.nge-lantern-name {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid transparent; border-radius: 6px;
  background: none; cursor: pointer; font: inherit; font-weight: 600; letter-spacing: 0.04em; color: #ffc878;
}
.nge-lantern-name:hover, .nge-lantern-name:focus-visible { border-color: rgba(255, 196, 110, 0.45); outline: none; }
.nge-lantern-set { display: inline-flex; align-items: center; gap: 7px; color: rgba(190, 205, 225, 0.85); }
.nge-lantern-set input[type='range'] { width: 92px; accent-color: #ffc878; }
.nge-lantern-set output { min-width: 44px; font-variant-numeric: tabular-nums; color: #f3f6fb; }
/* a unit symbol is never upper-cased by a parent */
.nge-lantern-unit { text-transform: none; color: rgba(190, 205, 225, 0.7); }
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
