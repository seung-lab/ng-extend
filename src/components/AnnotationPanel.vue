<script setup lang="ts">
/**
 * AnnotationPanel.vue
 * Floats over the viewer whenever a segment is selected.
 * Shows completion status + cell type, and lets the user save to CAVE.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useSegmentAnnotationStore, useUserStatsStore, useCellHistoryStore, useHelpRequestStore } from '../store';
import { getCellStatus, setCellComplete, saveCellType, CellStatus } from '../widgets/lightbulb_service';
import { getChangeLog, ChangeLogSummary } from '../widgets/pcg_service';
import { RETINAL_CELL_TYPES } from '../config';

const annotStore = useSegmentAnnotationStore();
const statsStore = useUserStatsStore();
const historyStore = useCellHistoryStore();
const helpStore = useHelpRequestStore();

/** Get current viewer position for storing with the cell history entry. */
function getViewerPosition(): [number, number, number] {
  try {
    const viewer = (window as any)['viewer'];
    const pos = viewer?.navigationState?.position?.value;
    if (pos && pos.length >= 3) return [Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2])];
  } catch {}
  return [0, 0, 0];
}

/** Get current dataset/layer name for tagging help requests. */
function getCurrentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      // Check layer type name (works even if dataSources haven't loaded)
      const typeName = ml.layer?.constructor?.name ?? '';
      if (typeName.includes('Segmentation')) return ml.name ?? '';
      // Fallback: check URL
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('graphene') || url.includes('segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}
const { activeSegId, caveUrl, annotation } = storeToRefs(annotStore);

const savingComplete  = ref(false);
const savingType      = ref(false);
const savedFlash      = ref(false);
const customTypeInput = ref('');
const showTypeMenu    = ref(false);

// ── PCG change log (merge/split history for this segment) ──────────────────
const changeLog = ref<ChangeLogSummary | null>(null);
const changeLogLoading = ref(false);

// Short display ID — show nickname if set, otherwise truncated ID
const nickname = computed(() => {
  if (!activeSegId.value) return '';
  return historyStore.getNickname(activeSegId.value) ?? '';
});

const shortId = computed(() => {
  if (nickname.value) return nickname.value;
  const id = activeSegId.value ?? '';
  return id.length > 12 ? '…' + id.slice(-10) : id;
});

const statusLabel = computed(() => {
  if (!annotation.value) return '…';
  if (annotation.value.loading) return 'Loading…';
  if (annotation.value.error)   return 'Error';
  return annotation.value.isComplete ? '✓ Complete' : '○ In Progress';
});

const cellTypeLabel = computed(() => {
  const ct = annotation.value?.cellType;
  const cs = annotation.value?.classificationSystem;
  if (!ct) return 'Unknown / Unsure';
  return cs ? `${cs} - ${ct}` : ct;
});

// ── Fetch status from CAVE whenever the active segment changes ───────────────
watch(activeSegId, async (id) => {
  if (!id) return;
  changeLog.value = null;
  changeLogLoading.value = true;
  annotStore.setAnnotation({
    segId: id, isComplete: false, cellType: '',
    loading: true, error: '',
  });

  // Fetch CAVE status and PCG change log in parallel
  const [statusResult, logResult] = await Promise.allSettled([
    getCellStatus(caveUrl.value, id),
    getChangeLog(id),
  ]);

  // Handle CAVE status
  if (statusResult.status === 'fulfilled') {
    const status = statusResult.value;
    if (status) {
      annotStore.setAnnotation({
        segId: id,
        isComplete: status.isComplete,
        cellType: status.cellType ?? '',
        classificationSystem: status.classificationSystem,
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
  } else {
    annotStore.setAnnotation({
      segId: id, isComplete: false, cellType: '',
      loading: false, error: String(statusResult.reason),
    });
  }

  // Handle PCG change log
  if (logResult.status === 'fulfilled') {
    changeLog.value = logResult.value;
  }
  changeLogLoading.value = false;
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
    // Record in cell history
    historyStore.upsert({
      segId: activeSegId.value!,
      isComplete: willBeComplete,
      cellType: annotation.value!.cellType,
      position: getViewerPosition(),
    });
    // Notify sidebar buttons — pass current status so they don't re-fetch
    document.dispatchEvent(new CustomEvent('nge:seg-status-changed', {
      detail: {
        segId: activeSegId.value,
        status: { isComplete: annotation.value!.isComplete, cellType: annotation.value!.cellType },
      },
    }));
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
    // Record in cell history (cell type can be set independently of completion)
    historyStore.upsert({
      segId: activeSegId.value!,
      isComplete: annotation.value!.isComplete,
      cellType: type,
      position: getViewerPosition(),
    });
    // Notify sidebar buttons — pass current status so they don't re-fetch
    document.dispatchEvent(new CustomEvent('nge:seg-status-changed', {
      detail: {
        segId: activeSegId.value,
        status: { isComplete: annotation.value!.isComplete, cellType: type },
      },
    }));
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

// ── Second opinion / help request ───────────────────────────────────────────
const HELP_ISSUE_TYPES = ['Extension', 'Merge', 'Black Spill', 'Doublecheck'];
const showHelpInput = ref(false);
const helpNote = ref('');
const selectedIssue = ref('');

function submitHelpRequest() {
  if (!activeSegId.value || !selectedIssue.value) return;
  helpStore.add({
    segId: activeSegId.value,
    position: getViewerPosition(),
    note: helpNote.value.trim(),
    issueType: selectedIssue.value,
    cellType: annotation.value?.cellType,
    nickname: historyStore.getNickname(activeSegId.value),
    dataset: getCurrentDataset(),
  });
  helpStore.refreshPending();
  helpNote.value = '';
  selectedIssue.value = '';
  showHelpInput.value = false;
  flash();
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

    <!-- Edit history row (merge/split counts from PCG) -->
    <div class="nge-ann-row nge-ann-row--edits" v-if="changeLog || changeLogLoading">
      <span class="nge-ann-label">Edits</span>
      <div class="nge-ann-edit-stats" v-if="changeLog">
        <span class="nge-ann-edit-stat nge-ann-edit-stat--merge" title="Merges on this cell">
          <svg class="nge-ann-edit-icon" viewBox="0 0 16 16" fill="none">
            <path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="4" cy="2.5" r="1.5" fill="currentColor"/>
            <circle cx="12" cy="2.5" r="1.5" fill="currentColor"/>
            <path d="M8 11v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          {{ changeLog.nMerges }}
        </span>
        <span class="nge-ann-edit-stat nge-ann-edit-stat--split" title="Splits on this cell">
          <svg class="nge-ann-edit-icon" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="8" cy="2.5" r="1.5" fill="currentColor"/>
            <path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          {{ changeLog.nSplits }}
        </span>
        <span class="nge-ann-edit-contributors" v-if="Object.keys(changeLog.userInfo).length > 0"
              :title="Object.keys(changeLog.userInfo).length + ' contributor(s)'">
          👥 {{ Object.keys(changeLog.userInfo).length }}
        </span>
      </div>
      <span class="nge-ann-edit-loading" v-else>loading…</span>
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

    <div class="nge-ann-divider" />

    <!-- Second opinion -->
    <div class="nge-ann-row nge-ann-row--help" v-if="!showHelpInput">
      <button class="nge-ann-help-btn" @click="showHelpInput = true">
        🔍 Ask for Second Opinion
      </button>
    </div>
    <div class="nge-ann-help-form" v-else>
      <div class="nge-ann-issue-label">What's the issue?</div>
      <div class="nge-ann-issue-chips">
        <button
          v-for="t in HELP_ISSUE_TYPES" :key="t"
          class="nge-ann-issue-chip"
          :class="{ 'nge-ann-issue-chip--active': selectedIssue === t }"
          @click="selectedIssue = selectedIssue === t ? '' : t"
        >{{ t }}</button>
      </div>
      <textarea
        v-model="helpNote"
        class="nge-ann-help-note"
        placeholder="Additional notes (optional)"
        rows="2"
      />
      <div class="nge-ann-help-actions">
        <button class="nge-ann-btn" :disabled="!selectedIssue" @click="submitHelpRequest">Submit</button>
        <button class="nge-ann-btn nge-ann-btn--ghost" @click="showHelpInput = false; selectedIssue = ''">Cancel</button>
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
  font-size: 15px;
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

.nge-ann-brain { font-size: 18px; }

.nge-ann-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(100, 180, 255, 0.7);
  font-weight: 600;
}

.nge-ann-id {
  font-family: monospace;
  font-size: 13px;
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
  font-size: 12px;
  opacity: 0.5;
  padding: 0 2px;
  line-height: 1;
}
.nge-ann-copy:hover { opacity: 1; }

.nge-ann-saved {
  font-size: 12px;
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
  font-size: 13px;
  color: #778;
  min-width: 60px;
}

/* ── Status ── */
.nge-ann-status {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
}
.nge-ann-status--complete   { color: #CE93D8; }
.nge-ann-status--inprogress { color: #aaa; }
.nge-ann-status--loading    { color: #778; font-style: italic; }
.nge-ann-status--error      { color: #f88; }

/* ── Edit stats (PCG merge/split counts) ── */
.nge-ann-edit-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
}

.nge-ann-edit-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
}
.nge-ann-edit-stat--merge { color: #CE93D8; }
.nge-ann-edit-stat--split { color: #f5a623; }

.nge-ann-edit-icon {
  width: 14px;
  height: 14px;
}

.nge-ann-edit-contributors {
  font-size: 12px;
  color: #778;
  margin-left: auto;
}

.nge-ann-edit-loading {
  font-size: 13px;
  color: #778;
  font-style: italic;
}

/* ── Buttons ── */
.nge-ann-btn {
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.3);
  background: rgba(100, 180, 255, 0.08);
  color: #8bf;
  font-size: 14px;
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
  font-size: 14px;
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
  padding: 7px 12px;
  background: none;
  border: none;
  color: #bcc;
  font-size: 14px;
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
  padding: 4px 9px;
  border-radius: 4px;
  border: 1px solid rgba(100,180,255,0.25);
  background: rgba(255,255,255,0.05);
  color: #cdd;
  font-size: 13px;
  outline: none;
}
.nge-ann-type-input:focus { border-color: rgba(100,180,255,0.5); }

/* ── Help / second opinion ── */
.nge-ann-row--help { justify-content: center; }

.nge-ann-help-btn {
  background: none;
  border: 1px solid rgba(245, 166, 35, 0.25);
  border-radius: 4px;
  padding: 6px 14px;
  color: #f5a623;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s;
  width: 100%;
}
.nge-ann-help-btn:hover { background: rgba(245, 166, 35, 0.08); }

.nge-ann-issue-label {
  font-size: 12px;
  color: #778;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.nge-ann-issue-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 8px;
}

.nge-ann-issue-chip {
  padding: 5px 12px;
  border-radius: 12px;
  border: 1px solid rgba(245, 166, 35, 0.2);
  background: rgba(245, 166, 35, 0.04);
  color: #b89050;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.12s;
}
.nge-ann-issue-chip:hover { background: rgba(245, 166, 35, 0.1); }
.nge-ann-issue-chip--active {
  background: rgba(245, 166, 35, 0.18);
  border-color: rgba(245, 166, 35, 0.5);
  color: #f5a623;
  font-weight: 600;
}

.nge-ann-help-form {
  padding: 6px 12px 10px;
}

.nge-ann-help-note {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.25);
  background: rgba(255, 255, 255, 0.04);
  color: #cdd;
  font-size: 14px;
  resize: vertical;
  outline: none;
  font-family: inherit;
}
.nge-ann-help-note:focus { border-color: rgba(100, 180, 255, 0.5); }

.nge-ann-help-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  justify-content: flex-end;
}

.nge-ann-btn--ghost {
  background: none;
  border-color: rgba(255, 255, 255, 0.15);
  color: #888;
}
.nge-ann-btn--ghost:hover:not(:disabled) { color: #bbb; background: rgba(255,255,255,0.04); }

/* ── Error ── */
.nge-ann-error {
  padding: 6px 12px 10px;
  font-size: 12px;
  color: #f88;
  opacity: 0.8;
}
</style>
