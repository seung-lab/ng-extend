<script setup lang="ts">
/**
 * Time on Quests and Super Quests (Nseraf, report 525; Ames: "good idea"):
 * today, this week, this month and all time, by Pyr's awards calendar (US
 * Eastern days, weeks Monday to Sunday, months from the 1st).
 *
 * The time is the active time Pyr already counts on each claim
 * (util/claim_time.ts): a cell on screen, Pyr in front, real work in the last
 * 5 minutes. Only the signed-in player's own, so the parent shows this on
 * their own profile only. Nothing new is read: it reuses the timer's totals,
 * read at most once every 15 minutes.
 *
 * Shows nothing until there is some time to show.
 */
import { computed, onMounted } from 'vue';
import { claimTime, ensureClaimTimes, questTimeLabel, questTimeSplit, type QuestTimeSplit } from '../util/claim_time';

const props = defineProps<{ dataset?: string; label?: string }>();

onMounted(() => { void ensureClaimTimes(); });

const split = computed(() => {
  // Touch the reactive parts so the table follows the timer each second.
  void claimTime.loaded; void claimTime.running;
  return questTimeSplit(props.dataset);
});
const PERIODS: { key: keyof QuestTimeSplit; label: string; title: string }[] = [
  { key: 'today', label: 'Today', title: 'Today, US Eastern time' },
  { key: 'week', label: 'This week', title: 'Since Monday, US Eastern time, the same week as the weekly awards' },
  { key: 'month', label: 'This month', title: 'Since the 1st of the month, US Eastern time' },
  { key: 'all', label: 'All time', title: 'Every second Pyr has counted on your Quests' },
];
const cols = computed(() => [
  { key: 'quest', name: 'Quests', t: split.value.quest },
  { key: 'super', name: 'Super Quests', t: split.value.superQuest },
].filter(c => c.t.all >= 60));
</script>

<template>
  <div v-if="cols.length" class="nge-qtt">
    <div v-if="props.label" class="nge-qtt-label">▌ {{ props.label }}</div>
    <div class="nge-qtt-grid" :style="{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, max-content))` }" role="table" aria-label="Active time on Quests">
      <div class="nge-qtt-corner" role="columnheader"></div>
      <div v-for="c in cols" :key="c.key" class="nge-qtt-head" role="columnheader">{{ c.name }}</div>
      <template v-for="p in PERIODS" :key="p.key">
        <div class="nge-qtt-name" role="rowheader" :title="p.title">{{ p.label }}</div>
        <div v-for="c in cols" :key="c.key" class="nge-qtt-val" :class="{ 'nge-qtt-val--zero': c.t[p.key] < 60, 'nge-qtt-val--all': p.key === 'all' }" role="cell">{{ questTimeLabel(c.t[p.key]) }}</div>
      </template>
    </div>
    <div class="nge-qtt-foot">Active time: the cell on screen, Pyr in front, and work on it in the last 5 minutes.</div>
  </div>
</template>

<style scoped>
.nge-qtt-label {
  font-size: 0.78em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.13em;
  color: rgba(255, 195, 110, 0.95); margin-bottom: 10px;
}
.nge-qtt-grid {
  display: grid; column-gap: 28px; row-gap: 6px; align-items: baseline;
}
.nge-qtt-head {
  font-size: 0.72em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: #9bb; text-align: right; white-space: nowrap;
}
.nge-qtt-name { font-size: 0.86em; color: #b4c3d6; white-space: nowrap; cursor: help; }
.nge-qtt-val {
  text-align: right; white-space: nowrap; font-size: 0.9em; font-weight: 700;
  font-variant-numeric: tabular-nums; font-family: ui-monospace, 'Cascadia Code', monospace;
  color: #ffd08a;
}
.nge-qtt-val--zero { color: rgba(220, 230, 245, 0.35); font-weight: 600; }
.nge-qtt-val--all:not(.nge-qtt-val--zero) { color: #ffe2b0; }
.nge-qtt-foot { margin-top: 8px; font-size: 11px; line-height: 1.4; color: rgba(220, 230, 245, 0.55); }
</style>
