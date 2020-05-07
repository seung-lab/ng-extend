<template>
  <div class="nge-getting-started">
    <div class="nge-gs-links">
      <div class="nge-gs-link">
        <a href="https://drive.google.com/file/d/19qtO1U0wF4Ga9_Ruow6yHvRyZxsSG3zn/view?ts=5e822617" target="_blank" @click="markRead('welcomeRead')">Welcome video</a>
        <span class="nge-gs-unread" v-show="!welcomeRead">⬤</span>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1imS4s8Bfl6KaGHbIlDNus6EdFNuX8dVtCHvyiyDY1Wc/edit" target="_blank" @click="markRead('quickstartRead')">Quick Start</a>
        <span class="nge-gs-unread" v-show="!quickstartRead">⬤</span>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1tjy6axXvxVcfvrYiBbJsLTSx1Y3rTGI_HcXKETIqyiM/edit" target="_blank" @click="markRead('cheatsheetRead')">Cheatsheet</a>
        <span class="nge-gs-unread" v-show="!cheatsheetRead">⬤</span>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1ItdRpMybhx1ebjI41TQZDFIymfruk_GiZu4ztP6f3OM/edit" target="_blank" @click="markRead('trainingRead')">Self-guided training</a>
        <span class="nge-gs-unread" v-show="!trainingRead">⬤</span>
      </div>
      <div class="nge-gs-link">
        <a href="https://join.slack.com/t/flywire-forum/shared_invite/zt-d6pyjonk-uC7_kjcjU~8c64t~Qid~oQ" target="_blank">Slack Forum</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://flywire.ai/support.html" target="_blank">Support</a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  data() {
    return {
      welcomeRead: localStorage.getItem("welcomeRead") === "true",
      quickstartRead: localStorage.getItem("quickstartRead") === "true",
      cheatsheetRead: localStorage.getItem("cheatsheetRead") === "true",
      trainingRead: localStorage.getItem("trainingRead") === "true"
    }
  },
  methods: {
    markRead(link: string) {
      (<any>this)[link] = true;
      localStorage.setItem(link, "true");
    }
  }
});
</script>

<style>
.nge-getting-started {
  background-color: #111;
}
.nge-gs-title {
  text-align: center;
  font-size: 1.3em;
  padding-top: 0.75em;
  padding-bottom: 0.75em;
}
.nge-gs-title > a {
  color: #fff;
}
.nge-gs-links {
  padding-left: 1em;
  padding-top: 1em;
}
.nge-gs-link {
  padding-bottom: 1em;
}
.nge-gs-link > a {
  color: #fff;
}
.nge-gs-unread {
  text-shadow: 0 0 8px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    color: rgba(15, 177, 139, 1);
  }
  50% {
    color: rgba(2, 146, 174, 1);
  }
  100% {
    color: rgba(15, 177, 139, 1);
  }
}
</style>
