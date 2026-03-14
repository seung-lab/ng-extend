<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  useProofreadingBackendStore,
  useProofreadingQueueStore,
  useLoginStore,
  useCellHistoryStore,
  type ProofreadingTask,
} from '../store';

const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();
const queue = useProofreadingQueueStore();
const login = useLoginStore();
const history = useCellHistoryStore();

const loading = ref(false);
const filter = ref<'mine' | 'all' | 'available' | 'completed'>('mine');
const search = ref('');

// ── Data loading ─────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true;
  // Load tasks from Supabase — these have claim/completion status
  await backend.loadTasks('eyewire_ii');
  // Also ensure queue items are loaded (from Google Sheet)
  if (queue.sheetUrl && queue.items.length === 0) {
    await queue.loadFromSheet();
  }
  loading.value = false;
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

  // Use queue items as the base list (from the Google Sheet)
  if (queue.items.length > 0) {
    return queue.items.map((item, idx) => {
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
      };
    });
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
  if (!isLoggedIn.value || !cell.taskId) return;
  await backend.claimTask(cell.taskId);
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
  // Auto-release claim on complete
  if (isMyClaim(cell)) {
    await backend.releaseBySegment(cell.segId);
    document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: cell.segId, status: 'released' } }));
  }
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

  // Resolve sheet name from gid
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`);
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
      headers: { 'Content-Type': 'application/json' },
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
    console.warn(`[cellLibrary] Sheet write failed (${writeRes.status})`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function truncateId(segId: string) {
  return segId.length > 8 ? '...' + segId.slice(-6) : segId;
}

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
            <span class="nge-cl-icon">🧬</span> Cell Library
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
          <button :class="{ active: filter === 'completed' }" @click="filter = 'completed'">
            Completed ({{ completedCount }})
          </button>
        </div>

        <!-- Search -->
        <div class="nge-cl-search">
          <input
            v-model="search"
            placeholder="Search by ID, name, or notes..."
            class="nge-cl-search-input"
            @keydown.stop @keyup.stop @keypress.stop
          />
        </div>

        <!-- Loading -->
        <div v-if="loading || backend.loading" class="nge-cl-loading">Loading cells...</div>

        <!-- Empty state -->
        <div v-else-if="cells.length === 0" class="nge-cl-empty">
          <p>No cells loaded yet.</p>
          <p v-if="!queue.sheetUrl" class="nge-cl-hint">Open Brain Quest first and load a quest sheet.</p>
        </div>

        <!-- Cell list -->
        <div v-else class="nge-cl-list">
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
              <div class="nge-cl-row-info">
                <div class="nge-cl-row-name">
                  {{ history.getNickname(cell.segId) || truncateId(cell.segId) }}
                </div>
                <div class="nge-cl-row-meta">
                  <span class="nge-cl-badge" :class="statusClass(cell.status)">{{ statusLabel(cell.status) }}</span>
                  <span v-if="cell.notes" class="nge-cl-notes">{{ cell.notes }}</span>
                </div>
              </div>
            </div>

            <!-- Right: actions -->
            <div class="nge-cl-row-actions">
              <button
                class="nge-cl-btn nge-cl-btn--jump"
                @click="jumpToCell(cell.segId, cell.nucCoords || cell.somaCoords)"
                title="Jump to segment"
              >↗</button>

              <button
                v-if="cell.status === 'pending' && isLoggedIn && cell.taskId"
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
.nge-cl-icon { font-size: 1.1em; }
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
</style>
