<script setup lang="ts">
/**
 * DatasetSelectorPanel — lets users switch between known datasets at runtime.
 * Displays as a compact centred hologram panel with dataset cards.
 * Switching loads new neuroglancer layers + updates CAVE config automatically.
 */
import { ref, onMounted } from 'vue';
import { DATASETS, switchToDataset, currentSegLayerName, findDatasetBySegName, findDatasetByCanonical, canonicalDataset, type DatasetEntry } from '../datasets';
import { runPanelTrace } from '../util/holo_trace';

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

// ── Switch dataset ──────────────────────────────────────────────────────────

const switching = ref(false);

async function switchTo(ds: DatasetEntry) {
  if (ds.id === currentDatasetId.value) return;
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
        <div
          v-for="ds in DATASETS"
          :key="ds.id"
          class="nge-ds-card"
          :class="{
            'nge-ds-active': ds.id === currentDatasetId,
            'nge-ds-switching': switching,
          }"
          @click="switchTo(ds)"
        >
          <div class="nge-ds-card-label">{{ ds.label }}</div>
          <div class="nge-ds-card-desc">{{ ds.description }}</div>
          <div v-if="ds.id === currentDatasetId" class="nge-ds-badge">Active</div>
        </div>
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
  width: 340px;
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
