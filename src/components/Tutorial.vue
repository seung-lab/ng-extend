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
import { steps as steps6 } from '../tutorial-mec-tour';
import { steps as steps7 } from '../tutorial-retina-tour';
import { steps as steps8 } from '../tutorial-flywire-tour';
import { steps as steps9 } from '../merger-sandbox';
import { steps as steps10 } from '../tutorial-ca3-tour';
import { endPractice } from '../practice';
import { practiceEarned, recordTutorialDone, stopWatching } from '../tutorial-3';
import badgeCitizenScientist from '../images/badge-citizen-scientist.png';
import badgeClearanceLevel2 from '../images/badge-clearance-level-2.png';
// Mini Michelangelo art from Ames (2026-10-07).
import badgeMerge from '../../static/badges/mini-michelangelo.png';
// Safety Scissors art from Ames (2026-10-07).
import badgeCut from '../../static/badges/safety-scissors.png';


const store = useTutorialStore();

const STEPS_MAP: Record<number, typeof steps1> = { 1: steps1, 2: steps2, 3: steps3, 4: steps4, 5: steps5, 6: steps6, 7: steps7, 8: steps8, 9: steps9, 10: steps10 };
const steps = computed(() => STEPS_MAP[store.activeTutorial] ?? steps1);

const currentStep = computed(() => {
    if (store.activeTutorial === 1) return store.tutorialStep1;
    if (store.activeTutorial === 2) return store.tutorialStep2;
    if (store.activeTutorial === 3) return store.tutorialStep3;
    if (store.activeTutorial === 5) return store.tutorialStep5;
    if (store.activeTutorial === 6) return store.tutorialStep6;
    if (store.activeTutorial === 7) return store.tutorialStep7;
    if (store.activeTutorial === 8) return store.tutorialStep8;
    if (store.activeTutorial === 9) return store.tutorialStep9;
    if (store.activeTutorial === 10) return store.tutorialStep10;
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
    3: { key: 'nge-badge-mini-michelangelo', title: 'Mini Michelangelo', image: badgeMerge },
    // The first rung (Ames, 2026-10-05): harder cut tutorials lead up to Cut Master.
    5: { key: 'nge-badge-safety-scissors', title: 'Safety Scissors', image: badgeCut },
};

async function awardBadgeIfNew(tutorialNum: number) {
    const badge = BADGE_KEYS[tutorialNum];
    if (!badge) return;
    // Merge and Cut are earned by making the practice edits, not by
    // pressing Next through the boxes (Ames, 2026-10-06).
    if ((tutorialNum === 3 || tutorialNum === 5) && !practiceEarned()) return;
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
            body: `You earned the "${badge.title}" achievement by completing the ${TUTORIAL_NAMES[tutorialNum] ?? ''} tutorial.`,
            imageUrl: badge.image,
        };
    }

    await persistTutorialAward(tutorialNum);
}

/**
 * Record a tutorial's award for the signed in player, and say so (a
 * notification and a line in chat) the first time.
 *
 * The list of awards used to be loaded only when the Admin Hub opened, so for
 * every player who is not an admin the award was looked up in an empty list
 * and silently never recorded: by 2026-10-08 nobody held Mini Michelangelo or
 * Safety Scissors. The list is now fetched here when it is not there yet.
 */
