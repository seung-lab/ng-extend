<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useProofreadingQueueStore, useCellHistoryStore, useUserStatsStore, useProofreadingBackendStore } from '../store';
import { setCellComplete } from '../widgets/lightbulb_service';
import { EYEWIRE_II_CAVE_CONFIG } from '../config';
import { Uint64 } from 'neuroglancer/util/uint64';

const queue = useProofreadingQueueStore();
const history = useCellHistoryStore();
const backend = useProofreadingBackendStore();
const emit = defineEmits({ hide: null });

// Always re-fetch the sheet when the Brain Quest opens (picks up new segIDs)
onMounted(() => {
  if (queue.sheetUrl) queue.loadFromSheet();
});

const sheetInput = ref(queue.sheetUrl || '');

// ── View mode: 'daily' (3 quests/day) or 'all' (full-screen overlay) ──────
const viewMode = ref<'daily' | 'all'>('daily');

// ── All-neurons search filter ──────────────────────────────────────────
const allSearch = ref('');

/** Filtered items for the All Neurons view */
const filteredAllItems = computed(() => {
  const q = allSearch.value.trim().toLowerCase();
  if (!q) return queue.items.map((item, idx) => ({ item, idx }));
  return queue.items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => {
      const nick = getNickname(item.segId).toLowerCase();
      return nick.includes(q) || item.segId.includes(q) || (item.notes || '').toLowerCase().includes(q);
    });
});

/** Get claim info for a segment */
function getClaimInfo(segId: string) {
  return backend.isClaimedSegment(segId);
}

// ── Escape key to close panel (only when no split/merge tool is active) ──
function handleEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  // Don't interfere with split/merge escape handling
  if (document.querySelector('.graphene-multicut') || document.querySelector('.graphene-merge-segments')) return;
  if (viewMode.value === 'all') {
    viewMode.value = 'daily';
  } else {
    emit('hide');
  }
}
// Use regular (bubble) phase, not capture — let split/merge handler take priority
onMounted(() => document.addEventListener('keydown', handleEscape));
onUnmounted(() => document.removeEventListener('keydown', handleEscape));

// ── Draggable panel ─────────────────────────────────────────────────────
const panelPos = ref({ x: 12, y: -12 });
const isDragging = ref(false);
let dragStart = { mx: 0, my: 0, px: 0, py: 0 };

function startDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.nge-quest-close')) return;
  if ((e.target as HTMLElement).closest('.nge-quest-view-toggle')) return;
  isDragging.value = true;
  dragStart = { mx: e.clientX, my: e.clientY, px: panelPos.value.x, py: panelPos.value.y };
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  e.preventDefault();
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  panelPos.value = {
    x: dragStart.px + (e.clientX - dragStart.mx),
    y: dragStart.py + (e.clientY - dragStart.my),
  };
}

function stopDrag() {
  isDragging.value = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
});

const panelStyle = computed(() => ({
  left: `${panelPos.value.x}px`,
  bottom: `${panelPos.value.y * -1}px`,
}));
const showSetup = computed(() => queue.items.length === 0 && !queue.loading);

const current = computed(() => queue.currentItem());

// ═══════════════════════════════════════════════════════════════════════
// NEURON NICKNAME GENERATOR — Archetype + Sprite
// Deterministic: same segID always yields the same name.
// ═══════════════════════════════════════════════════════════════════════

const ARCHETYPES = [
  'Cosmic', 'Shadow', 'Crystal', 'Stellar', 'Nova', 'Phantom', 'Storm',
  'Radiant', 'Nebula', 'Frost', 'Solar', 'Lunar', 'Astral', 'Prism',
  'Azure', 'Crimson', 'Golden', 'Silver', 'Jade', 'Velvet', 'Coral',
  'Ivory', 'Cobalt', 'Amber', 'Raven', 'Titan', 'Mystic', 'Zenith',
  'Neon', 'Quantum', 'Spectral', 'Plasma', 'Cipher', 'Void', 'Arctic',
  'Ember', 'Opal', 'Onyx', 'Sapphire', 'Indigo',
];

const SPRITES = [
  'Spark', 'Whisper', 'Pulse', 'Echo', 'Drift', 'Bloom', 'Flicker',
  'Glimmer', 'Wisp', 'Ripple', 'Surge', 'Breeze', 'Shimmer', 'Flash',
  'Streak', 'Trace', 'Glow', 'Swirl', 'Mist', 'Beacon', 'Spiral',
  'Orbit', 'Gleam', 'Bolt', 'Wave', 'Shard', 'Nexus', 'Zephyr', 'Tide',
  'Flux', 'Halo', 'Rift', 'Blaze', 'Comet', 'Arc', 'Vortex', 'Plume',
  'Crest', 'Quasar', 'Helix',
];

