<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  useProofreadingBackendStore,
  useProofreadingQueueStore,
  useLoginStore,
  useCellHistoryStore,
  useHelpRequestStore,
  type ProofreadingTask,
  type HelpRequest,
} from '../store';
import { isLatestRoots, getLatestRoots } from '../widgets/pcg_service';
import { EYEWIRE_II_CAVE_CONFIG } from '../config';
import { getAccessToken } from '../widgets/google_sheets_auth';
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';

const props = defineProps<{ initialTab?: string }>();
const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();
const queue = useProofreadingQueueStore();
const login = useLoginStore();
const history = useCellHistoryStore();
const helpStore = useHelpRequestStore();

const loading = ref(false);
const filter = ref<'mine' | 'all' | 'available' | 'completed' | 'claimed' | 'help'>(
  (props.initialTab as any) || 'mine',
);
const search = ref('');
const claimError = ref('');
let claimErrorTimer: ReturnType<typeof setTimeout> | null = null;

// ── Lineage resolution (stale root ID detection) ────────────────────
const latestRootMap = ref<Map<string, string>>(new Map());
const staleSet = ref<Set<string>>(new Set());
const resolving = ref(false);

async function resolveStaleRoots() {
  // Collect segment IDs from claimed/in-progress cells
  const claimedIds = cells.value
    .filter(c => c.status === 'assigned' || c.status === 'in_progress')
    .map(c => c.segId);
  if (claimedIds.length === 0) return;

  resolving.value = true;
  try {
    // Step 1: lightweight check — which IDs are stale?
    const latest = await isLatestRoots(claimedIds);
    if (!latest) { resolving.value = false; return; }

    const staleIds = claimedIds.filter(id => latest.get(id) === false);
    if (staleIds.length === 0) { resolving.value = false; return; }

    // Step 2: resolve stale IDs to current root IDs
    const resolved = await getLatestRoots(staleIds);
    if (resolved) {
      latestRootMap.value = resolved;
      staleSet.value = new Set(staleIds);
    }
  } catch (e) {
    console.warn('[cellLibrary] lineage resolution failed:', e);
  }
  resolving.value = false;
}

const copiedId = ref<string | null>(null);
function copyId(id: string) {
  navigator.clipboard.writeText(id).then(() => {
    copiedId.value = id;
    setTimeout(() => { copiedId.value = null; }, 1200);
  });
}

// ── Data loading ─────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true;
  // Load tasks from Supabase — these have claim/completion status
  await backend.loadTasks('eyewire_ii');
  // Also ensure queue items are loaded (from Google Sheet)
  // Use configured default sheet URL if none saved in localStorage
  const sheetSource = queue.sheetUrl || EYEWIRE_II_CAVE_CONFIG.cellLibrarySheetUrl;
  if (sheetSource && queue.items.length === 0) {
    await queue.loadFromSheet(sheetSource);
  }
  loading.value = false;
  // Fire-and-forget: resolve stale root IDs for claimed cells
  resolveStaleRoots();
  // Refresh help requests from Supabase
  helpStore.load();
});

// ── Derived data ─────────────────────────────────────────────────────
const isLoggedIn = computed(() => !!backend.userId);

/** Merge queue items (from sheet) with backend tasks (from Supabase).
 *  Supabase tasks are the source of truth for status/assignment. */
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
        segId: item.segId,
        index: item.index || String(idx + 1),
        nucCoords: item.nucCoords,
        somaCoords: task?.soma_coords || item.somaCoords || '',
        notes: item.notes,
        // Supabase status
        taskId: task?.id ?? null,
        status: task?.status ?? 'pending',
        assignedTo: task?.assigned_to ?? null,
        finalSegId: task?.final_segment_id ?? null,
        completedByName: null as string | null, // filled async
        // Lineage resolution
        currentSegId: latestRootMap.value.get(item.segId) || null,
        isStale: staleSet.value.has(item.segId),
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
        taskId: t.id,
        status: t.status,
        assignedTo: t.assigned_to,
        finalSegId: t.final_segment_id,
        completedByName: null as string | null,
        currentSegId: latestRootMap.value.get(t.segment_id) || null,
        isStale: staleSet.value.has(t.segment_id),
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
    taskId: t.id,
    status: t.status,
    assignedTo: t.assigned_to,
    finalSegId: t.final_segment_id,
    completedByName: null as string | null,
    currentSegId: latestRootMap.value.get(t.segment_id) || null,
    isStale: staleSet.value.has(t.segment_id),
  }));
});

