<script setup lang="ts">
/**
 * CommandPalette.vue
 * Power-user command palette (Ctrl+K / Cmd+K).
 * Fuzzy-searches across actions, cells, panels, and tools.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import {
  useCellHistoryStore,
  useSegmentAnnotationStore,
  useUserStatsStore,
  useHelpRequestStore,
  useProofreadingQueueStore,
  CellHistoryEntry,
} from '../store';

const emit = defineEmits({
  'open-profile': null,
  'open-recap': null,
  'open-leaderboard': null,
  'open-settings': null,
  'open-help': null,
  'open-queue': null,
});

const visible = ref(false);
const query = ref('');
const selectedIdx = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

const historyStore = useCellHistoryStore();
const annotStore = useSegmentAnnotationStore();
const statsStore = useUserStatsStore();
const helpStore = useHelpRequestStore();
const { cells: cellHistory } = storeToRefs(historyStore);
const { activeSegId } = storeToRefs(annotStore);

// ── Action definitions ──────────────────────────────────────────────────────
interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  category: 'action' | 'navigate' | 'cell' | 'tool';
  icon: string;
  shortcut?: string;
  action: () => void;
  /** If true, only show when a segment is selected */
  requiresSeg?: boolean;
}

function buildActions(): PaletteItem[] {
  const items: PaletteItem[] = [];
  const segId = activeSegId.value;

  // ── Quick Actions ──
  if (segId) {
    items.push({
      id: 'mark-complete',
      label: 'Mark Segment Complete',
      description: `Toggle completion for ${segId.slice(-8)}`,
      category: 'action',
      icon: '✓',
      shortcut: 'Ctrl+Shift+C',
      action: () => {
        const btn = document.querySelector('.nge-ann-btn') as HTMLButtonElement;
        if (btn) btn.click();
      },
    });
    items.push({
      id: 'set-cell-type',
      label: 'Set Cell Type',
      description: 'Open cell type selector',
      category: 'action',
      icon: '🏷',
      shortcut: 'Ctrl+Shift+T',
      action: () => {
        const toggle = document.querySelector('.nge-ann-type-toggle') as HTMLButtonElement;
        if (toggle) toggle.click();
      },
    });
    items.push({
      id: 'copy-seg-id',
      label: 'Copy Segment ID',
      description: segId,
      category: 'action',
      icon: '📋',
      action: () => navigator.clipboard.writeText(segId),
    });
    items.push({
      id: 'second-opinion',
      label: 'Ask for Second Opinion',
      description: 'Flag this segment for review',
      category: 'action',
      icon: '🔍',
      action: () => {
        const btn = document.querySelector('.nge-ann-help-btn') as HTMLButtonElement;
        if (btn) btn.click();
      },
    });
  }

  // ── Navigation ──
  items.push({
    id: 'open-profile',
    label: 'Open Profile',
    description: 'Stats, badges, cells mapped',
    category: 'navigate',
    icon: '👤',
    shortcut: 'Ctrl+Shift+P',
    action: () => emit('open-profile'),
  });
  items.push({
    id: 'open-leaderboard',
    label: 'Open Leaderboard',
    description: 'Community rankings',
    category: 'navigate',
    icon: '🏆',
    shortcut: 'Ctrl+Shift+L',
    action: () => emit('open-leaderboard'),
  });
  items.push({
    id: 'open-recap',
    label: 'Your Week in Science',
    description: 'Weekly stats recap',
    category: 'navigate',
    icon: '📊',
    action: () => emit('open-recap'),
  });
  items.push({
    id: 'open-help',
    label: 'Second Opinion Requests',
    description: `${helpStore.pending.length} pending`,
    category: 'navigate',
    icon: '🔍',
    action: () => emit('open-help'),
  });
  const queueStore = useProofreadingQueueStore();
  items.push({
    id: 'open-queue',
    label: 'Quest Board',
    description: queueStore.totalCount() ? `${queueStore.pendingCount()} of ${queueStore.totalCount()} quests remaining` : 'Load a quest sheet',
    category: 'navigate',
    icon: '🧠',
    action: () => emit('open-queue'),
  });
  items.push({
    id: 'open-settings',
    label: 'Profile Settings',
    description: 'Flag, bio, preferences',
    category: 'navigate',
    icon: '⚙',
    action: () => emit('open-settings'),
  });

  // ── Tools ──
  items.push({
    id: 'reset-view',
    label: 'Reset Viewer Position',
    description: 'Return to default position',
    category: 'tool',
    icon: '🎯',
    action: () => {
      try {
        const viewer = (window as any)['viewer'];
        viewer?.navigationState?.reset?.();
      } catch {}
    },
  });
  items.push({
    id: 'clear-segments',
    label: 'Clear All Selected Segments',
    description: 'Deselect all visible segments',
    category: 'tool',
    icon: '🧹',
    action: () => {
      try {
        const viewer = (window as any)['viewer'];
        const segLayer = viewer?.layerManager?.managedLayers?.find(
          (x: any) => x.layer?.constructor?.name?.includes('Segmentation'),
        );
        const gs = segLayer?.layer?.displayState?.segmentationGroupState?.value;
        gs?.visibleSegments?.clear?.();
      } catch {}
    },
  });
  items.push({
    id: 'screenshot',
    label: 'Take Screenshot',
    description: 'Capture the current view',
    category: 'tool',
    icon: '📸',
    action: () => {
      try {
        const viewer = (window as any)['viewer'];
        const canvas = viewer?.display?.canvas;
        if (canvas) {
          canvas.toBlob((blob: Blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eyewire-ii-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
          });
        }
      } catch {}
    },
  });

  // ── Cells (from history) ──
  for (const cell of cellHistory.value.slice(0, 30)) {
    items.push({
      id: `cell-${cell.segId}`,
      label: cell.nickname || `Segment …${cell.segId.slice(-10)}`,
      description: [
        cell.isComplete ? '✓ complete' : '',
        cell.cellType || '',
        cell.isFavorite ? '★' : '',
      ].filter(Boolean).join(' · ') || 'No annotation',
      category: 'cell',
      icon: cell.isComplete ? '🟣' : cell.cellType ? '🟢' : '⚪',
      action: () => historyStore.jumpToCell(cell.segId),
    });
  }

  return items;
}

