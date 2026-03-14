<script setup lang="ts">
/**
 * BatchProcessorPanel.vue
 * Batch processor for segment IDs — create named groups, perform bulk actions.
 * Actions: recolor, complete, annotate, copy IDs, remove from viewer.
 */
import { ref, computed, onMounted } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { setCellComplete, saveCellType } from '../widgets/lightbulb_service';
import { EYEWIRE_II_CAVE_CONFIG, RETINAL_CELL_TYPES } from '../config';

const emit = defineEmits({ hide: null });

// ── Data model ──────────────────────────────────────────────────────
interface SegmentGroup {
  id: string;
  name: string;
  segmentIds: string[];
  color?: string;
  createdAt: number;
}

const STORAGE_KEY = 'nge_batch_groups_v1';
const groups = ref<SegmentGroup[]>([]);
const expandedGroupId = ref<string | null>(null);
const newGroupName = ref('');
const addSegInput = ref<Record<string, string>>({});

// ── Batch operation state ───────────────────────────────────────────
const batchProgress = ref<{ groupId: string; action: string; current: number; total: number; errors: string[] } | null>(null);
const confirmAction = ref<{ groupId: string; action: string } | null>(null);
const colorPickerGroupId = ref<string | null>(null);
const annotateGroupId = ref<string | null>(null);
const selectedCellType = ref('');
const flashMessage = ref('');
let flashTimer: ReturnType<typeof setTimeout> | null = null;

// ── Persistence ─────────────────────────────────────────────────────
function loadGroups(): SegmentGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups.value)); } catch {}
}

onMounted(() => { groups.value = loadGroups(); });

// ── Group CRUD ──────────────────────────────────────────────────────
function createGroup() {
  const name = newGroupName.value.trim() || `Group ${groups.value.length + 1}`;
  groups.value.unshift({
    id: Date.now().toString(36),
    name,
    segmentIds: [],
    createdAt: Date.now(),
  });
  newGroupName.value = '';
  expandedGroupId.value = groups.value[0].id;
  persist();
}

function deleteGroup(id: string) {
  groups.value = groups.value.filter(g => g.id !== id);
  if (expandedGroupId.value === id) expandedGroupId.value = null;
  persist();
}

function renameGroup(group: SegmentGroup, newName: string) {
  group.name = newName.trim() || group.name;
  persist();
}

function toggleExpand(id: string) {
  expandedGroupId.value = expandedGroupId.value === id ? null : id;
}

// ── Segment management ──────────────────────────────────────────────
function getVisibleSegmentIds(): string[] {
  const viewer: any = (window as any)['viewer'];
  if (!viewer) return [];
  const layers = viewer.layerManager?.managedLayers;
  if (!layers) return [];
  for (const ml of layers) {
    const className = ml.layer?.constructor?.name || '';
    if (className.includes('Segmentation') || ml.layer?.type === 'segmentation') {
      const groupState = ml.layer?.displayState?.segmentationGroupState?.value;
      if (groupState?.visibleSegments) {
        const ids: string[] = [];
        for (const seg of groupState.visibleSegments) {
          ids.push(seg.toString());
        }
        return ids;
      }
    }
  }
  return [];
}

function addAllVisible(group: SegmentGroup) {
  const visible = getVisibleSegmentIds();
  const existing = new Set(group.segmentIds);
  let added = 0;
  for (const id of visible) {
    if (!existing.has(id)) {
      group.segmentIds.push(id);
      added++;
    }
  }
  if (added) persist();
  flash(`Added ${added} segment${added !== 1 ? 's' : ''}`);
}

function addById(group: SegmentGroup) {
  const input = (addSegInput.value[group.id] || '').trim();
  if (!input) return;
  // Support comma or newline separated
  const ids = input.split(/[,\n\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s));
  const existing = new Set(group.segmentIds);
  let added = 0;
  for (const id of ids) {
    if (!existing.has(id)) {
      group.segmentIds.push(id);
      added++;
    }
  }
  addSegInput.value[group.id] = '';
  if (added) persist();
  flash(`Added ${added} segment${added !== 1 ? 's' : ''}`);
}

function removeSegment(group: SegmentGroup, segId: string) {
  group.segmentIds = group.segmentIds.filter(id => id !== segId);
  persist();
}

