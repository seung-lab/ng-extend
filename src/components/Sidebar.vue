<template>
  <div id="nge-sidebar">
    <div class="nge-sidebar-hidden" v-show="!visible">
      <button class="nge-sidebar-button show" title="Show sidebar" @click="setVisible(true);">🡆</button>
    </div>
    <div :class="'nge-sidebar-visible ' + getSidebarItems()" v-show="visible">
      <button class="nge-sidebar-button" title="Hide sidebar" @click="setVisible(false);">🡄</button>

      <leaderboard v-show="showLeaderboard" />
      <div class="nge-sidebar-buttons">
        <button
          class="nge-sidebar-button"
          title="Show leaderboard"
          @click="setLeaderboardVisible(true);"
          v-show="!showLeaderboard"
        >⇓</button>
        <button
          class="nge-sidebar-button"
          title="Show chat"
          @click="setChatVisible(true);"
          v-show="!showChat"
        >⇑</button>
        <button
          class="nge-sidebar-button"
          title="Hide leaderboard"
          @click="setLeaderboardVisible(false);"
          v-show="showLeaderboard && showChat"
        >⇑</button>
        <button
          class="nge-sidebar-button"
          title="Hide chat"
          @click="setChatVisible(false);"
          v-show="showLeaderboard && showChat"
        >⇓</button>
      </div>
      <chatbox v-show="showChat" />
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
      visible: Cookies.get("visible") !== "false",
      showLeaderboard: true,
      showChat: true
    };
  },
  methods: {
    setVisible(visible: boolean) {
      Cookies.set("visible", visible.toString());
      this.visible = visible;
    },
    setLeaderboardVisible(visible: boolean) {
      this.showLeaderboard = visible;
    },
    setChatVisible(visible: boolean) {
      this.showChat = visible;
    },
    getSidebarItems(): string {
      if (this.showLeaderboard && this.showChat) {
        return "both";
      }
      if (this.showLeaderboard) {
        return "lb-only";
      }
      if (this.showChat) {
        return "chat-only";
      }
      return ""; //should never happen
    }
  }
});
</script>

<style>
.nge-sidebar-visible {
  width: 250px;
  display: grid;
  height: 100%;
}

.nge-sidebar-visible.both {
  grid-template-rows: min-content 50% min-content auto;
}

.nge-sidebar-visible.lb-only {
  grid-template-rows: min-content auto min-content;
}

.nge-sidebar-visible.chat-only {
  grid-template-rows: min-content min-content auto;
}

.nge-sidebar-buttons {
  display: grid;
  grid-template-rows: min-content min-content;
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