<script setup lang="ts">
/**
 * A string of colored holiday lights along the top bar (Ames 2026-11-24:
 * "maybe we could start with a string of colored lights along the top bar").
 * From 1 December to New Year's Day (src/util/season.ts holidaySeason), the
 * wire swags along the bar's top edge and the bulbs hang in the gaps between
 * its buttons, never over one,
 * glowing softly up and down, each at its own slow pace. It never takes a click. Settings > Holiday lights turns
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
/** Where the top bar's buttons are, left and right edges in px: no bulb hangs
 *  over one, so the icons stay clear (Ames 2026-11-27: "it looks kind of busy
 *  up here, especially with the lights overlapping with the icons"). */
const busy = ref<[number, number][]>([]);
const root = ref<HTMLElement | null>(null);
/** Nothing hangs until the buttons have been found, so no swag crosses one. */
const measured = ref(false);
function measure() {
  width.value = window.innerWidth;
  const bar = root.value?.parentElement;
  if (!bar) return;
  const { top, left } = bar.getBoundingClientRect();
  const spans: [number, number][] = [];
  for (const el of Array.from(bar.querySelectorAll<HTMLElement>('button, a, [role="button"], img, svg'))) {
    if (root.value?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.top - top > 40) continue;   // only the bar's top row
    spans.push([r.left - left - 7, r.right - left + 7]);
  }
  busy.value = spans;
  measured.value = true;
}
let every: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  window.addEventListener('resize', measure);
  setTimeout(measure, 500);
  every = setInterval(measure, 5000);   // buttons come and go (sign in, a new badge)
});
onUnmounted(() => { window.removeEventListener('resize', measure); if (every) clearInterval(every); });

/** The garland: one swag in each gap between the bar's buttons, hung from
 *  button to button and dipping lower the wider the gap (Ames 2026-11-27:
 *  "we like swag"). Nothing hangs over a button. */
const swags = computed(() => {
  const spans = [...busy.value].sort((a, b) => a[0] - b[0]);
  const out: { l: number; r: number; dip: number }[] = [];
  let x = 0;
  for (const [l, r] of [...spans, [width.value + 1, width.value + 1] as [number, number]]) {
    if (l - x >= 36) out.push({ l: x, r: Math.min(l, width.value), dip: Math.min(24, 5 + (l - x) * 0.07) });
    x = Math.max(x, r);
  }
  return out;
});
const wire = computed(() => swags.value.map(g => `M${g.l} 1 Q${(g.l + g.r) / 2} ${1 + 2 * g.dip} ${g.r} 1`).join(' '));
/** Bulbs along each swag, about every SPAN px, hanging from the wire. */
const bulbs = computed(() => {
  const out: { x: number; y: number; color: string; delay: string; dur: string; tilt: number }[] = [];
  let i = 0;
  for (const g of swags.value) {
    const k = Math.max(1, Math.round((g.r - g.l) / SPAN));
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k;
      const x = g.l + (g.r - g.l) * t, y = 1 + 2 * g.dip * 2 * t * (1 - t);   // on the quadratic
      out.push({
        x, y, color: COLORS[i % COLORS.length],
        // slow and soft (Ames 2026-11-27: "less twinkling, more gentle"), each its own pace
        delay: -((i * 1.7) % 9).toFixed(2) + 's',
        dur: (6 + ((i * 7) % 5) * 0.8).toFixed(2) + 's',
        tilt: Math.round((1 - 2 * t) * -14 + ((i * 13) % 7) - 3),   // leaning with the wire
      });
      i++;
    }
  }
  return out;
});
</script>

<template>
  <div v-if="on" ref="root" class="nge-holiday-lights" aria-hidden="true">
    <svg v-if="measured" class="nge-holiday-wire" :width="width" height="48" :viewBox="`0 0 ${width} 48`">
      <path :d="wire" />
    </svg>
    <span v-for="b in (measured ? bulbs : [])" :key="b.x" class="nge-holiday-bulb"
          :style="{ left: b.x + 'px', top: (b.y + 3) + 'px', '--c': b.color, animationDelay: b.delay, animationDuration: b.dur, rotate: b.tilt + 'deg' }"></span>
  </div>
</template>

<style scoped>
.nge-holiday-lights { position: absolute; left: 0; right: 0; top: 0; height: 48px; overflow: hidden; pointer-events: none; z-index: -1; }   /* along the top edge, behind the buttons */
.nge-holiday-wire { position: absolute; left: 0; top: 0; }
.nge-holiday-wire path { fill: none; stroke: #1f5a3a; stroke-width: 1.6; }
/* a bulb: a small glass drop on a dark cap, hung from the low point of its swag */
.nge-holiday-bulb {
  position: absolute; width: 7px; height: 10px; margin-left: -3.5px;
  border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%; transform-origin: 50% -2px;
  background: radial-gradient(circle at 40% 35%, #fff 0 12%, var(--c) 45%, color-mix(in srgb, var(--c) 70%, #000) 100%);
  box-shadow: 0 0 6px 1px var(--c), 0 0 14px 2px color-mix(in srgb, var(--c) 45%, transparent);
  animation: nge-holiday-twinkle ease-in-out infinite;
}
.nge-holiday-bulb::before { content: ''; position: absolute; left: 1px; top: -3px; width: 5px; height: 3px; border-radius: 1px; background: #2c3a32; }
@keyframes nge-holiday-twinkle {
  0%, 100% { opacity: 1; filter: brightness(1.15); }
  50% { opacity: 0.78; filter: brightness(0.9); }
}
@media (prefers-reduced-motion: reduce) { .nge-holiday-bulb { animation: none; } }
:global(body.nge-calm .nge-holiday-bulb) { animation: none; }
</style>
