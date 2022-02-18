<template>
  <div class="introduction" v-if="appState.finishedLoading && layerState.activeSegmentationLayer && layerState.activeSegmentationLayer.name === 'Sandbox'">
    <transition name="tooltip">
      <introduction-step v-if="activeStep" :key="activeStep.index" :step="activeStep.step" :first="activeStep.first" :last="activeStep.last"
        v-on:next="next" v-on:back="back" v-on:exitIntro="exitIntro"></introduction-step>
    </transition>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy, layerProxy } from "../state";
import {steps} from "../introduction-steps";

import IntroductionStep from "components/IntroductionStep.vue";

export default Vue.extend({
  components: { IntroductionStep },
  data: () => {
    return {
      appState: storeProxy,
      layerState: layerProxy,
    }
  },
  computed: {
    activeStep() {
      const step = storeProxy.introductionStep;

      if (step < steps.length) {

        this.maybePreload(step + 1);
        this.maybePreload(step - 1);

        return {
          step: steps[step],
          index: step,
          first: step === 0,
          last: step === steps.length - 1,
        }
      } else {
        return null;
      }
    },
  },
  methods: {
    maybePreload(stepIndex: number) {
        if (stepIndex > 0 && stepIndex < steps.length) {
          const nextStep = steps[stepIndex];

          if (nextStep.video && !nextStep.videoBeingPreloaded) {
            nextStep.videoBeingPreloaded = true;
            fetch(nextStep.video).then((res) => {
              return res.blob();
            }).then((blob) => {
              nextStep.video = URL.createObjectURL(blob);
            })
          }
        }
    },
    next() {
      storeProxy.introductionStep++;
    },
    back() {
      storeProxy.introductionStep = Math.max(0, storeProxy.introductionStep - 1);
    },
    exitIntro() {
      storeProxy.introductionStep = steps.length;
    }
  }
});
</script>

<style scoped>
.introduction {
  z-index: 89; /* having this here solves a chrome transition bug */
}

.tooltip-enter-active, .tooltip-leave-active {
  transition: opacity 0.3s;
}

.tooltip-enter, .tooltip-leave-to {
  opacity: 0;
}
</style>
