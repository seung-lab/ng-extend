<script setup lang="ts">
import { onMounted, ref } from "vue";
// Based on https://www.w3schools.com/howto/howto_js_draggable.asp
let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
let elem: HTMLElement;

const bottom = true;

const props = defineProps<{
    minimized?: boolean,
    title?: string,
    locked?: boolean,
}>();

const root = ref(null);

onMounted(() => {
    elem = root.value! as HTMLElement;
    const id = elem.id;
    const left = localStorage.getItem(id + " left");
    if (left) {
        elem.style.left = left;
    }
    const top = localStorage.getItem(id + " top");
    if (top) {
        if (bottom) {
            elem.style.bottom = top;
        } else {
            elem.style.top = top;
        }
    }
});

function clickHeader(event: MouseEvent) {
    pos3 = event.clientX;
    pos4 = event.clientY;
    document.onmouseup = release;
    document.onmousemove = drag;
}

function drag(e: MouseEvent) {
    if (props.locked) return;

    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    elem.style.left = (elem.offsetLeft - pos1) + "px";

    if (bottom) {
        const rect = elem.getBoundingClientRect();
        elem.style.bottom = (document.documentElement.clientHeight - (rect.bottom - pos2)) + "px";
    } else {
        elem.style.top = (elem.offsetTop - pos2) + "px";
    }
}

function release() {
    document.onmouseup = null;
    document.onmousemove = null;

    const id = (root.value! as HTMLElement).id;
    localStorage.setItem(id + " left", elem.style.left);
    if (bottom) {
        localStorage.setItem(id + " top", elem.style.bottom);

    } else {
        localStorage.setItem(id + " top", elem.style.top);
    }
}
</script>

<template>
    <div class="hoverBuffer" ref="root" @mousedown="clickHeader"
        :class="{ minimized: props.minimized, locked: props.locked === true }">
        <div class="topBar">
            <div v-if="props.title" class="title">{{ props.title }}</div>
            <div class="controls">
                <button class="exit" @click="$emit('hide')">×</button>
                <button class="minimize" @click="$emit('minimize')">–</button>
                <button v-if="props.locked !== undefined" class="lock" @click="$emit('lock')">
                    <template v-if="props.locked">🔒</template>
                    <template v-else>🔓</template>
                </button>
            </div>
        </div>
        <div class="hologram">
            <slot></slot>
        </div>
    </div>

    <!-- <div class="pyr-hologram-panel" ref="root" @mousedown="clickHeader" :class="{ minimized: props.minimized }"> -->
    <!-- <div class="hologram-controls">
            <button class="exit" @click="$emit('hide')">×</button>
            <button class="minimize" @click="$emit('minimize')">–</button>
        </div> -->
    <!-- <div class="pyr-hologram-header"></div> -->
    <!-- <slot></slot> -->
    <!--<div class="pyr-hologram-border"></div>-->
    <!-- </div> -->
</template>

<style>
.hoverBuffer {
    z-index: 50;
    position: absolute;
    display: grid;
    padding: 5px;
    cursor: pointer;
}

/* .hoverBuffer:active .hologram { TODO, shuffles the layout
    border: 1px solid #00ff807b;
} */

.hologram {
    backdrop-filter: blur(2px);
    display: grid;
    align-items: center;
    max-width: 22em;
    position: relative;
    color: #fff;
    background: hsl(180deg 100% 10% / 80%);
    background-clip: padding-box;
    border-radius: 5px;
    white-space: pre-wrap;
    grid-row-gap: 10px;
}

.hologram:before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    margin: -3px;
    border-radius: inherit;
    background: linear-gradient(to bottom, #00ff81, #00e0ff);
    transition: clip-path 0.2s;
    clip-path: polygon(0px 0px,
            15px 0px,
            15px 6px,
            6px 6px,
            6px calc(100% - 6px),
            15px calc(100% - 6px),
            15px 100%,
            0px 100%);
}

.hoverBuffer:not(:hover) .hologram:before,
.hoverBuffer.locked .hologram:before {
    clip-path: polygon(0px 0px,
            0px 0px,
            0px 4px,
            4px 4px,
            4px calc(100% - 4px),
            0px calc(100% - 4px),
            0px 100%,
            0px 100%);
}

.hoverBuffer:not(:active) .topBar:not(:hover) {
    opacity: 0;
}

.topBar .title,
.topBar .controls button {
    backdrop-filter: brightness(0.5);
}

.topBar {
    display: flex;
    text-transform: uppercase;
    color: var(--hologram-green);
    font-weight: bolder;
    font-size: 15px;
    transition: opacity 0.2s;
}

.controls {
    display: flex;
    flex-direction: row-reverse;
    flex-grow: 1;
    user-select: none;
    ;
    /* opacity: 0.75;
    transition: opacity 0.2s; */
    /* z-index: 1; */
    /* margin: 0 5px 0 0; */
    /* opacity: 0.25; */
}

/* .controls:hover {
    opacity: 1;
} */

.controls button {
    border: none;
    padding: 0;
    /* opacity: 0.6; */
    transition: opacity 0.2s;
    /* font-size: 22px; */
    line-height: 22px;
    font-weight: 300;
    width: 22px;
}

.controls button:hover {
    background-color: initial;
    opacity: 1;
}























.pyr-hologram-panel {
    position: absolute;
    background-color: #00000099;
    font-family: sans-serif;
    overflow: hidden;
    font-size: 15px;
    z-index: 50;
    display: grid;
    grid-template-rows: min-content auto;
    /*border-radius: 10px;
  box-shadow: 0 0 5px #a46fe2aa;
  backdrop-filter: blur(5px);*/
    background: hsl(180deg 100% 10% / 80%);
    border-radius: 15px;
    border: 5px solid transparent;
    border-left: 5px solid #01ffffba;
    border-right: none;
    backdrop-filter: blur(6px);
}

.pyr-hologram-header {
    cursor: move;
    height: 20px;
    /*border: 2px solid #a46fe2aa;*/
}

.pyr-hologram-panel .hologram-controls {
    display: flex;
    flex-direction: row-reverse;
    /* opacity: 0.75;
    transition: opacity 0.2s; */
    z-index: 1;
    margin: 0 5px 0 0;
    opacity: 0.25;
}

.pyr-hologram-panel .hologram-controls:hover {
    opacity: 1;
}

.pyr-hologram-panel .hologram-controls button {
    border: none;
    padding: 0;
    opacity: 0.6;
    transition: opacity 0.2s;
    font-size: 22px;
    line-height: 22px;
    font-weight: 300;
    width: 22px;
}

.hoverBuffer .controls button:hover {
    background-color: var(--hologram-green);
    color: black;
    opacity: 1;
}

/*
.pyr-hologram-content {
  position: absolute;
  width: inherit;
  height: inherit;
}
.pyr-hologram-border {
  border-radius: 10px;
  box-shadow: inset 0 0 30px 3px #a46fe2aa;
  position: relative;
  height: inherit;
  pointer-events: none;
}*/
</style>