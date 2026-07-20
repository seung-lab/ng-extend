<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  useProofreadingBackendStore,
  useProofreadingQueueStore,
  useLoginStore,
  useCellHistoryStore,
  useHelpRequestStore,
  useUserStatsStore,
  useWorkingLinksStore,
  type ProofreadingTask,
  type HelpRequest,
  type WorkingLink,
  type ClaimPoint,
} from '../store';
import { EYEWIRE_II_CAVE_CONFIG, getDatasetCaveConfig } from '../config';
import { setCellComplete } from '../widgets/lightbulb_service';
import { getAccessToken } from '../widgets/google_sheets_auth';
import { findDatasetBySegName, switchToDataset, canonicalDataset, segLayerName, DATASETS, type DatasetEntry } from '../datasets';
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
// NOTE: ScreenshotDialog import removed with the disabled attach feature.
// The component itself is untouched and still used by ExtensionBar for the
// working "Share → Screenshot" download.

const props = defineProps<{ initialTab?: string }>();
const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();
const queue = useProofreadingQueueStore();
const login = useLoginStore();
const history = useCellHistoryStore();
const helpStore = useHelpRequestStore();
const linksStore = useWorkingLinksStore();

const loading = ref(false);
const filter = ref<'mine' | 'all' | 'available' | 'completed' | 'claimed' | 'help' | 'links'>(
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
async function loadCellsForActiveDataset() {
  const dsName = getCurrentDatasetName();
  activeDataset.value = dsName;
  const cfg = getDatasetCaveConfig(dsName);
  const sheetUrl = cfg.cellLibrarySheetUrl || EYEWIRE_II_CAVE_CONFIG.cellLibrarySheetUrl;
  if (!sheetUrl) return;
  if (queue.sheetUrl !== sheetUrl || queue.items.length === 0) {
    await queue.loadFromSheet(sheetUrl, canonicalDataset(dsName));
  }
}

onMounted(async () => {
  loading.value = true;
  // Load tasks from Supabase — these have claim/completion status
  await backend.loadTasks('eyewire_ii');
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
      (c.notes || '').toLowerCase().includes(q) ||
      (history.getNickname(c.segId) || '').toLowerCase().includes(q),
    );
  }
  return list;
});

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
      .select('display_name, middleauth_email')
      .eq('id', userId)
      .single();
    const name = data?.display_name || data?.middleauth_email?.split('@')[0] || userId.slice(0, 8);
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

// ── Actions ──────────────────────────────────────────────────────────
function jumpToCell(segId: string, coords: string) {
  const pos = parseCoords(coords);
  history.jumpToCell(segId, pos[0] || pos[1] || pos[2] ? pos : undefined);
  jumpedSegId.value = segId;
}

