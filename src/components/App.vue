<script setup lang="ts">
import ExtensionBar from "#src/components/ExtensionBar.vue";
import Tutorial from "#src/components/Tutorial.vue";
</script>

<template>
  <div id="vueMain">
    <div class="ng-extend">
      <Tutorial />
      <ExtensionBar />
    </div>
    <div id="content">
      <div id="neuroglancer-container"></div>
    </div>
  </div>
</template>

<style>
@import "../common.css";
@import "../ng-override.css";

#vueMain {
  position: relative;
  flex-direction: column;
}

#vueMain>*:not(#content) {
  font-family: 'Roboto', sans-serif;
}

#vueMain>*:not(#content) ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#app,
#content,
#vueMain {
  display: flex;
  flex: 1;
}
</style>