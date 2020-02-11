<template>
  <div class="overlays">
    <dataset-chooser v-if="appState.showDatasetChooser" @hide="appState.showDatasetChooser=false"/>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import DatasetChooser from "components/DatasetChooser.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { DatasetChooser }
});
</script>

<style>
.overlays {
  position: fixed;
  width: 100%;
  height: 100%;
  z-index: 4;
  pointer-events: none;
}
</style>
