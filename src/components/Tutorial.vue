<script setup lang="ts">
import TutorialStep from "#src/components/TutorialStep.vue";

import { computed, ref } from "vue";
import { useTutorialStore } from "#src/store-pyr.js";
import { steps as steps1 } from "#src/tutorial-1.js";
import { steps as steps2 } from "#src/tutorial-2.js";
import badgeCitizenScientist from "#src/images/badge-citizen-scientist.png";
import badgeClearanceLevel2 from "#src/images/badge-clearance-level-2.png";

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

// Badge celebration state
const showBadge = ref(false);
const badgeImage = ref('');
const badgeTitle = ref('');

const BADGE_KEYS: Record<number, { key: string; title: string; image: string }> = {
    1: { key: 'nge-badge-citizen-scientist', title: 'Citizen Scientist', image: badgeCitizenScientist },
    2: { key: 'nge-badge-advanced-operator', title: 'Advanced Operator', image: badgeClearanceLevel2 },
};

function awardBadgeIfNew(tutorialNum: number) {
    const badge = BADGE_KEYS[tutorialNum];
    if (!badge) return;
    if (localStorage.getItem(badge.key)) return; // already awarded
    localStorage.setItem(badge.key, new Date().toISOString());
    badgeImage.value = badge.image;
    badgeTitle.value = badge.title;
    showBadge.value = true;
}

function dismissBadge() {
    showBadge.value = false;
    badgeImage.value = '';
    badgeTitle.value = '';
}

const next = () => {
    const isLastStep = activeStep.value?.last;
    const tutorialNum = store.activeTutorial;
    store.setTutorialStep(store.getTutorialStep() + 1);
    if (isLastStep) {
        awardBadgeIfNew(tutorialNum);
    }
};
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

    <!-- Badge celebration overlay -->
    <Teleport to="body">
        <div v-if="showBadge" class="badge-celebration" @click="dismissBadge">
            <div class="badge-celebration-content" @click.stop>
                <div class="badge-glow"></div>
                <div class="badge-label">Achievement Unlocked</div>
                <img class="badge-image" :src="badgeImage" :alt="badgeTitle">
                <div class="badge-title">{{ badgeTitle }}</div>
                <button class="badge-dismiss" @click="dismissBadge">Continue</button>
            </div>
        </div>
    </Teleport>
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

<style>
/* Badge celebration - unscoped so Teleport works */
.badge-celebration {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at center, rgba(10, 15, 35, 0.92), rgba(0, 0, 0, 0.96));
    backdrop-filter: blur(8px);
    animation: badgeOverlayIn 0.6s ease-out;
}

@keyframes badgeOverlayIn {
    0% { opacity: 0; }
    100% { opacity: 1; }
}

.badge-celebration-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    position: relative;
    animation: badgeContentIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both;
}

@keyframes badgeContentIn {
    0% {
        opacity: 0;
        transform: scale(0.7) translateY(30px);
        filter: blur(8px) brightness(2);
    }
    60% {
        transform: scale(1.05) translateY(-5px);
        filter: blur(0) brightness(1.3);
    }
    100% {
        opacity: 1;
        transform: scale(1) translateY(0);
        filter: blur(0) brightness(1);
    }
}

.badge-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 350px;
    height: 350px;
    transform: translate(-50%, -55%);
    background: radial-gradient(circle, rgba(0, 180, 255, 0.15) 0%, rgba(80, 140, 255, 0.05) 50%, transparent 70%);
    border-radius: 50%;
    animation: badgePulse 3s ease-in-out infinite;
    pointer-events: none;
}

@keyframes badgePulse {
    0%, 100% { transform: translate(-50%, -55%) scale(1); opacity: 0.8; }
    50% { transform: translate(-50%, -55%) scale(1.15); opacity: 1; }
}

.badge-label {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: rgba(0, 200, 255, 0.8);
    font-weight: 400;
}

.badge-image {
    width: 220px;
    height: 220px;
    object-fit: contain;
    filter: drop-shadow(0 0 30px rgba(0, 180, 255, 0.3)) drop-shadow(0 0 60px rgba(80, 100, 255, 0.15));
    animation: badgeFloat 4s ease-in-out infinite;
}

@keyframes badgeFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
}

.badge-title {
    font-size: 28px;
    font-weight: 300;
    color: #d0e8ff;
    letter-spacing: 1px;
    text-shadow: 0 0 20px rgba(0, 180, 255, 0.3);
}

.badge-dismiss {
    margin-top: 12px;
    padding: 8px 32px;
    border-radius: 999px;
    border: 1px solid rgba(160, 200, 240, 0.4);
    background: rgba(20, 30, 60, 0.6);
    color: #d0e8ff;
    font-size: 15px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: all 0.2s;
}

.badge-dismiss:hover {
    background: rgba(40, 60, 120, 0.6);
    border-color: rgba(160, 200, 240, 0.7);
    box-shadow: 0 0 15px rgba(0, 180, 255, 0.2);
}
</style>