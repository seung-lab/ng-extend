<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from "vue";
import VolumesOverlay from "components/VolumesOverlay.vue";
import DropdownList from "components/DropdownList.vue";
import UserProfilePanel from "components/UserProfilePanel.vue";
import LeaderboardPanel from "components/LeaderboardPanel.vue";
import SettingsPanel from "components/SettingsPanel.vue";
import AnnotationPanel from "components/AnnotationPanel.vue";
import LoginModal from "components/LoginModal.vue";
import ProofreadingQueuePanel from "components/ProofreadingQueuePanel.vue";
import CommandPalette from "components/CommandPalette.vue";
import AchievementToast from "components/AchievementToast.vue";
import ActivityFeedPanel from "components/ActivityFeedPanel.vue";
import CellLibraryPanel from "components/CellLibraryPanel.vue";
import ChatPanel from "components/ChatPanel.vue";
import AssistantDock from "components/AssistantDock.vue";
import { runSpotlight } from "../assistant/spotlight";
import BatchProcessorPanel from "components/BatchProcessorPanel.vue";
import FeedbackModal from "components/FeedbackModal.vue";
import NotificationFeedPanel from "components/NotificationFeedPanel.vue";
import DatasetSelectorPanel from "components/DatasetSelectorPanel.vue";
import ScreenshotDialog from "components/ScreenshotDialog.vue";
import UsernamePrompt from "components/UsernamePrompt.vue";
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

import {loginSession, useLoginStore, useVolumesStore, useUserStatsStore, useSegmentAnnotationStore, useHelpRequestStore, useProofreadingQueueStore, useProofreadingBackendStore, useUserPreferencesStore, useDropdownListStore, useChatStore, useLayersStore} from '../store';
import {currentSegLayerName, datasetDisplayName, datasetAbbrev, datasetSpeciesIcon} from '../datasets';
import {useTutorialStore} from '../store-pyr';
import {storeToRefs as storeToRefsAnnot} from 'pinia';
import {storeToRefs} from 'pinia';

import logoImage from '../CaveLogo-clear.png';

const login = useLoginStore();
const tutorialStore = useTutorialStore();
const dropdownStore = useDropdownListStore();

/** Sync the first valid login session to Supabase so userId is set.
 *  Also captures the user's CAVE numeric id (cave_user_id) for the
 *  leaderboard's completions metric — see store.captureCaveUserId.
 *  CAVE token may not be present on first sync (initial load before user
 *  authenticates with daf-apis), so we run captureCaveUserId on every
 *  middleauthlogin event; the function itself is idempotent. */
async function syncFirstSession() {
  const session = login.sessions.find(s => s.status === undefined);
  if (session?.email) {
    const backend = useProofreadingBackendStore();
    if (!backend.userId) {
      await backend.syncUser(session.email, session.name || session.email.split('@')[0]);
      await backend.loadUserStats();
    }
    // Idempotent — early-returns if cave_user_id is already stored or
    // the daf-apis bearer token isn't available yet.
    backend.captureCaveUserId();
  }
}

function closeHamburger() {
  dropdownStore.activeDropdowns['extension-bar-right'] = undefined;
}

/** Pyr-icon click: bypass the browser cache so a freshly-deployed bundle
 *  is picked up without the user hunting for Ctrl+F5. The standard
 *  `location.reload()` API stopped accepting `forceReload` years ago, so
 *  we cache-bust by appending a timestamp to the URL. */
function hardRefresh() {
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString());
  window.location.replace(url.toString());
}
window.addEventListener("middleauthlogin", () => {
  login.update().then(syncFirstSession);
});

// Also sync on initial load (user may already be logged in)
login.update().then(syncFirstSession);

const validLogins = computed(() => login.sessions.filter(x => x.status === undefined));
const invalidLogins = computed(() => login.sessions.filter(x => x.status !== undefined));

const {volumes} = useVolumesStore();

const shareCopied = ref(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
const showScreenshotDialog = ref(false);

/** Share-toast button handlers. The toast normally fades after 2.5s; clicking
 *  any of these cancels the fade, hides the toast immediately, and triggers
 *  the secondary flow. */
function dismissShareToast() {
  if (shareCopiedTimer) {
    clearTimeout(shareCopiedTimer);
    shareCopiedTimer = null;
  }
  shareCopied.value = false;
}
function shareActionScreenshot() {
  dismissShareToast();
  showScreenshotDialog.value = true;
}
function shareActionEmail() {
  dismissShareToast();
  const subject = 'Check out this neuron in EyeWire II';
  const body = `${window.location.href}\n`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function shareActionX() {
  dismissShareToast();
  const text = 'Check out this neuron in EyeWire II';
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`;
  window.open(url, '_blank', 'noopener,width=600,height=520');
}
function shareActionFacebook() {
  dismissShareToast();
  const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`;
  window.open(url, '_blank', 'noopener,width=600,height=520');
}

onMounted(() => {
  // Keep Pyr icon in top-left (don't overwrite with CaveLogo)
  // Clicking a chat announcement opens the notification feed and asks it to
  // surface that specific notification.
  document.addEventListener('nge:open-notification', ((e: CustomEvent) => {
    showNotifications.value = true;
    const id = e.detail?.id;
    if (id != null) {
      // Let the panel mount/refresh before asking it to open the detail view.
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('nge:show-notification-detail', { detail: { id } }));
      }, 150);
    }
  }) as EventListener);

  document.addEventListener('nge:open-profile', ((e: CustomEvent) => {
    profileUserId.value = e.detail?.userId || null;
    // Optional deep-link tab ('triage' opens Admin Hub > Triage, etc.)
    if (e.detail?.tab) profileInitialTab.value = e.detail.tab;
    showProfile.value = true;
  }) as EventListener);

  // Detect Share button click → show "Link copied" toast
  const topBar = document.getElementById('insertNGTopBar');
  if (topBar) {
    topBar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const shareBtn = target.closest('[title*="hare"], [class*="share" i]');
      if (shareBtn) {
        if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
        shareCopied.value = true;
        shareCopiedTimer = setTimeout(() => { shareCopied.value = false; }, 2500);
      }
    });
  }
});

