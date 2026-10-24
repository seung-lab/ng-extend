<script setup lang="ts">
/**
 * RetinaCastTab.vue
 * The Meet the cells tab of the Cell Library (called the Cast at first), Retina only (Ames 2026-10-24): one
 * proofread example of each retinal cell type, most common first, with the
 * class to filter by and a search. Clicking a type shows its cell alone in
 * 3D (src/retina_cast.ts); Previous and Next step through the list as it is
 * filtered, like the pages of the film "The cast of the retina".
 */
import { computed, ref } from 'vue';
import thumbsUrl from '../images/retina-cast-thumbs.png';
import { CAST_THUMB_COLS } from '../data/retina-cast';
import { CAST, CAST_CLASSES, castClass, castState, castColors, showCastType, showCastGroup, setCastView, toggleSpin, backToMyView, type CastType } from '../retina_cast';

const cls = ref<string>('');
const query = ref('');

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return CAST.filter(t => (!cls.value || t.cls === cls.value) && (!q || t.type.toLowerCase().includes(q)));
});
const countOf = (key: string) => CAST.filter(t => t.cls === key).length;

const place = computed(() => castState.current ? shown.value.indexOf(castState.current) : -1);
function step(d: number) {
  const list = shown.value;
  if (!list.length) return;
  const i = place.value < 0 ? (d > 0 ? 0 : list.length - 1) : (place.value + d + list.length) % list.length;
  void showCastType(list[i]);
}

const THUMB = 44;
function thumbStyle(t: CastType, px = THUMB) {
  const col = t.thumb % CAST_THUMB_COLS, row = Math.floor(t.thumb / CAST_THUMB_COLS);
  return {
    width: px + 'px', height: px + 'px',
    backgroundImage: `url(${thumbsUrl})`,
    backgroundSize: `${CAST_THUMB_COLS * px}px auto`,
    backgroundPosition: `-${col * px}px -${row * px}px`,
  };
}
const fmt = (n: number) => n.toLocaleString('en-US');

/** "Show all together" shows what the class filter picks: every type, or one
 *  class (Ames 2026-10-24: "I would like to be able to see all at once"). */
const groupKey = computed(() => cls.value || 'all');
const groupLabel = computed(() => cls.value
  ? `Show all ${countOf(cls.value)} ${castClass(cls.value).group} together`
  : `Show all ${CAST.length} together`);
const groupClass = computed(() => castState.group && castState.group !== 'all' ? castClass(castState.group) : null);
const groupSize = computed(() => castState.group === 'all' ? CAST.length : castState.group ? countOf(castState.group) : 0);
</script>

