<script setup lang="ts">
import { ARCADE_ENABLED } from '../util/arcade';
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
  useUserPreferencesStore,
  CellHistoryEntry,
} from '../store';
import { pumpkinSeason, togglePumpkin, smashPumpkins } from '../util/pumpkin';
import { setCellComplete, activeCaveServer, getLastCompletionProblem } from '../widgets/lightbulb_service';
import { StatusMessage } from 'neuroglancer/status';
import { CONNECTOME_QUEST_RESOURCES } from '../data/connectome-quest';
import { collectKeys, warnKeyClashes, isKeysQuery, KEY_GROUPS, type KeyGroup } from '../util/key_list';

const emit = defineEmits({
  'open-profile': null,
  'open-recap': null,
  'open-leaderboard': null,
  'open-dataset-stats': null,
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
  /** For keys: Moving around, Editing, Tools or Panels. */
  keyGroup?: KeyGroup;
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
    id: 'open-dataset-stats',
    label: 'Open Dataset Stats',
    description: 'Cells finished, by week and by type, for each dataset',
    category: 'navigate',
    icon: '🧭',
    action: () => emit('open-dataset-stats'),
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
    shortcut: 'Shift+L',
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
    id: 'tag-mode',
    label: 'Scout Tag Mode',
    description: 'Flag mergers and missing branches (Shift+T)',
    category: 'tool',
    icon: '⚑',
    shortcut: 'Shift+T',
    aliases: ['tag', 'scout', 'flag', 'merger', 'hairball', 'snip', 'extension'],
    action: () => document.dispatchEvent(new CustomEvent('nge:toggle-tag-mode')),
  });
  items.push({
    id: 'photo-mode',
    label: 'Photo Mode',
    description: 'Hide everything, spin the 3D view, save a picture or a spin',
    category: 'tool',
    icon: '📷',
    aliases: ['photo', 'picture', 'spin', 'turntable', 'video', 'record', 'wallpaper'],
    action: () => document.dispatchEvent(new CustomEvent('nge:photo-mode')),
  });
  if (pumpkinSeason()) {
    const prefs = useUserPreferencesStore();
    const hidden = prefs.prefs.hidePumpkin === true;
    items.push({
      id: 'pumpkin',
      label: hidden ? 'Show the Pumpkin' : 'Hide the Pumpkin',
      description: hidden ? "Put the jack o' lantern back on the Sandbox cell" : "Take the jack o' lantern off the Sandbox cell",
      category: 'tool',
      icon: '🎃',
      aliases: ['pumpkin', 'jack', 'lantern', 'halloween', 'remove pumpkin'],
      action: () => togglePumpkin(),
    });
    items.push({
      id: 'smash-pumpkins',
      label: 'Smash the Pumpkins',
      description: 'Off to the Sandbox pumpkin patch with a hammer',
      category: 'tool',
      icon: '🔨',
      aliases: ['smash', 'hammer', 'smash pumpkins', 'break', 'pumpkin'],
      action: () => smashPumpkins(),
    });
  }
  if (ARCADE_ENABLED) items.push({
    id: 'pyr-arcade',
    label: 'Pyr Arcade',
    description: 'Play Neuron Tetris',
    category: 'tool',
    icon: '🕹️',
    aliases: ['arcade', 'game', 'games', 'tetris', 'play', 'fun'],
    action: () => document.dispatchEvent(new CustomEvent('nge:open-arcade')),
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
  // The rest of the top bar's icons, so each is within reach even for a new
  // player who has not received it yet (util/toolbar_staging.ts). Each runs
  // the icon's own action in ExtensionBar.
  const toolbarItem = (id: string, label: string, description: string, icon: string, aliases: string[], shortcut?: string) => items.push({
    id: `toolbar-${id}`, label, description, category: 'tool' as const, icon, ...(shortcut ? { shortcut } : {}), aliases,
    action: () => document.dispatchEvent(new CustomEvent('nge:toolbar-action', { detail: { id } })),
  });
  toolbarItem('findPath', 'Find Path', 'Draw the route through a cell between two points', '🛤️', ['find path', 'path', 'route', 'trace'], 'F');
  toolbarItem('highlight', 'Highlight Mode', 'Mark the parts of a cell you have checked', '🖍️', ['highlight', 'checked', 'mark', 'paint'], 'Shift+H');
  toolbarItem('lantern', 'Lantern', 'Light the cell around where you are and dim the rest', '🏮', ['lantern', 'light', 'dim', 'focus'], 'Shift+N');
  toolbarItem('undelete', 'Undelete', 'Bring back a cell you removed from view', '↩️', ['undelete', 'undo', 'restore', 'bring back'], 'Ctrl+Z');
  toolbarItem('batch', 'Batch Processor', 'Work on many cells at once', '📦', ['batch', 'many cells', 'bulk']);
  toolbarItem('layers', 'Layer Side Panel', 'Open or close the layer side panel', '🗂️', ['layers', 'layer list', 'side panel']);
  toolbarItem('notif', 'Notifications', 'Open your notifications', '🔔', ['notifications', 'bell', 'alerts', 'inbox']);
  toolbarItem('chat', 'Chat', 'Talk with the Pyr community', '💬', ['chat', 'message', 'talk', 'community']);
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
          (x: any) => String(x.layer?.type || '').startsWith('segmentation'),   // by the layer's own type: class names are renamed in the production build
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
  // The old Proofreading Guide is gone from here and the menu (Ames
  // 2026-10-16): it no longer matches Pyr.
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

  // ── Keys (util/key_list.ts) ──
  // Every key a player can press, read from neuroglancer's live bindings, the
  // custom keybinds, the shortcut fields above and Pyr's hand listed window
  // handlers. Typing "keys" or "?" lists them all, by group.
  try {
    const viewer = (window as any)['viewer'];
    const commandKeys = items.filter(i => i.shortcut).map(i => ({ id: i.id, label: i.label, shortcut: i.shortcut!, category: i.category }));
    for (const row of collectKeys(viewer, commandKeys)) {
      const runs = row.runId && items.find(i => i.id === row.runId);
      items.push({
        id: row.id,
        label: row.label,
        description: row.where ? `${row.group}, ${row.where}` : row.group,
        category: 'shortcut',
        keyGroup: row.group,
        icon: '⌨️',
        shortcut: row.keys.length === 2 ? row.keys.join(' or ') : row.keys.join(' '),
        aliases: ['key', 'keys', 'shortcut', row.group.toLowerCase(), ...row.keys.map(k => k.toLowerCase())],
        action: runs ? runs.action : () => { close(); pressKey(row.strokes[0], row.where); },
      });
    }
  } catch (e) {
    console.warn('[cmdPalette] key list failed:', e);
  }

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
    const caveServer = annotStore.caveUrl || activeCaveServer();
    const ok = await setCellComplete(caveServer, seg, true);
    if (!ok && getLastCompletionProblem()) StatusMessage.showTemporaryMessage(getLastCompletionProblem(), 6000);
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
      (x: any) => String(x.layer?.type || '').startsWith('segmentation'),   // by the layer's own type: class names are renamed in the production build
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
    if (el instanceof HTMLElement) el.focus({ preventScroll: true });
    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  }
}