// ── Fuzzy search ──────────────────────────────────────────────────────────────
function fuzzyMatch(text: string, pattern: string): boolean {
  const t = text.toLowerCase();
  const p = pattern.toLowerCase();
  let pi = 0;
  for (let i = 0; i < t.length && pi < p.length; i++) {
    if (t[i] === p[pi]) pi++;
  }
  return pi === p.length;
}

function fuzzyScore(text: string, pattern: string): number {
  const t = text.toLowerCase();
  const p = pattern.toLowerCase();
  // Exact substring match scores highest
  if (t.includes(p)) return 100 - t.indexOf(p);
  // Prefix match
  if (t.startsWith(p)) return 90;
  // Fuzzy — count matched chars
  let pi = 0;
  for (let i = 0; i < t.length && pi < p.length; i++) {
    if (t[i] === p[pi]) pi++;
  }
  return pi === p.length ? pi * 5 : 0;
}

const results = computed(() => {
  const all = buildActions();
  if (!query.value.trim()) {
    // Show actions + navigation first, then tools, then first 8 cells
    const actions = all.filter(i => i.category === 'action');
    const nav = all.filter(i => i.category === 'navigate');
    const tools = all.filter(i => i.category === 'tool');
    const cells = all.filter(i => i.category === 'cell').slice(0, 8);
    return [...actions, ...nav, ...tools, ...cells];
  }
  const q = query.value.trim();
  return all
    .map(item => ({
      item,
      score: Math.max(
        fuzzyScore(item.label, q),
        fuzzyScore(item.description || '', q),
        fuzzyScore(item.id, q),
      ),
    }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.item)
    .slice(0, 20);
});

// Reset selection when results change
watch(results, () => { selectedIdx.value = 0; });

// ── Keyboard handling ──────────────────────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1);
    scrollToSelected();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0);
    scrollToSelected();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = results.value[selectedIdx.value];
    if (item) execute(item);
  } else if (e.key === 'Escape') {
    close();
  }
}

