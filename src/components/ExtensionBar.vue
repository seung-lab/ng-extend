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
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

import {loginSession, useLoginStore, useVolumesStore, useUserStatsStore, useSegmentAnnotationStore, useHelpRequestStore, useProofreadingQueueStore, useProofreadingBackendStore, useUserPreferencesStore, useDropdownListStore} from '../store';
import {useTutorialStore} from '../store-pyr';
import {storeToRefs as storeToRefsAnnot} from 'pinia';
import {storeToRefs} from 'pinia';

import logoImage from '../CaveLogo-clear.png';

const login = useLoginStore();
const tutorialStore = useTutorialStore();
const dropdownStore = useDropdownListStore();

/** Sync the first valid login session to Supabase so userId is set. */
function syncFirstSession() {
  const session = login.sessions.find(s => s.status === undefined);
  if (session?.email) {
    const backend = useProofreadingBackendStore();
    if (!backend.userId) {
      backend.syncUser(session.email, session.name || session.email.split('@')[0])
        .then(() => backend.loadUserStats());
    }
  }
}

function closeHamburger() {
  dropdownStore.activeDropdowns['extension-bar-right'] = undefined;
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
const queueStore = useProofreadingQueueStore();

// ── Merge/Split celebration animation ──────────────────────────
const editCelebration = ref<'merge' | 'split' | null>(null);
watch(() => statsStore.recentEditEvent, (ev) => {
  if (ev) {
    editCelebration.value = ev.type;
    setTimeout(() => { editCelebration.value = null; }, 2200);
  }
});

const showModal = ref(false);
const showProfile = ref(false);
const profileUserId = ref<string | null>(null);
const showRecap = ref(false);
const showLeaderboard = ref(false);
const showSettings = ref(false);
const showQueue = ref(false);
const showFeed = ref(false);
const showChat = ref(true);
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

// Branch-style SVG icons for split & merge (must match profile icons)
const SPLIT_SVG = `<svg viewBox="0 0 16 16" fill="none" style="width:18px;height:18px;vertical-align:middle;color:#e06060"><path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="2.5" r="1.5" fill="currentColor"/><circle cx="4" cy="13" r="1.5" fill="currentColor"/><circle cx="12" cy="13" r="1.5" fill="currentColor"/><path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const MERGE_SVG = `<svg viewBox="0 0 16 16" fill="none" style="width:18px;height:18px;vertical-align:middle;color:#60c060"><path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="2.5" r="1.5" fill="currentColor"/><circle cx="12" cy="2.5" r="1.5" fill="currentColor"/><circle cx="8" cy="13" r="1.5" fill="currentColor"/><path d="M8 11v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const toolbarDefs = computed<ToolbarIcon[]>(() => [
  { id: 'split', emoji: '✂️', svg: SPLIT_SVG, label: 'Cut Mode (C)', action: () => activateTool('multicut') },
  { id: 'merge', emoji: '🔗', svg: MERGE_SVG, label: 'Merge Mode (M)', action: () => activateTool('merge') },
  { id: 'recap', emoji: '📊', svg: `<svg viewBox="0 0 16 16" fill="none" style="width:18px;height:18px;vertical-align:middle;color:#a0c4ff"><rect x="1" y="10" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.4"/><rect x="5" y="7" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.6"/><rect x="9" y="4" width="3" height="11" rx="0.5" fill="currentColor" opacity="0.8"/><rect x="13" y="1" width="2.5" height="14" rx="0.5" fill="currentColor"/></svg>`, label: 'Your Week in Science', action: () => { showRecap.value = true; } },
  { id: 'leaderboard', emoji: '🏆', label: 'Leaderboard', action: () => { showLeaderboard.value = true; } },
  { id: 'quest', emoji: '🧠', label: 'Brain Quest', action: () => { showQueue.value = !showQueue.value; }, badge: () => queueStore.pendingCount() },
  { id: 'cells', emoji: '🧬', img: neuronIcon, label: 'Cell Library', action: () => { cellLibraryInitialTab.value = undefined; showCellLibrary.value = !showCellLibrary.value; } },
  { id: 'batch', emoji: '📦', label: 'Batch Processor', action: () => { showBatchProcessor.value = !showBatchProcessor.value; } },
  { id: 'help', emoji: '🔍', label: 'Second Opinion Requests', action: () => { cellLibraryInitialTab.value = 'help'; showCellLibrary.value = true; }, badge: () => helpStore.pending.length },
  { id: 'feed', emoji: '📡', label: 'Activity Feed', action: () => { showFeed.value = true; } },
  { id: 'notif', emoji: '🔔', label: 'Notifications', action: () => { showNotifications.value = !showNotifications.value; console.debug('[nge] bell toggled →', showNotifications.value); }, badge: () => backendStore.unreadNotificationCount },
  { id: 'chat', emoji: '💬', label: 'Chat', action: () => { showChat.value = !showChat.value; } },
  { id: 'settings', emoji: '⚙️', label: 'Profile Settings', action: () => { showSettings.value = true; } },
]);

