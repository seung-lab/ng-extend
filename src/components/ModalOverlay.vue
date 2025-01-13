<script setup lang="ts">
import Overlay from "#src/components/Overlay.vue";
</script>

<template>
  <div class="nge-overlay-blocker" @click.stop="$emit('hide')" @mousedown.stop>
    <overlay class="modal overlay-content nge-overlay-content">
      <slot></slot>
    </overlay>
  </div>
</template>

<style>
.nge-overlay-blocker {
  height: 100%;
  width: 100%;
  position: fixed;
  z-index: 99;
  top: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.8);
  pointer-events: initial;
}

.ng-extend .modal.overlay-content.nge-overlay-content {
  min-width: 250px;
  background-color: #00000099;
  font-family: sans-serif;
  background: linear-gradient(90deg, #a46fe236, #a46fe214);
  border-radius: 20px;
  border: 5px solid #0000ff00;
  border-left: 5px solid #a46fe2ba;
  border-right: none;
  backdrop-filter: blur(2px);

}

.nge-overlay-content .title {
  font-size: 1.25em;
}

.nge-overlay.modal.overlay-content {
  overflow: visible;
}
</style>