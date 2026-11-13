<script setup lang="ts">
/**
 * The (i) beside a crosshairs check (Ames 2026-11-12): a real 2D view (from
 * Ames) with the two axes crossing inside the cell, and one line on what to do.
 */
import { ref } from 'vue';
import imgInside from '../images/crosshairs-inside-cell.jpg';
const open = ref(false);
</script>

<template>
  <span class="nge-xh">
    <button type="button" class="nge-xh-i" :aria-expanded="open" aria-label="How to place the crosshairs"
            title="How to place the crosshairs" @click.stop="open = !open">i</button>
    <span v-if="open" class="nge-xh-pop" role="note" @click.stop>
      <img :src="imgInside" width="220" height="206" alt="The 2D view: the red and green axes cross inside the highlighted cell" />
      <span class="nge-xh-text">In the 2D view, move so the two axes cross inside your cell, then press Check again.</span>
    </span>
  </span>
</template>

<style scoped>
.nge-xh { position: relative; display: inline-flex; vertical-align: middle; margin-left: 6px; }
.nge-xh-i {
  width: 18px; height: 18px; padding: 0; border-radius: 50%;
  border: 1px solid rgba(124, 196, 255, 0.6); background: rgba(20, 40, 64, 0.8);
  color: #9cd2ff; font: italic 700 11px/1 Georgia, serif; cursor: pointer;
}
.nge-xh-i:hover, .nge-xh-i[aria-expanded="true"] { color: #fff; border-color: #7cc4ff; }
.nge-xh-pop {
  position: absolute; z-index: 20; bottom: calc(100% + 8px); left: -10px;
  display: flex; flex-direction: column; gap: 8px; width: 240px; padding: 10px;
  border: 1px solid rgba(124, 196, 255, 0.4); border-radius: 8px;
  background: rgba(8, 18, 32, 0.97); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.nge-xh-pop img { border-radius: 4px; display: block; width: 100%; height: auto; }
.nge-xh-text { color: #cfe3f5; font-size: 13px; line-height: 1.4; font-style: normal; text-transform: none; letter-spacing: normal; }
</style>