/** Simple deterministic hash from a numeric string (segID). */
function hashSegId(segId: string): number {
  let h = 0;
  for (let i = 0; i < segId.length; i++) {
    h = ((h << 5) - h + segId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Map of segID → nickname, ensuring no word repeats within the visible set. */
const nicknameMap = computed(() => {
  const map = new Map<string, string>();
  const usedNames = new Set<string>();
  const usedWords = new Set<string>();  // No individual word reuse

  for (const item of queue.items) {
    let h = hashSegId(item.segId);
    let name = '';
    // Try up to 80 offsets to find a name with no shared words
    for (let attempt = 0; attempt < 80; attempt++) {
      const a = ARCHETYPES[(h + attempt * 3) % ARCHETYPES.length];
      const s = SPRITES[Math.abs(((h >>> 16) ^ (h * 7)) + attempt * 5) % SPRITES.length];
      const candidate = `${a} ${s}`;
      if (!usedNames.has(candidate) && !usedWords.has(a) && !usedWords.has(s)) {
        name = candidate;
        break;
      }
    }
    if (!name) name = `Neuron ${item.segId.slice(-6)}`;
    usedNames.add(name);
    // Track individual words so neither archetype nor sprite repeats
    const [w1, w2] = name.split(' ');
    if (w1) usedWords.add(w1);
    if (w2) usedWords.add(w2);
    map.set(item.segId, name);
  }
  return map;
});

function getNickname(segId: string): string {
  return nicknameMap.value.get(segId) || `Neuron ${segId.slice(-6)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// DAILY QUESTS — 3 neurons per day
// Uses the date as seed to pick 3 unproofread items.
// ═══════════════════════════════════════════════════════════════════════

const DAILY_QUEST_COUNT = 3;

/** Today's date string (resets daily quests). */
const todayStr = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

/** Date-seeded offset into the queue for daily selection. */
function dateSeed(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** The initial 3 daily quest items (indices into queue.items). */
const baseDailyQuestIndices = computed(() => {
  const total = queue.items.length;
  if (total === 0) return [];
  const seed = dateSeed(todayStr.value + (queue.sheetUrl || '') + ':gen' + resetGeneration.value);
  const indices: number[] = [];

  // Start from the seed offset, pick up to DAILY_QUEST_COUNT items
  // Prefer unproofread items, but fill with proofread if needed
  const startIdx = seed % total;
  // First pass: unproofread
  for (let i = 0; i < total && indices.length < DAILY_QUEST_COUNT; i++) {
    const idx = (startIdx + i) % total;
    if (!queue.proofread.has(queue.items[idx].segId)) {
      indices.push(idx);
    }
  }
  // If we still need more (all proofread), add proofread ones
  for (let i = 0; i < total && indices.length < DAILY_QUEST_COUNT; i++) {
    const idx = (startIdx + i) % total;
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices;
});

/** Incremented on each reset to change the seed → different quests. */
const resetGeneration = ref(0);

/** Bonus quests added when user clicks "Take on More Quests". */
const bonusQuestIndices = ref<number[]>([]);

/** Combined daily + bonus quest indices (the active quest set). */
const dailyQuestIndices = computed(() => {
  // Merge base daily with bonus, removing any duplicates
  const seen = new Set(baseDailyQuestIndices.value);
  const combined = [...baseDailyQuestIndices.value];
  for (const idx of bonusQuestIndices.value) {
    if (!seen.has(idx)) {
      seen.add(idx);
      combined.push(idx);
    }
  }
  return combined;
});

const dailyQuests = computed(() =>
  dailyQuestIndices.value.map(idx => queue.items[idx]).filter(Boolean),
);

const dailyComplete = computed(() =>
  dailyQuests.value.length > 0 && dailyQuests.value.every(item => queue.proofread.has(item.segId)),
);

const dailyProgress = computed(() => {
  if (dailyQuests.value.length === 0) return 0;
  const done = dailyQuests.value.filter(i => queue.proofread.has(i.segId)).length;
  return done;
});

// Re-show celebration only when the BASE daily quests complete (not bonus)
watch(() => {
  const baseQuests = baseDailyQuestIndices.value.map(idx => queue.items[idx]).filter(Boolean);
  return baseQuests.length > 0 && baseQuests.every(item => queue.proofread.has(item.segId));
}, (val) => {
  if (val && bonusQuestIndices.value.length === 0) celebrationDismissed.value = false;
});

/** Are there unproofread items in the queue that aren't in the current daily set? */
const hasMoreUnproofread = computed(() => {
  const activeSet = new Set(dailyQuestIndices.value);
  return queue.items.some((item, idx) => !activeSet.has(idx) && !queue.proofread.has(item.segId));
});

/** Jump to a daily quest by its index in dailyQuests. */
function selectDailyQuest(idx: number) {
  const queueIdx = dailyQuestIndices.value[idx];
  if (queueIdx !== undefined) {
    jumpToItem(queueIdx);
  }
}

// ═══════════════════════════════════════════════════════════════════════

// Local input fields bound to the current item
const somaInput     = ref('');
const finalSegInput = ref('');
const annotationInput = ref('');

// Sync inputs when current item changes
watch(current, (item) => {
  if (!item) return;
  const edits = queue.getEdits(item.segId);
  somaInput.value     = item.somaCoords || edits.somaCoords || '';
  finalSegInput.value = item.finalSegId || edits.finalSegId || '';
  annotationInput.value = edits.annotation || '';
}, { immediate: true });

const progress = computed(() => {
  const total = queue.totalCount();
  if (total === 0) return 0;
  return Math.round((queue.proofreadCount() / total) * 100);
});

const isProofread = computed(() => {
  const item = current.value;
  return item ? queue.proofread.has(item.segId) : false;
});

const isClaimed = computed(() => {
  const item = current.value;
  return item ? queue.isClaimed(item) : false;
});

const canComplete = computed(() => {
  const item = current.value;
  if (!item) return false;
  const hasSoma  = (item.somaCoords || somaInput.value).trim().length > 0;
  const hasFinal = (item.finalSegId || finalSegInput.value).trim().length > 0;
  return hasSoma && hasFinal;
});

function loadSheet() {
  const url = sheetInput.value.trim();
  if (url) queue.loadFromSheet(url);
}

function goNext() { queue.next(); }
function goPrev() { queue.prev(); }

/** Validate soma coords: must be 3 comma-separated numbers (x, y, z). */
function validateSomaCoords(input: string): { valid: boolean; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, error: '' };
  const parts = trimmed.split(',').map(s => s.trim());
  if (parts.length !== 3) return { valid: false, error: 'Need 3 values: x, y, z' };
  for (const p of parts) {
    if (!/^-?\d+(\.\d+)?$/.test(p)) return { valid: false, error: `"${p}" is not a valid number` };
  }
  return { valid: true, error: '' };
}

const somaValidation = computed(() => validateSomaCoords(somaInput.value));

/** Claim the cell by saving soma coords, then jump to segment. */
function claimCell() {
  const item = current.value;
  if (!item) return;
  const coords = somaInput.value.trim();
  if (!coords) return;
  const v = validateSomaCoords(coords);
  if (!v.valid) return;
  queue.setEdit(item.segId, 'somaCoords', coords);
  // Write soma coords back to Google Sheet
  queue.writeSomaCoordsToSheet(item.segId, coords);
  queue.navigateToCurrentItem();
}

/** Save final seg ID to local edits. */
function saveFinalSegId() {
  const item = current.value;
  if (!item) return;
  queue.setEdit(item.segId, 'finalSegId', finalSegInput.value.trim());
}

/** Save annotation to local edits. */
function saveAnnotation() {
  const item = current.value;
  if (!item) return;
  queue.setEdit(item.segId, 'annotation', annotationInput.value.trim());
}

/** Mark proofread — calls lightbulb service and advances. */
async function markProofreadAndNext() {
  const item = current.value;
  if (!item || !canComplete.value) return;

  if (somaInput.value.trim()) queue.setEdit(item.segId, 'somaCoords', somaInput.value.trim());
  if (finalSegInput.value.trim()) queue.setEdit(item.segId, 'finalSegId', finalSegInput.value.trim());
  if (annotationInput.value.trim()) queue.setEdit(item.segId, 'annotation', annotationInput.value.trim());

  const caveServer = EYEWIRE_II_CAVE_CONFIG.caveServerOverride || '';
  await setCellComplete(caveServer, item.segId, true);

  // Auto-release claim when marking complete
  const claimInfo = backend.isClaimedSegment(item.segId);
  if (claimInfo.claimed && claimInfo.byMe) {
    await backend.releaseBySegment(item.segId);
    document.dispatchEvent(new CustomEvent('nge:seg-status-changed', { detail: { segmentId: item.segId, status: 'released' } }));
  }

  queue.markProofread(item.segId);

  // Also ensure this cell appears in profile cell history (with annotation as cell type if set)
  try {
    const annotation = annotationInput.value.trim();
    if (annotation) {
      history.upsert({ segId: item.segId, cellType: annotation });
    }
  } catch { /* non-critical */ }

  // Track quest completion in daily log for streak chart
  const statsStore = useUserStatsStore();
  statsStore.logDailyQuestComplete();

  if (viewMode.value === 'all') {
    // All-tasks mode: advance to next unproofread globally
    queue.nextUnproofread();
  } else {
    // Daily mode: advance to the next uncompleted daily quest
    const currentQuestIdx = dailyQuestIndices.value.indexOf(queue.currentIdx);
    const activeIndices = dailyQuestIndices.value;
    // Look for next uncompleted daily quest (wrapping around)
    for (let i = 1; i <= activeIndices.length; i++) {
      const nextIdx = (currentQuestIdx + i) % activeIndices.length;
      const queueIdx = activeIndices[nextIdx];
      if (queueIdx !== undefined && !queue.proofread.has(queue.items[queueIdx]?.segId)) {
        queue.jumpToIndex(queueIdx);
        return;
      }
    }
    // All daily quests done — celebration will show
  }
}

function truncateId(id: string): string {
  return id.length > 16 ? id.slice(0, 6) + '…' + id.slice(-6) : id;
}

const copied = ref(false);
function copySegId() {
  const item = current.value;
  if (!item) return;
  navigator.clipboard.writeText(item.segId);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1500);
}

/** Dismiss the celebration and advance to next unproofread quest. */
const celebrationDismissed = ref(false);

function takeOnMoreQuests() {
  celebrationDismissed.value = true;

  // Find the next unproofread item NOT already in the active daily set
  const activeSet = new Set(dailyQuestIndices.value);
  const total = queue.items.length;
  if (total === 0) return;

  // Search from a seeded start to spread out bonus quests
  const seed = dateSeed(todayStr.value + 'bonus' + bonusQuestIndices.value.length);
  for (let i = 0; i < total; i++) {
    const idx = (seed + i) % total;
    if (!activeSet.has(idx) && !queue.proofread.has(queue.items[idx].segId)) {
      bonusQuestIndices.value.push(idx);
      queue.jumpToIndex(idx);
      return;
    }
  }

  // All items are proofread or already in daily set — just go to next unproofread globally
  queue.nextUnproofread();
}

/** Jump to a specific item from the all-neurons list — load cell in viewer. */
function jumpToItem(idx: number) {
  queue.jumpToIndex(idx);
  const item = queue.items[idx];
  if (!item) return;

  // Parse coordinates if available
  const coordStr = item.somaCoords || item.nucCoords || '';
  const parts = coordStr.split(',').map(s => parseFloat(s.trim()));
  const pos: [number, number, number] | undefined =
    parts.length === 3 && parts.every(n => !isNaN(n)) ? [parts[0], parts[1], parts[2]] : undefined;

  // Add the segment to the segmentation layer using the imported Uint64
  const viewer: any = (window as any)['viewer'];
  if (!viewer) { console.warn('[BrainQuest] No viewer found'); return; }

  const layers = viewer.layerManager?.managedLayers;
  if (!layers) { console.warn('[BrainQuest] No managedLayers'); return; }

  // Find the segmentation layer (try SegmentationUserLayer class check first,
  // then fall back to name/type heuristics)
  let segManagedLayer: any = null;
  for (const ml of layers) {
    const layer = ml.layer;
    if (!layer) continue;
    // Check class name — most reliable for neuroglancer internals
    const className = layer.constructor?.name || '';
    if (className.includes('Segmentation') ||
        layer.type === 'segmentation' ||
        ml.initialSpecification?.type === 'segmentation') {
      segManagedLayer = ml;
      break;
    }
  }

  if (!segManagedLayer) {
    console.warn('[BrainQuest] No segmentation layer found among', layers.length, 'layers');
    return;
  }

  // Parse segID using the directly imported Uint64 class
  try {
    const seg = Uint64.parseString(item.segId);
    const layer = segManagedLayer.layer;
    const groupState = layer?.displayState?.segmentationGroupState?.value;
    if (groupState?.visibleSegments) {
      if (!groupState.visibleSegments.has(seg)) {
        groupState.visibleSegments.add(seg);
      }
      console.info('[BrainQuest] Added segment', item.segId, 'via imported Uint64');
    } else {
      console.warn('[BrainQuest] No segmentationGroupState.visibleSegments');
    }
  } catch (e) {
    console.warn('[BrainQuest] Uint64.parseString failed for', item.segId, e);
  }

  // Navigate to position
  if (pos && (pos[0] || pos[1] || pos[2])) {
    try {
      viewer.navigationState.position.value = Float32Array.from(pos);
    } catch (e) {
      console.warn('[BrainQuest] Could not set position:', e);
    }
  }

  // Force-open the Seg layer panel so the user sees the segment
  try {
    viewer.selectedLayer.layer = segManagedLayer;
    viewer.selectedLayer.visible = true;
  } catch (e) {
    console.warn('[BrainQuest] Could not open Seg layer panel:', e);
  }
}

/** Pretty date for daily header */
const todayLabel = computed(() => {
  const d = new Date();
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
});

function shareOnX() {
  const text = encodeURIComponent(
    `I just completed today's Brain Quest on EyeWire II! 🧠✨ ${dailyQuests.value.length} neurons proofread.\n\n#EyeWireII #neuroscience #citizenscience`
  );
  window.open(`https://x.com/intent/tweet?text=${text}`, '_blank', 'width=550,height=420');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-quest" appear>
      <div v-show="viewMode !== 'all'" class="nge-quest-board" :style="panelStyle">

        <div class="nge-quest-topbar" @mousedown="startDrag" :class="{ 'nge-quest-dragging': isDragging }">
          <div class="nge-quest-title">
            <span class="nge-quest-icon">🧠</span> Brain Quest
          </div>
          <div class="nge-quest-topbar-actions">
            <!-- View toggle: daily vs all -->
            <button
              v-if="queue.items.length > 0"
              class="nge-quest-view-toggle"
              @click="viewMode = viewMode === 'daily' ? 'all' : 'daily'"
              :title="viewMode === 'daily' ? 'View all cells' : 'Back to daily quests'"
            >{{ viewMode === 'daily' ? '☰' : '◆' }}</button>
            <button class="nge-quest-close" @click="emit('hide')">×</button>
          </div>
        </div>

        <!-- Setup: paste sheet URL -->
        <div v-if="showSetup" class="nge-quest-setup">
          <div class="nge-quest-setup-text">
            Paste a queue spreadsheet to start your expedition.
          </div>
          <input
            v-model="sheetInput"
            class="nge-quest-input nge-quest-url-input"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            @keydown.stop @keyup.stop @keypress.stop
            @keydown.enter="loadSheet"
          />
          <button class="nge-quest-load-btn" @click="loadSheet" :disabled="!sheetInput.trim()">
            Load Quests
          </button>
          <div v-if="queue.error" class="nge-quest-error">{{ queue.error }}</div>
        </div>

        <!-- Loading state -->
        <div v-else-if="queue.loading" class="nge-quest-loading">
          Scanning neurons…
        </div>

        <!-- ═══════════════════════════════════════════════════════════
             DAILY QUEST VIEW — 3 neurons per day + card detail
             ═══════════════════════════════════════════════════════════ -->
        <div v-else class="nge-quest-content">

          <!-- Daily header -->
          <div class="nge-quest-daily-header">
            <div class="nge-quest-daily-title">Today's Quests</div>
            <div class="nge-quest-daily-date">{{ todayLabel }}</div>
          </div>

          <!-- Daily progress pips -->
          <div class="nge-quest-daily-pips">
            <div
              v-for="(dq, i) in dailyQuests"
              :key="dq.segId"
              class="nge-quest-daily-pip-card"
              :class="{
                'nge-quest-daily-pip-card--done': queue.proofread.has(dq.segId),
                'nge-quest-daily-pip-card--active': current && current.segId === dq.segId,
              }"
              @click="selectDailyQuest(i)"
            >
              <span class="nge-quest-daily-pip-check" v-if="queue.proofread.has(dq.segId)">✓</span>
              <span class="nge-quest-daily-pip-num" v-else>{{ i + 1 }}</span>
              <span class="nge-quest-daily-pip-name">{{ getNickname(dq.segId) }}</span>
            </div>
          </div>

          <!-- Daily complete celebration -->
          <div v-if="dailyComplete && !celebrationDismissed" class="nge-quest-celebration">
            <div class="nge-quest-celebration-particles">
              <span v-for="i in 12" :key="i" class="nge-quest-particle" :style="{ '--i': i }"></span>
            </div>
            <div class="nge-quest-celebration-badge">✦</div>
            <div class="nge-quest-celebration-title">Quest Complete!</div>
            <div class="nge-quest-celebration-sub">
              You finished all {{ dailyQuests.length }} neurons for today.
              <br/>The connectome thanks you!
            </div>
            <div class="nge-quest-celebration-actions">
              <button v-if="hasMoreUnproofread"
                      class="nge-quest-celebration-btn nge-quest-celebration-btn--more"
                      @click="takeOnMoreQuests">
                🧠 Take on Next Quest
              </button>
              <button v-else
                      class="nge-quest-celebration-btn nge-quest-celebration-btn--more"
                      @click="queue.resetAll(); resetGeneration++; bonusQuestIndices = []; celebrationDismissed = true"
                      title="Reset and get fresh quests">
                ✨ New Quest!
              </button>
              <button class="nge-quest-celebration-btn nge-quest-celebration-btn--close"
                      @click="celebrationDismissed = true">
                Continue
              </button>
            </div>
            <button class="nge-quest-share-btn" @click="shareOnX">
              Share on 𝕏
            </button>
          </div>

          <!-- Overall progress -->
          <div class="nge-quest-progress">
            <div class="nge-quest-progress-track">
              <div class="nge-quest-progress-fill" :style="{ width: progress + '%' }"></div>
            </div>
            <div class="nge-quest-progress-text">
              {{ queue.proofreadCount() }}/{{ queue.totalCount() }} total · {{ dailyProgress }}/{{ dailyQuests.length }} today
            </div>
          </div>

          <!-- Current quest card -->
          <div v-if="current" class="nge-quest-card" :class="{
            'nge-quest-card--done': isProofread,
            'nge-quest-card--active': isClaimed && !isProofread,
          }">
            <div class="nge-quest-card-header">
              <span v-if="isProofread" class="nge-quest-badge nge-quest-badge--done">✓ done</span>
              <span v-else-if="isClaimed" class="nge-quest-badge nge-quest-badge--active">active</span>
              <span v-else class="nge-quest-badge nge-quest-badge--new">new</span>
            </div>

            <!-- Nickname (big & fun) -->
            <div class="nge-quest-nickname" @click="queue.navigateToCurrentItem()" title="Jump to segment">
              {{ getNickname(current.segId) }} <span class="nge-quest-seg-jump">↗</span>
            </div>

            <!-- Full Segment ID below -->
            <div class="nge-quest-seg-row">
              <div class="nge-quest-seg-id-full">{{ current.segId }}</div>
              <button class="nge-quest-copy" @click="copySegId" :title="copied ? 'Copied!' : 'Copy ID'">
                {{ copied ? '✓' : '📋' }}
              </button>
            </div>

            <!-- Notes from spreadsheet -->
            <div v-if="current.notes" class="nge-quest-notes">{{ current.notes }}</div>

            <!-- STEP 1: Claim — Enter Soma Coords -->
            <div class="nge-quest-field" v-if="!isProofread">
              <label class="nge-quest-label" title="Right-click on the nucleus in the viewer, then click the copy/paste icon at the top-left to copy coordinates">
                Soma Coords <span class="nge-quest-req">*</span>
                <span class="nge-quest-label-hint">ⓘ right-click nucleus → copy icon</span>
              </label>
              <div class="nge-quest-field-row">
                <input v-model="somaInput"
                  class="nge-quest-input"
                  :class="{ 'nge-quest-input--error': somaInput.trim() && !somaValidation.valid }"
                  placeholder="x, y, z"
                  title="Right-click on the nucleus in the viewer, then click the copy/paste icon at the top-left to copy coordinates"
                  @keydown.stop @keyup.stop @keypress.stop
                  @blur="somaInput.trim() && somaValidation.valid && claimCell()" />
                <button v-if="!isClaimed" class="nge-quest-btn-claim" @click="claimCell"
                        :disabled="!somaInput.trim() || !somaValidation.valid">Claim</button>
                <button v-else class="nge-quest-btn-jump" @click="queue.navigateToCurrentItem()">Jump</button>
              </div>
              <div class="nge-quest-field-error" v-if="somaInput.trim() && !somaValidation.valid && somaValidation.error">
                {{ somaValidation.error }}
              </div>
            </div>

            <!-- STEP 2: Final Seg ID -->
            <div class="nge-quest-field" v-if="isClaimed && !isProofread">
              <label class="nge-quest-label">Final Seg ID <span class="nge-quest-req">*</span></label>
              <input v-model="finalSegInput" class="nge-quest-input" placeholder="Final segment ID"
                @keydown.stop @keyup.stop @keypress.stop
                @blur="finalSegInput.trim() && saveFinalSegId()" />
            </div>

            <!-- STEP 3: Annotation (optional) -->
            <div class="nge-quest-field" v-if="isClaimed && !isProofread">
              <label class="nge-quest-label">Label <span class="nge-quest-opt">(optional)</span></label>
              <input v-model="annotationInput" class="nge-quest-input" placeholder="SAC, Muller, Glia…"
                @keydown.stop @keyup.stop @keypress.stop
                @blur="annotationInput.trim() && saveAnnotation()" />
            </div>

            <!-- Completed summary -->
            <div v-if="isProofread" class="nge-quest-done-info">
              <div v-if="somaInput"><span class="nge-quest-done-lbl">Soma</span> {{ somaInput }}</div>
              <div v-if="finalSegInput"><span class="nge-quest-done-lbl">Final</span> {{ finalSegInput }}</div>
            </div>
          </div>

          <!-- Mark complete button -->
          <button v-if="current && isClaimed && !isProofread"
            class="nge-quest-complete"
            :class="{ 'nge-quest-complete--ready': canComplete }"
            :disabled="!canComplete"
            @click="markProofreadAndNext"
          >
            ✓ Complete Quest
          </button>

          <!-- Navigation -->
          <div class="nge-quest-nav">
            <button class="nge-quest-nav-btn" @click="goPrev">◀</button>
            <button class="nge-quest-nav-btn" @click="goNext">▶</button>
            <button class="nge-quest-nav-btn nge-quest-nav-btn--skip" @click="queue.nextUnproofread()">Skip ▶▶</button>
          </div>

          <!-- Footer -->
          <div class="nge-quest-footer">
            <button class="nge-quest-footer-btn" @click="queue.loadFromSheet()">↻ Reload</button>
            <button class="nge-quest-footer-btn" @click="queue.resetAll(); resetGeneration++; bonusQuestIndices = []">Reset</button>
          </div>
        </div>

      </div>
    </Transition>

    <!-- All Neurons — narrow side panel -->
    <Transition name="nge-all-slide">
      <div v-if="viewMode === 'all'" class="nge-all-side">
        <div class="nge-all-topbar">
          <div class="nge-all-title">{{ queue.proofreadCount() }}/{{ queue.totalCount() }}</div>
          <input v-model="allSearch" class="nge-all-search" placeholder="Search…"
            @keydown.stop @keyup.stop @keypress.stop />
          <button class="nge-all-close" @click="viewMode = 'daily'">×</button>
        </div>

        <div class="nge-all-list">
          <!-- Claimed -->
          <template v-for="{ item, idx } in filteredAllItems.filter(x => getClaimInfo(x.item.segId).claimed || queue.isClaimed(x.item))" :key="'c-' + item.segId">
            <div class="nge-all-row nge-all-row--claimed" :class="{ 'nge-all-row--active': queue.currentIdx === idx }" @click="jumpToItem(idx)">
              <span class="nge-all-pip nge-all-pip--claimed"></span>
              <div class="nge-all-info">
                <span class="nge-all-name">{{ getNickname(item.segId) }}</span>
                <span class="nge-all-segid">{{ item.segId }}</span>
              </div>
              <span v-if="getClaimInfo(item.segId).byMe" class="nge-all-tag nge-all-tag--mine">You</span>
              <span v-else class="nge-all-tag nge-all-tag--claimed">{{ getClaimInfo(item.segId).byName || 'Taken' }}</span>
            </div>
          </template>

          <!-- Available -->
          <template v-for="{ item, idx } in filteredAllItems.filter(x => !queue.proofread.has(x.item.segId) && !getClaimInfo(x.item.segId).claimed && !queue.isClaimed(x.item))" :key="'a-' + item.segId">
            <div class="nge-all-row" :class="{ 'nge-all-row--active': queue.currentIdx === idx }" @click="jumpToItem(idx)">
              <span class="nge-all-pip"></span>
              <div class="nge-all-info">
                <span class="nge-all-name">{{ getNickname(item.segId) }}</span>
                <span class="nge-all-segid">{{ item.segId }}</span>
              </div>
            </div>
          </template>

          <!-- Completed -->
          <template v-for="{ item, idx } in filteredAllItems.filter(x => queue.proofread.has(x.item.segId))" :key="'d-' + item.segId">
            <div class="nge-all-row nge-all-row--done" :class="{ 'nge-all-row--active': queue.currentIdx === idx }" @click="jumpToItem(idx)">
              <span class="nge-all-pip nge-all-pip--done"></span>
              <div class="nge-all-info">
                <span class="nge-all-name">{{ getNickname(item.segId) }}</span>
                <span class="nge-all-segid">{{ item.segId }}</span>
              </div>
              <span class="nge-all-tag nge-all-tag--done">Done</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nge-quest-board {
  position: fixed;
  z-index: 9000;
  width: 330px;
  background: linear-gradient(170deg, rgba(10, 16, 30, 0.96) 0%, rgba(8, 10, 20, 0.98) 100%);
  border: 1px solid rgba(0, 180, 255, 0.18);
  border-radius: 4px;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.5),
    0 0 60px rgba(0, 150, 255, 0.06),
    0 0 120px rgba(0, 150, 255, 0.02),
    inset 0 0 40px rgba(0, 100, 200, 0.015);
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  color: #ccd;
  overflow: hidden;
  animation: nge-quest-glow 4s ease-in-out infinite;
}

