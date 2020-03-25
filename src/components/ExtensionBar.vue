<template>
  <div id="extensionBar" @mousedown.stop.prevent>
    <div class="flex-fill"></div>
    <button @click="appState.showDatasetChooser=true">Choose Dataset</button>
    
    <template v-if="appState.loggedInUser">
      <div>{{ appState.loggedInUser.name }} ({{ appState.loggedInUser.email }})</div>
    </template>
    
    <dropdown-list dropdown-group="blah">
      <template #buttonTitle>Settings</template>
      <template #listItems>
        <li><button @click="toggleNeuroglancerUI">Toggle Neuroglancer UI</button></li>
        <template v-if="appState.loggedInUser">
          <li><button @click="appState.logout">Logout</button></li>
        </template>
      </template>
    </dropdown-list>


    <dropdown-list dropdown-group="blah">
      <template #buttonTitle>Cells</template>
      <template #listItems>
        <li v-for="cell of cells" v-bind:key="cell.id" :class="{selected: activeCells.includes(cell)}"><button @click="selectCell(cell)">{{ cell.id }}</button></li>
      </template>
    </dropdown-list>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy, CellDescription} from "../state";
import {viewer} from "../main";

import DropdownList from "components/DropdownList.vue";

export default Vue.extend({
  components: {DropdownList},
  data() {
    return {
      appState: storeProxy
    }
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

#extensionBar > button, #extensionBar > .dropdownList > button {
  padding: 0 8px;
}
</style>
