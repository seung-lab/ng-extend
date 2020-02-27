<template>
  <div :class="'nge-sidebar ' + getSidebarItems() + (visible ? ' visible' : '')">
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
      (<HTMLElement>document.querySelector('.nge-sidebar')).classList.toggle('visible', visible);
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
  },
  mounted() {
    this.$root.$on("toggleSidebar", () => {
      this.setVisible(!this.visible);
    });
  }
});
</script>

<style>
.nge-sidebar {
  display: grid;
  height: 100%;
  transition: all 0.5s;
  transition-property: opacity, width;
}

.nge-sidebar.visible {
  width: 250px;
  opacity: 100%;
}

.nge-sidebar:not(.visible) {
  width: 0px;
  opacity: 0%;
}

.nge-sidebar.both {
  grid-template-rows: 50% min-content auto;
}

.nge-sidebar.lb-only {
  grid-template-rows: auto min-content;
}

.nge-sidebar.chat-only {
  grid-template-rows: min-content auto;
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
  background-color: #111;
  font-size: 1.15em;
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

.simplebar-scrollbar.simplebar-visible:before {
  background-color: #999;
}
</style>