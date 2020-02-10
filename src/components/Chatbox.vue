<template>
  <div class="nge-chatbox">
    <div>Chat</div>
    <form @submit.prevent="appState.submitMessage" autocomplete="off">
      <input type="text" id="chatMessage">
      <input type="submit" value="Submit">
    </form>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import {storeProxy} from "../state";

export default Vue.extend({
  data: () => {
    return {
      appState: storeProxy
    }
  }
});
</script>

<style>
.nge-chatbox {
  background-color: #92af7d;
}
</style>