<template>
  <div class="nge-leaderboard">
    <overlay class="modal overlay-content">
      <div class="title">Top Editors This Week</div>
      <!--
        TODO:
        this should display each leaderboard entry in a grid
      -->
    </overlay>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import Overlay from "components/Overlay.vue";

export default Vue.extend({
  components: { Overlay }
});
</script>

<style>
.nge-leaderboard {
  position: fixed;
  left: 10%;
  top: 30%;
  width: 10%;
  height: 40%;
  z-index: 50;
}

.nge-overlay-content {
  min-width: 250px;
}

.nge-overlay-content .title {
  background-color: lightgray;
  font-size: 1.25em;
}
</style>