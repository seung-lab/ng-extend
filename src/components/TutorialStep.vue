<script setup lang="ts">
import { isNextToElementPostition, type Step } from '#src/store-pyr.js';
import { useLayersStore } from '#src/store.js';
import { marked } from 'marked';
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';

const layerStore = useLayersStore();

const { loadState } = layerStore;

const root = useTemplateRef<HTMLElement>("root");


const props = defineProps<{
    step: Step,
    first: boolean,
    last: boolean,
    stepIndex: number,
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

    nextTick(function () {
        const el = root.value!.querySelector('.chip');
        if (el) {
            const rect = el.getBoundingClientRect();

            function clamp(val: number, min: number, max: number) {
                return Math.max(min, Math.min(max, val));
            }

            function clampWidth(val: number) {
                const buffer = rect.width / 2 - (12 + 10); // half triangle width + border radius
                return clamp(val, -buffer, buffer);
            }

            function clampHeight(val: number) {
                const buffer = rect.height / 2 - (12 + 10); // half triangle width + border radius
                return clamp(val, -buffer, buffer);
            }

            if (rect.top < 0) {
                chipBounds.value.top = `${-rect.top + 8}px`;
            }
            if (rect.left < 0) {
                chipBounds.value.left = `${-rect.left + 8}px`;
            }
            if (rect.right > window.innerWidth) {
                chipBounds.value.left = `${window.innerWidth - rect.right - 8}px`;
            }
            if (rect.bottom > window.innerHeight) {
                chipBounds.value.top = `${window.innerHeight - rect.bottom - 8}px`;
            }
        }
    });
}

const ready = ref(false);

onMounted(async () => {
    const startT = performance.now();
    console.log("test propo", props.step.state);
    if (props.step.state) {
        console.log('loading state');
        await loadState(props.step.state);
    }
    if (props.step.clickAfterState) {
        const el = await waitForElement(props.step.clickAfterState);
        if (el) (el as HTMLElement).click();
    }
    if (props.step.onEnter) {
        await props.step.onEnter();
    }
    console.log('updating position', performance.now() - startT);
    updateChipPosition();
    ready.value = true;
});

// Intercept ENTER to advance tutorial, SPACE for specific steps
function onKeyDown(e: KeyboardEvent) {
    if (e.code === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (props.last) {
            launchConfetti();
        }
        emit('next');
    }
    if (props.step.spaceAdvances && e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        emit('next');
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKeyDown, true);
});

onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown, true);
});

</script>

<template>
    <div v-if="ready" ref="root" class="introductionStep" :class="{ hasVideo: computedStep.video !== undefined }">
        <div v-if="computedStep.modal" class="nge-overlay-blocker" @mousedown.stop.prevent></div>
        <div class="ng-extend introductionStepAnchor chipBuildIn" :class="computedStep.cssClass"
            :style="{ left: computedStep.left, top: computedStep.top }">
            <div class="arrow"></div>

            <div v-if="!inExitConfirm" class="chip"
                :class="{ modal: computedStep.modal, noborder: computedStep.noborder }" :style="chipBounds">
                <span class="corner corner-tl"></span>
                <span class="corner corner-tr"></span>
                <span class="corner corner-bl"></span>
                <span class="corner corner-br"></span>
                <button class="exit" @click="inExitConfirm = true">×</button>
                <div class="title" v-if="computedStep.title">{{ computedStep.title }}</div>
                <video v-if="computedStep.video" width="350" height="242.81" autoplay loop muted playsinline
                    :src="computedStep.video"></video>
                <img class="image" v-if="computedStep.image" :src="computedStep.image">
                <div class="html" v-if="computedStep.html" v-html="computedStep.html"></div>
                <div class="buttonContainer">
                    <button v-if="!computedStep.first" @click="$emit('back')" class="back">back</button>
                    <button v-if="computedStep.last" @click="launchConfetti(); $emit('next')" class="next">done</button>
                    <button v-else @click="$emit('next')" class="next">{{ computedStep.nextLabel || 'next' }}</button>
                </div>
            </div>

            <div v-if="inExitConfirm" class="chip exitConfirm" :class="{ modal: computedStep.modal }"
                :style="chipBounds">
                <div>Do you want to exit the tutorial?</div>
                <div class="buttonContainer">
                    <button @click="inExitConfirm = false" class="next">No</button>
                    <button @click="$emit('exitIntro')" class="next">Yes</button>
                </div>
            </div>
        </div>
        <img v-if="computedStep.floatingImage" class="floatingImage" :src="computedStep.floatingImage">
    </div>
