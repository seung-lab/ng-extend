<script setup lang="ts">
import { isNextToElementPostition, useTutorialStore, type Step } from '../store-pyr';
import { useLayersStore } from 'src/store';
import { marked } from 'marked';
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';

const layerStore = useLayersStore();

const { loadState } = layerStore;

const root = ref<HTMLElement | null>(null);

// The intro tutorial's advance buttons teach the Enter shortcut (Ames,
// 2026-09-29). Not in Merge or Cut, where Enter submits the edit.
const tutorialStore = useTutorialStore();
const nextTip = computed(() => tutorialStore.activeTutorial === 1 ? 'Protip: press Enter to advance' : undefined);


const props = defineProps<{
    step: Step,
    first: boolean,
    last: boolean,
    stepIndex: number,
    totalSteps: number,
}>();

const emit = defineEmits<{
    next: [],
    back: [],
    exitIntro: [],
}>();

// Circuit complexity: steps 0-4 grow increasingly complex, step 5+ revert to simple
const circuitLevel = computed(() => Math.min(props.stepIndex, 4));

function circuitPath(level: number): string {
    // Each level adds more branches to the left-side circuit trace
    const paths = [
        // Level 0: simple line with one node
        'M2,10 L2,90 M0,50 L4,50',
        // Level 1: line with two branch nodes
        'M2,8 L2,92 M0,30 L8,30 M0,65 L6,65 L6,72',
        // Level 2: more branches
        'M2,5 L2,95 M0,25 L10,25 L10,18 M0,50 L8,50 M0,75 L12,75 L12,68 L16,68',
        // Level 3: complex branching
        'M2,3 L2,97 M0,20 L10,20 L10,12 L14,12 M0,40 L8,40 L8,34 M0,60 L12,60 M0,80 L10,80 L10,88 L16,88',
        // Level 4: full circuit tree
        'M2,2 L2,98 M0,15 L10,15 L10,8 L16,8 M10,15 L16,22 M0,35 L8,35 L8,28 M0,50 L14,50 L14,42 L18,42 M14,50 L18,56 M0,70 L10,70 M0,85 L12,85 L12,78 L16,78 M12,85 L16,92',
    ];
    return paths[level] || paths[0];
}

interface ComputedStep {
    first: boolean,
    last: boolean,
    title?: string,
    titleIcon?: string,
    text?: string,
    html?: string,
    video?: string,
    image?: string,
    left: string,
    top: string,
    cssClass?: string,
    modal: boolean,
    noborder: boolean,
    videoCache?: HTMLVideoElement,
    nextLabel?: string,
    floatingImage?: string,
}

const inExitConfirm = ref(false);

function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;pointer-events:none';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#ff6b9d', '#c44dff', '#00d4ff', '#ffd700', '#50fa7b', '#ff9500', '#7ecaff', '#ff4757'];
    const particles: { x: number; y: number; vx: number; vy: number; size: number; color: string; rotation: number; rv: number; shape: number; life: number }[] = [];

    for (let i = 0; i < 200; i++) {
        particles.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 200,
            y: canvas.height / 2,
            vx: (Math.random() - 0.5) * 20,
            vy: Math.random() * -18 - 4,
            size: Math.random() * 8 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            rv: (Math.random() - 0.5) * 0.3,
            shape: Math.floor(Math.random() * 3),
            life: 1,
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        for (const p of particles) {
            if (p.life <= 0) continue;
            alive = true;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.4;
            p.vx *= 0.99;
            p.rotation += p.rv;
            p.life -= 0.006;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;

            if (p.shape === 0) {
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            } else if (p.shape === 1) {
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.moveTo(0, -p.size / 2);
                ctx.lineTo(p.size / 2, p.size / 2);
                ctx.lineTo(-p.size / 2, p.size / 2);
                ctx.fill();
            }
            ctx.restore();
        }
        frame++;
        if (alive && frame < 300) {
            requestAnimationFrame(animate);
        } else {
            canvas.remove();
        }
    }
    requestAnimationFrame(animate);
}

const computedStep = ref<ComputedStep>({
    first: props.first,
    last: props.last,
    left: '',
    top: '',
    modal: false,
    text: props.step.text,
    noborder: false,
});

const chipBounds = ref({ top: 'auto', left: 'auto', width: 'inherit' });

async function waitForElement(selector: string, timeout = 3000): Promise<Element | null> {
    const el = document.querySelector(selector);
    if (el) return el;
    return new Promise((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
            const el = document.querySelector(selector);
            if (el || Date.now() - start > timeout) {
                clearInterval(interval);
                resolve(el);
            }
        }, 100);
    });
}

