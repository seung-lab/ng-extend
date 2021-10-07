<template>
  <div class="nge-overlay-blocker" @click.stop="$emit('hide')" @mousedown.stop>
    <overlay class="modal overlay-content">
      <slot></slot>
    </overlay>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import Overlay from "components/Overlay.vue";

export default defineComponent({
  components: { Overlay }
});
</script>

<style>
.nge-overlay-blocker {
  height: 100%;
  width: 100%;
  position: fixed;
  z-index: 99;
  top: 0;
  left: 0;
  background-color: rgba(0,0,0,0.8);
  pointer-events: initial;
}

.nge-overlay-content {
  min-width: 250px;
}

.nge-overlay-content .title {
  background-color: lightgray;
  font-size: 1.25em;
}
</style>