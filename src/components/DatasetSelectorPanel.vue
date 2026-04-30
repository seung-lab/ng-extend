<script setup lang="ts">
/**
 * DatasetSelectorPanel — lets users switch between known datasets at runtime.
 * Displays as a compact side panel with dataset cards.
 * Switching loads new neuroglancer layers + updates CAVE config automatically.
 */
import { ref, onMounted } from 'vue';
import { DATASETS, switchToDataset, type DatasetEntry } from '../datasets';

const emit = defineEmits({ hide: null });

// ── Current dataset detection ───────────────────────────────────────────────

const currentDatasetId = ref('');

function detectCurrentDataset() {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const name = ml.name ?? '';
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      // Match by layer name or URL
      for (const ds of DATASETS) {
        const segLayer = ds.layers.find((l: any) => l.type === 'segmentation');
        if (segLayer && (segLayer.name === name || (typeof segLayer.source === 'object' && url.includes(ds.id)))) {
          currentDatasetId.value = ds.id;
          return;
        }
      }
    }
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
    <div class="nge-dataset-panel">
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
.nge-dataset-panel {
  position: fixed;
  top: 32px;
  right: 8px;
  width: 300px;
  max-height: calc(100vh - 48px);
  background: #1a1a2e;
  border: 1px solid rgba(100, 200, 255, 0.25);
  border-radius: 8px;
  z-index: 9999;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
  font-family: 'Inter', 'Segoe UI', sans-serif;
}

.nge-ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.nge-ds-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
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
