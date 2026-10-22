<script setup lang="ts">
/**
 * TestReviewBar: an admin looking at one Proofreading Test try in the view
 * (Ames, 2026-10-21). Behind it is the test cell as the player left it, with
 * their points (pink gems), what they missed (gold), damage (red) and, off
 * at first, what they fixed (green). Each item here flies to its place.
 * See src/proofreading-test-review.ts.
 */
import { ref, computed } from 'vue';
import { reviewingTry, reviewProblem, tryParts, outcomeWord, playerName, backToTries, endTryReview, heatColors, pointsByEnd, RIGHT } from '../proofreading-test-review';
import { flyTo } from '../access_request';
import { useDragBox } from '../util/drag_box';

const boxEl = ref<HTMLElement | null>(null);
const { dragging, posStyle, startDrag } = useDragBox('nge_test_review_pos', boxEl);
const t = computed(() => reviewingTry.value);
const parts = computed(() => (t.value ? tryParts(t.value) : null));
const open = ref<Record<string, boolean>>({ damage: true, missed: true });
const n = (v: number) => v.toLocaleString('en-US');
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const SECTIONS = [
  { key: 'damage', title: 'Real branches cut off', dot: 'red' },
  { key: 'missed', title: 'Mistakes missed', dot: 'red' },
  { key: 'endsMissed', title: 'Branch ends not marked', dot: 'red' },
  { key: 'fixed', title: 'Mistakes fixed', dot: 'green' },
] as const;
const has = (p: any[] | undefined) => !!p && p.length > 0;
/** How much of the heat map this try has: pieces colored, points split. */
const heat = computed(() => (t.value ? Object.values(heatColors(t.value)) : []));
const pts = computed(() => (t.value ? pointsByEnd(t.value) : { onEnd: [], offEnd: [] }));
</script>

<template>
  <div v-if="t && parts" ref="boxEl" class="nge-trv" :class="{ 'nge-trv--dragging': dragging }" :style="posStyle" role="dialog" aria-label="A Proofreading Test try">
    <div class="nge-trv-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-trv-title">{{ playerName(t) }}</span>
      <span class="nge-trv-pos">{{ when(t.started_at) }}</span>
    </div>
    <p class="nge-trv-line">
      <b>{{ outcomeWord(t) }}</b><template v-if="t.percent != null"> · {{ t.percent }} percent</template><template v-if="t.timed_out"> · time ran out</template>
    </p>
    <p v-if="reviewProblem" class="nge-trv-err" role="alert">{{ reviewProblem }}</p>
    <p class="nge-trv-how">Their cell as they left it, see-through<template v-if="heat.length">, with every scored piece in color</template>.</p>
    <div class="nge-trv-legend">
      <span><span class="nge-trv-key nge-trv-key--green"></span>right<template v-if="heat.length"> ({{ heat.filter(c => c === RIGHT).length }} pieces)</template></span>
      <span><span class="nge-trv-key nge-trv-key--red"></span>wrong<template v-if="heat.length"> ({{ heat.filter(c => c !== RIGHT).length }} pieces)</template></span>
    </div>
    <p v-if="t.given.length" class="nge-trv-how">Their points: {{ pts.onEnd.length }} on an end (green gems), {{ pts.offEnd.length }} near no end (red gems). Red pins mark what they missed.</p>
    <p v-else class="nge-trv-how">They placed no points. Red pins mark what they missed.</p>
    <p v-if="!heat.length && t.outcome !== 'expired'" class="nge-trv-how">This try has no pieces to color: it was scored before the heat map.</p>
    <p v-if="t.outcome === 'expired'" class="nge-trv-how">They left without submitting: no score, and their branch end points never reached the server.</p>

    <template v-for="s in SECTIONS" :key="s.key">
      <div v-if="has(parts[s.key])" class="nge-trv-sec">
        <button class="nge-trv-sec-head" :aria-expanded="!!open[s.key]" @click="open[s.key] = !open[s.key]">
          <span class="nge-trv-dot" :class="`nge-trv-dot--${s.dot}`"></span>{{ s.title }} ({{ parts[s.key].length }}) <span class="nge-trv-caret">{{ open[s.key] ? '▴' : '▾' }}</span>
        </button>
        <div v-if="open[s.key]" class="nge-trv-list">
          <button v-for="(c, i) in parts[s.key]" :key="i" class="nge-trv-fly" :disabled="!c.point" title="Fly there" @click="flyTo(c.point)">
            {{ c.label }}<span v-if="c.kind === 'cut' || c.kind === 'merge'" class="nge-trv-worth">{{ n(c.weight) }}</span>
          </button>
        </div>
      </div>
    </template>

    <div class="nge-trv-nav">
      <button class="nge-trv-btn" title="Close this panel; their cell stays on screen" @click="endTryReview()">Close</button>
      <button class="nge-trv-btn nge-trv-btn--list" @click="backToTries()">Back to the tries</button>
    </div>
  </div>
</template>

<style scoped>
.nge-trv {
  position: fixed; right: 16px; top: 64px; z-index: 9000;
  width: 360px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(159, 211, 255, 0.45);
  border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 15px;
}
.nge-trv-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 0; padding: 12px 14px 4px; }
.nge-trv--dragging .nge-trv-head { cursor: grabbing; }
.nge-trv-title { font-size: 17px; font-weight: 600; color: #9fd3ff; }
.nge-trv-pos { margin-left: auto; color: rgba(220, 230, 245, 0.7); }
.nge-trv-line { margin: 4px 0; }
.nge-trv-how { margin: 6px 0; line-height: 1.45; color: rgba(220, 230, 245, 0.75); }
.nge-trv-key { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 4px 0 2px; vertical-align: 0; }
.nge-trv-key--red { background: #e06060; }
.nge-trv-key--green { background: #7CFFB2; }
.nge-trv-err { margin: 6px 0; color: #f5d142; overflow-wrap: anywhere; }
.nge-trv-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0 0 6px; font-size: 14px; color: rgba(220, 230, 245, 0.85); }
.nge-trv-sec { border-top: 1px solid rgba(255, 255, 255, 0.1); margin-top: 8px; padding-top: 6px; }
.nge-trv-sec-head { display: flex; align-items: center; gap: 6px; width: 100%; font: inherit; font-weight: 600; color: #dce6f5; background: none; border: none; padding: 2px 0; cursor: pointer; text-align: left; }
.nge-trv-caret { margin-left: auto; color: rgba(220, 230, 245, 0.6); }
.nge-trv-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.nge-trv-dot--red { background: #e06060; }
.nge-trv-dot--green { background: #7CFFB2; }
.nge-trv-list { display: flex; flex-direction: column; margin: 4px 0 0 15px; }
.nge-trv-fly { display: flex; gap: 8px; font: inherit; font-size: 14px; color: #dce6f5; background: none; border: none; cursor: pointer; text-align: left; padding: 2px 0; }
.nge-trv-fly:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
.nge-trv-fly:disabled { opacity: 0.55; cursor: default; }
.nge-trv-worth { margin-left: auto; color: rgba(220, 230, 245, 0.6); font-variant-numeric: tabular-nums; }
.nge-trv-nav { display: flex; gap: 6px; margin-top: 12px; }
.nge-trv-btn { font: inherit; font-size: 14px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #dce6f5; cursor: pointer; }
.nge-trv-btn--list { margin-left: auto; border-color: #9fd3ff; }
</style>
