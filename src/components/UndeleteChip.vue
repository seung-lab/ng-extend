<script setup lang="ts">
/**
 * The Undelete icon in the top bar: brings back the cells you just removed
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
  <!-- An icon like its neighbours, with the count as a badge (Ames 2026-10-07:
       the labelled chip took a lot of space). -->
  <button v-if="undeleteCount > 0" class="nge-icon-btn nge-icon-btn--badge nge-undelete-btn" :class="{ 'nge-undelete-btn--flash': flash }"
          type="button" :title="tip" :aria-label="tip" @click="run">
    <svg viewBox="0 0 16 16" width="19" height="19" fill="none" aria-hidden="true">
      <path d="M3.2 6.4h6.1a3.6 3.6 0 0 1 0 7.2H5.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 3.4 3 6.4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="nge-toolbar-badge nge-undelete-badge">{{ undeleteCount }}</span>
  </button>
</template>

<style>
#extensionBar .nge-undelete-btn { color: #9fdcff; }
#extensionBar .nge-undelete-btn:hover svg { animation: nge-undelete-nudge 0.7s ease-in-out infinite; }
#extensionBar .nge-undelete-btn .nge-undelete-badge { background: #35b5ff; color: #06121f; }
.nge-undelete-btn--flash svg { animation: nge-undelete-flash 0.42s ease-out; }
@keyframes nge-undelete-nudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-1.6px); } }
@keyframes nge-undelete-flash { 0% { transform: rotate(-70deg) scale(1.25); filter: brightness(2); } 100% { transform: none; filter: none; } }
@media (prefers-reduced-motion: reduce) { #extensionBar .nge-undelete-btn:hover svg, .nge-undelete-btn--flash svg { animation: none; } }
</style>