@keyframes nge-quest-glow {
  0%, 100% {
    border-color: rgba(0, 180, 255, 0.18);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.5),
      0 0 60px rgba(0, 150, 255, 0.06),
      0 0 120px rgba(0, 150, 255, 0.02),
      inset 0 0 40px rgba(0, 100, 200, 0.015);
  }
  50% {
    border-color: rgba(0, 200, 255, 0.28);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.5),
      0 0 80px rgba(0, 150, 255, 0.10),
      0 0 160px rgba(0, 150, 255, 0.03),
      inset 0 0 60px rgba(0, 100, 200, 0.025);
  }
}

/* Topbar */
.nge-quest-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid rgba(74, 158, 255, 0.08);
  background: rgba(74, 158, 255, 0.03);
  cursor: grab;
  user-select: none;
}
.nge-quest-dragging { cursor: grabbing; }

.nge-quest-title {
  font-size: 0.95em;
  font-weight: 700;
  color: #e0e4ee;
  display: flex;
  align-items: center;
  gap: 6px;
}
.nge-quest-icon { font-size: 1.15em; }

.nge-quest-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nge-quest-view-toggle {
  background: none; border: 1px solid rgba(74, 158, 255, 0.15);
  color: #78a; font-size: 0.9em; cursor: pointer; padding: 2px 6px;
  border-radius: 3px; transition: all 0.12s; line-height: 1;
}
.nge-quest-view-toggle:hover { color: #acd; border-color: rgba(74, 158, 255, 0.35); }

.nge-quest-close {
  background: none; border: none;
  color: #556; font-size: 1.3em; cursor: pointer; padding: 0; line-height: 1;
  transition: color 0.12s;
}
.nge-quest-close:hover { color: #aab; }

/* Setup */
.nge-quest-setup { padding: 16px 14px 18px; }

.nge-quest-setup-text {
  font-size: 0.82em;
  color: #778;
  margin-bottom: 10px;
  line-height: 1.4;
}

.nge-quest-url-input {
  width: 100%;
  margin-bottom: 8px;
}

.nge-quest-load-btn {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #4285f4, #5c6bc0);
  color: #fff;
  font-size: 0.88em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: filter 0.12s;
}
.nge-quest-load-btn:disabled { opacity: 0.4; cursor: default; }
.nge-quest-load-btn:hover:not(:disabled) { filter: brightness(1.08); }

.nge-quest-error {
  margin-top: 8px;
  font-size: 0.78em;
  color: #f66;
}

/* Loading */
.nge-quest-loading {
  padding: 24px 14px;
  text-align: center;
  color: #667;
  font-size: 0.85em;
  font-style: italic;
}

/* Content */
.nge-quest-content {
  padding: 10px 14px 14px;
  max-height: 480px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) transparent;
}

/* ══════════════════════════════════════════════
   DAILY QUEST HEADER + PIPS
   ══════════════════════════════════════════════ */

.nge-quest-daily-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.nge-quest-daily-title {
  font-size: 0.82em;
  font-weight: 700;
  color: rgba(0, 200, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.nge-quest-daily-date {
  font-size: 0.68em;
  color: #556;
}

.nge-quest-daily-pips {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.nge-quest-daily-pip-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(74, 158, 255, 0.1);
  background: rgba(74, 158, 255, 0.02);
  cursor: pointer;
  transition: all 0.15s;
  overflow: hidden;
}
.nge-quest-daily-pip-card:hover {
  border-color: rgba(74, 158, 255, 0.25);
  background: rgba(74, 158, 255, 0.05);
}
.nge-quest-daily-pip-card--active {
  border-color: rgba(206, 147, 216, 0.35);
  background: rgba(206, 147, 216, 0.06);
}
.nge-quest-daily-pip-card--done {
  border-color: rgba(127, 255, 136, 0.2);
  background: rgba(127, 255, 136, 0.03);
}

.nge-quest-daily-pip-num {
  flex-shrink: 0;
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 1.5px solid rgba(74, 158, 255, 0.3);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.65em; font-weight: 700; color: #78a;
}
.nge-quest-daily-pip-card--active .nge-quest-daily-pip-num {
  border-color: rgba(206, 147, 216, 0.5);
  color: #CE93D8;
}

.nge-quest-daily-pip-check {
  flex-shrink: 0;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: rgba(127, 255, 136, 0.15);
  border: 1.5px solid rgba(127, 255, 136, 0.35);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.6em; font-weight: 700; color: #7f8;
}

.nge-quest-daily-pip-name {
  font-size: 0.65em;
  font-weight: 600;
  color: #9ab;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nge-quest-daily-pip-card--done .nge-quest-daily-pip-name { color: #7a8; }

/* ══════════════════════════════════════════════
   QUEST COMPLETE CELEBRATION
   ══════════════════════════════════════════════ */

.nge-quest-celebration {
  text-align: center;
  padding: 20px 10px 16px;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: 10px;
  background: radial-gradient(ellipse at center, rgba(255, 215, 0, 0.06) 0%, transparent 70%);
  margin-bottom: 10px;
  animation: nge-quest-celebrate-glow 3s ease-in-out infinite;
}

@keyframes nge-quest-celebrate-glow {
  0%, 100% {
    border-color: rgba(255, 215, 0, 0.2);
    box-shadow: 0 0 20px rgba(255, 215, 0, 0.05), inset 0 0 30px rgba(255, 215, 0, 0.02);
  }
  50% {
    border-color: rgba(255, 215, 0, 0.4);
    box-shadow: 0 0 40px rgba(255, 215, 0, 0.1), inset 0 0 50px rgba(255, 215, 0, 0.04);
  }
}

.nge-quest-celebration-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.nge-quest-particle {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 215, 0, 0.6);
  animation: nge-quest-float 3s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.25s);
  left: calc(var(--i) * 8% + 2%);
  top: 80%;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.4);
}

.nge-quest-particle:nth-child(even) {
  background: rgba(180, 140, 255, 0.5);
  box-shadow: 0 0 6px rgba(180, 140, 255, 0.3);
  width: 3px;
  height: 3px;
}

.nge-quest-particle:nth-child(3n) {
  background: rgba(100, 200, 255, 0.5);
  box-shadow: 0 0 6px rgba(100, 200, 255, 0.3);
  width: 5px;
  height: 5px;
}

@keyframes nge-quest-float {
  0% { transform: translateY(0) scale(0); opacity: 0; }
  10% { opacity: 1; transform: translateY(-10px) scale(1); }
  90% { opacity: 0.6; }
  100% { transform: translateY(-120px) scale(0.3); opacity: 0; }
}

.nge-quest-celebration-badge {
  font-size: 2.5em;
  color: #ffd700;
  text-shadow: 0 0 20px rgba(255, 215, 0, 0.6), 0 0 40px rgba(255, 215, 0, 0.2);
  animation: nge-quest-badge-pulse 2s ease-in-out infinite;
  margin-bottom: 6px;
}

@keyframes nge-quest-badge-pulse {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.1); filter: brightness(1.3); }
}

