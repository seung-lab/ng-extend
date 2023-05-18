<script setup lang="ts">
import ExtensionBar from "components/ExtensionBar.vue";
</script>

<template>
  <div id="vueMain">
    <ExtensionBar class="ng-extend" />
    <div id="content">
      <div id="neuroglancer-container"></div>
    </div>
  </div>
</template>

<style>
@import "../common.css";
/* @import "../ng-override.css"; */

#app, #content, #vueMain {
  display: flex;
  flex: 1;
}

#vueMain {
  position: relative;
  flex-direction: column;
  font-family: 'Roboto', sans-serif;
}
</style>