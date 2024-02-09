<script setup lang="ts">
//Based on https://www.w3schools.com/howto/howto_js_draggable.asp
const holos = document.querySelectorAll(".pyr-hologram-panel");
for (const holo of holos) {
    makeDraggable(holo as HTMLElement);
}

function makeDraggable(elem: HTMLElement) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

  (elem.querySelector(".pyr-hologram-header") as HTMLElement).onmousedown = dragMouseDown;

  function dragMouseDown(e: MouseEvent) {
    e.preventDefault();
    // get the mouse cursor position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // call a function whenever the cursor moves:
    document.onmousemove = elementDrag;
  }

  function elementDrag(e: MouseEvent) {
    e.preventDefault();
    // calculate the new cursor position:
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // set the element's new position:
    elem.style.top = (elem.offsetTop - pos2) + "px";
    elem.style.left = (elem.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    // stop moving when mouse button is released:
    document.onmouseup = null;
    document.onmousemove = null;
  }
}
</script>

<template>
  <div class="pyr-hologram-panel">
    <div class="pyr-hologram-content">
        <div class="pyr-hologram-header"></div>
        <slot></slot>
    </div>
    <div class="pyr-hologram-border"></div>
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
  border-radius: 10px;
  box-shadow: 0 0 5px #a46fe2aa;
  backdrop-filter: blur(5px);
}
.pyr-hologram-content {
  position: absolute;
  width: inherit;
  height: inherit;
}
.pyr-hologram-header {
  cursor: move;
  height: 20px;
  /*border: 2px solid #a46fe2aa;*/
}
.pyr-hologram-border {
  border-radius: 10px;
  box-shadow: inset 0 0 30px 3px #a46fe2aa;
  position: relative;
  height: inherit;
  pointer-events: none;
}
</style>