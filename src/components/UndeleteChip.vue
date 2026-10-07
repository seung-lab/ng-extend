<script setup lang="ts">
/**
 * The Undelete chip in the top bar: brings back the cells you just removed
 * from the view, newest first (util/undelete.ts; Krzysztof Kruk's idea).
 * It is only there when there is something to bring back.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { undelete, undeleteCount, undeleteNext } from '../util/undelete';

const flash = ref(false);
const tip = computed(() => {
  const n = undeleteNext.value;
  const what = n === 1 ? 'the cell you removed last' : `the ${n.toLocaleString()} cells you removed last`;
  const more = undeleteCount.value > 1 ? ` ${undeleteCount.value} steps kept, newest first.` : '';
  return `Undelete: bring back ${what} (Ctrl+Z).${more}`;
});

function run() {
  if (!undeleteCount.value) return;
  if (undelete() > 0) { flash.value = false; requestAnimationFrame(() => { flash.value = true; setTimeout(() => { flash.value = false; }, 420); }); }
}

// Ctrl+Z (⌘+Z), unless the player is typing somewhere.
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (!undeleteCount.value) return;
  e.preventDefault();
  run();
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <button v-if="undeleteCount > 0" class="nge-undelete-chip" :class="{ 'nge-undelete-chip--flash': flash }"
          type="button" :title="tip" :aria-label="tip" @click="run">
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M3.2 6.4h6.1a3.6 3.6 0 0 1 0 7.2H5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 3.4 3 6.4l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="nge-undelete-label">Undelete</span>
    <b class="nge-undelete-count">{{ undeleteCount }}</b>
  </button>
</template>

<style>
#extensionBar .nge-undelete-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; margin: 0 6px; padding: 0 10px 0 8px; align-self: center;
  font: 600 12px/1 'Inter', system-ui, sans-serif; letter-spacing: 0.02em; white-space: nowrap;
  color: #bfe9ff; background: rgba(53, 181, 255, 0.1);
  border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 13px;
  cursor: pointer; user-select: none;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
#extensionBar .nge-undelete-chip:hover, #extensionBar .nge-undelete-chip:focus-visible { color: #ffffff; background: rgba(53, 181, 255, 0.22); border-color: #7ee0ff; outline: none; }
.nge-undelete-chip:hover svg { animation: nge-undelete-nudge 0.7s ease-in-out infinite; }
.nge-undelete-count {
  min-width: 16px; padding: 2px 5px; box-sizing: border-box; border-radius: 8px;
  font-size: 10px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums;
  color: #06121f; background: #7ee0ff;
}
.nge-undelete-chip--flash { animation: nge-undelete-flash 0.42s ease-out; }
@keyframes nge-undelete-nudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-1.6px); } }
@keyframes nge-undelete-flash { 0% { box-shadow: 0 0 0 0 rgba(126, 224, 255, 0.7); } 100% { box-shadow: 0 0 0 9px rgba(126, 224, 255, 0); } }
@media (max-width: 900px) { .nge-undelete-label { display: none; } }
@media (prefers-reduced-motion: reduce) { .nge-undelete-chip:hover svg, .nge-undelete-chip--flash { animation: none; } }
</style>
