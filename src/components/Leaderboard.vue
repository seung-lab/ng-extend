<template>
  <div class="nge-leaderboard">
    <overlay class="modal nge-overlay-content">
      <div id="title">Top Editors This Week</div>
      <div id="entries">
        <div class="nge-leaderboard-row"
        v-for="entry of appState.leaderboardEntries" :key="entry.name">
          <div>{{entry.name}}</div>
          <div>{{entry.score}}</div>
        </div>
      </div>
    </overlay>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import Overlay from "components/Overlay.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  components: { Overlay },
  data: () => {
    return {
      appState: storeProxy,
    }
  }
});
</script>

<style>
.nge-leaderboard {
  width: 250px;
  background-color: #222222;
}

#title {
  background-color: #444444;
  font-size: 1.25em;
}

#entries {
  display: grid;
  grid-template-columns: auto auto;
}

.nge-leaderboard-row {
  display: contents;
}
</style>