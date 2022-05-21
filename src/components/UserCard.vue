<template>
  <div class="nge-usercard">
    <div class="nge-usercard-profile">
      <div class="nge-usercard-avatar">
        <img class="nge-usercard-avatar-image" src="images/icon-filled.png" :style="cssVars" width="50">
      </div>
      <div class="nge-usercard-info">
        <div class="nge-usercard-name">{{ appState.loggedInUser.name }}</div>
        <div class="nge-usercard-email">{{ appState.loggedInUser.email }}</div>
        <div class="nge-usercard-date" v-if="appState.loggedInUser.joinDate !== '6/30/2020'">joined {{ appState.loggedInUser.joinDate }}</div>
      </div>
    </div>
    <div class="nge-usercard-edits">
      <div class="nge-usercard-edits-title">Cells Submitted</div>
      <div class="nge-usercard-edits-table">
        <!--div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Today</div>
          <div class="nge-usercard-edits-count">{{ appState.userInfo.editsToday }}</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Past 7 Days</div>
          <div class="nge-usercard-edits-count">{{ appState.userInfo.editsThisWeek }}</div>
        </div-->
        <div class="nge-usercard-edits-section">
          <!--div class="nge-usercard-edits-timespan">All Time</div-->
          <div class="nge-usercard-edits-count">{{ appState.cellsSubmitted }}</div>
        </div>
      </div>
    </div>
    <div class="nge-usercard-edits" v-if="appState.userInfo">
      <div class="nge-usercard-edits-title">Edits in Production</div>
      <div class="nge-usercard-edits-table">
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Today</div>
          <div class="nge-usercard-edits-count">{{ appState.userInfo.editsToday }}</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">Past 7 Days</div>
          <div class="nge-usercard-edits-count">{{ appState.userInfo.editsThisWeek }}</div>
        </div>
        <div class="nge-usercard-edits-section">
          <div class="nge-usercard-edits-timespan">All Time</div>
          <div class="nge-usercard-edits-count">{{ appState.userInfo.editsAllTime }}</div>
        </div>
      </div>
    </div>
    <div class="nge-usercard-controls">
      <button class="nge-usercard-logout" @click="appState.logout">Log Out</button>
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
  color: var(--color-small-text);
}
.nge-usercard-profile {
  display: grid;
  grid-template-columns: auto auto;
  padding: 20px;
}
.nge-usercard-info {
  padding-left: 30px;
  padding-right: 20px;
}
.nge-usercard-name {
  font-size: 1.5em;
  font-weight: bold;
}
.nge-usercard-email, .nge-usercard-date {
  font-style: italic;
  padding-top: 3px;
}
.nge-usercard-avatar {
  background-color: var(--color-medium-bg);
  border-radius: 5px;
  width: 80px;
  height: 80px;
}
.nge-usercard-avatar-image {
  filter: hue-rotate(var(--avatar-hue-rotate));
  padding: 15px;
}
.nge-usercard-edits {
  padding: 0px 20px 10px 20px;
}
.nge-usercard-edits-title {
  font-size: 1.2em;
  font-weight: bold;
  border-bottom: solid 1px var(--color-light-bg);
}
.nge-usercard-edits-table {
  display: grid;
  grid-template-columns: auto auto auto;
  padding-top: 5px;
}
.nge-usercard-edits-timespan {
  font-size: 0.9em;
}
.nge-usercard-edits-count {
  font-size: 1.2em;
  font-weight: bold;
}
.ng-extend button.nge-usercard-logout {
  width: 100%;
  padding-top: 10px;
  padding-bottom: 10px;
}
</style>