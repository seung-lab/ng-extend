<script setup lang="ts">
/**
 * MecMarkStatus: how far the lab's marks are on the MEC cell in view, before
 * it is completed (Ames 2026-10-24: "some way to see cell status overview in
 * here prior to players hitting submit? like maybe click to expand to see #
 * annotations"). One line under the working claim in the Cell Library, which
 * opens into a checklist; open from the start in the Complete form. Counts
 * every point in the lab's layers, placed with Highlight or by hand.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { MEC_KINDS, MEC_SOMA, mecCounts, somaState } from '../util/mec_marks';

const props = defineProps<{ startOpen?: boolean }>();
const open = ref(!!props.startOpen);
const counts = ref<Record<string, number>>(mecCounts());
const soma = ref(somaState());
const marks = MEC_KINDS.filter(k => k !== MEC_SOMA);

function read() { counts.value = mecCounts(); soma.value = somaState(); }
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(read, 1500); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });

const somaLine = () => soma.value.state === 'start' ? 'Confirmed at the starting point'
  : soma.value.state === 'moved' ? `Placed at ${soma.value.xyz!.join(', ')}` : 'Not confirmed yet. In Highlight: Soma, Confirm soma here.';
function markLine(key: string, n: number): string {
  if (key === 'mec:ais') return n ? `${n} placed` : 'None yet. Skip it if the cell has no distinct axon.';
  if (key === 'mec:edge') return n ? `${n} placed` : 'None yet. Find ends at the edge in Highlight can place them.';
  return n ? `${n} placed` : 'None yet';
}
</script>

<template>
  <div class="nge-mms" :class="{ 'nge-mms--open': open }">
    <button type="button" class="nge-mms-head" :aria-expanded="open ? 'true' : 'false'" @click="open = !open"
            :title="open ? 'Hide the marks' : 'Show the lab marks on this cell'">
      <svg class="nge-mms-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="nge-mms-title">Marks</span>
      <span class="nge-mms-chip" :style="{ '--k': MEC_SOMA.color }" :class="{ 'nge-mms-chip--none': soma.state === 'none' }">
        <i></i>Soma {{ soma.state === 'none' ? 'not yet' : '✓' }}
      </span>
      <span v-for="k in marks" :key="k.key" class="nge-mms-chip" :style="{ '--k': k.color }" :class="{ 'nge-mms-chip--none': !counts[k.key] }">
        <i></i>{{ k.label }} {{ counts[k.key] ?? 0 }}
      </span>
    </button>
    <ul v-if="open" class="nge-mms-list">
      <li :style="{ '--k': MEC_SOMA.color }"><i></i><b>Soma</b><span>{{ somaLine() }}</span></li>
      <li v-for="k in marks" :key="k.key" :style="{ '--k': k.color }"><i></i><b>{{ k.label }}</b><span>{{ markLine(k.key, counts[k.key] ?? 0) }}</span></li>
      <li class="nge-mms-foot">The lab's sheet gets these counts when you complete the cell.</li>
    </ul>
  </div>
</template>

<style scoped>
.nge-mms { margin: 0; padding: 4px 12px 6px 28px; font: 11.5px/1.35 'Inter', 'Segoe UI', sans-serif; color: rgba(220, 230, 245, 0.75); }
.nge-mms-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; width: 100%; padding: 3px 0; border: 0; background: none;
  cursor: pointer; text-align: left; font: inherit; color: inherit;
}
.nge-mms-head:hover .nge-mms-title { color: #fff; }
.nge-mms-head:focus-visible { outline: 1px solid rgba(127, 212, 255, 0.8); outline-offset: 2px; border-radius: 4px; }
.nge-mms-caret { flex-shrink: 0; color: rgba(200, 220, 240, 0.6); transition: transform 0.15s ease; }
.nge-mms--open .nge-mms-caret { transform: rotate(90deg); }
.nge-mms-title { font-weight: 600; color: rgba(220, 230, 245, 0.9); }
.nge-mms-chip { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.nge-mms-chip i, .nge-mms-list i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--k); flex-shrink: 0; }
.nge-mms-chip--none { color: rgba(200, 212, 228, 0.42); }
.nge-mms-chip--none i { background: transparent; box-shadow: inset 0 0 0 1.5px var(--k); }
.nge-mms-list { list-style: none; margin: 4px 0 2px; padding: 6px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); }
.nge-mms-list li { display: grid; grid-template-columns: 10px 72px 1fr; align-items: baseline; gap: 6px; padding: 2px 0; }
.nge-mms-list b { font-weight: 600; color: rgba(230, 238, 250, 0.92); }
.nge-mms-list li.nge-mms-foot { display: block; margin-top: 4px; font-size: 11px; color: rgba(200, 212, 228, 0.5); }
@media (prefers-reduced-motion: reduce) { .nge-mms-caret { transition: none; } }
</style>
