<template>
  <div :class="'nge-sidebar ' + getSidebarItems() + (visible ? ' visible' : '')">
    <leaderboard />
    <chatbox v-if="enableChat" />
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { storeProxy } from "../state";
import Leaderboard from "components/Leaderboard.vue";
import Chatbox from "components/Chatbox.vue";
import { config } from "../main";

export default Vue.extend({
  components: { Leaderboard, Chatbox },
  data: () => {
    return {
      appState: storeProxy,
      enableChat: config.enableChat,
      visible: localStorage.getItem("visible") !== "false",
      showLeaderboard: localStorage.getItem("leaderboardVisible") !== "false",
      showChat: localStorage.getItem("chatVisible") !== "false"
    };
  },
  methods: {
    setVisible(visible: boolean) {
      localStorage.setItem("visible", visible.toString());
      this.visible = visible;
      (<HTMLElement>document.querySelector(".nge-sidebar")).classList.toggle("visible", visible);
    },
    setLeaderboardVisible(visible: boolean) {
      localStorage.setItem("leaderboardVisible", visible.toString());
      this.showLeaderboard = visible;
    },
    setChatVisible(visible: boolean) {
      localStorage.setItem("chatVisible", visible.toString());
      this.showChat = visible;
    },
    getSidebarItems(): string {
      if (!this.enableChat) {
        return "chat-disabled";
      }
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
    this.$root.$on("toggleLeaderboard", () => {
      this.setLeaderboardVisible(!this.showLeaderboard);
    });
    this.$root.$on("toggleChat", () => {
      this.setChatVisible(!this.showChat);
    });
  }
});
</script>

<style>
.nge-sidebar {
  display: grid;
  height: 100%;
  transition: all 0.25s;
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

.nge-sidebar.chat-disabled {
  grid-template-rows: auto;
}

.nge-sidebar.both {
  grid-template-rows: 50% auto;
}

.nge-sidebar.lb-only {
  grid-template-rows: auto min-content;
}

.nge-sidebar.chat-only {
  grid-template-rows: min-content auto;
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