<template>
  <div class="nge-cast">
    <div class="nge-cast-head">
      <div class="nge-cast-title">Meet the cells</div>
      <div class="nge-cast-lead">{{ CAST.length }} retinal cell types that have been identified in the Eyewire II dataset.</div>
    </div>

    <div v-if="castState.current || castState.group || castState.saved || castState.loading || castState.error" class="nge-cast-now">
      <template v-if="castState.group">
        <div class="nge-cast-now-name">{{ groupClass ? `All ${groupSize} ${groupClass.group}` : `All ${groupSize} types` }} together</div>
        <div v-if="groupClass" class="nge-cast-about">{{ groupClass.about }}</div>
        <div v-else class="nge-cast-classes">
          <div v-for="c in CAST_CLASSES" :key="c.key" class="nge-cast-about">
            <b :style="{ color: c.color }">{{ c.plural }}.</b> {{ c.about }}
          </div>
        </div>
      </template>
      <div v-if="castState.current" class="nge-cast-now-row">
        <span class="nge-cast-thumb nge-cast-thumb--big" :style="thumbStyle(castState.current, 64)"></span>
        <div class="nge-cast-now-text">
          <div class="nge-cast-now-name">{{ castState.current.type }}</div>
          <div class="nge-cast-now-meta">
            <span :style="{ color: castClass(castState.current.cls).color }">{{ castClass(castState.current.cls).name }}</span>
            <span v-if="place >= 0">, {{ place + 1 }} of {{ shown.length }}</span>
          </div>
          <div class="nge-cast-now-count">{{ fmt(castState.current.n) }} proofread cells carry this label.</div>
        </div>
      </div>
      <div v-if="castState.current" class="nge-cast-about">{{ castClass(castState.current.cls).about }}</div>
      <div v-if="castState.loading" class="nge-cast-note">{{ castState.group || !castState.current ? `Finding the cells, ${castState.found} so far...` : 'Finding the cell...' }}</div>
      <div v-if="castState.error" class="nge-cast-note nge-cast-note--err">{{ castState.error }}</div>
      <div class="nge-cast-controls">
        <button class="nge-cast-btn" @click="step(-1)" title="The type before this one in the list">&lsaquo; Previous</button>
        <button class="nge-cast-btn" @click="step(1)" title="The next type in the list">Next &rsaquo;</button>
        <template v-if="castState.current || castState.group">
          <button class="nge-cast-btn" :class="{ 'nge-cast-on': castState.view === 'top' }" @click="setCastView('top')" title="Look down on the retina">Top</button>
          <button class="nge-cast-btn" :class="{ 'nge-cast-on': castState.view === 'side' }" @click="setCastView('side')" title="Look at the retina from the side">Side</button>
          <button class="nge-cast-btn" :class="{ 'nge-cast-on': castState.spinning }" @click="toggleSpin()" title="Turn the cell slowly. Drag the cell to stop.">{{ castState.spinning ? 'Stop' : 'Spin' }}</button>
        </template>
        <button v-if="castState.saved" class="nge-cast-btn nge-cast-back" @click="backToMyView()" title="Put back the view you had before the cast, with your layers">Back to my view</button>
      </div>
      <div v-if="castState.current" class="nge-cast-note">Drag the cell to turn it. Scroll to zoom.</div>
    </div>

    <div class="nge-cast-filters">
      <button class="nge-cast-chip" :class="{ 'nge-cast-chip--on': !cls }" @click="cls = ''">All {{ CAST.length }}</button>
      <button v-for="c in CAST_CLASSES" :key="c.key" class="nge-cast-chip" :class="{ 'nge-cast-chip--on': cls === c.key }"
              :style="{ '--chip': c.color }" @click="cls = cls === c.key ? '' : c.key">{{ c.plural }} {{ countOf(c.key) }}</button>
    </div>
    <button class="nge-cast-btn nge-cast-all" :class="{ 'nge-cast-on': castState.group === groupKey }" @click="showCastGroup(groupKey)"
            title="Every example cell at once, each where it sits in the retina">{{ groupLabel }}</button>
    <input v-model="query" class="nge-cast-search" type="search" placeholder="Find a type, like ON alpha" aria-label="Find a cell type" />

    <div class="nge-cast-list">
      <button v-for="t in shown" :key="t.sv" class="nge-cast-row" :class="{ 'nge-cast-row--on': castState.current === t }"
              @click="showCastType(t)" :title="`Show the ${t.type} example alone in 3D`">
        <span class="nge-cast-thumb" :style="thumbStyle(t)"></span>
        <span class="nge-cast-row-text">
          <span class="nge-cast-row-name"><span v-if="castColors[t.sv] && castState.group" class="nge-cast-dot" :style="{ background: castColors[t.sv] }"></span>{{ t.type }}</span>
          <span class="nge-cast-row-cls" :style="{ color: castClass(t.cls).color }">{{ castClass(t.cls).name }}</span>
        </span>
        <span class="nge-cast-row-n" :title="`${fmt(t.n)} proofread cells carry this label`">{{ fmt(t.n) }}</span>
      </button>
      <div v-if="!shown.length" class="nge-cast-note nge-cast-empty">No type matches "{{ query }}".</div>
    </div>
  </div>
</template>

