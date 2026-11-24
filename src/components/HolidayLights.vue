<script setup lang="ts">
/**
 * A string of colored holiday lights along the top bar (Ames 2026-11-24:
 * "maybe we could start with a string of colored lights along the top bar").
 * From 1 December to New Year's Day (src/util/season.ts holidaySeason), the
 * wire swags along the bar's bottom edge and the bulbs hang just below it,
 * twinkling in turn. It never takes a click. Settings > Holiday lights turns
 * it off (userPrefs.hideLights); calm screen and reduced motion keep the
 * bulbs lit but still.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useUserPreferencesStore } from '../store';
import { holidaySeason } from '../util/season';

const prefs = useUserPreferencesStore();
const inSeason = holidaySeason();
const on = computed(() => inSeason && prefs.prefs.hideLights !== true);

const SPAN = 46;                      // px between bulbs
const COLORS = ['#ff4d6d', '#ffd24a', '#3ee08f', '#4fb6ff', '#c77dff', '#ff9f43'];
const width = ref(window.innerWidth);
const onResize = () => { width.value = window.innerWidth; };
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

/** The wire: one shallow swag between each pair of bulbs. */
const n = computed(() => Math.max(2, Math.ceil(width.value / SPAN) + 1));
const wire = computed(() => {
  let d = 'M0 1';
  for (let i = 0; i < n.value; i++) d += ` Q${i * SPAN + SPAN / 2} 9 ${(i + 1) * SPAN} 1`;
  return d;
});
const bulbs = computed(() => Array.from({ length: n.value }, (_, i) => ({
  x: i * SPAN + SPAN / 2,
  color: COLORS[i % COLORS.length],
  // each bulb its own pace, so the twinkle never marches in step
  delay: -((i * 0.37) % 1.9).toFixed(2) + 's',
  dur: (1.6 + ((i * 7) % 5) * 0.25).toFixed(2) + 's',
  tilt: ((i * 13) % 17) - 8,
})));
</script>

<template>
  <div v-if="on" class="nge-holiday-lights" aria-hidden="true">
    <svg class="nge-holiday-wire" :width="n * SPAN" height="12" :viewBox="`0 0 ${n * SPAN} 12`">
      <path :d="wire" />
    </svg>
    <span v-for="(b, i) in bulbs" :key="i" class="nge-holiday-bulb"
          :style="{ left: b.x + 'px', '--c': b.color, animationDelay: b.delay, animationDuration: b.dur, rotate: b.tilt + 'deg' }"></span>
  </div>
</template>

<style scoped>
.nge-holiday-lights { position: absolute; left: 0; right: 0; top: 0; height: 22px; overflow: hidden; pointer-events: none; z-index: -1; }   /* along the top edge, behind the buttons */
.nge-holiday-wire { position: absolute; left: 0; top: 0; }
.nge-holiday-wire path { fill: none; stroke: #1f5a3a; stroke-width: 1.6; }
/* a bulb: a small glass drop on a dark cap, hung from the low point of its swag */
.nge-holiday-bulb {
  position: absolute; top: 6px; width: 7px; height: 10px; margin-left: -3.5px;
  border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%; transform-origin: 50% -2px;
  background: radial-gradient(circle at 40% 35%, #fff 0 12%, var(--c) 45%, color-mix(in srgb, var(--c) 70%, #000) 100%);
  box-shadow: 0 0 6px 1px var(--c), 0 0 14px 2px color-mix(in srgb, var(--c) 45%, transparent);
  animation: nge-holiday-twinkle ease-in-out infinite;
}
.nge-holiday-bulb::before { content: ''; position: absolute; left: 1px; top: -3px; width: 5px; height: 3px; border-radius: 1px; background: #2c3a32; }
@keyframes nge-holiday-twinkle {
  0%, 100% { opacity: 1; filter: brightness(1.15); }
  50% { opacity: 0.45; filter: brightness(0.7); box-shadow: 0 0 2px 0 var(--c); }
}
@media (prefers-reduced-motion: reduce) { .nge-holiday-bulb { animation: none; } }
:global(body.nge-calm .nge-holiday-bulb) { animation: none; }
</style>