async function updateChipPosition() {
    const step = props.step;

    let left = '';
    let top = '';
    let cssClass = undefined;

    const element = await waitForElement(step.position.element);
    if (element) {
        const rect = element.getBoundingClientRect();

        if (isNextToElementPostition(step.position)) {
            cssClass = step.position.side;

            const { x: xOff, y: yOff } = step.position.offset || { x: 0, y: 0 };

            if (step.position.side === 'right') {
                left = `${rect.right - xOff}px`;
                top = `${rect.top + rect.height / 2 + yOff}px`;
            } else if (step.position.side === 'left') {
                left = `${rect.left + xOff}px`;
                top = `${rect.top + rect.height / 2 + yOff}px`;
            } else if (step.position.side === 'bottom') {
                left = `${rect.left + rect.width / 2 + xOff}px`;
                top = `${rect.bottom + yOff}px`;
            } else if (step.position.side === 'top') {
                left = `${rect.left + rect.width / 2 + xOff}px`;
                top = `${rect.top - yOff}px`;
            }
        } else {
            cssClass = 'center';
            left = `${step.position.x * rect.width + rect.left}px`;
            top = `${step.position.y * rect.height + rect.top}px`;
        }
    } else {
        // The target is gone (a toolbar icon the user removed, or a UI
        // redesign). Centre the box instead of leaving it stuck in the top
        // left corner, and say which selector failed so audits catch it.
        console.warn('[tutorial] step target not found, centring:', step.position.element);
        cssClass = 'center';
        left = `${window.innerWidth / 2}px`;
        top = `${window.innerHeight / 2}px`;
    }

    chipBounds.value = { top: 'auto', left: 'auto', 'width': 'inherit' };

    if (!step.modal) {
        chipBounds.value.width = '350px';
    }

    if (step.width) {
        chipBounds.value.width = step.width;
    }

    let html = step.html;

    if (step.text) {
        html = await marked.parse(step.text);
    }

    computedStep.value = {
        first: props.first,
        last: props.last,
        title: step.title,
        titleIcon: step.titleIcon,
        video: step.video,
        image: step.image,
        html,
        left,
        top,
        cssClass,
        modal: step.modal || false,
        noborder: step.noborder || false,
        nextLabel: step.nextLabel,
        floatingImage: step.floatingImage,
    }

    nextTick(clampChip);
}

/** Keep the chip on screen. Additive, so it can run again after the chip
 *  grows (a practice status box or countdown appended under the text used
 *  to push the title off the top). A chip taller than the window pins to
 *  the top and scrolls. */
function clampChip() {
    const el = root.value?.querySelector('.chip');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cur = (v: string) => (typeof v === 'string' && v.endsWith('px')) ? parseFloat(v) : 0;
    let top = cur(chipBounds.value.top), left = cur(chipBounds.value.left);
    let changed = false;
    if (rect.top < 0) { top += -rect.top + 8; changed = true; }
    else if (rect.bottom > window.innerHeight && rect.top > 8) {
        top += Math.max(window.innerHeight - rect.bottom - 8, 8 - rect.top); changed = true;
    }
    if (rect.left < 0) { left += -rect.left + 8; changed = true; }
    else if (rect.right > window.innerWidth) { left += window.innerWidth - rect.right - 8; changed = true; }
    if (changed) chipBounds.value = { ...chipBounds.value, top: `${top}px`, left: `${left}px` };
}
function onReclamp() { nextTick(clampChip); }

const ready = ref(false);

// Element currently wearing the .nge-tour-target highlight class so we can
// remove it when the step changes or unmounts.
let highlightedEl: Element | null = null;

async function applyHighlight() {
    // Remove any prior highlight
    if (highlightedEl) {
        highlightedEl.classList.remove('nge-tour-target');
        highlightedEl = null;
    }
    if (!props.step.highlight) return;
    const el = await waitForElement(props.step.position.element);
    if (el) {
        el.classList.add('nge-tour-target');
        highlightedEl = el;
    }
}

// A step must never vanish because its setup stalled (Nseraf 2026-09-29: the
// Advanced Interface tutorial "cuts off abruptly after the press A popup").
// Loading a step's saved view can wait forever on an expired middleauth
// login, or on an animation frame in a background tab; a thrown error did the
// same. Each setup stage gets a time limit and a catch, then the box shows
// anyway while the view keeps loading behind it.
const STEP_SETUP_MS = 8000;
function settleWithin(p: Promise<unknown> | unknown, what: string): Promise<void> {
    return Promise.race([
        Promise.resolve(p).then(() => undefined, (e) => { console.warn(`[tutorial] ${what} failed:`, e); }),
        new Promise<void>(r => setTimeout(() => { console.warn(`[tutorial] ${what} still running after ${STEP_SETUP_MS} ms; showing the step`); r(); }, STEP_SETUP_MS)),
    ]);
}

onMounted(async () => {
    const startT = performance.now();
    if (props.step.state) {
        await settleWithin(loadState(props.step.state), 'loading the step view');
    }
    if (props.step.clickAfterState) {
        const el = await waitForElement(props.step.clickAfterState);
        if (el) (el as HTMLElement).click();
    }
    if (props.step.onEnter) {
        await settleWithin(props.step.onEnter(), 'step setup');
    }
    console.log('updating position', performance.now() - startT);
    updateChipPosition();
    applyHighlight();
    ready.value = true;
});

// Intercept ENTER to advance tutorial, SPACE for specific steps
// Skip if user is typing in an input/textarea (e.g. coordinate fields)
// While a viewer tool (Cut, Merge, Find Path) is active, Enter is its
// "submit" key, so the tutorial must leave Enter and Space to the viewer.
// Otherwise "press Enter to submit the cut" just advanced the tutorial.
function viewerToolActive(): boolean {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const viewer = (window as any)['viewer'];
    try {
        if (viewer?.globalToolBinder?.activeTool_ || viewer?.toolBinder?.activeTool_) return true;
    } catch (_) { /* fall through to the DOM check */ }
    return !!document.querySelector('.neuroglancer-tool-status');
}

function onKeyDown(e: KeyboardEvent) {
    const tag = (document.activeElement as HTMLElement)?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;
    if ((e.code === 'Enter' || e.code === 'Space') && viewerToolActive()) return;

    if (e.code === 'Enter' && !isTyping) {
        e.preventDefault();
        e.stopPropagation();
        if (props.last) {
            launchConfetti();
        }
        emit('next');
    }
    if (props.step.spaceAdvances && e.code === 'Space' && !isTyping) {
        e.preventDefault();
        e.stopPropagation();
        emit('next');
    }
}

