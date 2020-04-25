<template>
  <div id="vueMain">
    <extension-bar class="ng-extend" />
    <div id="content">
      <sidebar class="ng-extend" />
      <div id="neuroglancer-container">
        <div id="neuroglancer-error">Oops! There was an error and Neuroglancer could not be loaded. Please follow the
          instructions in the <a
            href="https://docs.google.com/document/d/1FvEtMnAHenufDtCqKdi2DAyPyX9IzWkW9P2H31WxkMo">FAQ</a> to
          troubleshoot.</div>
      </div>
    </div>
    <overlay-container class="ng-extend" />
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import ExtensionBar from "components/ExtensionBar.vue";
import OverlayContainer from "components/OverlayContainer.vue";
import Sidebar from "components/Sidebar.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  components: { ExtensionBar, OverlayContainer, Sidebar },
  data: () => {
    return {
      appState: storeProxy,
    }
  },
  mounted() {
    document.title = "FlyWire";
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
  overflow: hidden;
}
</style>