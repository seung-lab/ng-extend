<template>
  <div id="vueMain" v-on:keyup.d="appState.showDatasetChooser = !appState.showDatasetChooser"
      v-on:keyup.t="appState.showCellChooser = !appState.showCellChooser">
    <extension-bar />
    <div id="content">
      <leaderboard />
      <div id="neuroglancer-container"></div>
    </div>
    <overlay-container/>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import ExtensionBar from "components/ExtensionBar.vue";
import OverlayContainer from "components/OverlayContainer.vue";
import Leaderboard from "components/Leaderboard.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  components: { ExtensionBar, OverlayContainer, Leaderboard },
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

#content {
  display: grid;
  grid-template-columns: min-content auto;
  flex: 1;
}

#neuroglancer-container {
  width: 100% !important;
}
</style>