const statsStore = useUserStatsStore();
const { stats } = storeToRefs(statsStore);

// Label the Dataset button with the current dataset instead of the static word
// "Dataset". `activeLayers` (reactive) is touched so this recomputes when the
// user switches datasets; currentSegLayerName reads the non-reactive viewer.
const layersStoreForLabel = useLayersStore();
const currentDatasetName = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  return datasetDisplayName(currentSegLayerName()) || 'Dataset';
});
// Compact "Data: <abbrev>" label + species icon for the top-bar button.
const currentDatasetAbbrev = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  const a = datasetAbbrev(currentSegLayerName());
  return a ? `Data: ${a}` : 'Dataset';
});
const currentDatasetIcon = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  return datasetSpeciesIcon(currentSegLayerName());
});
const { activeSegId } = storeToRefsAnnot(useSegmentAnnotationStore());
const helpStore = useHelpRequestStore();
const chatStore = useChatStore();
const queueStore = useProofreadingQueueStore();

const showModal = ref(false);
const showProfile = ref(false);
const profileUserId = ref<string | null>(null);
// "Your Week in Science" now lives as a tab inside the profile rather than its
// own modal. This tells the profile which tab to open on mount.
const profileInitialTab = ref<string | undefined>(undefined);
function openWeekRecap() {
  profileUserId.value = null;
  profileInitialTab.value = 'weekInScience';
  showProfile.value = true;
}
const showRecap = ref(false);
const showFeedback = ref(false);
const showLeaderboard = ref(false);
const showSettings = ref(false);
const showQueue = ref(false);
const showFeed = ref(false);
/** Chat visibility persists across reloads so closing it stays closed.
 *  Default = open on first visit (key absent in localStorage). */
const CHAT_VISIBLE_KEY = 'nge_chat_visible_v1';
const showChat = ref(localStorage.getItem(CHAT_VISIBLE_KEY) !== '0');
watch(showChat, (v) => {
  try { localStorage.setItem(CHAT_VISIBLE_KEY, v ? '1' : '0'); } catch {}
});
const showCellLibrary = ref(false);
const cellLibraryInitialTab = ref<string | undefined>(undefined);
const showBatchProcessor = ref(false);
const showDatasetSelector = ref(false);
const showNotifications = ref(false);
const cmdPalette = ref<InstanceType<typeof CommandPalette> | null>(null);

/**
 * Bridge the headless command catalog into the Ask dock.
 *
 * CommandPalette stays mounted as the command PROVIDER (it owns buildActions(),
 * the neuroglancer keybinding ingestion and the emit wiring back to this
 * component); the dock is now the only UI. These wrappers are stable function
 * identities so the dock's props don't churn on every render.
 */
function searchCommands(q: string, limit = 6) {
  return (cmdPalette.value as any)?.searchCommands?.(q, limit) ?? [];
}
function runCommandById(id: string): boolean {
  return (cmdPalette.value as any)?.runCommandById?.(id) ?? false;
}

/**
 * Ctrl+K / Cmd+K opens the Ask dock (previously the command palette).
 * Registered in capture phase so it wins against neuroglancer's own keybinder,
 * matching how the Escape handler in main.ts is bound.
 */
function commandKeyHandler(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    e.stopPropagation();
    showAssistant.value = true;
  }
}
onMounted(() => document.addEventListener('keydown', commandKeyHandler, true));
onUnmounted(() => document.removeEventListener('keydown', commandKeyHandler, true));

// ── EyeWire II Guide (AI assistant) ──────────────────────────────────────
const showAssistant = ref(false);
// Best-effort record of the tool mode the assistant last entered, sent back to
// the backend as context. (Direct keyboard tool switches aren't captured.)
const assistantToolMode = ref<'merge' | 'split' | 'findPath' | 'none'>('none');

// Snapshot of UI-only state the AssistantDock can't read itself: which panels
// are open and the current tool. Read fresh on each assistant message.
const assistantUiState = computed(() => {
  const openPanels: string[] = [];
  if (showCellLibrary.value) openPanels.push('cellLibrary');
  if (showLeaderboard.value) openPanels.push('leaderboard');
  if (showNotifications.value) openPanels.push('notifications');
  if (showSettings.value) openPanels.push('settings');
  if (showChat.value) openPanels.push('chat');
  if (showRecap.value) openPanels.push('recap');
  if (showBatchProcessor.value) openPanels.push('batch');
  if (showDatasetSelector.value) openPanels.push('datasetSelector');
  const commandCatalog = (cmdPalette.value as any)?.commandCatalog?.() || [];
  return { openPanels, toolMode: assistantToolMode.value, commandCatalog };
});

function setAssistantPanel(panel: string, open: boolean) {
  switch (panel) {
    case 'cellLibrary': showCellLibrary.value = open; break;
    case 'leaderboard': showLeaderboard.value = open; break;
    case 'notifications': showNotifications.value = open; break;
    case 'settings': showSettings.value = open; break;
    case 'chat': showChat.value = open; break;
    case 'recap': showRecap.value = open; break;
    case 'batch': showBatchProcessor.value = open; break;
    case 'datasetSelector': showDatasetSelector.value = open; break;
  }
}

