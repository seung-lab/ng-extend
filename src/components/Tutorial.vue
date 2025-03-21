<script setup lang="ts">
import TutorialStep from "#src/components/TutorialStep.vue";

import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useTutorialStore } from "#src/store-pyr.js";
import { steps } from "#src/tutorial-1.js";
const { tutorialStep } = storeToRefs(useTutorialStore());


const activeStep = computed(() => {
    const index = tutorialStep.value;
    if (index < steps.length) {
        return {
            index: index,
            step: steps[index],
            first: index === 0,
            last: index === steps.length - 1,

        }
    } else {
        return null;
    }
});

const exitIntro = () => {
    console.log('exiting intro!');
    tutorialStep.value = steps.length;
};

</script>

<template>
    <TutorialStep v-if="activeStep" :key="activeStep.index" :step="activeStep.step" :first="activeStep.first"
        :last="activeStep.last" v-on:next="tutorialStep = tutorialStep + 1"
        v-on:back="tutorialStep = Math.max(0, tutorialStep - 1)" v-on:exitIntro="exitIntro" />
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