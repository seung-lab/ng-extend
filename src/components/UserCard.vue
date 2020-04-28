<template>
  <div class="nge-usercard">
    <div class="nge-usercard-profile">
      <img class="nge-usercard-avatar" src="images/icon-filled.png" :style="cssVars" width="50">
      <div class="nge-usercard-info">
        <div class="nge-usercard-name">{{ appState.loggedInUser.name }}</div>
        <div class="nge-usercard-email">{{ appState.loggedInUser.email }}</div>
        <div class="nge-usercard-date">joined 4/20/2020</div>
      </div>
    </div>
    <div class="nge-usercard-edits">
      <div class="nge-usercard-edits-title">Fixes</div>
      <div class="nge-usercard-edits-table">
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Day</div>
          <div class="nge-usercard-edits-count">N/A</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Week</div>
          <div class="nge-usercard-edits-count">N/A</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">All Time</div>
          <div class="nge-usercard-edits-count">N/A</div>
        </div>
      </div>
    </div>
    <button class="nge-usercard-logout" @click="appState.logout">Log Out</button>
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
  },
  computed: {
    cssVars() {
      const name = storeProxy.loggedInUser ? storeProxy.loggedInUser.name : "";
      let nameHash = 0;
      for (let i = 0; i < name.length; i++) {
        nameHash = Math.imul(31, nameHash) + name.charCodeAt(i) | 0; // https://stackoverflow.com/a/52171480
      }
      const degrees = nameHash % 360;
      const avatarHueRotate = degrees + "deg";
      return {
        "--avatar-hue-rotate": avatarHueRotate
      };
    }
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
  filter: hue-rotate(var(--avatar-hue-rotate));
}
</style>