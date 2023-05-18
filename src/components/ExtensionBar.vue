<script setup lang="ts">
import DropdownList from "components/DropdownList.vue";
import {useLoginStore} from '../my-db';

const login = useLoginStore();
window.addEventListener("storage", () => {
  console.log('storage changed');
  login.update();
});
login.update();
</script>

<template>
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <a href="https://flywire.ai/" target="_blank">
        <img src="https://ngl.flywire.ai/images/logo-filled.png" height=22 title="FlyWire">
      </a>
    </div>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <template v-if="login.sessions.length > 0">
      <dropdown-list dropdown-group="extension-bar-right" id="loggedInUserDropdown" hover="User profile">
          <template #buttonTitle>Hello</template>
          <template #listItems>
            <div v-for="session in login.sessions">{{ session.url }} - {{ session.name }}</div>
          </template>
        </dropdown-list>
    </template>
     <!-- <template v-if="appState.loggedInUser">
        <dropdown-list dropdown-group="extension-bar-right" id="loggedInUserDropdown" hover="User profile">
          <template #buttonTitle></template>
          <template #listItems>
            <user-card></user-card>
          </template>
        </dropdown-list>
        <div class="ng-extend-spacer"></div>
        <template v-if="appState.loggedInUser.admin">
          <button @click="showAdminPanel()" class="adminPanel iconBtn" title="Admin dashboard"></button>
          <div class="ng-extend-spacer"></div>
        </template>
      </template> -->
  </div>
</template>

<style>
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

/*

#extensionBar > button, #extensionBar > .dropdownList > button {
  padding: 0 8px;
}

#extensionBar > .toggleSidebarButton {
  width: 52px;
  justify-content: center;
}

.ng-extend-logo {
  width: 110px;
  padding-left: 20px;
  padding-right: 20px;
}

.ng-extend-logo > a {
  height: 22px;
}

.ng-extend-spacer {
  width: 10px;
}

#extensionBar button.ng-saver {
  border: 1px solid var(--color-border);
  color: unset;
  font-weight: unset;
  font-size: 0.9em;
  padding: 7px 18px;
  position: relative;
  top: 1.5px;
}
#extensionBar div.unmerged:hover {
  background-color: var(--color-light-bg);
}
#extensionBar div.unmerged {
  width: 40px;
  height: 40px;
  border-radius: unset;
}

#extensionBar button.ng-saver.busy, #extensionBar button.ng-saver.busy:hover {
  background: grey !important;
}

#extensionBar button.ng-saver.dirty {
  border: unset;
  background: var(--gradient-highlight);
}

#extensionBar button.ng-saver.dirty:hover {
  background: var(--gradient-highlight-hover);
}

.nge-dataset-button {
  cursor: pointer;
}

.nge-dataset-button:hover {
  background-color: var(--color-light-bg);
}

.nge-dataset-button-name {
  font-size: 1.3em;
}

.nge-dataset-button-description {
  font-size: 0.8em;
  padding-top: 10px;
}

#extensionBar .iconBtn, #loggedInUserDropdown > button, #moreActions > button {
  background-repeat: no-repeat;
  background-position: center;
  width: 40px;
}

#loggedInUserDropdown > button {
  background-image: url('images/user.svg');
  background-size: 60%;
}

#moreActions > button {
  background-image: url('images/more.svg');
  background-size: 70%;
}

#extensionBar .resetSandbox {
  background-image: url('images/reset.svg');
  background-size: 70%;
}

#extensionBar .adminPanel {
  background-image: url('images/admin.svg');
  background-size: 70%;
}

#extensionBar .toggleControls {
  background-image: url('images/ng-controls.svg');
  background-size: 50%;
}

#extensionBar .toggleControls.open {
  background-color: var(--color-medium-bg);
}

#extensionBar .toggleControls.open:hover {
  background-color: var(--color-light-bg);
} */
</style>
