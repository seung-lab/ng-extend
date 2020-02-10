<template>
  <div id="nge-sidebar">
    <div class="nge-sidebar-hidden" v-show="!visible">
      <button class="nge-sidebar-button show" title="Show Sidebar" @click="setVisible(true);">↓</button>
    </div>
    <div class="nge-sidebar-visible" v-show="visible">
      <button class="nge-leaderboard-button" title="Hide Sidebar" @click="setVisible(false);">↑</button>
      <leaderboard />
      <chatbox />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import {storeProxy} from "../state";
import Leaderboard from "components/Leaderboard.vue";
import Chatbox from "components/Chatbox.vue";

export default Vue.extend({
  components: { Leaderboard, Chatbox },
  data: () => {
    return {
      appState: storeProxy,
      visible: true
    }
  },
  methods: {
    setVisible: function(visible: boolean) {
      this.visible = visible;
    }
  }
});
</script>

<style>
.nge-sidebar-visible {
  width: 250px;
  display: grid;
  grid-template-rows: min-content auto auto;
  height: 100%;
}

.nge-sidebar-button {
  background-color: #222;
  padding: 5px;
}
</style>