const filteredCells = computed(() => {
  let list = cells.value;
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

const myClaimCount = computed(() => cells.value.filter(c => isMyClaim(c)).length);

const availableCount = computed(() => cells.value.filter(c => c.status === 'pending').length);
const completedCount = computed(() => cells.value.filter(c => c.status === 'completed').length);
const claimedCount = computed(() => cells.value.filter(c => c.status === 'assigned' || c.status === 'in_progress').length);

// ── User name lookup (for claimed tab) ───────────────────────────────
const userNameCache = ref<Map<string, string>>(new Map());
async function resolveUserName(userId: string): Promise<string> {
  if (userNameCache.value.has(userId)) return userNameCache.value.get(userId)!;
  try {
    const { data } = await (await import('../supabase')).default
      .from('users')
      .select('display_name, email')
      .eq('id', userId)
      .single();
    const name = data?.display_name || data?.email?.split('@')[0] || userId.slice(0, 8);
    userNameCache.value.set(userId, name);
    return name;
  } catch {
    const fallback = userId.slice(0, 8);
    userNameCache.value.set(userId, fallback);
    return fallback;
  }
}
function getCachedUserName(userId: string): string {
  if (!userId) return '?';
  if (userId === backend.userId) return 'You';
  if (!userNameCache.value.has(userId)) {
    resolveUserName(userId); // fire-and-forget
    return userId.slice(0, 8) + '…';
  }
  return userNameCache.value.get(userId)!;
}

// ── Actions ──────────────────────────────────────────────────────────
function jumpToCell(segId: string, coords: string) {
  const pos = parseCoords(coords);
  history.jumpToCell(segId, pos[0] || pos[1] || pos[2] ? pos : undefined);
}

function parseCoords(s: string): [number, number, number] {
  if (!s) return [0, 0, 0];
  const parts = s.split(',').map(p => parseInt(p.trim(), 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

async function claimCell(cell: typeof cells.value[0]) {
  if (!isLoggedIn.value) return;
  claimError.value = '';
  const result = await backend.claimBySegment(cell.segId);
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

async function completeCell(cell: typeof cells.value[0]) {
  if (!isLoggedIn.value || !cell.taskId) return;
  await backend.completeTask(cell.taskId, cell.finalSegId || undefined, cell.somaCoords || undefined);
  // Write completion to Google Sheet (best-effort)
  writeCompletionToSheet(cell.segId, backend.userName, cell.finalSegId || '', cell.somaCoords || '');
  // Log as mark_complete for stats
  await backend.logEdit({ operation: 'mark_complete', task_id: cell.taskId });
  // Notify UI that status changed (claim is already cleared by completeTask)
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'completed' } }));
  await backend.loadTasks('eyewire_ii');
}

async function releaseCell(cell: typeof cells.value[0]) {
  if (!cell.segId) return;
  await backend.releaseBySegment(cell.segId);
  // Dispatch event so seg dot pips update
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'released' } }));
  await backend.loadTasks('eyewire_ii');
}

// ── Google Sheet write-back ──────────────────────────────────────────
async function writeClaimToSheet(segId: string, userName: string) {
  try {
    await writeToSheetColumn(segId, 'claimedby', userName);
  } catch (e) {
    console.warn('[cellLibrary] Sheet claim write-back failed:', e);
  }
}