function parseCoords(s: string): [number, number, number] {
  if (!s) return [0, 0, 0];
  const parts = s.split(',').map(p => parseInt(p.trim(), 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

async function claimCell(cell: typeof cells.value[0]) {
  if (!isLoggedIn.value) return;
  claimError.value = '';
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
  const result = await backend.claimCell(point);
  if (!result.ok) {
    claimError.value = result.reason || 'Claim failed';
    if (claimErrorTimer) clearTimeout(claimErrorTimer);
    claimErrorTimer = setTimeout(() => { claimError.value = ''; }, 5000);
    return;
  }
  // Write claim to Google Sheet (best-effort)
  writeClaimToSheet(cell.segId, backend.userName);
  await backend.loadTasks('eyewire_ii');
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

async function completeCell(cell: typeof cells.value[0]) {
  if (!isLoggedIn.value || !cell.taskId) return;
  await backend.completeTask(cell.taskId, cell.finalSegId || undefined, cell.somaCoords || undefined);
  // Write completion to Google Sheet (best-effort)
  writeCompletionToSheet(cell.segId, backend.userName, cell.finalSegId || '', cell.somaCoords || '');

  // Record the completion in CAVE (cell_status annotation) so it materializes
  // to the leaderboard — same path ProofreadingQueuePanel uses. The root is the
  // proofread final segment (fall back to the original). setCellComplete logs
  // the 'mark_complete' edit + activity internally on success, so we only log
  // here as a fallback — that keeps cells_completed incrementing exactly once.
  let loggedViaCave = false;
  try {
    const caveServer = EYEWIRE_II_CAVE_CONFIG.caveServerOverride || '';
    const rootId = cell.finalSegId || cell.segId;
    if (caveServer && rootId) {
      const nums = (cell.somaCoords || '').split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
      const pt = nums.length === 3 ? (nums as [number, number, number]) : undefined;
      // suppressCelebration: completeCell runs its own triggerCellCelebration()
      loggedViaCave = await setCellComplete(caveServer, rootId, true, undefined, pt, true);
    }
  } catch (e) {
    console.warn('[cellLibrary] CAVE completion write failed (non-blocking):', e);
  }
  if (!loggedViaCave) {
    // Log as mark_complete for stats (CAVE write didn't record it)
    await backend.logEdit({ operation: 'mark_complete', task_id: cell.taskId });
  }
  // Notify UI that status changed (claim is already cleared by completeTask)
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'completed' } }));
  await backend.loadTasks('eyewire_ii');
  // Celebration!
  triggerCellCelebration();
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

async function triggerCellCelebration() {
  await backend.loadUserStats(); // refresh from DB for accurate count
  const statsStore = useUserStatsStore();
  const total = statsStore.stats.cellsSubmitted;
  const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
  backend.pendingCellCelebration = {
    totalCells: total,
    imageUrl: nurro,
  };
}

async function releaseCell(cell: typeof cells.value[0]) {
  if (!cell.segId) return;
  // Prefer point-based release, fall back to segment-based
  if (cell.claimPoint) {
    await backend.releaseCell(cell.claimPoint);
  } else {
    await backend.releaseBySegment(cell.segId);
  }
  // Dispatch event so seg dot pips update
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'released' } }));
  await backend.loadTasks('eyewire_ii');
}

// ── Google Sheet write-back ──────────────────────────────────────────
async function writeClaimToSheet(segId: string, userName: string) {
  try {
    // Stroeh sheet tracks the worker in 'Proofreader'; other sheets may use 'claimedby'.
    await writeToSheetColumn(segId, ['proofreader', 'claimedby'], userName);
  } catch (e) {
    console.warn('[cellLibrary] Sheet claim write-back failed:', e);
  }
}

async function writeCompletionToSheet(segId: string, userName: string, finalSegId: string, somaCoords: string) {
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await writeToSheetColumn(segId, ['proofreader', 'completedby'], userName);
    await writeToSheetColumn(segId, ['status'], 'Complete');
    if (finalSegId) await writeToSheetColumn(segId, ['finalseg'], finalSegId);
    // Corrected coords go to a dedicated column on the Stroeh sheet; the pinky
    // sheet just has 'SOMA COORDS'.
    if (somaCoords) await writeToSheetColumn(segId, ['correctedsoma', 'somacoord'], somaCoords);
    await writeToSheetColumn(segId, ['datecomplete', 'completedtime'], timestamp);
  } catch (e) {
    console.warn('[cellLibrary] Sheet completion write-back failed:', e);
  }
}

/** CSV → grid, honoring quoted fields that contain commas/newlines. A naive
 *  split(',') would misalign columns on sheets whose coord cells look like
 *  "48469, 47551, 2014" — and misalignment means writing to the wrong cell. */
function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') { field += ch; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Generic write-back: find a column by name pattern(s) and write a value for
 *  the row matching segId. Accepts a list of patterns and writes to the first
 *  column that exists, so it works across the different per-dataset sheet
 *  layouts. */
