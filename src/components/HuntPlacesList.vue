<script setup lang="ts">
/**
 * The places of a Hunt made from a proofread cell, as they are on screen now
 * (a point moved, deleted or added in the viewer shows here too). Click a
 * place to go there; the x takes it out. Shown in the Hunt editor
 * (HuntFromEdits.vue) and in the box over the viewer (HuntPlacesBox.vue).
 */
import { computed, onUnmounted, ref } from 'vue';
import { fromEdits, placeRows, removePlace, goToPlace, type PlaceRow } from '../util/hunt_from_edits';

const rows = ref<PlaceRow[]>(placeRows());
const timer = setInterval(() => { rows.value = placeRows(); }, 1000);
onUnmounted(() => clearInterval(timer));

const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const cuts = computed(() => rows.value.filter(r => r.kind === 'cut').length);
function go(r: PlaceRow) { fromEdits.selected = r.id; goToPlace(r.at); }
function drop(r: PlaceRow) { removePlace(r.kind, r.ids); rows.value = placeRows(); }
</script>

<template>
  <div class="nge-hpl">
    <div class="nge-hpl-label">
      <span>Places, x y z as the coordinate bar shows them</span>
      <span>{{ cuts }} cut, {{ rows.length - cuts }} extend</span>
    </div>
    <p v-if="!rows.length" class="nge-hpl-muted">No places on screen yet.</p>
    <ul class="nge-hpl-list">
      <li v-for="r in rows" :key="r.id" class="nge-hpl-place" :class="{ 'nge-hpl-place--on': r.id === fromEdits.selected }"
          tabindex="0" title="Go there" @click="go(r)" @keydown.enter="go(r)">
        <span class="nge-hpl-dot" :class="`nge-hpl-dot--${r.kind}`">{{ r.n ?? '+' }}</span>
        <span class="nge-hpl-body">
          <span class="nge-hpl-xyz">{{ r.at.join(', ') }}</span>
          <span v-if="r.place" class="nge-hpl-sub">{{ r.kind === 'cut' ? 'Cut' : 'Joined' }} {{ day(r.place.at) }}<template v-if="r.place.user"> by {{ r.place.user }}</template></span>
          <span v-else class="nge-hpl-sub">Added by you</span>
          <span v-if="r.ids.length > 1" class="nge-hpl-sub" :title="`A gem anywhere on the piece cut off finds this merger (${r.ids.length} points along it)`">Anywhere on the piece cut off ({{ r.ids.length }} points)</span>
          <span v-if="r.place?.wide" class="nge-hpl-warn">The cut's points were far apart: check where the merger is.</span>
        </span>
        <button type="button" class="nge-hpl-x" aria-label="Take this place out" title="Take this place out" @click.stop="drop(r)">×</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.nge-hpl { display: flex; flex-direction: column; gap: 4px; }
.nge-hpl-label { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; color: #8fa3bf; font-size: 11.5px; }
.nge-hpl-label span:last-child { white-space: nowrap; }
.nge-hpl-muted { margin: 0; color: #8fa3bf; font-size: 12.5px; }
.nge-hpl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nge-hpl-place { display: grid; grid-template-columns: 22px 1fr 22px; gap: 8px; align-items: center; padding: 5px 4px; border-top: 1px solid rgba(90, 170, 255, 0.12); cursor: pointer; }
.nge-hpl-place:hover, .nge-hpl-place:focus-visible { background: rgba(90, 170, 255, 0.08); outline: none; }
.nge-hpl-place--on { background: rgba(245, 209, 66, 0.12); box-shadow: inset 3px 0 0 #f5d142; }
.nge-hpl-dot { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 600 11px 'Inter', sans-serif; }
.nge-hpl-dot--cut { background: #f5d142; color: #3a2f05; }
.nge-hpl-dot--merge { background: #9b5cff; color: #ffffff; }
.nge-hpl-body { display: flex; flex-direction: column; min-width: 0; }
.nge-hpl-xyz { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #e6f0ff; }
.nge-hpl-sub { color: #8fa3bf; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-hpl-warn { color: #f8e08a; font-size: 12px; }
.nge-hpl-x { background: none; border: none; color: #8fa3bf; font-size: 16px; line-height: 1; cursor: pointer; padding: 0; }
.nge-hpl-x:hover, .nge-hpl-x:focus-visible { color: #ffb3b3; }
</style>
