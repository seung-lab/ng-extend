<template>
  <div v-if="appState.loggedInUser" id="loggedInUserBar">
    <div>{{ appState.loggedInUser.name }} ({{ appState.loggedInUser.email }})</div>
    <button @click="appState.logout">Logout</button>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy} from "../state";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  }
});
</script>

<style>
@import "../common.css";

#loggedInUserBar {
  background: var(--color-dark-bg);
  color: var(--color-small-text);
  display: flex;
  justify-content: flex-end;
}

#loggedInUserBar > button {
  margin-left: 10px;
}
</style>