// Clear the active tool (best-effort: send Escape to the viewer).
function clearToolMode() {
  const viewer: any = (window as any)['viewer'];
  const el = viewer?.element;
  if (el instanceof HTMLElement) {
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
}

// Add a segment to the visible set and recenter on it. Mirrors ChatPanel's
// #SegID pill. Read-only navigation — never edits.
function assistantGoToSegment(segId: string) {
  try {
    const viewer: any = (window as any)['viewer'];
    if (!viewer) return;
    const segLayer = viewer.layerManager?.managedLayers?.find((x: any) => {
      const layer = x.layer;
      if (!layer) return false;
      const cn = layer.constructor?.name || '';
      return cn.includes('Segmentation') || layer.type === 'segmentation';
    });
    if (!segLayer?.layer) return;
    const { Uint64 } = require('neuroglancer/util/uint64');
    const seg = Uint64.parseString(segId);
    const groupState = segLayer.layer.displayState?.segmentationGroupState?.value;
    if (groupState?.visibleSegments && !groupState.visibleSegments.has(seg)) {
      groupState.visibleSegments.add(seg);
    }
    // Recenter via the patched moveToSegment (move_to_segment_patch.ts).
    try { segLayer.layer.moveToSegment?.(seg); } catch { /* non-critical */ }
  } catch (e) {
    console.warn('[assistant] goToSegment failed:', e);
  }
}

// Single listener for allow-listed assistant actions (emitted by
// assistant/actions.ts). This is the only place assistant intent touches app
// state. All actions here are non-destructive.
function handleAssistantAction(e: Event) {
  const detail = (e as CustomEvent).detail || {};
  const { name, args } = detail;
  switch (name) {
    case 'openPanel': setAssistantPanel(args?.panel, true); break;
    case 'closePanel': setAssistantPanel(args?.panel, false); break;
    case 'setToolMode':
      if (args?.mode === 'merge') { activateTool('merge'); assistantToolMode.value = 'merge'; }
      else if (args?.mode === 'split') { activateTool('multicut'); assistantToolMode.value = 'split'; }
      else if (args?.mode === 'findPath') { activateTool('findPath'); assistantToolMode.value = 'findPath'; }
      else { clearToolMode(); assistantToolMode.value = 'none'; }
      break;
    case 'openCommandPalette': cmdPalette.value?.open(); break;
    case 'goToSegment': if (args?.segId) assistantGoToSegment(String(args.segId)); break;
    case 'spotlight': if (args?.target) runSpotlight(String(args.target), args?.note); break;
    case 'startTutorial':
      tutorialStore.activeTutorial = Number(args?.id) || 4;
      tutorialStore.setTutorialStep(Number(args?.step) || 0);
      break;
  }
}

onMounted(() => document.addEventListener('nge:assistant-action', handleAssistantAction as EventListener));
onUnmounted(() => document.removeEventListener('nge:assistant-action', handleAssistantAction as EventListener));
const backendStore = useProofreadingBackendStore();
const { tutorialStep } = storeToRefs(useTutorialStore());

function logout(session: loginSession) {
  login.logout(session);
}

// ── Toolbar icon definitions ──────────────────────────────────
interface ToolbarIcon {
  id: string;
  emoji: string;
  svg?: string;
  img?: string;
  label: string;
  action: () => void;
  badge?: () => number;
}

// ── Toolbar definitions ────────────────────────────────────────────
// Visual icon defs (id, label, emoji, svg, img) live in
// ../data/toolbar-icons so SettingsPanel can render the exact same
// set in its customization grid. Here we only attach the action
// handlers and (where relevant) badge counters.
import { TOOLBAR_ICON_DEFS, resolveToolbarOrder, markInjected } from '../data/toolbar-icons';

// ── Layers: the neuroglancer layer-list panel, driven from our toolbar ──
// The native top-row toggle is hidden in ng-override.css; this icon replaces it
// so it participates in the Settings toolbar prefs like everything else.
// `window['viewer']` is not reactive, so mirror the panel's visibility into a
// Vue ref (subscribing to the neuroglancer signal) to drive the active-state
// underline. The viewer may not exist at mount, so retry attaching.
const layerPanelOpen = ref(false);
let layerPanelWatchable: any = null;
const syncLayerPanelOpen = () => { layerPanelOpen.value = !!layerPanelWatchable?.value; };
function layerListWatchable(): any {
  return (window as any)['viewer']?.layerListPanelState?.location?.watchableVisible ?? null;
}
function toggleLayerListPanel() {
  const w = layerListWatchable();
  if (w) w.value = !w.value;
}
function wireLayerPanelState(attempt = 0) {
  const w = layerListWatchable();
  if (!w) { if (attempt < 12) setTimeout(() => wireLayerPanelState(attempt + 1), 500); return; }
  layerPanelWatchable = w;
  syncLayerPanelOpen();
  w.changed.add(syncLayerPanelOpen);
}
onMounted(() => wireLayerPanelState());
onUnmounted(() => { try { layerPanelWatchable?.changed.remove(syncLayerPanelOpen); } catch { /* ignore */ } });

interface ToolbarAction {
  action: () => void;
  badge?: () => number;
}

const toolbarActions: Record<string, ToolbarAction> = {
  split:       { action: () => activateTool('multicut') },
  merge:       { action: () => activateTool('merge') },
  findPath:    { action: () => activateTool('findPath') },
  layers:      { action: () => toggleLayerListPanel() },
  recap:       { action: () => { openWeekRecap(); } },
  leaderboard: { action: () => { showLeaderboard.value = true; } },
  quest:       { action: () => { showQueue.value = !showQueue.value; }, badge: () => queueStore.pendingCount() },
  cells:       { action: () => { cellLibraryInitialTab.value = undefined; showCellLibrary.value = !showCellLibrary.value; } },
  batch:       { action: () => { showBatchProcessor.value = !showBatchProcessor.value; } },
  // Badge suppressed when the user mutes help requests (Settings → Notifications).
  help:        { action: () => { cellLibraryInitialTab.value = 'help'; showCellLibrary.value = true; }, badge: () => useUserPreferencesStore().prefs.helpMuted ? 0 : helpStore.pending.length },
  feed:        { action: () => { showFeed.value = true; } },
  notif:       { action: () => { showNotifications.value = !showNotifications.value; }, badge: () => backendStore.unreadNotificationCount },
  chat:        { action: () => { showChat.value = !showChat.value; if (showChat.value) chatStore.markRead(); }, badge: () => chatStore.unreadCount },
  settings:    { action: () => { profileInitialTab.value = 'settings'; showProfile.value = true; } },
};

const toolbarDefs = computed<ToolbarIcon[]>(() => {
  return TOOLBAR_ICON_DEFS
    .map(def => {
      const a = toolbarActions[def.id];
      if (!a) return null;
      return {
        id: def.id,
        emoji: def.emoji,
        svg: def.svg,
        img: def.img,
        label: def.label,
        action: a.action,
        badge: a.badge,
      } as ToolbarIcon;
    })
    .filter((x): x is ToolbarIcon => x !== null);
});

// Map icon IDs to their active (open) state
const iconActiveState: Record<string, () => boolean> = {
  layers: () => layerPanelOpen.value,
  recap: () => showProfile.value && profileInitialTab.value === 'weekInScience',
  leaderboard: () => showLeaderboard.value,
  quest: () => showQueue.value,
  cells: () => showCellLibrary.value,
  batch: () => showBatchProcessor.value,
  feed: () => showFeed.value,
  notif: () => showNotifications.value,
  chat: () => showChat.value,
  settings: () => showProfile.value && profileInitialTab.value === 'settings',
};
function isIconActive(id: string): boolean {
  return iconActiveState[id]?.() ?? false;
}

const visibleToolbar = computed(() => {
  const prefs = useUserPreferencesStore().prefs;
  // resolveToolbarOrder handles default-fallback, injecting icons added since
  // the prefs were saved, and dropping retired ids — shared with SettingsPanel
  // so the grid and the real toolbar can't disagree.
  const order = resolveToolbarOrder(prefs.toolbarIcons, prefs.toolbarIconsInjected);
  return order.map(id => toolbarDefs.value.find(d => d.id === id)).filter(Boolean) as ToolbarIcon[];
});

// ── Drag-to-reorder toolbar ─────────────────────────────────────────
// Persists order to `prefs.toolbarIcons` via the user-preferences store.
const dragId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onIconDragStart(e: DragEvent, id: string) {
  if (!e.dataTransfer) return;
  dragId.value = id;
  e.dataTransfer.effectAllowed = 'move';
  // Some browsers require non-empty data
  e.dataTransfer.setData('text/plain', id);
}
function onIconDragEnd() {
  dragId.value = null;
  dragOverId.value = null;
}
function onIconDragOver(e: DragEvent, id: string) {
  if (!dragId.value || dragId.value === id) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverId.value = id;
}
function onIconDragLeave(id: string) {
  if (dragOverId.value === id) dragOverId.value = null;
}
function onIconDrop(e: DragEvent, id: string) {
  e.preventDefault();
  const src = dragId.value;
  dragId.value = null;
  dragOverId.value = null;
  if (!src || src === id) return;
  const prefsStore = useUserPreferencesStore();
  const current = visibleToolbar.value.map(i => i.id);
  const fromIdx = current.indexOf(src);
  const toIdx = current.indexOf(id);
  if (fromIdx < 0 || toIdx < 0) return;
  const next = [...current];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, src);
  // Persist via save() so the injected marker rides along: from this point
  // every auto-inject icon has been offered, and future absence means the
  // user removed it (Celia's "icons don't get removed" bug).
  prefsStore.save({ toolbarIcons: next, toolbarIconsInjected: markInjected(prefsStore.prefs.toolbarIconsInjected) });
}

