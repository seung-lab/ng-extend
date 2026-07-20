<script setup lang="ts">
import TutorialStep from "components/TutorialStep.vue";

import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useTutorialStore } from '../store-pyr';
import { useProofreadingBackendStore } from '../store';
import { supabase } from '../supabase';
import { steps as steps1 } from '../tutorial-1';
import { steps as steps2 } from '../tutorial-2';
import { steps as steps3 } from '../tutorial-3';
import { steps as steps4 } from '../site-tour';
import badgeCitizenScientist from '../images/badge-citizen-scientist.png';
import badgeClearanceLevel2 from '../images/badge-clearance-level-2.png';


const store = useTutorialStore();

const STEPS_MAP: Record<number, typeof steps1> = { 1: steps1, 2: steps2, 3: steps3, 4: steps4 };
const steps = computed(() => STEPS_MAP[store.activeTutorial] ?? steps1);

const currentStep = computed(() => {
    if (store.activeTutorial === 1) return store.tutorialStep1;
    if (store.activeTutorial === 2) return store.tutorialStep2;
    if (store.activeTutorial === 3) return store.tutorialStep3;
    return store.tutorialStep4;
});

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

const BADGE_KEYS: Record<number, { key: string; title: string; image: string }> = {
    1: { key: 'nge-badge-citizen-scientist', title: 'Citizen Scientist', image: badgeCitizenScientist },
    2: { key: 'nge-badge-advanced-operator', title: 'Advanced Operator', image: badgeClearanceLevel2 },
    // 3: Tutorial 3 badge TBD
};

async function awardBadgeIfNew(tutorialNum: number) {
    const badge = BADGE_KEYS[tutorialNum];
    if (!badge) return;
    if (localStorage.getItem(badge.key)) return; // already awarded
    localStorage.setItem(badge.key, new Date().toISOString());

    // Trigger the fancy hero celebration in AchievementToast via the store
    const backend = useProofreadingBackendStore();
    backend.pendingBadgeCelebration = {
        title: `🏆 New Achievement: ${badge.title}`,
        body: `You earned the "${badge.title}" badge! — Completed Tutorial ${tutorialNum}`,
        imageUrl: badge.image,
    };

    // Also persist to Supabase: create notification + self-award special badge
    try {
        if (!backend.userId) return;

        // Create a notification so it shows in the bell feed
        await backend.createSelfNotification({
            title: `🏆 New Achievement: ${badge.title}`,
            body: `You completed Tutorial ${tutorialNum} and earned the "${badge.title}" badge! Congratulations!`,
            image_url: badge.image,
            thumbnail_url: badge.image,
        });

        // Self-award as special badge so it shows on profile
        // Find or skip if badge doesn't exist in special_badges table
        const matchingBadge = backend.specialBadges.find(
            (b: any) => b.name === badge.title || b.slug === badge.key
        );
        if (matchingBadge) {
            // Use direct insert (no admin check) for tutorial self-awards
            await supabase.from('special_badge_awards').upsert({
                badge_id: matchingBadge.id,
                user_id: backend.userId,
                awarded_by: null,
                reason: `Completed Tutorial ${tutorialNum}`,
            }, { onConflict: 'badge_id,user_id' });
            await backend.loadMySpecialBadges();
        }
    } catch (e) {
        console.warn('[tutorial] badge persistence error:', e);
    }
}

const next = () => {
    const isLastStep = activeStep.value?.last;
    const tutorialNum = store.activeTutorial;
    store.setTutorialStep(store.getTutorialStep() + 1);
    if (isLastStep) {
        awardBadgeIfNew(tutorialNum);
        // Ask for a username after Tutorial 1 — by now they've seen the
        // community side of the app, so the ask makes sense. Login would be
        // too early (and is already a multi-step auth flow). The prompt
        // no-ops if they already have one or previously dismissed it.
        // Delayed so it doesn't collide with the badge celebration.
        if (tutorialNum === 1) {
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('nge:prompt-username'));
            }, 4000);
        }
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

