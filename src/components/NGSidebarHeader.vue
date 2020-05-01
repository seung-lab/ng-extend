<template>
  <div class="ngSidebarHeader" :style="{width: appState.viewer.sidebar.width + 'px'}" @click.self.stop.prevent @mousedown.self.stop.prevent>
    <div class="title"><div>Layer Controls</div><button class="close" @click="appState.toggleSidePanel(false)">×</button></div>
    <div class="selectContainer"><select @change="selectLayerChange" v-model="appState.viewer.selectedLayer">
        <option v-for="layer in appState.viewer.layers" :key="layer" :value="layer">{{layer}}</option>
    </select></div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy } from "../state";


export default Vue.extend({
  data() {
    return {
      appState: storeProxy,
    }
  },
  methods: {
      selectLayerChange() {
          if (this.appState.viewer.selectedLayer) {
              this.appState.selectActiveLayer(this.appState.viewer.selectedLayer);
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
    padding: 8px;
}

.ngSidebarHeader .selectContainer select {
    width: 100%;
}
</style>