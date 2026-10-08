<script setup lang="ts">
import { reportWriteFailure } from '../util/error_reporting';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { snapshotPanel, morphIntoSlim, revealWithBeam, whenSettled } from '../util/panel_collapse';
import {
  useProofreadingBackendStore,
  useProofreadingQueueStore,
  useLoginStore,
  useCellHistoryStore,
  useHelpRequestStore,
  useUserStatsStore,
  useWorkingLinksStore,
  useIssueTagStore,
  useUserPreferencesStore,
  isModelTag,
  type IssueTag,
  type ProofreadingTask,
  type HelpRequest,
  type WorkingLink,
  type ClaimPoint,
  jumpAddsToView,
  LIVE_HELP,
  isLiveHelp,
} from '../store';
import { getDatasetCaveConfig } from '../config';
import { setCellComplete, activeCaveServer } from '../widgets/lightbulb_service';
import { syncCellToSheet, completeStatusesFor } from '../sheet_sync';
import { cellAtCrosshair, type CrosshairCell } from '../util/crosshair_cell';
import { getRootFromSupervoxel, ancestorAmong } from '../widgets/pcg_service';
import { mintShortStateLink } from '../util/state_link';
import { teamAccess } from '../util/team_session';
import { teamsState, createTeam } from '../util/teams';
import TeamsTab from './TeamsTab.vue';
import { pendingCompleteRequest } from '../util/complete_claim';
import { snapshotDisplay, restoreDisplayAfterLoad, keepDisplayEnabled } from '../util/keep_display';
import { findDatasetBySegName, findDatasetByCanonical, switchToDataset, canonicalDataset, segLayerName, currentSegLayerName, currentSegLayer, datasetDisplayName, DATASETS, DATASET_GROUPS, SPECIES_ICONS, type DatasetEntry } from '../datasets';
import { CONNECTOME_QUEST_RESOURCES } from '../data/connectome-quest';
import scytheIcon from '../../static/tags/scythe-icon.png';
import { scoutPinSvg } from '../data/toolbar-icons';

const tagPinSvg = scoutPinSvg();
import { runPanelTrace, flyPlusOne, runScytheSwing } from '../util/holo_trace';
import tracerIcon from '../../static/tags/tracer-icon.png';
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
import { applyShowcaseWhenLoaded } from '../showcase';
import { datasetHasTour, startDatasetTour } from '../dataset_tour';
import { Uint64 } from 'neuroglancer/util/uint64';
import ScreenshotDialog from './ScreenshotDialog.vue';

const props = defineProps<{ initialTab?: string }>();
const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();
const queue = useProofreadingQueueStore();
const login = useLoginStore();
const history = useCellHistoryStore();
const helpStore = useHelpRequestStore();
const linksStore = useWorkingLinksStore();
const tagStore = useIssueTagStore();

// Particle trace on arrival (scifi-ui): the beam runs the panel boundary once.
const panelEl = ref<HTMLElement | null>(null);
onMounted(() => {
  // Trace the border the panel ends up with: wait until it has stopped
  // growing (the list fills in after it opens), or the light misses the
  // real edge (Ames 2026-10-01).
  setTimeout(() => {
    const el = panelEl.value;
    if (el) whenSettled(el, () => { if (panelEl.value && !slim.value) runPanelTrace(panelEl.value); });
  }, 60);
});

/** Resolve a tag: the orbital itself is the hero (Amy). It winds up around
 *  the button, two accelerating laps with the same behind-the-button
 *  occlusion as its idle orbit, then catapults to the profile with the
 *  existing comet. The store resolve waits for the catapult, because the
 *  row unmounts the moment the tag leaves the open list. */
const spinningTags = new Set<string>();
function resolveTagFun(tag: IssueTag, e: MouseEvent) {
  if (spinningTags.has(tag.id)) return;
  // Grim salutes: resolving a Cut tag gets the scythe swing.
  if (tag.tagType === 'merger') runScytheSwing(e.clientX, e.clientY, scytheIcon);
  // The moment of glory (Amy).
  tagSuccessToast.value = true;
  if (tagToastTimer) clearTimeout(tagToastTimer);
  tagToastTimer = setTimeout(() => { tagSuccessToast.value = false; }, 2100);
  const wrap = (e.currentTarget as HTMLElement | null)?.closest?.('.nge-orbit-wrap') as HTMLElement | null;
  const dot = wrap?.querySelector('.nge-orbit-dot') as HTMLElement | null;
  if (!dot || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    flyPlusOne(e.clientX, e.clientY, '●', '53,181,255');
    tagStore.resolve(tag.id);
    return;
  }
  spinningTags.add(tag.id);
  dot.style.animation = 'none';
  const t0 = performance.now();
  const SPIN = 640;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / SPIN);
    const a = k * k * 720; // ease-in wind-up, two laps
    const behind = (a % 360) >= 180;
    dot.style.transform = `rotate(${a}deg) translateX(19px) scale(${behind ? 0.75 : 1})`;
    dot.style.zIndex = behind ? '0' : '2';
    dot.style.opacity = behind ? '0.55' : '1';
    if (k < 1) { requestAnimationFrame(step); return; }
    const r = dot.getBoundingClientRect();
    dot.style.visibility = 'hidden';
    flyPlusOne(r.left + r.width / 2, r.top + r.height / 2, '●', '53,181,255');
    spinningTags.delete(tag.id);
    tagStore.resolve(tag.id);
    setTimeout(() => {
      dot.style.visibility = ''; dot.style.animation = '';
      dot.style.transform = ''; dot.style.zIndex = ''; dot.style.opacity = '';
    }, 400);
  };
  requestAnimationFrame(step);
}
/** One rotating mote at a time around the JUMP buttons: one full loop,
 *  then on to the next row, relaying through every row in view (Amy).
 *  Each appearance is a fresh mount, so the orbit starts clean, does its
 *  lap, and hands off to the next row. */
const orbitSeq = ref(0);
const orbitTimer = setInterval(() => { orbitSeq.value += 1; }, 2800);
onBeforeUnmount(() => clearInterval(orbitTimer));
function orbitOn(idx: number, len: number): boolean {
  return len > 0 && orbitSeq.value % len === idx;
}
const tagSuccessToast = ref(false);
let tagToastTimer: ReturnType<typeof setTimeout> | null = null;

/** Deleting a tag is destructive for everyone, so the trashcan asks first:
 *  first click arms the row's confirm, which auto-disarms after 4s. */
const confirmDeleteTagId = ref<string | null>(null);
let confirmDeleteTimer: ReturnType<typeof setTimeout> | null = null;
function askDeleteTag(tag: IssueTag) {
  confirmDeleteTagId.value = tag.id;
  if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
  confirmDeleteTimer = setTimeout(() => { confirmDeleteTagId.value = null; }, 4000);
}
function confirmDeleteTag(tag: IssueTag) {
  tagStore.remove(tag.id);
  confirmDeleteTagId.value = null;
}

const loading = ref(false);
const filter = ref<'mine' | 'all' | 'available' | 'completed' | 'claimed' | 'help' | 'links' | 'tags' | 'ai' | 'teams'>(
  (props.initialTab as any) || 'mine',
);
const search = ref('');
const claimError = ref('');
let claimErrorTimer: ReturnType<typeof setTimeout> | null = null;

// ── Point-based root ID resolution ──────────────────────────────────
const resolving = ref(false);

/** Resolve all claimed tasks' claim points to current root IDs via PCG. */
async function resolveClaimPoints() {
  resolving.value = true;
  try {
    await backend.refreshSegmentIds();
    await backend.refreshLiveRoots();
  } catch (e) {
    console.warn('[cellLibrary] point-based resolution failed:', e);
  }
  resolving.value = false;
}

const copiedId = ref<string | null>(null);
/** Last cell the user jumped to — highlighted in the list so it's easy to find
 *  again when the Available list is long. */
const jumpedSegId = ref<string | null>(null);
function copyId(id: string) {
  navigator.clipboard.writeText(id).then(() => {
    copiedId.value = id;
    setTimeout(() => { copiedId.value = null; }, 1200);
  });
}

// ── Data loading ─────────────────────────────────────────────────────
/** Load the Cell Library sheet for the currently-active dataset, tagging every
 *  cell with that dataset. Each dataset keeps its own sheet (config
 *  `cellLibrarySheetUrl`); we only (re)load when the active dataset's sheet
 *  isn't already the one in the queue. */
/** The active dataset's proofreading instructions, if it has any (MEC). */
const datasetInstructionsUrl = computed(() => getDatasetCaveConfig(activeDataset.value).instructionsUrl || '');
/** In-app how-to steps (Retina). When present, "instructions" opens these
 *  here instead of an external page. */
const datasetHowTo = computed(() => getDatasetCaveConfig(activeDataset.value).howToSteps || null);
const showHowTo = ref(false);
/** A view with one example of each cell type (MEC), loaded in place. */
const datasetCellTypesState = computed(() => {
  const cfg = getDatasetCaveConfig(activeDataset.value);
  return cfg.cellTypesUrl || cfg.cellTypesState || null;
});
/** The dataset has a guided tour of its cell types (MEC), replayable here. */
const datasetTour = computed(() => datasetHasTour(activeDataset.value));
function openCellTypes() {
  const st = datasetCellTypesState.value;
  if (!st) return;
  if (typeof st === 'string') {
    // A registered showcase link: src/showcase.ts sets the view up once it
    // loads (3D only, Seg tab key, no leaderboard), on any route in.
    window.location.hash = '#!' + st;
    return;
  }
  const viewer: any = (window as any)['viewer'];
  const before = new Set(viewer?.layerManager?.managedLayers ?? []);
  window.location.hash = '#!' + encodeURIComponent(JSON.stringify(st));
  applyShowcaseWhenLoaded(before);
}

async function loadCellsForActiveDataset() {
  const dsName = getCurrentDatasetName();
  activeDataset.value = dsName;
  const cfg = getDatasetCaveConfig(dsName);
  // No fallback sheet: borrowing the pinky sheet here tagged its rows with the
  // current dataset, so MEC listed pinky cells (6485... ids) that have no
  // segmentation in the MEC graph (Ames 2026-09-28). A dataset without its own
  // segment-ID sheet (MEC, MICrONS) lists only its Supabase tasks.
  const sheetUrl = cfg.cellLibrarySheetUrl;
  if (!sheetUrl) { queue.items = []; return; }
  if (queue.sheetUrl !== sheetUrl || queue.items.length === 0) {
    await queue.loadFromSheet(sheetUrl, canonicalDataset(dsName));
  }
}

// Follow the viewer's dataset while the panel is open. activeDataset used to
// be read once on mount, so switching datasets from the top bar left the
// panel on the old one: on Retina it still called MEC "CURRENT", and jumping
// to a MEC help request dropped MEC root IDs into the Retina layer
// (Amy 2026-09-25). layersChanged fires on every dataset switch.
function syncActiveDataset() {
  const live = getCurrentDatasetName();
  if (live && canonicalDataset(live) !== canonicalDataset(activeDataset.value)) {
    loadCellsForActiveDataset();
  }
}
let unsubLayers: (() => void) | null = null;
onMounted(() => {
  const lm = (window as any)['viewer']?.layerManager;
  if (lm?.layersChanged?.add) unsubLayers = lm.layersChanged.add(syncActiveDataset);
});
onBeforeUnmount(() => { unsubLayers?.(); });

onMounted(async () => {
  loading.value = true;
  // Load tasks from Supabase — these have claim/completion status
  await backend.loadTasks();
  // Load the cell list for the active dataset (each dataset has its own sheet)
  await loadCellsForActiveDataset();
  loading.value = false;
  // Fire-and-forget: resolve claim points to current root IDs via PCG
  resolveClaimPoints();
  // Refresh help requests from Supabase
  helpStore.load();
});

// ── Derived data ─────────────────────────────────────────────────────
const isLoggedIn = computed(() => !!backend.userId);

/** Merge queue items (from sheet) with backend tasks (from Supabase).
 *  Supabase tasks are the source of truth for status/assignment. */
/** Helper to extract claim point from a task. */
function taskClaimPoint(t: ProofreadingTask): ClaimPoint | null {
  if (t.claim_point_x != null && t.claim_point_y != null && t.claim_point_z != null) {
    return [t.claim_point_x, t.claim_point_y, t.claim_point_z];
  }
  return null;
}

/** Map a sheet 'Status' string (Stroeh sheet) to the cell status enum. Used
 *  for cells that have no Supabase task (their status lives in the sheet). */
function mapSheetStatus(s?: string): 'pending' | 'in_progress' | 'completed' {
  const t = (s || '').toLowerCase();
  if (!t) return 'pending';
  // 'Complete', 'Complete (cut off)', and 'Not BC' are all dispositioned —
  // treat as done so they don't show as available to claim.
  if (t.includes('complete') || t.includes('done') || t.includes('finished') || t.includes('not bc') || t.includes('notbc')) return 'completed';
  if (t.includes('progress') || t.includes('claim') || t.includes('working') || t.includes('started')) return 'in_progress';
  return 'pending';
}

const cells = computed(() => {
  const taskMap = new Map<string, ProofreadingTask>();
  for (const t of backend.tasks) {
    taskMap.set(t.segment_id, t);
  }

  const sheetSegIds = new Set<string>();

  // Use queue items as the base list (from the Google Sheet)
  if (queue.items.length > 0) {
    const sheetCells = queue.items.map((item, idx) => {
      sheetSegIds.add(item.segId);
      const task = taskMap.get(item.segId);
      return {
        segId: task?.segment_id || item.segId,  // use resolved root from task if available
        index: item.index || String(idx + 1),
        nucCoords: item.nucCoords,
        somaCoords: task?.soma_coords || item.somaCoords || '',
        notes: item.notes,
        dataset: item.dataset || '',            // dataset this cell's sheet is for
        sheetAssignee: item.assignee || '',     // proofreader name from the sheet (display only)
        // Supabase task is source of truth for status/claim when it exists;
        // otherwise fall back to the sheet's own Status column (Stroeh).
        taskId: task?.id ?? null,
        status: task?.status ?? mapSheetStatus(item.sheetStatus),
        assignedTo: task?.assigned_to ?? null,
        finalSegId: task?.final_segment_id ?? null,
        completedByName: null as string | null,
        // Point-in-space claim anchor
        claimPoint: task ? taskClaimPoint(task) : null,
        startLink: item.startLink || '',
        svId: task?.supervoxel_id ?? null,
        nucleusId: task?.final_nucleus_id ?? null,
        // The cell's ID after your edits, when it differs from the listed one.
        liveSegId: (task && backend.liveRoots[task.id] && backend.liveRoots[task.id] !== item.segId) ? backend.liveRoots[task.id] : null as string | null,
      };
    });

    // Include Supabase tasks not in the sheet (orphaned claims)
    const extraTasks = backend.tasks
      .filter(t => !sheetSegIds.has(t.segment_id))
      .map(t => ({
        segId: t.segment_id,
        index: '',
        nucCoords: t.nucleus_coords || '',
        somaCoords: t.soma_coords || '',
        notes: t.notes || '',
        dataset: (t as any).dataset || '',
        sheetAssignee: '',
        taskId: t.id,
        status: t.status,
        assignedTo: t.assigned_to,
        finalSegId: t.final_segment_id,
        completedByName: null as string | null,
        claimPoint: taskClaimPoint(t),
        startLink: '',
        svId: t.supervoxel_id ?? null,
        nucleusId: t.final_nucleus_id ?? null,
        liveSegId: null as string | null,
      }));

    return [...sheetCells, ...extraTasks];
  }

  // Fallback: use Supabase tasks directly
  return backend.tasks.map(t => ({
    segId: t.segment_id,
    index: '',
    nucCoords: t.nucleus_coords || '',
    somaCoords: t.soma_coords || '',
    notes: t.notes || '',
    dataset: (t as any).dataset || '',
    sheetAssignee: '',
    taskId: t.id,
    status: t.status,
    assignedTo: t.assigned_to,
    finalSegId: t.final_segment_id,
    completedByName: null as string | null,
    claimPoint: taskClaimPoint(t),
    startLink: '',
    svId: t.supervoxel_id ?? null,
    nucleusId: t.final_nucleus_id ?? null,
  }));
});

/** Cells scoped to the dataset currently in the viewer. When a dataset is
 *  active we hide cells tagged for a different dataset; untagged cells (no
 *  dataset value yet, pre-backfill) always show so nothing silently vanishes
 *  during the sheet migration. Tab counts and every filtered view derive from
 *  this so "Available (N)" always matches the list you can actually claim. */
const datasetScopedCells = computed(() => {
  const activeDs = canonicalDataset(activeDataset.value);
  if (!activeDs) return cells.value;
  return cells.value.filter(c => {
    const cd = canonicalDataset(c.dataset);
    return !cd || cd === activeDs;
  });
});

const filteredCells = computed(() => {
  let list = datasetScopedCells.value;
  if (filter.value === 'mine') {
    // My claimed cells first, then my completed cells
    const myClaimed = list.filter(c => isMyClaim(c));
    const myCompleted = list.filter(c => c.status === 'completed' && c.assignedTo === backend.userId);
    list = [...myClaimed, ...myCompleted];
  } else if (filter.value === 'available') {
    list = list.filter(c => c.status === 'pending');
  } else if (filter.value === 'claimed') {
    list = list.filter(c => c.status === 'assigned' || c.status === 'in_progress');
  } else if (filter.value === 'completed') {
    list = list.filter(c => c.status === 'completed');
  }
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    list = list.filter(c =>
      c.segId.toLowerCase().includes(q) ||
      (c.index || '').toLowerCase().includes(q) ||
      (c.notes || '').toLowerCase().includes(q) ||
      (history.getNickname(c.segId) || '').toLowerCase().includes(q),
    );
  }
  return list;
});

// Draw the list a slice at a time: thousands of rows made the panel slow to
// open and to switch tabs (Ames 2026-10-01). Counts and search still cover
// every cell; only the drawing is capped.
const ROWS_STEP = 200;
const rowsShown = ref(ROWS_STEP);
watch([filter, search], () => { rowsShown.value = ROWS_STEP; });
const shownCells = computed(() => filteredCells.value.slice(0, rowsShown.value));

const myClaimCount = computed(() => datasetScopedCells.value.filter(c => isMyClaim(c)).length);

const availableCount = computed(() => datasetScopedCells.value.filter(c => c.status === 'pending').length);
const completedCount = computed(() => datasetScopedCells.value.filter(c => c.status === 'completed').length);
const claimedCount = computed(() => datasetScopedCells.value.filter(c => c.status === 'assigned' || c.status === 'in_progress').length);

// ── Dataset labels for the empty-Available prompt ────────────────────
/** Friendly label of the dataset currently in the viewer. */
const currentDatasetLabel = computed(() => {
  const raw = activeDataset.value;
  const entry = findDatasetBySegName(raw)
    || DATASETS.find(d => canonicalDataset(segLayerName(d)) === canonicalDataset(raw));
  return entry?.label || raw || 'this dataset';
});
/** A known claimable dataset other than the current one — prefer EyeWire II
 *  Retina (the main cell library), else the first other known dataset. Used to
 *  tell the user where to go when the current dataset has no cells to claim. */
const suggestedClaimDataset = computed(() => {
  const curKey = canonicalDataset(activeDataset.value);
  const stroeh = DATASETS.find(d => d.id === 'stroeh_mouse_retina');
  if (stroeh && canonicalDataset(segLayerName(stroeh)) !== curKey) return stroeh.label;
  const other = DATASETS.find(d => canonicalDataset(segLayerName(d)) !== curKey);
  return other?.label || '';
});

// ── User name lookup (for claimed tab) ───────────────────────────────
const userNameCache = ref<Record<string, string>>({});
const pendingResolves = new Set<string>();
async function resolveUserName(userId: string): Promise<string> {
  if (userNameCache.value[userId]) return userNameCache.value[userId];
  if (pendingResolves.has(userId)) return userId.slice(0, 8);
  pendingResolves.add(userId);
  try {
    const { supabase } = await import('../supabase');
    const { data } = await supabase
      .from('users')
      .select('display_name, username')
      .eq('id', userId)
      .single();
    // Was falling back to the local part of middleauth_email, which pulled
    // other people's full addresses to the client just to derive a label.
    // The username is the public identifier, so use that instead.
    const name = data?.display_name || data?.username || userId.slice(0, 8);
    userNameCache.value = { ...userNameCache.value, [userId]: name };
    return name;
  } catch {
    const fallback = userId.slice(0, 8);
    userNameCache.value = { ...userNameCache.value, [userId]: fallback };
    return fallback;
  } finally {
    pendingResolves.delete(userId);
  }
}
function getCachedUserName(userId: string): string {
  if (!userId) return '?';
  if (userId === backend.userId) return 'You';
  if (!userNameCache.value[userId]) {
    resolveUserName(userId);
    return '…';
  }
  return userNameCache.value[userId];
}