const DEFAULT_TOOLBAR_ORDER = ['split', 'merge', 'recap', 'leaderboard', 'cells', 'batch', 'help', 'notif', 'chat', 'settings'];

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
  for (const newId of ['batch', 'notif', 'chat']) {
    if (!order.includes(newId)) {
      const settingsIdx = order.indexOf('settings');
      order.splice(settingsIdx >= 0 ? settingsIdx : order.length, 0, newId);
    }
  }
  // Remove retired icons from saved prefs
  order = order.filter(id => !['quest', 'feed'].includes(id));
  return order.map(id => toolbarDefs.value.find(d => d.id === id)).filter(Boolean) as ToolbarIcon[];
});

function activateTool(toolType: 'multicut' | 'merge') {
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

  // 2. Dispatch keyboard shortcut to the viewer element where ng binds handlers
  const key = toolType === 'multicut' ? 'c' : 'm';
  const eventInit: KeyboardEventInit = {
    key, code: key === 'c' ? 'KeyC' : 'KeyM',
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
      <a href="https://eyewire.org" target="_blank" title="EyeWire II">
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
      </div>
    </transition>
    <button class="nge-dataset-btn" @click="showDatasetSelector = !showDatasetSelector"
            title="Switch Dataset">
      <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">database</span>
      Dataset
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
        }"
        :title="icon.label"
        @click="icon.action()"
      ><span v-if="icon.svg" v-html="icon.svg"></span><img v-else-if="icon.img" :src="icon.img" class="nge-toolbar-icon-img" /><template v-else>{{ icon.emoji }}</template><span v-if="icon.badge && icon.badge() > 0" class="nge-toolbar-badge">{{ icon.badge() }}</span></button>
    </div>

    <!-- Merge/Split celebration burst -->
    <Transition name="nge-edit-burst">
      <div v-if="editCelebration" class="nge-edit-celebration" :class="'nge-edit-celebration--' + editCelebration">
        <span class="nge-edit-celebration-icon">{{ editCelebration === 'merge' ? '🔗' : '✂️' }}</span>
        <span class="nge-edit-celebration-text">{{ editCelebration === 'merge' ? 'Merged!' : 'Split!' }}</span>
        <span v-for="i in 8" :key="i" class="nge-edit-spark" :style="{ '--spark-i': i }"></span>
      </div>
    </Transition>

    <button v-if="login.sessions.length > 0" class="nge-icon-btn" @click="profileUserId = null; showProfile = true" id="profileBtn" title="My Profile" style="margin-left: 12px; margin-right: 14px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="white" style="vertical-align:middle"><circle cx="12" cy="8" r="4"/><path d="M20 21c0-4.4-3.6-8-8-8s-8 3.6-8 8"/></svg></button>
    <dropdown-list dropdown-group="extension-bar-right" id="hamburger" class="rightMost">
      <template #buttonTitle>☰</template>
      <template #listItems>
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
  width: 28px;
  height: 28px;
  object-fit: contain;
  opacity: 0.9;
  filter: drop-shadow(0 0 6px rgba(74, 158, 255, 0.3));
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
  min-width: 220px;
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

/* ── Toolbar icon group ── */
.nge-toolbar-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 100%;
}