// A practice step fires this when the learner's edit lands (Amy: "merge
// success!" deserves a celebration).
function onCelebrate() { launchConfetti(); }

// Drag the box out of the way (Amy: the cut box hid the 3D view). The
// handle is the title bar; the offset is added to the computed position and
// resets with the next step, since each step is a fresh component.
const dragOffset = ref({ x: 0, y: 0 });
// Drag from ANYWHERE on the box (Amy 2026-09-28: "click anywhere in the box
// to drag, not just at the top"). Controls keep working: presses on buttons,
// links, fields, videos or anything marked data-no-drag never start a drag,
// and a drag only begins after a 4px move, so a plain click on text or a
// clickable span inside the step's html still acts as a click.
const NO_DRAG = 'button, a, input, textarea, select, option, label, video, [contenteditable], [data-no-drag], .nge-no-drag';
const dragging = ref(false);
let dragStart: { x: number; y: number; ox: number; oy: number } | null = null;
function onDragStart(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest(NO_DRAG)) return;
    dragStart = { x: e.clientX, y: e.clientY, ox: dragOffset.value.x, oy: dragOffset.value.y };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
}
function onDragMove(e: PointerEvent) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (!dragging.value) {
        if (Math.hypot(dx, dy) < 4) return;
        dragging.value = true;
        window.getSelection()?.removeAllRanges();
    }
    e.preventDefault();
    dragOffset.value = { x: dragStart.ox + dx, y: dragStart.oy + dy };
}
function onDragEnd() {
    dragStart = null;
    dragging.value = false;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
}
onUnmounted(onDragEnd);

// The first clamp runs before the step's image or video has loaded, so the
// chip then grew past the top of the window ("Merge success!" and "Place the
// points" sat 100px off screen on a 13 inch laptop). Re-clamp on every resize
// of the chip, and when the window itself resizes.
let chipObserver: ResizeObserver | null = null;
let observedChip: Element | null = null;
function observeChip() {
    const el = root.value?.querySelector('.chip:not(.exitConfirm)') ?? null;
    if (el === observedChip) return;
    chipObserver?.disconnect();
    observedChip = el;
    if (el) {
        chipObserver ??= new ResizeObserver(() => { if (!dragging.value) clampChip(); });
        chipObserver.observe(el);
    }
}
watch(ready, (r) => { if (r) nextTick(observeChip); });
watch(() => computedStep.value, () => nextTick(observeChip));

onMounted(() => {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReclamp);
    document.addEventListener('nge:tutorial-celebrate', onCelebrate);
    document.addEventListener('nge:tutorial-reclamp', onReclamp);
});
onUnmounted(() => {
    chipObserver?.disconnect();
    window.removeEventListener('resize', onReclamp);
    document.removeEventListener('nge:tutorial-celebrate', onCelebrate);
    document.removeEventListener('nge:tutorial-reclamp', onReclamp);
});

onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    // Clean up any injected tutorial highlight styles
    document.getElementById('nge-tutorial-highlight')?.remove();
    if (highlightedEl) {
        highlightedEl.classList.remove('nge-tour-target');
        highlightedEl = null;
    }
});

</script>

<template>
    <div v-if="ready" ref="root" class="introductionStep" :class="{ hasVideo: computedStep.video !== undefined }">
        <div v-if="computedStep.modal" class="nge-overlay-blocker" @mousedown.stop.prevent></div>
        <!-- Hidden until it has a position: while the step's target was
             still being looked up, an empty box sat in the top left corner
             (Ames, site tour box 4, 2026-10-02). -->
        <div class="ng-extend introductionStepAnchor chipBuildIn"
            :class="[computedStep.cssClass, { 'nge-no-arrow': !!step.highlight, 'nge-quick-anim': !computedStep.modal }]"
            :style="{ left: computedStep.left, top: computedStep.top, visibility: computedStep.left ? undefined : 'hidden', transform: dragOffset.x || dragOffset.y ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined }">
            <div class="arrow"></div>

            <div v-if="!inExitConfirm" class="chip"
                :class="{ modal: computedStep.modal, noborder: computedStep.noborder, 'nge-chip--dragging': dragging }" :style="chipBounds"
                @pointerdown="onDragStart">
                <span class="corner corner-tl"></span>
                <span class="corner corner-tr"></span>
                <span class="corner corner-bl"></span>
                <span class="corner corner-br"></span>
                <span class="nge-chip-scan" aria-hidden="true"></span>
                <div class="nge-chip-drag" title="Drag anywhere on this box to move it">
                    <span class="nge-chip-grip" aria-hidden="true">⠿</span>
                    <span class="nge-chip-readout">{{ String(stepIndex + 1).padStart(2, '0') }} / {{ String(totalSteps).padStart(2, '0') }}</span>
                </div>
                <button class="exit" @click="inExitConfirm = true">×</button>
                <div class="title" v-if="computedStep.title">
                  <span v-if="computedStep.titleIcon" class="title-icon" v-html="computedStep.titleIcon"></span>
                  <span v-for="(char, i) in [...computedStep.title]" :key="i"
                    class="title-letter"
                    :style="{ animationDelay: (computedStep.modal ? i * 0.06 : Math.min(i * 0.015, 0.18)) + 's' }"
                  >{{ char === ' ' ? '\u00A0' : char }}</span>
                </div>
                <video v-if="computedStep.video" width="350" height="242.81" autoplay loop muted playsinline
                    :src="computedStep.video"></video>
                <img class="image" v-if="computedStep.image" :src="computedStep.image">
                <div class="html" v-if="computedStep.html" v-html="computedStep.html"></div>
                <div class="nge-chip-foot">
                    <div class="buttonContainer">
                        <button v-if="!computedStep.first" @click="$emit('back')" class="back">back</button>
                        <span class="stepCounter">{{ stepIndex + 1 }}/{{ totalSteps }}</span>
                        <button v-if="computedStep.last" @click="launchConfetti(); $emit('next')" class="next" :title="nextTip">done</button>
                        <button v-else @click="$emit('next')" class="next" :title="nextTip">{{ computedStep.nextLabel || 'next' }}</button>
                    </div>
                    <div class="progressBarContainer nge-chip-rail" :aria-label="`Step ${stepIndex + 1} of ${totalSteps}`">
                        <i v-for="n in totalSteps" :key="n" :class="{ on: n <= stepIndex + 1, now: n === stepIndex + 1 }"></i>
                    </div>
                </div>
            </div>

            <div v-if="inExitConfirm" class="chip exitConfirm" :class="{ modal: computedStep.modal }"
                :style="chipBounds">
                <div class="nge-exit-ask">Exit the tutorial?</div>
                <div class="nge-exit-sub">You can start it again any time.</div>
                <div class="buttonContainer">
                    <button @click="inExitConfirm = false" class="nge-hud-btn nge-hud-btn--quiet">Keep going</button>
                    <button @click="$emit('exitIntro')" class="nge-hud-btn">Exit</button>
                </div>
            </div>
        </div>
        <div v-if="computedStep.floatingImage" class="floatingImageRise">
            <img class="floatingImageSway" :src="computedStep.floatingImage">
        </div>
    </div>
