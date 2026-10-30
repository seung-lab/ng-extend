<script setup lang="ts">
/** Asks whether a removed segment's marks go too (util/segment_marks_prompt.ts). */
import { computed, onMounted } from 'vue';
import { segmentMarksPrompt, deleteSegmentMarks, keepSegmentMarks, startSegmentMarksPrompt } from '../util/segment_marks_prompt';

onMounted(startSegmentMarksPrompt);
const words = computed(() => {
  const parts = segmentMarksPrompt.counts.map(c => `${c.n} ${c.label}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
});
const total = computed(() => segmentMarksPrompt.counts.reduce((a, c) => a + c.n, 0));
</script>

<template>
  <div v-if="segmentMarksPrompt.counts.length" class="nge-smp" role="alertdialog" aria-label="Delete this segment's marks?">
    <p>The segment you removed has {{ words }} {{ total === 1 ? 'mark' : 'marks' }}. Delete {{ total === 1 ? 'it' : 'them' }}?</p>
    <div class="nge-smp-row">
      <button type="button" class="nge-smp-btn" @click="keepSegmentMarks">Keep</button>
      <button type="button" class="nge-smp-btn nge-smp-btn--go" @click="deleteSegmentMarks">Delete</button>
    </div>
  </div>
</template>

<style scoped>
.nge-smp {
  position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); z-index: 1200; width: min(420px, calc(100vw - 32px));
  padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(120, 200, 255, 0.35); background: rgba(8, 14, 26, 0.96); color: #e4ecf5; font-size: 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
}
.nge-smp p { margin: 0 0 10px; line-height: 1.4; }
.nge-smp-row { display: flex; justify-content: flex-end; gap: 8px; }
.nge-smp-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.25); background: transparent; color: #e4ecf5; cursor: pointer; font: inherit; }
.nge-smp-btn:hover { background: rgba(255, 255, 255, 0.08); }
.nge-smp-btn--go { border-color: rgba(255, 110, 120, 0.6); color: #ff9aa3; }
</style>
