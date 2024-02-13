<script setup lang="ts">
import {onMounted} from "vue";
import {storeToRefs} from "pinia";
import {useStatsStore, LeaderboardTimespan} from "../store";
import HologramPanel from "components/HologramPanel.vue";

import nurroImage from '../images/confetti nurro.png';

const store = useStatsStore();
const {leaderboardLoaded, leaderboardEntries} = storeToRefs(store);
const {setLeaderboardTimespan, resetLeaderboard} = store;

let timespan: string|null = localStorage.getItem("timespan");

onMounted(() => {
    selectButton(timespan || "Weekly");
    (document.querySelector(".nge-leaderboard-headerimage > img")! as HTMLImageElement).src = nurroImage;
});

function getPlace(index: number): string {
    const places: string[] = ["firstplace", "secondplace", "thirdplace"];
    if (index < places.length) {
    return " " + places[index];
    }
    return "";
}

/*function getTimespan(): string {
    return LeaderboardTimespan[leaderboardTimespan];
}*/

function getTimespanNames(): string[] {
    // from https://stackoverflow.com/questions/18111657/how-to-get-names-of-enum-entries#comment85271383_43091709
    return Object.values(LeaderboardTimespan).filter(value => typeof value === "string") as string[];
}

function setTimespan(ts: string) {
    localStorage.setItem("timespan", ts);
    timespan = ts;
    setLeaderboardTimespan(LeaderboardTimespan[ts as keyof typeof LeaderboardTimespan]);
    resetLeaderboard();
}

function selectButton(timespan: string) {
    setButtonHighlighted(timespan, false);
    setTimespan(timespan);
    setButtonHighlighted(timespan, true);
}

function setButtonHighlighted(timespan: string|null, highlighted: boolean) {
    if (!timespan) return;
    const button = <HTMLElement>document.querySelector(".nge-sidebar-button." + timespan);
    button.classList.toggle("selected", highlighted);
}

</script>

<template>
  <hologram-panel class="nge-leaderboard-hologram">
    <div class="nge-leaderboard">
      <div class="nge-leaderboard-headerimage"><img src="insert-logo" title="Nurro"></div>
      <div class="nge-leaderboard-titlebar">Top Editors</div>
      <div class="nge-leaderboard-content">
        <div class="nge-leaderboard-timeselect">
          <div class="nge-leaderboard-timeselect-filler"></div>
          <button v-for="timespan of getTimespanNames()" :key="timespan" :class="'nge-sidebar-button ' + timespan"
          :title="'Switch to ' + timespan.toLowerCase() + ' leaderboard'" @click="selectButton(timespan)">{{timespan}}</button>
          <div class="nge-leaderboard-timeselect-filler"></div>
        </div>
        <div class="nge-leaderboard-scroll">
          <div class="nge-leaderboard-entries">
            <div class="nge-leaderboard-row nge-leaderboard-header">
              <div>Rank</div>
              <div>Name</div>
              <div>Edits</div>
            </div>
            <div v-for="(entry, index) of leaderboardEntries" :key="'entry' + index"
              :class="'nge-leaderboard-row row' + (((index+1) % 2) ? 'Odd' : 'Even') + getPlace(index)">
              <div class="nge-leaderboard-rank">{{index+1}}</div>
              <div class="nge-leaderboard-name">{{entry.name}}</div>
              <div class="nge-leaderboard-score">{{entry.score}}</div>
            </div>
          </div>
        </div>
        <div class="nge-leaderboard-loading" v-show="!leaderboardLoaded">Loading...</div>
        <div class="nge-leaderboard-loading" v-show="leaderboardLoaded && leaderboardEntries.length === 0">No edits yet... why not make one?</div>
      </div>
    </div>
  </hologram-panel>
</template>

<style>
.nge-leaderboard-hologram {
  top: 45px;
  bottom: 10px;
  right: 10px;
  width: 250px;
  height: 700px;
}

.nge-leaderboard {
  display: grid;
  grid-template-rows: min-content min-content auto;
  font-family: sans-serif;
  min-height: 0;
}

.nge-leaderboard-headerimage {
  margin: auto;
}

.nge-leaderboard-headerimage > img {
  width: 200px;
}

.nge-leaderboard-content {
  display: grid;
  grid-template-rows: min-content auto auto;
  min-height: 0;
}

.nge-leaderboard-titlebar {
  font-size: 1.15em;
  padding-top: 0.75em;
  padding-bottom: 0.75em;
  text-align: center;
}

.nge-leaderboard-timeselect {
  /*background-color: #111;*/
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

.nge-leaderboard-scroll {
  overflow: auto;
}

.nge-leaderboard-row {
  display: contents;
}

.nge-leaderboard-row > div {
  padding-top: 0.8em;
  padding-bottom: 0.8em;
  padding-left: 0.4em;
  font-size: 0.9em;
}

.nge-leaderboard-header {
  color: #999;
  font-size: .9em;
}

.rowOdd > div {
  background-color: #2226;
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

.nge-sidebar-button {
  background-color: #222;
  padding: 5px;
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