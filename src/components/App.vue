<script setup lang="ts">
import Chatbox from "#src/Chatbox.vue";
import ExtensionBar from "#src/components/ExtensionBar.vue";
import Leaderboard from "#src/components/Leaderboard.vue";
import { useChatStore, useStatsStore } from "#src/store-pyr.js";
import { storeToRefs } from "pinia";
const { showLeaderboard } = storeToRefs(useStatsStore());
const { showChat } = storeToRefs(useChatStore());
</script>

<template>
  <div id="vueMain">
    <div class="ng-extend">
      <ExtensionBar />
      <Leaderboard v-if="showLeaderboard" @hide="showLeaderboard = false"></Leaderboard>
    </div>
    <div id="content">
      <div id="neuroglancer-container"></div>
    </div>
    <Chatbox v-if="showChat" @hide="showChat = false" class="ng-extend"></Chatbox>
  </div>
</template>

<style>
@import "../common.css";
@import "../ng-override.css";

#vueMain {
  position: relative;
  flex-direction: column;
}

#vueMain>*:not(#content) {
  font-family: 'Roboto', sans-serif;
}

#vueMain>*:not(#content) ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#app,
#content,
#vueMain {
  display: flex;
  flex: 1;
}
</style>