</template>

<style scoped>
.nge-chip-drag {
    position: absolute;
    top: 6px;
    left: 14px;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(126, 202, 255, 0.55);
    cursor: grab;
    user-select: none;
    line-height: 1;
    padding: 4px 6px;
    z-index: 3;
    touch-action: none;
}
.nge-chip-drag:hover { color: #7ecaff; }
/* The whole box is the drag handle; controls inside keep their own cursor. */
.chip { cursor: grab; }
.chip :is(button, a, input, textarea, select, label, video) { cursor: pointer; }
.chip :is(input, textarea) { cursor: text; }
.chip.nge-chip--dragging, .chip.nge-chip--dragging * { cursor: grabbing !important; user-select: none; }

.nge-overlay-blocker {
    z-index: 89;
}

.introductionStepAnchor {
    position: absolute;
    z-index: 90;
    /* filter: drop-shadow(0 8px 4px rgba(0, 0, 0, 0.25)); overwrites backdrop-filter*/
}

.introductionStepAnchor.right>* {
    transform: translate(0, -50%);
}

.introductionStepAnchor.left>* {
    transform: translate(-100%, -50%);
}

.introductionStepAnchor.top>*,
.introductionStepAnchor.bottom>* {
    transform: translate(-50%, 0);
}

.introductionStepAnchor.center>* {
    transform: translate(-50%, -50%);
}

.introductionStepAnchor .arrow {
    position: absolute;
    border: 14px solid transparent;
    filter: drop-shadow(0 0 10px rgba(80, 160, 255, 0.6));
    z-index: 3;
}

.introductionStepAnchor.right .arrow {
    border-right: 14px solid rgba(120, 180, 255, 0.6);
    right: -14px;
}

.introductionStepAnchor.right .chip {
    left: 14px !important;
}

.introductionStepAnchor.bottom .arrow {
    border-bottom: 14px solid rgba(120, 180, 255, 0.6);
    bottom: -14px;
}

.introductionStepAnchor.bottom .chip {
    top: 14px !important;
}

.introductionStepAnchor.left .arrow {
    border-left: 14px solid rgba(120, 180, 255, 0.6);
    right: -14px;
    top: 50%;
    transform: translateY(-50%);
}

.introductionStepAnchor.left .chip {
    right: 14px !important;
    left: auto !important;
}

.introductionStepAnchor.top .arrow {
    border-top: 14px solid rgba(120, 180, 255, 0.6);
    top: -14px;
}

.chip {
    position: absolute;
    width: auto;
    max-width: min(80vw, calc(100vw - 24px));
    /* Tall steps scroll instead of cropping on short laptop screens, but
       without a visible scrollbar (Amy): the wheel still works. */
    max-height: calc(100vh - 90px);
    overflow-y: auto;
    scrollbar-width: none;
    color: #d0e8ff;
    padding: 30px;
    padding-bottom: 20px;
    border-radius: 8px;
    display: grid;
    justify-items: center;
    font-size: 18px;
    font-weight: 300;
    grid-row-gap: 15px;

    border: 1px solid rgba(160, 200, 240, 0.22);
    /* Higher base opacity so the chip reads cleanly even when it floats
       over a busy panel (segment list, tab bar, etc.). */
    background: linear-gradient(135deg, rgba(8, 12, 26, 0.95), rgba(14, 10, 36, 0.93));
    backdrop-filter: blur(20px) saturate(1.1);
    box-shadow: 0 0 20px rgba(80, 140, 255, 0.1), 0 8px 32px rgba(0, 0, 0, 0.45);
}

/* Microchip-inspired corner traces */
.corner {
    position: absolute;
    pointer-events: none;
    z-index: 2;
}

/* L-shaped corner bracket */
.corner-tl {
    top: -1px;
    left: -1px;
    width: 20px;
    height: 20px;
    border-top: 1.5px solid rgba(160, 200, 240, 0.55);
    border-left: 1.5px solid rgba(160, 200, 240, 0.55);
}

/* Short trace extending from top-left corner */
.corner-tl::before {
    content: '';
    position: absolute;
    top: -1.5px;
    left: 20px;
    width: 8px;
    height: 0;
    border-top: 1.5px solid rgba(160, 200, 240, 0.3);
}

.corner-tl::after {
    content: '';
    position: absolute;
    top: 20px;
    left: -1.5px;
    width: 0;
    height: 8px;
    border-left: 1.5px solid rgba(160, 200, 240, 0.3);
}

.corner-tr {
    top: -1px;
    right: -1px;
    width: 20px;
    height: 20px;
    border-top: 1.5px solid rgba(160, 200, 240, 0.55);
    border-right: 1.5px solid rgba(160, 200, 240, 0.55);
}

.corner-tr::before {
    content: '';
    position: absolute;
    top: -1.5px;
    right: 20px;
    width: 8px;
    height: 0;
    border-top: 1.5px solid rgba(160, 200, 240, 0.3);
}

.corner-bl {
    bottom: -1px;
    left: -1px;
    width: 20px;
    height: 20px;
    border-bottom: 1.5px solid rgba(160, 200, 240, 0.55);
    border-left: 1.5px solid rgba(160, 200, 240, 0.55);
}

.corner-bl::before {
    content: '';
    position: absolute;
    bottom: -1.5px;
    left: 20px;
    width: 8px;
    height: 0;
    border-bottom: 1.5px solid rgba(160, 200, 240, 0.3);
}

.corner-br {
    bottom: -1px;
    right: -1px;
    width: 20px;
    height: 20px;
    border-bottom: 1.5px solid rgba(160, 200, 240, 0.55);
    border-right: 1.5px solid rgba(160, 200, 240, 0.55);
}

.corner-br::before {
    content: '';
    position: absolute;
    bottom: -1.5px;
    right: 20px;
    width: 8px;
    height: 0;
    border-bottom: 1.5px solid rgba(160, 200, 240, 0.3);
}

@keyframes chipBuildIn {
    0% {
        opacity: 0;
        transform: translate(var(--tx, -50%), var(--ty, -50%)) scale(0.92);
    }
    100% {
        opacity: 1;
        transform: translate(var(--tx, -50%), var(--ty, -50%)) scale(1);
    }
}

.chipBuildIn {
    animation: chipFadeIn 0.3s ease-out both;
}

@keyframes chipFadeIn {
    0% {
        opacity: 0;
        filter: blur(4px);
    }
    100% {
        opacity: 1;
        filter: blur(0px);
    }
}

.hasVideo .chip:not(.exitConfirm) {
    padding: 8px 8px 20px 8px;
}

/* Modal steps (the site tour's welcome and finale) used to drop the box's
   padding for a full-bleed video that is long gone. Without it the title
   sat on the drag handle and Back, the counter and the progress bar ran to
   the edges (Ames, 2026-10-05). They keep the normal padding now, and
   scroll like any other box on a short screen. */
.chip.modal {
    padding-top: 34px;
}

.chip .title {
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 2px;
}

@keyframes letterReveal {
    0% { opacity: 0; transform: translateY(8px) scale(0.8); }
    60% { opacity: 1; transform: translateY(-2px) scale(1.05); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
}

.title-letter {
    display: inline-block;
    opacity: 0;
    animation: letterReveal 0.4s ease-out forwards;
}

/* Toolbar icon shown alongside the title (e.g. the same Find Path icon
   that lives in the top toolbar). Sized to match the title font and
   pulled into rhythm with the letter-by-letter reveal. */
.title-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 8px;
    opacity: 0;
    animation: letterReveal 0.4s ease-out 0s forwards;
}
.title-icon :deep(svg) {
    width: 26px;
    height: 26px;
    vertical-align: middle;
}

.chip video,
.chip .image {
    width: 100%;
    /* On a 13 inch laptop the 480px step pictures pushed the text and the
       Next button below the fold of the (scrollbar-less) chip. The picture
       gives up height first so the words and controls always fit. */
    max-height: max(120px, calc(100vh - 450px));
    object-fit: contain;
}
/* Pictures written into a step's html (the before/after pair) shrink too. */
.chip .html img {
    max-height: max(100px, calc(100vh - 500px));
    object-fit: contain;
}
/* Back / Next always stay in view. A step with a long list can still be
   taller than a laptop window, and the chip scrolls without a scrollbar, so
   the controls ride on the bottom edge and the words scroll up under them. */
.ng-extend .chip .nge-chip-foot {
    position: sticky;
    bottom: -20px;
    z-index: 2;
    width: 100%;
    margin: 0 0 -20px;
    padding: 6px 0 20px;
    background: rgb(7, 11, 23);
}
/* A short fade above the bar so words scrolling under it dissolve. */
.ng-extend .chip .nge-chip-foot::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 22px;
    background: linear-gradient(to bottom, rgba(7, 11, 23, 0), rgb(7, 11, 23));
    pointer-events: none;
}