async function persistTutorialAward(tutorialNum: number) {
    const badge = BADGE_KEYS[tutorialNum];
    if (!badge) return;
    const backend = useProofreadingBackendStore();
    try {
        if (!backend.userId) return;
        if (!backend.specialBadges.length) await backend.loadSpecialBadges();

        // The award must exist as a special_badges row. If it does not, there
        // is nothing to record.
        const matchingBadge = backend.specialBadges.find(
            (b: any) => b.name === badge.title || b.slug === badge.key
        );
        if (!matchingBadge) return;

        // Announce ONLY when this is a genuinely new award, so replaying the
        // tutorial does not repeat it. The list is read fresh first: at sign
        // in it may not have arrived yet. The upsert itself is idempotent.
        await backend.loadMySpecialBadges();
        const alreadyAwarded = backend.mySpecialBadges.some((a: any) => a.badge_id === matchingBadge.id);
        if (alreadyAwarded) return;

        // Direct insert (no admin check) for tutorial self-awards.
        await supabase.from('special_badge_awards').upsert({
            badge_id: matchingBadge.id,
            user_id: backend.userId,
            awarded_by: null,
            reason: `Completed Tutorial ${tutorialNum}`,
        }, { onConflict: 'badge_id,user_id' });
        await backend.loadMySpecialBadges();
        // Only if it was really recorded.
        if (!backend.mySpecialBadges.some((a: any) => a.badge_id === matchingBadge.id)) return;
        // and in chat (the server posts it once)
        backend.announceAchievement('special', matchingBadge.id);
        await backend.createSelfNotification({
            title: `🏆 New Achievement: ${badge.title}`,
            body: `You completed the ${TUTORIAL_NAMES[tutorialNum] ?? ''} tutorial and earned the "${badge.title}" achievement. Congratulations!`,
            image_url: badge.image,
            thumbnail_url: badge.image,
        });
    } catch (e) {
        console.warn('[tutorial] badge persistence error:', e);
    }
}

// Players who finished a tutorial while the award could not be recorded (see
// above) get it the next time they sign in: this browser remembers which
// tutorials it celebrated, and each of those is recorded if it is missing.
watch(() => useProofreadingBackendStore().userId, async id => {
    if (!id) return;
    for (const n of Object.keys(BADGE_KEYS).map(Number)) {
        let earned = false;
        try { earned = !!localStorage.getItem(BADGE_KEYS[n].key); } catch { /* no storage */ }
        if (earned) await persistTutorialAward(n);
    }
}, { immediate: true });

const next = () => {
    const isLastStep = activeStep.value?.last;
    const tutorialNum = store.activeTutorial;
    // The last box closes the tutorial outright, by its length, so nothing
    // that moves the step at the same moment can leave it showing.
    store.setTutorialStep(isLastStep ? steps.value.length : store.getTutorialStep() + 1);
    if (isLastStep) {
        console.info(`[tutorial] finished tutorial ${tutorialNum}; step is now ${store.getTutorialStep()} of ${steps.value.length}`);
        // The sandbox records each merger as it is cut, not the box closing.
        if (tutorialNum !== 9) recordTutorialDone(tutorialNum);
        // Say so if anything puts a box back in the next few seconds.
        const stop = watch(currentStep, (now) => {
            if (store.activeTutorial === tutorialNum && now < steps.value.length) {
                console.warn(`[tutorial] step moved back to ${now} after finishing tutorial ${tutorialNum}`, new Error('who moved it').stack);
            }
        });
        setTimeout(stop, 8000);
        awardBadgeIfNew(tutorialNum);
        // Ask for a username after Tutorial 1 — by now they've seen the
        // community side of the app, so the ask makes sense. Login would be
        // too early (and is already a multi-step auth flow). The prompt
        // no-ops if they already have one or previously dismissed it.
        //
        // Fired immediately: UsernamePrompt waits for the badge celebration to
        // actually finish before showing. A fixed delay here raced it and the
        // modal landed on top of the badge art.
        // A dataset tour ends by opening the Cell Library on Available.
        if (tutorialNum === 6 || tutorialNum === 7) {
            document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'available' } }));
        }
        if (tutorialNum === 1) {
            document.dispatchEvent(new CustomEvent('nge:prompt-username'));
        }
    }
};
// Switching to another tutorial from the book menu also hands the cell back.
const PRACTICE_TUTORIALS = [3, 5, 9];
watch(() => store.activeTutorial, (now, before) => {
  if (PRACTICE_TUTORIALS.includes(before) && !PRACTICE_TUTORIALS.includes(now)) endPractice();
});
// A practice step advances by itself when the edit lands (Amy: straight
// to the success box).
// Never on the last box: finishing a tutorial is the learner's own click.
document.addEventListener('nge:tutorial-next', () => { if (activeStep.value && !activeStep.value.last) next(); });
const back = () => { store.setTutorialStep(Math.max(0, store.getTutorialStep() - 1)); };
// ── Resuming on page load (Nseraf 2026-09-29) ──
// Progress follows the account, so a tutorial left partway used to restart
// its current step on every visit, and each step loads its own view: Nseraf,
// stuck at step 5 of Advanced Interface, was pulled to the Sandbox whenever he
// opened Retina. A tutorial found partway at load now waits behind a small
// Continue / Exit card and loads nothing until you choose. Starting a
// tutorial from the menu (step 0) needs no prompt.
const TUTORIAL_NAMES: Record<number, string> = { 1: 'Get Started', 2: 'Advanced Interface', 3: 'Merge', 4: 'Site Tour', 5: 'Cut', 6: 'Meet the cells of MEC', 7: 'Meet the cells of the retina', 8: 'Meet the cells of the fly brain', 9: 'Merger Sandbox' };
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
    const leaving = store.activeTutorial;
    if (PRACTICE_TUTORIALS.includes(leaving)) { stopWatching(); endPractice(); }
    store.setTutorialStep(steps.value.length);
    // Exit is reported as not always closing the tutorial, and it closes in
    // every test: say what puts a box back, if anything does.
    const stop = watch(() => [store.activeTutorial, currentStep.value] as const, ([tut, now]) => {
        if (tut !== leaving || now < steps.value.length) {
            console.warn(`[tutorial] a box came back after exiting tutorial ${leaving}: now tutorial ${tut}, step ${now}`, new Error('who moved it').stack);
        }
    });
    setTimeout(stop, 15000);
};

