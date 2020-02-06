<template>
  <div class="nge-leaderboard">
    <div class="nge-leaderboard-title">Top Editors This Week</div>
    <div class="nge-leaderboard-entries">
      <div class="nge-leaderboard-row nge-leaderboard-header">
        <div>Rank</div>
        <div>User ID</div>
        <div># of Edits</div>
      </div>
      <div v-for="(entry, index) of appState.leaderboardEntries" :key="entry.name"
        :class="'nge-leaderboard-row row' + (index % 2)">
        <div class="nge-leaderboard-rank">{{index+1}}</div>
        <div class="nge-leaderboard-name">{{entry.name}}</div>
        <div class="nge-leaderboard-score">{{entry.score}}</div>
      </div>
    </div>
    <div class="nge-leaderboard-loading" v-show="appState.leaderboardEntries.length === 0">Loading...</div>
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
  background-color: #111;
  display: grid;
  grid-template-rows: min-content auto auto;
}

.nge-leaderboard-title {
  background-color: #333;
  font-size: 1.25em;
  text-align: center;
  padding-top: 0.5em;
  padding-bottom: 0.5em;
}

.nge-leaderboard-entries {
  display: grid;
  grid-template-columns: auto minmax(auto, 40%) auto;
  grid-auto-rows: min-content;
  overflow: auto;
}

.nge-leaderboard-header {
  font-weight: bold;
}

.nge-leaderboard-row {
  display: contents;
}

.nge-leaderboard-row > div {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  padding-left: 0.4em;
  padding-right: 0.4em;
}

.row1 > div {
  background-color: #222;
}

.nge-leaderboard-rank {
  text-align: right;
}

.nge-leaderboard-loading {
  text-align: center;
}
</style>