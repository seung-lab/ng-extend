<template>
  <div class="overlays">
    <dataset-chooser v-if="appState.showDatasetChooser" @hide="appState.showDatasetChooser=false"/>
    <cell-chooser v-if="appState.showCellChooser" @hide="appState.showCellChooser=false"/>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import DatasetChooser from "components/DatasetChooser.vue";
import CellChooser from "components/CellChooser.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { DatasetChooser, CellChooser }
});
</script>

<style>
.overlays {
  position: fixed;
  width: 100%;
  height: 100%;
  z-index: 100;
  pointer-events: none;
}
</style>
