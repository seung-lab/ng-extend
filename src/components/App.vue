<script setup lang="ts">
import ExtensionBar from "#src/components/ExtensionBar.vue";
import Tutorial from "#src/components/Tutorial.vue";

import { loaded, useLoginStore } from "#src/store.js";
import { storeToRefs } from "pinia";

const { sessions } = storeToRefs(useLoginStore());
</script>

<template>
  <div id="vueMain">
    <div v-if="loaded" class="ng-extend">
      <Tutorial v-if="sessions.length > 0" />
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