function activateTool(toolType: 'multicut' | 'merge' | 'findPath') {
  const viewer: any = (window as any)['viewer'];
  if (!viewer) return;

  // 1. Select the segmentation layer (required for tool keybindings)
  try {
    const segLayer = viewer.layerManager?.managedLayers?.find(
      (x: any) => x.layer?.constructor?.name?.includes('Segmentation'),
    );
    if (segLayer) {
      viewer.selectedLayer.layer = segLayer;
      viewer.selectedLayer.visible = true;
    }
  } catch { /* non-critical */ }

  // 2. Dispatch keyboard shortcut to the viewer element where ng binds handlers.
  // CUSTOM_BINDINGS map (in dev-server / build-prod): keyc → grapheneMulticutSegments,
  // keym → grapheneMergeSegments, keyf → grapheneFindPath.
  const keyMap = { multicut: 'c', merge: 'm', findPath: 'f' } as const;
  const codeMap = { multicut: 'KeyC', merge: 'KeyM', findPath: 'KeyF' } as const;
  const key = keyMap[toolType];
  const eventInit: KeyboardEventInit = {
    key, code: codeMap[toolType],
    bubbles: true, cancelable: true,
  };
  // Try viewer.element first (where global inputEventBindings live), then fallback
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

</script>

<template>
  <login-modal />
  <!-- <annotation-panel /> --> <!-- Hidden: users pick cells from Cell Library instead -->
  <achievement-toast />
  <command-palette
    ref="cmdPalette"
    @open-profile="showProfile = true"
    @open-recap="openWeekRecap()"
    @open-leaderboard="showLeaderboard = true"
    @open-settings="profileInitialTab = 'settings'; showProfile = true"
    @open-help="cellLibraryInitialTab = 'help'; showCellLibrary = true"
    @open-queue="showQueue = true"
    @open-cells="showCellLibrary = true"
    @open-feed="showFeed = true"
    @open-dataset-selector="showDatasetSelector = true"
  />
  <activity-feed-panel v-if="showFeed" @hide="showFeed = false" />
  <!-- Help requests now live in Cell Library's Help tab -->
  <proofreading-queue-panel v-if="showQueue" @hide="showQueue = false" />
  <cell-library-panel v-if="showCellLibrary" :initial-tab="cellLibraryInitialTab" @hide="showCellLibrary = false; cellLibraryInitialTab = undefined" />
  <batch-processor-panel v-if="showBatchProcessor" @hide="showBatchProcessor = false" />
  <volumes-overlay v-visible="showModal" @hide="showModal = false" />
  <dataset-selector-panel v-if="showDatasetSelector" @hide="showDatasetSelector = false" />
  <user-profile-panel v-if="showProfile" :view-user-id="profileUserId" :initial-tab="profileInitialTab" @hide="showProfile = false; profileUserId = null; profileInitialTab = undefined" @open-settings="profileInitialTab = 'settings'; showProfile = true" />
  <feedback-modal v-if="showFeedback" @hide="showFeedback = false" />
  <leaderboard-panel v-if="showLeaderboard" @hide="showLeaderboard = false" />
  <settings-panel v-if="showSettings" @hide="showSettings = false" />
  <notification-feed-panel :visible="showNotifications" @hide="showNotifications = false" @open-help="cellLibraryInitialTab = 'help'; showCellLibrary = true" />
  <chat-panel v-if="showChat" @hide="showChat = false" />
  <!-- The Ask dock is now the single command surface: it searches the same
       catalog CommandPalette builds (passed in headless) so navigation runs
       instantly, and only falls through to the model for real questions. -->
  <!-- Self-contained: listens for nge:prompt-username (fired after Tutorial 1)
       and no-ops if the user already has a handle or dismissed it before. -->
  <username-prompt />

  <assistant-dock
    :show="showAssistant"
    :ui-state="assistantUiState"
    :search-commands="searchCommands"
    :run-command-by-id="runCommandById"
    @hide="showAssistant = false"
  />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <!-- Click → hard refresh. Reloads the bundle from the server (skips
           the disk cache so a freshly-deployed JS hits the user without a
           manual Ctrl+F5). Tour step #2 explains this. -->
      <a href="#" title="EyeWire II — click to hard refresh"
         @click.prevent="hardRefresh">
        <img :src="pyrIcon" class="nge-pyr-logo" />
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <transition name="nge-share-toast">
      <div v-if="shareCopied" class="nge-share-toast">
        <div class="nge-share-toast-icon">
          <!-- Back neuron (offset up-left) -->
          <svg class="nge-share-neuron nge-share-neuron--back" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="shareNeuronGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="b1"/>
                <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b2"/>
                <feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <radialGradient id="shareSomaGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#80f0ff" stop-opacity="1"/>
                <stop offset="60%" stop-color="#20d0ff" stop-opacity="0.8"/>
                <stop offset="100%" stop-color="#00a0e0" stop-opacity="0.2"/>
              </radialGradient>
            </defs>
            <g filter="url(#shareNeuronGlow)">
              <!-- Apical trunk + tuft -->
              <path d="M30 30 L29 22 L27 14 L24 6" stroke="#18cfff" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
              <path d="M27 14 L33 10 L40 7" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/>
              <path d="M27 14 L21 10 L14 8" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/>
              <path d="M24 6 L20 2" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.5"/>
              <path d="M24 6 L28 2" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.5"/>
              <!-- Basal dendrites -->
              <path d="M30 32 L24 38 L18 44" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.65"/>
              <path d="M30 32 L36 38 L42 44" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.65"/>
              <path d="M30 32 L30 42 L30 52" stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>
              <path d="M18 44 L14 50" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.4"/>
              <path d="M42 44 L46 50" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.4"/>
              <!-- Soma -->
              <circle cx="30" cy="30" r="4" fill="url(#shareSomaGrad)"/>
            </g>
          </svg>
          <!-- Front neuron (offset down-right, brighter) -->
          <svg class="nge-share-neuron nge-share-neuron--front" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
            <g filter="url(#shareNeuronGlow)">
              <path d="M30 30 L29 22 L27 14 L24 6" stroke="#5be3ff" stroke-width="1.8" stroke-linecap="round" opacity="1"/>
              <path d="M27 14 L33 10 L40 7" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
              <path d="M27 14 L21 10 L14 8" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
              <path d="M24 6 L20 2" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.65"/>
              <path d="M24 6 L28 2" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.65"/>
              <path d="M30 32 L24 38 L18 44" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>
              <path d="M30 32 L36 38 L42 44" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>
              <path d="M30 32 L30 42 L30 52" stroke="#3acaee" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/>
              <path d="M18 44 L14 50" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.5"/>
              <path d="M42 44 L46 50" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.5"/>
              <circle cx="30" cy="30" r="4.5" fill="url(#shareSomaGrad)"/>
            </g>
          </svg>
        </div>
        <div class="nge-share-toast-text">Link copied to clipboard</div>
        <div class="nge-share-toast-actions">
          <button class="nge-share-action" title="Save screenshot"
                  @click="shareActionScreenshot">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/>
              <circle cx="12" cy="13.5" r="3.8"/>
            </svg>
          </button>
          <button class="nge-share-action" title="Email link"
                  @click="shareActionEmail">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="1.5"/>
              <path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>
            </svg>
          </button>
          <button class="nge-share-action" title="Post to X"
                  @click="shareActionX">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L4.7 21H1.5l7.5-8.5L1.2 3h6.6l4.5 6zm-1.1 16.2h1.8L7.7 4.7H5.8z"/>
            </svg>
          </button>
          <button class="nge-share-action" title="Share to Facebook"
                  @click="shareActionFacebook">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M14 7h3V4h-3c-1.93 0-3.5 1.57-3.5 3.5V10H8v3h2.5v8h3v-8H16l1-3h-3.5V7.5c0-.28.22-.5.5-.5z"/>
            </svg>
          </button>
        </div>
      </div>
    </transition>
    <screenshot-dialog :show="showScreenshotDialog" @close="showScreenshotDialog = false" />
    <button class="nge-ask-btn" :class="{ 'nge-ask-btn--active': showAssistant }"
            @click="showAssistant = !showAssistant"
            title="Nurro, your guide">
      <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">forum</span>
      <span class="nge-ask-label">AI</span>
    </button>
    <button class="nge-dataset-btn" @click="showDatasetSelector = !showDatasetSelector"
            :title="'Current dataset: ' + currentDatasetName + ' — click to switch'">
      <span v-if="currentDatasetIcon" class="nge-dataset-species">{{ currentDatasetIcon }}</span>
      <span v-else class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">database</span>
      <span class="nge-dataset-label">{{ currentDatasetAbbrev }}</span>
    </button>
    <button v-if="volumes.length" @click="showModal = true">Volumes ({{ volumes.length }})</button>
    <div v-if="login.sessions.length > 0 && stats.currentStreak > 0"
         class="nge-streak-chip" :title="`Editing streak: ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'} in a row with at least one edit`">
      🔥 {{ stats.currentStreak }}
    </div>
    <div class="nge-toolbar-icons" v-if="login.sessions.length > 0">
      <button class="nge-icon-btn nge-feedback-btn" title="Submit an issue or feedback"
              @click="showFeedback = true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#dfe6f2"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="8" x2="12" y2="12.5"/>
          <line x1="12" y1="16" x2="12" y2="16"/>
        </svg>
      </button>
      <button
        v-for="icon in visibleToolbar"
        :key="icon.id"
        :data-icon-id="icon.id"
        class="nge-icon-btn"
        :class="{
          'nge-icon-btn--badge': icon.badge && icon.badge() > 0,
          'nge-icon-btn--active': isIconActive(icon.id),
          'nge-icon-btn--dragging': dragId === icon.id,
          'nge-icon-btn--drag-over': dragOverId === icon.id && dragId !== icon.id,
        }"
        :title="icon.label + ' — drag to reorder'"
        draggable="true"
        @dragstart="onIconDragStart($event, icon.id)"
        @dragend="onIconDragEnd"
        @dragover="onIconDragOver($event, icon.id)"
        @dragleave="onIconDragLeave(icon.id)"
        @drop="onIconDrop($event, icon.id)"
        @click="icon.action()"
      ><span v-if="icon.svg" v-html="icon.svg"></span><img v-else-if="icon.img" :src="icon.img" class="nge-toolbar-icon-img" /><template v-else>{{ icon.emoji }}</template><span v-if="icon.badge && icon.badge() > 0" class="nge-toolbar-badge" :class="{ 'nge-toolbar-badge--chat': icon.id === 'chat' }">{{ icon.badge() }}</span></button>
    </div>

    <button v-if="login.sessions.length > 0" class="nge-icon-btn" @click="profileUserId = null; showProfile = true" id="profileBtn" title="My Profile" style="margin-left: 12px; margin-right: 14px;"><svg width="19" height="19" viewBox="0 0 24 24" fill="white" style="vertical-align:middle"><circle cx="12" cy="8" r="4"/><path d="M20 21c0-4.4-3.6-8-8-8s-8 3.6-8 8"/></svg></button>
    <dropdown-list dropdown-group="extension-bar-right" id="hamburger" class="rightMost">
      <template #buttonTitle>☰</template>
      <template #listItems>
        <li>
          <div class="logoutButton button nge-tour-btn" @click="tutorialStore.activeTutorial = 4; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>🧭 Take the Site Tour</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button" @click="tutorialStore.activeTutorial = 1; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>Reset Tutorial 1</span>
          </div>
        </li>
        <li v-if="tutorialStore.tutorialStep2 >= 0">
          <div class="logoutButton button" @click="tutorialStore.activeTutorial = 2; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>Reset Tutorial 2</span>
          </div>
        </li>
        <li v-if="tutorialStore.tutorialStep3 >= 0">
          <div class="logoutButton button" @click="tutorialStore.activeTutorial = 3; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>Reset Tutorial 3</span>
          </div>
        </li>
        <li v-if="tutorialStore.tutorialStep4 >= 0">
          <div class="logoutButton button" @click="tutorialStore.activeTutorial = 4; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>Reset Site Tour</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button" @click="tutorialStore.activeTutorial = 2; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>Advanced Interface Tutorial</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button" @click="tutorialStore.activeTutorial = 3; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>Cut & Merge Tutorial</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://forum.eyewire.org">Forum</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank"
                href="https://blog.pyr.ai/2024/12/20/proofreading-101-climb-into-spelunker/">Proofreading
                Guide</a></span>
          </div>
        </li>
        <!--
          TODO: User reports Merge (48GS9Sizrvw) and Split (DB6wmQWGsck) videos
          are unreachable for them while Find path (CGooeAhSryg) works. URLs
          return HTTP 200 but may be unlisted/region-restricted. Verify with the
          EyeWire YouTube channel and replace if needed.
        -->
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://youtu.be/48GS9Sizrvw">Merge</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://youtu.be/DB6wmQWGsck">Split</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://youtu.be/CGooeAhSryg">Find path</a></span>
          </div>
        </li>
      </template>
    </dropdown-list>
  </div>