.nge-icon-btn {
  font-size: 18px;
  width: 32px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.7;
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
.nge-icon-btn--badge { position: relative; }

.nge-toolbar-icon-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
  vertical-align: middle;
  opacity: 0.85;
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
  opacity: 0.45;
  transition: opacity 0.15s, background 0.15s;
}
.nge-cmd-trigger:hover { opacity: 0.9; background: rgba(255, 255, 255, 0.06); }
.nge-cmd-trigger kbd {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #888;
  font-family: inherit;
  letter-spacing: 0.03em;
}

/* ── Merge/Split celebration ─────────────────────────── */
.nge-edit-celebration {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  pointer-events: none;
  overflow: visible;
}

.nge-edit-celebration--merge {
  background: linear-gradient(135deg, rgba(100, 200, 255, 0.25), rgba(80, 160, 255, 0.15));
  border: 1px solid rgba(100, 200, 255, 0.45);
  color: rgba(160, 230, 255, 0.95);
  box-shadow: 0 0 20px rgba(100, 200, 255, 0.3), 0 0 40px rgba(100, 200, 255, 0.1);
}

.nge-edit-celebration--split {
  background: linear-gradient(135deg, rgba(255, 170, 100, 0.25), rgba(255, 140, 60, 0.15));
  border: 1px solid rgba(255, 170, 100, 0.45);
  color: rgba(255, 210, 170, 0.95);
  box-shadow: 0 0 20px rgba(255, 170, 100, 0.3), 0 0 40px rgba(255, 170, 100, 0.1);
}

.nge-edit-celebration-icon {
  font-size: 1.2em;
  animation: ngeEditBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.nge-edit-celebration-text {
  animation: ngeEditSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Spark particles */
.nge-edit-spark {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  top: 50%;
  left: 50%;
  pointer-events: none;
  animation: ngeEditSpark 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--spark-i) * 0.04s);
}

.nge-edit-celebration--merge .nge-edit-spark {
  background: rgba(100, 200, 255, 0.9);
  box-shadow: 0 0 6px rgba(100, 200, 255, 0.6);
}

.nge-edit-celebration--split .nge-edit-spark {
  background: rgba(255, 170, 100, 0.9);
  box-shadow: 0 0 6px rgba(255, 170, 100, 0.6);
}

@keyframes ngeEditBounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.4); }
  100% { transform: scale(1); }
}

@keyframes ngeEditSlideIn {
  0% { opacity: 0; transform: translateX(-10px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes ngeEditSpark {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(
      calc(-50% + cos(calc(var(--spark-i) * 45deg)) * 30px),
      calc(-50% + sin(calc(var(--spark-i) * 45deg)) * 20px)
    ) scale(0);
    opacity: 0;
  }
}

/* Transition */
.nge-edit-burst-enter-active {
  animation: ngeEditAppear 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.nge-edit-burst-leave-active {
  animation: ngeEditDisappear 0.5s cubic-bezier(0.55, 0, 1, 0.45) both;
}

@keyframes ngeEditAppear {
  0% { opacity: 0; transform: scale(0.5) translateY(4px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes ngeEditDisappear {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8) translateY(-6px); filter: blur(4px); }
}

/* ── Hamburger menu ── */
#hamburger li {
  padding: 10px;
  cursor: pointer;
  display: grid;
  justify-content: center;
  align-content: center;
  white-space: nowrap;
}

#hamburger li:hover {
  background-color: #ffffff33;
}

#hamburger li a {
  color: unset;
  text-decoration: unset;
}
</style>
