<script setup lang="ts">
import {onMounted, ref} from "vue";
// Based on https://www.w3schools.com/howto/howto_js_draggable.asp
let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
let elem: HTMLElement;

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
        elem.style.top = top;
    }
});

function clickHeader(event: MouseEvent) {
    event.preventDefault();
    pos3 = event.clientX;
    pos4 = event.clientY;
    document.onmouseup = release;
    document.onmousemove = drag;
}

function drag(e: MouseEvent) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    elem.style.left = (elem.offsetLeft - pos1) + "px";
    elem.style.top = (elem.offsetTop - pos2) + "px";
}

function release() {
    document.onmouseup = null;
    document.onmousemove = null;
    
    const id = (root.value! as HTMLElement).id;
    localStorage.setItem(id + " left", elem.style.left);
    localStorage.setItem(id + " top", elem.style.top);
}
</script>

<template>
  <div class="pyr-hologram-panel" ref="root">
    <div class="pyr-hologram-header" @mousedown="clickHeader"></div>
    <slot></slot>
    <!--<div class="pyr-hologram-border"></div>-->
  </div>
</template>

<style>
.pyr-hologram-panel {
  position: absolute;
  background-color: #00000099;
  font-family: sans-serif;
  overflow: hidden;
  font-size: 13px;
  z-index: 50;
  display: grid;
  grid-template-rows: min-content auto;
  /*border-radius: 10px;
  box-shadow: 0 0 5px #a46fe2aa;
  backdrop-filter: blur(5px);*/
  background: linear-gradient(90deg, #01ffff36, #01ffff14);
  border-radius: 20px;
  border: 5px solid #0000ff00;
  border-left: 5px solid #01ffffba;
  border-right: none;
  backdrop-filter: blur(2px);
}

.pyr-hologram-header {
  cursor: move;
  height: 20px;
  /*border: 2px solid #a46fe2aa;*/
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