// ── Each claim keeps its own view (Amy 2026-09-28) ───────────────────
// Retina players annotate a cell in its own layers (Soma, True End, Can't Fix,
// Hits Edge, Notes), which live only in the viewer state. Moving to another
// claim first saves the current view to the claim you were working on, then
// loads the next claim's saved view (or its sheet Start link).
const WORKING_KEY = 'nge_cl_working_task';
let workingTaskId: number | null = (() => {
  try { const v = Number(localStorage.getItem(WORKING_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
})();
function setWorkingTask(id: number | null) {
  workingTaskId = id;
  try { id ? localStorage.setItem(WORKING_KEY, String(id)) : localStorage.removeItem(WORKING_KEY); } catch {}
}
/** Save the view to the claim being worked on. False = stay put. */
async function leaveCurrentWork(nextTaskId: number | null): Promise<boolean> {
  const id = workingTaskId;
  if (!id || id === nextTaskId) return true;
  const t = backend.tasks.find(x => x.id === id);
  if (!t || t.assigned_to !== backend.userId || (t.status !== 'assigned' && t.status !== 'in_progress')) return true;
  const link = await mintShortStateLink();
  if (link && await backend.saveWorkingLink(id, link)) return true;
  const row = queue.items.find(i => i.segId === t.segment_id);
  return window.confirm(`Your work on ${row?.index || 'your current cell'} could not be saved. Switch anyway? Its unsaved annotations would be lost.`);
}
// ── Save view: keep this claim's annotations and layers on demand ──────────
// The view is also saved when you switch to another claim, but a reload, a
// dataset switch or opening a link would lose anything unsaved (Ames).
const savingView = ref<number | null>(null);
const savedViewAt = ref<Record<number, number>>({});
const isWorkingClaim = (cell: CellRow) =>
  !!cell.taskId && isMyClaim(cell) && (cell.taskId === workingTaskId || cell.segId === jumpedSegId.value);
async function saveClaimView(cell: CellRow) {
  if (!cell.taskId || savingView.value) return;
  savingView.value = cell.taskId;
  claimError.value = '';
  try {
    const link = await mintShortStateLink();
    if (link && await backend.saveWorkingLink(cell.taskId, link)) {
      setWorkingTask(cell.taskId);
      savedViewAt.value = { ...savedViewAt.value, [cell.taskId]: Date.now() };
      setTimeout(() => { const n = { ...savedViewAt.value }; delete n[cell.taskId!]; savedViewAt.value = n; }, 2500);
    } else {
      claimError.value = 'Could not save this view. Try again in a moment.';
    }
  } catch (e: any) {
    claimError.value = e?.message || 'Could not save this view.';
  } finally {
    savingView.value = null;
  }
}

/** Go to one of your claims with its own layers. */
async function switchToClaim(cell: CellRow) {
  // Already working on this claim: its layers are loaded, so just move the
  // camera. Reloading its saved view would drop anything done since the save.
  if (!cell.taskId || cell.taskId === workingTaskId) return jumpToCell(cell.segId, cell.nucCoords || cell.somaCoords, cell.nucleusId, true, cell.liveSegId);
  if (!(await leaveCurrentWork(cell.taskId))) return;
  const t = backend.tasks.find(x => x.id === cell.taskId);
  if (!openStartLink(t?.working_link || cell.startLink)) jumpToCell(cell.segId, cell.nucCoords || cell.somaCoords, cell.nucleusId, false, cell.liveSegId);
  else void backend.anchorClaimAt(cell.taskId).catch(() => null);
  jumpedSegId.value = cell.segId;
  setWorkingTask(cell.taskId);
}

// ── Actions ──────────────────────────────────────────────────────────
/** A jump replaces what is on screen with the target cell, so first save
 *  the claim being worked on (its extra segments and annotations) and stop
 *  treating it as loaded: its ↗ then brings the saved view back.
 *  keep = the target IS the claim being worked on, nothing is cleared.
 *  ok false = the save failed and the user chose to stay. */
async function prepareJump(segId: string): Promise<{ ok: boolean; keep: boolean }> {
  // Settings: jumps add to the view, so nothing is cleared or left behind.
  if (jumpAddsToView()) return { ok: true, keep: true };
  const t = workingTaskId ? backend.tasks.find(x => x.id === workingTaskId) : null;
  if (t && String(t.segment_id) === segId) return { ok: true, keep: true };
  if (!(await leaveCurrentWork(null))) return { ok: false, keep: false };
  setWorkingTask(null);
  return { ok: true, keep: false };
}
/** keep: add the cell to the view instead of replacing it (your own working claim). */
/** showSeg: the cell's current ID after edits. The row is still known by
 *  segId (its listed ID), so "viewing" and the slim view keep working. */
function jumpToCell(segId: string, coords: string, nucleusId?: string | null, keep = false, showSeg?: string | null) {
  const pos = parseCoords(coords);
  history.jumpToCell(showSeg || segId, pos[0] || pos[1] || pos[2] ? pos : undefined, { keep });
  if (!showSeg && (pos[0] || pos[1] || pos[2])) void settleClaimAfterJump(segId, pos);
  jumpedSegId.value = segId;
  // MEC: the nucleus is its own segment; show it too so the soma isn't hollow.
  if (nucleusId && nucleusId !== segId) setTimeout(() => {
    try { currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments?.add(Uint64.parseString(nucleusId)); } catch { /* layer not ready */ }
  }, 400);
}

/** One of my claims was opened by its listed ID because its current ID was
 *  not known (splits left several pieces). The viewer is now on its nucleus:
 *  read what is there, and if the cell has a newer ID, show that instead. */
async function settleClaimAfterJump(segId: string, pos: [number, number, number]) {
  const cell = cells.value.find(c => c.segId === segId);
  if (!cell?.taskId || !isMyClaim(cell) || cell.status === 'completed') return;
  const root = await backend.anchorClaimAt(cell.taskId, pos).catch(() => null);
  if (!root || root === segId || jumpedSegId.value !== segId) return;
  try {
    const visible = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (!visible) return;
    visible.delete(Uint64.parseString(segId));
    visible.add(Uint64.parseString(root));
  } catch { /* layer went away */ }
}

function parseCoords(s: string): [number, number, number] {
  if (!s) return [0, 0, 0];
  const parts = s.split(',').map(p => parseInt(p.trim(), 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Cells being claimed right now: their Claim buttons show a spinner. */
const claiming = reactive(new Set<string>());
async function claimCell(cell: typeof cells.value[0]) {
  const key = cellKey(cell);
  if (claiming.has(key)) return;
  claiming.add(key);
  try { await claimCellNow(cell); } finally { claiming.delete(key); }
}

async function claimCellNow(cell: typeof cells.value[0]) {
  if (!isLoggedIn.value) return;
  claimError.value = '';
  // The limit is per dataset (10 on Retina, 8 elsewhere).
  const held = heldHere(await backend.loadMyActiveClaims());
  if (held.length >= backend.claimLimitFor()) { pendingClaim = cell; showClaimLimit(held); return; }
  // Derive claim point: use cell's existing claim point, parse nucCoords, or use viewer position
  let point: ClaimPoint;
  if (cell.claimPoint) {
    point = cell.claimPoint;
  } else if (cell.nucCoords) {
    const parsed = parseCoords(cell.nucCoords);
    point = parsed[0] || parsed[1] || parsed[2] ? parsed : getViewerPos();
  } else {
    point = getViewerPos();
  }
  const result = cell.taskId
    ? { ok: await backend.claimTask(cell.taskId), reason: backend.error }
    : await backend.claimCell(point, cell.segId);
  if (!result.ok && /max \d+ claims/i.test(result.reason || '')) {
    pendingClaim = cell;
    showClaimLimit(await backend.loadMyActiveClaims());
    return;
  }
  if (!result.ok) {
    claimError.value = result.reason || 'Claim failed';
    if (claimErrorTimer) clearTimeout(claimErrorTimer);
    claimErrorTimer = setTimeout(() => { claimError.value = ''; }, 5000);
    return;
  }
  // Write claim to Google Sheet (best-effort)
  syncCellToSheet('claim', cell.segId, undefined, cell.dataset).catch(showSheetError);
  await backend.loadTasks();
  // Open the cell's curated starting view (sheet "Start link", column E), so
  // the claimer lands with its Soma / True End / Can't Fix / Hits Edge / Notes
  // layers (Amy 2026-09-28). Save the claim you were on first.
  const claimed = backend.tasks.find(t => t.segment_id === cell.segId && t.assigned_to === backend.userId
    && (t.status === 'assigned' || t.status === 'in_progress'));
  if (await leaveCurrentWork(claimed?.id ?? null)) {
    openStartLink(cell.startLink);
    if (claimed) setWorkingTask(claimed.id);
  }
  // Give the claim its soma anchor as soon as that part of the volume loads.
  if (claimed) void backend.anchorClaimAt(claimed.id).catch(() => null);
}

// ── Claim limit: name every claim you hold, in any dataset, with Release ──
const claimLimit = ref<ProofreadingTask[] | null>(null);
/** The cell you tried to claim when the limit stopped you. Releasing a claim
 *  from the list claims it straight away, so the list collapsing under the
 *  mouse can't turn your next click into a claim on the wrong row. */
let pendingClaim: CellRow | null = null;
function dismissClaimLimit() { claimLimit.value = null; pendingClaim = null; }
function showClaimLimit(held: ProofreadingTask[]) {
  claimLimit.value = held.length ? held : null;
  if (!held.length) claimError.value = `Max ${backend.claimLimitFor()} claims reached`;
}
/** Your active claims in the dataset on screen (the limit is per dataset). */
function heldHere(held: ProofreadingTask[]): ProofreadingTask[] {
  const here = canonicalDataset(getCurrentDatasetName());
  return held.filter(t => canonicalDataset((t as any).dataset) === here);
}

// ── Batch claim (Amy 2026-09-30): fill your claims in one click ─────────
// Claims the next available cells from the list, top down, up to your limit
// (10 on Retina). Each needs its own point: the sheet's soma coordinates.
const batchClaiming = ref<{ done: number; total: number } | null>(null);
const batchRoom = computed(() => Math.max(0, backend.claimLimitFor() - backend.myActiveClaimCount()));
async function batchClaim() {
  if (!isLoggedIn.value || batchClaiming.value) return;
  const room = heldHere(await backend.loadMyActiveClaims());
  const n = backend.claimLimitFor() - room.length;
  if (n <= 0) { showClaimLimit(room); return; }
  const picks = filteredCells.value.filter(c => {
    if (c.status !== 'pending' || !c.segId) return false;
    const p = c.claimPoint ?? parseCoords(c.somaCoords || c.nucCoords);
    return !!(p[0] || p[1] || p[2]);
  }).slice(0, n);
  if (!picks.length) { claimError.value = 'No available cells with a starting point to claim.'; return; }
  batchClaiming.value = { done: 0, total: picks.length };
  let ok = 0, lastError = '';
  for (const c of picks) {
    const point = (c.claimPoint ?? parseCoords(c.somaCoords || c.nucCoords)) as ClaimPoint;
    const r = c.taskId ? { ok: await backend.claimTask(c.taskId), reason: backend.error } : await backend.claimCell(point, c.segId);
    if (r.ok) {
      ok++;
      syncCellToSheet('claim', c.segId, undefined, c.dataset).catch(showSheetError);
    } else {
      lastError = r.reason || 'Claim failed';
      if (/max \d+ claims/i.test(lastError)) break;
    }
    batchClaiming.value = { done: batchClaiming.value!.done + 1, total: picks.length };
  }
  batchClaiming.value = null;
  await backend.loadTasks();
  filter.value = 'mine';
  if (ok < picks.length) claimError.value = `Claimed ${ok} of ${picks.length}. ${lastError}`;
}
function heldLabel(t: ProofreadingTask): string {
  const row = queue.items.find(i => i.segId === t.segment_id);
  const name = row?.index || (t.segment_id ? '…' + t.segment_id.slice(-6) : 'a point claim');
  return `${name} on ${datasetDisplayName((t as any).dataset)}`;
}
async function releaseHeld(t: ProofreadingTask) {
  const key = String(t.id);
  if (releasing.has(key)) return;
  releasing.add(key);
  let ok = false;
  try { ok = await backend.releaseTaskById(t.id); } finally { releasing.delete(key); }
  if (ok && workingTaskId === t.id) setWorkingTask(null);
  if (!ok) { claimError.value = backend.error || 'Could not release this claim.'; return; }
  const held = heldHere(await backend.loadMyActiveClaims());
  if (held.length >= backend.claimLimitFor()) { claimLimit.value = held; return; }
  claimLimit.value = null;
  const next = pendingClaim;
  pendingClaim = null;
  if (next) await claimCell(next);
}

/** Load a viewer link's state into this viewer. Only its "#!" state part is
 *  used (the host may be Spelunker), so the page never navigates away. */
function openStartLink(link?: string): boolean {
  if (!link) return false;
  try {
    const hash = new URL(link).hash;
    if (!hash.startsWith('#!')) return false;
    // Keep your own opacity, layout and so on over the cell view's (Settings).
    const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
    window.location.hash = hash;
    restoreDisplayAfterLoad(snap);
    return true;
  } catch { return false; }
}

/** Get current viewer position as a ClaimPoint. */
function getViewerPos(): ClaimPoint {
  try {
    const viewer = (window as any)['viewer'];
    const pos = viewer?.navigationState?.position?.value;
    if (pos && pos.length >= 3) return [Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2])];
  } catch {}
  return [0, 0, 0];
}

// ── Complete: link + crosshairs-in-cell, then write (Amy 2026-09-28) ──────
type CellRow = typeof cells.value[0];
const completing = ref<{
  key: string; link: string; notes: string; status: string; minting: boolean;
  checking: boolean; ok: boolean; message: string; submitting: boolean;
  check: CrosshairCell | null;
} | null>(null);

function cellKey(cell: CellRow): string { return String(cell.taskId ?? cell.segId); }

// "Mark as Proofread" elsewhere hands a claimed cell to this form. Match the
// segment you were on to one of your claims; after edits it may be a new root,
// so with several claims and no match, ask which one you finished.
const chooseClaim = ref(false);

function shortId(id: string) { return id.length > 10 ? '…' + id.slice(-6) : id; }
function linkLooksValid(link: string) { return /^https:\/\/[^\s"'<>]+$/i.test((link || '').trim()); }

// ── How the cell ended (Nseraf 2026-09-30) ─────────────────────────────────
// Retina's sheet has four endings and the form could only write "Complete".
// The proofreader picks one; the last pick is offered again next time, since
// most cells in a session end the same way. A dataset with one ending shows
// no choice.
const STATUS_KEY = 'nge_cl_complete_status';
function rememberedStatus(cell: CellRow): string {
  const options = completeStatusesFor(cell.dataset);
  if (!options.length) return '';
  try {
    const last = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}')[canonicalDataset(cell.dataset)];
    if (options.some(o => o.value === last)) return last;
  } catch { /* nothing remembered */ }
  return '';   // first time: no default, the choice is the proofreader's
}
function rememberStatus(cell: CellRow, status: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
    all[canonicalDataset(cell.dataset)] = status;
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
}
/** True when this cell's dataset asks for an ending and none is picked yet. */
const statusMissing = (cell: CellRow) => completeStatusesFor(cell.dataset).length > 0 && !completing.value?.status;

function openComplete(cell: CellRow) {
  chooseClaim.value = false;
  completing.value = { key: cellKey(cell), link: '', notes: '', status: rememberedStatus(cell), minting: false, checking: false, ok: false, message: '', submitting: false, check: null };
  void runCrosshairCheck(cell);
  void useCurrentViewLink();  // prefilled with the current view; editable (Amy 2026-09-28)
}

async function useCurrentViewLink() {
  const c = completing.value;
  if (!c) return;
  c.minting = true;
  const short = await mintShortStateLink();
  c.minting = false;
  if (short) c.link = short;
  else c.message = 'Could not make a link of this view (sign in, or paste one).';
}

function isVisibleRoot(root: string): boolean {
  try {
    const vs = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    return !!vs?.has(Uint64.parseString(root));
  } catch { return false; }
}

/** The crosshairs must sit inside THIS cell. With a stored supervoxel we know
 *  the cell's current root exactly; otherwise accept its sheet or final id,
 *  or the cell you are viewing (it is recorded as the final segment). */
async function runCrosshairCheck(cell: CellRow) {
  const c = completing.value;
  if (!c) return;
  c.checking = true; c.ok = false; c.message = '';
  const at = await cellAtCrosshair();
  c.check = at;
  if (!at.root) {
    c.message = at.problem || 'Could not check the crosshairs.';
  } else {
    const expected = cell.svId ? await getRootFromSupervoxel(String(cell.svId)) : null;
    // MEC: crosshairs in the nucleus (its own segment there) mean this cell.
    // Record the cell around it, at its current root (Ames 2026-09-29).
    if (cell.nucleusId && at.root === cell.nucleusId) {
      const cellRoot = expected || cell.segId;
      c.check = { ...at, root: cellRoot };
      c.ok = true;
      c.message = `The crosshairs are in this cell's nucleus. The cell around it (${shortId(cellRoot)}) is recorded as the Final SegID.`;
      c.checking = false;
      return;
    }
    const known = [expected, cell.segId, cell.finalSegId].filter(Boolean) as string[];
    // Edits give the cell a new root id; its edit history still leads back to
    // the claim's Start SegID, so ask CAVE (Amy 2026-09-28).
    const lineage = known.includes(at.root) ? at.root : await ancestorAmong(at.root, known);
    if (lineage) {
      c.ok = true;
      c.message = lineage === at.root
        ? `The crosshairs are inside this cell (${shortId(at.root)}).`
        : `The crosshairs are inside this cell. It has been edited since the claim, so its ID is now ${shortId(at.root)}; that is recorded as the Final SegID.`;
    } else if (lineage === undefined && isVisibleRoot(at.root)) {
      // Could not reach the edit history: accept the cell on screen.
      c.ok = true;
      c.message = `The crosshairs are inside ${shortId(at.root)}, the cell on screen. It is recorded as the Final SegID.`;
    } else {
      c.message = `The crosshairs are inside ${shortId(at.root)}, which is not this cell and did not come from it. Move them into the cell and check again.`;
    }
  }
  c.checking = false;
}

async function submitComplete(cell: CellRow) {
  const c = completing.value;
  if (!c || !linkLooksValid(c.link) || statusMissing(cell)) return;
  c.submitting = true;
  try {
    // The crosshairs may have moved since the check: check once more.
    await runCrosshairCheck(cell);
    if (!c.ok || !c.check?.root) return;
    const claimsBefore = myOpenClaims.value;
    await completeCell(cell, {
      finalSegId: c.check.root,
      coords: c.check.position.join(', '),
      link: c.link.trim(),
      notes: c.notes.trim(),
      status: c.status || undefined,
    });
    if (c.status) rememberStatus(cell, c.status);
    completing.value = null;
    // Straight on to your next claim; with none left, the slim view opens up.
    if (!(await nextClaimAfter(cell, claimsBefore)) && slim.value) expandFull();
  } catch (e: any) {
    c.message = e?.message || 'Could not complete this cell.';
    c.ok = false;
  } finally {
    if (completing.value) completing.value.submitting = false;
  }
}

async function completeCell(cell: CellRow, done: { finalSegId: string; coords: string; link: string; notes?: string; status?: string }) {
  if (!isLoggedIn.value || !cell.taskId) return;
  // CAVE and the claim are independent, so write them at the same time (the
  // Complete button used to wait for one, then the other). The sheet waits for
  // the claim: the server only syncs a completed claim.
  const cavePromise = writeCaveCompletion(cell, done);
  await backend.completeTask(cell.taskId, done.finalSegId, done.coords);
  if (workingTaskId === cell.taskId) setWorkingTask(null);
  // Write completion to the source sheet, including the Final Link.
  syncCellToSheet('complete', cell.segId, undefined, cell.dataset, done.link, done.notes, done.status).catch(showSheetError);
  const loggedViaCave = await cavePromise;
  if (!loggedViaCave) {
    // Log as mark_complete for stats (CAVE write didn't record it)
    await backend.logEdit({ operation: 'mark_complete', task_id: cell.taskId });
  }
  // Notify UI that status changed (claim is already cleared by completeTask)
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'completed' } }));
  void backend.loadTasks();  // incremental, in the background
  // Celebration!
  triggerCellCelebration(done.finalSegId);
}

async function writeCaveCompletion(cell: CellRow, done: { finalSegId: string; coords: string }): Promise<boolean> {
  // Record the completion in CAVE (cell_status annotation) so it materializes
  // to the leaderboard — same path ProofreadingQueuePanel uses. The root is the
  // proofread final segment (fall back to the original). setCellComplete logs
  // the 'mark_complete' edit + activity internally on success, so we only log
  // here as a fallback — that keeps cells_completed incrementing exactly once.
  let loggedViaCave = false;
  try {
    const caveServer = activeCaveServer();
    const rootId = done.finalSegId || cell.finalSegId || cell.segId;
    if (caveServer && rootId) {
      const nums = (done.coords || cell.somaCoords || '').split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
      const pt = nums.length === 3 ? (nums as [number, number, number]) : undefined;
      // suppressCelebration: completeCell runs its own triggerCellCelebration()
      loggedViaCave = await setCellComplete(caveServer, rootId, true, undefined, pt, true);
    }
  } catch (e) {
    console.warn('[cellLibrary] CAVE completion write failed (non-blocking):', e);
  }
  return loggedViaCave;
}

import nurroSuccess from '../../static/nurro/nurro-success.png';
import nurroTrophy from '../../static/nurro/nurro-trophy.png';
import nurroCelebrate from '../../static/nurro/nurro-celebrate.png';
import nurroDance from '../../static/nurro/nurro-dance.png';
import nurroAtHome from '../../static/nurro/nurro-at-home.png';
import nurroConfetti from '../../static/nurro/nurro-confetti.png';
import nurroCelebrate2 from '../../static/nurro/nurro-celebrate2.png';
import nurroPopcorn from '../../static/nurro/nurro-popcorn.png';
import nurroCelebrate3 from '../../static/nurro/nurro-celebrate3.png';
import nurroExperiment from '../../static/nurro/nurro-experiment.png';
const NURRO_IMAGES = [nurroSuccess, nurroTrophy, nurroCelebrate, nurroDance, nurroAtHome, nurroConfetti, nurroCelebrate2, nurroPopcorn, nurroCelebrate3, nurroExperiment];

async function triggerCellCelebration(segId?: string) {
  await backend.loadUserStats(); // refresh from DB for accurate count
  const statsStore = useUserStatsStore();
  const total = statsStore.stats.cellsSubmitted;
  const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
  backend.pendingCellCelebration = {
    totalCells: total,
    imageUrl: nurro,
    segId,
  };
}

/** Claims being released right now: their Release buttons show a spinner,
 *  since the round trip takes a moment (Amy 2026-09-28). */
const releasing = reactive(new Set<string>());
function releaseKey(cell: CellRow): string { return cell.taskId != null ? String(cell.taskId) : cellKey(cell); }

async function releaseCell(cell: typeof cells.value[0]) {
  const key = releaseKey(cell);
  if (releasing.has(key)) return;
  releasing.add(key);
  // By claim id first: a claim made on a point has no segment id, and the old
  // `if (!cell.segId) return` made Release do nothing, silently (Amy 2026-09-28).
  let ok = false;
  try {
    if (cell.taskId) ok = await backend.releaseTaskById(cell.taskId);
    else if (cell.claimPoint) ok = await backend.releaseCell(cell.claimPoint);
    else if (cell.segId) ok = await backend.releaseBySegment(cell.segId);
  } finally {
    releasing.delete(key);
  }
  if (!ok) {
    claimError.value = backend.error || 'Could not release this claim. Please try again.';
    if (claimErrorTimer) clearTimeout(claimErrorTimer);
    claimErrorTimer = setTimeout(() => { claimError.value = ''; }, 5000);
    return;
  }
  if (completing.value?.key === cellKey(cell)) completing.value = null;
  if (slimSeg.value === cell.segId) expandFull();
  if (cell.taskId && workingTaskId === cell.taskId) setWorkingTask(null);
  // Dispatch event so seg dot pips update
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'released' } }));
  if (!cell.taskId) await backend.loadTasks();  // releaseTaskById already synced
}

// The claim/completion is saved even if the source sheet is temporarily unavailable.
function showSheetError(error: Error) {
  claimError.value = error.message;
  console.warn('[cellLibrary] Sheet sync:', error.message);
  reportWriteFailure('sheet_sync', error.message || 'sheet write failed');
}

// ── Helpers ──────────────────────────────────────────────────────────
function statusLabel(status: string) {
  switch (status) {
    case 'pending': return 'available';
    case 'assigned': return 'claimed';
    case 'in_progress': return 'in progress';
    case 'completed': return 'completed';
    case 'skipped': return 'skipped';
    default: return status;
  }
}

function statusClass(status: string) {
  switch (status) {
    case 'pending': return 'nge-cl-status--available';
    case 'assigned': case 'in_progress': return 'nge-cl-status--claimed';
    case 'completed': return 'nge-cl-status--done';
    default: return '';
  }
}

const isMyClaim = (cell: typeof cells.value[0]) =>
  (cell.status === 'assigned' || cell.status === 'in_progress') && cell.assignedTo === backend.userId;

// Runs once your claims are in the list (the panel may have just opened).
// Started in onMounted, NOT during setup: an immediate watcher here evaluates
// datasetScopedCells before later declarations exist, which threw "Cannot
// access before initialization" and stopped the panel opening (2026-09-28).
onMounted(() => watch([pendingCompleteRequest, datasetScopedCells, () => backend.loading], async () => {
  const req = pendingCompleteRequest.value;
  if (!req) return;
  const mine = datasetScopedCells.value.filter(c => isMyClaim(c));
  if (!mine.length && backend.loading) return;
  pendingCompleteRequest.value = null;
  filter.value = 'mine';
  search.value = '';
  let match = mine.find(c => c.segId === req.segId || c.finalSegId === req.segId) ?? null;
  if (!match && mine.length) {
    // Edited since the claim: find the claim this cell descends from.
    const hit = await ancestorAmong(req.segId, mine.flatMap(c => [c.segId, c.finalSegId || '']).filter(Boolean));
    if (hit) match = mine.find(c => c.segId === hit || c.finalSegId === hit) ?? null;
  }
  if (!match && mine.length === 1) match = mine[0];
  if (match) openComplete(match);
  else chooseClaim.value = mine.length > 0;
}, { immediate: true }));
// ── Help request helpers ────────────────────────────────────────────
const showResolved = ref(false);
const activeHelpId = ref<string | null>(null);
const pendingHelp = computed(() => helpStore.requests.filter(r => !r.resolved));
const resolvedHelp = computed(() => helpStore.requests.filter(r => r.resolved));

// ── Dataset grouping for pending help requests ──────────────────────
// `activeDataset` holds the segmentation-layer name currently in the viewer.
// We group pending requests by their `dataset` field so users see only
// requests from the dataset they're actually looking at; cross-dataset
// requests are tucked under a collapsible header so they don't disappear.
const activeDataset = ref('');
const collapsedDatasets = ref<Set<string>>(new Set());

interface HelpDatasetGroup {
  dataset: string;
  label: string;
  isCurrent: boolean;
  requests: HelpRequest[];
}

const pendingHelpByDataset = computed<HelpDatasetGroup[]>(() => {
  // Bucket by canonical dataset key so legacy variants ('eyewire_ii',
  // 'minnie65_public_v117', etc.) collapse with their current sibling.
  const groups = new Map<string, { label: string; requests: HelpRequest[] }>();
  const currentRaw = activeDataset.value;
  const currentKey = canonicalDataset(currentRaw);

  for (const req of pendingHelp.value) {
    // Treat empty/missing dataset as belonging to the current viewer dataset.
    const raw = req.dataset || currentRaw || 'Unknown';
    const key = canonicalDataset(raw) || raw;
    let g = groups.get(key);
    if (!g) {
      // Display label: prefer the current viewer's name when this is the
      // current dataset's bucket; otherwise show the first variant we saw.
      const label = (currentKey && key === currentKey && currentRaw) ? currentRaw : raw;
      g = { label, requests: [] };
      groups.set(key, g);
    }
    g.requests.push(req);
  }

  const result: HelpDatasetGroup[] = [];
  if (currentKey && groups.has(currentKey)) {
    const g = groups.get(currentKey)!;
    result.push({ dataset: currentKey, label: g.label, isCurrent: true, requests: g.requests });
    groups.delete(currentKey);
  }
  let firstFallback = true;
  for (const [key, g] of groups) {
    const isCurr = !currentKey && firstFallback;
    firstFallback = false;
    result.push({ dataset: key, label: g.label, isCurrent: isCurr, requests: g.requests });
    if (currentKey && key !== currentKey && !collapsedDatasets.value.has(key)) {
      collapsedDatasets.value.add(key);
    }
  }
  return result;
});

const hasMultipleHelpDatasets = computed(() => pendingHelpByDataset.value.length > 1);

function toggleDatasetGroup(ds: string) {
  if (collapsedDatasets.value.has(ds)) collapsedDatasets.value.delete(ds);
  else collapsedDatasets.value.add(ds);
}

function isCrossDatasetReq(req: HelpRequest): boolean {
  if (!req.dataset || !activeDataset.value) return false;
  // Compare canonical keys so legacy aliases (eyewire_ii ⇄ stroeh_mouse_retina,
  // minnie65_public ⇄ minnie65_public_v117) aren't flagged as cross-dataset.
  return canonicalDataset(req.dataset) !== canonicalDataset(activeDataset.value);
}

// ── Cross-dataset jump confirmation ─────────────────────────────────
const jumpConfirmReq = ref<HelpRequest | null>(null);
const jumpConfirmTargetDs = ref<DatasetEntry | null>(null);
const jumpConfirmCopied = ref(false);

function copyJumpConfirmUrl() {
  try {
    navigator.clipboard.writeText(window.location.href);
    jumpConfirmCopied.value = true;
    setTimeout(() => { jumpConfirmCopied.value = false; }, 1500);
  } catch {}
}

function cancelJumpConfirm() {
  jumpConfirmReq.value = null;
  jumpConfirmTargetDs.value = null;
  jumpConfirmCopied.value = false;
  pendingLinkOpen.value = null;
}

async function confirmJump() {
  const req = jumpConfirmReq.value;
  const target = jumpConfirmTargetDs.value;
  const linkBeingOpened = pendingLinkOpen.value;
  if (!req) return cancelJumpConfirm();
  if (target) {
    const ok = await switchToDataset(target);
    if (ok) {
      activeDataset.value = target.layers.find((l: any) => l.type === 'segmentation')?.name ?? '';
      // Give neuroglancer one tick to swap layers before navigating.
      await new Promise(r => setTimeout(r, 250));
    }
  }
  if (linkBeingOpened) {
    // For working-link opens, navigate to the link's saved URL (preserves the full state).
    cancelJumpConfirm();
    pendingLinkOpen.value = null;
    window.location.href = linkBeingOpened.url;
    return;
  }
  const leftA = await prepareJump(req.segId);
  if (!leftA.ok) { cancelJumpConfirm(); return; }
  activeHelpId.value = req.id;
  history.jumpToCell(req.segId, req.position, { keep: leftA.keep });
  cancelJumpConfirm();
}

/** Save the current view URL as a working link from the cross-dataset modal. */
async function saveCurrentAsLink() {
  if (!backend.userId) {
    alert('Log in to save working links.');
    return;
  }
  const url = window.location.href;
  const pos = getViewerPosition();
  const ds = activeDataset.value || getCurrentDatasetName();
  await linksStore.add({
    title: `${ds || 'View'} · ${new Date().toLocaleString()}`,
    note: 'Saved before switching dataset',
    url,
    dataset: ds,
    position: pos.length === 3 ? [pos[0], pos[1], pos[2]] : undefined,
    visibleSegments: getVisibleSegmentIds(),
  });
  jumpConfirmCopied.value = true;
  setTimeout(() => { jumpConfirmCopied.value = false; }, 1500);
}

function jumpConfirmTargetServerHasAuth(): boolean {
  // Stroeh / pinky / minnie65 all share minnie.microns-daf.com — if any
  // auth_token_v2_* key exists for that host, we treat it as authed.
  // Returns true when no warning is needed.
  const target = jumpConfirmTargetDs.value;
  if (!target) return true;
  try {
    const segLayer = target.layers.find((l: any) => l.type === 'segmentation');
    const url: string = (typeof segLayer?.source === 'object' ? segLayer.source.url : segLayer?.source) ?? '';
    const m = url.match(/middleauth\+https?:\/\/([^/]+)/);
    if (!m) return true;
    const host = m[1];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.startsWith('auth_token_v2_') && k.includes(host)) return true;
    }
    return false;
  } catch { return true; }
}

function getCurrentUrl(): string {
  try { return window.location.href; } catch { return ''; }
}

function selectInputContents(e: Event) {
  const t = e.target as HTMLInputElement | null;
  t?.select();
}

// ── Create help request (always-visible quick-add at top of the Help list) ──
const newHelpSegId = ref('');
/** Link to the requester's view (Amy 2026-09-29: the field is the view link,
 *  not a segment ID). Filled from the current view when the form opens;
 *  "Save link" refreshes it. The cell comes from the viewer selection. */
const newHelpLink = ref('');
const newHelpLinkMinting = ref(false);
/** The link the form made by itself. If it is still the one in the field
 *  when the request is sent, a fresh one is made then, so marks drawn after
 *  the form opened are in it. A link the player pasted is left alone. */
let autoHelpLink = '';
async function saveHelpLink() {
  newHelpLinkMinting.value = true;
  try {
    const link = await mintShortStateLink();
    if (link) { newHelpLink.value = link; autoHelpLink = link; newHelpError.value = ''; }
    else newHelpError.value = 'Could not make a link of this view. Sign in, or paste one.';
  } finally { newHelpLinkMinting.value = false; }
}
const newHelpIssue = ref('Unsure');
const newHelpNote = ref('');
const newHelpScreenshotUrl = ref('');
const newHelpError = ref('');
/** Which kind of request this is: one that waits for a written reply, or a
 *  live one that asks someone to join the asker's view now (Mentor mode). */
const newHelpLive = ref(false);
/** A normal request is also said in chat, with its Open view button, so
 *  someone can look and answer there without a live session (Ames
 *  2026-10-07). On unless the asker turns it off; remembered. A live request
 *  always goes to chat. */
