<template>
  <div class="nge-leaderboard" v-show="!minimized">
    <div class="nge-leaderboard-titlebar">
      <div class="nge-sidebar-section-title">Top Editors</div>
    </div>
    <div class="nge-leaderboard-content">
      <div class="nge-leaderboard-timeselect">
        <div class="nge-leaderboard-timeselect-filler"></div>
        <button v-for="timespan of getTimespanNames()" :key="timespan" :class="'nge-sidebar-button ' + timespan"
        :title="'Switch to ' + timespan.toLowerCase() + ' leaderboard'" @click="selectButton(timespan)">{{timespan}}</button>
        <div class="nge-leaderboard-timeselect-filler"></div>
      </div>
      <simplebar data-simplebar-auto-hide="false">
        <div class="nge-leaderboard-entries">
          <div class="nge-leaderboard-row nge-leaderboard-header">
            <div>Rank</div>
            <div>Name</div>
            <div>Edits</div>
          </div>
          <div v-for="(entry, index) of appState.leaderboardEntries" :key="'entry' + index"
            :class="'nge-leaderboard-row row' + (((index+1) % 2) ? 'Odd' : 'Even') + getPlace(index)">
            <div class="nge-leaderboard-rank">{{index+1}}</div>
            <div class="nge-leaderboard-name">{{entry.name}}</div>
            <div class="nge-leaderboard-score">{{entry.score}}</div>
          </div>
        </div>
      </simplebar>
      <div class="nge-leaderboard-loading" v-show="!appState.leaderboardLoaded">Loading...</div>
      <div class="nge-leaderboard-loading" v-show="appState.leaderboardLoaded && appState.leaderboardEntries.length === 0">No edits yet... why not make one?</div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import simplebar from "simplebar-vue";
import "simplebar/dist/simplebar.min.css";

import {storeProxy, LeaderboardTimespan} from "../state";

export default Vue.extend({
  components: {
    simplebar
  },
  data: () => {
    return {
      appState: storeProxy,
      minimized: localStorage.getItem("leaderboardVisible") === "false",
      timespan: localStorage.getItem("timespan")
    }
  },
  methods: {
    getPlace(index: number): string {
      const places: string[] = ["firstplace", "secondplace", "thirdplace"];
      if (index < places.length) {
        return " " + places[index];
      }
      return "";
    },
    getTimespan(): string {
      return LeaderboardTimespan[storeProxy.leaderboardTimespan];
    },
    getTimespanNames(): string[] {
      // from https://stackoverflow.com/questions/18111657/how-to-get-names-of-enum-entries#comment85271383_43091709
      return Object.values(LeaderboardTimespan).filter(value => typeof value === "string") as string[];
    },
    setTimespan(timespan: string) {
      localStorage.setItem("timespan", timespan);
      this.timespan = timespan;
      storeProxy.leaderboardTimespan = LeaderboardTimespan[timespan as keyof typeof LeaderboardTimespan];
      storeProxy.resetLeaderboard();
    },
    selectButton(timespan: string) {
      this.setButtonHighlighted(this.timespan, false);
      this.setTimespan(timespan);
      this.setButtonHighlighted(this.timespan, true);
    },
    setButtonHighlighted(timespan: string|null, highlighted: boolean) {
      if (!timespan) return;
      const button = <HTMLElement>document.querySelector(".nge-sidebar-button." + timespan);
      button.classList.toggle("selected", highlighted);
    }
  },
  mounted() {
    this.$root.$on("toggleLeaderboard", () => {
      this.minimized = !this.minimized;
    });
    this.selectButton(this.timespan || "Weekly");
  }
});
</script>

<style>
.nge-leaderboard {
  width: 200px;
  background-color: #111;
  display: grid;
  grid-template-rows: min-content auto;
}

.nge-leaderboard-content {
  display: grid;
  grid-template-rows: min-content auto auto;
}

.nge-leaderboard-timeselect {
  display: grid;
  grid-template-columns: 5% 45% 45% 5%;
}

.nge-leaderboard-timeselect > .nge-sidebar-button {
  padding: 8px;
  margin-bottom: 10px;
  margin-left: 10px;
  margin-right: 10px;
  border-radius: 4px;
  border-style: solid;
  border-color: #555;
  border-width: 1px;
  font-size: .9em;
}

.nge-leaderboard-timeselect > .nge-sidebar-button.selected {
  background-color: #333;
}

.nge-leaderboard-entries {
  display: grid;
  grid-template-columns: auto minmax(auto, 60%) auto;
  grid-auto-rows: min-content;
  overflow: auto;
}

.nge-leaderboard-row {
  display: contents;
}

.nge-leaderboard-row > div {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  padding-left: 0.4em;
  font-size: 0.9em;
}

.nge-leaderboard-header {
  color: #999;
  font-size: .9em;
}

.rowOdd > div {
  background-color: #222;
}

.nge-leaderboard-rank {
  text-align: right;
  padding-right: 1em;
}

.nge-leaderboard-name {
  overflow-wrap: break-word;
  padding-right: 0.4em;
}

.nge-leaderboard-score {
  text-align: right;
  padding-right: 1em;
}

.nge-leaderboard-loading {
  text-align: center;
}
</style>