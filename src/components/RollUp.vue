<script setup lang="ts">
/**
 * RollUp — a stat number that counts up from 0 when it first appears
 * (profile stats, scout report). Eases out so the last digits settle
 * slowly, the way an instrument arrives at a reading. Skipped entirely
 * under prefers-reduced-motion; re-runs if the bound value changes.
 */
import { ref, watch, onMounted } from 'vue';

const props = defineProps<{ value: number; duration?: number }>();
const shown = ref(0);
let raf = 0;

function run(to: number) {
  cancelAnimationFrame(raf);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(to)) {
    shown.value = to || 0;
    return;
  }
  const dur = props.duration ?? 900;
  const from = 0;
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - k, 3);
    shown.value = Math.round(from + (to - from) * ease);
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

onMounted(() => run(props.value));
watch(() => props.value, v => run(v));
</script>

<template>
  <span>{{ shown.toLocaleString() }}</span>
</template>
