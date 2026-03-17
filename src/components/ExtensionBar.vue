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

import {loginSession, useLoginStore, useVolumesStore, useUserStatsStore, useSegmentAnnotationStore, useHelpRequestStore, useProofreadingQueueStore, useProofreadingBackendStore, useUserPreferencesStore} from '../store';
import {useTutorialStore} from '../store-pyr';
import {storeToRefs as storeToRefsAnnot} from 'pinia';
import {storeToRefs} from 'pinia';

import logoImage from '../CaveLogo-clear.png';

const login = useLoginStore();

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

window.addEventListener("middleauthlogin", () => {
  login.update().then(syncFirstSession);
});

// Also sync on initial load (user may already be logged in)
login.update().then(syncFirstSession);

const validLogins = computed(() => login.sessions.filter(x => x.status === undefined));
const invalidLogins = computed(() => login.sessions.filter(x => x.status !== undefined));

const {volumes} = useVolumesStore();

onMounted(() => {
  (document.querySelector('.ng-extend-logo > a > img')! as HTMLImageElement).src = logoImage;
  document.addEventListener('nge:open-profile', () => { showProfile.value = true; });
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
const showRecap = ref(false);
const showLeaderboard = ref(false);
const showSettings = ref(false);
const showQueue = ref(false);
const showFeed = ref(false);
const showChat = ref(false);
const showCellLibrary = ref(false);
const cellLibraryInitialTab = ref<string | undefined>(undefined);
const showBatchProcessor = ref(false);
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
  label: string;
  action: () => void;
  badge?: () => number;
}

// Branch-style SVG icons for split & merge (must match profile icons)
const SPLIT_SVG = `<svg viewBox="0 0 16 16" fill="none" style="width:16px;height:16px;vertical-align:middle"><path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="2.5" r="1.5" fill="currentColor"/><circle cx="4" cy="13" r="1.5" fill="currentColor"/><circle cx="12" cy="13" r="1.5" fill="currentColor"/><path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const MERGE_SVG = `<svg viewBox="0 0 16 16" fill="none" style="width:16px;height:16px;vertical-align:middle"><path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="2.5" r="1.5" fill="currentColor"/><circle cx="12" cy="2.5" r="1.5" fill="currentColor"/><circle cx="8" cy="13" r="1.5" fill="currentColor"/><path d="M8 11v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const toolbarDefs = computed<ToolbarIcon[]>(() => [
  { id: 'split', emoji: '✂️', svg: SPLIT_SVG, label: 'Split Mode (C)', action: () => activateTool('multicut') },
  { id: 'merge', emoji: '🔗', svg: MERGE_SVG, label: 'Merge Mode (M)', action: () => activateTool('merge') },
  { id: 'recap', emoji: '📊', label: 'Your Week in Science', action: () => { showRecap.value = true; } },
  { id: 'leaderboard', emoji: '🏆', label: 'Leaderboard', action: () => { showLeaderboard.value = true; } },
  { id: 'quest', emoji: '🧠', label: 'Brain Quest', action: () => { showQueue.value = !showQueue.value; }, badge: () => queueStore.pendingCount() },
  { id: 'cells', emoji: '🧬', label: 'Cell Library', action: () => { cellLibraryInitialTab.value = undefined; showCellLibrary.value = !showCellLibrary.value; } },
  { id: 'batch', emoji: '📦', label: 'Batch Processor', action: () => { showBatchProcessor.value = !showBatchProcessor.value; } },
  { id: 'help', emoji: '🔍', label: 'Second Opinion Requests', action: () => { cellLibraryInitialTab.value = 'help'; showCellLibrary.value = true; }, badge: () => helpStore.pending.length },
  { id: 'feed', emoji: '📡', label: 'Activity Feed', action: () => { showFeed.value = true; } },
  { id: 'notif', emoji: '🔔', label: 'Notifications', action: () => { showNotifications.value = !showNotifications.value; }, badge: () => backendStore.unreadNotificationCount },
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
  for (const newId of ['notif', 'chat']) {
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
  />
  <activity-feed-panel v-if="showFeed" @hide="showFeed = false" />
  <!-- Help requests now live in Cell Library's Help tab -->
  <proofreading-queue-panel v-if="showQueue" @hide="showQueue = false" />
  <cell-library-panel v-if="showCellLibrary" :initial-tab="cellLibraryInitialTab" @hide="showCellLibrary = false; cellLibraryInitialTab = undefined" />
  <batch-processor-panel v-if="showBatchProcessor" @hide="showBatchProcessor = false" />
  <volumes-overlay v-visible="showModal" @hide="showModal = false" />
  <user-profile-panel v-if="showProfile" @hide="showProfile = false" @open-settings="showSettings = true" />
  <weekly-recap-panel v-if="showRecap" @hide="showRecap = false" />
  <leaderboard-panel v-if="showLeaderboard" @hide="showLeaderboard = false" />
  <settings-panel v-if="showSettings" @hide="showSettings = false" />
  <notification-feed-panel v-if="showNotifications" @hide="showNotifications = false" />
  <chat-panel v-if="showChat" @hide="showChat = false" />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <a href="https://h01-release.storage.googleapis.com/explore.html" target="_blank">
        <img src="insert-logo" title="Cave Explorer">
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
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
      ><span v-if="icon.svg" v-html="icon.svg"></span><template v-else>{{ icon.emoji }}</template><span v-if="icon.badge && icon.badge() > 0" class="nge-toolbar-badge">{{ icon.badge() }}</span></button>
    </div>

    <!-- Merge/Split celebration burst -->
    <Transition name="nge-edit-burst">
      <div v-if="editCelebration" class="nge-edit-celebration" :class="'nge-edit-celebration--' + editCelebration">
        <span class="nge-edit-celebration-icon">{{ editCelebration === 'merge' ? '🔗' : '✂️' }}</span>
        <span class="nge-edit-celebration-text">{{ editCelebration === 'merge' ? 'Merged!' : 'Split!' }}</span>
        <span v-for="i in 8" :key="i" class="nge-edit-spark" :style="{ '--spark-i': i }"></span>
      </div>
    </Transition>

    <button v-if="login.sessions.length > 0" @click="showProfile = true" id="profileBtn">My Profile</button>
    <template v-if="login.sessions.length > 0">
      <dropdown-list dropdown-group="extension-bar-right" id="loginsDropdown" class="rightMost">
          <template #buttonTitle>Logins ({{ login.sessions.length }})</template>
          <template #listItems>
            <li v-for="session of validLogins">
              <div class="loginRow">
                <div class="loginData">
                  <div>{{ session.email }}</div>
                  <div>{{ session.hostname }}</div>
                </div>
                <div class="logoutButton" @click="logout(session)"><span>Logout</span></div>
              </div>
            </li>
            <li v-for="session in invalidLogins">
              <div class="loginRow">
                <div class="loginData expired">
                  <div>{{ session.hostname }} - Expired</div>
                </div>
                <div class="logoutButton" @click="logout(session)"><span>Delete</span></div>
              </div>
            </li>
          </template>
        </dropdown-list>
    </template>
    <dropdown-list dropdown-group="extension-bar-right" id="hamburger" class="rightMost">
      <template #buttonTitle>☰</template>
      <template #listItems>
        <li>
          <div class="logoutButton button" @click="tutorialStep = 0">
            <span>Reset Tutorial</span>
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

.ng-extend-logo > a, .ng-extend-logo > a > img {
  height: 100%;
}

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
  padding: 0 6px;
  height: 100%;
}

.nge-icon-btn {
  font-size: 14px;
  width: 32px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
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