<style scoped>
/* In the Cell Library's own colors and sizes (see AnnotationQuestsTab). */
.nge-cast { display: flex; flex-direction: column; }
.nge-cast-head { padding: 10px 12px 8px; display: flex; flex-direction: column; gap: 5px; }
.nge-cast-title { font-family: 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; font-size: 14px; font-weight: 700; color: #eef; text-transform: uppercase; }
.nge-cast-lead { font-size: 14px; line-height: 1.5; color: #b3c0d3; }

.nge-cast-now { margin: 2px 10px 8px; padding: 10px 12px; border-radius: 10px; background: rgba(66, 213, 236, 0.06); border: 1px solid rgba(66, 213, 236, 0.28); display: flex; flex-direction: column; gap: 8px; }
.nge-cast-now-row { display: flex; align-items: center; gap: 12px; }
.nge-cast-now-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nge-cast-now-name { font-size: 17px; font-weight: 700; color: #fff; overflow-wrap: anywhere; }
.nge-cast-now-meta { font-size: 13px; color: #a9b8cc; }
.nge-cast-now-count { font-size: 13px; color: #cfdcef; }
.nge-cast-controls { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-cast-btn {
  padding: 5px 11px; border: 1px solid rgba(120, 140, 255, 0.25); border-radius: 5px;
  background: transparent; color: #8bf; font: 600 13px 'Inter', sans-serif;
  cursor: pointer; white-space: nowrap; transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.nge-cast-btn:hover { background: rgba(74, 158, 255, 0.1); border-color: rgba(126, 202, 255, 0.5); }
.nge-cast-on { background: rgba(74, 158, 255, 0.18); border-color: rgba(126, 202, 255, 0.6); color: #eaf6ff; }
.nge-cast-back { color: #a6ffd6; border-color: rgba(166, 255, 214, 0.35); }
.nge-cast-back:hover { background: rgba(166, 255, 214, 0.1); border-color: rgba(166, 255, 214, 0.6); }
.nge-cast-all { margin: 0 12px 8px; align-self: flex-start; }
.nge-cast-about { font-size: 13px; line-height: 1.5; color: #cfdcef; }
.nge-cast-about b { font-weight: 700; }
.nge-cast-classes { display: flex; flex-direction: column; gap: 6px; }
.nge-cast-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.nge-cast-note { font-size: 13px; color: #93a0b6; line-height: 1.4; }
.nge-cast-note--err { color: #ff9b9b; }

.nge-cast-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 12px 8px; }
.nge-cast-chip { --chip: #7ecaff; padding: 3px 10px; border-radius: 999px; font: 600 12.5px/1.4 'Inter', sans-serif; color: #b3c0d3; background: transparent; border: 1px solid rgba(120, 140, 255, 0.2); cursor: pointer; }
.nge-cast-chip:hover { color: #eef; border-color: var(--chip); }
.nge-cast-chip--on { color: #06111f; background: var(--chip); border-color: var(--chip); }
.nge-cast-search { margin: 0 12px 6px; height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid rgba(120, 140, 255, 0.2); background: rgba(10, 16, 30, 0.6); color: #eef; font: 13px 'Inter', sans-serif; }
.nge-cast-search:focus { outline: none; border-color: rgba(126, 202, 255, 0.6); }

.nge-cast-list { display: flex; flex-direction: column; padding: 0 6px 8px; }
.nge-cast-row { display: flex; align-items: center; gap: 10px; padding: 4px 6px; border-radius: 6px; background: transparent; border: 1px solid transparent; color: inherit; cursor: pointer; text-align: left; font: inherit; }
.nge-cast-row:hover { background: rgba(74, 158, 255, 0.08); }
.nge-cast-row--on { background: rgba(74, 158, 255, 0.14); border-color: rgba(126, 202, 255, 0.35); }
.nge-cast-thumb { flex: none; border-radius: 6px; background-color: rgba(6, 10, 20, 0.7); background-repeat: no-repeat; }
.nge-cast-thumb--big { border-radius: 8px; }
.nge-cast-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.nge-cast-row-name { font-size: 14px; color: #eef; overflow-wrap: anywhere; }
.nge-cast-row-cls { font-size: 12px; }
.nge-cast-row-n { flex: none; font-size: 13px; color: #a9b8cc; font-variant-numeric: tabular-nums; }
.nge-cast-empty { padding: 8px 8px; }
</style>
