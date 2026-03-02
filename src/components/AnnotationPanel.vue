<script setup lang="ts">
/**
 * AnnotationPanel.vue
 * Floats over the viewer whenever a segment is selected.
 * Shows completion status + cell type, and lets the user save to CAVE.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useSegmentAnnotationStore, useUserStatsStore } from '../store';
import { getCellStatus, setCellComplete, saveCellType, CellStatus } from '../widgets/lightbulb_service';
import { RETINAL_CELL_TYPES } from '../config';

const annotStore = useSegmentAnnotationStore();
const statsStore = useUserStatsStore();
const { activeSegId, caveUrl, annotation } = storeToRefs(annotStore);

const savingComplete  = ref(false);
const savingType      = ref(false);
const savedFlash      = ref(false);
const customTypeInput = ref('');
const showTypeMenu    = ref(false);

// Short display ID — show last 6 chars so it fits in the panel
const shortId = computed(() => {
  const id = activeSegId.value ?? '';
  return id.length > 12 ? '…' + id.slice(-10) : id;
});

const statusLabel = computed(() => {
  if (!annotation.value) return '…';
  if (annotation.value.loading) return 'Loading…';
  if (annotation.value.error)   return 'Error';
  return annotation.value.isComplete ? '✓ Complete' : '○ In Progress';
});

const cellTypeLabel = computed(() =>
  annotation.value?.cellType || 'Unknown / Unsure'
);

// ── Fetch status from CAVE whenever the active segment changes ───────────────
watch(activeSegId, async (id) => {
  if (!id) return;
  annotStore.setAnnotation({
    segId: id, isComplete: false, cellType: '',
    loading: true, error: '',
  });
  try {
    const status: CellStatus | null = await getCellStatus(caveUrl.value, id);
    if (status) {
      annotStore.setAnnotation({
        segId: id,
        isComplete: status.isComplete,
        cellType: status.cellType ?? '',
        annotationId: status.annotationId,
        cellTypeAnnotationId: status.cellTypeAnnotationId,
        loading: false,
        error: '',
      });
    } else {
      annotStore.setAnnotation({
        segId: id, isComplete: false, cellType: '',
        loading: false, error: 'No CAVE connection',
      });
    }
  } catch (e) {
    annotStore.setAnnotation({
      segId: id, isComplete: false, cellType: '',
      loading: false, error: String(e),
    });
  }
}, { immediate: true });

// ── Actions ──────────────────────────────────────────────────────────────────

async function toggleComplete() {
  if (!activeSegId.value || !annotation.value || savingComplete.value) return;
  savingComplete.value = true;
  const willBeComplete = !annotation.value.isComplete;
  const ok = await setCellComplete(
    caveUrl.value,
    activeSegId.value,
    willBeComplete,
    annotation.value.annotationId,
  );
  if (ok) {
    annotStore.setAnnotation({
      ...annotation.value!,
      isComplete: willBeComplete,
      annotationId: willBeComplete ? annotation.value.annotationId : undefined,
    });
    if (willBeComplete) {
      statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
    }
    flash();
  }
  savingComplete.value = false;
}

async function pickCellType(type: string) {
  if (!activeSegId.value || !annotation.value || savingType.value) return;
  savingType.value = true;
  showTypeMenu.value = false;
  const ok = await saveCellType(
    caveUrl.value,
    activeSegId.value,
    type,
    annotation.value.cellTypeAnnotationId,
  );
  if (ok) {
    annotStore.setAnnotation({ ...annotation.value!, cellType: type });
    flash();
  }
  savingType.value = false;
}

async function saveCustomType() {
  const val = customTypeInput.value.trim();
  if (!val) return;
  await pickCellType(val);
  customTypeInput.value = '';
}

function flash() {
  savedFlash.value = true;
  setTimeout(() => savedFlash.value = false, 1200);
}

function copyId() {
  if (activeSegId.value) navigator.clipboard.writeText(activeSegId.value);
}

function dismiss() {
  annotStore.setActiveSegId(null);
}
</script>

<template>
  <div class="nge-ann-panel" v-if="activeSegId">
    <!-- Header -->
    <div class="nge-ann-header">
      <span class="nge-ann-brain">🧠</span>
      <span class="nge-ann-title">Segment</span>
      <span class="nge-ann-id" :title="activeSegId ?? ''">{{ shortId }}</span>
      <button class="nge-ann-copy" @click="copyId" title="Copy full ID">📋</button>
      <span class="nge-ann-saved" v-if="savedFlash">✓ Saved</span>
      <button class="nge-ann-close" @click="dismiss" title="Dismiss">×</button>
    </div>

    <div class="nge-ann-divider" />

    <!-- Status row -->
    <div class="nge-ann-row">
      <span class="nge-ann-label">Status</span>
      <span class="nge-ann-status" :class="{
        'nge-ann-status--complete':    annotation?.isComplete,
        'nge-ann-status--inprogress':  annotation && !annotation.isComplete && !annotation.loading,
        'nge-ann-status--loading':     annotation?.loading,
        'nge-ann-status--error':       annotation?.error,
      }">{{ statusLabel }}</span>
      <button
        class="nge-ann-btn"
        :disabled="savingComplete || annotation?.loading"
        @click="toggleComplete"
      >
        {{ savingComplete ? 'Saving…' : annotation?.isComplete ? 'Unmark' : 'Mark Complete' }}
      </button>
    </div>

    <!-- Cell type row -->
    <div class="nge-ann-row nge-ann-row--type">
      <span class="nge-ann-label">Cell type</span>
      <div class="nge-ann-type-wrap">
        <button
          class="nge-ann-type-toggle"
          :class="{ 'nge-ann-type-toggle--open': showTypeMenu }"
          @click="showTypeMenu = !showTypeMenu"
          :disabled="annotation?.loading"
        >
          {{ savingType ? 'Saving…' : cellTypeLabel }}
          <span class="nge-ann-chevron">▾</span>
        </button>
        <!-- Type dropdown -->
        <div class="nge-ann-type-menu" v-if="showTypeMenu">
          <button
            v-for="t in RETINAL_CELL_TYPES"
            :key="t"
            class="nge-ann-type-item"
            :class="{ 'nge-ann-type-item--active': cellTypeLabel === t }"
            @click="pickCellType(t)"
          >{{ t }}</button>
          <div class="nge-ann-type-divider" />
          <div class="nge-ann-type-custom">
            <input
              v-model="customTypeInput"
              class="nge-ann-type-input"
              placeholder="Custom type…"
              @keydown.enter="saveCustomType"
            />
            <button class="nge-ann-btn nge-ann-btn--small" @click="saveCustomType">Save</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Error notice -->
    <div class="nge-ann-error" v-if="annotation?.error">
      ⚠ {{ annotation.error }}
    </div>
  </div>
</template>

<style scoped>
.nge-ann-panel {
  position: fixed;
  bottom: 48px;
  right: 16px;
  width: 340px;
  background: rgba(18, 22, 30, 0.97);
  border: 1px solid rgba(100, 180, 255, 0.25);
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6),
              0 0 0 1px rgba(100, 180, 255, 0.08);
  z-index: 500;
  font-size: 12px;
  color: #cdd;
  backdrop-filter: blur(8px);
  animation: nge-ann-slide-in 0.18s ease;
}

@keyframes nge-ann-slide-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Header ── */
.nge-ann-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 8px 12px;
}

