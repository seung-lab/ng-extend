<template>
  <div id="nge-sidebar">
    <div class="nge-sidebar-hidden" v-show="!visible">
      <button class="nge-sidebar-button show" title="Show Sidebar" @click="setVisible(true);">→</button>
    </div>
    <div class="nge-sidebar-visible" v-show="visible">
      <button class="nge-leaderboard-button" title="Hide Sidebar" @click="setVisible(false);">←</button>
      <leaderboard />
      <chatbox />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { storeProxy } from "../state";
import Leaderboard from "components/Leaderboard.vue";
import Chatbox from "components/Chatbox.vue";
import Cookies from "js-cookie";

export default Vue.extend({
  components: { Leaderboard, Chatbox },
  data: () => {
    return {
      appState: storeProxy,
      visible: Cookies.get("visible") !== "false"
    };
  },
  methods: {
    setVisible: function(visible: boolean) {
      Cookies.set("visible", visible.toString());
      this.visible = visible;
    }
  }
});
</script>

<style>
.nge-sidebar-visible {
  width: 250px;
  display: grid;
  grid-template-rows: min-content 50% auto;
  height: 100%;
}

.nge-sidebar-button {
  background-color: #222;
  padding: 5px;
}

.nge-sidebar-section-title {
  background-color: #333;
  font-size: 1.25em;
  padding-top: 0.75em;
  padding-bottom: 0.75em;
  text-align: center;
}

.firstplace {
  color: gold;
}

.secondplace {
  color: silver;
}

.thirdplace {
  color: #cd7f32;
}
</style>