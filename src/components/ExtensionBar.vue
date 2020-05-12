<template>
  <div id="extensionBar">
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

    <div class="ng-extend-spacer"></div>

    <template v-if="appState.loadedViewer">
      <dropdown-list type="chooser" dropdown-group="extension-bar-right" id="datasetChooser" width="220px">
        <template #chooserTitle>
          <span :style="{color: appState.activeDataset.color}">
            {{ appState.activeDataset ? "Dataset: " + appState.activeDataset.name : "Choose Dataset" }}
          </span>
        </template>
        <template #listItems>
          <li v-for="dataset of datasets" :key="dataset.name" :class="'nge-dataset-button' + (dataset === activeDataset ? ' selected' : '')">
            <div @click="selectDataset(dataset)">
              <div class="nge-dataset-button-name">{{ dataset.name }}</div>
              <div class="nge-dataset-button-description">{{ dataset.description }}</div>
            </div>
          </li>
        </template>
      </dropdown-list>

      <div class="ng-extend-spacer"></div>

      <template v-if="appState.activeDataset && appState.activeDataset.name === 'Sandbox'">
        <button @click="resetDataset()" class="resetDataset iconBtn" title="Reset Dataset"></button>
        <div class="ng-extend-spacer"></div>
      </template>

      <template v-if="appState.loggedInUser">
        <dropdown-list dropdown-group="extension-bar-right" id="loggedInUserDropdown">
          <template #buttonTitle></template>
          <template #listItems>
            <user-card></user-card>
          </template>
        </dropdown-list>
        <div class="ng-extend-spacer"></div>
      </template>

      <button @click="appState.toggleSidePanel()" class="toggleControls iconBtn" :class="{open: appState.viewer.sidebar.open}" title="Toggle Controls"></button>

      <div class="ng-extend-spacer"></div>

      <dropdown-list dropdown-group="extension-bar-right" id="moreActions">
        <template #buttonTitle></template>
        <template #listItems>
          <li v-for="item of appState.actionsMenuItems" :key="item.text">
            <button @click="clickAction(item)">{{ item.text }}</button>
          </li>
        </template>
      </dropdown-list>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy, CellDescription, DatasetDescription, ActionsMenuItem } from "../state";

import DropdownList from "components/DropdownList.vue";
import Stopwatch from "components/Stopwatch.vue";
import UserCard from "components/UserCard.vue";

export default Vue.extend({
  components: { DropdownList, Stopwatch, UserCard },
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
    // toggleNeuroglancerUI() {
    //   if (viewer) {
    //     viewer.uiConfiguration.showUIControls.toggle();
    //   }
    // },
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
    },
    resetDataset() {
      if (this.appState.activeDataset) {
        this.appState.selectDataset(this.appState.activeDataset);
      }
    },
    clickAction(item: ActionsMenuItem) {
      this.$root.$emit("closeDropdowns");
      item.click();
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
  z-index: 30;
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

.ng-extend-spacer {
  width: 10px;
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
  background-size: 70%;
}

#moreActions > button {
  background-image: url('images/more.svg');
  background-size: 70%;
}

#extensionBar .resetDataset {
  background-image: url('images/reset.svg');
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
}
</style>
