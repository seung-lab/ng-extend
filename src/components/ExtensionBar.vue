<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import VolumesOverlay from "components/VolumesOverlay.vue";
import UserProfile from "components/UserProfile.vue";
import DropdownList from "components/DropdownList.vue";

import {loginSession, useLoginStore, useVolumesStore, useStatsStore, useChatStore, useLayersStore} from '../store';
import {connectChatSocket} from '../chat_socket';

import logoGemImage from '../images/pyr-icon.png';
import logoTextImage from '../images/pyr-logo-wordmark.png';
import userProfileImage from '../images/user.png';

function encodeSVG(svg: string) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function initLoginServices() {
  const {loopUpdateLeaderboard} = useStatsStore();
  loopUpdateLeaderboard();
  connectChatSocket();
  const {joinChat} = useChatStore();
  joinChat();
}

const login = useLoginStore();
window.addEventListener("middleauthlogin", () => {
  login.update();
});
login.update().then(() => initLoginServices());

const validLogins = computed(() => login.sessions.filter(x => x.status === undefined));
const invalidLogins = computed(() => login.sessions.filter(x => x.status !== undefined));

const {volumes} = useVolumesStore();

const {checkout} = useLayersStore();

onMounted(() => {
  (document.querySelector('.pyr-logo-gem')! as HTMLImageElement).src = logoGemImage;
  (document.querySelector('.pyr-logo-text')! as HTMLImageElement).src = logoTextImage;
  (document.querySelector('.user-profile-img')! as HTMLImageElement).src = userProfileImage;
});

const showVolumes = ref(false);
const showUserProfile = ref(false);

function logout(session: loginSession) {
  login.logout(session);
}

function openUserProfile() {
  showUserProfile.value = true;
  const badgeEls = document.querySelectorAll('.nge-user-profile-badge');
  let i = 0;
  const delay = 300;
  for (const badgeEl of badgeEls) {
    badgeEl.classList.add('animate-hide');
    setTimeout(function() {
      badgeEl.classList.remove('animate-hide');
      badgeEl.classList.add('animate-fade-in');
      //reset animation
      (badgeEl as HTMLElement).style.animation = 'none';
      (badgeEl as HTMLElement).offsetHeight;
      (badgeEl as HTMLElement).style.animation = '';
    }, i * delay);
    i++;
  }
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
    <button @click="checkout()">Checkout</button>
    <button v-if="volumes.length" @click="showVolumes = true">Volumes ({{ volumes.length }})</button>
    <button @click="openUserProfile()">
      <img class="user-profile-img" src="insert-img" title="User Profile" height="15">
    </button>
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
            <li v-for="session of invalidLogins">
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

/*.ng-extend-logo > a, .ng-extend-logo > a > img {
  height: 100%;
}*/
.ng-extend-logo {
  padding-right: 20px;
}
.pyr-logo-gem {
  padding-left: 15px;
  padding-right: 12px;
}
</style>