function scrollToSelected() {
  nextTick(() => {
    const el = document.querySelector('.nge-cmd-item--selected');
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function execute(item: PaletteItem) {
  close();
  // Delay action slightly so the palette animation finishes
  setTimeout(() => item.action(), 60);
}

function open() {
  visible.value = true;
  query.value = '';
  selectedIdx.value = 0;
  nextTick(() => inputEl.value?.focus());
}

function close() {
  visible.value = false;
}

function toggle() {
  if (visible.value) close();
  else open();
}

// ── Global keyboard shortcut ──────────────────────────────────────────────────
function globalKeyHandler(e: KeyboardEvent) {
  // Ctrl+K or Cmd+K → command palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    e.stopPropagation();
    toggle();
    return;
  }
  // Shortcuts only when palette is closed
  if (visible.value) return;

  if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    e.preventDefault();
    emit('open-profile');
  } else if (e.ctrlKey && e.shiftKey && e.key === 'L') {
    e.preventDefault();
    emit('open-leaderboard');
  }
}

onMounted(() => document.addEventListener('keydown', globalKeyHandler, true));
onUnmounted(() => document.removeEventListener('keydown', globalKeyHandler, true));

// Category labels
function categoryLabel(cat: string): string {
  switch (cat) {
    case 'action': return 'QUICK ACTIONS';
    case 'navigate': return 'NAVIGATION';
    case 'tool': return 'TOOLS';
    case 'cell': return 'CELLS';
    default: return cat.toUpperCase();
  }
}

// Group results by category for display
const groupedResults = computed(() => {
  const groups: { category: string; items: PaletteItem[] }[] = [];
  let lastCat = '';
  for (const item of results.value) {
    if (item.category !== lastCat) {
      groups.push({ category: item.category, items: [] });
      lastCat = item.category;
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
});

// Expose open/close for parent
defineExpose({ open, close, toggle });
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-cmd-fade">
      <div v-if="visible" class="nge-cmd-backdrop" @click.self="close">
        <div class="nge-cmd-shell" @keydown="handleKeydown">

          <!-- Search input -->
          <div class="nge-cmd-input-wrap">
            <span class="nge-cmd-input-icon">⌘</span>
            <input
              ref="inputEl"
              v-model="query"
              class="nge-cmd-input"
              placeholder="Search actions, cells, tools…"
              spellcheck="false"
              autocomplete="off"
            />
            <kbd class="nge-cmd-esc">ESC</kbd>
          </div>

          <!-- Results list -->
          <div class="nge-cmd-results">
            <template v-if="results.length === 0">
              <div class="nge-cmd-empty">No matches found</div>
            </template>

            <template v-for="group in groupedResults" :key="group.category">
              <div class="nge-cmd-category">{{ categoryLabel(group.category) }}</div>
              <div
                v-for="(item, i) in group.items"
                :key="item.id"
                class="nge-cmd-item"
                :class="{
                  'nge-cmd-item--selected': results.indexOf(item) === selectedIdx,
                }"
                @click="execute(item)"
                @mouseenter="selectedIdx = results.indexOf(item)"
              >
                <span class="nge-cmd-item-icon">{{ item.icon }}</span>
                <div class="nge-cmd-item-text">
                  <div class="nge-cmd-item-label">{{ item.label }}</div>
                  <div class="nge-cmd-item-desc" v-if="item.description">{{ item.description }}</div>
                </div>
                <kbd v-if="item.shortcut" class="nge-cmd-shortcut">{{ item.shortcut }}</kbd>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="nge-cmd-footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>↵</kbd> select</span>
            <span><kbd>esc</kbd> close</span>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Backdrop ── */
.nge-cmd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  backdrop-filter: blur(2px);
}

/* ── Shell ── */
.nge-cmd-shell {
  width: 560px;
  max-height: 480px;
  background: rgba(18, 22, 30, 0.98);
  border: 1px solid rgba(100, 180, 255, 0.2);
  border-radius: 12px;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.65),
    0 0 0 1px rgba(100, 180, 255, 0.06),
    0 0 60px rgba(74, 158, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: nge-cmd-slide 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes nge-cmd-slide {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Input ── */
.nge-cmd-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(100, 180, 255, 0.1);
}

.nge-cmd-input-icon {
  font-size: 16px;
  color: rgba(74, 158, 255, 0.5);
  flex-shrink: 0;
}

.nge-cmd-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: #e0e4ec;
  font-size: 15px;
  font-family: inherit;
  caret-color: rgba(74, 158, 255, 0.8);
}
.nge-cmd-input::placeholder { color: #555; }

.nge-cmd-esc {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: #555;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: inherit;
}

/* ── Results ── */
.nge-cmd-results {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.15) transparent;
}

.nge-cmd-category {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(74, 158, 255, 0.4);
  padding: 10px 18px 4px;
}

.nge-cmd-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 18px;
  cursor: pointer;
  transition: background 0.06s;
}
.nge-cmd-item:hover,
.nge-cmd-item--selected {
  background: rgba(74, 158, 255, 0.08);
}
.nge-cmd-item--selected {
  background: rgba(74, 158, 255, 0.12);
}

.nge-cmd-item-icon {
  font-size: 14px;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.nge-cmd-item-text {
  flex: 1;
  min-width: 0;
}

.nge-cmd-item-label {
  font-size: 13px;
  color: #d0d4dc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nge-cmd-item--selected .nge-cmd-item-label { color: #fff; }

.nge-cmd-item-desc {
  font-size: 11px;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.nge-cmd-item--selected .nge-cmd-item-desc { color: #777; }

.nge-cmd-shortcut {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  color: #666;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}

.nge-cmd-empty {
  text-align: center;
  padding: 32px 20px;
  color: #444;
  font-size: 13px;
  font-style: italic;
}

/* ── Footer ── */
.nge-cmd-footer {
  display: flex;
  gap: 16px;
  padding: 8px 18px;
  border-top: 1px solid rgba(100, 180, 255, 0.08);
  font-size: 10px;
  color: #444;
}
.nge-cmd-footer kbd {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #555;
  font-family: inherit;
  margin-right: 3px;
}

/* ── Transition ── */
.nge-cmd-fade-enter-active { transition: opacity 0.12s ease; }
.nge-cmd-fade-leave-active { transition: opacity 0.08s ease; }
.nge-cmd-fade-enter-from,
.nge-cmd-fade-leave-to { opacity: 0; }
</style>
