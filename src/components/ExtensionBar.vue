<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import VolumesOverlay from "components/VolumesOverlay.vue";
import DropdownList from "components/DropdownList.vue";
import UserProfilePanel from "components/UserProfilePanel.vue";
import WeeklyRecapPanel from "components/WeeklyRecapPanel.vue";
import LeaderboardPanel from "components/LeaderboardPanel.vue";
import SettingsPanel from "components/SettingsPanel.vue";
import AnnotationPanel from "components/AnnotationPanel.vue";
import LoginModal from "components/LoginModal.vue";
import HelpRequestsPanel from "components/HelpRequestsPanel.vue";
import ProofreadingQueuePanel from "components/ProofreadingQueuePanel.vue";
import CommandPalette from "components/CommandPalette.vue";
import AchievementToast from "components/AchievementToast.vue";

import {loginSession, useLoginStore, useVolumesStore, useUserStatsStore, useSegmentAnnotationStore, useHelpRequestStore, useProofreadingQueueStore} from '../store';
import {storeToRefs as storeToRefsAnnot} from 'pinia';
import {storeToRefs} from 'pinia';

import logoImage from '../CaveLogo-clear.png';

const login = useLoginStore();
window.addEventListener("middleauthlogin", () => {
  login.update();
});
login.update();

const validLogins = computed(() => login.sessions.filter(x => x.status === undefined));
const invalidLogins = computed(() => login.sessions.filter(x => x.status !== undefined));

const {volumes} = useVolumesStore();

onMounted(() => {
  (document.querySelector('.ng-extend-logo > a > img')! as HTMLImageElement).src = logoImage;
});

const { stats } = storeToRefs(useUserStatsStore());
const { activeSegId } = storeToRefsAnnot(useSegmentAnnotationStore());
const helpStore = useHelpRequestStore();
const queueStore = useProofreadingQueueStore();

const showModal = ref(false);
const showProfile = ref(false);
const showRecap = ref(false);
const showLeaderboard = ref(false);
const showSettings = ref(false);
const showHelp = ref(false);
const showQueue = ref(false);
const cmdPalette = ref<InstanceType<typeof CommandPalette> | null>(null);

function logout(session: loginSession) {
  login.logout(session);
}

</script>

<template>
  <login-modal />
  <annotation-panel />
  <achievement-toast />
  <command-palette
    ref="cmdPalette"
    @open-profile="showProfile = true"
    @open-recap="showRecap = true"
    @open-leaderboard="showLeaderboard = true"
    @open-settings="showSettings = true"
    @open-help="showHelp = true"
    @open-queue="showQueue = true"
  />
  <help-requests-panel v-if="showHelp" @hide="showHelp = false" />
  <proofreading-queue-panel v-if="showQueue" @hide="showQueue = false" />
  <volumes-overlay v-visible="showModal" @hide="showModal = false" />
  <user-profile-panel v-if="showProfile" @hide="showProfile = false" @open-settings="showSettings = true" />
  <weekly-recap-panel v-if="showRecap" @hide="showRecap = false" />
  <leaderboard-panel v-if="showLeaderboard" @hide="showLeaderboard = false" />
  <settings-panel v-if="showSettings" @hide="showSettings = false" />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <a href="https://h01-release.storage.googleapis.com/explore.html" target="_blank">
        <img src="insert-logo" title="Cave Explorer">
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <button v-if="volumes.length" @click="showModal = true">Volumes ({{ volumes.length }})</button>
    <div class="nge-status-legend">
      <div class="nge-legend-item">
        <span class="nge-legend-pip nge-legend-pip--complete"></span> Completed
      </div>
      <div class="nge-legend-item">
        <span class="nge-legend-pip nge-legend-pip--annotated"></span> Annotated
      </div>
      <div class="nge-legend-item">
        <span class="nge-legend-pip nge-legend-pip--incomplete"></span> Incomplete
      </div>
    </div>
    <div v-if="login.sessions.length > 0 && stats.currentStreak > 0"
         class="nge-streak-chip" title="Your current editing streak">
      🔥 {{ stats.currentStreak }}
    </div>
    <button class="nge-cmd-trigger" title="Command Palette (Ctrl+K)"
            @click="cmdPalette?.open()">
      <kbd>⌘K</kbd>
    </button>
    <button v-if="login.sessions.length > 0"
            class="nge-recap-btn" title="Your Week in Science"
            @click="showRecap = true">📊</button>
    <button v-if="login.sessions.length > 0"
            class="nge-lb-btn" title="Leaderboard"
            @click="showLeaderboard = true">🏆</button>
    <button v-if="login.sessions.length > 0"
            class="nge-queue-btn" title="Quest Board"
            @click="showQueue = true">
      🧠<span v-if="queueStore.pendingCount()" class="nge-queue-badge">{{ queueStore.pendingCount() }}</span>
    </button>
    <button v-if="login.sessions.length > 0"
            class="nge-help-btn" title="Second Opinion Requests"
            @click="showHelp = true">
      🔍<span v-if="helpStore.pending.length" class="nge-help-badge">{{ helpStore.pending.length }}</span>
    </button>
    <button v-if="login.sessions.length > 0"
            class="nge-settings-btn" title="Profile Settings"
            @click="showSettings = true">⚙️</button>
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

.nge-recap-btn {
  font-size: 14px;
  padding: 0 8px;
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s;
}

.nge-recap-btn:hover {
  opacity: 1;
}

.nge-lb-btn,
.nge-settings-btn {
  font-size: 14px;
  padding: 0 8px;
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s;
}

.nge-lb-btn:hover,
.nge-help-btn:hover,
.nge-settings-btn:hover {
  opacity: 1;
}

.nge-queue-btn {
  font-size: 14px;
  padding: 0 8px;
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s;
  position: relative;
}
.nge-queue-btn:hover { opacity: 1; }

.nge-queue-badge {
  position: absolute;
  top: 4px;
  right: 2px;
  background: #7c4dff;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
  min-width: 14px;
  height: 14px;
  line-height: 14px;
  text-align: center;
  padding: 0 3px;
}

.nge-help-btn {
  font-size: 14px;
  padding: 0 8px;
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s;
  position: relative;
}

.nge-help-badge {
  position: absolute;
  top: 4px;
  right: 2px;
  background: #f5a623;
  color: #000;
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
  min-width: 14px;
  height: 14px;
  line-height: 14px;
  text-align: center;
  padding: 0 3px;
}

.nge-cmd-trigger {
  display: flex;
  align-items: center;
  padding: 0 8px;
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.15s;
}
.nge-cmd-trigger:hover { opacity: 0.9; }
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
</style>