async function writeToSheetColumn(segId: string, columnPatterns: string | string[], value: string) {
  const source = queue.sheetUrl;
  if (!source) return;

  const idMatch = source.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return;
  const spreadsheetId = idMatch[1];
  const gidMatch = source.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(csvUrl);
  if (!res.ok) return;
  const text = await res.text();
  const rows = parseCsvGrid(text);
  if (rows.length < 2) return;

  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
  const segPatterns = ['startseg', 'segmentid', 'segment', 'segid'];

  // Header row = first of the first 10 rows that has a segment-id-like column.
  let headerIdx = -1, header: string[] = [], segColIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(norm);
    const sc = h.findIndex(c => segPatterns.some(p => c.includes(p)));
    if (sc >= 0) { headerIdx = i; header = h; segColIdx = sc; break; }
  }
  if (segColIdx < 0) { console.warn('[cellLibrary] No segment column found in sheet'); return; }

  const patterns = Array.isArray(columnPatterns) ? columnPatterns : [columnPatterns];
  let colIdx = -1;
  for (const p of patterns) { colIdx = header.findIndex(h => h.includes(p)); if (colIdx >= 0) break; }
  if (colIdx < 0) {
    console.warn(`[cellLibrary] No "${patterns.join('/')}" column found in sheet`);
    return;
  }

  // Find the row with this segId (exact match on the segment column).
  let rowIdx = -1;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    if ((rows[r][segColIdx] || '').trim() === segId) { rowIdx = r; break; }
  }
  if (rowIdx < 0) { console.warn(`[cellLibrary] segId ${segId} not found in sheet — skipping write`); return; }

  // SAFETY: only fill empty cells. Never overwrite existing data in the sheet.
  const existingVal = (rows[rowIdx][colIdx] || '').trim();
  if (existingVal) {
    console.info(`[cellLibrary] segId ${segId}: "${patterns[0]}" cell already has "${existingVal}" — not overwriting`);
    return;
  }

  // Convert to A1 notation
  const colLetter = (idx: number) => {
    let s = '';
    let n = idx;
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  };
  const cellRef = `${colLetter(colIdx)}${rowIdx + 1}`;

  // Resolve sheet name from gid — use service account auth
  const accessToken = await getAccessToken();
  const authHeaders = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers: authHeaders });
  let sheetName = 'Sheet1';
  if (metaRes.ok) {
    const meta = await metaRes.json();
    const sheet = meta.sheets?.find((s: any) => String(s.properties.sheetId) === gid);
    if (sheet) sheetName = sheet.properties.title;
  }

  const range = `${sheetName}!${cellRef}`;
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: [[value]],
      }),
    },
  );

  if (writeRes.ok) {
    console.info(`[cellLibrary] Wrote "${value}" to sheet cell ${range}`);
  } else {
    const body = await writeRes.text().catch(() => '');
    console.warn(`[cellLibrary] Sheet write failed (${writeRes.status}): ${body.slice(0, 200)}`);
    // Note: Sheets API v4 requires an API key or OAuth token even for publicly-editable sheets.
    // The CSV export endpoint works without auth, but the values PUT endpoint does not.
  }
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
  activeHelpId.value = req.id;
  history.jumpToCell(req.segId, req.position);
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
    title: `${ds || 'View'} — ${new Date().toLocaleString()}`,
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
const newHelpIssue = ref('Unsure');
const newHelpNote = ref('');
const newHelpScreenshotUrl = ref('');
const newHelpError = ref('');
const HELP_ISSUE_TYPES = ['Unsure', 'Merge error', 'Split error', 'Missing branch', 'Other'];

// Pre-fill the segment ID from the current viewer selection when the Help tab
// opens, so the common case is one click. The user can still edit/paste any ID.
watch(() => filter.value, (f) => {
  if (f === 'help' && !newHelpSegId.value.trim()) newHelpSegId.value = getActiveSegId();
}, { immediate: true });

// TODO(screenshot): attach handlers removed with the button — see the note in
// the Help quick-add template. `newHelpScreenshotUrl` is kept (always empty)
// so the submit payload shape and the rendering of screenshots on EXISTING
// help requests are both unchanged.

