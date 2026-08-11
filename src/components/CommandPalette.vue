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
import { setCellComplete } from '../widgets/lightbulb_service';
import { EYEWIRE_II_CAVE_CONFIG } from '../config';
import { CONNECTOME_QUEST_RESOURCES } from '../data/connectome-quest';

const emit = defineEmits({
  'open-profile': null,
  'open-recap': null,
  'open-leaderboard': null,
  'open-settings': null,
  'open-help': null,
  'open-queue': null,
  'open-feed': null,
  'open-dataset-selector': null,
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
  category: 'action' | 'navigate' | 'cell' | 'tool' | 'help' | 'shortcut';
  icon: string;
  shortcut?: string;
  action: () => void;
  /** If true, only show when a segment is selected */
  requiresSeg?: boolean;
  /** Extra search terms that match this item */
  aliases?: string[];
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
      action: () => { markActiveSegmentComplete(); close(); },
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
      action: () => { close(); emit('open-help'); },
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
    label: 'Brain Quest',
    description: queueStore.totalCount() ? `${queueStore.proofreadCount()}/${queueStore.totalCount()} done · 3 daily quests` : 'Load a quest sheet',
    category: 'navigate',
    icon: '🧠',
    action: () => emit('open-queue'),
  });
  items.push({
    id: 'open-cells',
    label: 'Cell Library',
    description: 'Browse all cells, claim and complete',
    category: 'navigate',
    icon: '🧬',
    action: () => emit('open-cells'),
  });
  items.push({
    id: 'open-feed',
    label: 'Activity Feed',
    description: 'Live community proofreading activity',
    category: 'navigate',
    icon: '📡',
    action: () => emit('open-feed'),
  });
  items.push({
    id: 'open-settings',
    label: 'Profile Settings',
    description: 'Flag, bio, preferences',
    category: 'navigate',
    icon: '⚙',
    action: () => emit('open-settings'),
  });
  items.push({
    id: 'open-dataset-selector',
    label: 'Switch Dataset',
    description: 'Switch between stroeh retina, pinky, minnie65',
    category: 'navigate',
    icon: '🗄',
    shortcut: 'Ctrl+D',
    aliases: ['dataset', 'volume', 'retina', 'stroeh', 'pinky', 'minnie', 'switch'],
    action: () => emit('open-dataset-selector'),
  });

  // ── Tools ──
  items.push({
    id: 'tool-merge',
    label: 'Merge Tool',
    description: 'Activate merge mode — join two segments',
    category: 'tool',
    icon: '🔗',
    shortcut: 'M',
    aliases: ['merge', 'join', 'connect', 'merge segments'],
    action: () => activateTool('merge'),
  });
  items.push({
    id: 'tool-cut',
    label: 'Cut Tool',
    description: 'Activate multicut mode — separate a segment',
    category: 'tool',
    icon: '✂️',
    shortcut: 'C',
    aliases: ['cut', 'split', 'multicut', 'separate', 'divide'],
    action: () => activateTool('multicut'),
  });
  items.push({
    id: 'tool-undo',
    label: 'Undo',
    description: 'Undo last action',
    category: 'tool',
    icon: '↩️',
    shortcut: 'Ctrl+Z',
    action: () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
    },
  });
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
  items.push({
    id: 'copy-position',
    label: 'Copy Viewer Position',
    description: 'Copy current x, y, z coordinates',
    category: 'tool',
    icon: '📍',
    action: () => {
      try {
        const viewer = (window as any)['viewer'];
        const pos = viewer?.navigationState?.position?.value;
        if (pos) {
          const s = `${Math.round(pos[0])}, ${Math.round(pos[1])}, ${Math.round(pos[2])}`;
          navigator.clipboard.writeText(s);
        }
      } catch {}
    },
  });
  items.push({
    id: 'toggle-3d',
    label: 'Toggle 3D Panel',
    description: 'Show/hide the 3D perspective view',
    category: 'tool',
    icon: '🔲',
    action: () => {
      try {
        const btn = document.querySelector('button[title*="3-d"]') as HTMLButtonElement
          || document.querySelector('.neuroglancer-3d-button') as HTMLButtonElement;
        if (btn) btn.click();
      } catch {}
    },
  });

  // ── Help & Learning ──
  items.push({
    id: 'help-proofread-guide',
    label: 'Proofreading Guide',
    description: 'How to proofread neurons — blog post',
    category: 'help',
    icon: '📖',
    aliases: ['guide', 'tutorial', 'how to', 'proofreading', 'help', 'learn'],
    action: () => window.open('https://blog.pyr.ai/2024/12/20/proofreading-101-climb-into-spelunker/', '_blank'),
  });
  items.push({
    id: 'help-merge-video',
    label: 'Merge Video Tutorial',
    description: 'Watch how to merge segments — YouTube',
    category: 'help',
    icon: '▶️',
    aliases: ['merge', 'video', 'tutorial', 'how to merge'],
    action: () => window.open('https://youtu.be/48GS9Sizrvw', '_blank'),
  });
  items.push({
    id: 'help-split-video',
    label: 'Split Video Tutorial',
    description: 'Watch how to cut/split segments — YouTube',
    category: 'help',
    icon: '▶️',
    aliases: ['split', 'cut', 'video', 'tutorial', 'how to split', 'how to cut'],
    action: () => window.open('https://youtu.be/DB6wmQWGsck', '_blank'),
  });
  items.push({
    id: 'help-findpath-video',
    label: 'Find Path Video Tutorial',
    description: 'Watch how to use Find Path — YouTube',
    category: 'help',
    icon: '▶️',
    aliases: ['find path', 'path', 'video', 'tutorial'],
    action: () => window.open('https://youtu.be/CGooeAhSryg', '_blank'),
  });
  items.push({
    id: 'help-forum',
    label: 'EyeWire Forum',
    description: 'Community discussion board',
    category: 'help',
    icon: '💬',
    aliases: ['forum', 'community', 'discuss', 'questions', 'ask'],
    action: () => window.open('https://forum.eyewire.org', '_blank'),
  });
  // connectome.quest resources (shared catalog, also shown in the Help tab
  // and the Nurro dock).
  for (const res of CONNECTOME_QUEST_RESOURCES) {
    items.push({
      id: res.id,
      label: res.label,
      description: res.description,
      category: 'help',
      icon: res.icon,
      aliases: res.aliases,
      action: () => window.open(res.url, '_blank'),
    });
  }

  // ── Keyboard Shortcuts (dynamically from neuroglancer + curated labels) ──
  const FRIENDLY_NAMES: Record<string, { label: string; icon: string; aliases?: string[] }> = {
    'recolor':                      { label: 'Recolor Segments', icon: '🎨', aliases: ['colors', 'randomize'] },
    'clear-segments':               { label: 'Clear All Segments', icon: '🧹', aliases: ['deselect', 'hide'] },
    'toggle-show-slices':           { label: 'Toggle Slices', icon: '🔍', aliases: ['cross section', 'slices'] },
    'toggle-scale-bar':             { label: 'Toggle Scale Bar', icon: '📏', aliases: ['ruler', 'measurement'] },
    'toggle-default-annotations':   { label: 'Toggle Annotations', icon: '📌', aliases: ['pins', 'markers'] },
    'toggle-axis-lines':            { label: 'Toggle Axis Lines', icon: '➕', aliases: ['grid', 'axes'] },
    'toggle-orthographic-projection': { label: 'Toggle Orthographic', icon: '🔲', aliases: ['perspective', 'ortho'] },
    'toggle-layout':                { label: 'Toggle Layout', icon: '⊞', aliases: ['panels', 'arrangement'] },
    'toggle-layout-alternative':    { label: 'Toggle Layout (Alt)', icon: '⊞' },
    'toggle-show-statistics':       { label: 'Toggle Statistics', icon: '📊', aliases: ['stats', 'gpu', 'performance'] },
    'help':                         { label: 'Show All Keyboard Shortcuts', icon: '⌨️', aliases: ['keys', 'keybindings', 'hotkeys', '?'] },
    'add-layer':                    { label: 'Add New Layer', icon: '➕', aliases: ['new layer'] },
    'snap':                         { label: 'Snap to Nearest Section', icon: '🧲', aliases: ['align', 'section'] },
    'zoom-in':                      { label: 'Zoom In', icon: '🔎', aliases: ['magnify', 'closer'] },
    'zoom-out':                     { label: 'Zoom Out', icon: '🔎', aliases: ['shrink', 'farther'] },
    'select':                       { label: 'Select Segment', icon: '👆', aliases: ['pick', 'choose'] },
    'rotate-relative-z-':           { label: 'Rotate View Left', icon: '🔄', aliases: ['rotate'] },
    'rotate-relative-z+':           { label: 'Rotate View Right', icon: '🔄', aliases: ['rotate'] },
    'x-':                           { label: 'Move Left', icon: '⬅️' },
    'x+':                           { label: 'Move Right', icon: '➡️' },
    'y-':                           { label: 'Move Up', icon: '⬆️' },
    'y+':                           { label: 'Move Down', icon: '⬇️' },
    'z-':                           { label: 'Slice Down (Z-)', icon: '⏬', aliases: ['z minus', 'deeper'] },
    'z+':                           { label: 'Slice Up (Z+)', icon: '⏫', aliases: ['z plus', 'shallower'] },
    'move-to-mouse-position':       { label: 'Move to Mouse Position', icon: '🎯', aliases: ['jump', 'center'] },
  };

  // Pure mouse/touch gestures we can't fire from a keyboard event. They
  // still show up in the palette (so users searching "rotate" or "drag"
  // see the right gesture), but clicking them opens the help panel
  // instead of dispatching a key. Anything outside this set is treated
  // as a real keyboard binding and dispatched directly.
  const NON_KEYBOARD_ACTIONS = new Set([
    'rotate-via-mouse-drag', 'translate-via-mouse-drag',
    'zoom-via-wheel', 'adjust-depth-range-via-wheel',
    'z+1-via-wheel', 'z+10-via-wheel',
    'zoom-via-touchpinch',
    'rotate-in-plane-via-touchrotate', 'translate-in-plane-via-touchtranslate',
    'rotate-out-of-plane-via-touchtranslate', 'translate-z-via-touchtranslate',
  ]);

  // Format raw key codes to readable shortcuts
  function formatKey(raw: string): string {
    return raw
      .replace(/\bat:/, '')
      .replace(/\bkey([a-z])/gi, (_, c) => c.toUpperCase())
      .replace(/\bdigit(\d)/g, '$1')
      .replace(/\barrow(up|down|left|right)/gi, (_, d) => d.charAt(0).toUpperCase() + d.slice(1))
      .replace(/\bcontrol\b/g, 'Ctrl')
      .replace(/\bshift\b/g, 'Shift')
      .replace(/\balt\b/g, 'Alt')
      .replace(/\bequal\b/g, '=')
      .replace(/\bminus\b/g, '-')
      .replace(/\bcomma\b/g, ',')
      .replace(/\bperiod\b/g, '.')
      .replace(/\bspace\b/g, 'Space')
      .replace(/\bbackslash\b/g, '\\')
      .replace(/\bbracketleft\b/g, '[')
      .replace(/\bbracketright\b/g, ']')
      .replace(/\bmousedown(\d)\b/g, 'Mouse$1')
      .replace(/\bdblclick(\d)\b/g, 'DblClick')
      .replace(/\+/g, '+');
  }

  // Dynamically read all bindings from the viewer
  try {
    const viewer = (window as any)['viewer'];
    if (viewer?.inputEventBindings) {
      const seen = new Set<string>(); // dedupe by action
      const sources: [string, any][] = [
        ['Global', viewer.inputEventBindings.global],
        ['Slice View', viewer.inputEventBindings.sliceView],
        ['3D View', viewer.inputEventBindings.perspectiveView],
      ];

      for (const [group, eventMap] of sources) {
        if (!eventMap?.bindings) continue;
        // Walk the map and its parents — same traversal the help panel
        // uses (`?`), so the palette ends up with the same set of bindings.
        const walkMap = (map: any) => {
          if (!map?.bindings) return;
          for (const [event, eventAction] of map.bindings.entries()) {
            const action = typeof eventAction === 'string' ? eventAction : eventAction?.action;
            if (!action) continue;

            const dedupeKey = action;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const rawKey = event.replace(/^[^:]*:/, ''); // strip "at:" prefix
            const shortcutStr = formatKey(rawKey);
            const friendly = FRIENDLY_NAMES[action];
            const label = friendly?.label || action.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const icon = friendly?.icon || '⌨️';

            const isMouseGesture = NON_KEYBOARD_ACTIONS.has(action) ||
              event.includes('touch') || event.includes('wheel') ||
              event.includes('mouse') || event.includes('drag');

            items.push({
              id: `shortcut-${action}`,
              label,
              description: isMouseGesture ? `${group} mouse/touch gesture` : `${group} shortcut`,
              category: 'shortcut',
              icon: isMouseGesture ? '🖱' : icon,
              shortcut: shortcutStr,
              aliases: [
                action, action.replace(/-/g, ' '),
                ...(friendly?.aliases || []),
              ],
              action: action === 'help'
                ? () => { close(); try { viewer.toggleHelpPanel?.(); } catch {} }
                : isMouseGesture
                  ? () => { close(); try { viewer.toggleHelpPanel?.(); } catch {} }
                  : () => {
                      close();
                      // Dispatch the original key event
                      const parts = rawKey.split('+');
                      const keyPart = parts[parts.length - 1];
                      const code = keyPart.startsWith('key') ? keyPart.charAt(0).toUpperCase() + keyPart.slice(1)
                        : keyPart.startsWith('digit') ? keyPart.charAt(0).toUpperCase() + keyPart.slice(1)
                        : keyPart.charAt(0).toUpperCase() + keyPart.slice(1);
                      document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: keyPart.replace(/^key/, '').replace(/^digit/, ''),
                        code,
                        ctrlKey: rawKey.includes('control'),
                        shiftKey: rawKey.includes('shift'),
                        altKey: rawKey.includes('alt'),
                        bubbles: true,
                      }));
                    },
            });
          }
          // Walk parents
          if (map.parents) {
            for (const parent of map.parents) {
              walkMap(parent);
            }
          }
        };
        walkMap(eventMap);
      }

      // Tool bindings (Shift+keyX) — what the help panel lists under
      // "Tool bindings for layer ...". These are user-bound tools that
      // act on a specific layer (e.g. Shift+M = merge on segmentation
      // layer). The palette previously skipped tool-* entirely.
      try {
        const toolBinder = viewer.globalToolBinder;
        if (toolBinder?.bindings) {
          for (const [key, tool] of toolBinder.bindings) {
            const id = `tool-binding-${key}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const layerName = tool.context?.managedLayer?.name || tool.context?.constructor?.name || 'layer';
            const desc = tool.description || 'Layer tool';
            items.push({
              id,
              label: desc,
              description: `Tool on ${layerName}`,
              category: 'shortcut',
              icon: '🛠',
              shortcut: `Shift+${key}`,
              aliases: [desc.toLowerCase(), 'tool', layerName.toLowerCase()],
              action: () => {
                close();
                document.dispatchEvent(new KeyboardEvent('keydown', {
                  key: key.toLowerCase(),
                  code: 'Key' + key.toUpperCase(),
                  shiftKey: true,
                  bubbles: true,
                }));
              },
            });
          }
        }
      } catch {}
    }
  } catch {};

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

// ── Mark the selected segment complete ───────────────────────────────────────
// The floating AnnotationPanel (which used to own the ".nge-ann-btn" complete
// button) is disabled — users work from the Cell Library instead — so the old
// "click the DOM button" trick did nothing. Write the CAVE completion directly;
// setCellComplete() handles the annotation write plus the pip update, edit log,
// activity feed, cell history, stats bump and celebration.
const marking = ref(false);
async function markActiveSegmentComplete() {
  const seg = activeSegId.value;
  if (!seg || marking.value) return;
  marking.value = true;
  try {
    const caveServer = annotStore.caveUrl || EYEWIRE_II_CAVE_CONFIG.caveServerOverride || '';
    await setCellComplete(caveServer, seg, true);
  } catch (e) {
    console.warn('[cmdPalette] mark complete failed:', e);
  } finally {
    marking.value = false;
  }
}

// ── Tool activation (same logic as ExtensionBar) ─────────────────────────────
function activateTool(toolType: 'multicut' | 'merge') {
  const viewer = (window as any)['viewer'];
  if (!viewer) return;
  try {
    const segLayer = viewer.layerManager?.managedLayers?.find(
      (x: any) => x.layer?.constructor?.name?.includes('Segmentation'),
    );
    if (segLayer) {
      viewer.selectedLayer.layer = segLayer;
      viewer.selectedLayer.visible = true;
    }
  } catch { /* non-critical */ }
  const key = toolType === 'multicut' ? 'c' : 'm';
  const eventInit: KeyboardEventInit = {
    key, code: key === 'c' ? 'KeyC' : 'KeyM',
    bubbles: true, cancelable: true,
  };
  const targets = [
    viewer.element,
    viewer.display?.container,
    document.getElementById('neuroglancer-container'),
  ].filter(Boolean);
  for (const el of targets) {
    if (el instanceof HTMLElement) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  }
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
    // Show actions + navigation first, then tools, help, then first 8 cells
    const actions = all.filter(i => i.category === 'action');
    const nav = all.filter(i => i.category === 'navigate');
    const tools = all.filter(i => i.category === 'tool');
    const help = all.filter(i => i.category === 'help');
    const cells = all.filter(i => i.category === 'cell').slice(0, 8);
    return [...actions, ...nav, ...tools, ...help, ...cells];
  }
  const q = query.value.trim();
  return all
    .map(item => {
      const aliasScores = (item.aliases || []).map(a => fuzzyScore(a, q));
      return {
        item,
        score: Math.max(
          fuzzyScore(item.label, q),
          fuzzyScore(item.description || '', q),
          fuzzyScore(item.id, q),
          ...aliasScores,
        ),
      };
    })
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
  // NOTE: Ctrl/Cmd+K is no longer handled here. The command palette has been
  // folded into the Ask dock (one surface instead of two, over the same
  // catalog the Guide already consumed), so ExtensionBar binds that shortcut
  // to the dock. This component stays mounted as the headless command
  // PROVIDER — it still owns buildActions(), the neuroglancer keybinding
  // ingestion and the emit wiring to ExtensionBar; only its own UI is retired.
  if (visible.value) return;

  if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.code === 'KeyC')) {
    if (!activeSegId.value) return; // nothing selected — let the browser have it
    e.preventDefault();
    e.stopPropagation();
    markActiveSegmentComplete();
  } else if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    e.preventDefault();
    emit('open-profile');
  } else if (e.ctrlKey && e.shiftKey && e.key === 'L') {
    e.preventDefault();
    emit('open-leaderboard');
  } else if (e.ctrlKey && e.key === 'd') {
    e.preventDefault();
    e.stopPropagation();
    emit('open-dataset-selector');
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
    case 'help': return 'HELP & LEARNING';
    case 'shortcut': return 'KEYBOARD SHORTCUTS';
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

// Metadata-only view of the command list (no action closures), for the AI
// Guide's auto-generated knowledge base. Reuses buildActions() so it stays in
// sync with the real palette.
function commandCatalog() {
  try {
    return buildActions().map((i) => ({
      id: i.id,
      label: i.label,
      description: i.description,
      category: i.category,
      shortcut: i.shortcut,
    }));
  } catch {
    return [];
  }
}

/**
 * Headless search for the Ask dock.
 *
 * Same catalog and same scoring the palette used, minus the palette UI. This
 * is what keeps command execution INSTANT: a query that clearly matches a
 * known command never has to make a round trip to the model.
 *
 * Returns plain data (no closures) so the caller can render it freely; run a
 * result with runCommandById().
 */
function searchCommands(q: string, limit = 8) {
  try {
    const all = buildActions();
    const query = (q || '').trim();
    if (!query) return [];
    return all
      .map((item) => {
        const aliasScores = (item.aliases || []).map((a) => fuzzyScore(a, query));
        return {
          item,
          score: Math.max(
            fuzzyScore(item.label, query),
            fuzzyScore(item.description || '', query),
            fuzzyScore(item.id, query),
            ...aliasScores,
          ),
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({
        id: x.item.id,
        label: x.item.label,
        description: x.item.description,
        category: x.item.category,
        icon: x.item.icon,
        shortcut: x.item.shortcut,
        score: x.score,
      }));
  } catch {
    return [];
  }
}

/** Run a command by id. Returns false when the id is unknown. */
function runCommandById(id: string): boolean {
  try {
    const item = buildActions().find((i) => i.id === id);
    if (!item) return false;
    item.action();
    return true;
  } catch {
    return false;
  }
}

// Expose the headless command API. `open`/`close`/`toggle` are retained so any
// remaining caller still works, but the palette UI is no longer bound to a
// shortcut — the Ask dock is the single entry point.
defineExpose({ open, close, toggle, commandCatalog, searchCommands, runCommandById });
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
  font-size: 16px;
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
  font-size: 11px;
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
  font-size: 14px;
  color: #d0d4dc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nge-cmd-item--selected .nge-cmd-item-label { color: #fff; }

.nge-cmd-item-desc {
  font-size: 12px;
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