.nge-ann-brain { font-size: 14px; }

.nge-ann-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(100, 180, 255, 0.7);
  font-weight: 600;
}

.nge-ann-id {
  font-family: monospace;
  font-size: 11px;
  color: #8bf;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nge-ann-copy {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  opacity: 0.5;
  padding: 0 2px;
  line-height: 1;
}
.nge-ann-copy:hover { opacity: 1; }

.nge-ann-saved {
  font-size: 11px;
  color: #7f8;
  animation: nge-ann-fade 1.2s ease forwards;
}
@keyframes nge-ann-fade {
  0%   { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}

.nge-ann-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #888;
  padding: 0 2px;
}
.nge-ann-close:hover { color: #fff; }

.nge-ann-divider {
  height: 1px;
  background: rgba(100, 180, 255, 0.12);
  margin: 0 12px;
}

/* ── Rows ── */
.nge-ann-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 36px;
}

.nge-ann-label {
  font-size: 11px;
  color: #778;
  min-width: 60px;
}

/* ── Status ── */
.nge-ann-status {
  flex: 1;
  font-weight: 600;
  font-size: 12px;
}
.nge-ann-status--complete   { color: #7f8; }
.nge-ann-status--inprogress { color: #aaa; }
.nge-ann-status--loading    { color: #778; font-style: italic; }
.nge-ann-status--error      { color: #f88; }

/* ── Buttons ── */
.nge-ann-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.3);
  background: rgba(100, 180, 255, 0.08);
  color: #8bf;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.nge-ann-btn:hover:not(:disabled) {
  background: rgba(100, 180, 255, 0.18);
  color: #adf;
}
.nge-ann-btn:disabled { opacity: 0.4; cursor: default; }

.nge-ann-btn--small { padding: 3px 8px; }

/* ── Cell type ── */
.nge-ann-row--type { align-items: flex-start; }

.nge-ann-type-wrap {
  position: relative;
  flex: 1;
}

.nge-ann-type-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.25);
  background: rgba(100, 180, 255, 0.06);
  color: #aac;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.nge-ann-type-toggle:hover:not(:disabled) { background: rgba(100, 180, 255, 0.14); }
.nge-ann-type-toggle--open { border-color: rgba(100, 180, 255, 0.5); }

.nge-ann-chevron { opacity: 0.5; margin-left: 6px; }

.nge-ann-type-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  width: 100%;
  background: #1a1f2a;
  border: 1px solid rgba(100, 180, 255, 0.25);
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.6);
  z-index: 600;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
}

.nge-ann-type-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  color: #bcc;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.nge-ann-type-item:hover { background: rgba(100,180,255,0.1); color: #fff; }
.nge-ann-type-item--active { color: #7f8; font-weight: 600; }

.nge-ann-type-divider { height: 1px; background: rgba(100,180,255,0.1); margin: 4px 0; }

.nge-ann-type-custom {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
}

.nge-ann-type-input {
  flex: 1;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(100,180,255,0.25);
  background: rgba(255,255,255,0.05);
  color: #cdd;
  font-size: 11px;
  outline: none;
}
.nge-ann-type-input:focus { border-color: rgba(100,180,255,0.5); }

/* ── Error ── */
.nge-ann-error {
  padding: 6px 12px 10px;
  font-size: 10px;
  color: #f88;
  opacity: 0.8;
}
</style>
