<script setup lang="ts">
/**
 * DatasetSelectorPanel — lets users switch between known datasets at runtime.
 * Displays as a compact centred hologram panel with dataset cards.
 * Switching loads new neuroglancer layers + updates CAVE config automatically.
 */
import { ref, computed, onMounted } from 'vue';
import { DATASETS, DATASET_GROUPS, switchToDataset, currentSegLayerName, findDatasetBySegName, findDatasetByCanonical, canonicalDataset, type DatasetEntry } from '../datasets';
import { runPanelTrace } from '../util/holo_trace';
import { startDatasetTransition } from '../util/dataset_transition';
import { loadDatasetPermissions, datasetAccess } from '../util/dataset_access';

const emit = defineEmits({ hide: null });
const panelEl = ref<HTMLElement | null>(null);

// Particle trace on arrival (scifi-ui): the beam runs the panel boundary once.
onMounted(() => {
  setTimeout(() => { if (panelEl.value) runPanelTrace(panelEl.value); }, 60);
});

// ── Current dataset detection ───────────────────────────────────────────────

const currentDatasetId = ref('');

function detectCurrentDataset() {
  try {
    // Exact match on the ACTIVE (visible, non-archived) seg layer name.
    // The old scan walked every managed layer with a fuzzy URL match, so an
    // archived layer from a previous dataset (or a URL merely containing
    // the id, like minnie65_phase3_v1 containing "minnie65") stamped the
    // Active badge on the wrong card.
    const name = currentSegLayerName();
    const exact = findDatasetBySegName(name);
    if (exact) { currentDatasetId.value = exact.id; return; }
    const canonEntry = findDatasetByCanonical(canonicalDataset(name));
    if (canonEntry) { currentDatasetId.value = canonEntry.id; return; }
  } catch {}
  currentDatasetId.value = '';
}

onMounted(detectCurrentDataset);

// ── Access (from CAVE): locked cards are greyed and do not switch ───────────
onMounted(() => { loadDatasetPermissions(); });
/** The dataset on screen is never shown locked, whatever the lookup says. */
const accessOf = (ds: DatasetEntry) => ds.id === currentDatasetId.value ? 'edit' : datasetAccess(ds.caveDataset);
const lockedTip = 'Your CAVE account does not have access to this dataset yet. Ask an EyeWire II admin to request it for you.';
const viewTip = 'You can look around here, but your CAVE account cannot save edits in this dataset.';

// ── Switch dataset ──────────────────────────────────────────────────────────

const switching = ref(false);

// ── Cards: single datasets, and one card per group (MICrONS) ──────────────
type Card = { kind: 'one'; ds: DatasetEntry } | { kind: 'group'; key: string; members: DatasetEntry[] };
const cards = computed<Card[]>(() => {
  const out: Card[] = [];
  const seen = new Set<string>();
  for (const ds of DATASETS) {
    if (ds.group && DATASET_GROUPS[ds.group]) {
      if (seen.has(ds.group)) continue;
      seen.add(ds.group);
      // A group lists every version, including ones hidden as their own card.
      out.push({ kind: 'group', key: ds.group, members: DATASETS.filter(d => d.group === ds.group) });
    } else if (!ds.hidden || ds.id === currentDatasetId.value) {
      out.push({ kind: 'one', ds });
    }
  }
  return out;
});
const openGroup = ref<string | null>(null);
const groupActive = (c: Card) => c.kind === 'group' && c.members.some(m => m.id === currentDatasetId.value);
function toggleGroup(key: string) { openGroup.value = openGroup.value === key ? null : key; }
onMounted(() => {
  // Open the group you are in, so its current version is visible.
  const here = DATASETS.find(d => d.id === currentDatasetId.value);
  if (here?.group) openGroup.value = here.group;
});