async function writeCompletionToSheet(segId: string, userName: string, finalSegId: string, somaCoords: string) {
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await writeToSheetColumn(segId, 'completedby', userName);
    if (finalSegId) await writeToSheetColumn(segId, 'finalseg', finalSegId);
    if (somaCoords) await writeToSheetColumn(segId, 'somacoord', somaCoords);
    await writeToSheetColumn(segId, 'completedtime', timestamp);
  } catch (e) {
    console.warn('[cellLibrary] Sheet completion write-back failed:', e);
  }
}

/** Generic write-back: find a column by name pattern and write a value for the row matching segId. */
async function writeToSheetColumn(segId: string, columnPattern: string, value: string) {
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
  const rows = text.split('\n').map(l => l.trim()).filter(l => l);

  // Find header row
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].toLowerCase().includes('segment')) { headerIdx = i; break; }
  }

  const header = rows[headerIdx].split(',').map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const colIdx = header.findIndex(h => h.includes(columnPattern));
  if (colIdx < 0) {
    console.warn(`[cellLibrary] No "${columnPattern}" column found in sheet`);
    return;
  }

  // Find the row with this segId
  const segColIdx = header.findIndex(h => h.includes('segmentid') || h.includes('segment'));
  if (segColIdx < 0) return;

  let rowIdx = -1;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const fields = rows[r].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
    if (fields[segColIdx] === segId) { rowIdx = r; break; }
  }
  if (rowIdx < 0) return;

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
  // If there's an existing response, append as a thread entry
  const userName = backend.userName || 'Unknown';
  let note = responseNote.value.trim();
  if (req.responseNote) {
    note = `${req.responseNote}\n---\n${userName}: ${note}`;
  }
  const payload = {
    note,
    url: responseUrl.value.trim() || undefined,
    annotationLayer: responseAnnotationLayer.value.trim() || undefined,
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

const panelStyle = computed(() => ({
  left: panelPos.value.x + 'px',
  top: panelPos.value.y + 'px',
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
          <button :class="{ active: filter === 'all' }" @click="filter = 'all'">
            All ({{ cells.length }})
          </button>
          <button :class="{ active: filter === 'available' }" @click="filter = 'available'">
            Available ({{ availableCount }})
          </button>
          <button :class="{ active: filter === 'claimed', 'nge-cl-claimed-tab': true }" @click="filter = 'claimed'">
            Claimed ({{ claimedCount }})
          </button>
          <button :class="{ active: filter === 'completed' }" @click="filter = 'completed'">
            Completed ({{ completedCount }})
          </button>
          <button :class="{ active: filter === 'help', 'nge-cl-help-tab': true }" @click="filter = 'help'">
            Help ({{ pendingHelp.length }})
          </button>
        </div>

        <!-- Search (not shown on Help tab) -->
        <div v-if="filter !== 'help'" class="nge-cl-search">
          <input
            v-model="search"
            placeholder="Search by ID, name, or notes..."
            class="nge-cl-search-input"
            @keydown.stop @keyup.stop @keypress.stop
          />
        </div>

        <!-- ═══ HELP TAB ═══ -->
        <div v-if="filter === 'help'" class="nge-cl-list">
          <!-- Pending help requests -->
          <div v-if="pendingHelp.length === 0 && resolvedHelp.length === 0" class="nge-cl-empty">
            No help requests yet. Select a segment and click "Ask for Second Opinion" in the annotation panel.
          </div>
          <div v-else-if="pendingHelp.length === 0" class="nge-cl-no-results">No pending requests</div>

          <div
            v-for="req in pendingHelp"
            :key="req.id"
            class="nge-cl-help-item"
            :class="{ 'nge-cl-help-item--active': activeHelpId === req.id }"
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
                  <div v-if="req.note" class="nge-cl-help-note">{{ req.note }}</div>
                </div>
              </div>
              <div class="nge-cl-row-actions">
                <button class="nge-cl-btn nge-cl-btn--jump" @click="jumpToReq(req)" title="Jump to segment">↗</button>
                <button class="nge-cl-btn nge-cl-btn--respond" @click="toggleResponseForm(req.id)" :title="respondingTo === req.id ? 'Cancel' : 'Respond'">
                  {{ respondingTo === req.id ? '▾' : '💬' }}
                </button>
                <button class="nge-cl-btn nge-cl-btn--complete" @click="resolveReq(req)">Resolve</button>
              </div>
            </div>

            <!-- Inline response form -->
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

            <!-- Show existing response thread -->
            <div v-if="req.responseNote" class="nge-cl-response-display">
              <div class="nge-cl-response-label">💬 {{ req.resolvedByName || 'Response' }}:</div>
              <div class="nge-cl-response-text" v-html="formatResponseThread(req.responseNote)"></div>
              <a v-if="req.responseUrl" class="nge-cl-response-link" @click.prevent="openResponseUrl(req.responseUrl)" href="#">↗ View linked state</a>
              <span v-if="req.responseAnnotationLayer" class="nge-cl-response-layer">📐 Layer: {{ req.responseAnnotationLayer }}</span>
              <button v-if="respondingTo !== req.id" class="nge-cl-btn nge-cl-btn--reply" @click="toggleResponseForm(req.id)">↩ Reply</button>
            </div>
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
          <div v-else-if="filteredCells.length === 0" class="nge-cl-no-results">No matching cells</div>

          <div
            v-for="cell in filteredCells"
            :key="cell.segId"
            class="nge-cl-row"
            :class="{
              'nge-cl-row--done': cell.status === 'completed',
              'nge-cl-row--mine': isMyClaim(cell),
            }"
          >
            <!-- Left: status pip + name -->
            <div class="nge-cl-row-left">
              <span class="nge-cl-pip" :class="statusClass(cell.status)"></span>
              <span v-if="cell.isStale" class="nge-cl-stale-dot" title="Segment ID outdated — current ID shown below"></span>
              <div class="nge-cl-row-info">
                <div class="nge-cl-row-name" @click="copyId(cell.currentSegId || cell.segId)" :title="'Click to copy ' + (cell.currentSegId || cell.segId)">
                  {{ history.getNickname(cell.segId) || cell.segId }}
                  <span v-if="copiedId === (cell.currentSegId || cell.segId)" class="nge-cl-copied">copied</span>
                </div>
                <div class="nge-cl-row-meta">
                  <span class="nge-cl-badge" :class="statusClass(cell.status)">{{ statusLabel(cell.status) }}</span>
                  <span v-if="filter === 'claimed' && cell.assignedTo" class="nge-cl-claimer">{{ getCachedUserName(cell.assignedTo) }}</span>
                  <span v-if="cell.notes" class="nge-cl-notes">{{ cell.notes }}</span>
                </div>
                <div v-if="cell.currentSegId && cell.currentSegId !== cell.segId" class="nge-cl-row-current" @click="copyId(cell.currentSegId)" title="Click to copy current ID">
                  current: {{ cell.currentSegId }}
                  <span v-if="copiedId === cell.currentSegId" class="nge-cl-copied">copied</span>
                </div>
              </div>
            </div>

            <!-- Right: actions -->
            <div class="nge-cl-row-actions">
              <button
                class="nge-cl-btn nge-cl-btn--jump"
                @click="jumpToCell(cell.currentSegId || cell.segId, cell.nucCoords || cell.somaCoords)"
                title="Jump to segment"
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

      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nge-cl-panel {
  position: fixed;
  z-index: 10010;
  width: 440px;
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

.nge-cl-stale-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #333;
  border: 1px solid #555;
  flex-shrink: 0;
  margin-left: -2px;
}

.nge-cl-row-current {
  font-size: 0.65em;
  color: #8bf;
  margin-top: 2px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nge-cl-row-current:hover { color: #adf; }

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
</style>
