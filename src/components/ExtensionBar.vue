<template>
  <div id="extensionBar" @mousedown.stop.prevent>
    <button class="toggleSidebarButton" @click="toggleSidebar()">Toggle Sidebar</button>
    <div class="flex-fill"></div>
    <button @click="appState.showDatasetChooser=true">Choose Dataset</button>
    
    <template v-if="appState.loggedInUser">
      <div>{{ appState.loggedInUser.name }} ({{ appState.loggedInUser.email }})</div>
    </template>
    
    <dropdown-list>
      <template #buttonTitle>Settings</template>
      <template #listItems>
        <li><button @click="toggleNeuroglancerUI">Toggle Neuroglancer UI</button></li>
        <template v-if="appState.loggedInUser">
          <li><button @click="appState.logout">Logout</button></li>
        </template>
      </template>
    </dropdown-list>

    <button>yo</button>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy} from "../state";
import {viewer} from "../main";

import DropdownList from "components/DropdownList.vue";

export default Vue.extend({
  components: {DropdownList},
  data() {
    return {
      appState: storeProxy
    }
  },
  methods: {
    toggleNeuroglancerUI() {
      if (viewer) {
        viewer.uiConfiguration.showUIControls.toggle();
      }
    },
    toggleSidebar() {
      this.$root.$emit('toggleSidebar');
    }
  },
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