async function switchTo(ds: DatasetEntry) {
  if (ds.id === currentDatasetId.value) return;
  if (accessOf(ds) === 'none') return;
  // Close the switcher and play "Now entering" (it survives the reload a
  // curated dataset triggers). Let it paint before the switch blocks.
  startDatasetTransition(ds);
  emit('hide');
  await new Promise(r => setTimeout(r, 60));
  switching.value = true;
  const ok = await switchToDataset(ds);
  if (ok) currentDatasetId.value = ds.id;
  switching.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div ref="panelEl" class="nge-dataset-panel">
      <div class="nge-ds-header">
        <span class="nge-ds-title">Switch Dataset</span>
        <button class="nge-ds-close" @click="emit('hide')">×</button>
      </div>
      <div class="nge-ds-list">
        <template v-for="c in cards" :key="c.kind === 'group' ? 'g:' + c.key : c.ds.id">
        <div v-if="c.kind === 'group'" class="nge-ds-group" :class="{ 'nge-ds-group--open': openGroup === c.key }">
          <div
            class="nge-ds-card nge-ds-group-card"
            :class="{ 'nge-ds-active': groupActive(c) }"
            role="button"
            :aria-expanded="openGroup === c.key ? 'true' : 'false'"
            @click="toggleGroup(c.key)"
          >
            <img v-if="DATASET_GROUPS[c.key].thumbnail" :src="DATASET_GROUPS[c.key].thumbnail" class="nge-ds-card-thumb" alt="" loading="lazy" />
            <div class="nge-ds-card-text">
              <div class="nge-ds-card-label">{{ DATASET_GROUPS[c.key].label }}</div>
              <div class="nge-ds-card-desc">{{ DATASET_GROUPS[c.key].description }}</div>
            </div>
            <div v-if="groupActive(c)" class="nge-ds-badge">Active</div>
            <span class="nge-ds-versions">
              {{ c.members.length }} versions
              <svg class="nge-ds-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </div>
          <div v-if="openGroup === c.key" class="nge-ds-variants">
            <div
              v-for="ds in c.members"
              :key="ds.id"
              class="nge-ds-variant"
              :class="{
                'nge-ds-active': ds.id === currentDatasetId,
                'nge-ds-switching': switching,
                'nge-ds-locked': accessOf(ds) === 'none',
              }"
              :title="accessOf(ds) === 'none' ? lockedTip : accessOf(ds) === 'view' ? viewTip : undefined"
              :aria-disabled="accessOf(ds) === 'none' ? 'true' : undefined"
              @click="switchTo(ds)"
            >
              <div class="nge-ds-variant-text">
                <div class="nge-ds-variant-label">{{ ds.variantLabel || ds.label }}</div>
                <div class="nge-ds-card-desc">{{ ds.description }}</div>
              </div>
              <div v-if="ds.id === currentDatasetId" class="nge-ds-tag">Active</div>
              <div v-else-if="accessOf(ds) === 'none'" class="nge-ds-tag nge-ds-badge--locked"><span aria-hidden="true">🔒</span> No access</div>
              <div v-else-if="accessOf(ds) === 'view'" class="nge-ds-tag nge-ds-badge--view">View only</div>
            </div>
          </div>
        </div>
        <template v-else><div
          v-for="ds in [c.ds]"
          :key="ds.id"
          class="nge-ds-card"
          :class="{
            'nge-ds-active': ds.id === currentDatasetId,
            'nge-ds-switching': switching,
            'nge-ds-locked': accessOf(ds) === 'none',
          }"
          :title="accessOf(ds) === 'none' ? lockedTip : accessOf(ds) === 'view' ? viewTip : undefined"
          :aria-disabled="accessOf(ds) === 'none' ? 'true' : undefined"
          @click="switchTo(ds)"
        >
          <img v-if="ds.thumbnail" :src="ds.thumbnail" class="nge-ds-card-thumb" alt="" loading="lazy" />
          <div class="nge-ds-card-text">
          <div class="nge-ds-card-label">{{ ds.label }}</div>
          <div class="nge-ds-card-desc">{{ ds.description }}</div>
          </div>
          <div v-if="ds.id === currentDatasetId" class="nge-ds-badge">Active</div>
          <div v-else-if="accessOf(ds) === 'none'" class="nge-ds-badge nge-ds-badge--locked"><span aria-hidden="true">🔒</span> No access</div>
          <div v-else-if="accessOf(ds) === 'view'" class="nge-ds-badge nge-ds-badge--view">View only</div>
        </div></template>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Centred on screen (Amy: the chip moved to the top left, the panel was
   still pinned right). Hologram box and materialize from scifi-ui
   hologram.css, softened the same way as TagModePanel. */
.nge-dataset-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 440px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 96px);
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-radius: 10px;
  z-index: 9999;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55), 0 0 18px rgba(53, 181, 255, 0.12);
  backdrop-filter: blur(8px);
  overflow-y: auto;
  font-family: 'Inter', 'Segoe UI', sans-serif;
  animation: nge-ds-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes nge-ds-materialize {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(1.025) translateY(-8px); filter: blur(14px); }
  60%  { opacity: 1; transform: translate(-50%, -50%) scale(0.995); filter: blur(0); }
  100% { opacity: 1; transform: translate(-50%, -50%); filter: blur(0); }
}
@media (prefers-reduced-motion: reduce) {
  .nge-dataset-panel { animation: none; }
}

