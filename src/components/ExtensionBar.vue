<template>
  <div id="extensionBar" @mousedown.stop.prevent>
    <button :class="'toggleSidebarButton' + (showSidebar ? ' expanded' : '')" @click="toggleSidebar()">
      <img
        v-show="!showSidebar"
        src="images/menu.svg"
        width="30"
        title="Show sidebar"
      />
      <img
        v-show="showSidebar"
        src="images/menu_open.svg"
        width="30"
        title="Hide sidebar"
      />
    </button>

        <div id="insertNGTopBar" class="flex-fill"></div>
    <div class="flex-fill"></div>
    <stopwatch />
    <div class="flex-fill"></div>
    <button @click="appState.showDatasetChooser=true">Choose Dataset</button>

    
    <template v-if="appState.loggedInUser">
      <dropdown-list dropdown-group="blah">
        <template #buttonTitle>{{ appState.loggedInUser.name }}</template>
        <template #listItems>
          <li><div>Email: {{ appState.loggedInUser.email }}</div></li>
          <li><button @click="appState.logout">Logout</button></li>
        </template>
      </dropdown-list>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy, CellDescription } from "../state";
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
  computed: {
    cells() {
      return (storeProxy.activeDataset && storeProxy.activeDataset.curatedCells) || [];
    },
    activeCells() {
      return storeProxy.activeCells;
    }
  },
  methods: {
    boop() {
      console.log('boop');
      this.$emit('hideDropdowns');
    },
    toggleNeuroglancerUI() {
      if (viewer) {
        viewer.uiConfiguration.showUIControls.toggle();
      }
    },
    selectCell: async function(cell: CellDescription) {
      const success = await this.appState.selectCell(cell);

      if (success) {
        // this.$emit('hide');
      } else {
        console.warn("cannot select cell because viewer is not yet created");
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
#insertNGTopBar > div {
  width: 100%;
}

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

#extensionBar > button, #extensionBar > .dropdownList > button {
  padding: 0 8px;
}

#extensionBar > .toggleSidebarButton {
  transition: width 0.2s;
  width: 65px;
}

#extensionBar > .toggleSidebarButton.expanded {
  width: 250px;
}
</style>