</template>

<style>
.dropdownList:last-child .dropdownMenu {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

#extensionBar button {
  font-size: 10pt;
}


/* The re-parented neuroglancer top row. It used to be stretched to 100%
   so its flex:1 mouse readout had room; that readout is now a fixed corner
   chip, and the stretch painted the row's own #222 background across the
   whole elastic zone: the "random black bar" after the ? button. Let it
   shrink to content and blend into the bar (the flex-fill absorbs slack). */
#insertNGTopBar > div {
  width: auto;
  background: transparent !important;
  margin-bottom: 0 !important;
}
/* Add spacing between neuroglancer native icons next to Share */
#insertNGTopBar .neuroglancer-icon,
#insertNGTopBar button {
  margin: 0 2px;
}
/* Hide selection details toggle from top bar (moved to Settings > Advanced) */
#insertNGTopBar .neuroglancer-icon[title*="election"],
#insertNGTopBar button[title*="election"] {
  display: none !important;
}

/* Style NG's Share button to look clickable */
#insertNGTopBar .neuroglancer-icon[title*="Share"],
#insertNGTopBar button[title*="hare"],
#insertNGTopBar .neuroglancer-share-button,
#insertNGTopBar [class*="share" i] {
  background: rgba(74, 158, 255, 0.1) !important;
  border: 1px solid rgba(74, 158, 255, 0.3) !important;
  border-radius: 4px !important;
  padding: 2px 8px !important;
  color: rgba(74, 158, 255, 0.9) !important;
  cursor: pointer !important;
  transition: background 0.15s, border-color 0.15s !important;
}
#insertNGTopBar .neuroglancer-icon[title*="Share"]:hover,
#insertNGTopBar button[title*="hare"]:hover,
#insertNGTopBar .neuroglancer-share-button:hover,
#insertNGTopBar [class*="share" i]:hover {
  background: rgba(74, 158, 255, 0.2) !important;
  border-color: rgba(74, 158, 255, 0.5) !important;
}

