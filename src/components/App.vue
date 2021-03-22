<template>
  <div id="vueMain">
    <introduction />
    <extension-bar class="ng-extend" />
    <div id="content">
      <sidebar class="ng-extend" />
      <n-g-sidebar-header class="ng-extend" v-show="appState.viewer.sidebar.open" />
      <div id="neuroglancer-container">
        <div id="neuroglancer-error">Oops! There was an error and Neuroglancer could not be loaded. Please follow the
          instructions in the <a
            href="https://docs.google.com/document/d/1FvEtMnAHenufDtCqKdi2DAyPyX9IzWkW9P2H31WxkMo">FAQ</a> to
          troubleshoot.</div>
      </div>
      <overlay-container class="ng-extend" />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import ExtensionBar from "components/ExtensionBar.vue";
import OverlayContainer from "components/OverlayContainer.vue";
import Sidebar from "components/Sidebar.vue";
import NGSidebarHeader from "components/NGSidebarHeader.vue";
import Introduction from "components/Introduction.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  components: { ExtensionBar, OverlayContainer, Sidebar, NGSidebarHeader, Introduction },
  data: () => {
    return {
      appState: storeProxy,
    }
  }
});
</script>

<style>
@import "../common.css";
@import "../ng-override.css";

#vueMain {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  font-family: 'Roboto', sans-serif;
}

#vueMain ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#content {
  display: flex;
  flex: 1;
}

#neuroglancer-container {
  width: 100% !important;
  overflow: hidden;
}
</style>