function getActiveSegId(): string {
  try {
    const viewer = (window as any)['viewer'];
    const seg = viewer?.selectedLayer?.layer_?.layer_;
    if (seg?.type === 'segmentation' || seg?.type === 'segmentation_with_graph') {
      const sel = seg.displayState?.segmentSelectionState?.selectedSegment;
      if (sel) return sel.toString();
    }
  } catch {}
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
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const typeName = ml.layer?.constructor?.name ?? '';
      if (typeName.includes('Segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

async function submitNewHelp() {
  // Prefer a typed/pasted ID; fall back to the current viewer selection.
  const segId = (newHelpSegId.value.trim() || getActiveSegId()).trim();
  if (!/^\d{6,}$/.test(segId)) {
    newHelpError.value = 'Enter a valid segment ID (or select a segment in the viewer).';
    return;
  }
  newHelpError.value = '';
  // Only attach the viewer position when the request is for the selected
  // segment — a hand-typed ID isn't at the current crosshair.
  const isSelected = segId === getActiveSegId();
  await helpStore.add({
    segId,
    position: isSelected ? getViewerPosition() : [],
    note: newHelpNote.value.trim(),
    issueType: newHelpIssue.value,
    dataset: getCurrentDatasetName(),
    cellType: '',
    nickname: '',
    screenshotUrl: newHelpScreenshotUrl.value || undefined,
  });
  helpStore.refreshPending();
  newHelpSegId.value = '';
  newHelpNote.value = '';
  newHelpIssue.value = 'Unsure';
  newHelpScreenshotUrl.value = '';
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

function toggleResponseForm(reqId: string) {
  if (respondingTo.value === reqId) {
    respondingTo.value = null;
  } else {
    respondingTo.value = reqId;
    responseNote.value = '';
    responseUrl.value = '';
    responseAnnotationLayer.value = '';
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
  if (!responseNote.value.trim()) return;
  const payload = {
    note: responseNote.value.trim(),
    url: responseUrl.value.trim() || undefined,
    annotationLayer: responseAnnotationLayer.value.trim() || undefined,
    appendToExisting: !!req.responseNote,  // signal to append, not replace
  };
  if (andResolve) {
    await helpStore.resolve(req.id, payload);
  } else {
    await helpStore.respond(req.id, payload);
  }
  respondingTo.value = null;
  helpStore.refreshPending();
}

/** Format a threaded response note into HTML with line breaks */
function formatResponseThread(note: string): string {
  return note
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n---\n/g, '<hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:6px 0">')
    .replace(/\n/g, '<br>');
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

function jumpToReq(req: HelpRequest) {
  if (isCrossDatasetReq(req)) {
    // Different dataset — show a confirmation modal so the user can save
    // their current state URL before the viewer reloads with new layers.
    jumpConfirmReq.value = req;
    jumpConfirmTargetDs.value = findDatasetBySegName(req.dataset!) ?? null;
    jumpConfirmCopied.value = false;
    return;
  }
  activeHelpId.value = req.id;
  history.jumpToCell(req.segId, req.position);
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
      const className = layer.constructor?.name || '';
      if (!className.includes('Segmentation')) continue;
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
    title: newLinkTitle.value.trim() || `${getCurrentDatasetName() || 'View'} — ${new Date().toLocaleString()}`,
    note: newLinkNote.value.trim(),
    url,
    dataset: getCurrentDatasetName(),
    position: pos.length === 3 ? [pos[0], pos[1], pos[2]] : undefined,
    visibleSegments: getVisibleSegmentIds(),
    isPublic: newLinkPublic.value,
  });
  if (id) {
    showSaveLinkForm.value = false;
    newLinkTitle.value = '';
    newLinkNote.value = '';
    newLinkPublic.value = false;
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

function openLink(link: WorkingLink) {
  // Same dataset → cross-dataset behavior matches help-request flow.
  const targetDs = link.dataset && findDatasetBySegName(link.dataset);
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
    pendingLinkOpen.value = link;
    return;
  }
  // Same dataset: open URL directly (replaces current state)
  window.location.href = link.url;
}

const pendingLinkOpen = ref<WorkingLink | null>(null);

async function shareLinkToChat(link: WorkingLink) {
  // Post the title + URL into the global chat broadcast.
  try {
    const chat = (await import('../store')).useChatStore();
    chat.sendMessage(`📎 ${link.title}\n${link.url}`);
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
const panelPos = ref({ x: window.innerWidth / 2 - 220, y: 80 });

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

// ── Resize ───────────────────────────────────────────────────────────
const MIN_PANEL_W = 340;
const MIN_PANEL_H = 260;
const panelWidth = ref(480);
// null = let content drive the height (capped by CSS max-height) until the
// user drags the corner, at which point we take over with an explicit height.
const resizedHeight = ref<number | null>(null);

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
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

const panelStyle = computed(() => ({
  left: panelPos.value.x + 'px',
  top: panelPos.value.y + 'px',
  width: panelWidth.value + 'px',
  ...(resizedHeight.value != null
    ? { height: resizedHeight.value + 'px', maxHeight: 'none' }
    : {}),
}));
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-cl" appear>
      <div class="nge-cl-panel" :style="panelStyle">

        <!-- Top bar -->
        <div class="nge-cl-topbar" @mousedown="startDrag" :class="{ 'nge-cl-dragging': isDragging }">
          <div class="nge-cl-title">
            <img :src="neuronIcon" class="nge-cl-icon" /> Cell Library
          </div>
          <button class="nge-cl-close" @click="emit('hide')">×</button>
        </div>

        <!-- Filter tabs -->
        <div class="nge-cl-filters">
          <button :class="{ active: filter === 'mine' }" @click="filter = 'mine'">
            My Cells ({{ myClaimCount }})
          </button>
          <button :class="{ active: filter === 'available' }" @click="filter = 'available'">
            Available ({{ availableCount }})
          </button>
          <button :class="{ active: filter === 'claimed', 'nge-cl-claimed-tab': true }" @click="filter = 'claimed'">
            Claimed ({{ claimedCount }})
          </button>
          <button :class="{ active: filter === 'all' }" @click="filter = 'all'">
            All ({{ datasetScopedCells.length }})
          </button>
          <button :class="{ active: filter === 'completed' }" @click="filter = 'completed'">
            Completed ({{ completedCount }})
          </button>
          <button :class="{ active: filter === 'help', 'nge-cl-help-tab': true }" @click="filter = 'help'">
            Help ({{ pendingHelp.length }})
          </button>
          <button :class="{ active: filter === 'links', 'nge-cl-links-tab': true }" @click="filter = 'links'">
            My Saved Links ({{ linksStore.links.length }})
          </button>
        </div>

        <!-- Search (not shown on Help / Links tabs) -->
        <div v-if="filter !== 'help' && filter !== 'links'" class="nge-cl-search">
          <input
            v-model="search"
            placeholder="Search by ID, name, or notes..."
            class="nge-cl-search-input"
            @keydown.stop @keyup.stop @keypress.stop
          />
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

          <!-- Always-visible quick-add: submit a new help request from the top -->
          <div class="nge-cl-help-quickadd">
            <div class="nge-cl-help-quickadd-title">Submit a help request</div>
            <div class="nge-cl-help-quickadd-row">
              <input
                v-model="newHelpSegId"
                class="nge-cl-help-segid-input"
                placeholder="Segment ID"
                inputmode="numeric"
                @keydown.stop @keyup.stop @keypress.stop
                @input="newHelpError = ''"
              />
              <button
                class="nge-cl-help-segid-use"
                @click="newHelpSegId = getActiveSegId(); newHelpError = ''"
                title="Use the segment currently selected in the viewer"
              >Use selected</button>
              <select
                v-model="newHelpIssue"
                class="nge-cl-help-issue-select"
                @keydown.stop
                title="Issue type"
              >
                <option v-for="t in HELP_ISSUE_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
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
              <!-- TODO(screenshot): the "attach a screenshot" button was removed
                   because uploads fail server-side — the signScreenshotUpload
                   Cloud Function can't mint a signed URL (its runtime service
                   account lacks roles/iam.serviceAccountTokenCreator, so the
                   IAM signBlob call is denied and every request 500s). Restore
                   this button once that grant is in place; the upload code in
                   ScreenshotDialog (mode="attach") is unchanged and still works.
                   Existing screenshots on old requests still render below. -->
              <button class="nge-cl-help-quickadd-submit" @click="submitNewHelp" title="Submit help request">Submit</button>
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
            <!-- Dataset section header (only when there's more than one group) -->
            <div
              v-if="hasMultipleHelpDatasets"
              class="nge-cl-help-ds-header"
              @click="toggleDatasetGroup(group.dataset)"
            >
              <span
                class="nge-cl-help-ds-arrow"
                :class="{ 'nge-cl-help-ds-arrow--collapsed': !group.isCurrent && collapsedDatasets.has(group.dataset) }"
              >▾</span>
              <span class="nge-cl-help-ds-name">{{ group.label }}</span>
              <span v-if="group.isCurrent" class="nge-cl-help-ds-tag nge-cl-help-ds-tag--current">current</span>
              <span v-else class="nge-cl-help-ds-tag nge-cl-help-ds-tag--other">other dataset</span>
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
                        <span class="nge-cl-badge nge-cl-status--help">{{ req.issueType }}</span>
                        <span v-if="req.userName" class="nge-cl-notes">by {{ req.userName }}</span>
                        <span class="nge-cl-notes">{{ relativeTime(req.createdAt) }}</span>
                      </div>
                      <div v-if="req.note" class="nge-cl-help-note" :class="{ 'nge-cl-help-note--expanded': expandedNotes.has(req.id) }" @click="toggleNoteExpand(req.id)">{{ req.note }}</div>
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
                    <button class="nge-cl-btn nge-cl-btn--respond" @click="toggleResponseForm(req.id)" :title="respondingTo === req.id ? 'Cancel' : 'Respond'">
                      {{ respondingTo === req.id ? '▾' : '💬' }}
                    </button>
                    <button class="nge-cl-btn nge-cl-btn--complete" @click="resolveReq(req)">Resolve</button>
                  </div>
                </div>

            <!-- Show existing response thread -->
            <div v-if="req.responseNote" class="nge-cl-response-display">
              <div class="nge-cl-response-label">💬 {{ req.resolvedByName || 'Response' }}:</div>
              <div class="nge-cl-response-text" v-html="formatResponseThread(req.responseNote)"></div>
              <a v-if="req.responseUrl" class="nge-cl-response-link" @click.prevent="openResponseUrl(req.responseUrl)" href="#">↗ View linked state</a>
              <span v-if="req.responseAnnotationLayer" class="nge-cl-response-layer">📐 Layer: {{ req.responseAnnotationLayer }}</span>
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
              <button
                class="nge-cl-btn nge-cl-btn--submit-response"
                :disabled="!responseNote.trim()"
                @click="submitResponse(req)"
              >Submit Response</button>
              <button
                class="nge-cl-btn nge-cl-btn--submit-response nge-cl-btn--resolve"
                :disabled="!responseNote.trim()"
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
              <!-- Response display -->
              <div v-if="req.responseNote" class="nge-cl-response-display">
                <div class="nge-cl-response-label">Response from {{ req.resolvedByName || 'resolver' }}:</div>
                <div class="nge-cl-response-text">{{ req.responseNote }}</div>
                <a v-if="req.responseUrl" class="nge-cl-response-link" @click.prevent="openResponseUrl(req.responseUrl)" href="#">↗ View linked state</a>
                <span v-if="req.responseAnnotationLayer" class="nge-cl-response-layer">📐 Layer: {{ req.responseAnnotationLayer }}</span>
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
              <div class="nge-cl-help-create-actions">
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
        <div v-else-if="loading || backend.loading" class="nge-cl-loading">Loading cells...</div>

        <!-- Empty state -->
        <div v-else-if="cells.length === 0" class="nge-cl-empty">
          <p>No cells loaded yet.</p>
          <p v-if="!queue.sheetUrl" class="nge-cl-hint">Open Brain Quest first and load a quest sheet.</p>
        </div>

        <!-- Cell list -->
        <div v-else class="nge-cl-list">
          <!-- Claim error banner -->
          <div v-if="claimError" class="nge-cl-error-banner" @click="claimError = ''">
            {{ claimError }}
            <span class="nge-cl-error-dismiss">×</span>
          </div>
          <div v-if="filteredCells.length === 0 && filter === 'mine'" class="nge-cl-no-results">
            No claimed cells yet. Claim cells from the All or Available tabs!
          </div>
          <div v-else-if="filteredCells.length === 0 && filter === 'available' && !search.trim()" class="nge-cl-no-results">
            No available cells in <strong>{{ currentDatasetLabel }}</strong>.
            <template v-if="suggestedClaimDataset">
              <br />Switch to <strong>{{ suggestedClaimDataset }}</strong> to claim a cell.
            </template>
          </div>
          <div v-else-if="filteredCells.length === 0" class="nge-cl-no-results">No matching cells</div>

          <div
            v-for="cell in filteredCells"
            :key="cell.segId"
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
                  {{ history.getNickname(cell.segId) || cell.segId }}
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
                @click="jumpToCell(cell.segId, cell.nucCoords || cell.somaCoords)"
                :title="cell.segId === jumpedSegId ? 'Currently viewing — jump again' : 'Jump to segment'"
              >↗</button>

              <button
                v-if="cell.status === 'pending' && isLoggedIn"
                class="nge-cl-btn nge-cl-btn--claim"
                @click="claimCell(cell)"
              >Claim</button>

              <button
                v-if="isMyClaim(cell)"
                class="nge-cl-btn nge-cl-btn--release"
                @click="releaseCell(cell)"
                title="Release claim"
              >Release</button>

              <button
                v-if="isMyClaim(cell)"
                class="nge-cl-btn nge-cl-btn--complete"
                @click="completeCell(cell)"
              >Complete</button>
            </div>
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

  <!-- TODO(screenshot): the attach dialog is disabled — see the note by the
       Help quick-add Submit button. Re-mount this once the Cloud Function's
       service account can sign upload URLs. -->
</template>

<style scoped>
.nge-cl-panel {
  position: fixed;
  z-index: 10010;
  width: 480px;
  max-height: 70vh;
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
.nge-cl-title {
  font-size: 0.9em;
  font-weight: 700;
  letter-spacing: 0.03em;
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
.nge-cl-search { padding: 6px 10px; }
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

.nge-cl-btn--release {
  border-color: rgba(255, 170, 68, 0.2);
  color: #a86;
  font-size: 0.68em;
}
.nge-cl-btn--release:hover { background: rgba(255, 170, 68, 0.08); }

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
.nge-cl-help-quickadd {
  background: rgba(255, 136, 170, 0.05);
  border: 1px solid rgba(255, 136, 170, 0.16);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 10px;
}
.nge-cl-help-quickadd-title {
  font-size: 0.8em;
  font-weight: 700;
  color: #f8b3c6;
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}
.nge-cl-help-quickadd-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.nge-cl-help-quickadd-row:last-of-type { margin-bottom: 0; }
.nge-cl-help-issue-select {
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #ccd;
  font-size: 0.76em;
  font-family: inherit;
  padding: 5px 6px;
  cursor: pointer;
}
.nge-cl-help-issue-select:focus { outline: none; border-color: rgba(255, 136, 170, 0.4); }
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
  background: rgba(230, 120, 160, 0.85);
  border: 1px solid rgba(255, 150, 185, 0.7);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
}
.nge-cl-help-quickadd-submit:hover { background: rgba(240, 135, 175, 1); }
.nge-cl-help-shot-preview--sm { margin-top: 6px; }
.nge-cl-help-shot-preview--sm img { max-height: 48px; border-radius: 4px; }

/* ── Help Request Create Form ── */
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
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px dashed rgba(255, 136, 170, 0.35);
  background: rgba(255, 136, 170, 0.06);
  color: #f8a;
  font-size: 0.78em;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.nge-cl-help-shot-btn:hover {
  background: rgba(255, 136, 170, 0.14);
  border-color: rgba(255, 136, 170, 0.6);
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
</style>
