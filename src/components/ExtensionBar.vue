<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VolumesOverlay from "#src/components/VolumesOverlay.vue";
import UserProfile from "#src/components/UserProfile.vue";
import DropdownList from "#src/components/DropdownList.vue";
import { loginSession, useLoginStore, useVolumesStore } from "#src/store.js";
import logoImage from "#src/eyewire-logo.svg?raw";

import { useStatsStore } from "#src/store-pyr.js";
import { storeToRefs } from "pinia";
const store = useStatsStore();
const { showLeaderboard } = storeToRefs(store);


const login = useLoginStore();
window.addEventListener("middleauthlogin", () => {
  login.update();
});
login.update();

const validLogins = computed(() =>
  login.sessions.filter((x) => x.status === undefined)
);
const invalidLogins = computed(() =>
  login.sessions.filter((x) => x.status !== undefined)
);

const { volumes } = useVolumesStore();

onMounted(() => {
  (
    document.querySelector(".ng-extend-logo > a > .logo")! as HTMLElement
  ).innerHTML = logoImage;
});

const showVolumes = ref(false);
const showUserProfile = ref(false);

function logout(session: loginSession) {
  login.logout(session);
}
</script>

<template>
  <volumes-overlay v-if="showVolumes" @hide="showVolumes = false" />
  <user-profile v-visible="showUserProfile" @hide="showUserProfile = false" />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <a href="https://eyewire.ai/" target="_blank">
        <div class="logo"></div>
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <button v-if="volumes.length" @click="showVolumes = true">
      Volumes ({{ volumes.length }})
    </button>
    <template v-if="login.sessions.length > 0">
      <dropdown-list dropdown-group="extension-bar-right" id="loginsDropdown" class="rightMost">
        <template v-if="login.sessions.length === 1" #buttonTitle>{{ validLogins[0].name }}</template>
        <template v-else #buttonTitle>Logins ({{ login.sessions.length }})</template>
        <template #listItems>
          <li v-for="session of validLogins">
            <div class="loginRow">
              <div class="loginData">
                <div>{{ session.email }}</div>
                <div>{{ session.hostname }}</div>
              </div>
              <div class="viewProfileButton button" @click="showUserProfile = true">
                <span>Profile</span>
              </div>
              <div class="logoutButton button" @click="logout(session)">
                <span>Logout</span>
              </div>
            </div>
          </li>
          <li v-for="session in invalidLogins">
            <div class="loginRow">
              <div class="loginData expired">
                <div>{{ session.hostname }} - Expired</div>
              </div>
              <div class="logoutButton" @click="logout(session)">
                <span>Delete</span>
              </div>
            </div>
          </li>
        </template>
      </dropdown-list>
    </template>
    <dropdown-list dropdown-group="extension-bar-right" id="hamburger" class="rightMost">
      <template #buttonTitle>☰</template>
      <template #listItems>
        <li v-if="showLeaderboard === false">
          <div class="logoutButton button">
            <span @click="showLeaderboard = true">Show Leaderboard</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://forum.eyewire.org">Forum</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span>Quickstart Guide</span>
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
            <span><a target="_blank" href="https://youtu.be/48GS9Sizrvw">Merge Guide</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://youtu.be/DB6wmQWGsck">Split Guide</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" href="https://youtu.be/CGooeAhSryg">Find path Guide</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank"
                href="https://www.youtube.com/playlist?list=PLZlCbXsRJFCw0BLFWKrc49JHKWK1o41Ud">Advanced
                Videos</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span>Cells to Map</span>
          </div>
        </li>
      </template>
    </dropdown-list>
  </div>
</template>

<style>
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

.dropdownList:last-child .dropdownMenu {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

#extensionBar>button,
#extensionBar>div>button {
  font-size: 10pt;
  padding: 0 10px;
}

#insertNGTopBar>div {
  width: 100%;
}

#extensionBar {
  width: 100vw;
  display: flex;
  height: 40px;
  align-items: center;
  background-color: var(--color-dark-bg);
  z-index: 30;
}

#extensionBar>* {
  height: 100%;
  display: flex;
  align-items: center;
}

#loginsDropdown li.none {
  opacity: 0.5;
  padding: 0 10px;
}

#loginsDropdown li>div:last-child {
  border-bottom: none;
}

#loginsDropdown li>div {
  display: grid;
  border-bottom: 1px solid #4a4a4a;
}

#loginsDropdown .loginData {
  white-space: nowrap;
}

#loginsDropdown .button {
  cursor: pointer;
}

#loginsDropdown .loginRow>* {
  padding: 10px;
  display: grid;
  align-content: center;
  justify-content: center;

}

#loginsDropdown .loginRow>*:hover {
  background-color: #ffffff33;
}

#loginsDropdown .loginRow:hover .logoutButton:hover {
  background-color: #db4437;
}

#loginsDropdown li.header {
  padding: 5px;
  background-color: #ffffff1c;
}

#loginsDropdown .loginData.expired {
  opacity: 0.75;
}

.ng-extend-logo>a>.logo {
  width: 40px;
}
</style>
