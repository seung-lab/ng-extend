<script setup lang="ts">
/**
 * BatchProcessorPanel.vue
 * Batch processor for segment IDs — create named groups, perform bulk actions.
 * Actions: recolor, complete, annotate, copy IDs, remove from viewer.
 */
import { ref, computed, onMounted } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { setCellComplete, saveCellType, NURRO_IMAGES } from '../widgets/lightbulb_service';
import { useProofreadingBackendStore, useUserStatsStore } from '../store';
import { EYEWIRE_II_CAVE_CONFIG, RETINAL_CELL_TYPES } from '../config';

const emit = defineEmits({ hide: null });

// ── Data model ──────────────────────────────────────────────────────
interface SegmentGroup {
  id: string;
  name: string;
  segmentIds: string[];
  color?: string;
  createdAt: number;
  /** Layer name of the segmentation that was active when the group was created.
   *  Used to keep cross-dataset segIds separate (a stroeh root_id is not the
   *  same root_id on minnie65). Empty/missing = treat as current dataset. */
  dataset?: string;
}

const STORAGE_KEY = 'nge_batch_groups_v1';
const groups = ref<SegmentGroup[]>([]);
const expandedGroupId = ref<string | null>(null);
const newGroupName = ref('');
const addSegInput = ref<Record<string, string>>({});
const activeDataset = ref('');
const collapsedDatasets = ref<Set<string>>(new Set());

// ── Batch operation state ───────────────────────────────────────────
const batchProgress = ref<{ groupId: string; action: string; current: number; total: number; errors: string[] } | null>(null);
const confirmAction = ref<{ groupId: string; action: string } | null>(null);
const colorPickerGroupId = ref<string | null>(null);
const annotateGroupId = ref<string | null>(null);
const selectedCellType = ref('');
const flashMessage = ref('');
let flashTimer: ReturnType<typeof setTimeout> | null = null;

// ── Guided "Mark Complete" wizard state ─────────────────────────────
// Each batch row needs its own crosshair point so CAVE materializer maps
// pt.position → the correct pt_root_id (one root_id per row). Otherwise every
// row gets tagged on whichever cell the live crosshair was inside.
type GuideStage = 'intro' | 'walk' | 'review';
interface GuideState {
  groupId: string;
  stage: GuideStage;
  /** Index into group.segmentIds — current cell being placed. */
  index: number;
  /** Captured points per segId (set on Save). */
  points: Record<string, [number, number, number]>;
  /** Skipped segIds. */
  skipped: Set<string>;
  /** Solo mode: hide every other cell so the active one is unambiguous. */
  solo: boolean;
  /** Snapshot of visibleSegments at the moment solo was enabled, so we can
   *  restore the user's original viewer state on toggle-off / cancel / submit. */
  soloSnapshot: string[] | null;
}
const guide = ref<GuideState | null>(null);

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

onMounted(() => {
  groups.value = loadGroups();
  activeDataset.value = currentDataset();
});

/** Active segmentation layer name — used to tag groups by dataset. Same
 *  detection pattern as HelpRequestsPanel so cross-dataset behavior matches. */
function currentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const typeName = ml.layer?.constructor?.name ?? '';
      if (typeName.includes('Segmentation')) return ml.name ?? '';
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('graphene') || url.includes('segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

// ── Dataset sectioning ──────────────────────────────────────────────
interface DatasetSection {
  dataset: string;
  label: string;
  isCurrent: boolean;
  groups: SegmentGroup[];
}

const groupsByDataset = computed<DatasetSection[]>(() => {
  const buckets = new Map<string, SegmentGroup[]>();
  const current = activeDataset.value;
  for (const g of groups.value) {
    const ds = g.dataset || current || 'Unknown';
    if (!buckets.has(ds)) buckets.set(ds, []);
    buckets.get(ds)!.push(g);
  }
  const result: DatasetSection[] = [];
  if (current && buckets.has(current)) {
    result.push({ dataset: current, label: current, isCurrent: true, groups: buckets.get(current)! });
    buckets.delete(current);
  }
  for (const [ds, gs] of buckets) {
    result.push({ dataset: ds, label: ds, isCurrent: !current, groups: gs });
    // Auto-collapse non-current sections on first display.
    if (current && ds !== current && !collapsedDatasets.value.has(ds)) {
      collapsedDatasets.value.add(ds);
    }
  }
  return result;
});

function toggleDatasetSection(ds: string) {
  if (collapsedDatasets.value.has(ds)) collapsedDatasets.value.delete(ds);
  else collapsedDatasets.value.add(ds);
}

// ── Group CRUD ──────────────────────────────────────────────────────
function createGroup() {
  const name = newGroupName.value.trim() || `Group ${groups.value.length + 1}`;
  groups.value.unshift({
    id: Date.now().toString(36),
    name,
    segmentIds: [],
    createdAt: Date.now(),
    dataset: activeDataset.value || currentDataset() || undefined,
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

// ── Segment color (for the wizard's color dots) ─────────────────────
// Returns the exact color neuroglancer renders for the segment so the pip
// in the wizard list matches the cell in the viewer:
//   1. segmentStatedColors override (the user-recolored case), or
//   2. segmentColorHash.computeCssColor(id) — the same Murmur-style hash
//      neuroglancer uses for auto-coloring (see segment_color.ts).
// Falls back to a deterministic local hash only if neuroglancer state
// isn't available yet (e.g. the seg layer hasn't mounted).
function getSegmentColor(segIdStr: string): string {
  try {
    const layer = getSegLayer();
    const colorGroupState = layer?.displayState?.segmentationColorGroupState?.value;
    if (colorGroupState) {
      const id = Uint64.parseString(segIdStr);
      // 1. Stated override (recolored)
      const map = colorGroupState.segmentStatedColors;
      if (map) {
        const out = new Uint64();
        // Uint64HashMap.get(key, valueOut) → boolean; mutates valueOut.
        if (map.get(id, out)) {
          const packed = out.low >>> 0;  // 0xBBGGRR
          const r = packed & 0xff;
          const g = (packed >>> 8) & 0xff;
          const b = (packed >>> 16) & 0xff;
          return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
        }
      }
      // 2. Auto-color via neuroglancer's own SegmentColorHash so the pip
      //    matches what the viewer renders pixel-for-pixel.
      if (colorGroupState.segmentColorHash?.computeCssColor) {
        return colorGroupState.segmentColorHash.computeCssColor(id);
      }
    }
  } catch {}
  // 3. Fallback if seg layer isn't mounted — deterministic per segId
  let h = 0;
  for (let i = 0; i < segIdStr.length; i++) {
    h = (h * 31 + segIdStr.charCodeAt(i)) | 0;
  }
  return `hsl(${(h >>> 0) % 360}, 65%, 60%)`;
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
  // Keep color picker open so user can try different colors
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

// ── Guided Mark Complete wizard ──────────────────────────────────────
// CAVE's annotation engine resolves pt.position → pt_root_id, so each row
// in a batch must carry its own crosshair point — otherwise every segment
// gets tagged at whichever cell the user's crosshair was sitting in.
function startCompleteWizard(group: SegmentGroup) {
  if (group.segmentIds.length === 0) return;
  guide.value = {
    groupId: group.id,
    stage: 'intro',
    index: 0,
    points: {},
    skipped: new Set(),
    solo: false,
    soloSnapshot: null,
  };
  confirmAction.value = null;
}

function cancelCompleteWizard() {
  if (guide.value?.solo) restoreSoloSnapshot();
  guide.value = null;
}

/** Restore the visible-segments set captured when solo mode was turned on. */
function restoreSoloSnapshot() {
  if (!guide.value?.soloSnapshot) return;
  const layer = getSegLayer();
  const visibleSegments = layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!visibleSegments) return;
  // Clear current visible set, then restore the snapshot. visibleSegments is a
  // Uint64Set — iterate to a list before deleting to avoid mutating during iteration.
  const current: any[] = [];
  for (const seg of visibleSegments) current.push(seg);
  for (const seg of current) visibleSegments.delete(seg);
  for (const idStr of guide.value.soloSnapshot) {
    try { visibleSegments.add(Uint64.parseString(idStr)); } catch {}
  }
}

/**
 * Toggle solo mode for the active wizard cell. When ON, every other segment
 * is hidden so the user can't mistake which cell to crosshair. When OFF, the
 * pre-solo visible set is restored.
 */
function toggleSolo(group: SegmentGroup) {
  if (!guide.value) return;
  const layer = getSegLayer();
  const visibleSegments = layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!visibleSegments) return;

  if (guide.value.solo) {
    restoreSoloSnapshot();
    guide.value.solo = false;
    guide.value.soloSnapshot = null;
  } else {
    const snapshot: string[] = [];
    for (const seg of visibleSegments) snapshot.push(seg.toString());
    guide.value.soloSnapshot = snapshot;
    guide.value.solo = true;
    // Re-run navigation so the active cell becomes the only visible one + center.
    jumpToCurrentSegment(group);
  }
}

function loadAllSegmentsIntoViewer(group: SegmentGroup) {
  const layer = getSegLayer();
  if (!layer) { flash('No segmentation layer'); return; }
  const groupState = layer.displayState?.segmentationGroupState?.value;
  if (!groupState?.visibleSegments) { flash('No visible-segments state'); return; }
  let added = 0;
  for (const segId of group.segmentIds) {
    try {
      const id = Uint64.parseString(segId);
      if (!groupState.visibleSegments.has(id)) {
        groupState.visibleSegments.add(id);
        added++;
      }
    } catch {}
  }
  flash(`Loaded ${added} into viewer`);
}

/** Read a snapshot of the viewer's current position. */
function captureViewerPoint(): [number, number, number] | null {
  const viewer: any = (window as any)['viewer'];
  const pos = viewer?.navigationState?.position?.value;
  if (!pos || pos.length < 3) return null;
  return [Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2])];
}

/**
 * Add the current segment to the viewer and center on its mesh-bbox centroid.
 * Uses the patched moveToSegment (see move_to_segment_patch.ts) which walks
 * mesh fragments to compute a centroid. If the mesh hasn't streamed in yet,
 * neuroglancer's moveToSegment is a quiet no-op — the user can hit
 * "Show in viewer" again once the mesh has arrived.
 */
function jumpToCurrentSegment(group: SegmentGroup) {
  if (!guide.value) return;
  const segId = group.segmentIds[guide.value.index];
  const layer = getSegLayer();
  if (!layer) return;
  try {
    const id = Uint64.parseString(segId);
    const visibleSegments = layer.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (visibleSegments) {
      if (guide.value.solo) {
        // Solo mode: hide every other cell so only the active one is visible.
        const current: any[] = [];
        for (const seg of visibleSegments) current.push(seg);
        for (const seg of current) visibleSegments.delete(seg);
      }
      if (!visibleSegments.has(id)) visibleSegments.add(id);
    }
    if (typeof layer.moveToSegment === 'function') {
      layer.moveToSegment(id);
    }
  } catch (e) {
    console.warn('[batch] jumpToCurrentSegment failed:', e);
  }
}

/** Begin the walk stage: pre-load all meshes, then center on the first cell. */
function startWalk(group: SegmentGroup) {
  if (!guide.value) return;
  // Force axis bars on so the user has orientation cues for crosshair placement.
  try {
    const viewer: any = (window as any)['viewer'];
    if (viewer?.showAxisLines && viewer.showAxisLines.value === false) {
      viewer.showAxisLines.value = true;
    }
  } catch {}
  // Pre-load all segments so meshes start streaming — the moveToSegment call
  // in jumpToCurrentSegment relies on a loaded mesh fragment for the centroid.
  loadAllSegmentsIntoViewer(group);
  guide.value.stage = 'walk';
  // Default solo ON: snapshot the now-loaded set, then hide everything except
  // the active cell. toggleSolo also calls jumpToCurrentSegment to center.
  toggleSolo(group);
}

function saveCurrentPoint(group: SegmentGroup) {
  if (!guide.value) return;
  const segId = group.segmentIds[guide.value.index];
  const pt = captureViewerPoint();
  if (!pt || (pt[0] === 0 && pt[1] === 0 && pt[2] === 0)) {
    flash('Place crosshairs in the cell first');
    return;
  }
  guide.value.points[segId] = pt;
  guide.value.skipped.delete(segId);
}

function skipCurrent(group: SegmentGroup) {
  if (!guide.value) return;
  const segId = group.segmentIds[guide.value.index];
  guide.value.skipped.add(segId);
  delete guide.value.points[segId];
}

function nextSegment(group: SegmentGroup) {
  if (!guide.value) return;
  if (guide.value.index < group.segmentIds.length - 1) {
    guide.value.index++;
    jumpToCurrentSegment(group);
  } else {
    guide.value.stage = 'review';
  }
}

function prevSegment(group: SegmentGroup) {
  if (!guide.value) return;
  if (guide.value.index > 0) {
    guide.value.index--;
    jumpToCurrentSegment(group);
  }
}

function gotoSegment(group: SegmentGroup, idx: number) {
  if (!guide.value) return;
  if (idx >= 0) {
    guide.value.index = idx;
    guide.value.stage = 'walk';
    jumpToCurrentSegment(group);
  }
}

/** Status per segment: 'saved' | 'skipped' | 'pending'. */
function segStatus(segId: string): 'saved' | 'skipped' | 'pending' {
  if (!guide.value) return 'pending';
  if (guide.value.points[segId]) return 'saved';
  if (guide.value.skipped.has(segId)) return 'skipped';
  return 'pending';
}

// Submit (only segments with saved points)
async function submitGuidedComplete(group: SegmentGroup) {
  const caveServer = EYEWIRE_II_CAVE_CONFIG.caveServerOverride || '';
  if (!caveServer) { flash('No CAVE server'); return; }
  if (!guide.value) return;

  const toSubmit = group.segmentIds.filter(s => guide.value!.points[s]);
  if (toSubmit.length === 0) { flash('No points captured'); return; }

  const total = toSubmit.length;
  batchProgress.value = { groupId: group.id, action: 'complete', current: 0, total, errors: [] };

  for (let i = 0; i < total; i++) {
    batchProgress.value.current = i + 1;
    const segId = toSubmit[i];
    const pt = guide.value.points[segId];
    // setCellComplete returns false on CAVE auth/network/HTTP failures without
    // throwing — must check the return value or silent failures slip through
    // (CAVE never receives the write, but localStorage is still set, so the
    // lightbulb mistakenly shows complete).
    // Pass suppressCelebration=true so the per-cell overlay doesn't pop N
    // times during a batch; we fire one batch celebration after the loop.
    let ok = false;
    try {
      ok = await setCellComplete(caveServer, segId, true, undefined, pt, true);
    } catch (e) {
      console.error('[batch] setCellComplete threw for', segId, e);
    }
    if (!ok) batchProgress.value.errors.push(segId);
  }
  const errCount = batchProgress.value.errors.length;
  const successCount = total - errCount;
  if (guide.value?.solo) restoreSoloSnapshot();
  flash(`Completed ${successCount}/${total}${errCount ? ` (${errCount} failed)` : ''}`);
  batchProgress.value = null;
  guide.value = null;

  // Single batch celebration once the entire loop finishes — replaces N pops
  // of the per-cell overlay. Pulls the fresh total from Supabase so the count
  // reflects all the writes that just landed.
  if (successCount > 0) {
    try {
      const backend = useProofreadingBackendStore();
      await backend.loadUserStats();
      const statsStore = useUserStatsStore();
      const newTotal = statsStore.stats.cellsSubmitted;
      const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
      backend.pendingCellCelebration = {
        totalCells: newTotal,
        imageUrl: nurro,
        batchCount: successCount,
      };
    } catch { /* non-critical */ }
  }
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

function copySegId(segId: string) {
  navigator.clipboard.writeText(segId).then(() => {
    flash(`Copied ${truncId(segId)}`);
  }).catch(() => {
    flash('Copy failed');
  });
}

/** Demo trigger for the batch celebration overlay. Pulls real total from
 *  Supabase if available so the preview reflects the actual count. */
async function previewBatchCelebration() {
  const backend = useProofreadingBackendStore();
  let total = 42;
  try {
    await backend.loadUserStats();
    const statsStore = useUserStatsStore();
    if (statsStore.stats.cellsSubmitted > 0) total = statsStore.stats.cellsSubmitted;
  } catch {}
  const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
  backend.pendingCellCelebration = {
    totalCells: total,
    imageUrl: nurro,
    batchCount: 12,
  };
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
          <button class="nge-bp-preview" @click.stop="previewBatchCelebration" title="Preview batch celebration">🎉</button>
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

        <!-- Group list, sectioned by dataset -->
        <div class="nge-bp-list" v-if="groups.length > 0">
          <div v-for="section in groupsByDataset" :key="section.dataset" class="nge-bp-dataset-section" :class="{ 'nge-bp-dataset-section--cross': !section.isCurrent }">
            <div class="nge-bp-dataset-header" @click="toggleDatasetSection(section.dataset)">
              <span class="nge-bp-dataset-arrow" :class="{ 'nge-bp-dataset-arrow--collapsed': collapsedDatasets.has(section.dataset) }">▾</span>
              <span class="nge-bp-dataset-name">
                {{ section.label }}
                <span v-if="section.isCurrent" class="nge-bp-dataset-tag nge-bp-dataset-tag--current">current</span>
                <span v-else class="nge-bp-dataset-tag nge-bp-dataset-tag--other">other dataset</span>
              </span>
              <span class="nge-bp-dataset-count">{{ section.groups.length }}</span>
            </div>
            <template v-if="!collapsedDatasets.has(section.dataset)">
          <div v-for="group in section.groups" :key="group.id" class="nge-bp-group">
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
                <button class="nge-bp-act nge-bp-act--complete" @click.stop="startCompleteWizard(group)" :disabled="group.segmentIds.length === 0">
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

              <!-- Confirm dialog (used for 'remove' only — 'complete' uses the guided wizard) -->
              <div v-if="confirmAction && confirmAction.groupId === group.id" class="nge-bp-confirm">
                <span v-if="confirmAction.action === 'remove'">
                  Remove {{ group.segmentIds.length }} segments from viewer?
                </span>
                <div class="nge-bp-confirm-btns">
                  <button class="nge-bp-btn nge-bp-btn--go" @click="batchRemoveFromViewer(group)">Yes</button>
                  <button class="nge-bp-btn nge-bp-btn--sm" @click="confirmAction = null">Cancel</button>
                </div>
              </div>

              <!-- ── Guided "Mark Complete" wizard ── -->
              <div v-if="guide && guide.groupId === group.id" class="nge-bp-guide">
                <!-- Stage 1: Intro -->
                <div v-if="guide.stage === 'intro'" class="nge-bp-guide-intro">
                  <div class="nge-bp-guide-title">Place crosshairs in each cell</div>
                  <p class="nge-bp-guide-text">
                    To batch-complete {{ group.segmentIds.length }} cells, you'll
                    place crosshairs inside each one so CAVE can map points to
                    the right segment. Each cell needs its own point.
                  </p>
                  <div class="nge-bp-guide-actions">
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="loadAllSegmentsIntoViewer(group)">Load all into viewer</button>
                    <button class="nge-bp-btn nge-bp-btn--go" @click="startWalk(group)">Start →</button>
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="cancelCompleteWizard">Cancel</button>
                  </div>
                </div>

                <!-- Stage 2: Walk -->
                <div v-else-if="guide.stage === 'walk'" class="nge-bp-guide-walk">
                  <div class="nge-bp-guide-stepper">
                    Cell {{ guide.index + 1 }} of {{ group.segmentIds.length }}
                    · <span class="nge-bp-guide-color" :style="{ background: getSegmentColor(group.segmentIds[guide.index]) }"></span>
                    <span class="nge-bp-guide-segid">{{ truncId(group.segmentIds[guide.index]) }}</span>
                    <button class="nge-bp-guide-copy" @click="copySegId(group.segmentIds[guide.index])" title="Copy full ID" aria-label="Copy segment ID">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                  </div>
                  <div class="nge-bp-guide-status">
                    <span v-if="segStatus(group.segmentIds[guide.index]) === 'saved'" class="nge-bp-guide-saved">✓ Saved</span>
                    <span v-else-if="segStatus(group.segmentIds[guide.index]) === 'skipped'" class="nge-bp-guide-skipped">— Skipped</span>
                    <span v-else class="nge-bp-guide-pending">Place crosshairs in the cell</span>
                  </div>
                  <label class="nge-bp-guide-solo">
                    <input type="checkbox" :checked="guide.solo" @change="toggleSolo(group)" />
                    <span>Hide other cells</span>
                  </label>
                  <div class="nge-bp-guide-actions">
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="jumpToCurrentSegment(group)">Show in viewer</button>
                    <button class="nge-bp-btn nge-bp-btn--go" @click="saveCurrentPoint(group)">Save Point</button>
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="skipCurrent(group)">Skip</button>
                  </div>
                  <div class="nge-bp-guide-nav">
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="prevSegment(group)" :disabled="guide.index === 0">◂ Prev</button>
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="nextSegment(group)">
                      {{ guide.index === group.segmentIds.length - 1 ? 'Review →' : 'Next ▸' }}
                    </button>
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="cancelCompleteWizard">Cancel</button>
                  </div>
                </div>

                <!-- Stage 3: Review -->
                <div v-else-if="guide.stage === 'review'" class="nge-bp-guide-review">
                  <div class="nge-bp-guide-title">Ready to submit</div>
                  <div class="nge-bp-guide-summary">
                    {{ Object.keys(guide.points).length }} ready ·
                    {{ guide.skipped.size }} skipped ·
                    {{ group.segmentIds.length - Object.keys(guide.points).length - guide.skipped.size }} pending
                  </div>
                  <div class="nge-bp-guide-list">
                    <div v-for="(segId, i) in group.segmentIds" :key="segId" class="nge-bp-guide-item" :class="`nge-bp-guide-item--${segStatus(segId)}`" @click="gotoSegment(group, i)">
                      <span class="nge-bp-guide-item-pip">{{ segStatus(segId) === 'saved' ? '✓' : segStatus(segId) === 'skipped' ? '—' : '?' }}</span>
                      <span class="nge-bp-guide-item-color" :style="{ background: getSegmentColor(segId) }"></span>
                      <span class="nge-bp-guide-item-id">{{ truncId(segId) }}</span>
                      <button class="nge-bp-guide-copy" @click.stop="copySegId(segId)" title="Copy full ID" aria-label="Copy segment ID">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="nge-bp-guide-actions">
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="guide.stage = 'walk'">◂ Back to walk</button>
                    <button class="nge-bp-btn nge-bp-btn--go" @click="submitGuidedComplete(group)" :disabled="Object.keys(guide.points).length === 0">
                      Submit ({{ Object.keys(guide.points).length }})
                    </button>
                    <button class="nge-bp-btn nge-bp-btn--sm" @click="cancelCompleteWizard">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
            </template>
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
  width: 480px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  font-size: 14px;
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
.nge-bp-title { font-size: 1em; font-weight: 700; letter-spacing: 0.03em; color: #eef; }
.nge-bp-close { background: none; border: none; color: #889; font-size: 1.5em; cursor: pointer; padding: 0 4px; line-height: 1; }
.nge-bp-close:hover { color: #eef; }
.nge-bp-preview {
  background: none;
  border: none;
  color: #aab;
  font-size: 1em;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
  margin-right: 4px;
  transition: all 0.15s;
  filter: grayscale(0.3);
  opacity: 0.7;
}
.nge-bp-preview:hover {
  background: rgba(74, 158, 255, 0.12);
  filter: grayscale(0);
  opacity: 1;
  transform: scale(1.15);
}

/* Flash message */
.nge-bp-flash {
  padding: 5px 12px;
  background: rgba(74, 158, 255, 0.12);
  color: #8bf;
  font-size: 0.85em;
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
  padding: 6px 9px;
  border: 1px solid rgba(120, 140, 255, 0.12);
  border-radius: 5px;
  background: rgba(10, 10, 30, 0.5);
  color: #ccd;
  font-size: 0.9em;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.nge-bp-input:focus { border-color: rgba(74, 158, 255, 0.3); }
.nge-bp-input::placeholder { color: #556; }
.nge-bp-input--sm { padding: 4px 7px; font-size: 0.85em; }
.nge-bp-input--flex { flex: 1; min-width: 0; }

.nge-bp-create .nge-bp-input { flex: 1; }

/* Buttons */
.nge-bp-btn {
  padding: 6px 12px;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 5px;
  background: transparent;
  color: #8bf;
  font-size: 0.9em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s;
}
.nge-bp-btn:hover { background: rgba(74, 158, 255, 0.1); }
.nge-bp-btn--create { border-color: rgba(68, 170, 102, 0.25); color: #4a6; }
.nge-bp-btn--create:hover { background: rgba(68, 170, 102, 0.12); }
.nge-bp-btn--add { font-size: 0.85em; padding: 5px 9px; }
.nge-bp-btn--go { border-color: rgba(74, 158, 255, 0.3); color: #4af; }
.nge-bp-btn--go:hover { background: rgba(74, 158, 255, 0.15); }
.nge-bp-btn--go:disabled { opacity: 0.3; cursor: default; }
.nge-bp-btn--sm { font-size: 0.85em; padding: 5px 9px; color: #889; }

/* Progress bar */
.nge-bp-progress {
  padding: 6px 12px;
  background: rgba(74, 158, 255, 0.06);
}
.nge-bp-progress-label { font-size: 0.85em; color: #8bf; margin-bottom: 3px; }
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

/* Dataset section header */
.nge-bp-dataset-section { margin-bottom: 4px; }
.nge-bp-dataset-section--cross { opacity: 0.78; }
.nge-bp-dataset-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  background: rgba(20, 20, 40, 0.55);
  border-bottom: 1px solid rgba(120, 140, 255, 0.06);
  cursor: pointer;
  user-select: none;
  font-size: 0.82em;
  color: #aab;
  letter-spacing: 0.02em;
}
.nge-bp-dataset-header:hover { background: rgba(74, 158, 255, 0.07); color: #cde; }
.nge-bp-dataset-arrow {
  font-size: 0.85em;
  color: #667;
  transition: transform 0.15s;
  width: 10px;
}
.nge-bp-dataset-arrow--collapsed { transform: rotate(-90deg); }
.nge-bp-dataset-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.nge-bp-dataset-tag {
  font-size: 0.85em;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.nge-bp-dataset-tag--current {
  background: rgba(74, 158, 255, 0.15);
  color: #4af;
}
.nge-bp-dataset-tag--other {
  background: rgba(255, 170, 68, 0.12);
  color: #fa4;
}
.nge-bp-dataset-count {
  font-size: 0.85em;
  background: rgba(120, 140, 255, 0.1);
  color: #8bf;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

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
.nge-bp-group-chevron { font-size: 0.85em; color: #667; width: 10px; }
.nge-bp-group-name { font-size: 0.95em; font-weight: 600; color: #dde; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-bp-group-count {
  font-size: 0.78em;
  background: rgba(120, 140, 255, 0.1);
  color: #8bf;
  padding: 2px 6px;
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
  gap: 3px;
  padding: 3px 7px;
  background: rgba(120, 140, 255, 0.08);
  border: 1px solid rgba(120, 140, 255, 0.1);
  border-radius: 4px;
  font-size: 0.82em;
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
  font-size: 0.85em;
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
  padding: 6px 11px;
  border: 1px solid rgba(120, 140, 255, 0.1);
  border-radius: 4px;
  background: transparent;
  color: #889;
  font-size: 0.88em;
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
.nge-bp-sub-label { font-size: 0.85em; color: #889; font-weight: 600; }

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
  padding: 5px 7px;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 4px;
  background: rgba(10, 10, 30, 0.5);
  color: #ccd;
  font-size: 0.88em;
  font-family: inherit;
  outline: none;
  flex: 1;
  min-width: 0;
}

/* Confirm dialog */
.nge-bp-confirm {
  margin-top: 6px;
  padding: 7px 10px;
  background: rgba(255, 100, 100, 0.06);
  border: 1px solid rgba(255, 100, 100, 0.15);
  border-radius: 6px;
  font-size: 0.88em;
  color: #f99;
}
.nge-bp-confirm-btns { display: flex; gap: 4px; margin-top: 4px; }

/* Empty state */
.nge-bp-empty {
  padding: 24px 16px;
  text-align: center;
  color: #556;
  font-size: 0.92em;
}

/* ── Guided Mark Complete wizard ── */
.nge-bp-guide {
  margin-top: 6px;
  padding: 10px;
  background: rgba(74, 158, 255, 0.06);
  border: 1px solid rgba(74, 158, 255, 0.18);
  border-radius: 6px;
  font-size: 0.95em;
  color: #cde;
}
.nge-bp-guide-title {
  font-weight: 700;
  font-size: 1.05em;
  color: #cef;
  margin-bottom: 5px;
}
.nge-bp-guide-text {
  font-size: 0.92em;
  color: #aab;
  line-height: 1.45;
  margin: 0 0 10px;
}
.nge-bp-guide-stepper {
  font-size: 0.95em;
  color: #cde;
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.nge-bp-guide-color {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  flex-shrink: 0;
  vertical-align: middle;
}
.nge-bp-guide-segid {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  color: #8bf;
}
.nge-bp-guide-status {
  font-size: 0.92em;
  margin-bottom: 7px;
}
.nge-bp-guide-saved { color: #7ec07e; }
.nge-bp-guide-skipped { color: #aab; font-style: italic; }
.nge-bp-guide-pending { color: #aab; font-style: italic; }
.nge-bp-guide-solo {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  font-size: 0.92em;
  color: #aab;
  cursor: pointer;
  user-select: none;
}
.nge-bp-guide-solo:hover { color: #cde; }
.nge-bp-guide-solo input[type="checkbox"] {
  accent-color: #4af;
  cursor: pointer;
  margin: 0;
  width: 14px;
  height: 14px;
}
.nge-bp-guide-actions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 5px;
}
.nge-bp-guide-nav {
  display: flex;
  gap: 5px;
  padding-top: 5px;
  border-top: 1px solid rgba(120, 140, 255, 0.08);
}
.nge-bp-guide-summary {
  font-size: 0.92em;
  color: #cde;
  margin-bottom: 7px;
}
.nge-bp-guide-list {
  max-height: 160px;
  overflow-y: auto;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nge-bp-guide-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 7px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.92em;
}
.nge-bp-guide-item:hover { background: rgba(74, 158, 255, 0.1); }
.nge-bp-guide-item--saved { color: #7ec07e; }
.nge-bp-guide-item--skipped { color: #777; font-style: italic; }
.nge-bp-guide-item--pending { color: #ffd08a; }
.nge-bp-guide-item-pip { width: 14px; text-align: center; flex-shrink: 0; }
.nge-bp-guide-item-color {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  flex-shrink: 0;
}
.nge-bp-guide-item-id { font-family: ui-monospace, 'Cascadia Code', monospace; flex: 1; }
.nge-bp-guide-copy {
  background: none;
  border: none;
  color: #889;
  cursor: pointer;
  padding: 3px 5px;
  border-radius: 3px;
  transition: all 0.12s;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}
.nge-bp-guide-copy svg {
  width: 13px;
  height: 13px;
  display: block;
}
.nge-bp-guide-copy:hover {
  background: rgba(120, 140, 255, 0.15);
  color: #cde;
}
</style>