// ── Neuroglancer helpers ────────────────────────────────────────────
function getSegLayer(): any {
  const viewer: any = (window as any)['viewer'];
  if (!viewer) return null;
  for (const ml of (viewer.layerManager?.managedLayers || [])) {
    const className = ml.layer?.constructor?.name || '';
    if (className.includes('Segmentation') || ml.layer?.type === 'segmentation') {
      return ml.layer;
    }
  }
  return null;
}

// ── Batch actions ───────────────────────────────────────────────────

// Recolor
function batchRecolor(group: SegmentGroup, hexColor: string) {
  const layer = getSegLayer();
  if (!layer) { flash('No segmentation layer'); return; }
  const colorGroupState = layer.displayState?.segmentationColorGroupState?.value;
  if (!colorGroupState?.segmentStatedColors) { flash('No color state'); return; }

  // Parse hex to 0xBBGGRR
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const packed = r | (g << 8) | (b << 16);

  let count = 0;
  for (const segId of group.segmentIds) {
    try {
      const id = Uint64.parseString(segId);
      colorGroupState.segmentStatedColors.set(id, new Uint64(packed, 0));
      count++;
    } catch {}
  }
  group.color = hexColor;
  persist();
  colorPickerGroupId.value = null;
  flash(`Recolored ${count} segments`);
}

function resetGroupColors(group: SegmentGroup) {
  const layer = getSegLayer();
  if (!layer) return;
  const colorGroupState = layer.displayState?.segmentationColorGroupState?.value;
  if (!colorGroupState?.segmentStatedColors) return;
  for (const segId of group.segmentIds) {
    try {
      colorGroupState.segmentStatedColors.delete(Uint64.parseString(segId));
    } catch {}
  }
  group.color = undefined;
  persist();
  flash('Colors reset');
}

// Copy
function batchCopy(group: SegmentGroup) {
  const text = group.segmentIds.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    flash(`Copied ${group.segmentIds.length} IDs`);
  }).catch(() => {
    flash('Copy failed');
  });
}

// Remove from viewer
function batchRemoveFromViewer(group: SegmentGroup) {
  const layer = getSegLayer();
  if (!layer) { flash('No segmentation layer'); return; }
  const groupState = layer.displayState?.segmentationGroupState?.value;
  if (!groupState?.visibleSegments) { flash('No visible segments'); return; }

  let removed = 0;
  for (const segId of group.segmentIds) {
    try {
      const id = Uint64.parseString(segId);
      if (groupState.visibleSegments.has(id)) {
        groupState.visibleSegments.delete(id);
        removed++;
      }
    } catch {}
  }
  confirmAction.value = null;
  flash(`Removed ${removed} from viewer`);
}

// Complete (sequential with progress)
async function batchComplete(group: SegmentGroup) {
  const caveServer = EYEWIRE_II_CAVE_CONFIG.caveServerOverride || '';
  if (!caveServer) { flash('No CAVE server'); return; }

  const total = group.segmentIds.length;
  batchProgress.value = { groupId: group.id, action: 'complete', current: 0, total, errors: [] };
  confirmAction.value = null;

  for (let i = 0; i < total; i++) {
    batchProgress.value.current = i + 1;
    try {
      await setCellComplete(caveServer, group.segmentIds[i], true);
    } catch (e: any) {
      batchProgress.value.errors.push(group.segmentIds[i]);
    }
  }
  const errCount = batchProgress.value.errors.length;
  flash(`Completed ${total - errCount}/${total}${errCount ? ` (${errCount} failed)` : ''}`);
  batchProgress.value = null;
}

// Annotate (sequential with progress)
async function batchAnnotate(group: SegmentGroup) {
  const caveServer = EYEWIRE_II_CAVE_CONFIG.caveServerOverride || '';
  const cellType = selectedCellType.value;
  if (!caveServer) { flash('No CAVE server'); return; }
  if (!cellType) { flash('Select a cell type first'); return; }

  const total = group.segmentIds.length;
  batchProgress.value = { groupId: group.id, action: 'annotate', current: 0, total, errors: [] };
  annotateGroupId.value = null;

  for (let i = 0; i < total; i++) {
    batchProgress.value.current = i + 1;
    try {
      await saveCellType(caveServer, group.segmentIds[i], cellType);
    } catch (e: any) {
      batchProgress.value.errors.push(group.segmentIds[i]);
    }
  }
  const errCount = batchProgress.value.errors.length;
  flash(`Annotated ${total - errCount}/${total} as "${cellType}"${errCount ? ` (${errCount} failed)` : ''}`);
  batchProgress.value = null;
  selectedCellType.value = '';
}

