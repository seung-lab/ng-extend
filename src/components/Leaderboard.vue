<template>
  <div class="nge-leaderboard">
    <div class="nge-leaderboard-titlebar">
      <div class="nge-sidebar-section-title" v-show='getTimespan() === "Daily"'>Top Editors Today</div>
      <div class="nge-sidebar-section-title" v-show='getTimespan() === "Weekly"'>Top Editors This Week</div>
    </div>
    <div class="nge-leaderboard-timeselect">
      <button v-for="timespan of getTimespanNames()" :key="timespan" class="nge-sidebar-button"
       :title="'Switch to ' + timespan.toLowerCase() + ' leaderboard'" @click="setTimespan(timespan);">{{timespan}}</button>
    </div>
    <div class="nge-leaderboard-entries">
      <div class="nge-leaderboard-row nge-leaderboard-header">
        <div>Rank</div>
        <div>Name</div>
        <div>Edits</div>
      </div>
      <div v-for="(entry, index) of appState.leaderboardEntries" :key="entry.name"
        :class="'nge-leaderboard-row row' + (((index+1) % 2) ? 'Odd' : 'Even') + getPlace(index)">
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

import {storeProxy, LeaderboardTimespan} from "../state";

export default Vue.extend({
  data: () => {
    return {
      appState: storeProxy
    }
  },
  methods: {
    getPlace(index: number): string {
      const places: string[] = ['firstplace', 'secondplace', 'thirdplace'];
      if (index < places.length) {
        return ' ' + places[index];
      }
      return '';
    },
    getTimespan(): string {
      return LeaderboardTimespan[storeProxy.leaderboardTimespan];
    },
    getTimespanNames(): string[] {
      // from https://stackoverflow.com/questions/18111657/how-to-get-names-of-enum-entries#comment85271383_43091709
      return Object.values(LeaderboardTimespan).filter(value => typeof value === 'string') as string[];
    },
    setTimespan(timespan: string) {
      storeProxy.leaderboardTimespan = LeaderboardTimespan[timespan as keyof typeof LeaderboardTimespan];
      storeProxy.resetLeaderboard();
    }
  }
});
</script>

<style>
.nge-leaderboard {
  width: 250px;
  background-color: #111;
  display: grid;
  grid-template-rows: min-content min-content auto auto;
}

.nge-leaderboard-title {
  text-align: center;
}

.nge-leaderboard-timeselect {
  display: grid;
  grid-template-columns: auto auto;
}

.nge-leaderboard-timeselect > .nge-sidebar-button {
  padding: 5px;
}

.nge-leaderboard-entries {
  display: grid;
  grid-template-columns: auto minmax(auto, 50%) auto;
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

.rowOdd > div {
  background-color: #222;
}

.nge-leaderboard-rank {
  text-align: center;
}

.nge-leaderboard-name {
  overflow-wrap: break-word;
}

.nge-leaderboard-score {
  text-align: center;
}

.nge-leaderboard-loading {
  text-align: center;
}
</style>