const HELP_CHAT_KEY = 'nge_cl_help_to_chat_v1';
const newHelpToChat = ref((() => { try { return localStorage.getItem(HELP_CHAT_KEY) !== '0'; } catch { return true; } })());
watch(newHelpToChat, on => { try { localStorage.setItem(HELP_CHAT_KEY, on ? '1' : '0'); } catch { /* */ } });
const showHelpScreenshotDialog = ref(false);

/**
 * Whether the "Submit a help request" form is expanded.
 *
 * It used to sit permanently open at the top of the Help tab in pink, which
 * read as an error banner rather than an action you could take. Collapsed to a
 * button by default; the choice is remembered so anyone who files requests
 * constantly can leave it open.
 */
const HELP_FORM_KEY = 'nge_cl_help_form_open_v1';
const helpFormOpen = ref(localStorage.getItem(HELP_FORM_KEY) === '1');

function toggleHelpForm() {
  helpFormOpen.value = !helpFormOpen.value;
  try { localStorage.setItem(HELP_FORM_KEY, helpFormOpen.value ? '1' : '0'); } catch { /* ignore */ }
  // Prefill the view link when opening.
  if (helpFormOpen.value && !newHelpLink.value.trim()) void saveHelpLink();
}
/** Annotation layer attached to the INITIAL request (mirrors the reply form). */
const newHelpAnnotationLayer = ref('');
/** The annotation layers a new request points the helper at. All of them
 *  unless the player says otherwise, in one small dropdown so a view with many
 *  layers does not grow the form (Ames 2026-10-07: "default to attach all and
 *  make a dropdown where user can select one by one"). "All" is read when the
 *  request is sent, so a layer made after the form opened counts. */
const newHelpAllLayers = ref(true);
const newHelpLayers = ref<string[]>([]);
const helpLayersOpen = ref(false);
const helpLayersEl = ref<HTMLElement | null>(null);
function helpLayerOn(name: string): boolean {
  return newHelpAllLayers.value || newHelpLayers.value.includes(name);
}
function toggleHelpLayer(name: string) {
  const have = getAnnotationLayers();
  // Leaving "all": start from every layer ticked, then untick this one.
  const picked = new Set(newHelpAllLayers.value ? have : newHelpLayers.value.filter(n => have.includes(n)));
  if (picked.has(name)) picked.delete(name); else picked.add(name);
  newHelpAllLayers.value = have.length > 0 && have.every(n => picked.has(n));
  newHelpLayers.value = newHelpAllLayers.value ? [] : have.filter(n => picked.has(n));
}
function toggleAllHelpLayers() {
  newHelpAllLayers.value = !newHelpAllLayers.value;
  newHelpLayers.value = [];
}
/** What the closed dropdown reads. */
function helpLayersSummary(): string {
  const have = getAnnotationLayers();
  if (newHelpAllLayers.value) return `All ${have.length} annotation layers`.replace('All 1 annotation layers', 'Annotation layer: ' + (have[0] || ''));
  const picked = have.filter(n => newHelpLayers.value.includes(n));
  if (!picked.length) return 'No annotation layers';
  return picked.length === 1 ? 'Annotation layer: ' + picked[0] : `${picked.length} of ${have.length} annotation layers`;
}
/** What is saved on the request: the picked layers that still exist, by name. */
function pickedHelpLayers(): string {
  const have = getAnnotationLayers();
  if (newHelpAllLayers.value) return have.length > 1 ? 'All annotation layers' : (have[0] || '');
  return have.filter(n => newHelpLayers.value.includes(n)).join(', ');
}
function onHelpLayersOutside(e: Event) {
  if (helpLayersOpen.value && helpLayersEl.value && !helpLayersEl.value.contains(e.target as Node)) helpLayersOpen.value = false;
}
onMounted(() => document.addEventListener('mousedown', onHelpLayersOutside, true));
onBeforeUnmount(() => document.removeEventListener('mousedown', onHelpLayersOutside, true));
const HELP_ISSUE_TYPES = ['Unsure', 'Merge error', 'Split error', 'Missing branch', 'Other'];

// Pre-fill the segment ID from the current viewer selection when the Help tab
// opens, so the common case is one click. The user can still edit/paste any ID.
// The link is always filled in for you: when the Help tab is showing with the
// form open and the field is empty (first open, and again after a request is
// sent), it is made from the current view (Ames 2026-10-07: "I shouldn't need
// to click"). It is made afresh when the request is sent, so it is never stale.
watch([() => filter.value, helpFormOpen, newHelpLink], ([f, open, link]) => {
  if (f === 'help' && open && !String(link).trim() && !newHelpLinkMinting.value) void saveHelpLink();
}, { immediate: true });

function onHelpScreenshotAttached(payload: { url: string }) {
  newHelpScreenshotUrl.value = payload.url;
}
function clearHelpScreenshot() {
  newHelpScreenshotUrl.value = '';
}

/**
 * The cell a new help request is about. It used to be whatever segment the
 * mouse had last been over (neuroglancer's "selected segment" is the one
 * under the pointer), and only when the cell layer was the selected layer:
 * with an annotation layer selected a request saved no cell at all, and
 * otherwise it could save a stray one, so a jump opened "random segments"
 * (Celia 2026-10-07). Now: the one cell showing; or, with several showing,
 * the one under the pointer if it is one of them; otherwise none, and the
 * request is found by its position and its view.
 */
function getActiveSegId(): string {
  try {
    const layer = currentSegLayer()?.layer;
    const visible = layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (!visible) return '';
    const showing: string[] = [];
    for (const id of visible) { showing.push(id.toString()); if (showing.length > 400) break; }
    if (showing.length === 1) return showing[0];
    const hovered = layer.displayState?.segmentSelectionState?.selectedSegment?.toString?.() || '';
    if (hovered && layer.displayState?.segmentSelectionState?.hasSelectedSegment && showing.includes(hovered)) return hovered;
  } catch { /* layer not ready */ }
  return '';
}

function getViewerPosition(): number[] {
  try {
    const viewer = (window as any)['viewer'];
    const p = viewer?.navigationState?.position?.value;
    if (p) return [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];
  } catch {}
  return [];
}

function getCurrentDatasetName(): string {
  // Shared with the Dataset button so both report the same on-screen dataset
  // (visible, non-archived seg layer — see currentSegLayerName).
  return currentSegLayerName();
}

async function submitNewHelp() {
  // The cell is whatever is selected in the viewer; the link is the view.
  // Either one is enough to find the problem (Amy 2026-09-29).
  const selected = (newHelpSegId.value.trim() || getActiveSegId()).trim();
  const segId = /^\d{6,}$/.test(selected) ? selected : '';
  let link = newHelpLink.value.trim();
  if (!link || link === autoHelpLink) link = (await mintShortStateLink().catch(() => null)) || link;
  if (link && !/^https:\/\/[^\s"'<>]+$/i.test(link)) {
    newHelpError.value = 'The link must be a single https link.';
    return;
  }
  if (!segId && !link) {
    newHelpError.value = 'Select the cell in the viewer, or save a link to your view.';
    return;
  }
  newHelpError.value = '';
  await helpStore.add({
    segId,
    viewUrl: link || undefined,
    // Always where the requester was looking, cell selected or not, so a
    // helper can always jump there.
    position: getViewerPosition(),
    note: newHelpNote.value.trim(),
    issueType: newHelpLive.value ? `${LIVE_HELP} · ${newHelpIssue.value}` : newHelpIssue.value,
    dataset: getCurrentDatasetName(),
    cellType: '',
    nickname: '',
    screenshotUrl: newHelpScreenshotUrl.value || undefined,
    annotationLayer: pickedHelpLayers() || undefined,
  }, { chat: newHelpToChat.value });
  helpStore.refreshPending();
  newHelpSegId.value = '';
  newHelpLink.value = '';
  autoHelpLink = '';
  newHelpNote.value = '';
  newHelpIssue.value = 'Unsure';
  newHelpScreenshotUrl.value = '';
  newHelpAnnotationLayer.value = '';
  newHelpLive.value = false;
  newHelpLayers.value = [];
  newHelpAllLayers.value = true;
  helpLayersOpen.value = false;
}

// ── Help note expand state ──────────────────────────────────────────
const expandedNotes = reactive(new Set<string>());
function toggleNoteExpand(id: string) {
  if (expandedNotes.has(id)) expandedNotes.delete(id);
  else expandedNotes.add(id);
}

// ── Help response form state ────────────────────────────────────────
const respondingTo = ref<string | null>(null);
const responseNote = ref('');
const responseUrl = ref('');
const responseAnnotationLayer = ref('');
const responseScreenshotUrl = ref('');
const showResponseScreenshotDialog = ref(false);

function onResponseScreenshotAttached(payload: { url: string }) {
  responseScreenshotUrl.value = payload.url;
}
function clearResponseScreenshot() {
  responseScreenshotUrl.value = '';
}

function toggleResponseForm(reqId: string) {
  if (respondingTo.value === reqId) {
    respondingTo.value = null;
  } else {
    respondingTo.value = reqId;
    responseNote.value = '';
    responseUrl.value = '';
    responseAnnotationLayer.value = '';
    responseScreenshotUrl.value = '';
  }
}

/** Get available annotation layers from the viewer. */
function getAnnotationLayers(): string[] {
  try {
    const viewer = (window as any)['viewer'];
    if (!viewer?.layerManager?.managedLayers) return [];
    return viewer.layerManager.managedLayers
      .filter((l: any) => l.layer?.type === 'annotation')
      .map((l: any) => l.name) as string[];
  } catch { return []; }
}

async function submitResponse(req: HelpRequest, andResolve = false) {
  // A reply needs at least a note or a screenshot.
  if (!responseNote.value.trim() && !responseScreenshotUrl.value) return;
  // Each reply is its own row in help_responses, so its url / annotation layer /
  // screenshot accumulate instead of overwriting earlier replies.
  await helpStore.addResponse(req.id, {
    note: responseNote.value.trim() || undefined,
    url: responseUrl.value.trim() || undefined,
    annotationLayer: responseAnnotationLayer.value.trim() || undefined,
    screenshotUrl: responseScreenshotUrl.value || undefined,
    resolve: andResolve,
  });
  respondingTo.value = null;
  responseScreenshotUrl.value = '';
  helpStore.refreshPending();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** DATASETS entry for any dataset tag a row may carry (raw layer name or
 *  canonical key). */
function datasetEntryFor(raw: string | undefined | null): DatasetEntry | undefined {
  if (!raw) return undefined;
  return findDatasetBySegName(raw) ?? findDatasetByCanonical(canonicalDataset(raw));
}
/** Heading for a dataset group: the same name the Dataset switcher shows. */
function datasetHeading(raw: string | undefined | null): string {
  const ds = datasetEntryFor(raw);
  return ds ? `${SPECIES_ICONS[ds.species]} ${ds.label}` : (datasetDisplayName(raw) || raw || 'Unknown dataset');
}

/**
 * If `raw` is not the dataset on screen, switch to it first. Reads the LIVE
 * viewer (never the cached activeDataset) so a stale value can't send a root
 * ID into the wrong dataset's layer. Returns false if it couldn't switch.
 */
async function ensureDataset(raw: string | undefined | null): Promise<boolean> {
  activeDataset.value = getCurrentDatasetName() || activeDataset.value;
  if (!raw || canonicalDataset(raw) === canonicalDataset(activeDataset.value)) return true;
  const target = datasetEntryFor(raw);
  if (!target) return false;
  const ok = await switchToDataset(target);
  if (!ok) return false;
  activeDataset.value = segLayerName(target);
  // Give neuroglancer a moment to swap layers before navigating.
  await new Promise(r => setTimeout(r, 400));
  return true;
}

/**
 * Switching datasets reloads the page, so anything meant to happen after a
 * switch has to be left where the next page finds it: reopen the Cell
 * Library on Help, and carry on to the request that was asked for
 * (Ames 2026-10-07: "switch here should reopen the cell library / jump me to
 * the help request"). Read by ExtensionBar (reopen) and here (the jump).
 */
const AFTER_SWITCH_KEY = 'nge_cl_after_switch';
function rememberAfterSwitch(reqId?: string) {
  try { sessionStorage.setItem(AFTER_SWITCH_KEY, JSON.stringify({ tab: 'help', reqId: reqId || null, at: Date.now() })); } catch { /* private window */ }
}
function forgetAfterSwitch() { try { sessionStorage.removeItem(AFTER_SWITCH_KEY); } catch { /* */ } }
function isOnDataset(raw: string | undefined | null): boolean {
  return !raw || canonicalDataset(raw) === canonicalDataset(getCurrentDatasetName() || activeDataset.value);
}

/** Jump to a help request, switching dataset automatically when it lives on
 *  another one (Amy: "check dataset ID and automatically jump"). */
async function jumpToReq(req: HelpRequest) {
  const crossing = !isOnDataset(req.dataset);
  if (crossing) rememberAfterSwitch(req.id);
  if (!(await ensureDataset(req.dataset))) {
    forgetAfterSwitch();
    flashJumpError(`Could not switch to ${datasetHeading(req.dataset)}.`);
    return;
  }
  // Still here: finish the jump now. The note is dropped a little later, not
  // at once: a reload that is on its way lets this line run first.
  if (crossing) setTimeout(forgetAfterSwitch, 8000);
  const pos = Array.isArray(req.position) && req.position.length >= 3 && req.position.some(n => n) ? req.position : null;
  if (!req.segId && !pos) {
    // Nothing to fly to: a request that saved only a view, or nothing.
    if (req.viewUrl) { openResponseUrl(req.viewUrl); return; }
    flashJumpError('This request did not save a cell or a place to jump to.');
    return;
  }
  if (!req.segId) {
    // No cell was saved: go to the place, and leave the cells in view alone.
    activeHelpId.value = req.id;
    try { (window as any)['viewer'].navigationState.position.value = Float32Array.from(pos as number[]); } catch { /* no viewer */ }
    return;
  }
  const left = await prepareJump(req.segId);
  if (!left.ok) return;
  activeHelpId.value = req.id;
  history.jumpToCell(req.segId, (pos ?? undefined) as any, { keep: left.keep });
}

/** After a switch reloaded the page: carry on to the request that was asked
 *  for, once the requests have loaded and the new dataset is on screen. */
onMounted(async () => {
  let want: { reqId?: string | null; at?: number } | null = null;
  try { want = JSON.parse(sessionStorage.getItem(AFTER_SWITCH_KEY) || 'null'); } catch { want = null; }
  forgetAfterSwitch();
  if (!want?.reqId || Date.now() - (want.at || 0) > 120_000) return;
  for (let i = 0; i < 60; i++) {
    const req = helpStore.requests.find(r => r.id === want!.reqId);
    if (req && isOnDataset(req.dataset) && currentSegLayer()?.layer) {
      await new Promise(r => setTimeout(r, 1200));
      void jumpToReq(req);
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
});

/** Mentor mode: offer to join the view of whoever asked for help. The helper
 *  has to be on the same dataset first, since switching reloads the page. */
const offeredTo = reactive(new Set<string>());
async function offerToJoin(req: HelpRequest) {
  if (!req.userId) return;
  if (!isOnDataset(req.dataset)) {
    flashJumpError(`Switch to ${datasetHeading(req.dataset)} first, then press Join.`);
    return;
  }
  const { invite } = await import('../util/team_session');
  const note = req.note ? `About their request: ${req.note}`.slice(0, 140) : undefined;
  if (await invite({ id: req.userId, name: req.userName || 'Player' }, 'mentor', note)) offeredTo.add(req.id);
}
function teamUp() { document.dispatchEvent(new CustomEvent('nge:team-start')); }
/** A saved team on a cell this player has claimed (Ames 2026-10-07: "shouldn't
 *  that be via claimed cell?"). The claim gives the team its cell. */
const teamingUp = ref('');
const teamInvites = computed(() => teamsState.teams.filter(t => t.mine === 'invited').length);
async function teamUpOnClaim(cell: typeof cells.value[0]) {
  teamingUp.value = cellKey(cell);
  try {
    const pos = parseCoords(cell.coords || '');
    await createTeam({ dataset: cell.dataset || getCurrentDatasetName(), taskId: cell.taskId ?? null, segmentId: cell.segId,
      anchor: pos[0] || pos[1] || pos[2] ? pos : null, title: (cell as any).nickname || (cell as any).cellType || '' });
    filter.value = 'teams';
  } catch (e: any) {
    flashJumpError(e?.message || 'Could not start a team on that cell.');
  } finally { teamingUp.value = ''; }
}
/** Sessions are for players with production access: the buttons are not
 *  offered to someone known not to have it. */
const teamAllowed = computed(() => teamAccess() !== false);

/** The dataset header's "switch here" (Amy: the old "jump switches" tag
 *  looked like a button and did nothing). Switch datasets and open the group. */
async function switchToDatasetGroup(group: HelpDatasetGroup) {
  rememberAfterSwitch();
  if (!(await ensureDataset(group.dataset))) {
    forgetAfterSwitch();
    flashJumpError(`Could not switch to ${datasetHeading(group.dataset)}.`);
    return;
  }
  setTimeout(forgetAfterSwitch, 8000);
  collapsedDatasets.value.delete(group.dataset);
}

const jumpError = ref('');
function flashJumpError(msg: string) {
  jumpError.value = msg;
  setTimeout(() => { if (jumpError.value === msg) jumpError.value = ''; }, 5000);
}

// ── Scout tags (Tags tab) ────────────────────────────────────────────
const showResolvedTags = ref(false);
const openTagsSorted = computed(() => tagStore.openTags);
const resolvedTags = computed(() => tagStore.tags.filter((t: IssueTag) =>
  t.status === 'resolved' && !isModelTag(t) && (showAllDatasetTags.value || !isCrossDatasetTag(t))));

function isCrossDatasetTag(tag: IssueTag): boolean {
  if (!activeDataset.value) return false;
  // Strict: a tag with no dataset stamp (legacy rows) is NOT assumed to be
  // everywhere; it only appears under the All datasets toggle. Unstamped
  // tags were leaking into every dataset's list (Amy, 2026-08-17).
  if (!tag.dataset) return true;
  return canonicalDataset(tag.dataset) !== canonicalDataset(activeDataset.value);
}


/** Pull the view to inspection zoom after a tag jump (Amy: "tag should
 *  zoom me in closer, default is far away"). Only ever zooms IN: someone
 *  already working close stays where they are. Targets sit near the
 *  dataset landing defaults (stroeh 3/15000, minnie 5/30000). */
function zoomToTagLevel() {
  try {
    const v: any = (window as any)['viewer'];
    if (v?.crossSectionScale && v.crossSectionScale.value > 5) v.crossSectionScale.value = 4;
    const proj = v?.perspectiveNavigationState?.zoomFactor;
    if (proj && proj.value > 25000) proj.value = 18000;
  } catch {}
}

async function jumpToTag(tag: IssueTag) {
  if (!(await ensureDataset(tag.dataset))) {
    flashJumpError(`Could not switch to ${datasetHeading(tag.dataset)}.`);
    return;
  }
  if (tag.segId) {
    const left = await prepareJump(tag.segId);
    if (!left.ok) return;
    history.jumpToCell(tag.segId, tag.position as [number, number, number], { keep: left.keep });
    zoomToTagLevel();
    return;
  }
  // Position-only tag: move the crosshair directly.
  try {
    const v: any = (window as any)['viewer'];
    if (v?.navigationState?.position && tag.position?.length === 3) {
      v.navigationState.position.value = Float32Array.from(tag.position);
    }
  } catch {}
  zoomToTagLevel();
}

const TAG_TYPE_META: Record<string, { label: string; pip: string }> = {
  merger: { label: 'Cut', pip: '#e06060' },
  missing_branch: { label: 'Extend', pip: '#60c060' },
  other: { label: 'Other', pip: '#f5d142' },
};
const TAG_SUBTYPE_LABELS: Record<string, string> = {
  snip: '✂️ Snip', hairball: '🧶 Hairball', twins: '👯 Twins', debris: '🗑 Debris',
};
function tagLabel(tag: IssueTag): string {
  if (tag.subtype && TAG_SUBTYPE_LABELS[tag.subtype]) return TAG_SUBTYPE_LABELS[tag.subtype];
  return TAG_TYPE_META[tag.tagType]?.label ?? tag.tagType;
}
/** Tags scope to the current dataset like every other Cell Library list;
 *  the globe chip widens to all datasets. */
const showAllDatasetTags = ref(false);
/** Human tags only; model candidates live in the AI tab. */
const humanOpenTags = computed(() => tagStore.openTags.filter((t: IssueTag) => !isModelTag(t)));
const datasetTags = computed(() =>
  showAllDatasetTags.value ? humanOpenTags.value : humanOpenTags.value.filter((t: IssueTag) => !isCrossDatasetTag(t)));
/** Lane filter: Scythes work mergers, Tracers work extensions. */
const tagLane = ref<'all' | 'merger' | 'missing_branch'>('all');
const laneFilteredTags = computed(() =>
  tagLane.value === 'all' ? datasetTags.value : datasetTags.value.filter((t: IssueTag) => t.tagType === tagLane.value));
const thisDatasetOpenTagCount = computed(() =>
  humanOpenTags.value.filter((t: IssueTag) => !isCrossDatasetTag(t)).length);
function laneCount(lane: 'merger' | 'missing_branch'): number {
  return datasetTags.value.filter((t: IssueTag) => t.tagType === lane).length;
}

// ── AI candidates (AI tab) ───────────────────────────────────────────
// Model-seeded merger candidates, sorted hottest first. Rows reuse the
// scout-tag row chrome; resolve/delete go through the same store.
const aiOpenTags = computed(() => tagStore.openTags.filter((t: IssueTag) => isModelTag(t)));
const aiDatasetTags = computed(() => aiOpenTags.value.filter((t: IssueTag) => !isCrossDatasetTag(t)));
const aiResolvedTags = computed(() => tagStore.tags.filter((t: IssueTag) => t.status === 'resolved' && isModelTag(t)));
const showResolvedAiTags = ref(false);

/** Candidates clustered by cell (Amy: errors should group per neuron).
 *  Groups sort biggest first; rows inside sort hottest first. */
const aiGroups = computed(() => {
  const by = new Map<string, IssueTag[]>();
  for (const t of aiDatasetTags.value) {
    const k = t.segId ?? 'unknown';
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(t);
  }
  const groups = [...by.entries()].map(([root, tags]) => ({
    root,
    tags: [...tags].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
  }));
  groups.sort((a, b) => b.tags.length - a.tags.length);
  return groups;
});
/** Expanded cells; every group starts open on the first load. */
const aiExpandedRoots = ref<Set<string>>(new Set());
let aiExpandSeeded = false;
watch(aiGroups, gs => {
  if (!aiExpandSeeded && gs.length) {
    aiExpandedRoots.value = new Set(gs.map(g => g.root));
    aiExpandSeeded = true;
  }
}, { immediate: true });
function aiGroupExpanded(root: string): boolean {
  return aiExpandedRoots.value.has(root);
}
function toggleAiGroup(root: string) {
  const next = new Set(aiExpandedRoots.value);
  if (next.has(root)) next.delete(root); else next.add(root);
  aiExpandedRoots.value = next;
}

/** Badge color matching the marker shader's ramp: cool blue rising to
 *  golden yellow (Amy's palette; orange is banned). */
function confColor(conf?: number): string {
  const c = Math.max(0, Math.min(1, ((conf ?? 1) - 0.2) / 0.8));
  const ch = (a: number, b: number) => Math.round((a + (b - a) * c) * 255);
  return `rgb(${ch(0.35, 1.0)}, ${ch(0.65, 0.84)}, ${ch(1.0, 0.15)})`;
}

/** Category icon slot. The model does not emit categories yet; when it
 *  does (modelData.category), or when a human re-types the candidate
 *  (subtype), the icon follows. */
function aiCategoryIcon(tag: IssueTag): string {
  const cat = tag.modelData?.category ?? tag.subtype;
  const icons: Record<string, string> = { snip: '✂️', hairball: '🧶', twins: '👯', debris: '🗑' };
  return (cat && icons[cat]) || '🤖';
}

/** Other datasets holding open AI candidates, for the empty state's
 *  one-click switch (the demo batches are minnie65 only, so a user on the
 *  retina would otherwise find a bare tab and no pointer onward). */
const aiElsewhere = computed(() => {
  const byCanon = new Map<string, number>();
  for (const t of aiOpenTags.value) {
    if (!t.dataset || !isCrossDatasetTag(t)) continue;
    const c = canonicalDataset(t.dataset);
    byCanon.set(c, (byCanon.get(c) ?? 0) + 1);
  }
  const out: { ds: DatasetEntry; count: number }[] = [];
  for (const [canon, count] of byCanon) {
    // ONE entry per canonical tag, preferring Live: the model's roots only
    // draw meshes on the rolling graph, so offering the frozen public entry
    // as well was offering a dead end (Amy).
    const matches = DATASETS.filter(ds => canonicalDataset(segLayerName(ds)) === canon)
      .sort((a, b) => Number(b.id.includes('live')) - Number(a.id.includes('live')));
    if (matches.length) out.push({ ds: matches[0], count });
  }
  return out;
});

async function switchToAiDataset(ds: DatasetEntry) {
  const ok = await switchToDataset(ds);
  if (ok) {
    activeDataset.value = ds.layers.find((l: any) => l.type === 'segmentation')?.name ?? '';
  }
}

/** Make the candidate's root visible in the first segmentation layer.
 *  Retried on a schedule: the first attempt can be eaten by the middleauth
 *  login popup the graphene layer triggers on a cold jump. */
function ensureSegVisible(segId: string) {
  const attempt = () => {
    try {
      // The ACTIVE seg layer: the first-seg-layer heuristic used to add the
      // root to the archived layer left behind by a dataset switch.
      const segLayer = currentSegLayer();
      const groupState = segLayer?.layer?.displayState?.segmentationGroupState?.value;
      if (groupState?.visibleSegments) {
        const seg = Uint64.parseString(segId);
        if (!groupState.visibleSegments.has(seg)) groupState.visibleSegments.add(seg);
      }
    } catch {}
  };
  attempt();
  for (const ms of [1500, 4000, 9000]) setTimeout(attempt, ms);
}

/** Jump to the candidate and bring up its proposed-split constellation. */
function jumpToAiTag(tag: IssueTag) {
  if (isCrossDatasetTag(tag)) return;
  jumpToTag(tag);
  if (tag.segId) ensureSegVisible(tag.segId);
  if (tag.modelData?.posRelUm?.length && tagStore.activeSplitTagId !== tag.id) {
    tagStore.toggleSplitOverlay(tag);
  }
}

function resolveReq(req: HelpRequest) {
  helpStore.resolve(req.id);
  helpStore.refreshPending();
}

function openResponseUrl(url: string) {
  if (url.startsWith('http')) {
    window.open(url, '_blank');
  }
}

/** Copy current neuroglancer viewer state URL to the response URL field. */
function copyCurrentState() {
  try {
    // The current URL with fragment contains the full viewer state
    responseUrl.value = window.location.href;
  } catch {
    responseUrl.value = '';
  }
}

function removeReq(req: HelpRequest) {
  helpStore.remove(req.id);
  helpStore.refreshPending();
}

// ── Working Links tab ────────────────────────────────────────────────
const linksSearch = ref('');
const showSaveLinkForm = ref(false);
const newLinkTitle = ref('');
const newLinkNote = ref('');
const newLinkPublic = ref(false);
const newLinkScreenshotUrl = ref('');
const showLinkScreenshotDialog = ref(false);
function onLinkScreenshotAttached(payload: { url: string }) {
  newLinkScreenshotUrl.value = payload.url;
}
const renamingLinkId = ref<string | null>(null);
const renamingLinkValue = ref('');
const linksOwnershipFilter = ref<'all' | 'mine' | 'shared'>('all');

const visibleLinks = computed<WorkingLink[]>(() => {
  const q = linksSearch.value.trim().toLowerCase();
  let list = linksStore.links;
  if (linksOwnershipFilter.value === 'mine') list = list.filter(l => l.userId === backend.userId);
  else if (linksOwnershipFilter.value === 'shared') list = list.filter(l => l.userId !== backend.userId);
  if (q) {
    list = list.filter(l =>
      (l.title || '').toLowerCase().includes(q) ||
      (l.note || '').toLowerCase().includes(q) ||
      (l.dataset || '').toLowerCase().includes(q));
  }
  // Starred first, then most recent
  return [...list].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
});

function getVisibleSegmentIds(): string[] {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const layer = ml.layer;
      if (!layer) continue;
      // by the layer's own type: class names are renamed in the production build
      if (!String(layer.type || '').startsWith('segmentation')) continue;
      const visible = layer.displayState?.segmentationGroupState?.value?.visibleSegments;
      if (!visible) continue;
      const ids: string[] = [];
      for (const seg of visible) ids.push(seg.toString());
      return ids;
    }
  } catch {}
  return [];
}

async function submitNewLink() {
  if (!backend.userId) {
    alert('Log in to save working links.');
    return;
  }
  const url = window.location.href;
  const pos = getViewerPosition();
  const id = await linksStore.add({
    title: newLinkTitle.value.trim() || `${getCurrentDatasetName() || 'View'} · ${new Date().toLocaleString()}`,
    note: newLinkNote.value.trim(),
    url,
    dataset: getCurrentDatasetName(),
    position: pos.length === 3 ? [pos[0], pos[1], pos[2]] : undefined,
    visibleSegments: getVisibleSegmentIds(),
    isPublic: newLinkPublic.value,
    screenshotUrl: newLinkScreenshotUrl.value || null,
  });
  if (id) {
    showSaveLinkForm.value = false;
    newLinkTitle.value = '';
    newLinkNote.value = '';
    newLinkPublic.value = false;
    newLinkScreenshotUrl.value = '';
  }
}

function startRename(link: WorkingLink) {
  renamingLinkId.value = link.id;
  renamingLinkValue.value = link.title;
}

async function commitRename(link: WorkingLink) {
  const v = renamingLinkValue.value.trim();
  if (v && v !== link.title) await linksStore.update(link.id, { title: v });
  renamingLinkId.value = null;
}

/** Parse the state JSON out of a saved link's URL hash, if any. */
function linkHashState(link: WorkingLink): any | null {
  try {
    const h = new URL(link.url, window.location.href).hash;
    if (!h.startsWith('#!')) return null;
    return JSON.parse(decodeURIComponent(h.slice(2)));
  } catch { return null; }
}

/** Stale link rescue: rebuild the view from the structured fields saved
 *  alongside the URL (dataset, position, segments) instead of trusting a
 *  hash that no longer describes a working state. */
async function openLinkStructured(link: WorkingLink, targetDs: any) {
  if (targetDs && link.dataset && link.dataset !== activeDataset.value) {
    const ok = await switchToDataset(targetDs);
    if (ok) activeDataset.value = link.dataset;
    await new Promise(r => setTimeout(r, 250));
  }
  const seg = link.visibleSegments?.[0] ?? '';
  const pos = link.position && link.position.length === 3 ? link.position : undefined;
  if (seg || pos) history.jumpToCell(seg, pos as any);
}

function openLink(link: WorkingLink) {
  // Old links can carry a stale origin from an earlier deployment; keep the
  // saved state but always stay on this app.
  let linkUrl = link.url;
  try {
    const u = new URL(link.url, window.location.href);
    linkUrl = window.location.origin + u.pathname + u.search + u.hash;
  } catch {}
  // A link whose hash is missing, unparseable, or has no segmentation layer
  // is stale (Amy: an old saved link opened the wrong dataset). Fall back to
  // the structured restore rather than loading a broken state.
  const state = linkHashState(link);
  const hasSeg = ((state?.layers ?? []) as any[]).some(
    l => typeof l?.type === 'string' && l.type.startsWith('segmentation'));
  const targetDs = link.dataset && findDatasetBySegName(link.dataset);
  if (link.dataset && (!state || !hasSeg)) {
    void openLinkStructured(link, targetDs || null);
    return;
  }
  const current = activeDataset.value;
  if (link.dataset && current && link.dataset !== current && targetDs) {
    // Reuse the cross-dataset confirmation pattern (synthesize a HelpRequest-shaped object).
    jumpConfirmReq.value = {
      id: `link:${link.id}`,
      segId: link.visibleSegments[0] ?? '',
      position: link.position ?? [0, 0, 0],
      note: link.note,
      issueType: '',
      createdAt: link.createdAt,
      resolved: false,
      dataset: link.dataset,
    } as HelpRequest;
    jumpConfirmTargetDs.value = targetDs;
    jumpConfirmCopied.value = false;
    // Override: continue should navigate via the URL itself, not just the segment.
    pendingLinkOpen.value = { ...link, url: linkUrl };
    return;
  }
  // Same dataset: open URL directly (replaces current state)
  window.location.href = linkUrl;
}

const pendingLinkOpen = ref<WorkingLink | null>(null);

async function shareLinkToChat(link: WorkingLink) {
  // Post the title + a SHORT link. Saved links carry the whole viewer state
  // in the URL (KB of encoded JSON), which flooded the chat (Amy 2026-09-28);
  // shortenViewerUrl posts that state to the state server, like Share does.
  try {
    const { shortenViewerUrl } = await import('../util/state_link');
    const short = await shortenViewerUrl(link.url);
    if (!short) {
      flashJumpError('Could not make a short link for this view (try again after signing in). Nothing was posted.');
      return;
    }
    const chat = (await import('../store')).useChatStore();
    chat.sendMessage(`📎 ${link.title}\n${short}`);
  } catch (e) {
    console.warn('[workingLinks] share to chat failed:', e);
  }
}

function relativeTimeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── Drag ─────────────────────────────────────────────────────────────
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });
// Position is persisted alongside size (Amy: "saving my resizing but not
// placement"). The old off-screen worry is handled by clamping into the
// CURRENT viewport on load instead of by refusing to save.
// Saved with the viewport it was saved in, so a panel parked against the
// right edge of a 13" laptop stays against the right edge of a big display
// (it used to keep its raw left px, and the old clamp let all but 120px of it
// sit off screen: Amy 2026-09-25, MacBook to Cinema Display).
const CL_POS_KEY = 'nge_cell_library_pos_v1';
const panelPos = ref((() => {
  const fallback = { x: window.innerWidth / 2 - 220, y: 80 };
  try {
    const saved = JSON.parse(localStorage.getItem(CL_POS_KEY) || 'null');
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback;
    let { x, y } = saved;
    if (Number.isFinite(saved.vw) && Number.isFinite(saved.w) && saved.x + saved.w / 2 > saved.vw / 2) {
      x = window.innerWidth - (saved.vw - saved.x);  // keep the same gap to the right edge
    }
    return { x, y };  // clampPanelPos() below makes it fully visible
  } catch { return fallback; }
})());

