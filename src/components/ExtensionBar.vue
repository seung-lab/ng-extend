<template>
  <div id="extensionBar" @mousedown.stop.prevent>
    <button class="toggleSidebarButton" @click="toggleSidebar()">
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

    <div class="ng-extend-logo">
      <a href="https://flywire.ai/" target="_blank">
        <img src="images/logo-filled.png" height=22 title="FlyWire">
      </a>
    </div>

    <div id="insertNGTopBar" class="flex-fill"></div>

    <!-- <div class="flex-fill"></div>
    <stopwatch />
    <div class="flex-fill"></div> -->

    <dropdown-list dropdown-group="dataset">
      <template #buttonTitle>Dataset: {{ appState.activeDataset ? appState.activeDataset.name : "N/A" }}</template>
      <template #listItems>
        <li v-for="dataset of datasets" :key="dataset.name" :class="{selected: dataset === activeDataset}">
          <button @click="selectDataset(dataset)">{{ dataset.name }}</button>
        </li>
      </template>
    </dropdown-list>

    <template v-if="appState.loggedInUser">
      <dropdown-list dropdown-group="blah" id="loggedInUserDropdown">
        <template #buttonTitle class="foo"></template>
        <template #listItems>
          <li><div>Email: {{ appState.loggedInUser.name }}</div></li>
          <li><div>Email: {{ appState.loggedInUser.email }}</div></li>
          <li><button @click="appState.logout">Logout</button></li>
        </template>
      </dropdown-list>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy, CellDescription, DatasetDescription } from "../state";
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
    },
    datasets() {
      return storeProxy.datasets;
    },
    activeDataset() {
      return storeProxy.activeDataset;
    }
  },
  methods: {
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
    },
    selectDataset: async function(dataset: DatasetDescription) {
      const success = await this.appState.selectDataset(dataset);

      if (success) {
        this.$root.$emit("closeDropdowns");
      } else {
        console.warn("cannot select dataset because viewer is not yet created");
      }
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
  height: 40px;
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
  width: 65px;
  justify-content: center;
}

.ng-extend-logo {
  width: 150px;
  padding-left: 20px;
  padding-right: 20px;
}

.ng-extend-logo > a {
  height: 22px;
}

#loggedInUserDropdown > button {
  width: 40px;
  background-image: url('images/user.svg');
  background-repeat: no-repeat;
  background-position: center;
  background-size: 70%;
}
</style>
