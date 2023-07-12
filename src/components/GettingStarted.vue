<template>
  <div class="nge-getting-started">
    <div class="nge-gs-links">
      <div class="nge-gs-link welcome">
        <a href="https://bit.ly/3s8ViUJ" target="_blank">Welcome video</a>
      </div>
      <div class="nge-gs-link howtouse">
        <a href="https://blog.flywire.ai/2023/05/22/how-to-use-flywire-2/" target="_blank">How to Use FlyWire</a>
      </div>
      <div class="nge-gs-link quickstart">
        <a href="https://bit.ly/3P6qXQz" target="_blank">Quick Start</a>
      </div>
      <template v-if="!inRelease">
        <div class="nge-gs-link training">
          <a href="https://bit.ly/3OWi6AP" target="_blank">Self-guided training</a>
        </div>
      </template>
      <div class="nge-gs-link cheatsheet">
        <a href="https://bit.ly/3kzb3jx" target="_blank">Cheatsheet</a>
      </div>
      <div class="nge-gs-link codex">
        <a href="https://codex.flywire.ai/" target="_blank">Codex</a>
      </div>
      <div class="nge-gs-link tools">
        <a href="https://bit.ly/3kBLEFR" target="_blank">Tools</a>
      </div>
      <div class="nge-gs-link support">
        <a href="https://bit.ly/3kCoZcw" target="_blank">Support</a>
      </div>
      <div class="nge-gs-link restart">
        <button @click="appState.introductionStep = 0">Restart Tutorial</button>
      </div>
      <!--template v-if="inProduction">
        <div class="nge-gs-link">
          <button class="checkoutButton" @click="appState.checkoutNeuron()">Get Cell to Proofread</button>
          <button class="checkoutHelpButton" @click="appState.setShowCheckoutHelp(true)" title="Show help"></button>
        </div>
      </template-->
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
    },
    inRelease() {
      return layerProxy.activeSegmentationLayer && layerProxy.activeSegmentationLayer!.name!.startsWith("Release");
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