/** Press a key for the player, from the key list: on the view the key works
 *  in, so neuroglancer's view keys, its global keys and Pyr's window handlers
 *  all see it. `stroke` is neuroglancer's form, e.g. 'control+keyz'. */
function pressKey(stroke: string, where?: string) {
  const viewer = (window as any)['viewer'];
  const parts = stroke.split('+');
  const key = parts.pop()!;
  const code = key.replace(/^(key|digit|arrow)(.)/, (_m, a, c) => a.charAt(0).toUpperCase() + a.slice(1) + c.toUpperCase());
  const ch = /^key[a-z]$/.test(key) ? key.slice(3) : /^digit\d$/.test(key) ? key.slice(5)
    : ({ comma: ',', period: '.', slash: '/', bracketleft: '[', bracketright: ']', space: ' ', escape: 'Escape', delete: 'Delete' } as Record<string, string>)[key] ?? code;
  const shift = parts.includes('shift');
  const panels = [...document.querySelectorAll('.neuroglancer-rendered-data-panel')] as HTMLElement[];
  const panel = where === '3D' ? panels.find(p => p.classList.contains('nge-3d-panel'))
    : panels.find(p => !p.classList.contains('nge-3d-panel'));
  const target = panel || panels[0] || viewer?.element || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: shift && ch.length === 1 ? (ch === '/' ? '?' : ch.toUpperCase()) : ch,
    code: code.charAt(0).toUpperCase() + code.slice(1),
    ctrlKey: parts.includes('control'), shiftKey: shift, altKey: parts.includes('alt'), metaKey: parts.includes('meta'),
    bubbles: true, cancelable: true,
  }));
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
  if (isKeysQuery(q)) return all.filter(i => i.category === 'shortcut');
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
// Dev and test sites: warn when two handlers take the same key.
onMounted(() => warnKeyClashes(() => (window as any)['viewer'], () => buildActions()
  .filter(i => i.shortcut && i.category !== 'shortcut')
  .map(i => ({ id: i.id, label: i.label, shortcut: i.shortcut!, category: i.category }))));
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
    case 'keys:Moving around': case 'keys:Editing': case 'keys:Tools': case 'keys:Panels':
      return 'KEYS: ' + cat.slice(5).toUpperCase();
    default: return cat.toUpperCase();
  }
}

// Group results by category for display
const groupedResults = computed(() => {
  const groups: { category: string; items: PaletteItem[] }[] = [];
  let lastCat = '';
  for (const item of results.value) {
    const cat = item.keyGroup ? `keys:${item.keyGroup}` : item.category;
    if (cat !== lastCat) {
      groups.push({ category: cat, items: [] });
      lastCat = cat;
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

/** Every key, grouped as Moving around, Editing, Tools and Panels, for the
 *  Keys list in the Ask dock. Plain data; run a row with runCommandById(). */
function listKeys() {
  try {
    const rows = buildActions().filter(i => i.keyGroup);
    return KEY_GROUPS.map(group => ({
      group,
      rows: rows.filter(r => r.keyGroup === group).map(r => ({ id: r.id, label: r.label, keys: r.shortcut || '', description: r.description })),
    })).filter(g => g.rows.length);
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
defineExpose({ open, close, toggle, commandCatalog, searchCommands, runCommandById, listKeys });
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
