<script setup lang="ts">
import TutorialStep from "#src/components/TutorialStep.vue";

import { computed } from "vue";
import { useTutorialStore } from "#src/store-pyr.js";
import { steps as steps1 } from "#src/tutorial-1.js";
import { steps as steps2 } from "#src/tutorial-2.js";
const store = useTutorialStore();

const steps = computed(() => store.activeTutorial === 1 ? steps1 : steps2);

const currentStep = computed(() =>
    store.activeTutorial === 1 ? store.tutorialStep1 : store.tutorialStep2
);

const activeStep = computed(() => {
    const index = currentStep.value;
    if (index >= 0 && index < steps.value.length) {
        return {
            index: index,
            step: steps.value[index],
            first: index === 0,
            last: index === steps.value.length - 1,
        }
    } else {
        return null;
    }
});

const next = () => { store.setTutorialStep(store.getTutorialStep() + 1); };
const back = () => { store.setTutorialStep(Math.max(0, store.getTutorialStep() - 1)); };
const exitIntro = () => {
    console.log('exiting intro!');
    store.setTutorialStep(steps.value.length);
};

</script>

<template>
    <TutorialStep v-if="activeStep" :key="activeStep.index" :step="activeStep.step" :first="activeStep.first"
        :last="activeStep.last" :stepIndex="activeStep.index" :totalSteps="steps.length"
        v-on:next="next"
        v-on:back="back" v-on:exitIntro="exitIntro" />
</template>

<style scoped>
.introduction {
    z-index: 89;
    /* having this here solves a chrome transition bug */
}

.tooltip-enter-active,
.tooltip-leave-active {
    transition: opacity 0.3s;
}

.tooltip-enter,
.tooltip-leave-to {
    opacity: 0;
}
</style>