</template>

<style scoped>
.nge-overlay-blocker {
    z-index: 89;
}

.introductionStepAnchor {
    position: absolute;
    z-index: 90;
    /* filter: drop-shadow(0 8px 4px rgba(0, 0, 0, 0.25)); overwrites backdrop-filter*/
}

.introductionStepAnchor.left>*,
.introductionStepAnchor.right>* {
    transform: translate(0, -50%);
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
    border: 12px solid transparent;
    filter: drop-shadow(0 0px 8px rgba(0, 0, 0, 1));
}

.introductionStepAnchor.right .arrow {
    border-right: 12px solid var(--color-flywire-dark-green);
    right: -12px;
}

.introductionStepAnchor.right .chip {
    left: 12px !important;
}

.introductionStepAnchor.bottom .arrow {
    border-bottom: 12px solid var(--color-flywire-dark-green);
    bottom: -12px;
}

.introductionStepAnchor.bottom .chip {
    top: 12px !important;
}

.chip {
    position: absolute;
    width: auto;
    max-width: 80vw;
    color: #d0e8ff;
    padding: 30px;
    padding-bottom: 20px;
    border-radius: 8px;
    display: grid;
    justify-items: center;
    font-size: 18px;
    font-weight: 300;
    grid-row-gap: 15px;

    border: 1px solid rgba(160, 200, 240, 0.2);
    background: linear-gradient(135deg, rgba(10, 15, 35, 0.78), rgba(20, 12, 45, 0.75));
    backdrop-filter: blur(20px);
    box-shadow: 0 0 20px rgba(80, 140, 255, 0.1);
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

.chip.modal {
    padding-top: 0;
    padding-left: 0;
    padding-right: 0;
    overflow: hidden;
}

.chip .title {
    font-size: 22px;
}

.chip video,
.chip .image {
    width: 100%;
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

@keyframes floatUpDrift {
    0% {
        transform: translateY(0) translateX(0) rotate(0deg) scale(1);
        opacity: 1;
    }
    4% {
        transform: translateY(-5vh) translateX(4px) rotate(0.5deg) scale(1.01);
    }
    10% {
        transform: translateY(-12vh) translateX(18px) rotate(1.5deg) scale(1.01);
    }
    18% {
        transform: translateY(-22vh) translateX(8px) rotate(-0.5deg) scale(1);
    }
    26% {
        transform: translateY(-32vh) translateX(-14px) rotate(-1.8deg) scale(0.99);
    }
    35% {
        transform: translateY(-42vh) translateX(-6px) rotate(-0.3deg) scale(1);
    }
    44% {
        transform: translateY(-52vh) translateX(20px) rotate(2deg) scale(1.01);
    }
    54% {
        transform: translateY(-63vh) translateX(12px) rotate(0.8deg) scale(1);
    }
    64% {
        transform: translateY(-74vh) translateX(-16px) rotate(-1.5deg) scale(0.99);
    }
    75% {
        transform: translateY(-85vh) translateX(-4px) rotate(-0.2deg) scale(1);
    }
    85% {
        transform: translateY(-96vh) translateX(14px) rotate(1.2deg) scale(1);
        opacity: 1;
    }
    93% {
        transform: translateY(-108vh) translateX(6px) rotate(0.3deg) scale(1);
        opacity: 0.6;
    }
    100% {
        transform: translateY(-120vh) translateX(-8px) rotate(-0.5deg) scale(1);
        opacity: 0;
    }
}

.floatingImage {
    position: fixed;
    bottom: -350px;
    left: 50%;
    margin-left: -150px;
    width: 300px;
    z-index: 91;
    animation: floatUpDrift 9s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
    pointer-events: none;
}
</style>
