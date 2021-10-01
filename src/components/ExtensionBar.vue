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
    <div class="ng-extend-spacer"></div>

    <template v-if="appState.loadedViewer">
      <dropdown-list type="chooser" dropdown-group="extension-bar-right" id="imageDatasetChooser" width="240px" hover="Choose image">
        <template #chooserTitle>
          <span :style="{color: appState.activeImageDataset ? appState.activeImageDataset.color : undefined}">
            {{ appState.activeImageDataset ? "Image: " + appState.activeImageDataset.name : "Choose Image" }}
          </span>
        </template>
        <template #listItems>
          <li v-for="dataset of imageDatasets" :key="dataset.name" :class="'nge-dataset-button' + (dataset === activeImageDataset ? ' selected' : '')">
            <div @click="selectImageDataset(dataset)">
              <div class="nge-dataset-button-name">{{ dataset.name }}</div>
              <div class="nge-dataset-button-description">{{ dataset.description }}</div>
            </div>
          </li>
        </template>
      </dropdown-list>
      <div class="ng-extend-spacer"></div>
      <dropdown-list type="chooser" dropdown-group="extension-bar-right" id="segmentationDatasetChooser" width="220px" hover="Choose dataset">
        <template #chooserTitle>
          <span :style="{color: appState.activeSegmentationDataset ? appState.activeSegmentationDataset.color : undefined}">
            {{ appState.activeSegmentationDataset ? "Dataset: " + appState.activeSegmentationDataset.name : "Choose Dataset" }}
          </span>
        </template>
        <template #listItems>
          <li v-for="dataset of segmentationDatasets" :key="dataset.name" :class="'nge-dataset-button' + (dataset === activeSegmentationDataset ? ' selected' : '')">
            <div @click="selectSegmentationDataset(dataset)">
              <div class="nge-dataset-button-name">{{ dataset.name }}</div>
              <div class="nge-dataset-button-description">{{ dataset.description }}</div>
            </div>
          </li>
        </template>
      </dropdown-list>

      <div class="ng-extend-spacer"></div>

      <template v-if="appState.activeSegmentationDataset && appState.activeSegmentationDataset.name === 'Sandbox'">
        <button @click="resetDataset()" class="resetDataset iconBtn" title="Restore default neurons"></button>
        <div class="ng-extend-spacer"></div>
      </template>

      <template v-if="appState.loggedInUser">
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
      </template>

      <button @click="appState.toggleSidePanel()" class="toggleControls iconBtn" :class="{open: appState.viewer.sidebar.open}" title="Toggle controls"></button>

      <div class="ng-extend-spacer"></div>

      <dropdown-list dropdown-group="extension-bar-right" id="moreActions" hover="More actions">
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
import { storeProxy, viewer, CellDescription, DatasetDescription, ActionsMenuItem } from "../state";

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
      return (storeProxy.activeSegmentationDataset && storeProxy.activeSegmentationDataset.curatedCells) || [];
    },
    activeCells() {
      return storeProxy.activeCells;
    },
    imageDatasets() {
      return storeProxy.imageDatasets;
    },
    segmentationDatasets() {
      return storeProxy.segmentationDatasets;
    },
    activeImageDataset() {
      return storeProxy.activeImageDataset;
    },
    activeSegmentationDataset() {
      return storeProxy.activeSegmentationDataset;
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
    selectImageDataset: async function(dataset: DatasetDescription) {
      const success = await this.appState.selectImageDataset(dataset);

      if (success) {
        this.$root.$emit("closeDropdowns");
      } else {
        console.warn("cannot select dataset because viewer is not yet created");
      }
    },
    selectSegmentationDataset: async function(dataset: DatasetDescription) {
      const success = await this.appState.selectSegmentationDataset(dataset);

      if (success) {
        this.$root.$emit("closeDropdowns");
      } else {
        console.warn("cannot select dataset because viewer is not yet created");
      }
    },
    resetDataset() {
      this.appState.showResetConfirm = true;
    },
    showAdminPanel() {
      this.appState.showAdminPanel = true;
    },
    clickAction(item: ActionsMenuItem) {
      this.$root.$emit("closeDropdowns");
      item.click();
    }
  },
  mounted() {
    this.$root.$on("confirmReset", () => {
      if (this.appState.activeImageDataset && this.appState.activeSegmentationDataset) {
        this.appState.selectImageDataset(this.appState.activeImageDataset);
        this.appState.selectSegmentationDataset(this.appState.activeSegmentationDataset);
      }

      if (viewer) {
        viewer.layout.reset();
      }

      if (!this.showSidebar) {
        this.toggleSidebar();
      }
    });
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

#extensionBar .resetDataset {
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
}
</style>
