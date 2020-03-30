<template>
  <div :class="'nge-sidebar' + (visible ? ' visible' : '')">
    <!--<button class="nge-sidebar-hide-button" @click="setVisible(false);">&lt;</button>-->
    <getting-started />
    <leaderboard />
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { storeProxy } from "../state";
import Leaderboard from "components/Leaderboard.vue";
import GettingStarted from "components/GettingStarted.vue";

export default Vue.extend({
  components: { Leaderboard, GettingStarted },
  data: () => {
    return {
      appState: storeProxy,
      visible: localStorage.getItem("visible") !== "false"
    };
  },
  methods: {
    setVisible(visible: boolean) {
      localStorage.setItem("visible", visible.toString());
      this.visible = visible;
      (<HTMLElement>document.querySelector(".nge-sidebar")).classList.toggle("visible", visible);
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
  transition: all 0.25s;
  transition-property: opacity, width;
}

.nge-sidebar.visible {
  width: 250px;
  opacity: 100%;
  padding-right: 3px;
}

.nge-sidebar:not(.visible) {
  width: 0px;
  opacity: 0%;
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