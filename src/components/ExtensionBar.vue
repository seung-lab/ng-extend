<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VolumesOverlay from "#src/components/VolumesOverlay.vue";
import UserProfile from "#src/components/UserProfile.vue";
import DropdownList from "#src/components/DropdownList.vue";
import { loginSession, useLoginStore, useVolumesStore } from "#src/store.js";
import logoGemImage from '#src/images/pyr-icon.png';
import logoTextImage from '#src/images/pyr-logo-wordmark.png';

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
  (document.querySelector('.pyr-logo-gem')! as HTMLImageElement).src = logoGemImage;
  (document.querySelector('.pyr-logo-text')! as HTMLImageElement).src = logoTextImage;
  // (document.querySelector('.user-profile-img')! as HTMLImageElement).src = userProfileImage;
});

const showVolumes = ref(false);
const showUserProfile = ref(false);

function logout(session: loginSession) {
  login.logout(session);
}
</script>

<template>
  <volumes-overlay v-visible="showVolumes" @hide="showVolumes = false" />
  <user-profile v-visible="showUserProfile" @hide="showUserProfile = false" />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <a href="https://pyr.ai/" target="_blank">
        <img class="pyr-logo-gem" src="insert-img" title="Pyr" width="15">
        <img class="pyr-logo-text" src="insert-img" title="Pyr" width="40">
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <!-- <button v-if="volumes.length" @click="showVolumes = true">
      Volumes ({{ volumes.length }})
    </button> -->
    <template v-if="login.sessions.length > 0">
      <dropdown-list dropdown-group="extension-bar-right" id="loginsDropdown" class="rightMost">
        <template v-if="login.sessions.length === 1" #buttonTitle>👤 {{ validLogins[0].name }}</template>
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
  </div>
</template>

<style>
.dropdownList:last-child .dropdownMenu {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

#extensionBar button {
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
  grid-template-columns: auto;
  border-bottom: 1px solid #4a4a4a;
  align-items: center;
}

#loginsDropdown .loginData {
  white-space: nowrap;
}

#loginsDropdown .logoutButton {}

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

.ng-extend-logo {
  padding-right: 20px;
}

.pyr-logo-gem {
  padding-left: 15px;
  padding-right: 12px;
}
</style>
