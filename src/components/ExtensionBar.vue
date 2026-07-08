<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import VolumesOverlay from "components/VolumesOverlay.vue";
import DropdownList from "components/DropdownList.vue";
import UserProfilePanel from "components/UserProfilePanel.vue";
import WeeklyRecapPanel from "components/WeeklyRecapPanel.vue";
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
import BatchProcessorPanel from "components/BatchProcessorPanel.vue";
import NotificationFeedPanel from "components/NotificationFeedPanel.vue";
import DatasetSelectorPanel from "components/DatasetSelectorPanel.vue";
import ScreenshotDialog from "components/ScreenshotDialog.vue";
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

import {loginSession, useLoginStore, useVolumesStore, useUserStatsStore, useSegmentAnnotationStore, useHelpRequestStore, useProofreadingQueueStore, useProofreadingBackendStore, useUserPreferencesStore, useDropdownListStore, useChatStore} from '../store';
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
  document.addEventListener('nge:open-profile', ((e: CustomEvent) => {
    profileUserId.value = e.detail?.userId || null;
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
const { activeSegId } = storeToRefsAnnot(useSegmentAnnotationStore());
const helpStore = useHelpRequestStore();
const chatStore = useChatStore();
const queueStore = useProofreadingQueueStore();

const showModal = ref(false);
const showProfile = ref(false);
const profileUserId = ref<string | null>(null);
const showRecap = ref(false);
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
import { TOOLBAR_ICON_DEFS } from '../data/toolbar-icons';

interface ToolbarAction {
  action: () => void;
  badge?: () => number;
}

const toolbarActions: Record<string, ToolbarAction> = {
  split:       { action: () => activateTool('multicut') },
  merge:       { action: () => activateTool('merge') },
  findPath:    { action: () => activateTool('findPath') },
  recap:       { action: () => { showRecap.value = true; } },
  leaderboard: { action: () => { showLeaderboard.value = true; } },
  quest:       { action: () => { showQueue.value = !showQueue.value; }, badge: () => queueStore.pendingCount() },
  cells:       { action: () => { cellLibraryInitialTab.value = undefined; showCellLibrary.value = !showCellLibrary.value; } },
  batch:       { action: () => { showBatchProcessor.value = !showBatchProcessor.value; } },
  help:        { action: () => { cellLibraryInitialTab.value = 'help'; showCellLibrary.value = true; }, badge: () => helpStore.pending.length },
  feed:        { action: () => { showFeed.value = true; } },
  notif:       { action: () => { showNotifications.value = !showNotifications.value; }, badge: () => backendStore.unreadNotificationCount },
  chat:        { action: () => { showChat.value = !showChat.value; if (showChat.value) chatStore.markRead(); }, badge: () => chatStore.unreadCount },
  settings:    { action: () => { showSettings.value = true; } },
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

const DEFAULT_TOOLBAR_ORDER = ['split', 'merge', 'findPath', 'recap', 'leaderboard', 'cells', 'batch', 'help', 'notif', 'chat', 'settings'];

// Map icon IDs to their active (open) state
const iconActiveState: Record<string, () => boolean> = {
  recap: () => showRecap.value,
  leaderboard: () => showLeaderboard.value,
  quest: () => showQueue.value,
  cells: () => showCellLibrary.value,
  batch: () => showBatchProcessor.value,
  feed: () => showFeed.value,
  notif: () => showNotifications.value,
  chat: () => showChat.value,
  settings: () => showSettings.value,
};
function isIconActive(id: string): boolean {
  return iconActiveState[id]?.() ?? false;
}

const visibleToolbar = computed(() => {
  const prefs = useUserPreferencesStore().prefs;
  let order = prefs.toolbarIcons.length > 0 ? [...prefs.toolbarIcons] : DEFAULT_TOOLBAR_ORDER;
  // Auto-inject new toolbar icons that weren't in older saved prefs
  for (const newId of ['batch', 'notif', 'chat', 'findPath']) {
    if (!order.includes(newId)) {
      // findPath inserts right after merge; others go before settings
      if (newId === 'findPath') {
        const mergeIdx = order.indexOf('merge');
        order.splice(mergeIdx >= 0 ? mergeIdx + 1 : 0, 0, newId);
      } else {
        const settingsIdx = order.indexOf('settings');
        order.splice(settingsIdx >= 0 ? settingsIdx : order.length, 0, newId);
      }
    }
  }
  // Remove retired icons from saved prefs
  order = order.filter(id => !['quest', 'feed'].includes(id));
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
  prefsStore.prefs.toolbarIcons = next;
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
    @open-recap="showRecap = true"
    @open-leaderboard="showLeaderboard = true"
    @open-settings="showSettings = true"
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
  <user-profile-panel v-if="showProfile" :view-user-id="profileUserId" @hide="showProfile = false; profileUserId = null" @open-settings="showSettings = true" />
  <weekly-recap-panel v-if="showRecap" @hide="showRecap = false" />
  <leaderboard-panel v-if="showLeaderboard" @hide="showLeaderboard = false" />
  <settings-panel v-if="showSettings" @hide="showSettings = false" />
  <notification-feed-panel :visible="showNotifications" @hide="showNotifications = false" @open-help="cellLibraryInitialTab = 'help'; showCellLibrary = true" />
  <chat-panel v-if="showChat" @hide="showChat = false" />
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
    <button class="nge-dataset-btn" @click="showDatasetSelector = !showDatasetSelector"
            title="Switch Dataset">
      <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">database</span>
      <span class="nge-dataset-label">Dataset</span>
    </button>
    <button v-if="volumes.length" @click="showModal = true">Volumes ({{ volumes.length }})</button>
    <div v-if="login.sessions.length > 0 && stats.currentStreak > 0"
         class="nge-streak-chip" title="Your current editing streak">
      🔥 {{ stats.currentStreak }}
    </div>
    <div class="nge-toolbar-icons" v-if="login.sessions.length > 0">
      <button class="nge-cmd-trigger" title="Command Palette (Ctrl+K)"
              @click="cmdPalette?.open()">
        <kbd>⌘K</kbd>
      </button>
      <button
        v-for="icon in visibleToolbar"
        :key="icon.id"
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


#insertNGTopBar > div {
  width: 100%;
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
.nge-dataset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #cfdcef;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  opacity: 0.85;
  transition: background 0.15s, opacity 0.15s, color 0.15s;
}
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

/* ── Toolbar icon group ── */
.nge-toolbar-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 100%;
}

.nge-icon-btn {
  /* `font-size` controls SVG sizing (icons use width:1em/height:1em). The
     icon viewBoxes are cropped tight to their artwork (see toolbar-icons.ts),
     so the glyph now fills the box and font-size ≈ rendered glyph size. */
  font-size: 24px;
  width: 40px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.78;
  transition: opacity 0.15s, background 0.15s;
  line-height: 1;
}
.nge-icon-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
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
  width: 24px;
  height: 24px;
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

.nge-cmd-trigger {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 6px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.15s, background 0.15s;
}
.nge-cmd-trigger:hover { opacity: 1; background: rgba(255, 255, 255, 0.06); }
/* Borderless kbd so the ⌘K trigger reads like the rest of the toolbar
   icons. Color/weight do the work that the box used to. */
.nge-cmd-trigger kbd {
  font-size: 12px;
  font-weight: 600;
  padding: 0;
  background: none;
  border: none;
  color: #cfdcef;
  font-family: inherit;
  letter-spacing: 0.03em;
}
.nge-cmd-trigger:hover kbd { color: #e0ecff; }

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
