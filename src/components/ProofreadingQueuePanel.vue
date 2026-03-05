<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useProofreadingQueueStore, useCellHistoryStore, useUserStatsStore } from '../store';
import { setCellComplete } from '../widgets/lightbulb_service';
import { EYEWIRE_II_CAVE_CONFIG } from '../config';

const queue = useProofreadingQueueStore();
const history = useCellHistoryStore();
const emit = defineEmits({ hide: null });

// Always re-fetch the sheet when the Quest Board opens (picks up new segIDs)
onMounted(() => {
  if (queue.sheetUrl) queue.loadFromSheet();
});

const sheetInput = ref(queue.sheetUrl || '');

// ── View mode: 'daily' (3 quests/day) or 'all' (full list) ──────────
const viewMode = ref<'daily' | 'all'>('daily');

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

/** The 3 daily quest items (indices into queue.items). */
const dailyQuestIndices = computed(() => {
  const total = queue.items.length;
  if (total === 0) return [];
  const seed = dateSeed(todayStr.value + (queue.sheetUrl || ''));
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

const dailyQuests = computed(() =>
  dailyQuestIndices.value.map(idx => queue.items[idx]),
);

const dailyComplete = computed(() =>
  dailyQuests.value.every(item => queue.proofread.has(item.segId)),
);

const dailyProgress = computed(() => {
  if (dailyQuests.value.length === 0) return 0;
  const done = dailyQuests.value.filter(i => queue.proofread.has(i.segId)).length;
  return done;
});

// Re-show celebration when a new daily set completes
watch(dailyComplete, (val) => {
  if (val) celebrationDismissed.value = false;
});

/** Jump to a daily quest by its index in dailyQuests. */
function selectDailyQuest(idx: number) {
  const queueIdx = dailyQuestIndices.value[idx];
  if (queueIdx !== undefined) {
    queue.jumpToIndex(queueIdx);
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

  queue.markProofread(item.segId);

  // Track quest completion in daily log for streak chart
  const statsStore = useUserStatsStore();
  statsStore.logDailyQuestComplete();

  // In daily mode, stay on daily quests. In all mode, advance to next unproofread.
  if (viewMode.value === 'all') {
    queue.nextUnproofread();
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
  queue.nextUnproofread();
}

/** Jump to a specific item from the all-tasks list. */
function jumpToItem(idx: number) {
  queue.jumpToIndex(idx);
  viewMode.value = 'daily'; // switch back to card view to work on it
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
      <div class="nge-quest-board" :style="panelStyle">

        <div class="nge-quest-topbar" @mousedown="startDrag" :class="{ 'nge-quest-dragging': isDragging }">
          <div class="nge-quest-title">
            <span class="nge-quest-icon">🧠</span> Quest Board
          </div>
          <div class="nge-quest-topbar-actions">
            <!-- View toggle: daily vs all -->
            <button
              v-if="queue.items.length > 0"
              class="nge-quest-view-toggle"
              @click="viewMode = viewMode === 'daily' ? 'all' : 'daily'"
              :title="viewMode === 'daily' ? 'View all tasks' : 'Back to daily quests'"
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
             ALL TASKS VIEW — scrollable list of every neuron
             ═══════════════════════════════════════════════════════════ -->
        <div v-else-if="viewMode === 'all'" class="nge-quest-content">
          <div class="nge-quest-all-header">
            All Neurons · {{ queue.proofreadCount() }}/{{ queue.totalCount() }} done
          </div>
          <div
            v-for="(item, idx) in queue.items"
            :key="item.segId"
            class="nge-quest-all-row"
            :class="{
              'nge-quest-all-row--done': queue.proofread.has(item.segId),
              'nge-quest-all-row--current': queue.currentIdx === idx,
            }"
            @click="jumpToItem(idx)"
          >
            <span class="nge-quest-all-pip" :class="{
              'nge-quest-all-pip--done': queue.proofread.has(item.segId),
            }"></span>
            <span class="nge-quest-all-name">{{ getNickname(item.segId) }}</span>
            <span class="nge-quest-all-id">{{ truncateId(item.segId) }}</span>
          </div>
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
              <button class="nge-quest-celebration-btn nge-quest-celebration-btn--more"
                      @click="takeOnMoreQuests">
                Take on More Quests
              </button>
              <button class="nge-quest-celebration-btn nge-quest-celebration-btn--close"
                      @click="emit('hide')">
                Close Board
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
            <button class="nge-quest-footer-btn" @click="queue.clearProofread()">Reset</button>
          </div>
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
   ALL-TASKS LIST VIEW
   ══════════════════════════════════════════════ */

.nge-quest-all-header {
  font-size: 0.78em;
  font-weight: 600;
  color: rgba(0, 200, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(74, 158, 255, 0.08);
}

.nge-quest-all-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s;
  border: 1px solid transparent;
}
.nge-quest-all-row:hover {
  background: rgba(74, 158, 255, 0.05);
}
.nge-quest-all-row--current {
  border-color: rgba(206, 147, 216, 0.2);
  background: rgba(206, 147, 216, 0.04);
}
.nge-quest-all-row--done { opacity: 0.5; }

.nge-quest-all-pip {
  flex-shrink: 0;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: 1.5px solid rgba(255, 255, 255, 0.15);
}
.nge-quest-all-pip--done {
  background: rgba(127, 255, 136, 0.3);
  border-color: rgba(127, 255, 136, 0.5);
}

.nge-quest-all-name {
  font-size: 0.82em;
  font-weight: 600;
  color: #bbc;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nge-quest-all-id {
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.62em;
  color: #445;
  flex-shrink: 0;
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