.nge-quest-celebration-title {
  font-size: 1.3em;
  font-weight: 800;
  color: #ffd700;
  text-shadow: 0 0 12px rgba(255, 215, 0, 0.4);
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.nge-quest-celebration-sub {
  font-size: 0.78em;
  color: #9ab;
  line-height: 1.5;
  margin-bottom: 14px;
}

.nge-quest-celebration-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 10px;
}

.nge-quest-celebration-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.82em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.nge-quest-celebration-btn--more {
  background: linear-gradient(135deg, #7c4dff, #651fff);
  color: #fff;
  box-shadow: 0 2px 12px rgba(124, 77, 255, 0.3);
}
.nge-quest-celebration-btn--more:hover {
  filter: brightness(1.15);
  box-shadow: 0 4px 16px rgba(124, 77, 255, 0.4);
}

.nge-quest-celebration-btn--close {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #889;
}
.nge-quest-celebration-btn--close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #bbc;
}

.nge-quest-celebration-btn--allclear {
  background: linear-gradient(135deg, rgba(127, 255, 136, 0.08), rgba(0, 180, 255, 0.08));
  border: 1px solid rgba(127, 255, 136, 0.2);
  color: rgba(127, 255, 136, 0.7);
  cursor: default;
  font-weight: 600;
}

