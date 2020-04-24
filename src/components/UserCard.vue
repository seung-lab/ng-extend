<template>
  <div class="nge-usercard">
    <div class="nge-usercard-profile">
      <img class="nge-usercard-avatar" src="images/icon-filled.png" width="50">
      <div class="nge-usercard-info">
        <div class="nge-usercard-name">Doug Rattmann</div>
        <div class="nge-usercard-email">rattmann@aperturescience.com</div>
        <div class="nge-usercard-date">joined 4/20/2020</div>
      </div>
    </div>
    <div class="nge-usercard-edits">
      <div class="nge-usercard-edits-title">Fixes</div>
      <div class="nge-usercard-edits-table">
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Day</div>
          <div class="nge-usercard-edits-count">154</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Week</div>
          <div class="nge-usercard-edits-count">1,540</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">All Time</div>
          <div class="nge-usercard-edits-count">154,000</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy } from "../state";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    };
  }
});
</script>

<style>
.nge-usercard {
  display: grid;
  grid-template-rows: auto auto;
}
.nge-usercard-profile {
  display: grid;
  grid-template-columns: auto auto;
}
.nge-usercard-edits-table {
  display: grid;
  grid-template-columns: auto auto auto;
}
.nge-usercard-avatar {
  filter: hue-rotate(90deg);
}
</style>