#extensionBar {
  display: flex;
  height: 40px;
  align-items: center;
  background-color: var(--color-dark-bg);
  z-index: 30;
}

#extensionBar > * {
  height: 100%;
  display: flex;
  align-items: center;
}

#loginsDropdown li.none {
  opacity: 0.5;
  padding: 0 10px;
}

#loginsDropdown li > div:last-child {
  border-bottom: none;
}

#loginsDropdown li > div {
  display: grid;
  grid-template-columns: auto min-content;
  border-bottom: 1px solid #4a4a4a;
}

#loginsDropdown .loginData {
  display: grid;
  white-space: nowrap;
  padding: 10px;
}

#loginsDropdown .logoutButton {
  display: grid;
  align-content: center;
  justify-content: center;
  padding-left: 10px;
  padding-right: 10px;
  opacity: 0;
}

#loginsDropdown .loginRow:hover .logoutButton {
 opacity: 0.25;
}

#loginsDropdown .loginRow:hover .logoutButton:hover {
  opacity: 1;
  background-color: #db4437;
  cursor: pointer;
}

#loginsDropdown li.header {
  padding: 5px;
  background-color: #ffffff1c;
}

#loginsDropdown .loginData.expired {
  opacity: 0.5;
}

.ng-extend-logo {
  display: flex;
  align-items: center;
  padding: 0 6px 0 8px;
}
.ng-extend-logo > a {
  display: flex;
  align-items: center;
}
.nge-pyr-logo {
  /* Sized to match the toolbar SVG icons (18px content) — was 28px and
     visibly outsized everything else. The blue glow gives it identity
     without needing the extra pixels. */
  width: 22px;
  height: 22px;
  object-fit: contain;
  opacity: 0.95;
  filter: drop-shadow(0 0 6px rgba(74, 158, 255, 0.35));
  transition: opacity 0.15s, filter 0.15s;
}
.nge-pyr-logo:hover {
  opacity: 1;
  filter: drop-shadow(0 0 10px rgba(74, 158, 255, 0.5));
}

