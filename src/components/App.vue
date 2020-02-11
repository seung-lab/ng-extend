<template>
  <div id="vueMain" v-on:keyup.d="appState.showDatasetChooser = !appState.showDatasetChooser">
    <extension-bar />
    <div id="neuroglancer-container"></div>
    <overlay-container/>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import ExtensionBar from "components/ExtensionBar.vue";
import OverlayContainer from "components/OverlayContainer.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  components: { ExtensionBar, OverlayContainer },
  data: () => {
    return {
      appState: storeProxy,
    }
  }
});
</script>

<style>
@import "../common.css";

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
</style>