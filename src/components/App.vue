<template>
  <div id="vueMain" v-on:keyup.d="appState.showDatasetChooser = !appState.showDatasetChooser">
    <div id="extensionBar">
      <button @click="appState.showDatasetChooser=true">Choose Dataset</button>
      <button @click="toggleNeuroglancerUI">Toggle Neuroglancer UI</button>
      <auth />
    </div>
    <div id="neuroglancer-container"></div>
    <div class="overlays">
      <dataset-chooser v-if="appState.showDatasetChooser" @hide="appState.showDatasetChooser=false"/>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Auth from "components/Auth.vue";
import DatasetChooser from "components/DatasetChooser.vue";
import {viewer} from "../main";
import {storeProxy} from "../state";

export default Vue.extend({
  data: () => {
    return {
      appState: storeProxy,
    }
  },
  components: { Auth, DatasetChooser },
  methods: {
    toggleNeuroglancerUI() {
      if (viewer) {
        viewer.uiConfiguration.showUIControls.toggle();
      }
    }
  }
});
</script>

<style>
#vueMain {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  font-family: sans-serif;
}

#vueMain ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#extensionBar {
  display: grid;
  grid-template-columns: min-content min-content min-content;
  white-space: nowrap;
  justify-content: end;
  grid-column-gap: 20px;
  height: 30px;
  align-items: center;
}
</style>