/* ── Share toast (holographic mini-modal) ── */
/* `#extensionBar > *` sets height:100% on every direct child — override that
   here, otherwise the absolute toast resolves 100% against the viewport and
   becomes a full-page-tall bar. Also pin display so flex centering works. */
.nge-share-toast {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  height: auto !important;
  display: flex !important;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 26px 16px;
  min-width: 240px;
  background: linear-gradient(135deg,
    rgba(8, 28, 48, 0.92) 0%,
    rgba(12, 18, 38, 0.94) 50%,
    rgba(8, 28, 48, 0.92) 100%);
  border: 1px solid rgba(74, 200, 255, 0.35);
  border-radius: 14px;
  color: #cfeaff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  white-space: nowrap;
  z-index: 9999;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 0 24px rgba(74, 200, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: none;
  overflow: hidden;
}
.nge-share-toast::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  padding: 1px;
  background: linear-gradient(135deg,
    rgba(74, 220, 255, 0.5),
    rgba(120, 0, 255, 0.15) 50%,
    rgba(0, 220, 200, 0.4));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  animation: nge-share-border 4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nge-share-border {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1; }
}

.nge-share-toast-icon {
  position: relative;
  width: 56px;
  height: 56px;
}
.nge-share-neuron {
  position: absolute;
  width: 44px;
  height: 44px;
  filter: drop-shadow(0 0 6px rgba(74, 200, 255, 0.5));
}
.nge-share-neuron--back {
  top: 0;
  left: 0;
  opacity: 0.55;
  animation: nge-share-neuron-breathe 2.6s ease-in-out infinite;
}
.nge-share-neuron--front {
  bottom: 0;
  right: 0;
  opacity: 1;
  filter: drop-shadow(0 0 8px rgba(91, 227, 255, 0.7));
  animation: nge-share-neuron-breathe 2.6s ease-in-out infinite 0.4s;
}
@keyframes nge-share-neuron-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.05); }
}

.nge-share-toast-text {
  position: relative;
  z-index: 1;
  text-shadow: 0 0 10px rgba(74, 200, 255, 0.4);
}

/* Action button row inside the share toast. The toast itself is
   pointer-events: none so it doesn't block viewer interaction; buttons
   override with pointer-events: auto so they're still clickable. */
.nge-share-toast-actions {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.nge-share-action {
  pointer-events: auto;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 158, 255, 0.12);
  border: 1px solid rgba(74, 200, 255, 0.32);
  border-radius: 8px;
  color: #cfeaff;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.nge-share-action:hover {
  background: rgba(74, 200, 255, 0.28);
  border-color: rgba(74, 200, 255, 0.7);
  color: #ffffff;
  transform: translateY(-1px);
}
.nge-share-action:active {
  transform: translateY(0);
}

.nge-share-toast-enter-active { transition: opacity 0.28s ease-out, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-share-toast-leave-active { transition: opacity 0.32s ease-in, transform 0.32s ease-in; }
.nge-share-toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.94); }
.nge-share-toast-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.97); }

.nge-streak-chip {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #f5a623;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

/* ── Dataset button: borderless to match the toolbar SVG icons.
   Same gentle hover wash as .nge-icon-btn. ── */
/* Ask and Dataset are the only labelled controls in a strip of icon buttons.
   They were 28px tall against the icons' 38px, with different horizontal
   padding from each other (8px vs 10px), so they sat short and unevenly
   spaced — the "weird padding". Both now match the icon buttons' height and
   share one padding value, so the whole bar sits on a single rhythm. */
.nge-dataset-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 16px;
  margin: 0 6px 0 2px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #cfdcef;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0.85;
  transition: background 0.15s, opacity 0.15s, color 0.15s;
}
.nge-dataset-label { padding-right: 2px; }
.nge-dataset-species { font-size: 14px; line-height: 1; }
.nge-dataset-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
  color: #e0ecff;
}
.nge-dataset-btn .material-symbols-outlined {
  color: rgba(150, 175, 215, 0.9);
}
.nge-dataset-btn:hover .material-symbols-outlined {
  color: #cfdcef;
}

