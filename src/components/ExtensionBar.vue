<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VolumesOverlay from "#src/components/VolumesOverlay.vue";
import DropdownList from "#src/components/DropdownList.vue";
import { loginSession, useLoginStore, useVolumesStore } from "#src/store.js";
import logoImage from "#src/CaveLogo-clear.png";

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
    document.querySelector(".ng-extend-logo > a > img")! as HTMLImageElement
  ).src = logoImage;
});

const showVolumes = ref(false);

function logout(session: loginSession) {
  login.logout(session);
}
</script>

<template>
  <volumes-overlay v-if="showVolumes" @hide="showVolumes = false" />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <a href="https://flywire.ai/" target="_blank">
        <img src="insert-logo" title="Cave Explorer" />
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <button v-if="volumes.length" @click="showVolumes = true">
      Volumes ({{ volumes.length }})
    </button>
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
  grid-template-columns: auto min-content;
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

.ng-extend-logo>a,
.ng-extend-logo>a>img {
  height: 100%;
}
</style>
