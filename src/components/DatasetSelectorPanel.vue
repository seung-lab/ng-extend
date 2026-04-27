<script setup lang="ts">
/**
 * DatasetSelectorPanel — lets users switch between known datasets at runtime.
 * Displays as a compact side panel with dataset cards.
 * Switching loads new neuroglancer layers + updates CAVE config automatically.
 */
import { ref, computed, onMounted } from 'vue';
import { useLayersStore } from '../store';
import { CAVE_CONFIGS_BY_DATASET, getDatasetCaveConfig } from '../config';

const emit = defineEmits({ hide: null });
const layerStore = useLayersStore();

// ── Known datasets with their neuroglancer layer configs ────────────────────
// These mirror the dev-server DATASETS_CONFIG but are available at runtime.
interface DatasetEntry {
  id: string;
  label: string;
  description: string;
  layers: any[];
}

const DATASETS: DatasetEntry[] = [
  {
    id: 'stroeh_mouse_retina',
    label: 'Stroeh Mouse Retina',
    description: 'EyeWire II — mouse retinal connectome (16×16×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'stroeh_mouse_retina',
      },
    ],
  },
  {
    id: 'pinky_sandbox',
    label: 'Pinky Sandbox',
    description: 'MICrONS pinky — small cortex volume for testing (4×4×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em',
        name: 'img',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'pinky_nf_v2',
      },
    ],
  },
  {
    id: 'minnie65',
    label: 'MICrONS Minnie65',
    description: 'MICrONS — 1mm³ mouse visual cortex (8×8×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie65_public_v117',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'minnie65_public',
      },
    ],
  },
];

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
  try {
    layerStore.selectLayers(ds.layers);
    // Persist choice
    const segLayer = ds.layers.find((l: any) => l.type === 'segmentation');
    if (segLayer) {
      const segName = segLayer.name || (typeof segLayer.source === 'object' ? '' : '');
      if (segName) localStorage.setItem('nge_dataset_preference', segName);
    }
    currentDatasetId.value = ds.id;
    const cfg = getDatasetCaveConfig(ds.id);
    console.info(`[dataset-selector] Switched to ${ds.id} — CAVE: ${cfg.datastack}, tables: ${cfg.cellStatusTable}/${cfg.cellTypeTable}`);
  } catch (e) {
    console.error('[dataset-selector] Switch failed:', e);
  } finally {
    switching.value = false;
  }
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
