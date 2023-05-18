<script setup lang="ts">
import ExtensionBar from "components/ExtensionBar.vue";

// import {useCounterStore} from 'src/my-db';
// import {ref} from 'vue';

// const greeting = ref('Hello World!');

// const counter = useCounterStore();

// setTimeout(() => {
//   greeting.value = "It's been 5 seconds";
// }, 5000);

</script>

<template>
  <div id="vueMain">
    <!-- <introduction /> -->
    <ExtensionBar class="ng-extend" />
    <div id="content">
      <!-- <sidebar class="ng-extend" /> -->
      <!-- <n-g-sidebar-header class="ng-extend" v-show="appState.viewer.sidebar.open" /> -->
      <div id="neuroglancer-container"></div>
      <!-- <overlay-container class="ng-extend" /> -->
    </div>
  </div>
</template>

<style>
/* @import "../ng-override.css"; */

#app {
  display: flex;
  flex: 1;
}

#vueMain {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  font-family: 'Roboto', sans-serif;
}

#content {
  display: grid;
  grid-template-columns: min-content auto;
  flex: 1;
}

#neuroglancer-container {
  /* position: inherit !important; */
}

/* #neuroglancer-container {
  width: 100% !important;
  overflow: hidden;
} */

/* .greeting {
  color: red;
  font-weight: bold;
} */
</style>