<template>
  <div class="ngSidebarHeader" :style="{width: appState.viewer.sidebar.width + 'px'}" @click.self.stop.prevent @mousedown.self.stop.prevent>
    <div class="title"><div>Layer Controls</div><button class="close" @click="appState.toggleSidePanel(false)">×</button></div>
    <div class="selectContainer">
      <label for="selectLayer">Layer:</label>
      <select id="selectLayer" @change="selectLayerChange" v-model="appState.viewer.selectedLayer">
        <option v-for="(layer, index) in appState.viewer.layers" :key="layer" :value="layer">{{index+1}} - {{layer}}</option>
      </select>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { layerProxy, storeProxy } from "../state";


export default Vue.extend({
  data() {
    return {
      appState: storeProxy,
    }
  },
  methods: {
      selectLayerChange() {
          if (this.appState.viewer.selectedLayer) {
              layerProxy.selectActiveLayer(this.appState.viewer.selectedLayer);
          }
      }
  }
});
</script>

<style>
.ngSidebarHeader {
    right: 0;
    position: absolute;
    z-index: 20;
}

.ngSidebarHeader .title {
    background-color: var(--color-medium-bg);
    text-transform: uppercase;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
}

.ngSidebarHeader .close {
    width: 23px;
    font-size: 23px;
    line-height: 23px;
    color: var(--color-light-bg);
}

.ngSidebarHeader .close:hover {
    background: none;
    color: white;
}

.ngSidebarHeader .selectContainer {
    display: grid;
    grid-template-columns: min-content auto;
    grid-column-gap: 10px;
    padding: 8px;
}

.ngSidebarHeader .selectContainer select {
    width: 100%;
}
</style>