.nge-quest-share-btn {
  background: none;
  border: 1px solid rgba(100, 180, 255, 0.2);
  border-radius: 6px;
  color: rgba(100, 180, 255, 0.7);
  font-size: 0.72em;
  font-family: inherit;
  padding: 5px 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.nge-quest-share-btn:hover {
  border-color: rgba(100, 180, 255, 0.5);
  color: rgba(100, 180, 255, 1);
  background: rgba(100, 180, 255, 0.06);
}

/* ══════════════════════════════════════════════
   NICKNAME + SEG ID DISPLAY
   ══════════════════════════════════════════════ */

.nge-quest-nickname {
  font-size: 1.15em;
  font-weight: 700;
  color: rgba(206, 147, 216, 0.9);
  cursor: pointer;
  transition: color 0.12s;
  margin-bottom: 2px;
  line-height: 1.3;
}
.nge-quest-nickname:hover { color: rgba(206, 147, 216, 1); }

.nge-quest-seg-id-full {
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.7em;
  color: rgba(74, 158, 255, 0.45);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

/* ══════════════════════════════════════════════
   ALL NEURONS — NARROW SIDE PANEL
   ══════════════════════════════════════════════ */

.nge-all-side {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 220px;
  z-index: 80;
  background: linear-gradient(170deg, rgba(10, 16, 30, 0.97) 0%, rgba(8, 10, 20, 0.98) 100%);
  border-right: 1px solid rgba(0, 180, 255, 0.15);
  box-shadow: 4px 0 20px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  color: #ccd;
}

.nge-all-topbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(74, 158, 255, 0.1);
  background: rgba(74, 158, 255, 0.03);
  flex-shrink: 0;
}

.nge-all-title {
  font-size: 0.78em;
  font-weight: 700;
  color: rgba(0, 200, 255, 0.7);
  white-space: nowrap;
}

.nge-all-search {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid rgba(74, 158, 255, 0.15);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  color: #dde;
  font-size: 0.78em;
  font-family: inherit;
  outline: none;
  transition: border-color 0.12s;
}
.nge-all-search:focus { border-color: rgba(74, 158, 255, 0.4); }
.nge-all-search::placeholder { color: #445; }

.nge-all-close {
  background: none; border: none;
  color: #556; font-size: 1.2em; cursor: pointer; padding: 0; line-height: 1;
  transition: color 0.12s; flex-shrink: 0;
}
.nge-all-close:hover { color: #aab; }

/* Scrollable list */
.nge-all-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) transparent;
  padding: 4px 0;
}

/* Row */
.nge-all-row {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 5px 10px;
  cursor: pointer;
  transition: background 0.1s;
  border-left: 2px solid transparent;
}
.nge-all-row:hover {
  background: rgba(74, 158, 255, 0.06);
}
.nge-all-row--active {
  background: rgba(206, 147, 216, 0.08);
  border-left-color: #CE93D8;
}
.nge-all-row--done { opacity: 0.45; }
.nge-all-row--claimed {
  background: rgba(255, 180, 50, 0.03);
}

/* Pip */
.nge-all-pip {
  flex-shrink: 0;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: 1.5px solid rgba(255, 255, 255, 0.15);
}
.nge-all-pip--done {
  background: rgba(127, 255, 136, 0.3);
  border-color: rgba(127, 255, 136, 0.5);
}
.nge-all-pip--claimed {
  background: rgba(255, 180, 50, 0.3);
  border-color: rgba(255, 180, 50, 0.6);
}

/* Info column (name + segID stacked) */
.nge-all-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* Name */
.nge-all-name {
  font-size: 0.82em;
  font-weight: 500;
  color: #bbc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nge-all-segid {
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.62em;
  color: rgba(74, 158, 255, 0.35);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Tags */
.nge-all-tag {
  flex-shrink: 0;
  font-size: 0.58em;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}
.nge-all-tag--done {
  background: rgba(127, 255, 136, 0.1);
  color: #7f8;
}
.nge-all-tag--claimed {
  background: rgba(255, 180, 50, 0.08);
  color: #daa040;
}
.nge-all-tag--mine {
  background: rgba(255, 215, 0, 0.12);
  color: #FFD700;
}

/* Slide transition */
.nge-all-slide-enter-active {
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
}
.nge-all-slide-leave-active {
  transition: transform 0.15s ease-in, opacity 0.15s ease-in;
}
.nge-all-slide-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}
.nge-all-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

/* ══════════════════════════════════════════════
   PROGRESS, CARD, INPUTS (shared)
   ══════════════════════════════════════════════ */

.nge-quest-progress { margin-bottom: 10px; }

.nge-quest-progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
}

