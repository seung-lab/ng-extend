<template>
  <div class="nge-getting-started">
    <div class="nge-gs-links">
      <div class="nge-gs-link">
        <a href="https://bit.ly/3s8ViUJ" target="_blank">Welcome video</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://bit.ly/3P6qXQz" target="_blank">Quick Start</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://bit.ly/3OWi6AP" target="_blank">Self-guided training</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://bit.ly/3kzb3jx" target="_blank">Cheatsheet</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://join.slack.com/t/flywire-forum/shared_invite/zt-d6pyjonk-uC7_kjcjU~8c64t~Qid~oQ" target="_blank" title="For professional researchers only">Slack Forum</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://bit.ly/3P6qXQz" target="_blank">Codex</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://bit.ly/3kBLEFR" target="_blank">Tools</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://bit.ly/3kCoZcw" target="_blank">Support</a>
      </div>
      <div class="nge-gs-link">
        <button @click="appState.introductionStep = 0">Restart Tutorial</button>
      </div>
      <template v-if="inProduction">
        <div class="nge-gs-link">
          <button class="checkoutButton" @click="appState.checkoutNeuron()">Get Cell to Proofread</button>
          <button class="checkoutHelpButton" @click="appState.setShowCheckoutHelp(true)" title="Show help"></button>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { layerProxy, storeProxy } from "../state";

export default Vue.extend({
  data: () => {
    return {
      appState: storeProxy,
    }
  },
  computed: {
    inProduction() {
      return layerProxy.activeSegmentationLayer && layerProxy.activeSegmentationLayer!.name!.startsWith("Production");
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
  margin-bottom: 0.5em;
}
.nge-gs-link > a {
  color: #fff;
}
.nge-gs-link > .checkoutHelpButton {
  background-image: url('images/question.svg');
  width: 18px;
  height: 18px;
  background-size: 100%;
}
</style>