</script>

<template>
    <div v-if="needsResumePrompt" class="ng-extend nge-tut-resume" role="dialog" aria-label="Resume tutorial">
        <div class="nge-tut-resume-text">
            You're partway through <strong>{{ resumeName }}</strong>
            <span class="nge-tut-resume-step">step {{ (activeStep?.index ?? 0) + 1 }} of {{ steps.length }}</span>
        </div>
        <div class="nge-tut-resume-actions">
            <button class="nge-hud-btn nge-hud-btn--arrow nge-tut-resume-go" @click="continueTutorial">Continue</button>
            <button class="nge-hud-btn nge-hud-btn--quiet nge-tut-resume-exit" @click="exitFromPrompt">Exit tutorial</button>
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
    gap: 22px;
    padding: 12px 14px 12px 20px;
    border-radius: 10px;
    border: 1px solid rgba(74, 150, 224, 0.36);
    background: linear-gradient(180deg, rgba(14, 21, 36, 0.97) 0%, rgba(6, 10, 19, 0.98) 70%);
    backdrop-filter: blur(14px) saturate(1.2);
    box-shadow:
        0 18px 50px rgba(0, 0, 0, 0.55),
        0 0 60px rgba(74, 150, 224, 0.10),
        inset 0 1px 0 rgba(196, 228, 255, 0.10);
    color: rgba(226, 238, 251, 0.88);
    font-family: 'Roboto', 'Inter', sans-serif;
    font-size: 14px;
    animation: nge-tut-resume-in 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* The lit hairline along the top edge, as on a tutorial box. */
.nge-tut-resume::before {
    content: '';
    position: absolute;
    left: 8%;
    right: 8%;
    top: -1px;
    height: 1px;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(196, 228, 255, 0.95) 50%, transparent);
    box-shadow: 0 0 12px rgba(178, 216, 248, 0.6);
}
@keyframes nge-tut-resume-in {
    0%   { opacity: 0; filter: blur(10px) brightness(2.4); }
    60%  { opacity: 1; filter: blur(0) brightness(1.15); }
    100% { opacity: 1; filter: none; }
}
.nge-tut-resume-text { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
.nge-tut-resume strong { color: #fff; font-weight: 600; }
.nge-tut-resume-step {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(126, 224, 255, 0.7);
}
.nge-tut-resume-actions { display: flex; gap: 8px; flex: none; }
@media (prefers-reduced-motion: reduce) { .nge-tut-resume { animation: none; } }

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