.ng-extend .chip .buttonContainer {
    display: grid;
    position: relative;
    width: 100%;
    align-items: center;
}

.ng-extend .chip.exitConfirm .buttonContainer {
    width: auto;
    grid-auto-flow: column;
    grid-column-gap: 10px;
}

.ng-extend .chip .buttonContainer button {
    text-transform: uppercase;
}

.ng-extend .chip button.next {
    justify-self: center;
    border-radius: 999px;
    border: 1px solid var(--color-small-text);
    padding: 2px 16px;
}

.ng-extend .chip button.back {
    position: absolute;
    text-transform: uppercase;
    font-style: italic;
    font-size: 14px;
    opacity: 0.5;
}

.ng-extend .chip button.back:hover {
    background: none;
    opacity: 1;
}

.ng-extend .chip .progressBarContainer {
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    /* Room between the buttons and the bar (Ames: "a tad higher"). */
    margin-top: 16px;
    overflow: hidden;
}

.ng-extend .chip .progressBar {
    height: 100%;
    background: linear-gradient(90deg, #00c8ff, #80ffcc);
    border-radius: 2px;
    transition: width 0.5s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.ng-extend .chip .stepCounter {
    position: absolute;
    right: 0;
    bottom: 2px;
    font-size: 12px;
    opacity: 0.4;
    font-family: 'Inter', 'Roboto', monospace;
    letter-spacing: 0.5px;
}

.ng-extend .chip button.exit {
    position: absolute;
    right: 0;
    border: none;
    padding: 0;
    opacity: 0.75;
    transition: opacity 0.2s;
    font-size: 22px;
    line-height: 22px;
    font-weight: 300;
    width: 22px;
    margin: 6px 6px 0 0;
    z-index: 1;
}

.ng-extend .chip button.exit:hover {
    background-color: initial;
    opacity: 1;
}

.ng-extend .chip button:hover {
    background-color: rgba(255, 255, 255, 0.25);
}

.chip :deep(a) {
    color: #7ecaff;
}

.chip :deep(a:hover) {
    color: #b0dfff;
}

/* Balloon: outer div rises smoothly, inner img sways side-to-side */
@keyframes floatUp {
    0% {
        transform: translateY(0);
        opacity: 1;
    }
    85% {
        opacity: 1;
    }
    100% {
        transform: translateY(-120vh);
        opacity: 0;
    }
}

@keyframes floatSway {
    0%   { transform: translateX(0)    rotate(0deg); }
    25%  { transform: translateX(18px) rotate(1.5deg); }
    50%  { transform: translateX(0)    rotate(0deg); }
    75%  { transform: translateX(-18px) rotate(-1.5deg); }
    100% { transform: translateX(0)    rotate(0deg); }
}

.floatingImageRise {
    position: fixed;
    bottom: -350px;
    left: 50%;
    margin-left: -150px;
    width: 300px;
    z-index: 91;
    pointer-events: none;
    animation: floatUp 8s linear forwards;
}

.floatingImageSway {
    width: 100%;
    animation: floatSway 3s ease-in-out infinite;
}

/* ── Site Tour: highlight ring + no-arrow + quick build-in ─────────── */

/* Hide the chip's pointer arrow when the step uses an element highlight */
.introductionStepAnchor.nge-no-arrow .arrow {
    display: none;
}

/* Faster entrance for non-modal element-pointer cards: skip the
   long letter-by-letter stagger and just fade in. */
.introductionStepAnchor.nge-quick-anim {
    animation: chipFadeIn 0.18s ease-out both;
}

/* ══ Instrument restyle (Ames 2026-10-05: "sleek, like something made 100
   years in the future") ══════════════════════════════════════════════════
   Built from the scifi-ui set rather than invented: the holopanel surface
   (dark gradient, lit top hairline, inset rim, materialise entrance), one
   scan pass on arrival that never loops, a mono step readout, and a
   segmented rail that reports the real step. These rules sit last so they
   win over the older ones above at equal weight. */
.chip {
    color: rgba(226, 238, 251, 0.88);
    padding: 46px 28px 20px;
    border-radius: 12px;
    justify-items: stretch;
    font-size: 15px;
    line-height: 1.55;
    font-weight: 400;
    grid-row-gap: 14px;
    border: 1px solid rgba(74, 150, 224, 0.36);
    /* Flat from 70% down, so the sticky footer (same colour) has no seam. */
    background: linear-gradient(180deg, rgba(14, 21, 36, 0.97) 0%, rgba(6, 10, 19, 0.98) 70%);
    backdrop-filter: blur(14px) saturate(1.2);
    box-shadow:
        0 18px 50px rgba(0, 0, 0, 0.55),
        0 0 60px rgba(74, 150, 224, 0.10),
        inset 0 1px 0 rgba(196, 228, 255, 0.10);
}
/* The lit hairline along the top edge. */
.chip::before {
    content: '';
    position: absolute;
    left: 8%;
    right: 8%;
    top: 0;
    height: 1px;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(196, 228, 255, 0.95) 50%, transparent);
    box-shadow: 0 0 12px rgba(178, 216, 248, 0.6);
    z-index: 3;
}
.corner { border-color: rgba(126, 224, 255, 0.7) !important; }
.corner::before, .corner::after { border-color: rgba(126, 224, 255, 0.28) !important; }

/* Entrance: the panel materialises out of an overbright blur. Opacity and
   filter only, because the anchor's transform belongs to dragging. */
.chipBuildIn,
.introductionStepAnchor.nge-quick-anim {
    animation: nge-chip-in 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes nge-chip-in {
    0%   { opacity: 0; filter: blur(10px) brightness(2.4); }
    60%  { opacity: 1; filter: blur(0) brightness(1.15); }
    100% { opacity: 1; filter: none; }
}
/* One scan line on arrival. It passes once: a band that loops is a status
   light. Moves by `top`, not transform, so it adds no scroll height. */
.nge-chip-scan {
    position: absolute;
    left: 0;
    right: 0;
    top: -9%;
    height: 9%;
    z-index: 2;
    pointer-events: none;
    opacity: 0;
    background: linear-gradient(180deg, transparent, rgba(126, 224, 255, 0.14), transparent);
    animation: nge-chip-scan 1500ms cubic-bezier(0.22, 0.9, 0.28, 1) 260ms 1 both;
}
@keyframes nge-chip-scan {
    0%   { top: -9%; opacity: 0; }
    12%  { opacity: 1; }
    88%  { opacity: 1; }
    100% { top: 91%; opacity: 0; }
}

/* Header strip: grip and a mono step readout. */
.nge-chip-drag {
    top: 15px;
    left: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    letter-spacing: 0.2em;
    color: rgba(126, 224, 255, 0.62);
}
.nge-chip-grip { font-size: 11px; letter-spacing: 0; opacity: 0.7; }
.nge-chip-readout {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
}
.ng-extend .chip .stepCounter { display: none; }
.ng-extend .chip button.exit {
    top: 8px;
    right: 8px;
    margin: 0;
    width: 26px;
    height: 26px;
    line-height: 24px;
    font-size: 20px;
    border-radius: 4px;
    color: rgba(226, 238, 251, 0.7);
    opacity: 1;
    transition: background 0.2s, color 0.2s;
}
.ng-extend .chip button.exit:hover { background: rgba(196, 228, 255, 0.14); color: #fff; }

/* Title: a HUD label with a diamond marker and a hairline that fades out. */
.chip .title {
    justify-content: flex-start;
    gap: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    line-height: 1.3;
    color: #eef8ff;
    text-shadow: 0 0 14px rgba(126, 224, 255, 0.35);
    padding-bottom: 12px;
    border-bottom: 1px solid transparent;
    border-image: linear-gradient(90deg, rgba(126, 224, 255, 0.7), rgba(126, 224, 255, 0.10) 62%, transparent) 1;
}
.chip .title::before {
    content: '';
    flex: none;
    width: 6px;
    height: 6px;
    margin-right: 12px;
    transform: rotate(45deg);
    background: #7ee0ff;
    box-shadow: 0 0 8px rgba(126, 224, 255, 0.9);
}
.title-icon { margin-right: 10px; }
/* Wide hero boxes and video boxes keep the title clear of the header strip. */
.chip.modal { padding-top: 46px; }
.hasVideo .chip:not(.exitConfirm) .title { margin: 38px 20px 0; }

.chip .html :deep(p) { margin: 0 0 0.7em; }
.chip .html :deep(p:last-child) { margin-bottom: 0; }
.chip .html :deep(strong) { color: #ffffff; font-weight: 600; }

/* Footer: Back on the left, the action on the right, segmented rail below. */
.ng-extend .chip .nge-chip-foot { background: rgb(6, 10, 19); padding-top: 8px; }
.ng-extend .chip .nge-chip-foot::before { background: linear-gradient(to bottom, rgba(6, 10, 19, 0), rgb(6, 10, 19)); }
.ng-extend .chip .buttonContainer {
    display: flex;
    align-items: center;
    min-height: 32px;
}
.ng-extend .chip.exitConfirm .buttonContainer { gap: 10px; justify-content: center; }
.ng-extend .chip button.next {
    margin-left: auto;
    border-radius: 3px;
    border: 1px solid rgba(126, 224, 255, 0.55);
    padding: 7px 16px 7px 18px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.2em;
    line-height: 1.2;
    color: #eaf9ff;
    background: linear-gradient(180deg, rgba(126, 224, 255, 0.17), rgba(126, 224, 255, 0.05));
    box-shadow: inset 0 0 12px rgba(126, 224, 255, 0.10);
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
}
.ng-extend .chip button.next::after {
    content: '\203A';
    display: inline-block;
    margin-left: 10px;
    font-size: 15px;
    line-height: 0.8;
    letter-spacing: 0;
    transition: transform 0.2s ease-out;
}
.ng-extend .chip button.next:hover {
    background: linear-gradient(180deg, rgba(126, 224, 255, 0.30), rgba(126, 224, 255, 0.12));
    border-color: rgba(190, 240, 255, 0.95);
    box-shadow: inset 0 0 12px rgba(126, 224, 255, 0.18), 0 0 18px rgba(126, 224, 255, 0.35);
}
.ng-extend .chip button.next:hover::after { transform: translateX(3px); }
.chip.exitConfirm { padding: 26px 28px 22px; grid-row-gap: 6px; min-width: 280px; }
.nge-exit-ask {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #eef8ff;
    text-shadow: 0 0 14px rgba(126, 224, 255, 0.35);
}
.nge-exit-sub { font-size: 13px; color: rgba(196, 228, 255, 0.75); }
.ng-extend .chip.exitConfirm .buttonContainer { margin-top: 12px; justify-content: flex-end; }
.ng-extend .chip button.back {
    position: static;
    font-style: normal;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2em;
    padding: 7px 0;
    color: rgba(196, 228, 255, 0.85);
    opacity: 0.6;
    transition: opacity 0.2s;
}
.ng-extend .chip button.back::before { content: '\2039'; margin-right: 8px; font-size: 15px; line-height: 0.8; letter-spacing: 0; }
.ng-extend .chip button.back:hover { background: none; opacity: 1; }
.ng-extend .chip .nge-chip-rail {
    display: flex;
    gap: 3px;
    height: 3px;
    margin-top: 14px;
    background: none;
    border-radius: 0;
    overflow: visible;
}
.nge-chip-rail i {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 1px;
    background: rgba(196, 228, 255, 0.12);
    transition: background 0.4s, box-shadow 0.4s;
}
.nge-chip-rail i.on { background: rgba(126, 224, 255, 0.7); }
.nge-chip-rail i.now { background: #c4f3ff; box-shadow: 0 0 8px rgba(126, 224, 255, 0.95); }

@media (prefers-reduced-motion: reduce) {
    .chipBuildIn, .introductionStepAnchor.nge-quick-anim { animation: none; }
    .nge-chip-scan { animation: none; }
}
</style>

<style>
/* UNSCOPED: target elements outside this component (toolbar buttons,
   side panels, etc.) get a pulsing cyan ring while they're the focus
   of the active tour step. */
.nge-tour-target {
    position: relative;
    z-index: 88;
    outline: 2px solid rgba(0, 200, 255, 0.85) !important;
    outline-offset: 3px;
    border-radius: 6px;
    animation: nge-tour-pulse 1.6s ease-in-out infinite;
    transition: outline-color 0.2s;
}
@keyframes nge-tour-pulse {
    0%, 100% {
        box-shadow:
            0 0 0 0 rgba(0, 200, 255, 0.45),
            0 0 18px 2px rgba(0, 180, 255, 0.55);
    }
    50% {
        box-shadow:
            0 0 0 6px rgba(0, 200, 255, 0),
            0 0 26px 4px rgba(0, 220, 255, 0.75);
    }
}

/* Welcome step: hero render on top, copy below. The .chip's grid-row-gap
   keeps the spacing between the hero and the buttons consistent with
   every other step. */
.nge-tour-welcome {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px 6px 0;
}
.nge-tour-welcome-hero {
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(120, 180, 240, 0.18);
    background: rgba(0, 0, 0, 0.35);
    line-height: 0;
}
.chip::-webkit-scrollbar {
    display: none;
}
.nge-tour-welcome-hero img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 280px;
    object-fit: cover;
    object-position: center;
}
/* A square card shown whole (the Retina tour's welcome): it shrinks on a
   short window instead of being cropped to a band. */
.chip .html .nge-tour-welcome-hero--whole img {
    object-fit: contain;
    max-height: max(180px, min(436px, calc(100vh - 430px)));
    background: #03040a;
}
/* Dataset tour cell cards: a picture on top, "show all" buttons below. */
.chip .html .nge-tour-cell-img { margin: 0 0 10px; line-height: 0; text-align: center; }
.chip .html .nge-tour-cell-img img { max-width: 100%; max-height: 190px; width: auto; height: auto; }
.chip .html .nge-tour-cell-text p { margin: 0 0 10px; }
.chip .html .nge-tour-more { margin-top: 8px; }
.chip .html .nge-tour-more-btn {
    width: 100%;
    background: rgba(74, 158, 255, 0.1);
    border: 1px solid rgba(74, 158, 255, 0.4);
    border-radius: 6px;
    color: #d6e8ff;
    font: inherit;
    font-size: 0.9em;
    padding: 7px 10px;
    cursor: pointer;
    text-align: left;
}
.chip .html .nge-tour-more-btn:hover { background: rgba(74, 158, 255, 0.2); }
.chip .html .nge-tour-more-btn[data-shown="1"] { background: rgba(74, 158, 255, 0.28); }
.chip .html .nge-tour-more-note { font-size: 0.8em; color: rgba(190, 205, 225, 0.65); margin-top: 3px; }
.nge-tour-welcome-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 4px;
    line-height: 1.5;
    font-size: 15px;
    color: #dfeeff;
}
/* Weighted to beat the box's own paragraph spacing: the gap above does it. */
.chip .html .nge-tour-welcome-body p { margin: 0; }

/* Final step (Option B): hero render + gratitude. The boxes-of-CTAs
   layout was busy and the toolbar already covers Cell Library / ⌘K /
   Leaderboard one click away — let the gratitude be the payoff. */
.nge-tour-finale {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 6px 0;
    text-align: center;
}
.nge-tour-finale-hero {
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(120, 180, 240, 0.18);
    background: rgba(0, 0, 0, 0.4);
    line-height: 0;
}
.nge-tour-finale-hero img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 260px;
    object-fit: cover;
    object-position: center;
}
.nge-tour-finale-lead {
    margin: 8px 12px 0;
    font-size: 16px;
    line-height: 1.45;
    color: #e6f0ff;
    font-weight: 500;
}
.nge-tour-finale-sub {
    margin: 0 12px;
    font-size: 14px;
    line-height: 1.5;
    color: rgba(220, 232, 250, 0.85);
}
.nge-tour-finale-contact {
    margin: 6px 12px 0;
    font-size: 13px;
    color: rgba(190, 215, 240, 0.75);
}
.nge-tour-finale-contact a {
    color: #9fdcff;
    text-decoration: none;
    border-bottom: 1px solid rgba(159, 220, 255, 0.4);
}
.nge-tour-finale-tag {
    margin: 12px 12px 4px;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #9fdcff;
    text-shadow: 0 0 16px rgba(120, 200, 255, 0.5);
}

/* Final-step "ready to explore" grid of next-step cards */
.nge-tour-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    max-width: 460px;
    margin: 0 auto;
}
.nge-tour-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 14px 12px;
    border: 1px solid rgba(120, 180, 240, 0.22);
    border-radius: 6px;
    background: linear-gradient(135deg, rgba(20, 35, 60, 0.55), rgba(30, 20, 60, 0.45));
    text-align: center;
    transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.nge-tour-card:hover {
    border-color: rgba(120, 200, 255, 0.55);
    transform: translateY(-1px);
    box-shadow: 0 4px 18px rgba(80, 160, 255, 0.18);
}
.nge-tour-card-icon {
    font-size: 22px;
    margin-bottom: 4px;
    line-height: 1;
}
.nge-tour-card-title {
    font-size: 13.5px;
    font-weight: 600;
    color: #d6ebff;
    letter-spacing: 0.3px;
}
.nge-tour-card-sub {
    font-size: 11.5px;
    color: rgba(190, 215, 240, 0.65);
    margin-top: 2px;
}
</style>