// ── UI helpers ──────────────────────────────────────────────────────
function inputValue(e: Event): string {
  return (e.target as HTMLInputElement).value;
}

function truncId(id: string) {
  return id.length > 8 ? '…' + id.slice(-6) : id;
}

function flash(msg: string) {
  flashMessage.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashMessage.value = ''; }, 2500);
}

// ── Drag ────────────────────────────────────────────────────────────
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });
const panelPos = ref({ x: window.innerWidth / 2 - 210, y: 90 });

function startDrag(e: MouseEvent) {
  isDragging.value = true;
  dragOffset.value = { x: e.clientX - panelPos.value.x, y: e.clientY - panelPos.value.y };
  const move = (ev: MouseEvent) => {
    panelPos.value = { x: ev.clientX - dragOffset.value.x, y: ev.clientY - dragOffset.value.y };
  };
  const up = () => { isDragging.value = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

const panelStyle = computed(() => ({
  left: panelPos.value.x + 'px',
  top: panelPos.value.y + 'px',
}));
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-bp" appear>
      <div class="nge-bp-panel" :style="panelStyle">

        <!-- Top bar -->
        <div class="nge-bp-topbar" @mousedown="startDrag" :class="{ 'nge-bp-dragging': isDragging }">
          <div class="nge-bp-title">📦 Batch Processor</div>
          <button class="nge-bp-close" @click="emit('hide')">×</button>
        </div>

        <!-- Flash message -->
        <Transition name="nge-bp-flash">
          <div v-if="flashMessage" class="nge-bp-flash">{{ flashMessage }}</div>
        </Transition>

        <!-- Create group -->
        <div class="nge-bp-create">
          <input
            v-model="newGroupName"
            placeholder="Group name..."
            class="nge-bp-input"
            @keydown.stop @keyup.stop @keypress.stop
            @keydown.enter.prevent="createGroup"
          />
          <button class="nge-bp-btn nge-bp-btn--create" @click="createGroup">+ Group</button>
        </div>

        <!-- Progress bar -->
        <div v-if="batchProgress" class="nge-bp-progress">
          <div class="nge-bp-progress-label">
            {{ batchProgress.action === 'complete' ? 'Completing' : 'Annotating' }}
            {{ batchProgress.current }}/{{ batchProgress.total }}…
          </div>
          <div class="nge-bp-progress-bar">
            <div class="nge-bp-progress-fill" :style="{ width: (batchProgress.current / batchProgress.total * 100) + '%' }"></div>
          </div>
        </div>

        <!-- Group list -->
        <div class="nge-bp-list" v-if="groups.length > 0">
          <div v-for="group in groups" :key="group.id" class="nge-bp-group">
            <!-- Group header -->
            <div class="nge-bp-group-header" @click="toggleExpand(group.id)">
              <span class="nge-bp-group-color" v-if="group.color" :style="{ background: group.color }"></span>
              <span class="nge-bp-group-chevron">{{ expandedGroupId === group.id ? '▾' : '▸' }}</span>
              <span class="nge-bp-group-name">{{ group.name }}</span>
              <span class="nge-bp-group-count">{{ group.segmentIds.length }}</span>
              <span class="nge-bp-group-spacer"></span>
              <button class="nge-bp-group-del" @click.stop="deleteGroup(group.id)" title="Delete group">×</button>
            </div>

            <!-- Expanded content -->
            <div v-if="expandedGroupId === group.id" class="nge-bp-group-body">
              <!-- Rename -->
              <div class="nge-bp-rename">
                <input
                  :value="group.name"
                  @change="renameGroup(group, inputValue($event))"
                  class="nge-bp-input nge-bp-input--sm"
                  placeholder="Rename..."
                  @keydown.stop @keyup.stop @keypress.stop
                />
              </div>

              <!-- Segment chips -->
              <div class="nge-bp-chips" v-if="group.segmentIds.length > 0">
                <span v-for="segId in group.segmentIds" :key="segId" class="nge-bp-chip">
                  {{ truncId(segId) }}
                  <button class="nge-bp-chip-x" @click="removeSegment(group, segId)">×</button>
                </span>
              </div>
              <div v-else class="nge-bp-empty-segs">No segments — add some below</div>

              <!-- Add segments -->
              <div class="nge-bp-add-row">
                <button class="nge-bp-btn nge-bp-btn--add" @click="addAllVisible(group)">+ All Visible</button>
                <input
                  v-model="addSegInput[group.id]"
                  placeholder="Paste IDs..."
                  class="nge-bp-input nge-bp-input--sm nge-bp-input--flex"
                  @keydown.stop @keyup.stop @keypress.stop
                  @keydown.enter.prevent="addById(group)"
                />
                <button class="nge-bp-btn nge-bp-btn--add" @click="addById(group)">Add</button>
              </div>

              <!-- Action bar -->
              <div class="nge-bp-actions">
                <button class="nge-bp-act nge-bp-act--color" @click.stop="colorPickerGroupId = colorPickerGroupId === group.id ? null : group.id" :disabled="group.segmentIds.length === 0">
                  🎨 Recolor
                </button>
                <button class="nge-bp-act nge-bp-act--complete" @click.stop="confirmAction = { groupId: group.id, action: 'complete' }" :disabled="group.segmentIds.length === 0">
                  ✓ Complete
                </button>
                <button class="nge-bp-act nge-bp-act--annotate" @click.stop="annotateGroupId = annotateGroupId === group.id ? null : group.id; selectedCellType = ''" :disabled="group.segmentIds.length === 0">
                  🏷 Annotate
                </button>
                <button class="nge-bp-act nge-bp-act--copy" @click="batchCopy(group)" :disabled="group.segmentIds.length === 0">
                  📋 Copy
                </button>
                <button class="nge-bp-act nge-bp-act--remove" @click.stop="confirmAction = { groupId: group.id, action: 'remove' }" :disabled="group.segmentIds.length === 0">
                  🗑 Remove
                </button>
              </div>

              <!-- Color picker sub-panel -->
              <div v-if="colorPickerGroupId === group.id" class="nge-bp-sub">
                <div class="nge-bp-sub-label">Pick color:</div>
                <div class="nge-bp-swatches">
                  <button v-for="c in ['#FF6B6B','#FFA726','#FFD700','#66BB6A','#42A5F5','#CE93D8','#26C6DA','#EF5350','#FFFFFF']" :key="c"
                    class="nge-bp-swatch" :style="{ background: c }" @click="batchRecolor(group, c)"></button>
                </div>
                <input type="color" class="nge-bp-color-input" @change="batchRecolor(group, inputValue($event))" />
                <button v-if="group.color" class="nge-bp-btn nge-bp-btn--sm" @click="resetGroupColors(group)">Reset Colors</button>
              </div>

              <!-- Annotate sub-panel -->
              <div v-if="annotateGroupId === group.id" class="nge-bp-sub">
                <div class="nge-bp-sub-label">Cell type:</div>
                <select v-model="selectedCellType" class="nge-bp-select" @keydown.stop @keyup.stop @keypress.stop>
                  <option value="">Select type...</option>
                  <option v-for="ct in RETINAL_CELL_TYPES" :key="ct" :value="ct">{{ ct }}</option>
                </select>
                <button class="nge-bp-btn nge-bp-btn--go" @click="batchAnnotate(group)" :disabled="!selectedCellType">Apply</button>
              </div>

              <!-- Confirm dialog -->
              <div v-if="confirmAction && confirmAction.groupId === group.id" class="nge-bp-confirm">
                <span v-if="confirmAction.action === 'complete'">
                  Mark {{ group.segmentIds.length }} segments complete?
                </span>
                <span v-else-if="confirmAction.action === 'remove'">
                  Remove {{ group.segmentIds.length }} segments from viewer?
                </span>
                <div class="nge-bp-confirm-btns">
                  <button class="nge-bp-btn nge-bp-btn--go" @click="confirmAction.action === 'complete' ? batchComplete(group) : batchRemoveFromViewer(group)">Yes</button>
                  <button class="nge-bp-btn nge-bp-btn--sm" @click="confirmAction = null">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="nge-bp-empty">
          No groups yet. Create one above to batch-process segments.
        </div>

      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nge-bp-panel {
  position: fixed;
  z-index: 10010;
  width: 420px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  color: #ccd;
  overflow: hidden;
}

.nge-bp-enter-active, .nge-bp-leave-active { transition: opacity 0.2s, transform 0.2s; }
.nge-bp-enter-from, .nge-bp-leave-to { opacity: 0; transform: translateY(10px) scale(0.97); }

/* Top bar */
.nge-bp-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(30, 30, 60, 0.9);
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid rgba(120, 140, 255, 0.08);
}
.nge-bp-dragging { cursor: grabbing; }
.nge-bp-title { font-size: 0.9em; font-weight: 700; letter-spacing: 0.03em; color: #eef; }
.nge-bp-close { background: none; border: none; color: #889; font-size: 1.4em; cursor: pointer; padding: 0 4px; line-height: 1; }
.nge-bp-close:hover { color: #eef; }

/* Flash message */
.nge-bp-flash {
  padding: 4px 12px;
  background: rgba(74, 158, 255, 0.12);
  color: #8bf;
  font-size: 0.72em;
  text-align: center;
  font-weight: 600;
}
.nge-bp-flash-enter-active { transition: opacity 0.15s; }
.nge-bp-flash-leave-active { transition: opacity 0.3s; }
.nge-bp-flash-enter-from, .nge-bp-flash-leave-to { opacity: 0; }

/* Create group */
.nge-bp-create {
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  background: rgba(20, 20, 40, 0.6);
  border-bottom: 1px solid rgba(120, 140, 255, 0.06);
}

/* Inputs */
.nge-bp-input {
  padding: 5px 8px;
  border: 1px solid rgba(120, 140, 255, 0.12);
  border-radius: 5px;
  background: rgba(10, 10, 30, 0.5);
  color: #ccd;
  font-size: 0.75em;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.nge-bp-input:focus { border-color: rgba(74, 158, 255, 0.3); }
.nge-bp-input::placeholder { color: #556; }
.nge-bp-input--sm { padding: 3px 6px; font-size: 0.7em; }
.nge-bp-input--flex { flex: 1; min-width: 0; }

.nge-bp-create .nge-bp-input { flex: 1; }

/* Buttons */
.nge-bp-btn {
  padding: 4px 10px;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 5px;
  background: transparent;
  color: #8bf;
  font-size: 0.72em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s;
}
.nge-bp-btn:hover { background: rgba(74, 158, 255, 0.1); }
.nge-bp-btn--create { border-color: rgba(68, 170, 102, 0.25); color: #4a6; }
.nge-bp-btn--create:hover { background: rgba(68, 170, 102, 0.12); }
.nge-bp-btn--add { font-size: 0.68em; padding: 3px 7px; }
.nge-bp-btn--go { border-color: rgba(74, 158, 255, 0.3); color: #4af; }
.nge-bp-btn--go:hover { background: rgba(74, 158, 255, 0.15); }
.nge-bp-btn--go:disabled { opacity: 0.3; cursor: default; }
.nge-bp-btn--sm { font-size: 0.65em; padding: 2px 6px; color: #889; }

/* Progress bar */
.nge-bp-progress {
  padding: 6px 12px;
  background: rgba(74, 158, 255, 0.06);
}
.nge-bp-progress-label { font-size: 0.7em; color: #8bf; margin-bottom: 3px; }
.nge-bp-progress-bar {
  height: 3px;
  background: rgba(120, 140, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}
.nge-bp-progress-fill {
  height: 100%;
  background: #4a9eff;
  border-radius: 2px;
  transition: width 0.15s;
}

/* Group list */
.nge-bp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.nge-bp-list::-webkit-scrollbar { width: 4px; }
.nge-bp-list::-webkit-scrollbar-thumb { background: rgba(120, 140, 255, 0.15); border-radius: 2px; }

.nge-bp-group {
  border-bottom: 1px solid rgba(120, 140, 255, 0.04);
}

/* Group header */
.nge-bp-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background 0.1s;
}
.nge-bp-group-header:hover { background: rgba(74, 158, 255, 0.04); }

.nge-bp-group-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.nge-bp-group-chevron { font-size: 0.7em; color: #667; width: 10px; }
.nge-bp-group-name { font-size: 0.82em; font-weight: 600; color: #dde; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-bp-group-count {
  font-size: 0.65em;
  background: rgba(120, 140, 255, 0.1);
  color: #8bf;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
}
.nge-bp-group-spacer { flex-shrink: 1; }
.nge-bp-group-del { background: none; border: none; color: #556; font-size: 1em; cursor: pointer; padding: 0 2px; }
.nge-bp-group-del:hover { color: #f66; }

/* Group body */
.nge-bp-group-body {
  padding: 4px 12px 10px;
  background: rgba(10, 10, 30, 0.3);
}

.nge-bp-rename {
  margin-bottom: 6px;
}
.nge-bp-rename .nge-bp-input { width: 100%; }

/* Chips */
.nge-bp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-bottom: 6px;
  max-height: 120px;
  overflow-y: auto;
}
.nge-bp-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  background: rgba(120, 140, 255, 0.08);
  border: 1px solid rgba(120, 140, 255, 0.1);
  border-radius: 4px;
  font-size: 0.68em;
  color: #aab;
}
.nge-bp-chip-x {
  background: none;
  border: none;
  color: #667;
  font-size: 0.9em;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.nge-bp-chip-x:hover { color: #f66; }

.nge-bp-empty-segs {
  font-size: 0.7em;
  color: #556;
  padding: 6px 0;
  font-style: italic;
}

/* Add row */
.nge-bp-add-row {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}

/* Action bar */
.nge-bp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.nge-bp-act {
  padding: 3px 7px;
  border: 1px solid rgba(120, 140, 255, 0.1);
  border-radius: 4px;
  background: transparent;
  color: #889;
  font-size: 0.65em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}
.nge-bp-act:hover:not(:disabled) { background: rgba(120, 140, 255, 0.06); color: #bbf; }
.nge-bp-act:disabled { opacity: 0.3; cursor: default; }
.nge-bp-act--color:hover:not(:disabled) { border-color: rgba(255, 170, 68, 0.3); color: #fa4; }
.nge-bp-act--complete:hover:not(:disabled) { border-color: rgba(68, 170, 255, 0.3); color: #4af; }
.nge-bp-act--annotate:hover:not(:disabled) { border-color: rgba(206, 147, 216, 0.3); color: #CE93D8; }
.nge-bp-act--copy:hover:not(:disabled) { border-color: rgba(68, 170, 102, 0.3); color: #4a6; }
.nge-bp-act--remove:hover:not(:disabled) { border-color: rgba(255, 100, 100, 0.3); color: #f66; }

/* Sub-panels (color picker, annotate) */
.nge-bp-sub {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(20, 20, 40, 0.5);
  border: 1px solid rgba(120, 140, 255, 0.08);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.nge-bp-sub-label { font-size: 0.68em; color: #889; font-weight: 600; }

.nge-bp-swatches { display: flex; gap: 3px; flex-wrap: wrap; }
.nge-bp-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: transform 0.1s;
}
.nge-bp-swatch:hover { transform: scale(1.15); border-color: rgba(255, 255, 255, 0.3); }

.nge-bp-color-input {
  width: 24px;
  height: 20px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
}

.nge-bp-select {
  padding: 3px 6px;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 4px;
  background: rgba(10, 10, 30, 0.5);
  color: #ccd;
  font-size: 0.7em;
  font-family: inherit;
  outline: none;
  flex: 1;
  min-width: 0;
}

/* Confirm dialog */
.nge-bp-confirm {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(255, 100, 100, 0.06);
  border: 1px solid rgba(255, 100, 100, 0.15);
  border-radius: 6px;
  font-size: 0.72em;
  color: #f99;
}
.nge-bp-confirm-btns { display: flex; gap: 4px; margin-top: 4px; }

/* Empty state */
.nge-bp-empty {
  padding: 24px 16px;
  text-align: center;
  color: #556;
  font-size: 0.78em;
}
</style>