/** Keep the WHOLE panel inside the viewport. */
function clampPanelPos() {
  const w = panelWidth.value;
  const h = panelEl.value?.offsetHeight ?? resizedHeight.value ?? 300;
  const maxX = Math.max(12, window.innerWidth - w - 12);
  const maxY = Math.max(40, window.innerHeight - Math.min(h, window.innerHeight - 52) - 12);
  const x = Math.max(12, Math.min(panelPos.value.x, maxX));
  const y = Math.max(40, Math.min(panelPos.value.y, maxY));
  if (x !== panelPos.value.x || y !== panelPos.value.y) panelPos.value = { x, y };
}
function persistPos() {
  try {
    localStorage.setItem(CL_POS_KEY, JSON.stringify({
      ...panelPos.value, w: panelWidth.value, vw: window.innerWidth, vh: window.innerHeight,
    }));
  } catch { /* ignore */ }
}

function startDrag(e: MouseEvent) {
  isDragging.value = true;
  dragOffset.value = { x: e.clientX - panelPos.value.x, y: e.clientY - panelPos.value.y };
  const move = (ev: MouseEvent) => {
    panelPos.value = { x: ev.clientX - dragOffset.value.x, y: ev.clientY - dragOffset.value.y };
  };
  const up = () => {
    isDragging.value = false;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    clampPanelPos();
    persistPos();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ── Tab visibility (the hub was getting crowded) ─────────────────────
// Users hide the tabs they never use from the panel's own little settings
// popover. The active tab and deep-link targets always render.
const CL_TABS_KEY = 'nge_cell_library_tabs_v1';
const ALL_CL_TABS: { key: string; label: string }[] = [
  { key: 'mine',      label: 'My Cells' },
  { key: 'available', label: 'Available' },
  { key: 'claimed',   label: 'Claimed' },
  { key: 'all',       label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'help',      label: 'Help' },
  { key: 'teams',     label: 'Teams' },
  { key: 'tags',      label: 'Tags' },
  { key: 'ai',        label: 'AI' },
  { key: 'links',     label: 'My Links' },
];
/** Hidden by default (still in the gear picker): the tab bar was cropping
 *  at 9 tabs, and Completed is the least-visited (Amy 2026-08-17). */
const DEFAULT_HIDDEN_CL_TABS = ['completed', 'ai'];
const visibleTabs = ref<string[]>((() => {
  try {
    const saved = JSON.parse(localStorage.getItem(CL_TABS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      // AI was hidden for everyone on 2026-09-26 (Amy); do it once for tab
      // lists saved before then. It stays available in the gear picker.
      if (!localStorage.getItem('nge_cl_tabs_ai_hidden_v1')) {
        localStorage.setItem('nge_cl_tabs_ai_hidden_v1', '1');
        const next = saved.filter((k: string) => k !== 'ai');
        if (next.length) { localStorage.setItem(CL_TABS_KEY, JSON.stringify(next)); return next; }
      }
      return saved;
    }
  } catch {}
  return ALL_CL_TABS.map(t => t.key).filter(k => !DEFAULT_HIDDEN_CL_TABS.includes(k));
})());
const showTabSettings = ref(false);
function toggleTab(key: string) {
  const set = new Set(visibleTabs.value);
  if (set.has(key)) { if (set.size > 1) set.delete(key); } // never hide the last one
  else set.add(key);
  visibleTabs.value = ALL_CL_TABS.map(t => t.key).filter(k => set.has(k));
  try { localStorage.setItem(CL_TABS_KEY, JSON.stringify(visibleTabs.value)); } catch {}
}
function tabShown(key: string): boolean {
  if (viewOnlyDataset.value) return key === 'links';
  return visibleTabs.value.includes(key) || filter.value === (key as any);
}

// A View Only dataset has no cells to claim, no help queue and no scout
// tags, so its library is the player's own saved links and nothing else
// (Ames 2026-10-06). Whatever asks for another tab lands on My Links.
const viewOnlyDataset = computed(() => {
  const raw = activeDataset.value;
  if (!raw) return false;
  const entry = findDatasetBySegName(raw)
    || DATASETS.find(d => canonicalDataset(segLayerName(d)) === canonicalDataset(raw));
  if (!entry) return false;
  const section = entry.section || (entry.group ? DATASET_GROUPS[entry.group]?.section : undefined);
  return section === 'viewonly';
});
watch([viewOnlyDataset, filter], () => {
  if (viewOnlyDataset.value && filter.value !== 'links') filter.value = 'links';
  if (viewOnlyDataset.value) showTabSettings.value = false;
}, { immediate: true });

// ── Resize ───────────────────────────────────────────────────────────
const MIN_PANEL_W = 340;
const MIN_PANEL_H = 260;

/**
 * Remembered panel size.
 *
 * This is a working surface people keep open for a whole session, so being
 * made to re-drag it to a usable size on every reload is a real annoyance.
 * Size is persisted; position deliberately is NOT — a saved position can end
 * up off-screen after a monitor or resolution change, whereas the default
 * centring is always reachable.
 */
const CL_SIZE_KEY = 'nge_cell_library_size_v1';

function loadSavedSize(): { w: number; h: number | null } {
  try {
    const raw = localStorage.getItem(CL_SIZE_KEY);
    if (!raw) return { w: 480, h: null };
    const s = JSON.parse(raw);
    // Clamp to the CURRENT viewport: a size saved on a big monitor must not
    // strand the panel off the edge of a laptop screen.
    const w = Math.max(MIN_PANEL_W, Math.min(Number(s.w) || 480, window.innerWidth - 24));
    const h = s.h == null ? null
      : Math.max(MIN_PANEL_H, Math.min(Number(s.h), window.innerHeight - 24));
    return { w, h };
  } catch { return { w: 480, h: null }; }
}

const saved = loadSavedSize();
const panelWidth = ref(saved.w);
// null = let content drive the height (capped by CSS max-height) until the
// user drags the corner, at which point we take over with an explicit height.
const resizedHeight = ref<number | null>(saved.h);

function persistSize() {
  try {
    localStorage.setItem(CL_SIZE_KEY, JSON.stringify({
      w: panelWidth.value, h: resizedHeight.value,
    }));
  } catch { /* quota or private mode */ }
}

function startResize(e: MouseEvent) {
  e.stopPropagation();
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = panelWidth.value;
  const panelEl = (e.currentTarget as HTMLElement).closest('.nge-cl-panel') as HTMLElement | null;
  const startH = resizedHeight.value ?? panelEl?.offsetHeight ?? 420;
  const move = (ev: MouseEvent) => {
    const maxW = window.innerWidth - panelPos.value.x - 12;
    const maxH = window.innerHeight - panelPos.value.y - 12;
    panelWidth.value = Math.max(MIN_PANEL_W, Math.min(maxW, startW + (ev.clientX - startX)));
    resizedHeight.value = Math.max(MIN_PANEL_H, Math.min(maxH, startH + (ev.clientY - startY)));
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    // Save on release rather than on every mousemove frame.
    persistSize();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// Clamp once the panel has a real height, and again whenever the window
// changes size (moving the browser between displays fires resize too).
onMounted(() => requestAnimationFrame(clampPanelPos));
window.addEventListener('resize', clampPanelPos);
onBeforeUnmount(() => window.removeEventListener('resize', clampPanelPos));

// ── Slim view (Ames 2026-10-01) ───────────────────────────────────────────
// Jump to a cell and the library shrinks to that cell's one row, out of the
// way of the work; the caret in the top bar does the same by hand. Complete
// (or release) the cell, or press the row's caret, and the full panel beams
// back. Same collapse and expand as the Scout tag panel.
const slimSeg = ref<string | null>(null);
const slimCell = computed<CellRow | null>(() => {
  const seg = slimSeg.value;
  if (!seg) return null;
  const all = datasetScopedCells.value.filter(c => c.segId === seg);
  return all.find(c => c.status !== 'completed') ?? all[0] ?? null;
});
const slim = computed(() => slimCell.value !== null);
/** The rows the cell list draws: one in the slim view. */
const listCells = computed(() => (slimCell.value ? [slimCell.value] : shownCells.value));
const CELL_TABS = ['mine', 'all', 'available', 'completed', 'claimed'];
/** The cell the caret shrinks to: the one on screen, else the claim being
 *  worked on, else your first claim. */
function currentCell(): CellRow | null {
  const cs = datasetScopedCells.value;
  return cs.find(c => c.segId === jumpedSegId.value && c.status !== 'completed')
    ?? cs.find(c => c.taskId != null && c.taskId === workingTaskId)
    ?? cs.find(c => isMyClaim(c) && c.status !== 'completed')
    ?? cs.find(c => c.segId === jumpedSegId.value)
    ?? null;
}
// Slim view is a mode the top bar caret turns on: while it is on, a jump
// shrinks the library to that cell. The slim row's caret turns it off again,
// so the library then stays open through jumps (Ames 2026-10-01).
const SLIM_MODE_KEY = 'nge_cl_slim_mode';
const slimMode = ref((() => { try { return localStorage.getItem(SLIM_MODE_KEY) === '1'; } catch { return false; } })());
function setSlimMode(on: boolean) {
  slimMode.value = on;
  try { localStorage.setItem(SLIM_MODE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}
const slimHint = ref('');
let slimHintTimer: ReturnType<typeof setTimeout> | undefined;
function flashSlimHint(msg: string) {
  slimHint.value = msg;
  if (slimHintTimer) clearTimeout(slimHintTimer);
  slimHintTimer = setTimeout(() => { slimHint.value = ''; }, 2600);
}
function collapseToCurrent() {
  const cell = currentCell();
  if (cell) { setSlimMode(true); void collapseTo(cell); return; }
  // Nothing to shrink to yet: the caret just switches the mode.
  setSlimMode(!slimMode.value);
  flashSlimHint(slimMode.value ? 'Slim view on: jump to a cell' : 'Slim view off');
}
/** Your open claims in this dataset, in list order: what "next" steps through. */
const myOpenClaims = computed(() => datasetScopedCells.value.filter(c => isMyClaim(c) && c.status !== 'completed'));
const slimClaimIndex = computed(() => myOpenClaims.value.findIndex(c => c.segId === slimSeg.value));
/** Slim view: go to your next claimed cell without opening the library
 *  (Ames 2026-10-01). switchToClaim saves the claim being left first. */
const steppingClaim = ref(false);
async function nextClaim() {
  const mine = myOpenClaims.value;
  if (steppingClaim.value || mine.length < 2 && slimClaimIndex.value === 0) return;
  if (!mine.length) return;
  await stepToClaim(mine[(slimClaimIndex.value + 1) % mine.length]);
}
/** After a Complete: go to the claim that followed the finished one in
 *  `before` (the list may not have dropped it yet). False = no claim left,
 *  or the jump did not happen. The full view stays open. */
async function nextClaimAfter(done: CellRow, before: CellRow[]): Promise<boolean> {
  if (done.taskId == null) return false;  // completeCell wrote nothing
  const at = before.findIndex(c => c.taskId === done.taskId);
  const open = new Set(myOpenClaims.value.map(c => c.taskId));
  const rest = before.filter(c => c.taskId !== done.taskId && open.has(c.taskId));
  if (!rest.length) return false;
  return stepToClaim(rest[Math.max(at, 0) % rest.length]);
}
async function stepToClaim(next: CellRow): Promise<boolean> {
  if (steppingClaim.value) return false;
  steppingClaim.value = true;
  try {
    completing.value = null;
    await switchToClaim(next);
    const went = jumpedSegId.value === next.segId;
    if (went && slim.value) slimSeg.value = next.segId;
    return went;
  } finally { steppingClaim.value = false; }
}
/** The slim row's caret: open up and stay open. */
function expandAndStay() {
  setSlimMode(false);
  expandFull();
}
async function collapseTo(cell: CellRow) {
  if (slimSeg.value === cell.segId) return;
  const el = panelEl.value;
  // Already slim (jumping from the slim row itself): nothing to shrink.
  const ghost = el && !slim.value ? snapshotPanel(el, '.nge-cl-list') : null;
  if (!CELL_TABS.includes(filter.value)) filter.value = 'mine';
  showTabSettings.value = false;
  showHowTo.value = false;
  slimSeg.value = cell.segId;
  await nextTick();
  clampPanelPos();
  if (!ghost || !el) return;
  if (!slim.value) { ghost.ghost.remove(); return; }
  const row = el.querySelector('.nge-cl-row');
  const parts = row ? [
    ...Array.from(row.querySelectorAll('.nge-cl-row-left, .nge-cl-row-actions > *')),
    ...Array.from(el.querySelectorAll('.nge-cl-slim-expand')),
  ] : [];
  morphIntoSlim(ghost, el, parts);
}
function expandFull() {
  if (!slimSeg.value) return;
  // Hide the slim row before the full list renders (a long list takes a
  // moment), so the panel never flashes open ahead of the beam.
  if (panelEl.value && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    panelEl.value.style.clipPath = 'inset(0 0 100% 0)';
  }
  slimSeg.value = null;
  void nextTick(() => {
    clampPanelPos();
    // revealWithBeam waits for the panel to settle (the clamp above moves it
    // on the next render), so the light lands on the real border.
    if (panelEl.value) revealWithBeam(panelEl.value);
  });
}
// The slim view grows with the Complete form (link, notes, crosshair check)
// and with any error banner; keep the taller panel on screen.
watch(() => [completing.value?.key, claimError.value, jumpError.value], () => {
  if (slim.value) void nextTick(clampPanelPos);
});
// The cell left the list (released elsewhere, dataset switched): open up.
watch(slimCell, (c) => { if (!c && slimSeg.value) expandFull(); });
/** Jump from a cell row, then shrink to that row if the jump happened. */
async function onRowJump(cell: CellRow) {
  if (isMyClaim(cell)) await switchToClaim(cell);
  else {
    const left = await prepareJump(cell.segId);
    if (!left.ok) return;
    jumpToCell(cell.segId, cell.nucCoords || cell.somaCoords, cell.nucleusId, left.keep, cell.liveSegId);
  }
  if (slimMode.value && jumpedSegId.value === cell.segId) void collapseTo(cell);
}
/** The slim row is its own drag handle (there is no top bar to grab). */
function onSlimMouseDown(e: MouseEvent) {
  if (!slim.value) return;
  if ((e.target as HTMLElement).closest('button, input, textarea, a, select, .nge-cl-row-name, .nge-cl-complete')) return;
  startDrag(e);
}

const panelStyle = computed(() => ({
  left: panelPos.value.x + 'px',
  top: panelPos.value.y + 'px',
  width: panelWidth.value + 'px',
  ...(resizedHeight.value != null && !slim.value
    ? { height: resizedHeight.value + 'px', maxHeight: 'none' }
    : {}),
}));
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-cl" appear>
      <div ref="panelEl" class="nge-cl-panel" :class="{ 'nge-cl-panel--slim': slim }" :style="panelStyle" @mousedown="onSlimMouseDown">

        <!-- Top bar -->
        <div class="nge-cl-topbar" @mousedown="startDrag" :class="{ 'nge-cl-dragging': isDragging }">
          <div class="nge-cl-title">
            <img :src="neuronIcon" class="nge-cl-icon" /> CELL LIBRARY
          </div>
          <span v-if="slimHint" class="nge-cl-slim-hint">{{ slimHint }}</span>
          <button class="nge-cl-caret" :class="{ 'nge-cl-caret--on': slimMode }"
                  :title="slimMode ? 'Slim view is on: jumping to a cell shrinks the library to that cell. Click to shrink now.' : 'Slim view: shrink the library to the cell you are working on'"
                  aria-label="Slim view" :aria-pressed="slimMode ? 'true' : 'false'" @mousedown.stop @click="collapseToCurrent">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button v-if="!viewOnlyDataset" class="nge-cl-gear" title="Choose which tabs show" @mousedown.stop @click="showTabSettings = !showTabSettings">⚙</button>
          <button class="nge-cl-close" @mousedown.stop @click="emit('hide')">×</button>
        </div>

        <!-- Resolve celebration -->
        <Transition name="nge-cl-tagwin">
          <div v-if="tagSuccessToast" class="nge-cl-tagwin" @click="tagSuccessToast = false">
            <div class="nge-cl-tagwin-glyph" v-html="tagPinSvg"></div>
            <div class="nge-cl-tagwin-title">Success!</div>
            <div class="nge-cl-tagwin-sub">You solved the tagged tangle!</div>
          </div>
        </Transition>

        <!-- Per-user tab picker -->
        <div v-if="showTabSettings" class="nge-cl-tabsettings" @mousedown.stop>
          <div class="nge-cl-tabsettings-title">Tabs on this panel</div>
          <label v-for="t in ALL_CL_TABS" :key="t.key" class="nge-cl-tabsettings-row">
            <input type="checkbox" :checked="visibleTabs.includes(t.key)" @change="toggleTab(t.key)" />
            <span>{{ t.label }}</span>
          </label>
        </div>

        <!-- How to proofread this dataset's cells (Retina). -->
        <div v-if="datasetHowTo && showHowTo" class="nge-cl-howto-panel">
          <div class="nge-cl-howto-panel-head">
            <span>How to map a cell</span>
            <button class="nge-cl-howto-close" @click="showHowTo = false" title="Close">×</button>
          </div>
          <ol class="nge-cl-howto-steps">
            <li v-for="(step, si) in datasetHowTo" :key="si" v-html="step"></li>
          </ol>
        </div>

        <!-- Filter tabs -->
        <!-- Tabs in three coloured groups: cells (cyan), community (gold),
             yours (violet). AI and Completed live in the gear picker. -->
        <div class="nge-cl-filters nge-cl-filters--grouped">
          <div v-if="!viewOnlyDataset" class="nge-cl-tabgroup nge-cl-tabgroup--cells">
            <div class="nge-cl-tabgroup-head">
              <span class="nge-cl-tabgroup-label">Cells</span>
              <span v-if="datasetHowTo || datasetInstructionsUrl || datasetCellTypesState || datasetTour" class="nge-cl-headlinks">
              <a v-if="datasetTour" class="nge-cl-howto" href="#" @click.prevent="startDatasetTour(activeDataset)"
                 title="Replay the guided tour of this dataset's cell types">tour</a>
              <a v-if="datasetHowTo" class="nge-cl-howto" :class="{ 'nge-cl-howto--open': showHowTo }" href="#" @click.prevent="showHowTo = !showHowTo"
                 title="How to proofread cells in this dataset">instructions</a>
              <a v-else-if="datasetInstructionsUrl" class="nge-cl-howto" :href="datasetInstructionsUrl" target="_blank" rel="noopener"
                 title="How to proofread cells in this dataset (opens in a new tab)">instructions</a>
              <a v-if="datasetCellTypesState" class="nge-cl-howto" href="#" @click.prevent="openCellTypes"
                 title="Open a view with one example of each cell type in this dataset">cell types</a>
              </span>
            </div>
            <div class="nge-cl-tabgroup-row">
              <button v-if="tabShown('mine')" :class="{ active: filter === 'mine' }" @click="filter = 'mine'"
                      title="Cells you have claimed, and cells you completed">
                My Cells <b>{{ myClaimCount }}</b>
              </button>
              <button v-if="tabShown('available')" :class="{ active: filter === 'available' }" @click="filter = 'available'"
                      title="Cells nobody has claimed yet">
                Available <b>{{ availableCount }}</b>
              </button>
              <button v-if="tabShown('claimed')" :class="{ active: filter === 'claimed', 'nge-cl-claimed-tab': true }" @click="filter = 'claimed'"
                      title="Cells anyone has claimed and is working on, yours included">
                Claimed <b>{{ claimedCount }}</b>
              </button>
              <button v-if="tabShown('all')" :class="{ active: filter === 'all' }" @click="filter = 'all'" title="Every cell in this dataset">
                All <b>{{ datasetScopedCells.length }}</b>
              </button>
              <button v-if="tabShown('completed')" :class="{ active: filter === 'completed' }" @click="filter = 'completed'">
                Completed <b>{{ completedCount }}</b>
              </button>
            </div>
          </div>
          <div class="nge-cl-tabgroup nge-cl-tabgroup--community" v-if="tabShown('help') || tabShown('tags') || tabShown('ai')">
            <span class="nge-cl-tabgroup-label">Community</span>
            <div class="nge-cl-tabgroup-row">
              <button v-if="tabShown('help')" :class="{ active: filter === 'help', 'nge-cl-help-tab': true }" @click="filter = 'help'"
                      title="Questions from other proofreaders">
                Help <b>{{ pendingHelp.length }}</b>
              </button>
              <button v-if="tabShown('teams')" :class="{ active: filter === 'teams', 'nge-cl-teams-tab': true }" @click="filter = 'teams'"
                      title="Two to four players on one cell, each working when they can">
                Teams <b v-if="teamInvites">{{ teamInvites }}</b>
              </button>
              <button v-if="tabShown('tags')" :class="{ active: filter === 'tags', 'nge-cl-tags-tab': true }" @click="filter = 'tags'"
                      title="Scout tags: spots someone flagged to cut or extend">
                Tags <b>{{ datasetTags.length }}</b>
              </button>
              <button v-if="tabShown('ai')" :class="{ active: filter === 'ai', 'nge-cl-ai-tab': true }" @click="filter = 'ai'">
                AI <b>{{ aiDatasetTags.length }}</b>
              </button>
            </div>
          </div>
          <div class="nge-cl-tabgroup nge-cl-tabgroup--mine" v-if="tabShown('links')">
            <div class="nge-cl-tabgroup-head">
              <span class="nge-cl-tabgroup-label">Yours</span>
              <!-- the tour link lives with the cell tabs; here they are gone -->
              <span v-if="viewOnlyDataset && datasetTour" class="nge-cl-headlinks">
                <a class="nge-cl-howto" href="#" @click.prevent="startDatasetTour(activeDataset)"
                   title="Replay the guided tour of this dataset's cell types">tour</a>
              </span>
            </div>
            <div class="nge-cl-tabgroup-row">
              <button :class="{ active: filter === 'links', 'nge-cl-links-tab': true }" @click="filter = 'links'"
                      title="Links you saved">
                My Links <b>{{ linksStore.links.length }}</b>
              </button>
            </div>
          </div>
        </div>

        <!-- Search (not shown on Help / Links tabs) -->
        <div v-if="filter !== 'help' && filter !== 'links' && filter !== 'tags' && filter !== 'ai' && filter !== 'teams'" class="nge-cl-search">
          <input
            v-model="search"
            placeholder="Search by ID, name, or notes..."
            class="nge-cl-search-input"
            @keydown.stop @keyup.stop @keypress.stop
          />
          <button v-if="filter === 'available' && isLoggedIn && (batchRoom > 0 || batchClaiming)"
                  class="nge-cl-btn nge-cl-batch-claim" :disabled="!!batchClaiming" @click="batchClaim"
                  :title="`Claim the next ${batchRoom} available cells in this list (up to ${backend.claimLimitFor()} at a time)`">
            <span v-if="batchClaiming" class="nge-cl-spin" />{{ batchClaiming ? `Claiming ${batchClaiming.done}/${batchClaiming.total}…` : `Claim ${batchRoom}` }}
          </button>
        </div>

        <!-- Search on Links tab -->
        <div v-if="filter === 'links'" class="nge-cl-search">
          <input
            v-model="linksSearch"
            placeholder="Search links by title, note, or dataset..."
            class="nge-cl-search-input"
            @keydown.stop @keyup.stop @keypress.stop
          />
        </div>

        <!-- ═══ HELP TAB ═══ -->
        <div v-if="filter === 'help'" class="nge-cl-list">

          <!-- Team mode: two or more players on one cell, live. -->
          <button v-if="teamAllowed" class="nge-cl-help-open-btn nge-cl-team-btn" @click="teamUp"
                  title="Work on the cell in your view together with other players, live. You invite them by name.">
            <span class="nge-cl-help-open-plus">👥</span> Team up on this cell
          </button>
          <!-- Always-visible quick-add: submit a new help request from the top -->
          <!-- Collapsed by default: a permanently-open form at the top of the
               tab read as an alert rather than an action. -->
          <button
            v-if="!helpFormOpen"
            class="nge-cl-help-open-btn"
            @click="toggleHelpForm"
            title="Ask another proofreader to look at a cell"
          >
            <span class="nge-cl-help-open-plus">+</span> Submit a help request
          </button>

          <div v-else class="nge-cl-help-quickadd">
            <div class="nge-cl-help-quickadd-title">
              Submit a help request
              <button class="nge-cl-help-collapse" @click="toggleHelpForm" title="Collapse">▾</button>
            </div>
            <!-- Two kinds of request: one that waits for a reply, and a live
                 one that asks someone to join your view now (Mentor mode). -->
            <div class="nge-cl-help-kind" role="radiogroup" aria-label="Kind of help">
              <button type="button" role="radio" :aria-checked="!newHelpLive ? 'true' : 'false'" class="nge-cl-help-kind-opt"
                      title="Your request waits in the Help tab. Someone replies when they can." @click="newHelpLive = false">Leave a request</button>
              <button type="button" role="radio" :aria-checked="newHelpLive ? 'true' : 'false'" class="nge-cl-help-kind-opt nge-cl-help-kind-opt--live"
                      title="Asks in chat for a player to join your view and help you now. You choose whether to accept who offers." @click="newHelpLive = true">🤝 Live help now</button>
            </div>
            <div v-if="newHelpLive" class="nge-cl-help-kind-note">Posts to chat. A player with production access can offer to join your view, and you accept or decline.</div>
            <label v-else class="nge-cl-help-tochat" title="Your request is also said in chat with a button that opens your view, so someone can look and answer there.">
              <input type="checkbox" v-model="newHelpToChat" />
              <span>Also post to chat</span>
            </label>
            <div class="nge-cl-help-quickadd-row">
              <input
                v-model="newHelpLink"
                class="nge-cl-help-segid-input"
                placeholder="Your view is attached when you send"
                @keydown.stop @keyup.stop @keypress.stop
                @input="newHelpError = ''"
              />
              <button
                class="nge-cl-help-segid-use"
                :disabled="newHelpLinkMinting"
                @click="saveHelpLink"
                title="The link is filled in for you, and made again from what you are looking at when you send. Click to remake it now."
              >{{ newHelpLinkMinting ? 'Saving…' : 'Refresh link' }}</button>
              <select
                v-model="newHelpIssue"
                class="nge-cl-help-issue-select"
                @keydown.stop
                title="Issue type"
              >
                <option v-for="t in HELP_ISSUE_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <!-- Which annotation layers hold your marks: all of them unless
                 you say otherwise, in one dropdown so many layers do not grow
                 the form. The request's view carries every layer either way;
                 this tells the helper where to look. -->
            <div v-if="getAnnotationLayers().length > 0" ref="helpLayersEl" class="nge-cl-help-layers" @keydown.esc.stop="helpLayersOpen = false">
              <button type="button" class="nge-cl-help-layers-toggle" :aria-expanded="helpLayersOpen ? 'true' : 'false'"
                      aria-haspopup="true" title="Choose which annotation layers to point the helper at"
                      @click="helpLayersOpen = !helpLayersOpen">
                <span class="nge-cl-help-layers-summary">📐 {{ helpLayersSummary() }}</span>
                <span class="nge-cl-help-layers-caret" aria-hidden="true">▾</span>
              </button>
              <div v-if="helpLayersOpen" class="nge-cl-help-layers-menu" role="group" aria-label="Annotation layers to point the helper at">
                <label class="nge-cl-help-layers-item nge-cl-help-layers-item--all">
                  <input type="checkbox" :checked="newHelpAllLayers" @change="toggleAllHelpLayers" />
                  <span>All annotation layers</span>
                </label>
                <label v-for="layer in getAnnotationLayers()" :key="layer" class="nge-cl-help-layers-item" :title="layer">
                  <input type="checkbox" :checked="helpLayerOn(layer)" @change="toggleHelpLayer(layer)" />
                  <span>{{ layer }}</span>
                </label>
              </div>
            </div>
            <div class="nge-cl-help-quickadd-row">
              <input
                v-model="newHelpNote"
                class="nge-cl-help-note-input"
                placeholder="Describe what looks wrong, then press Enter…"
                @keydown.stop @keyup.stop @keypress.stop
                @keydown.enter.prevent="submitNewHelp"
                @input="newHelpError = ''"
              />
              <button
                v-if="!newHelpScreenshotUrl"
                class="nge-cl-help-shot-icon"
                @click="showHelpScreenshotDialog = true"
                title="Attach a screenshot of the current view"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/>
                  <circle cx="12" cy="13.5" r="3.8"/>
                </svg>
              </button>
              <button
                v-else
                class="nge-cl-help-shot-icon nge-cl-help-shot-icon--attached"
                @click="clearHelpScreenshot"
                title="Screenshot attached — click to remove"
              >✓</button>
              <button class="nge-cl-help-quickadd-submit" @click="submitNewHelp"
                      :title="newHelpLive ? 'Ask in chat for someone to join your view and help now' : 'Submit help request'">{{ newHelpLive ? 'Ask now' : 'Submit' }}</button>
            </div>
            <div v-if="newHelpScreenshotUrl" class="nge-cl-help-shot-preview nge-cl-help-shot-preview--sm">
              <img :src="newHelpScreenshotUrl" alt="Attached screenshot" />
              <button class="nge-cl-help-shot-remove" @click="clearHelpScreenshot" title="Remove screenshot">×</button>
            </div>
            <div v-if="newHelpError" class="nge-cl-help-create-err">{{ newHelpError }}</div>
          </div>

          <!-- Pending help requests -->
          <div v-if="pendingHelp.length === 0 && resolvedHelp.length === 0" class="nge-cl-empty">
            No help requests yet. Use the box above to submit one.
          </div>
          <div v-else-if="pendingHelp.length === 0" class="nge-cl-no-results">No pending requests</div>

          <div
            v-for="group in pendingHelpByDataset"
            :key="group.dataset"
            class="nge-cl-help-ds-group"
            :class="{ 'nge-cl-help-ds-group--cross': !group.isCurrent }"
          >
            <!-- Dataset section header: shown with multiple groups, and ALSO
                 for a lone non-current group. Without it, requests that all
                 live in one other dataset auto-collapsed with no header to
                 expand them: count said 2, list showed nothing (Amy). -->
            <div
              v-if="hasMultipleHelpDatasets || !group.isCurrent"
              class="nge-cl-help-ds-header"
              @click="toggleDatasetGroup(group.dataset)"
            >
              <span
                class="nge-cl-help-ds-arrow"
                :class="{ 'nge-cl-help-ds-arrow--collapsed': !group.isCurrent && collapsedDatasets.has(group.dataset) }"
              >▾</span>
              <span class="nge-cl-help-ds-name" :title="group.label">{{ datasetHeading(group.dataset) }}</span>
              <span v-if="group.isCurrent" class="nge-cl-help-ds-tag nge-cl-help-ds-tag--current">viewing now</span>
              <button v-else class="nge-cl-help-ds-tag nge-cl-help-ds-tag--other nge-cl-help-ds-switch"
                      title="Switch the viewer to this dataset"
                      @click.stop="switchToDatasetGroup(group)">switch here</button>
              <span class="nge-cl-help-ds-count">{{ group.requests.length }}</span>
            </div>

            <!-- Requests: current dataset always shown; others only when expanded -->
            <template v-if="group.isCurrent || !collapsedDatasets.has(group.dataset)">
              <div
                v-for="req in group.requests"
                :key="req.id"
                class="nge-cl-help-item"
                :class="{
                  'nge-cl-help-item--active': activeHelpId === req.id,
                  'nge-cl-help-item--cross': !group.isCurrent,
                }"
              >
                <div class="nge-cl-row">
                  <div class="nge-cl-row-left">
                    <span class="nge-cl-pip nge-cl-status--help"></span>
                    <div class="nge-cl-row-info">
                      <div class="nge-cl-row-name" @click="copyId(req.segId)" :title="'Click to copy ' + req.segId">
                        {{ req.segId }}
                        <span v-if="copiedId === req.segId" class="nge-cl-copied">copied</span>
                      </div>
                      <div class="nge-cl-row-meta">
                        <span class="nge-cl-badge nge-cl-status--help" :class="{ 'nge-cl-badge--live': isLiveHelp(req) }">{{ isLiveHelp(req) ? '🤝 ' + req.issueType : req.issueType }}</span>
                        <span v-if="req.userName" class="nge-cl-notes">by {{ req.userName }}</span>
                        <span class="nge-cl-notes">{{ relativeTime(req.createdAt) }}</span>
                      </div>
                      <div v-if="req.note" class="nge-cl-help-note" :class="{ 'nge-cl-help-note--expanded': expandedNotes.has(req.id) }" @click="toggleNoteExpand(req.id)">{{ req.note }}</div>
                      <a v-if="req.viewUrl" class="nge-cl-response-link" href="#" @click.prevent="openResponseUrl(req.viewUrl)"
                         title="Load the view they were looking at">↗ Open their view</a>
                      <span v-if="req.annotationLayer" class="nge-cl-response-layer"
                            :title="req.viewUrl ? 'Their marks are in this annotation layer. Open their view to see it.' : 'They pointed at this annotation layer, but this request did not save their view.'">📐 {{ req.annotationLayer === 'All annotation layers' ? req.annotationLayer : (req.annotationLayer.includes(', ') ? 'Layers: ' : 'Layer: ') + req.annotationLayer }}</span>
                      <a v-if="req.screenshotUrl" :href="req.screenshotUrl" target="_blank" rel="noopener"
                         class="nge-cl-help-shot-thumb" :title="'Open full screenshot'">
                        <img :src="req.screenshotUrl" alt="Help screenshot" />
                      </a>
                    </div>
                  </div>
                  <div class="nge-cl-row-actions">
                    <button
                      class="nge-cl-btn nge-cl-btn--jump"
                      @click="jumpToReq(req)"
                      :title="!group.isCurrent ? `Switch to ${group.label} and jump` : 'Jump to segment'"
                    >↗</button>
                    <!-- Mentor mode: offer to join the asker's view. They accept or decline. -->
                    <button v-if="teamAllowed && isLiveHelp(req) && req.userId && req.userId !== backend.userId" class="nge-cl-btn nge-cl-btn--join"
                            :disabled="offeredTo.has(req.id)"
                            :title="offeredTo.has(req.id) ? 'Offer sent. Waiting for them to accept.' : `Offer to join ${req.userName || 'their'} view and help, live. They choose whether to accept.`"
                            @click="offerToJoin(req)">{{ offeredTo.has(req.id) ? 'Offered' : 'Join' }}</button>
                    <button class="nge-cl-btn nge-cl-btn--respond" @click="toggleResponseForm(req.id)" :title="respondingTo === req.id ? 'Cancel' : 'Respond'">
                      {{ respondingTo === req.id ? '▾' : '💬' }}
                    </button>
                    <button class="nge-cl-btn nge-cl-btn--complete" @click="resolveReq(req)">Resolve</button>
                  </div>
                </div>

            <!-- Reply thread: one entry per help_responses row (each keeps its
                 own link / annotation layer / screenshot). -->
            <div v-if="req.responses && req.responses.length" class="nge-cl-response-display">
              <div v-for="resp in req.responses" :key="resp.id" class="nge-cl-response-item">
                <div class="nge-cl-response-label">💬 {{ resp.userName || 'Response' }}<span v-if="resp.resolved"> · resolved</span>:</div>
                <div v-if="resp.note" class="nge-cl-response-text">{{ resp.note }}</div>
                <a v-if="resp.url" class="nge-cl-response-link" @click.prevent="openResponseUrl(resp.url)" href="#">↗ View linked state</a>
                <span v-if="resp.annotationLayer" class="nge-cl-response-layer">📐 Layer: {{ resp.annotationLayer }}</span>
                <a v-if="resp.screenshotUrl" :href="resp.screenshotUrl" target="_blank" rel="noopener"
                   class="nge-cl-help-shot-thumb" title="Open full screenshot">
                  <img :src="resp.screenshotUrl" alt="Reply screenshot" />
                </a>
              </div>
              <button v-if="respondingTo !== req.id" class="nge-cl-btn nge-cl-btn--reply" @click="toggleResponseForm(req.id)">↩ Reply</button>
            </div>

            <!-- Inline response form (below existing thread) -->
            <div v-if="respondingTo === req.id" class="nge-cl-response-form">
              <textarea
                v-model="responseNote"
                placeholder="Write your response... (Enter to submit, Shift+Enter for newline)"
                class="nge-cl-response-textarea"
                rows="3"
                @keydown.stop @keyup.stop @keypress.stop
                @keydown.enter.exact.prevent="submitResponse(req)"
              ></textarea>
              <div class="nge-cl-response-url-row">
                <input
                  v-model="responseUrl"
                  placeholder="Neuroglancer state URL (optional)"
                  class="nge-cl-response-input"
                  @keydown.stop @keyup.stop @keypress.stop
                />
                <button class="nge-cl-btn nge-cl-btn--copy-state" @click="copyCurrentState" title="Copy current viewer state URL">📋 State</button>
              </div>
              <select
                v-if="getAnnotationLayers().length > 0"
                v-model="responseAnnotationLayer"
                class="nge-cl-response-input"
              >
                <option value="">Select annotation layer (optional)</option>
                <option v-for="layer in getAnnotationLayers()" :key="layer" :value="layer">{{ layer }}</option>
              </select>
              <!-- Attach an (optionally annotated) screenshot to the reply,
                   same flow as the initial request. -->
              <button
                v-if="!responseScreenshotUrl"
                class="nge-cl-btn nge-cl-help-shot-btn"
                @click="showResponseScreenshotDialog = true"
                title="Attach a screenshot of the current view"
              >📷 Attach screenshot</button>
              <div v-else class="nge-cl-help-shot-preview">
                <img :src="responseScreenshotUrl" alt="Reply screenshot" />
                <button class="nge-cl-help-shot-remove" @click="clearResponseScreenshot" title="Remove screenshot">×</button>
              </div>
              <button
                class="nge-cl-btn nge-cl-btn--submit-response"
                :disabled="!responseNote.trim() && !responseScreenshotUrl"
                @click="submitResponse(req)"
              >Submit Response</button>
              <button
                class="nge-cl-btn nge-cl-btn--submit-response nge-cl-btn--resolve"
                :disabled="!responseNote.trim() && !responseScreenshotUrl"
                @click="submitResponse(req, true)"
              >Submit & Resolve</button>
            </div>
              </div>
            </template>
          </div>

          <!-- Resolved section -->
          <div v-if="resolvedHelp.length > 0" class="nge-cl-help-resolved-header" @click="showResolved = !showResolved">
            <span class="nge-cl-help-resolved-arrow" :class="{ 'nge-cl-help-resolved-arrow--open': showResolved }">▸</span>
            Resolved ({{ resolvedHelp.length }})
          </div>
          <template v-if="showResolved">
            <div
              v-for="req in resolvedHelp"
              :key="req.id"
              class="nge-cl-help-item"
            >
              <div class="nge-cl-row nge-cl-row--done">
                <div class="nge-cl-row-left">
                  <span class="nge-cl-pip" style="background: #556;"></span>
                  <div class="nge-cl-row-info">
                    <div class="nge-cl-row-name" @click="copyId(req.segId)" :title="'Click to copy ' + req.segId">
                      {{ req.segId }}
                    </div>
                    <div class="nge-cl-row-meta">
                      <span class="nge-cl-badge" style="background: rgba(85,102,119,0.15); color: #889;">{{ req.issueType }}</span>
                      <span v-if="req.resolvedByName" class="nge-cl-notes" style="color: #7f8;">✓ {{ req.resolvedByName }}</span>
                      <span class="nge-cl-notes">{{ relativeTime(req.createdAt) }}</span>
                    </div>
                  </div>
                </div>
                <div class="nge-cl-row-actions">
                  <button class="nge-cl-btn nge-cl-btn--jump" @click="jumpToReq(req)" title="Jump to segment">↗</button>
                  <button class="nge-cl-btn nge-cl-btn--release" @click="removeReq(req)" title="Remove">×</button>
                </div>
              </div>
              <!-- Response display: one entry per help_responses row -->
              <div v-if="req.responses && req.responses.length" class="nge-cl-response-display">
                <div v-for="resp in req.responses" :key="resp.id" class="nge-cl-response-item">
                  <div class="nge-cl-response-label">{{ resp.userName || 'Response' }}<span v-if="resp.resolved"> · resolved</span>:</div>
                  <div v-if="resp.note" class="nge-cl-response-text">{{ resp.note }}</div>
                  <a v-if="resp.url" class="nge-cl-response-link" @click.prevent="openResponseUrl(resp.url)" href="#">↗ View linked state</a>
                  <span v-if="resp.annotationLayer" class="nge-cl-response-layer">📐 Layer: {{ resp.annotationLayer }}</span>
                  <a v-if="resp.screenshotUrl" :href="resp.screenshotUrl" target="_blank" rel="noopener"
                     class="nge-cl-help-shot-thumb" title="Open full screenshot">
                    <img :src="resp.screenshotUrl" alt="Reply screenshot" />
                  </a>
                </div>
              </div>
            </div>
          </template>

          <!-- connectome.quest resources -->
          <div class="nge-cl-quest">
            <div class="nge-cl-quest-title">Learn more at connectome.quest</div>
            <div class="nge-cl-quest-grid">
              <a
                v-for="res in CONNECTOME_QUEST_RESOURCES"
                :key="res.id"
                class="nge-cl-quest-link"
                :href="res.url"
                target="_blank"
                rel="noopener"
                :title="res.description"
              >
                <span class="nge-cl-quest-icon">{{ res.icon }}</span>
                <span class="nge-cl-quest-label">{{ res.label }}</span>
              </a>
            </div>
          </div>
        </div>

        <!-- ═══ TEAMS TAB (saved teams: two to four players on one cell) ═══ -->
        <div v-else-if="filter === 'teams'" class="nge-cl-list">
          <teams-tab />
        </div>

        <!-- ═══ TAGS TAB (Scout tags: mergers / missing branches) ═══ -->
        <div v-else-if="filter === 'tags'" class="nge-cl-list">
          <div class="nge-cl-quest" style="margin-top: 0;">
            <div class="nge-cl-quest-title"><span class="nge-cl-tag-pin" v-html="tagPinSvg"></span> Scout tags</div>
            <div class="nge-cl-tags-hint">
              Drop tags with the <span class="nge-cl-tag-pin" v-html="tagPinSvg"></span> Tag Mode toolbar button: center the crosshair
              on a merger or a suspected missing branch and pick the type. Scythes
              jump to each open tag from here, fix it, and mark it resolved.
            </div>
          </div>

          <!-- Two separate questions, two rows (Amy: "are all these my current
               dataset? The 16 are in other dataset or is other a category?").
               Row 1 is WHERE: this dataset or every dataset. Row 2 is WHAT:
               tag type, counted within the chosen scope. -->
          <!-- The old "Show tags on the map" switch is gone: tag layers exist
               only while Scout Tag mode is open (Amy 2026-09-28). -->
          <div class="nge-cl-tags-hint" style="margin-top: 6px; margin-bottom: 8px;">
            Tags appear on the map while <b>Scout Tag mode</b> is open. Jump ↗ takes you to any tag.
          </div>
          <div class="nge-cl-tags-lanes">
            <span class="nge-cl-lanes-label">Dataset</span>
            <button :class="{ 'nge-cl-lane--active': !showAllDatasetTags }" @click="showAllDatasetTags = false"
                    title="Open tags on the dataset you are viewing">{{ datasetDisplayName(activeDataset) || 'This dataset' }} ({{ thisDatasetOpenTagCount }})</button>
            <button :class="{ 'nge-cl-lane--active': showAllDatasetTags }" @click="showAllDatasetTags = true"
                    title="Open tags on every dataset, including this one">🌐 All datasets ({{ humanOpenTags.length }})</button>
          </div>
          <div class="nge-cl-tags-lanes">
            <span class="nge-cl-lanes-label">Type</span>
            <button :class="{ 'nge-cl-lane--active': tagLane === 'all' }" @click="tagLane = 'all'">Any ({{ datasetTags.length }})</button>
            <button :class="{ 'nge-cl-lane--active': tagLane === 'merger' }" @click="tagLane = 'merger'"><img :src="scytheIcon" class="nge-cl-lane-icon" alt="" /> For Scythes ({{ laneCount('merger') }})</button>
            <button :class="{ 'nge-cl-lane--active': tagLane === 'missing_branch' }" @click="tagLane = 'missing_branch'"><img :src="tracerIcon" class="nge-cl-lane-icon" alt="" /> For Tracers ({{ laneCount('missing_branch') }})</button>
          </div>

          <div v-if="!laneFilteredTags.length" class="nge-cl-tags-hint" style="padding: 10px 0;">
            No open tags in this lane. The volume is momentarily unsuspicious.
          </div>

          <div v-for="(tag, tagIdx) in laneFilteredTags" :key="tag.id" class="nge-cl-help-item nge-cl-tag-card"
               :style="{ '--tag-color': TAG_TYPE_META[tag.tagType]?.pip ?? '#889' }">
            <div class="nge-cl-row">
              <div class="nge-cl-row-left">
                <span class="nge-cl-pip" :style="{ background: TAG_TYPE_META[tag.tagType]?.pip ?? '#889' }"></span>
                <div class="nge-cl-row-info">
                  <div class="nge-cl-row-name">
                    {{ tagLabel(tag) }}
                    <span v-if="tag.segId" class="nge-cl-notes"> · seg …{{ tag.segId.slice(-6) }}</span>
                  </div>
                  <div class="nge-cl-row-meta">
                    <span class="nge-cl-notes">{{ tag.position.join(', ') }}</span>
                    <span v-if="isCrossDatasetTag(tag)" class="nge-cl-badge" style="background: rgba(245,209,66,0.12); color: #f5d142;">{{ datasetDisplayName(tag.dataset) }}</span>
                    <span class="nge-cl-notes">{{ tag.userName || 'Anonymous' }} · {{ relativeTime(tag.createdAt) }}</span>
                  </div>
                  <div v-if="tag.note" class="nge-cl-notes" style="margin-top: 2px;">{{ tag.note }}</div>
                  <div v-if="tag.annotationLayer" class="nge-cl-notes" style="margin-top: 2px;">📐 {{ tag.annotationLayer }}</div>
                  <a v-if="tag.screenshotUrl" :href="tag.screenshotUrl" target="_blank" rel="noopener"
                     class="nge-cl-help-shot-thumb" title="Open full screenshot">
                    <img :src="tag.screenshotUrl" alt="Tag screenshot" />
                  </a>
                </div>
              </div>
              <div class="nge-cl-row-actions">
                <span class="nge-orbit-wrap"><span v-if="orbitOn(tagIdx, laneFilteredTags.length)" class="nge-orbit-dot" aria-hidden="true"></span><button class="nge-cl-btn nge-cl-btn--jump" @click="jumpToTag(tag)"
                        :title="isCrossDatasetTag(tag) ? 'Switch to ' + datasetHeading(tag.dataset) + ' and jump' : 'Jump to location'">↗</button></span>
                <button class="nge-cl-btn nge-cl-btn--complete nge-cl-btn--tagdone" @click="resolveTagFun(tag, $event)" title="I fixed this! Claim the tag">✓</button>
                <template v-if="confirmDeleteTagId === tag.id">
                  <button class="nge-cl-btn nge-cl-btn--confirmdel" @click="confirmDeleteTag(tag)" title="Yes, delete this tag for everyone">Delete?</button>
                  <button class="nge-cl-btn" @click="confirmDeleteTagId = null" title="Keep the tag">✕</button>
                </template>
                <button v-else class="nge-cl-btn nge-cl-btn--release" @click="askDeleteTag(tag)" title="Delete this tag for everyone (use ✓ if it was fixed)">🗑</button>
              </div>
            </div>
          </div>

          <div class="nge-cl-help-resolved-toggle" @click="showResolvedTags = !showResolvedTags">
            {{ showResolvedTags ? '▾' : '▸' }} Resolved ({{ resolvedTags.length }})
          </div>
          <template v-if="showResolvedTags">
            <div v-for="tag in resolvedTags" :key="tag.id" class="nge-cl-help-item">
              <div class="nge-cl-row nge-cl-row--done">
                <div class="nge-cl-row-left">
                  <span class="nge-cl-pip" style="background: #556;"></span>
                  <div class="nge-cl-row-info">
                    <div class="nge-cl-row-name">{{ tagLabel(tag) }}</div>
                    <div class="nge-cl-row-meta">
                      <span v-if="tag.resolvedByName" class="nge-cl-notes" style="color: #7f8;">✓ {{ tag.resolvedByName }}</span>
                      <span class="nge-cl-notes">{{ relativeTime(tag.createdAt) }}</span>
                    </div>
                  </div>
                </div>
                <div class="nge-cl-row-actions">
                  <template v-if="confirmDeleteTagId === tag.id">
                    <button class="nge-cl-btn nge-cl-btn--confirmdel" @click="confirmDeleteTag(tag)" title="Yes, delete this tag for everyone">Delete?</button>
                    <button class="nge-cl-btn" @click="confirmDeleteTagId = null" title="Keep the tag">✕</button>
                  </template>
                  <button v-else class="nge-cl-btn nge-cl-btn--release" @click="askDeleteTag(tag)" title="Delete this tag for everyone">🗑</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ═══ AI TAB (model-detected merge-error candidates) ═══ -->
        <div v-else-if="filter === 'ai'" class="nge-cl-list">
          <div class="nge-cl-quest" style="margin-top: 0;">
            <div class="nge-cl-quest-title">🤖 AI-predicted reconstruction errors</div>
            <div class="nge-cl-ai-credit">from the Dorkenwald and Fuming model</div>
            <div class="nge-cl-ai-scale">
              <span class="nge-cl-ai-dot nge-cl-ai-dot--cool"></span>
              <div class="nge-cl-ai-scale-bar"></div>
              <span class="nge-cl-ai-dot nge-cl-ai-dot--hot"></span>
            </div>
            <div class="nge-cl-ai-scale-labels">
              <span>less confident</span>
              <span>more confident</span>
            </div>
            <div class="nge-cl-tags-hint" style="margin-top: 8px;">
              Jump ↗ to a candidate to see the proposed split as a red and blue
              point constellation, fix it, and mark it resolved.
            </div>
          </div>

          <div class="nge-cl-tags-lanes">
            <span class="nge-cl-notes" style="align-self: center;">{{ aiDatasetTags.length }} candidates on {{ aiGroups.length }} {{ aiGroups.length === 1 ? 'cell' : 'cells' }}</span>
            <button :class="{ 'nge-cl-lane--active': tagStore.aiLayerOn }"
                    :title="tagStore.aiLayerOn ? 'Hide AI candidate markers in the viewer' : 'Show AI candidate markers in the viewer'"
                    @click="tagStore.setAiLayerOn(!tagStore.aiLayerOn)">📍 Markers</button>
          </div>

          <div v-if="!aiDatasetTags.length" class="nge-cl-tags-hint" style="padding: 10px 4px;">
            No open AI candidates for this dataset.
            <template v-if="!aiElsewhere.length"> The model finds no fault here.</template>
          </div>
          <div v-if="!aiDatasetTags.length && aiElsewhere.length" class="nge-cl-tags-lanes">
            <button v-for="e in aiElsewhere" :key="e.ds.id"
                    class="nge-cl-lane--active"
                    :title="'Switch the viewer to ' + e.ds.label"
                    @click="switchToAiDataset(e.ds)">
              {{ SPECIES_ICONS[e.ds.species] }} Switch to {{ e.ds.shortLabel }} ({{ e.count }} candidates)
            </button>
          </div>

          <template v-for="g in aiGroups" :key="g.root">
            <div class="nge-cl-ai-group" @click="toggleAiGroup(g.root)"
                 :title="aiGroupExpanded(g.root) ? 'Collapse this cell' : 'Expand this cell'">
              <span class="nge-cl-ai-group-caret">{{ aiGroupExpanded(g.root) ? '▾' : '▸' }}</span>
              <span class="nge-cl-ai-group-name">🧠 Cell …{{ g.root.slice(-6) }}</span>
              <span class="nge-cl-notes">{{ g.tags.length }} {{ g.tags.length === 1 ? 'candidate' : 'candidates' }}</span>
              <button class="nge-cl-ai-group-heat"
                      :class="{ 'nge-cl-lane--active': tagStore.activeHeatRoots.includes(g.root) }"
                      :disabled="tagStore.heatLoadingRoot === g.root"
                      title="Heat layer: every window the model scored on this cell, cool to hot"
                      @click.stop="tagStore.toggleHeatLayer(g.root)">
                {{ tagStore.heatLoadingRoot === g.root ? '⏳' : '🔥' }} Heat
              </button>
            </div>
          <div v-for="(tag, tagIdx) in g.tags" v-show="aiGroupExpanded(g.root)" :key="tag.id" class="nge-cl-help-item">
            <div class="nge-cl-row">
              <div class="nge-cl-row-left">
                <span class="nge-cl-pip" :style="{ background: confColor(tag.confidence) }"></span>
                <div class="nge-cl-row-info">
                  <div class="nge-cl-row-name">
                    {{ aiCategoryIcon(tag) }} Cut
                    <span class="nge-cl-ai-conf" :style="{ color: confColor(tag.confidence) }">{{ Math.round((tag.confidence ?? 0) * 100) }}%</span>
                    <span v-if="tag.segId" class="nge-cl-notes"> · seg …{{ tag.segId.slice(-6) }}</span>
                  </div>
                  <div class="nge-cl-row-meta">
                    <span class="nge-cl-notes">{{ tag.position.join(', ') }}</span>
                    <span v-if="isCrossDatasetTag(tag)" class="nge-cl-badge" style="background: rgba(245,209,66,0.12); color: #f5d142;">{{ datasetDisplayName(tag.dataset) }}</span>
                  </div>
                </div>
              </div>
              <div class="nge-cl-row-actions">
                <span class="nge-orbit-wrap"><span v-if="orbitOn(tagIdx, g.tags.length)" class="nge-orbit-dot" aria-hidden="true"></span><button class="nge-cl-btn nge-cl-btn--jump" @click="jumpToAiTag(tag)"
                        :disabled="isCrossDatasetTag(tag)"
                        :title="isCrossDatasetTag(tag) ? 'Switch to ' + datasetDisplayName(tag.dataset) + ' first' : 'Jump to location and preview the proposed split'">↗</button></span>
                <button class="nge-cl-btn nge-cl-btn--split"
                        :class="{ 'nge-cl-btn--split-active': tagStore.activeSplitTagId === tag.id }"
                        :disabled="!tag.modelData?.posRelUm?.length"
                        title="Toggle the model's proposed split overlay"
                        @click="tagStore.toggleSplitOverlay(tag)">✂</button>
                <button class="nge-cl-btn nge-cl-btn--complete nge-cl-btn--tagdone" @click="resolveTagFun(tag, $event)" title="I fixed this! Claim the tag">✓</button>
                <template v-if="confirmDeleteTagId === tag.id">
                  <button class="nge-cl-btn nge-cl-btn--confirmdel" @click="confirmDeleteTag(tag)" title="Yes, delete this candidate for everyone">Delete?</button>
                  <button class="nge-cl-btn" @click="confirmDeleteTagId = null" title="Keep the candidate">✕</button>
                </template>
                <button v-else class="nge-cl-btn nge-cl-btn--release" @click="askDeleteTag(tag)" title="Delete this candidate for everyone (use ✓ if it was fixed)">🗑</button>
              </div>
            </div>
          </div>

          </template>

          <div class="nge-cl-help-resolved-toggle" @click="showResolvedAiTags = !showResolvedAiTags">
            {{ showResolvedAiTags ? '▾' : '▸' }} Resolved ({{ aiResolvedTags.length }})
          </div>
          <template v-if="showResolvedAiTags">
            <div v-for="tag in aiResolvedTags" :key="tag.id" class="nge-cl-help-item">
              <div class="nge-cl-row nge-cl-row--done">
                <div class="nge-cl-row-left">
                  <span class="nge-cl-pip" style="background: #556;"></span>
                  <div class="nge-cl-row-info">
                    <div class="nge-cl-row-name">{{ aiCategoryIcon(tag) }} Cut · {{ Math.round((tag.confidence ?? 0) * 100) }}%</div>
                    <div class="nge-cl-row-meta">
                      <span v-if="tag.resolvedByName" class="nge-cl-notes" style="color: #7f8;">✓ {{ tag.resolvedByName }}</span>
                      <span class="nge-cl-notes">{{ relativeTime(tag.createdAt) }}</span>
                    </div>
                  </div>
                </div>
                <div class="nge-cl-row-actions">
                  <template v-if="confirmDeleteTagId === tag.id">
                    <button class="nge-cl-btn nge-cl-btn--confirmdel" @click="confirmDeleteTag(tag)" title="Yes, delete this candidate for everyone">Delete?</button>
                    <button class="nge-cl-btn" @click="confirmDeleteTagId = null" title="Keep the candidate">✕</button>
                  </template>
                  <button v-else class="nge-cl-btn nge-cl-btn--release" @click="askDeleteTag(tag)" title="Delete this candidate for everyone">🗑</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ═══ LINKS TAB ═══ -->
        <div v-else-if="filter === 'links'" class="nge-cl-list">

          <!-- Save current view form -->
          <Transition name="nge-slide">
            <div v-if="showSaveLinkForm" class="nge-cl-help-create">
              <div class="nge-cl-help-create-title">Save Current View</div>
              <div class="nge-cl-help-create-hint">
                Captures the current URL, dataset, position, and visible segments.
              </div>
              <input
                v-model="newLinkTitle"
                class="nge-cl-search-input"
                placeholder="Title (e.g. 'Tricky merge near soma')"
                @keydown.stop @keyup.stop @keypress.stop
                @keydown.enter.exact.prevent="submitNewLink"
              />
              <textarea
                v-model="newLinkNote"
                class="nge-cl-help-create-note"
                placeholder="Optional note..."
                rows="2"
                @keydown.stop @keyup.stop @keypress.stop
              ></textarea>
              <label class="nge-cl-link-public-row">
                <input type="checkbox" v-model="newLinkPublic" />
                Make public (anyone in the lab can see)
              </label>
              <!-- Optional picture of the view (Amy 2026-09-28), same capture
                   and pen dialog as help requests. -->
              <div v-if="newLinkScreenshotUrl" class="nge-cl-help-shot-preview nge-cl-help-shot-preview--sm">
                <img :src="newLinkScreenshotUrl" alt="Attached screenshot" />
                <button class="nge-cl-help-shot-remove" @click="newLinkScreenshotUrl = ''" title="Remove screenshot">×</button>
              </div>
              <div class="nge-cl-help-create-actions">
                <button v-if="!newLinkScreenshotUrl" class="nge-cl-help-create-cancel" @click="showLinkScreenshotDialog = true"
                        title="Attach a screenshot of the current view">📸 Screenshot</button>
                <button class="nge-cl-help-create-submit" @click="submitNewLink">💾 Save Link</button>
                <button class="nge-cl-help-create-cancel" @click="showSaveLinkForm = false">Cancel</button>
              </div>
            </div>
          </Transition>

          <!-- Ownership filter chips + Save new -->
          <div class="nge-cl-link-ownership">
            <button
              class="nge-cl-link-save-new"
              :class="{ active: showSaveLinkForm }"
              @click="showSaveLinkForm = !showSaveLinkForm"
              title="Save the current view as a working link"
            >+ Save new</button>
            <span class="nge-cl-link-ownership-divider"></span>
            <button :class="{ active: linksOwnershipFilter === 'all' }" @click="linksOwnershipFilter = 'all'">All</button>
            <button :class="{ active: linksOwnershipFilter === 'mine' }" @click="linksOwnershipFilter = 'mine'">Mine</button>
            <button :class="{ active: linksOwnershipFilter === 'shared' }" @click="linksOwnershipFilter = 'shared'">Shared</button>
          </div>

          <!-- Empty state -->
          <div v-if="visibleLinks.length === 0 && !showSaveLinkForm" class="nge-cl-empty">
            No saved links yet. Click <strong>+</strong> above to save the current view.
          </div>

          <!-- Link rows -->
          <div
            v-for="link in visibleLinks"
            :key="link.id"
            class="nge-cl-help-item nge-cl-link-item"
            :class="{ 'nge-cl-link-item--starred': link.starred }"
          >
            <div class="nge-cl-row">
              <div class="nge-cl-row-left">
                <span class="nge-cl-pip" :style="{ background: link.starred ? '#f5d142' : '#557' }"></span>
                <div class="nge-cl-row-info">
                  <div v-if="renamingLinkId === link.id" class="nge-cl-link-rename">
                    <input
                      v-model="renamingLinkValue"
                      class="nge-cl-search-input"
                      @keydown.stop @keyup.stop @keypress.stop
                      @keydown.enter.exact.prevent="commitRename(link)"
                      @blur="commitRename(link)"
                      ref="renameInput"
                      autofocus
                    />
                  </div>
                  <div v-else class="nge-cl-row-name nge-cl-link-title" @dblclick="startRename(link)" :title="'Double-click to rename · ' + link.title">
                    {{ link.title }}
                  </div>
                  <div class="nge-cl-row-meta">
                    <span v-if="link.dataset" class="nge-cl-badge" :style="{ background: 'rgba(120,140,255,0.12)', color: '#abf' }">{{ link.dataset }}</span>
                    <span v-if="link.userId !== backend.userId && link.userName" class="nge-cl-notes">by {{ link.userName }}</span>
                    <span v-if="link.isPublic" class="nge-cl-notes" style="color:#7f8;">🌐 public</span>
                    <span class="nge-cl-notes">{{ relativeTimeShort(link.createdAt) }}</span>
                  </div>
                  <div v-if="link.note" class="nge-cl-help-note">{{ link.note }}</div>
                  <a v-if="link.screenshotUrl" :href="link.screenshotUrl" target="_blank" rel="noopener"
                     class="nge-cl-help-shot-thumb" title="Open full screenshot">
                    <img :src="link.screenshotUrl" alt="Screenshot of this view" />
                  </a>
                </div>
              </div>
              <div class="nge-cl-row-actions">
                <button class="nge-cl-btn nge-cl-btn--jump" @click="openLink(link)" title="Open link in viewer">↗</button>
                <button class="nge-cl-btn" @click="linksStore.toggleStar(link.id)" :title="link.starred ? 'Unstar' : 'Star'">
                  {{ link.starred ? '★' : '☆' }}
                </button>
                <button class="nge-cl-btn" @click="startRename(link)" title="Rename">✏️</button>
                <button class="nge-cl-btn" @click="shareLinkToChat(link)" title="Share to chat">💬</button>
                <button
                  v-if="link.userId === backend.userId"
                  class="nge-cl-btn nge-cl-btn--release"
                  @click="linksStore.remove(link.id)"
                  title="Delete"
                >×</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ CELL TABS ═══ -->
        <!-- Loading -->
        <div v-else-if="(loading || backend.loading) && cells.length === 0" class="nge-cl-loading">Loading cells...</div>

        <!-- Empty state -->
        <div v-else-if="cells.length === 0" class="nge-cl-empty">
          <p>No cells loaded yet.</p>
          <p v-if="!queue.sheetUrl" class="nge-cl-hint">Open Brain Quest first and load a quest sheet.</p>
        </div>

        <!-- Cell list -->
        <div v-else class="nge-cl-list">
          <!-- Claim error banner -->
          <div v-if="jumpError" class="nge-cl-error-banner" @click="jumpError = ''">{{ jumpError }}</div>
          <div v-if="chooseClaim" class="nge-cl-limit">
            <div class="nge-cl-limit-head">
              Which of your claims did you finish? Click Complete on it below.
              <span class="nge-cl-error-dismiss" @click="chooseClaim = false">×</span>
            </div>
          </div>
          <div v-if="claimLimit" class="nge-cl-limit">
            <div class="nge-cl-limit-head">
              You hold {{ claimLimit.length }} claims, the most allowed. Release one to claim this cell.
              <span class="nge-cl-error-dismiss" @click="dismissClaimLimit">×</span>
            </div>
            <div v-for="t in claimLimit" :key="t.id" class="nge-cl-limit-row">
              <span>{{ heldLabel(t) }}</span>
              <button class="nge-cl-btn nge-cl-limit-release" :disabled="releasing.has(String(t.id))" @click="releaseHeld(t)">
                <span v-if="releasing.has(String(t.id))" class="nge-cl-spin" />{{ releasing.has(String(t.id)) ? 'Releasing…' : 'Release' }}
              </button>
            </div>
          </div>
          <div v-if="claimError" class="nge-cl-error-banner" @click="claimError = ''">
            {{ claimError }}
            <span class="nge-cl-error-dismiss">×</span>
          </div>
          <div v-if="backend.loading && filter !== 'mine'" class="nge-cl-more"><span><span class="nge-cl-spin" /> Loading the rest of the cells...</span></div>
          <div v-if="filteredCells.length === 0 && filter === 'mine'" class="nge-cl-no-results">
            No claimed cells yet. Claim cells from the All or Available tabs!
          </div>
          <div v-else-if="filteredCells.length === 0 && filter === 'available' && !search.trim() && !backend.loading" class="nge-cl-no-results">
            No available cells in <strong>{{ currentDatasetLabel }}</strong>.
            <template v-if="suggestedClaimDataset">
              <br />Switch to <strong>{{ suggestedClaimDataset }}</strong> to claim a cell.
            </template>
          </div>
          <div v-else-if="filteredCells.length === 0 && !backend.loading" class="nge-cl-no-results">No matching cells</div>

          <button v-if="slim" class="nge-cl-slim-expand" title="Full view" aria-label="Full view" @click="expandAndStay">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button v-if="slim && myOpenClaims.length > (slimClaimIndex >= 0 ? 1 : 0)" class="nge-cl-slim-next" :disabled="steppingClaim"
                  :title="slimClaimIndex >= 0 ? `Next claimed cell (this is ${slimClaimIndex + 1} of ${myOpenClaims.length})` : `Go to your claimed cells (${myOpenClaims.length})`"
                  aria-label="Next claimed cell" @click="nextClaim">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <template v-for="cell in listCells" :key="cell.taskId ?? cell.segId">
          <div
            class="nge-cl-row"
            :class="{
              'nge-cl-row--done': cell.status === 'completed',
              'nge-cl-row--mine': isMyClaim(cell),
              'nge-cl-row--jumped': cell.segId === jumpedSegId,
            }"
          >
            <!-- Left: status pip + name -->
            <div class="nge-cl-row-left">
              <span class="nge-cl-pip" :class="statusClass(cell.status)"></span>
              <div class="nge-cl-row-info">
                <div class="nge-cl-row-name" @click="copyId(cell.segId)" :title="'Click to copy ' + cell.segId">
                  <span :title="cell.liveSegId ? `Updated after edits. Listed as ${cell.segId}` : undefined">{{ history.getNickname(cell.segId) || cell.liveSegId || cell.segId }}</span>
                  <span v-if="copiedId === cell.segId" class="nge-cl-copied">copied</span>
                </div>
                <div class="nge-cl-row-meta">
                  <span v-if="cell.segId === jumpedSegId" class="nge-cl-viewing">● viewing</span>
                  <span class="nge-cl-badge" :class="statusClass(cell.status)">{{ statusLabel(cell.status) }}</span>
                  <span v-if="cell.assignedTo" class="nge-cl-claimer">{{ getCachedUserName(cell.assignedTo) }}</span>
                  <span v-if="cell.notes" class="nge-cl-notes">{{ cell.notes }}</span>
                </div>
              </div>
            </div>

            <!-- Right: actions -->
            <div class="nge-cl-row-actions">
              <button
                class="nge-cl-btn nge-cl-btn--jump"
                :class="{ 'nge-cl-btn--jump-active': cell.segId === jumpedSegId }"
                @click="onRowJump(cell)"
                :title="cell.segId === jumpedSegId ? 'Currently viewing — jump again' : 'Jump to segment'"
              >↗</button>

              <button
                v-if="cell.status === 'pending' && isLoggedIn"
                class="nge-cl-btn nge-cl-btn--claim"
                :disabled="claiming.has(cellKey(cell))"
                @click="claimCell(cell)"
              ><span v-if="claiming.has(cellKey(cell))" class="nge-cl-spin" />{{ claiming.has(cellKey(cell)) ? 'Claiming…' : 'Claim' }}</button>

              <button
                v-if="isWorkingClaim(cell)"
                class="nge-cl-btn nge-cl-btn--saveview"
                :class="{ 'nge-cl-btn--saved': savedViewAt[cell.taskId] }"
                :disabled="savingView === cell.taskId"
                @click="saveClaimView(cell)"
                title="Save your current view (annotations, layers, camera) to this claim. The ↗ button opens it again."
              ><span v-if="savingView === cell.taskId" class="nge-cl-spin" />{{ savingView === cell.taskId ? 'Saving…' : savedViewAt[cell.taskId] ? 'Saved ✓' : 'Save view' }}</button>

              <button
                v-if="isMyClaim(cell) && teamAllowed && cell.status !== 'completed'"
                class="nge-cl-btn nge-cl-btn--team"
                :disabled="teamingUp === cellKey(cell)"
                @click="teamUpOnClaim(cell)"
                title="Work on this cell with up to three other players, each when they can. Opens the Teams tab."
              >{{ teamingUp === cellKey(cell) ? 'Starting…' : '👥 Team up' }}</button>

              <button
                v-if="isMyClaim(cell)"
                class="nge-cl-btn nge-cl-btn--release"
                :disabled="releasing.has(releaseKey(cell))"
                @click="releaseCell(cell)"
                title="Release claim"
              ><span v-if="releasing.has(releaseKey(cell))" class="nge-cl-spin" />{{ releasing.has(releaseKey(cell)) ? 'Releasing…' : 'Release' }}</button>

              <button
                v-if="isMyClaim(cell)"
                class="nge-cl-btn nge-cl-btn--complete"
                :class="{ 'nge-cl-btn--complete-open': completing?.key === cellKey(cell) }"
                @click="completing?.key === cellKey(cell) ? (completing = null) : openComplete(cell)"
              >Complete</button>
            </div>
          </div>

          <!-- Complete: the finished cell's link, and the crosshairs inside it,
               before anything is written (Amy 2026-09-28). -->
          <div v-if="completing && completing.key === cellKey(cell)" class="nge-cl-complete">
            <div class="nge-cl-complete-title">Complete this cell</div>
            <template v-if="completeStatusesFor(cell.dataset).length">
              <label class="nge-cl-complete-label">How did it end?</label>
              <div class="nge-cl-complete-statuses" role="radiogroup" aria-label="How did it end?">
                <button
                  v-for="o in completeStatusesFor(cell.dataset)" :key="o.value" type="button" role="radio"
                  class="nge-cl-complete-status" :class="{ 'nge-cl-complete-status--on': completing.status === o.value }"
                  :aria-checked="completing.status === o.value ? 'true' : 'false'" :title="o.hint"
                  @click="completing.status = o.value"
                >{{ o.value }}</button>
              </div>
            </template>
            <label class="nge-cl-complete-label">Link to your finished cell</label>
            <div class="nge-cl-complete-linkrow">
              <input
                v-model="completing.link"
                class="nge-cl-search-input"
                placeholder="https://… (the view of your finished cell)"
                @keydown.stop @keyup.stop @keypress.stop
              />
              <button class="nge-cl-btn" :disabled="completing.minting" @click="useCurrentViewLink"
                      title="Make a short link of what you are looking at now">{{ completing.minting ? '…' : 'Use my current view' }}</button>
            </div>
            <div v-if="completing.link && !linkLooksValid(completing.link)" class="nge-cl-complete-msg nge-cl-complete-msg--bad">
              Paste a full https viewer link.
            </div>
            <label class="nge-cl-complete-label">Notes (optional)</label>
            <textarea
              v-model="completing.notes"
              class="nge-cl-search-input nge-cl-complete-notes"
              rows="2"
              maxlength="1000"
              placeholder="Anything the reviewers should know, e.g. axon cut off at the edge"
              @keydown.stop @keyup.stop @keypress.stop
            ></textarea>
            <label class="nge-cl-complete-label">Crosshairs</label>
            <div class="nge-cl-complete-msg" :class="completing.checking ? '' : (completing.ok ? 'nge-cl-complete-msg--ok' : 'nge-cl-complete-msg--bad')">
              <template v-if="completing.checking">Checking where the crosshairs are…</template>
              <template v-else>{{ completing.ok ? '✓ ' : '✗ ' }}{{ completing.message }}</template>
              <button class="nge-cl-complete-recheck" :disabled="completing.checking" @click="runCrosshairCheck(cell)">Check again</button>
            </div>
            <div class="nge-cl-complete-actions">
              <button
                class="nge-cl-btn nge-cl-btn--complete"
                :disabled="completing.submitting || completing.checking || !completing.ok || !linkLooksValid(completing.link) || statusMissing(cell)"
                :title="statusMissing(cell) ? 'Pick how the cell ended first' : undefined"
                @click="submitComplete(cell)"
              ><span v-if="completing.submitting" class="nge-cl-spin" />{{ completing.submitting ? (completing.checking ? 'Checking crosshairs…' : 'Saving…') : 'Mark complete' }}</button>
              <button class="nge-cl-btn" :disabled="completing.submitting" @click="completing = null">Cancel</button>
            </div>
          </div>
          </template>
          <div v-if="!slimCell && filteredCells.length > shownCells.length" class="nge-cl-more">
            <span>Showing {{ shownCells.length.toLocaleString() }} of {{ filteredCells.length.toLocaleString() }}. Search finds any of them.</span>
            <button class="nge-cl-btn" @click="rowsShown += ROWS_STEP">Show {{ Math.min(ROWS_STEP, filteredCells.length - shownCells.length) }} more</button>
          </div>
        </div>

        <!-- Login prompt -->
        <div v-if="!isLoggedIn && cells.length > 0" class="nge-cl-login-hint">
          Log in to claim and complete cells
        </div>

        <!-- Resize handle (bottom-right corner) -->
        <div class="nge-cl-resize" @mousedown="startResize" title="Drag to resize">
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M11 5 L5 11 M11 9 L9 11" />
          </svg>
        </div>

      </div>
    </Transition>
  </Teleport>

  <!-- Cross-dataset jump confirmation modal -->
  <Teleport to="body">
    <div
      v-if="jumpConfirmReq"
      class="nge-cl-jumpconfirm-backdrop"
      @click.self="cancelJumpConfirm"
    >
      <div class="nge-cl-jumpconfirm">
        <div class="nge-cl-jumpconfirm-title">⚠ Switching dataset</div>
        <div class="nge-cl-jumpconfirm-body">
          This help request is on
          <strong>{{ jumpConfirmReq.dataset }}</strong>.
          You're currently viewing
          <strong>{{ activeDataset || 'an unknown dataset' }}</strong>.
          The viewer will reload with new layers — copy your current state URL first
          if you don't want to lose your spot.
        </div>
        <div v-if="!jumpConfirmTargetDs" class="nge-cl-jumpconfirm-warn">
          ⚠ This dataset isn't in the known dataset list. We'll jump to the segment
          but won't auto-switch layers — you may need to load it manually.
        </div>
        <div v-else-if="!jumpConfirmTargetServerHasAuth()" class="nge-cl-jumpconfirm-warn">
          ⚠ You haven't logged into this dataset's server yet. You'll be prompted
          to log in after the switch.
        </div>
        <div class="nge-cl-jumpconfirm-url-row">
          <input
            class="nge-cl-jumpconfirm-url"
            :value="getCurrentUrl()"
            readonly
            @click="selectInputContents"
            title="Click to select, then copy"
          />
          <button class="nge-cl-jumpconfirm-copy" @click="copyJumpConfirmUrl">
            {{ jumpConfirmCopied ? '✓ Copied' : '📋 Copy URL' }}
          </button>
        </div>
        <div class="nge-cl-jumpconfirm-save-row">
          <button class="nge-cl-jumpconfirm-save" @click="saveCurrentAsLink" :disabled="!backend.userId">
            💾 Save link before switching
          </button>
        </div>
        <div class="nge-cl-jumpconfirm-actions">
          <button class="nge-cl-jumpconfirm-cancel" @click="cancelJumpConfirm">Cancel</button>
          <button class="nge-cl-jumpconfirm-go" @click="confirmJump">
            {{ jumpConfirmTargetDs ? 'Switch & Jump' : 'Jump anyway' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Screenshot attach dialog for help requests -->
  <ScreenshotDialog
    :show="showHelpScreenshotDialog"
    mode="attach"
    hide-opener=".nge-cl-panel"
    @close="showHelpScreenshotDialog = false"
    @attached="onHelpScreenshotAttached"
  />
  <ScreenshotDialog
    :show="showResponseScreenshotDialog"
    mode="attach"
    hide-opener=".nge-cl-panel"
    @close="showResponseScreenshotDialog = false"
    @attached="onResponseScreenshotAttached"
  />
  <ScreenshotDialog
    :show="showLinkScreenshotDialog"
    mode="attach"
    hide-opener=".nge-cl-panel"
    @close="showLinkScreenshotDialog = false"
    @attached="onLinkScreenshotAttached"
  />
</template>

<style scoped>
.nge-cl-panel {
  position: fixed;
  z-index: 10010;
  width: 480px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  /* scifi-ui .holopanel surface: dark gradient, soft rim, lit inset line.
     Body text in the UI sans; ids and coordinates keep a mono face below. */
  background: linear-gradient(158deg, rgba(15, 18, 24, 0.96) 0%, rgba(6, 10, 18, 0.98) 100%);
  border: 1px solid rgba(74, 150, 224, 0.30);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5), 0 0 60px rgba(74, 150, 224, 0.06), inset 0 1px 0 rgba(196, 228, 255, 0.10);
  backdrop-filter: blur(10px) saturate(1.2);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  /* Readable base so the panel's em-scaled text doesn't inherit a tiny size and
     compound down (see the typography guideline in common.css). */
  font-size: var(--nge-fs-base);
  color: #ccd;
  overflow: hidden;
}

/* Enter/leave transition */
.nge-cl-enter-active, .nge-cl-leave-active { transition: opacity 0.2s, transform 0.2s; }
.nge-cl-enter-from, .nge-cl-leave-to { opacity: 0; transform: translateY(10px) scale(0.97); }

/* Resize handle — bottom-right corner. */
.nge-cl-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 2px;
  cursor: nwse-resize;
  color: rgba(160, 175, 230, 0.5);
  z-index: 2;
}
.nge-cl-resize:hover { color: rgba(160, 175, 230, 0.9); }
/* A grip people can find: three lit diagonal lines in the corner. */
.nge-cl-resize {
  width: 22px; height: 22px; cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 0 55%, rgba(120, 200, 255, 0.55) 55% 60%, transparent 60% 70%,
      rgba(120, 200, 255, 0.55) 70% 75%, transparent 75% 85%, rgba(120, 200, 255, 0.55) 85% 90%, transparent 90%);
  border-bottom-right-radius: 14px;
}
.nge-cl-resize:hover { filter: brightness(1.6); }

.nge-cl-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(30, 30, 60, 0.9);
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid rgba(120, 140, 255, 0.08);
}
.nge-cl-dragging { cursor: grabbing; }
.nge-cl-lane-icon { width: 16px; height: 16px; vertical-align: -3px; margin-right: 2px; }
/* ── "Success! You solved the tagged tangle!" celebration ── */
.nge-cl-tagwin {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 30;
  text-align: center;
  padding: 20px 30px;
  border-radius: 14px;
  background: rgba(5, 10, 22, 0.96);
  border: 1px solid rgba(96, 224, 128, 0.5);
  box-shadow: 0 0 30px rgba(96, 224, 128, 0.18), 0 12px 40px rgba(0, 0, 0, 0.6);
  cursor: pointer;
}
.nge-cl-tagwin-glyph { font-size: 26px; margin-bottom: 6px; }
.nge-cl-tagwin-glyph svg { width: 30px; height: 30px; filter: drop-shadow(0 0 8px rgba(96, 224, 128, 0.6)); }
.nge-cl-tagwin-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 16px; font-weight: 700; letter-spacing: 0.12em;
  color: #a8f5c0;
}
.nge-cl-tagwin-sub { font-size: 12px; color: #cde; margin-top: 3px; }
.nge-cl-tagwin-enter-active { transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-cl-tagwin-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.nge-cl-tagwin-enter-from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
.nge-cl-tagwin-leave-to { opacity: 0; transform: translate(-50%, -56%) scale(0.97); }

/* ── The orbit: a mote circles the resolve button, ducking behind it on
   the back half of each lap (z-index steps sell the occlusion), and on
   resolve it flings to the profile. ── */
.nge-orbit-wrap { position: relative; display: inline-flex; }
.nge-orbit-wrap .nge-cl-btn {
  position: relative;
  z-index: 1;
  /* Opaque face so the mote truly disappears behind it. */
  background-color: #141830;
}
.nge-orbit-dot {
  position: absolute;
  top: 50%; left: 50%;
  width: 4px; height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: #35b5ff;
  box-shadow: 0 0 6px rgba(53, 181, 255, 0.85);
  pointer-events: none;
  animation: nge-orbit 2.8s linear infinite;
}
@keyframes nge-orbit {
  0%    { transform: rotate(0deg)   translateX(19px) scale(1);    z-index: 2; opacity: 1; }
  49.9% { transform: rotate(180deg) translateX(19px) scale(1);    z-index: 2; opacity: 1; }
  50%   { transform: rotate(180deg) translateX(19px) scale(0.75); z-index: 0; opacity: 0.55; }
  99.9% { transform: rotate(360deg) translateX(19px) scale(0.75); z-index: 0; opacity: 0.55; }
  100%  { transform: rotate(360deg) translateX(19px) scale(1);    z-index: 2; opacity: 1; }
}

/* Armed delete confirm */
.nge-cl-btn--confirmdel {
  color: #ffb4b4 !important;
  border-color: rgba(224, 96, 96, 0.65) !important;
  background: rgba(224, 96, 96, 0.14) !important;
  font-size: 11px;
  white-space: nowrap;
}

.nge-cl-tag-pin { display: inline-flex; vertical-align: -2px; }
.nge-cl-tag-pin svg { filter: drop-shadow(0 0 4px rgba(53, 181, 255, 0.5)); }

/* Materialize on open, ported from scifi-ui hologram.css (holodialog):
   arrives blurred, overbright, slightly too large, settles through a soft
   overshoot at 60 per cent. Replaces the old fade transition. */
.nge-cl-panel {
  animation: nge-cl-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes nge-cl-materialize {
  0%   { opacity: 0; transform: scale(1.04) translateY(-10px);
         filter: blur(20px) brightness(3); }
  30%  { opacity: 0.6; filter: blur(3px) brightness(1.5); }
  60%  { opacity: 1; transform: scale(0.99); filter: blur(0) brightness(1.1); }
  100% { opacity: 1; transform: scale(1) translateY(0);
         filter: blur(0) brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .nge-cl-panel { animation: none; }
}

.nge-cl-gear {
  background: none; border: none; color: #7a8db0; font-size: 15px;
  cursor: pointer; padding: 0 6px; line-height: 1;
  transition: color 0.12s, transform 0.3s;
  /* Sit with the × on the right edge, not floating mid-bar. */
  margin-left: auto;
}
.nge-cl-gear:hover { color: #cfe0f5; transform: rotate(40deg); }

.nge-cl-tabsettings {
  position: absolute;
  top: 42px; right: 10px;
  z-index: 5;
  width: 180px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(6, 10, 20, 0.97);
  border: 1px solid rgba(100, 200, 255, 0.25);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column; gap: 6px;
  /* The panel clips its children (overflow hidden for rounded corners), so
     the popover scrolls inside the panel's height instead of getting cut. */
  max-height: calc(100% - 52px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.nge-cl-tabsettings-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(100, 200, 255, 0.75);
  margin-bottom: 2px;
}
.nge-cl-tabsettings-row {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; color: #cde; cursor: pointer;
}
.nge-cl-tabsettings-row input { accent-color: #64c8ff; }

.nge-cl-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  letter-spacing: 0.12em;
  font-size: 12px;
  font-weight: 700;
  color: #eef;
}
.nge-cl-icon { width: 18px; height: 18px; object-fit: contain; vertical-align: middle; }
.nge-cl-close {
  background: none;
  border: none;
  color: #889;
  font-size: 1.4em;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.nge-cl-close:hover { color: #eef; }

/* Filters */
.nge-cl-filters {
  display: flex;
  gap: 2px;
  padding: 8px 10px 4px;
  background: rgba(20, 20, 40, 0.6);
}
.nge-cl-filters button {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid rgba(120, 140, 255, 0.1);
  border-radius: 6px;
  background: transparent;
  color: #889;
  font-size: 0.72em;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}
.nge-cl-filters button.active {
  background: rgba(74, 158, 255, 0.12);
  color: #8bf;
  border-color: rgba(74, 158, 255, 0.25);
}
.nge-cl-filters button:hover:not(.active) { color: #bbf; }

/* Search */
.nge-cl-search { padding: 6px 10px; display: flex; align-items: center; }
.nge-cl-search .nge-cl-search-input { min-width: 0; }
.nge-cl-search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(120, 140, 255, 0.12);
  border-radius: 6px;
  background: rgba(10, 10, 30, 0.5);
  color: #ccd;
  font-size: 0.78em;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.nge-cl-search-input:focus {
  border-color: rgba(74, 158, 255, 0.3);
}
.nge-cl-search-input::placeholder { color: #556; }

/* List */
.nge-cl-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.nge-cl-list::-webkit-scrollbar { width: 4px; }
.nge-cl-list::-webkit-scrollbar-thumb { background: rgba(120, 140, 255, 0.15); border-radius: 2px; }

.nge-cl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(120, 140, 255, 0.04);
  transition: background 0.1s;
}
.nge-cl-row:hover { background: rgba(74, 158, 255, 0.04); }
.nge-cl-row--done { opacity: 0.65; }
.nge-cl-more { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; font-size: 0.85em; color: rgba(204, 214, 235, 0.7); }
.nge-cl-row--mine { background: rgba(74, 158, 255, 0.06); }
/* The cell you last jumped to — stands out even in a long Available list. */
.nge-cl-row--jumped {
  background: rgba(0, 220, 160, 0.10);
  box-shadow: inset 3px 0 0 rgba(0, 230, 160, 0.9);
}
.nge-cl-row--jumped:hover { background: rgba(0, 220, 160, 0.14); }
.nge-cl-viewing {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #34e6a8;
  text-shadow: 0 0 6px rgba(0, 230, 160, 0.4);
  white-space: nowrap;
}

.nge-cl-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.nge-cl-pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #556;
}
.nge-cl-status--available { background: #4a6; }
.nge-cl-status--claimed { background: #fa4; }
.nge-cl-status--done { background: #4af; }
.nge-cl-status--help { background: #f8a; }

.nge-cl-row-info {
  min-width: 0;
  flex: 1;
}
.nge-cl-row-name {
  font-size: 0.82em;
  font-weight: 600;
  color: #dde;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nge-cl-row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.nge-cl-badge {
  font-size: 0.65em;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.nge-cl-badge.nge-cl-status--available { background: rgba(68, 170, 102, 0.15); color: #4a6; }
.nge-cl-badge.nge-cl-status--claimed { background: rgba(255, 170, 68, 0.15); color: #fa4; }
.nge-cl-badge.nge-cl-status--done { background: rgba(68, 170, 255, 0.15); color: #4af; }

.nge-cl-notes {
  font-size: 0.68em;
  color: #667;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nge-cl-row-name { cursor: pointer; }
.nge-cl-row-name:hover { color: #eef; }

.nge-cl-copied {
  font-size: 0.75em;
  color: #4a6;
  margin-left: 6px;
  font-weight: 400;
}

/* Actions */
.nge-cl-row-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}
.nge-cl-btn {
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
.nge-cl-btn:hover { background: rgba(74, 158, 255, 0.1); }

.nge-cl-btn--jump {
  font-size: 0.85em;
  padding: 3px 7px;
  color: #889;
}
.nge-cl-btn--jump:hover { color: #bbf; }
.nge-cl-btn--jump-active {
  color: #34e6a8;
  border-color: rgba(0, 230, 160, 0.5);
  background: rgba(0, 220, 160, 0.12);
}

.nge-cl-btn--claim {
  border-color: rgba(68, 170, 102, 0.25);
  color: #4a6;
}
.nge-cl-btn--claim:hover { background: rgba(68, 170, 102, 0.12); }

.nge-cl-btn--complete {
  border-color: rgba(68, 170, 255, 0.25);
  color: #4af;
}
.nge-cl-btn--complete:hover { background: rgba(68, 170, 255, 0.12); }
.nge-cl-btn--complete-open { background: rgba(68, 170, 255, 0.16); border-color: rgba(68, 170, 255, 0.55); }
.nge-cl-btn:disabled { opacity: 0.45; cursor: default; }

/* Complete form: link + crosshairs check (Amy 2026-09-28) */
.nge-cl-complete {
  margin: 2px 6px 8px;
  padding: 10px 12px;
  border: 1px solid rgba(68, 170, 255, 0.3);
  border-radius: 8px;
  background: rgba(10, 24, 44, 0.85);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nge-cl-complete-title { color: #8cf; font-weight: 600; font-size: 0.9em; letter-spacing: 0.03em; }
.nge-cl-complete-label { color: #9ab; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
.nge-cl-complete-statuses { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-cl-complete-status {
  padding: 4px 10px; border-radius: 999px; cursor: pointer;
  font: 500 0.82em Inter, system-ui, sans-serif; color: #b9c8e0;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.14);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.nge-cl-complete-status:hover { background: rgba(68, 170, 255, 0.1); border-color: rgba(68, 170, 255, 0.4); }
.nge-cl-complete-status--on {
  color: #fff; background: rgba(68, 170, 255, 0.2); border-color: #4af;
  box-shadow: 0 0 10px rgba(68, 170, 255, 0.3);
}
.nge-cl-complete-linkrow { display: flex; gap: 6px; align-items: center; }
.nge-cl-complete-linkrow .nge-cl-search-input { flex: 1; min-width: 0; }
.nge-cl-complete-linkrow .nge-cl-btn { white-space: nowrap; }
.nge-cl-complete-msg { font-size: 0.8em; line-height: 1.4; color: #bcd; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nge-cl-complete-msg--ok { color: #6d9; }
.nge-cl-complete-msg--bad { color: #f98; }
.nge-cl-complete-recheck {
  margin-left: auto;
  background: none;
  border: 1px solid rgba(160, 190, 220, 0.3);
  border-radius: 4px;
  color: #bcd;
  font-size: 0.9em;
  padding: 1px 8px;
  cursor: pointer;
}
.nge-cl-complete-recheck:hover:not(:disabled) { border-color: rgba(160, 190, 220, 0.6); }
.nge-cl-complete-notes { resize: vertical; min-height: 2.6em; font-family: inherit; width: 100%; box-sizing: border-box; }
.nge-cl-complete-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px; }

.nge-cl-btn--release {
  border-color: rgba(255, 170, 68, 0.2);
  color: #a86;
}
.nge-cl-btn--release:hover { background: rgba(255, 170, 68, 0.08); }
.nge-cl-btn--saveview {
  border-color: rgba(100, 200, 255, 0.3);
  color: #8fd3ff;
  white-space: nowrap;
}
.nge-cl-btn--saveview:hover { background: rgba(100, 200, 255, 0.1); }
.nge-cl-btn--saved { border-color: rgba(68, 200, 120, 0.5); color: #6d9; }
.nge-cl-batch-claim {
  flex: 0 0 auto;
  margin-left: 8px;
  white-space: nowrap;
  border-color: rgba(68, 170, 102, 0.45);
  color: #6d9;
  font-weight: 600;
}
.nge-cl-batch-claim:hover:not(:disabled) { background: rgba(68, 170, 102, 0.12); }
/* Small spinner inside a busy button (Release). */
.nge-cl-spin {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  margin-right: 5px;
  vertical-align: -0.1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: nge-cl-spin 0.7s linear infinite;
}
@keyframes nge-cl-spin { to { transform: rotate(360deg); } }

/* States */
.nge-cl-loading, .nge-cl-empty, .nge-cl-no-results {
  padding: 24px 16px;
  text-align: center;
  color: #667;
  font-size: 0.82em;
}
.nge-cl-hint { font-size: 0.75em; margin-top: 6px; color: #556; }

.nge-cl-login-hint {
  padding: 8px 14px;
  text-align: center;
  font-size: 0.72em;
  color: #fa4;
  background: rgba(255, 170, 68, 0.05);
  border-top: 1px solid rgba(255, 170, 68, 0.1);
}

/* Help tab */
.nge-cl-help-tab.active {
  background: rgba(255, 136, 170, 0.12);
  color: #f8a;
  border-color: rgba(255, 136, 170, 0.25);
}
.nge-cl-badge.nge-cl-status--help {
  background: rgba(255, 136, 170, 0.15);
  color: #f8a;
}
.nge-cl-help-note {
  font-size: 0.72em;
  color: #99a;
  margin-top: 3px;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  cursor: pointer;
}
.nge-cl-help-note--expanded {
  -webkit-line-clamp: unset;
  display: block;
}
.nge-cl-help-resolved-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
  font-size: 0.72em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #667;
  cursor: pointer;
  user-select: none;
}
.nge-cl-help-resolved-header:hover { color: #889; }
.nge-cl-help-resolved-arrow {
  display: inline-block;
  transition: transform 0.15s;
  font-size: 0.9em;
}
.nge-cl-help-resolved-arrow--open {
  transform: rotate(90deg);
}

/* Claimed tab */
.nge-cl-claimed-tab.active {
  background: rgba(255, 215, 0, 0.12);
  color: #fd0;
  border-color: rgba(255, 215, 0, 0.25);
}
.nge-cl-claimer {
  font-size: 0.68em;
  color: #fd0;
  font-weight: 600;
}

/* Claim error banner */
.nge-cl-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: rgba(255, 80, 60, 0.12);
  border-bottom: 1px solid rgba(255, 80, 60, 0.2);
  color: #f86;
  font-size: 0.78em;
  cursor: pointer;
}
.nge-cl-error-dismiss {
  font-size: 1.1em;
  opacity: 0.6;
  margin-left: 8px;
}
.nge-cl-error-banner:hover .nge-cl-error-dismiss { opacity: 1; }
.nge-cl-limit {
  padding: 8px 14px;
  background: rgba(255, 170, 60, 0.1);
  border-bottom: 1px solid rgba(255, 170, 60, 0.25);
  color: #fc8;
  font-size: 0.8em;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nge-cl-limit-head { display: flex; justify-content: space-between; gap: 8px; }
.nge-cl-limit-head .nge-cl-error-dismiss { cursor: pointer; opacity: 0.7; }
.nge-cl-limit-row { display: flex; justify-content: space-between; align-items: center; color: #dde; font-size: 1.05em; }
.nge-cl-limit-release {
  font-size: 1em;
  padding: 5px 14px;
  border-color: rgba(255, 170, 68, 0.5);
  color: #fc8;
}
.nge-cl-limit-release:hover { background: rgba(255, 170, 68, 0.15); }

/* Help response form */
.nge-cl-help-item {
  border-bottom: 1px solid rgba(120, 140, 255, 0.04);
}
.nge-cl-help-item--active {
  background: rgba(255, 136, 170, 0.08);
  border-left: 2px solid #f8a;
}
.nge-cl-help-item .nge-cl-row {
  border-bottom: none;
}
.nge-cl-btn--respond {
  font-size: 0.75em;
  padding: 3px 7px;
}
.nge-cl-response-form {
  padding: 6px 12px 10px 28px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nge-cl-response-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 6px;
  background: rgba(10, 10, 30, 0.6);
  color: #ccd;
  font-size: 0.76em;
  font-family: inherit;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.nge-cl-response-textarea:focus {
  border-color: rgba(74, 158, 255, 0.3);
}
.nge-cl-response-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(120, 140, 255, 0.12);
  border-radius: 5px;
  background: rgba(10, 10, 30, 0.5);
  color: #ccd;
  font-size: 0.72em;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.nge-cl-response-input:focus {
  border-color: rgba(74, 158, 255, 0.3);
}
.nge-cl-response-url-row {
  display: flex;
  gap: 4px;
  align-items: stretch;
}
.nge-cl-response-url-row .nge-cl-response-input {
  flex: 1;
  min-width: 0;
}
.nge-cl-btn--copy-state {
  font-size: 0.68em;
  padding: 4px 8px;
  white-space: nowrap;
  flex-shrink: 0;
}
.nge-cl-btn--submit-response {
  align-self: flex-end;
  border-color: rgba(68, 170, 102, 0.25);
  color: #4a6;
  padding: 5px 12px;
}
.nge-cl-btn--submit-response:hover { background: rgba(68, 170, 102, 0.12); }
.nge-cl-btn--submit-response:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Response display on resolved items */
.nge-cl-response-display {
  padding: 4px 12px 8px 28px;
  font-size: 0.72em;
}
.nge-cl-response-label {
  color: #7f8;
  font-weight: 600;
  margin-bottom: 2px;
}
.nge-cl-response-text {
  color: #aab;
  line-height: 1.4;
  white-space: pre-wrap;
  margin-bottom: 3px;
}
.nge-cl-response-link {
  color: #8bf;
  cursor: pointer;
  text-decoration: none;
  margin-right: 10px;
}
.nge-cl-response-link:hover { color: #adf; text-decoration: underline; }
.nge-cl-response-layer {
  color: #889;
}
.nge-cl-btn--reply {
  display: inline-block;
  margin-top: 4px;
  font-size: 0.7em;
  padding: 2px 8px;
  color: #8cf;
  background: rgba(100, 180, 255, 0.1);
  border: 1px solid rgba(100, 180, 255, 0.2);
  border-radius: 4px;
  cursor: pointer;
}
.nge-cl-btn--reply:hover {
  background: rgba(100, 180, 255, 0.2);
}

/* ── Help Request Create Button ── */
.nge-cl-help-create-btn {
  background: rgba(255, 136, 170, 0.12);
  border: 1px solid rgba(255, 136, 170, 0.3);
  color: #f8a;
  font-size: 1.1em;
  font-weight: 700;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.12s, transform 0.12s;
  flex-shrink: 0;
  line-height: 1;
}
.nge-cl-help-create-btn:hover {
  background: rgba(255, 136, 170, 0.22);
  transform: scale(1.1);
}
.nge-cl-help-create-btn.active {
  background: rgba(255, 136, 170, 0.28);
  color: #ffd0e0;
}

/* Prominent "New help request" call-to-action in the empty state. */
.nge-cl-help-create-cta {
  margin-top: 10px;
  padding: 7px 14px;
  font-size: 0.8em;
  font-weight: 600;
  color: #ffd0e0;
  background: rgba(255, 136, 170, 0.14);
  border: 1px solid rgba(255, 136, 170, 0.35);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-cl-help-create-cta:hover { background: rgba(255, 136, 170, 0.26); }

/* Segment-ID field in the create form. */
.nge-cl-help-segid-wrap {
  display: flex;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.nge-cl-help-segid-input {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #ccd;
  font-size: 0.78em;
  font-family: inherit;
  padding: 5px 8px;
}
.nge-cl-help-segid-input:focus {
  outline: none;
  border-color: rgba(255, 136, 170, 0.4);
}
.nge-cl-help-segid-input::placeholder { color: #556; }
.nge-cl-help-segid-use {
  flex-shrink: 0;
  font-size: 0.72em;
  padding: 4px 8px;
  color: #bcd;
  background: rgba(120, 140, 255, 0.1);
  border: 1px solid rgba(120, 140, 255, 0.22);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.nge-cl-help-segid-use:hover { background: rgba(120, 140, 255, 0.2); }
.nge-cl-help-create-err {
  color: #ff9d9d;
  font-size: 0.74em;
  margin: -2px 0 8px;
}

/* ── Help quick-add bar (always visible at top of Help list) ── */
/* Collapsed state: a quiet action button rather than a standing panel. */
.nge-cl-team-btn { margin-bottom: 6px; }
.nge-cl-btn--team { color: #9fe8c0; border-color: rgba(93, 255, 160, 0.35); }
.nge-cl-btn--join { color: #9fe8c0; border-color: rgba(93, 255, 160, 0.35); }
.nge-cl-btn--join:disabled { opacity: 0.6; cursor: default; }
.nge-cl-help-open-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0 0 10px;
  padding: 8px 12px;
  background: rgba(74, 158, 255, 0.07);
  border: 1px dashed rgba(74, 158, 255, 0.28);
  border-radius: 8px;
  color: rgba(180, 200, 230, 0.9);
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.nge-cl-help-open-btn:hover {
  background: rgba(74, 158, 255, 0.14);
  border-color: rgba(74, 158, 255, 0.5);
  color: #e0ecff;
}
.nge-cl-help-open-plus { font-size: 1.15em; line-height: 1; opacity: 0.8; }

/* Expanded form. Recoloured from pink to the blue accent: the old
   rgba(255,136,170,…) treatment read as an error/alert sitting permanently at
   the top of the tab, rather than a form you could choose to use. */
.nge-cl-help-quickadd {
  background: rgba(74, 158, 255, 0.06);
  border: 1px solid rgba(74, 158, 255, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 10px;
}
.nge-cl-help-quickadd-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8em;
  font-weight: 700;
  color: #9fc4f5;
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}
.nge-cl-help-collapse {
  background: none;
  border: none;
  color: rgba(150, 175, 215, 0.7);
  font-size: 1em;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
}
.nge-cl-help-collapse:hover { color: #cfdcef; }
.nge-cl-help-quickadd-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.nge-cl-help-quickadd-row:last-of-type { margin-bottom: 0; }
/* ── Themed <select> ──────────────────────────────────────────────────────
   The dropdown POPUP is drawn by the operating system, not by our CSS, so a
   dark-styled control still opened a light grey list with a blue highlight
   that looked nothing like the rest of the UI (and was hard to read).
   `color-scheme: dark` switches that native popup to dark chrome, and styling
   `option` sets the row colours Chrome honours. `appearance: none` plus a
   drawn chevron replaces the default OS arrow on the closed control. */
.nge-cl-help-issue-select,
select.nge-cl-response-input {
  color-scheme: dark;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' fill='none' stroke='%238fa6c8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 7px center;
  background-size: 11px;
  padding-right: 24px;
}
.nge-cl-help-issue-select option,
select.nge-cl-response-input option {
  background: #0c1020;
  color: #cfdcef;
}
.nge-cl-help-issue-select:hover,
select.nge-cl-response-input:hover {
  border-color: rgba(74, 158, 255, 0.35);
}

.nge-cl-help-kind { display: flex; gap: 4px; margin-bottom: 6px; }
.nge-cl-help-tochat { display: flex; align-items: center; gap: 6px; margin: -2px 0 6px; font-size: 0.74em; color: #9fb0c8; cursor: pointer; }
.nge-cl-help-tochat input { accent-color: #4a9eff; margin: 0; }
.nge-cl-help-kind-opt { flex: 1; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; color: #9fb0c8; font: inherit; font-size: 0.76em; padding: 5px 6px; cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s; }
.nge-cl-help-kind-opt[aria-checked="true"] { background: rgba(70, 160, 255, 0.2); border-color: rgba(120, 190, 255, 0.8); color: #eaf4ff; }
.nge-cl-help-kind-opt--live[aria-checked="true"] { background: rgba(93, 255, 160, 0.16); border-color: rgba(93, 255, 160, 0.7); color: #d8ffe9; }
.nge-cl-help-kind-opt:focus-visible { outline: 2px solid #6cf; outline-offset: 1px; }
.nge-cl-help-kind-note { font-size: 0.72em; color: #9fe8c0; margin: -2px 0 6px; }
.nge-cl-badge--live { color: #9fe8c0 !important; border-color: rgba(93, 255, 160, 0.45) !important; }
.nge-cl-help-layers {
  position: relative;
  margin-top: 6px;
}
.nge-cl-help-layers-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  background-color: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #cfdcef;
  font: inherit;
  font-size: 0.76em;
  padding: 5px 8px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s;
}
.nge-cl-help-layers-toggle:hover,
.nge-cl-help-layers-toggle[aria-expanded="true"] { border-color: rgba(120, 190, 255, 0.6); }
.nge-cl-help-layers-toggle:focus-visible { outline: 2px solid #6cf; outline-offset: 1px; }
.nge-cl-help-layers-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nge-cl-help-layers-caret { flex-shrink: 0; opacity: 0.7; }
.nge-cl-help-layers-menu {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  top: calc(100% + 3px);
  max-height: 168px;
  overflow-y: auto;
  background: #0d1424;
  border: 1px solid rgba(120, 190, 255, 0.45);
  border-radius: 6px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
  padding: 4px 0;
}
.nge-cl-help-layers-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 9px;
  font-size: 0.76em;
  color: #cfdcef;
  cursor: pointer;
}
.nge-cl-help-layers-item:hover { background: rgba(70, 160, 255, 0.14); }
.nge-cl-help-layers-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nge-cl-help-layers-item input { flex-shrink: 0; accent-color: #4a9eff; margin: 0; }
.nge-cl-help-layers-item--all { border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 6px; margin-bottom: 2px; font-weight: 600; }
.nge-cl-help-issue-select {
  flex-shrink: 0;
  background-color: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  /* Was #ccd, which sat too dim against the panel. */
  color: #cfdcef;
  font-size: 0.76em;
  font-family: inherit;
  padding: 5px 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.nge-cl-help-issue-select:focus { outline: none; border-color: rgba(74, 158, 255, 0.5); }
.nge-cl-help-note-input {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #ccd;
  font-size: 0.8em;
  font-family: inherit;
  padding: 6px 9px;
}
.nge-cl-help-note-input:focus { outline: none; border-color: rgba(255, 136, 170, 0.4); }
.nge-cl-help-note-input::placeholder { color: #667; }
.nge-cl-help-shot-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: #bcd;
  background: rgba(120, 140, 255, 0.1);
  border: 1px solid rgba(120, 140, 255, 0.2);
  border-radius: 6px;
  cursor: pointer;
}
.nge-cl-help-shot-icon:hover { background: rgba(120, 140, 255, 0.2); color: #dde; }
.nge-cl-help-quickadd-submit {
  flex-shrink: 0;
  font-size: 0.78em;
  font-weight: 600;
  color: #fff;
  background: rgba(74, 158, 255, 0.85);
  border: 1px solid rgba(120, 185, 255, 0.7);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
}
.nge-cl-help-quickadd-submit:hover { background: rgba(96, 175, 255, 1); }
.nge-cl-help-shot-preview--sm { margin-top: 6px; }
.nge-cl-help-shot-preview--sm img { max-height: 48px; border-radius: 4px; }

/* ── Help Request Create Form ── */
.nge-cl-btn--tagdone {
  font-size: 16px;
  padding: 4px 12px;
  border-color: rgba(96, 192, 96, 0.5) !important;
}

.nge-cl-tags-lanes { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

/* ── Grouped tab bar ── */
.nge-cl-filters--grouped { display: flex; flex-wrap: wrap; gap: 10px 14px; padding: 10px 12px 8px; background: transparent; }
.nge-cl-tabgroup { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.nge-cl-tabgroup--cells { flex: 1 1 100%; }
.nge-cl-tabgroup-label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; color: var(--grp); opacity: 0.85; }
.nge-cl-tabgroup-row { display: flex; gap: 4px; flex-wrap: wrap; }
.nge-cl-tabgroup-head { display: flex; align-items: center; gap: 10px; }
/* Dataset links (MEC): small HUD labels, a diamond marker each, a thin
   divider between, glow and a sweeping underline on hover (Ames: "not very
   scifi UI"; before that "just a little blue clickable word"). */
.nge-cl-headlinks { margin-left: auto; display: flex; align-items: center; }
.nge-cl-howto {
  position: relative; display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 0; font-size: 9.5px; font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase; color: rgba(126, 202, 255, 0.78); text-decoration: none;
  transition: color 0.15s, text-shadow 0.15s;
}
.nge-cl-howto + .nge-cl-howto { margin-left: 11px; padding-left: 11px; border-left: 1px solid rgba(126, 202, 255, 0.22); }
.nge-cl-howto::before {
  content: ''; width: 5px; height: 5px; flex: none; transform: rotate(45deg);
  border: 1px solid currentColor; transition: background 0.15s, box-shadow 0.15s;
}
.nge-cl-howto::after {
  content: ''; position: absolute; left: 11px; right: 0; bottom: -2px; height: 1px;
  background: linear-gradient(90deg, currentColor, transparent);
  transform: scaleX(0); transform-origin: left; transition: transform 0.22s ease-out;
}
.nge-cl-howto + .nge-cl-howto::after { left: 22px; }
.nge-cl-howto:hover { color: #e6f7ff; text-shadow: 0 0 8px rgba(126, 202, 255, 0.75); }
.nge-cl-howto:hover::before { background: currentColor; box-shadow: 0 0 6px rgba(126, 202, 255, 0.9); }
.nge-cl-howto:hover::after { transform: scaleX(1); }
.nge-cl-howto--open { color: #e6f7ff; }
.nge-cl-howto--open::before { background: currentColor; }
.nge-cl-howto-panel {
  margin: 4px 12px 10px;
  padding: 10px 12px 8px;
  border-radius: 10px;
  background: rgba(66, 213, 236, 0.06);
  border: 1px solid rgba(66, 213, 236, 0.28);
  animation: nge-cl-howto-in 0.2s ease-out both;
}
@keyframes nge-cl-howto-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.nge-cl-howto-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #7ee8ff; margin-bottom: 6px;
}
.nge-cl-howto-close {
  background: none; border: none; color: #8aa; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px;
}
.nge-cl-howto-close:hover { color: #fff; }
.nge-cl-howto-steps {
  margin: 0; padding-left: 20px;
  font-size: 12.5px; line-height: 1.5; color: #cfdcef;
}
.nge-cl-howto-steps li { margin: 3px 0; padding-left: 2px; }
.nge-cl-howto-steps li::marker { color: #42d5ec; font-weight: 700; }
.nge-cl-howto-steps :deep(b) { color: #fff; font-weight: 600; }
.nge-cl-howto-steps :deep(a) { color: #7ecaff; }
.nge-cl-howto-steps :deep(a:hover) { color: #fff; }
.nge-cl-tabgroup--cells { --grp: #42d5ec; }
.nge-cl-tabgroup--community { --grp: #e6c760; }
.nge-cl-tabgroup--mine { --grp: #c98bff; }
.nge-cl-filters--grouped button {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px; border-radius: 8px; font-size: 12.5px; font-weight: 500;
  color: rgba(220, 232, 245, 0.78); background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.nge-cl-filters--grouped button b { font-weight: 700; font-size: 11.5px; color: var(--grp); }
.nge-cl-filters--grouped button:hover { border-color: color-mix(in srgb, var(--grp) 45%, transparent); color: #fff; }
.nge-cl-filters--grouped button.active {
  color: #fff; background: color-mix(in srgb, var(--grp) 16%, transparent);
  border-color: color-mix(in srgb, var(--grp) 60%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--grp) 22%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

/* ── Show tags on the map ── */
.nge-cl-map-switch {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; cursor: pointer;
  margin: 8px 0 10px; padding: 9px 12px; border-radius: 10px;
  background: rgba(230, 199, 96, 0.06); border: 1px solid rgba(230, 199, 96, 0.22);
  font-size: 13px; font-weight: 600; color: #f0e3b0;
}
.nge-cl-map-switch input { position: absolute; opacity: 0; pointer-events: none; }
.nge-cl-map-switch-track { width: 34px; height: 18px; border-radius: 10px; background: rgba(255, 255, 255, 0.14); position: relative; transition: background 0.15s; flex: 0 0 auto; }
.nge-cl-map-switch-track span { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #cfd8e3; transition: transform 0.15s; }
.nge-cl-map-switch--on .nge-cl-map-switch-track { background: #e6c760; }
.nge-cl-map-switch--on .nge-cl-map-switch-track span { transform: translateX(16px); background: #1a1405; }
.nge-cl-map-switch-note { flex-basis: 100%; font-size: 11.5px; font-weight: 400; color: rgba(240, 227, 176, 0.65); margin-left: 44px; margin-top: -4px; }

/* ── Tag rows as cards: a type-coloured stripe, readable text ── */
.nge-cl-tag-card {
  margin: 0 0 8px; border: 1px solid rgba(255, 255, 255, 0.07); border-left: 3px solid var(--tag-color);
  border-radius: 10px; background: linear-gradient(158deg, rgba(20, 26, 36, 0.9), rgba(10, 14, 22, 0.9));
  padding: 4px 2px;
}
.nge-cl-tag-card:hover { border-color: rgba(255, 255, 255, 0.14); border-left-color: var(--tag-color); }
.nge-cl-tag-card .nge-cl-row-name { font-size: 14px; font-weight: 700; color: #eef4fb; letter-spacing: 0.01em; }
.nge-cl-tag-card .nge-cl-row-name .nge-cl-notes { font-size: 11.5px; font-weight: 500; }
.nge-cl-tag-card .nge-cl-notes { font-size: 12px; color: rgba(190, 205, 222, 0.75); }
.nge-cl-tag-card .nge-cl-row-meta .nge-cl-notes:first-child {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace; font-size: 11px; color: rgba(150, 200, 240, 0.7);
}
.nge-cl-tag-card .nge-cl-pip { box-shadow: 0 0 8px var(--tag-color); }
.nge-cl-tags-lanes + .nge-cl-tags-lanes { margin-top: 6px; }
.nge-cl-lanes-label {
  width: 52px; flex: 0 0 auto;
  font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(170, 187, 204, 0.6);
}
.nge-cl-tags-lanes button {
  padding: 4px 10px; border-radius: 12px; font-size: 11.5px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #abc;
}
.nge-cl-tags-lanes button.nge-cl-lane--active {
  background: rgba(245,209,66,0.14); border-color: rgba(245,209,66,0.5); color: #ffe9a0;
}

.nge-cl-tags-hint {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.45;
}

/* ── AI tab (model-detected candidates) ── */
.nge-cl-ai-conf {
  font-weight: 700;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11.5px;
  margin-left: 2px;
}
.nge-cl-btn--split {
  font-size: 14px;
  border-color: rgba(255, 140, 60, 0.4) !important;
}
.nge-cl-btn--split-active {
  background: rgba(255, 140, 60, 0.2) !important;
  border-color: rgba(255, 160, 80, 0.8) !important;
}
.nge-cl-ai-credit {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.45);
  margin: -4px 0 9px;
}
.nge-cl-ai-scale { display: flex; align-items: center; gap: 7px; }
.nge-cl-ai-scale-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #4a9eff, #ffd700);
}
.nge-cl-ai-dot { border-radius: 50%; flex-shrink: 0; }
.nge-cl-ai-dot--cool { width: 8px; height: 8px; background: #4a9eff; }
.nge-cl-ai-dot--hot {
  width: 14px; height: 14px;
  background: #ffd700;
  box-shadow: 0 0 7px rgba(255, 215, 0, 0.6);
}
.nge-cl-ai-scale-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 3px;
}
.nge-cl-ai-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 6px;
  margin-top: 8px;
  cursor: pointer;
  border-bottom: 1px solid rgba(100, 200, 255, 0.14);
  user-select: none;
}
.nge-cl-ai-group-caret { color: rgba(100, 200, 255, 0.7); width: 12px; }
.nge-cl-ai-group-name {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: rgba(160, 215, 255, 0.9);
  font-family: 'Consolas', 'Monaco', monospace;
}
.nge-cl-ai-group-heat {
  margin-left: auto;
  padding: 3px 9px;
  border-radius: 11px;
  font-size: 11px;
  cursor: pointer;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  color: #abc;
}
.nge-cl-ai-group-heat.nge-cl-lane--active {
  background: rgba(245,209,66,0.14);
  border-color: rgba(245,209,66,0.5);
  color: #ffe9a0;
}

/* ── connectome.quest resources (Help tab footer) ── */
.nge-cl-quest {
  margin-top: 14px;
  padding: 12px 12px 10px;
  border: 1px solid rgba(100, 200, 255, 0.12);
  border-radius: 8px;
  background: rgba(100, 200, 255, 0.04);
}
.nge-cl-quest-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(100, 200, 255, 0.75);
  text-transform: uppercase;
  margin-bottom: 8px;
}
.nge-cl-quest-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px 10px;
}
.nge-cl-quest-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.75);
  text-decoration: none;
  font-size: 12px;
  transition: background 0.12s ease, color 0.12s ease;
}
.nge-cl-quest-link:hover {
  background: rgba(100, 200, 255, 0.1);
  color: #fff;
}
.nge-cl-quest-icon { font-size: 13px; line-height: 1; }
.nge-cl-quest-label { white-space: nowrap; }

.nge-cl-help-create {
  background: rgba(255, 136, 170, 0.04);
  border: 1px solid rgba(255, 136, 170, 0.15);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 10px;
}

.nge-cl-help-create-title {
  font-size: 0.88em;
  font-weight: 700;
  color: #f8a;
  margin-bottom: 4px;
}

.nge-cl-help-create-hint {
  font-size: 0.72em;
  color: #778;
  margin-bottom: 10px;
}

.nge-cl-help-create-row {
  margin-bottom: 8px;
}

.nge-cl-help-create-label {
  display: block;
  font-size: 0.72em;
  font-weight: 600;
  color: #99a;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nge-cl-help-create-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.nge-cl-help-chip {
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: #99a;
  font-size: 0.72em;
  cursor: pointer;
  transition: all 0.12s;
}
.nge-cl-help-chip:hover {
  background: rgba(255, 136, 170, 0.08);
  border-color: rgba(255, 136, 170, 0.2);
}
.nge-cl-help-chip--active {
  background: rgba(255, 136, 170, 0.15);
  border-color: rgba(255, 136, 170, 0.35);
  color: #f8a;
  font-weight: 600;
}

.nge-cl-help-create-note {
  width: 100%;
  /* border-box: width 100% plus padding and border poked past the form's
     right edge (fit audit 2026-09-28). */
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #ccd;
  font-size: 0.78em;
  padding: 6px 8px;
  resize: vertical;
  margin-bottom: 8px;
  font-family: inherit;
}
.nge-cl-help-create-note:focus {
  outline: none;
  border-color: rgba(255, 136, 170, 0.3);
}

.nge-cl-help-shot-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 8px;
}
.nge-cl-help-shot-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(74, 158, 255, 0.3);
  background: rgba(74, 158, 255, 0.06);
  color: #8bf;
  font-size: var(--nge-fs-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.nge-cl-help-shot-btn:hover {
  background: rgba(74, 158, 255, 0.14);
  border-color: rgba(74, 158, 255, 0.6);
}
.nge-cl-help-shot-preview {
  position: relative;
  display: inline-block;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 136, 170, 0.3);
}
.nge-cl-help-shot-preview img {
  display: block;
  width: 110px;
  height: 62px;
  object-fit: cover;
}
.nge-cl-help-shot-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.nge-cl-help-shot-remove:hover { background: rgba(255, 80, 80, 0.85); }

.nge-cl-help-shot-thumb {
  display: inline-block;
  margin-top: 4px;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: border-color 0.15s, transform 0.1s;
}
.nge-cl-help-shot-thumb:hover {
  border-color: rgba(74, 200, 255, 0.55);
  transform: translateY(-1px);
}
.nge-cl-help-shot-thumb img {
  display: block;
  width: 96px;
  height: 54px;
  object-fit: cover;
}

.nge-cl-help-create-actions {
  display: flex;
  gap: 8px;
}

.nge-cl-help-create-submit {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 136, 170, 0.3);
  background: rgba(255, 136, 170, 0.1);
  color: #f8a;
  font-size: 0.78em;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-cl-help-create-submit:hover {
  background: rgba(255, 136, 170, 0.2);
}

.nge-cl-help-create-cancel {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: none;
  color: #778;
  font-size: 0.78em;
  cursor: pointer;
}
.nge-cl-help-create-cancel:hover {
  color: #aab;
}

/* Slide transition for create form */
.nge-slide-enter-active { transition: all 0.2s ease-out; }
.nge-slide-leave-active { transition: all 0.15s ease-in; }
.nge-slide-enter-from, .nge-slide-leave-to {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
}
.nge-slide-enter-to, .nge-slide-leave-from {
  max-height: 250px;
}

/* ── Dataset grouping for Help tab ── */
.nge-cl-help-ds-group {
  margin-bottom: 4px;
}
.nge-cl-help-ds-group--cross .nge-cl-help-item {
  opacity: 0.78;
}
.nge-cl-help-ds-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin: 6px 0 4px;
  border-radius: 5px;
  background: rgba(120, 140, 255, 0.04);
  border: 1px solid rgba(120, 140, 255, 0.1);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.nge-cl-help-ds-header:hover {
  background: rgba(120, 140, 255, 0.08);
}
.nge-cl-help-ds-arrow {
  font-size: 0.7em;
  color: #667;
  display: inline-block;
  transition: transform 0.15s;
  width: 8px;
  text-align: center;
}
.nge-cl-help-ds-arrow--collapsed {
  transform: rotate(-90deg);
}
.nge-cl-help-ds-name {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.78em;
  font-weight: 600;
  color: #bcd;
  flex: 1;
}
.nge-cl-help-ds-tag {
  font-size: 0.62em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 8px;
}
.nge-cl-help-ds-tag--current {
  background: rgba(127, 255, 136, 0.1);
  border: 1px solid rgba(127, 255, 136, 0.2);
  color: #7f8;
}
.nge-cl-help-ds-tag--other {
  background: rgba(245, 166, 35, 0.08);
  border: 1px solid rgba(245, 166, 35, 0.18);
  color: rgba(245, 166, 35, 0.85);
}
.nge-cl-help-ds-switch { cursor: pointer; font: inherit; }
.nge-cl-help-ds-switch:hover {
  background: rgba(245, 166, 35, 0.22);
  border-color: rgba(245, 166, 35, 0.5);
  color: #ffd27a;
}
.nge-cl-help-ds-count {
  font-size: 0.7em;
  font-weight: 700;
  color: #889;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  min-width: 20px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 5px;
}
.nge-cl-help-item--cross {
  border-left: 2px solid rgba(245, 166, 35, 0.3);
}

/* ── Cross-dataset jump confirmation modal ── */
.nge-cl-jumpconfirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 8, 16, 0.6);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nge-cl-jumpconfirm {
  background: linear-gradient(180deg, #0f1626 0%, #0a1020 100%);
  border: 1px solid rgba(245, 166, 35, 0.3);
  border-radius: 10px;
  padding: 22px 24px;
  width: 460px;
  max-width: 92vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5),
              0 0 40px rgba(245, 166, 35, 0.08) inset;
  color: #e0e0e0;
}
.nge-cl-jumpconfirm-title {
  font-size: 1.05em;
  font-weight: 700;
  color: #f5a623;
  margin-bottom: 10px;
}
.nge-cl-jumpconfirm-body {
  font-size: 0.88em;
  line-height: 1.5;
  color: #bcc;
  margin-bottom: 12px;
}
.nge-cl-jumpconfirm-body strong {
  color: #fff;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}
.nge-cl-jumpconfirm-warn {
  font-size: 0.82em;
  color: #f5a623;
  background: rgba(245, 166, 35, 0.06);
  border: 1px solid rgba(245, 166, 35, 0.18);
  padding: 8px 10px;
  border-radius: 5px;
  margin-bottom: 12px;
  line-height: 1.4;
}
.nge-cl-jumpconfirm-url-row {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}
.nge-cl-jumpconfirm-url {
  flex: 1;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(120, 140, 255, 0.18);
  border-radius: 4px;
  padding: 6px 8px;
  color: #abc;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.78em;
  outline: none;
}
.nge-cl-jumpconfirm-url:focus {
  border-color: rgba(120, 140, 255, 0.4);
}
.nge-cl-jumpconfirm-copy {
  background: rgba(120, 140, 255, 0.1);
  border: 1px solid rgba(120, 140, 255, 0.25);
  border-radius: 4px;
  color: #abf;
  font-size: 0.85em;
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}
.nge-cl-jumpconfirm-copy:hover {
  background: rgba(120, 140, 255, 0.2);
}
.nge-cl-jumpconfirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.nge-cl-jumpconfirm-cancel,
.nge-cl-jumpconfirm-go {
  padding: 7px 16px;
  border-radius: 5px;
  font-size: 0.92em;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-cl-jumpconfirm-cancel {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #abc;
}
.nge-cl-jumpconfirm-cancel:hover {
  background: rgba(255, 255, 255, 0.05);
}
.nge-cl-jumpconfirm-go {
  background: rgba(245, 166, 35, 0.15);
  border: 1px solid rgba(245, 166, 35, 0.4);
  color: #f5a623;
  font-weight: 600;
}
.nge-cl-jumpconfirm-go:hover {
  background: rgba(245, 166, 35, 0.25);
}

/* ── Save-link row inside cross-dataset modal ── */
.nge-cl-jumpconfirm-save-row {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}
.nge-cl-jumpconfirm-save {
  background: rgba(127, 255, 136, 0.08);
  border: 1px solid rgba(127, 255, 136, 0.25);
  color: #7f8;
  border-radius: 5px;
  padding: 7px 14px;
  font-size: 0.88em;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-cl-jumpconfirm-save:hover:not(:disabled) {
  background: rgba(127, 255, 136, 0.18);
}
.nge-cl-jumpconfirm-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Links tab ── */
.nge-cl-links-tab.active {
  background: rgba(120, 140, 255, 0.14);
  color: #abf;
  border-color: rgba(120, 140, 255, 0.28);
}
.nge-cl-link-ownership {
  display: flex;
  gap: 6px;
  padding: 6px 10px 4px;
}
.nge-cl-link-ownership button {
  background: transparent;
  border: 1px solid rgba(120, 140, 255, 0.18);
  color: #99a;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 0.78em;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-cl-link-ownership button:hover {
  background: rgba(120, 140, 255, 0.08);
}
.nge-cl-link-ownership button.active {
  background: rgba(120, 140, 255, 0.16);
  color: #abf;
  border-color: rgba(120, 140, 255, 0.4);
}
.nge-cl-link-public-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82em;
  color: #99a;
  margin: 6px 0 4px;
  cursor: pointer;
  user-select: none;
}
.nge-cl-link-item--starred {
  background: rgba(245, 209, 66, 0.04);
}
.nge-cl-link-title {
  font-weight: 600;
  color: #cde;
}
.nge-cl-link-rename input {
  font-size: 0.95em;
}

/* ── Slim view: one row, no top bar, no tabs (Ames 2026-10-01) ── */
.nge-cl-caret, .nge-cl-slim-expand, .nge-cl-slim-next {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; flex-shrink: 0;
  border-radius: 999px; cursor: pointer;
  color: #9fdcff; background: rgba(100, 200, 255, 0.12);
  border: 1px solid rgba(100, 200, 255, 0.4);
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.nge-cl-caret:hover, .nge-cl-slim-expand:hover, .nge-cl-slim-next:hover {
  background: rgba(100, 200, 255, 0.22); border-color: rgba(100, 200, 255, 0.75); color: #d4f0ff;
  box-shadow: 0 0 10px rgba(79, 207, 255, 0.35);
}
.nge-cl-topbar .nge-cl-title { margin-right: auto; }
.nge-cl-topbar .nge-cl-gear { margin-left: 0; }
.nge-cl-caret { margin-right: 8px; }
.nge-cl-slim-hint { margin-right: 8px; font-size: 11px; color: #ffd27a; }
.nge-cl-panel--slim { max-height: calc(100vh - 64px); cursor: grab; }
.nge-cl-panel--slim > :not(.nge-cl-list) { display: none !important; }
.nge-cl-panel--slim .nge-cl-list {
  flex: 0 1 auto; overflow-y: auto; position: relative;
  /* The caret keeps its place, top right, as in the full panel (Ames 2026-10-01). */
  padding: 4px 46px 4px 10px;
}
/* The one row needs no "this is the one" marking: no green wash or rail
   pressed against the caret, no "viewing" tag. */
.nge-cl-panel--slim .nge-cl-row,
.nge-cl-panel--slim .nge-cl-row:hover { background: none; box-shadow: none; padding-left: 4px; }
.nge-cl-panel--slim .nge-cl-viewing { display: none; }
/* Complete, in the slim view: part of the panel, not a box inside a box. */
.nge-cl-panel--slim .nge-cl-list > .nge-cl-complete {
  margin: 4px -46px -4px -10px; padding: 12px 16px 16px;
  border: none; border-top: 1px solid rgba(74, 150, 224, 0.25); border-radius: 0;
  background: rgba(10, 24, 44, 0.55);
}
.nge-cl-caret--on {
  background: rgba(79, 207, 255, 0.26); border-color: #4fcfff; color: #e6f7ff;
  box-shadow: 0 0 10px rgba(79, 207, 255, 0.4);
}
/* Tags and AI tabs: the hint, filter rows and Resolved toggle sat flush
   against the panel edge (Ames 2026-10-01). */
.nge-cl-list > .nge-cl-tags-hint,
.nge-cl-list > .nge-cl-tags-lanes,
.nge-cl-list > .nge-cl-help-resolved-toggle { margin-left: 14px; margin-right: 14px; }
.nge-cl-list > .nge-cl-quest { margin-left: 10px; margin-right: 10px; }
/* Banners (errors, the claim limit) and the Complete form still show: the
   slim panel grows to fit them. */
.nge-cl-panel--slim .nge-cl-list > :not(.nge-cl-row):not(.nge-cl-slim-expand):not(.nge-cl-slim-next) { margin-left: -10px; margin-right: -46px; cursor: default; }
.nge-cl-panel--slim .nge-cl-row { border-bottom: none; }
.nge-cl-slim-expand { position: absolute; right: 12px; top: 18px; }
/* Next claimed cell: green, beside the Full view arrow at the right, and
   the row makes room for both (Ames 2026-10-04). */
.nge-cl-slim-next {
  position: absolute; right: 42px; top: 18px;
  color: #7ee2a8; background: rgba(61, 220, 132, 0.14); border-color: rgba(61, 220, 132, 0.5);
}
.nge-cl-slim-next:hover {
  color: #d6ffe6; background: rgba(61, 220, 132, 0.26); border-color: rgba(61, 220, 132, 0.85);
  box-shadow: 0 0 10px rgba(61, 220, 132, 0.4);
}
.nge-cl-slim-next:disabled { opacity: 0.45; cursor: default; }
.nge-cl-panel--slim .nge-cl-list:has(> .nge-cl-slim-next) { padding-right: 76px; }
.nge-cl-panel--slim .nge-cl-list:has(> .nge-cl-slim-next) > :not(.nge-cl-row):not(.nge-cl-slim-expand):not(.nge-cl-slim-next) { margin-right: -76px; }
.nge-cl-panel--slim .nge-cl-list:has(> .nge-cl-slim-next) > .nge-cl-complete { margin-right: -76px; }
</style>
