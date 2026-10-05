<script setup lang="ts">
import TutorialStep from "components/TutorialStep.vue";

import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useTutorialStore } from '../store-pyr';
import { useProofreadingBackendStore } from '../store';
import { supabase } from '../supabase';
import { steps as steps1 } from '../tutorial-1';
import { steps as steps2 } from '../tutorial-2';
import { steps as steps3 } from '../tutorial-3';
import { steps as steps4 } from '../site-tour';
import { steps as steps5 } from '../tutorial-cut';
import { endPractice } from '../practice';
import badgeCitizenScientist from '../images/badge-citizen-scientist.png';
import badgeClearanceLevel2 from '../images/badge-clearance-level-2.png';
// Badge art for the merge and cut tutorials is not drawn yet (Amy, 2026-09-28);
// until it is, the confetti and super Nurros from static/nurro stand in.
import badgeMerge from '../../static/nurro/nurro-confetti-card.png';
import badgeCut from '../../static/nurro/nurro-super-v2.png';


const store = useTutorialStore();

const STEPS_MAP: Record<number, typeof steps1> = { 1: steps1, 2: steps2, 3: steps3, 4: steps4, 5: steps5 };
const steps = computed(() => STEPS_MAP[store.activeTutorial] ?? steps1);

const currentStep = computed(() => {
    if (store.activeTutorial === 1) return store.tutorialStep1;
    if (store.activeTutorial === 2) return store.tutorialStep2;
    if (store.activeTutorial === 3) return store.tutorialStep3;
    if (store.activeTutorial === 5) return store.tutorialStep5;
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
    3: { key: 'nge-badge-merge-master', title: 'Merge Master', image: badgeMerge },
    // The first rung (Ames, 2026-10-05): harder cut tutorials lead up to Cut Master.
    5: { key: 'nge-badge-kindergarten-cut', title: 'Kindergarten Cut', image: badgeCut },
};

async function awardBadgeIfNew(tutorialNum: number) {
    const badge = BADGE_KEYS[tutorialNum];
    if (!badge) return;
    const backend = useProofreadingBackendStore();

    // The localStorage flag gates the CELEBRATION only (once per browser). It must
    // NOT gate persistence: the old code set it before the login check below, so a
    // logged-out user who finished the tutorial burned the flag and never got a DB
    // record — even after logging in. Persistence is idempotent (upsert), so it's
    // safe to attempt on every completion and independently of the flag.
    if (!localStorage.getItem(badge.key)) {
        localStorage.setItem(badge.key, new Date().toISOString());
        // Trigger the fancy hero celebration in AchievementToast via the store
        backend.pendingBadgeCelebration = {
            title: `🏆 New Achievement: ${badge.title}`,
            body: `You earned the "${badge.title}" badge! — Completed Tutorial ${tutorialNum}`,
            imageUrl: badge.image,
        };
    }

    // Persist to Supabase: self-award the special badge, then announce it.
    try {
        if (!backend.userId) return;

        // The badge must exist as a special_badges row (Citizen Scientist /
        // Advanced Operator). If it doesn't, there's nothing to persist — the
        // award silently no-ops until those rows are created.
        const matchingBadge = backend.specialBadges.find(
            (b: any) => b.name === badge.title || b.slug === badge.key
        );
        if (!matchingBadge) return;

        // Announce (notification) ONLY when this is a genuinely new award, so
        // replaying the tutorial doesn't insert duplicate "New Achievement"
        // rows. The upsert itself is idempotent.
        const alreadyAwarded = backend.mySpecialBadges.some((a: any) => a.badge_id === matchingBadge.id);

        // Direct insert (no admin check) for tutorial self-awards.
        await supabase.from('special_badge_awards').upsert({
            badge_id: matchingBadge.id,
            user_id: backend.userId,
            awarded_by: null,
            reason: `Completed Tutorial ${tutorialNum}`,
        }, { onConflict: 'badge_id,user_id' });
        await backend.loadMySpecialBadges();

        if (!alreadyAwarded) {
            await backend.createSelfNotification({
                title: `🏆 New Achievement: ${badge.title}`,
                body: `You completed Tutorial ${tutorialNum} and earned the "${badge.title}" badge! Congratulations!`,
                image_url: badge.image,
                thumbnail_url: badge.image,
            });
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
        //
        // Fired immediately: UsernamePrompt waits for the badge celebration to
        // actually finish before showing. A fixed delay here raced it and the
        // modal landed on top of the badge art.
        if (tutorialNum === 1) {
            document.dispatchEvent(new CustomEvent('nge:prompt-username'));
        }
    }
};
// Switching to another tutorial from the book menu also hands the cell back.
const PRACTICE_TUTORIALS = [3, 5];
watch(() => store.activeTutorial, (now, before) => {
  if (PRACTICE_TUTORIALS.includes(before) && !PRACTICE_TUTORIALS.includes(now)) endPractice();
});
// A practice step advances by itself when the edit lands (Amy: straight
// to the success box).
document.addEventListener('nge:tutorial-next', () => { if (activeStep.value) next(); });
const back = () => { store.setTutorialStep(Math.max(0, store.getTutorialStep() - 1)); };
// ── Resuming on page load (Nseraf 2026-09-29) ──
// Progress follows the account, so a tutorial left partway used to restart
// its current step on every visit, and each step loads its own view: Nseraf,
// stuck at step 5 of Advanced Interface, was pulled to the Sandbox whenever he
// opened Retina. A tutorial found partway at load now waits behind a small
// Continue / Exit card and loads nothing until you choose. Starting a
// tutorial from the menu (step 0) needs no prompt.
const TUTORIAL_NAMES: Record<number, string> = { 1: 'Get Started', 2: 'Advanced Interface', 3: 'Merge', 4: 'Site Tour', 5: 'Cut' };
const resumeDecided = ref(false);
watch(() => [store.activeTutorial, currentStep.value] as const, ([, stepNow]) => {
    if (stepNow === 0) resumeDecided.value = true;       // a fresh start from the menu
});
const needsResumePrompt = computed(() => !resumeDecided.value && !!activeStep.value && activeStep.value.index > 0);
const resumeName = computed(() => TUTORIAL_NAMES[store.activeTutorial] ?? 'the tutorial');
function continueTutorial() { resumeDecided.value = true; }
function exitFromPrompt() { resumeDecided.value = true; exitIntro(); }

const exitIntro = () => {
    console.log('exiting intro!');
    // Leaving the merge or cut tutorial mid practice hands the cell back.
    if (store.activeTutorial === 3 || store.activeTutorial === 5) endPractice();
    store.setTutorialStep(steps.value.length);
};

</script>

<template>
    <div v-if="needsResumePrompt" class="nge-tut-resume" role="dialog" aria-label="Resume tutorial">
        <div class="nge-tut-resume-text">
            You're partway through <strong>{{ resumeName }}</strong>
            <span class="nge-tut-resume-step">step {{ (activeStep?.index ?? 0) + 1 }} of {{ steps.length }}</span>
        </div>
        <div class="nge-tut-resume-actions">
            <button class="nge-tut-resume-go" @click="continueTutorial">Continue</button>
            <button class="nge-tut-resume-exit" @click="exitFromPrompt">Exit tutorial</button>
        </div>
    </div>
    <TutorialStep v-else-if="activeStep" :key="activeStep.index" :step="activeStep.step" :first="activeStep.first"
        :last="activeStep.last" :stepIndex="activeStep.index" :totalSteps="steps.length"
        v-on:next="next"
        v-on:back="back" v-on:exitIntro="exitIntro" />

</template>

<style scoped>
.nge-tut-resume {
    position: fixed;
    left: 50%;
    bottom: 64px;
    transform: translateX(-50%);
    z-index: 9500;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 14px 12px 18px;
    border-radius: 12px;
    background: rgba(8, 12, 24, 0.96);
    border: 1px solid rgba(126, 202, 255, 0.35);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55), 0 0 18px rgba(74, 158, 255, 0.12);
    color: #d6e4f5;
    font-family: 'Inter', 'Roboto', sans-serif;
    font-size: 14px;
    animation: nge-tut-resume-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
@keyframes nge-tut-resume-in { from { opacity: 0; translate: 0 12px; } to { opacity: 1; translate: 0 0; } }
.nge-tut-resume strong { color: #fff; }
.nge-tut-resume-step { margin-left: 6px; font-size: 12px; color: #8fa6c2; }
.nge-tut-resume-actions { display: flex; gap: 8px; }
.nge-tut-resume-actions button {
    border-radius: 999px;
    padding: 5px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}
.nge-tut-resume-go { background: #4a9eff; border: 1px solid #4a9eff; color: #04121f; }
.nge-tut-resume-go:hover { background: #7ecaff; }
.nge-tut-resume-exit { background: transparent; border: 1px solid rgba(126, 202, 255, 0.35); color: #cfe0ff; }
.nge-tut-resume-exit:hover { border-color: rgba(126, 202, 255, 0.8); color: #fff; }

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

