<template>
  <div :class="'nge-sidebar' + (visible ? ' visible' : '')">
    <!--<button class="nge-sidebar-hide-button" @click="setVisible(false);">&lt;</button>-->
    <getting-started />
    <leaderboard />
    <chatbox />
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { storeProxy } from "../state";
import Leaderboard from "components/Leaderboard.vue";
import Chatbox from "components/Chatbox.vue";
import GettingStarted from "components/GettingStarted.vue";

export default Vue.extend({
  components: { Leaderboard, Chatbox, GettingStarted },
  data: () => {
    return {
      appState: storeProxy,
      visible: localStorage.getItem("visible") !== "false",
      showChat: localStorage.getItem("chatVisible") !== "false"
    };
  },
  methods: {
    setVisible(visible: boolean) {
      localStorage.setItem("visible", visible.toString());
      this.visible = visible;
      (<HTMLElement>document.querySelector(".nge-sidebar")).classList.toggle("visible", visible);
      this.shiftStatusBars();
      if (visible) {
        this.appState.markLastMessageRead();
      }
    },
    setChatVisible(visible: boolean) {
      localStorage.setItem("chatVisible", visible.toString());
      this.showChat = visible;
    },
    getSidebarItems(): string {
      if (this.showChat) {
        return "both";
      }
      return "lb-only";
    },
    shiftStatusBars() {
      const oldStyle = document.head.querySelector("#shiftStatusBars");
      if (oldStyle) {
        oldStyle.remove();
      }
      if (this.visible) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "shiftStatusBars";
        styleSheet.innerText = "#statusContainer { left: 200px; }";
        document.head.appendChild(styleSheet);
      }
    }
  },
  mounted() {
    this.shiftStatusBars();
    this.$root.$on("toggleSidebar", () => {
      this.setVisible(!this.visible);
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
  overflow: hidden; /* fixes issue with simplebar and ng use of scrollIntoView */
}

.nge-sidebar.visible {
  width: 200px;
  opacity: 100%;
  padding-right: 3px;
}

.nge-sidebar:not(.visible) {
  width: 0px;
  opacity: 0%;
}

.nge-sidebar.both {
  grid-template-rows: 50% auto;
}

.nge-sidebar.lb-only {
  grid-template-rows: auto min-content;
}

.nge-sidebar {
  grid-template-rows: min-content auto;
}

.nge-sidebar-button {
  background-color: #222;
  padding: 5px;
}

/*.nge-sidebar-hide-button {
  position: fixed;
  top: 50%;
  left: 230px;
  z-index: 1;
}*/

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