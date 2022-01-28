<template>
  <div class="nge-getting-started">
    <div class="nge-gs-links">
      <div class="nge-gs-link">
        <a href="https://www.youtube-nocookie.com/embed/LH4iovmbv3c" target="_blank">Welcome video</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1imS4s8Bfl6KaGHbIlDNus6EdFNuX8dVtCHvyiyDY1Wc/edit" target="_blank">Quick Start</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1ItdRpMybhx1ebjI41TQZDFIymfruk_GiZu4ztP6f3OM/edit" target="_blank">Self-guided training</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1tjy6axXvxVcfvrYiBbJsLTSx1Y3rTGI_HcXKETIqyiM/edit" target="_blank">Cheatsheet</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://join.slack.com/t/flywire-forum/shared_invite/zt-d6pyjonk-uC7_kjcjU~8c64t~Qid~oQ" target="_blank">Slack Forum</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1lbXy-cpFyNB47_qAJi-A53vyNRvYAl8KE0bfXm2PLrE/edit" target="_blank">Tools</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://flywire.ai/support.html" target="_blank">Support</a>
      </div>
      <div class="nge-gs-link">
        <button @click="appState.introductionStep = 0">Restart Tutorial</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { storeProxy } from "../state";

export default Vue.extend({
  data: () => {
    return {
      appState: storeProxy,
    }
  },
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
  margin-bottom: 1em;
}
.nge-gs-link > a {
  color: #fff;
}
</style>