/* ── Ask (EyeWire II Guide) button ── */
.nge-ask-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* Matches .nge-icon-btn height; the pill keeps its own inner height via
     border-radius so it still reads as a button, not an icon. */
  height: 30px;
  margin: 0 6px;
  padding: 0 14px;
  background: rgba(74, 158, 255, 0.12);
  border: 1px solid rgba(74, 158, 255, 0.28);
  border-radius: 14px;
  color: #cfe0f5;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.nge-ask-btn:hover {
  background: rgba(74, 158, 255, 0.22);
  border-color: rgba(74, 158, 255, 0.5);
  color: #eaf2ff;
}
.nge-ask-btn--active {
  background: rgba(74, 158, 255, 0.28);
  border-color: rgba(74, 158, 255, 0.6);
}
.nge-ask-btn .material-symbols-outlined {
  color: #6fb2ff;
}

/* ── Toolbar icon group ── */
.nge-toolbar-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 100%;
}

#extensionBar .nge-icon-btn {
  /* `font-size` controls SVG sizing (icons use width:1em/height:1em). The
     icon viewBoxes are cropped tight to their artwork (see toolbar-icons.ts),
     so the glyph now fills the box and font-size ≈ rendered glyph size.

     Scoped under #extensionBar (specificity 1,1,0) so it beats the blanket
     `#extensionBar button { font-size: 10pt }` rule above — otherwise the
     icons fall back to 13px on wide screens (the original bug). A FIXED size
     is deliberate: viewport-scaling (vw) grew the icons on big monitors,
     which read as comically large. Toolbar glyphs want one consistent,
     modest size at every width, not one that tracks the screen. */
  font-size: 20px;
  width: 34px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.78;
  transition: opacity 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
  line-height: 1;
}
/* Hover: a holo glow ring + slight lift, so the custom icons answer the
   cursor the way the neuroglancer natives do, but in the app's own accent. */
.nge-icon-btn:hover {
  opacity: 1;
  background: rgba(100, 200, 255, 0.1);
  box-shadow:
    0 0 0 1px rgba(100, 200, 255, 0.3),
    0 2px 12px rgba(100, 200, 255, 0.18);
  transform: translateY(-1px);
}
@media (prefers-reduced-motion: reduce) {
  .nge-icon-btn:hover { transform: none; }
}
.nge-icon-btn--active {
  opacity: 1;
  background: rgba(74, 158, 255, 0.12);
  box-shadow: 0 1px 0 0 #4a9eff;
}
/* Drag-to-reorder visuals */
.nge-icon-btn {
  position: relative;
}
.nge-icon-btn--dragging {
  opacity: 0.35;
  cursor: grabbing;
}
/* Vertical insertion bar shown to the LEFT of the drop target.
 * Replaces the old square box-shadow highlight — reads as a cursor
 * showing where the dragged icon will land. */
.nge-icon-btn--drag-over::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(120, 180, 255, 0.95) 22%,
    rgba(180, 215, 255, 1) 50%,
    rgba(120, 180, 255, 0.95) 78%,
    transparent 100%
  );
  border-radius: 1px;
  box-shadow: 0 0 8px rgba(120, 180, 255, 0.7);
  pointer-events: none;
  animation: nge-icon-drop-pulse 0.9s ease-in-out infinite;
}
@keyframes nge-icon-drop-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; }
}
.nge-icon-btn--badge { position: relative; }

.nge-toolbar-icon-img {
  /* Track the same em sizing as the SVG icons so the Cell Library PNG
     scales with the clamp() on .nge-icon-btn instead of staying a fixed
     24px while its neighbours shrink/grow. */
  width: 1em;
  height: 1em;
  object-fit: contain;
  vertical-align: middle;
  opacity: 0.9;
}
.nge-toolbar-badge {
  position: absolute;
  top: 1px;
  right: 0;
  background: #7c4dff;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  border-radius: 8px;
  min-width: 13px;
  height: 13px;
  line-height: 13px;
  text-align: center;
  padding: 0 3px;
  /* Soft entrance — pip pops in when a new unread arrives. */
  animation: nge-badge-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Chat unread pip is green to read as "live conversation" rather than
   the purple admin/notification accent. */
.nge-toolbar-badge--chat {
  background: #4ad07a;
  color: #06170d;
  box-shadow: 0 0 8px rgba(74, 208, 122, 0.55);
}

@keyframes nge-badge-pop {
  0%   { opacity: 0; transform: scale(0.4); }
  60%  { opacity: 1; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}

/* (The ⌘K trigger chip and its styles are gone: the button was removed from
   the toolbar, and the command palette it opened is now folded into the Ask
   dock. Ctrl/Cmd+K opens that dock instead — see commandKeyHandler.) */

/* ── Hamburger menu ── */
#hamburger li {
  padding: 10px 14px;
  cursor: pointer;
  display: grid;
  justify-content: center;
  align-content: center;
  white-space: nowrap;
  font-size: 14px;
}

#hamburger li .logoutButton {
  font-size: 14px;
}

/* Hover treatment matches the Seg side-panel tab hover so the menu and
   the right panel read as one design language. */
#hamburger li:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

/* Site Tour entry uses the same "selected tab" treatment as the Seg
   panel: the rgba(74,158,255,0.1) fill + a 2px accent line on the
   leading edge (left for a vertical menu, top for horizontal tabs). */
#hamburger li .nge-tour-btn {
  color: rgba(220, 235, 255, 0.98);
  font-weight: 500;
  letter-spacing: 0.3px;
  background: rgba(74, 158, 255, 0.1);
  border-left: 2px solid rgba(74, 158, 255, 0.5);
}
#hamburger li:hover .nge-tour-btn {
  background: rgba(74, 158, 255, 0.18);
  border-left-color: rgba(74, 158, 255, 0.8);
}

#hamburger li a {
  color: unset;
  text-decoration: unset;
  font-size: inherit;
}
</style>