.nge-quest-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4285f4, #CE93D8);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.nge-quest-progress-text {
  font-size: 0.7em;
  color: #556;
  text-align: center;
}

/* Quest card */
.nge-quest-card {
  background: rgba(74, 158, 255, 0.03);
  border: 1px solid rgba(74, 158, 255, 0.1);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  transition: all 0.2s;
}

.nge-quest-card--done {
  opacity: 0.5;
  border-color: rgba(127, 255, 136, 0.2);
  background: rgba(127, 255, 136, 0.02);
}

.nge-quest-card--active {
  border-color: rgba(206, 147, 216, 0.25);
  background: rgba(206, 147, 216, 0.03);
}

.nge-quest-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.nge-quest-badge {
  font-size: 0.62em;
  padding: 1px 7px;
  border-radius: 6px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.nge-quest-badge--done {
  background: rgba(127, 255, 136, 0.1);
  border: 1px solid rgba(127, 255, 136, 0.2);
  color: #7f8;
}

.nge-quest-badge--active {
  background: rgba(206, 147, 216, 0.1);
  border: 1px solid rgba(206, 147, 216, 0.2);
  color: #CE93D8;
}

.nge-quest-badge--new {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #667;
}

.nge-quest-seg-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.nge-quest-copy {
  background: none;
  border: none;
  font-size: 0.72em;
  cursor: pointer;
  padding: 1px 3px;
  opacity: 0.4;
  transition: opacity 0.12s;
}
.nge-quest-copy:hover { opacity: 0.8; }

.nge-quest-seg-jump {
  font-size: 0.7em;
  opacity: 0.4;
  transition: opacity 0.12s;
}
.nge-quest-nickname:hover .nge-quest-seg-jump { opacity: 0.8; }

.nge-quest-notes {
  font-size: 0.78em;
  color: #889;
  font-style: italic;
  line-height: 1.4;
  margin-bottom: 6px;
}

/* Input fields */
.nge-quest-field { margin-top: 8px; }

.nge-quest-label {
  display: block;
  font-size: 0.68em;
  font-weight: 600;
  color: #778;
  margin-bottom: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nge-quest-req { color: #f66; }
.nge-quest-opt { font-weight: 400; color: #445; text-transform: none; letter-spacing: 0; }

.nge-quest-field-row {
  display: flex;
  gap: 5px;
}

.nge-quest-input {
  flex: 1;
  padding: 6px 9px;
  border: 1px solid rgba(74, 158, 255, 0.15);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #dde;
  font-size: 0.82em;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  outline: none;
  transition: border-color 0.12s;
}
.nge-quest-input:focus { border-color: rgba(74, 158, 255, 0.4); }
.nge-quest-input--error { border-color: rgba(255, 100, 100, 0.4) !important; }
.nge-quest-input--error:focus { border-color: rgba(255, 100, 100, 0.6) !important; }
.nge-quest-input::placeholder { color: #334; }

.nge-quest-field-error {
  font-size: 0.7em;
  color: #f66;
  margin-top: 3px;
  padding-left: 2px;
}

.nge-quest-label-hint {
  font-weight: 400;
  font-size: 0.82em;
  color: #556;
  text-transform: none;
  letter-spacing: 0;
  margin-left: 6px;
  cursor: help;
}

.nge-quest-btn-claim {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #CE93D8, #AB47BC);
  color: #fff;
  font-size: 0.78em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.nge-quest-btn-claim:disabled { opacity: 0.35; cursor: default; }

.nge-quest-btn-jump {
  padding: 6px 12px;
  border: 1px solid rgba(74, 158, 255, 0.25);
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.06);
  color: #8bf;
  font-size: 0.78em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.nge-quest-btn-jump:hover { background: rgba(74, 158, 255, 0.14); }

/* Done info */
.nge-quest-done-info {
  font-size: 0.75em;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  color: #667;
  margin-top: 4px;
}
.nge-quest-done-lbl {
  display: inline-block;
  width: 38px;
  color: #556;
  font-weight: 600;
}

/* Complete button */
.nge-quest-complete {
  width: 100%;
  padding: 9px;
  border: none;
  border-radius: 8px;
  background: rgba(80, 80, 80, 0.2);
  color: #556;
  font-size: 0.88em;
  font-weight: 700;
  font-family: inherit;
  cursor: default;
  margin-bottom: 10px;
  transition: all 0.2s;
}

.nge-quest-complete--ready {
  background: linear-gradient(135deg, rgba(76, 175, 80, 0.75), rgba(56, 142, 60, 0.85));
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(76, 175, 80, 0.2);
}
.nge-quest-complete--ready:hover {
  filter: brightness(1.08);
  box-shadow: 0 4px 16px rgba(76, 175, 80, 0.3);
}

/* Navigation */
.nge-quest-nav {
  display: flex;
  gap: 5px;
  margin-bottom: 8px;
}

.nge-quest-nav-btn {
  flex: 1;
  padding: 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  color: #889;
  font-size: 0.78em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}
.nge-quest-nav-btn:hover { background: rgba(74, 158, 255, 0.08); color: #aab; }

.nge-quest-nav-btn--skip {
  border-color: rgba(206, 147, 216, 0.12);
  color: #a98;
}

/* Footer */
.nge-quest-footer {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.nge-quest-footer-btn {
  padding: 3px 8px;
  border: none;
  background: none;
  color: #445;
  font-size: 0.68em;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.12s;
}
.nge-quest-footer-btn:hover { color: #778; }

/* Holographic materialize transitions */
.nge-quest-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.nge-quest-leave-active {
  transition: all 0.18s ease-in;
}
.nge-quest-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.97);
  filter: blur(6px) brightness(2);
  box-shadow: 0 0 60px rgba(0, 180, 255, 0.3);
}
.nge-quest-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  filter: blur(4px) brightness(1.5);
}
</style>