.nge-ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.nge-ds-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.06em;
}

.nge-ds-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.nge-ds-close:hover { color: #fff; }

.nge-ds-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Never a sideways scrollbar: long names and descriptions wrap. */
.nge-dataset-panel { overflow-x: hidden; }
.nge-ds-card-text, .nge-ds-variant-text { min-width: 0; overflow-wrap: anywhere; }

/* A group (MICrONS): one card that opens into a plain list of versions. */
.nge-ds-group { display: flex; flex-direction: column; gap: 4px; }
.nge-ds-group-card { padding-right: 112px; }
/* The open/close control: a clear pill, not a tiny glyph (Ames). */
.nge-ds-versions {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  color: #9fdcff; background: rgba(100, 200, 255, 0.12);
  border: 1px solid rgba(100, 200, 255, 0.4);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.nge-ds-group-card:hover .nge-ds-versions { background: rgba(100, 200, 255, 0.2); border-color: rgba(100, 200, 255, 0.7); color: #d4f0ff; }
.nge-ds-chevron { transition: transform 0.2s ease; }
.nge-ds-group--open .nge-ds-chevron { transform: rotate(180deg); }
/* The Active badge sits above the pill on a group card. */
.nge-ds-group-card .nge-ds-badge { top: 8px; right: 10px; }
.nge-ds-group-card:has(.nge-ds-badge) .nge-ds-versions { top: auto; bottom: 8px; transform: none; }
.nge-ds-variants {
  display: flex; flex-direction: column; gap: 2px;
  margin-left: 14px; padding-left: 10px;
  border-left: 1px solid rgba(100, 200, 255, 0.25);
}
.nge-ds-variant {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 10px; border-radius: 5px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.nge-ds-variant:hover:not(.nge-ds-active):not(.nge-ds-locked) { background: rgba(100, 200, 255, 0.06); border-color: rgba(100, 200, 255, 0.2); }
.nge-ds-variant.nge-ds-active { background: rgba(100, 200, 255, 0.1); border-color: rgba(100, 200, 255, 0.35); cursor: default; }
.nge-ds-variant.nge-ds-locked { cursor: not-allowed; }
.nge-ds-variant.nge-ds-locked .nge-ds-variant-text { opacity: 0.45; }
.nge-ds-variant-text { flex: 1; }
.nge-ds-variant-label { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.88); margin-bottom: 2px; }
.nge-ds-tag {
  flex-shrink: 0; font-size: 10px; font-weight: 600; white-space: nowrap;
  color: #64c8ff; background: rgba(100, 200, 255, 0.12);
  padding: 1px 6px; border-radius: 3px; margin-top: 1px;
}

.nge-ds-card {
  position: relative;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.nge-ds-card:hover:not(.nge-ds-active) {
  background: rgba(100, 200, 255, 0.06);
  border-color: rgba(100, 200, 255, 0.2);
}
.nge-ds-active {
  background: rgba(100, 200, 255, 0.1);
  border-color: rgba(100, 200, 255, 0.4);
  cursor: default;
}
.nge-ds-switching {
  opacity: 0.5;
  pointer-events: none;
}
/* No CAVE access: greyed, not clickable, the reason in the tooltip. */
.nge-ds-locked { cursor: not-allowed; }
.nge-ds-locked .nge-ds-card-thumb { filter: grayscale(1) brightness(0.55); }
.nge-ds-locked .nge-ds-card-text { opacity: 0.45; }
.nge-ds-card.nge-ds-locked:hover { background: none; border-color: rgba(255, 255, 255, 0.08); }
.nge-ds-badge--locked { color: #c9ccd4; background: rgba(255, 255, 255, 0.08); }
.nge-ds-badge--view { color: #e8c46a; background: rgba(232, 196, 106, 0.12); }

.nge-ds-card:has(.nge-ds-card-thumb) {
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: 12px;
  align-items: center;
}
.nge-ds-card-text { min-width: 0; }
.nge-ds-card-thumb {
  width: 104px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.nge-ds-card-label {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 3px;
}

.nge-ds-card-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.35;
}

.nge-ds-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 10px;
  font-weight: 600;
  color: #64c8ff;
  background: rgba(100, 200, 255, 0.12);
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.03em;
}
</style>
