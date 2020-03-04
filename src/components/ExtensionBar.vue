<template>
  <div id="extensionBar" @mousedown.stop.prevent>
    <button class="toggleSidebarButton" @click="toggleSidebar()">
      <img
        v-show="!showSidebar"
        src="images/chevron.svg"
        width="20"
        style="transform: rotate(90deg);"
        title="Show sidebar"
      />
      <img
        v-show="showSidebar"
        src="images/chevron.svg"
        width="20"
        style="transform: rotate(270deg);"
        title="Hide sidebar"
      />
    </button>
    <div class="flex-fill"></div>
    <stopwatch />
    <div class="flex-fill"></div>
    <button @click="appState.showDatasetChooser=true">Choose Dataset</button>

    <template v-if="appState.loggedInUser">
      <div>{{ appState.loggedInUser.name }} ({{ appState.loggedInUser.email }})</div>
    </template>

    <dropdown-list>
      <template #buttonTitle>Settings</template>
      <template #listItems>
        <li>
          <button @click="toggleNeuroglancerUI">Toggle Neuroglancer UI</button>
        </li>
        <template v-if="appState.loggedInUser">
          <li>
            <button @click="appState.logout">Logout</button>
          </li>
        </template>
      </template>
    </dropdown-list>

    <button>yo</button>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy } from "../state";
import { viewer } from "../main";

import DropdownList from "components/DropdownList.vue";
import Stopwatch from "components/Stopwatch.vue";

export default Vue.extend({
  components: { DropdownList, Stopwatch },
  data() {
    return {
      appState: storeProxy,
      showSidebar: localStorage.getItem("visible") !== "false"
    };
  },
  methods: {
    toggleNeuroglancerUI() {
      if (viewer) {
        viewer.uiConfiguration.showUIControls.toggle();
      }
    },
    toggleSidebar() {
      this.$root.$emit("toggleSidebar");
      this.showSidebar = !this.showSidebar;
    }
  }
});
</script>

<style>
#extensionBar {
  display: flex;
  height: 30px;
  align-items: center;
  background-color: var(--color-dark-bg);
  z-index: 3;
}

#extensionBar > * {
  height: 100%;
  display: flex;
  align-items: center;
}

#extensionBar > button {
  padding: 0 16px;
}

#extensionBar > .toggleSidebarButton {
  width: 250px;
}
</style>
