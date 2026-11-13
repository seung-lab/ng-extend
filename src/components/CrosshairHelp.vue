<script setup lang="ts">
/**
 * The (i) beside a crosshairs check (Ames 2026-11-12): a picture of the 2D
 * view with the two axes crossing inside the cell, and one line on what to do.
 */
import { ref } from 'vue';
const open = ref(false);
</script>

<template>
  <span class="nge-xh">
    <button type="button" class="nge-xh-i" :aria-expanded="open" aria-label="How to place the crosshairs"
            title="How to place the crosshairs" @click.stop="open = !open">i</button>
    <span v-if="open" class="nge-xh-pop" role="note" @click.stop>
      <svg viewBox="0 0 220 140" width="220" height="140" aria-hidden="true">
        <defs>
          <pattern id="nge-xh-em" width="14" height="14" patternUnits="userSpaceOnUse">
            <rect width="14" height="14" fill="#3a3f44" />
            <circle cx="4" cy="5" r="3" fill="#2c3034" />
            <circle cx="11" cy="11" r="2.5" fill="#474c52" />
          </pattern>
        </defs>
        <rect width="220" height="140" fill="url(#nge-xh-em)" />
        <!-- the cell, as it shows in 2D: a colored patch -->
        <path d="M60 30 C 95 12, 150 22, 165 55 C 178 85, 150 118, 108 116 C 70 114, 42 92, 44 62 C 45 46, 50 36, 60 30 Z"
              fill="rgba(62, 236, 190, 0.45)" stroke="#3eecbe" stroke-width="1.5" />
        <!-- the two axes, crossing inside it -->
        <line x1="0" y1="70" x2="220" y2="70" stroke="#ff5a5a" stroke-width="1.5" />
        <line x1="105" y1="0" x2="105" y2="140" stroke="#5aa0ff" stroke-width="1.5" />
        <circle cx="105" cy="70" r="5" fill="none" stroke="#fff" stroke-width="1.5" />
      </svg>
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
.nge-xh-pop svg { border-radius: 4px; display: block; width: 100%; height: auto; }
.nge-xh-text { color: #cfe3f5; font-size: 13px; line-height: 1.4; font-style: normal; text-transform: none; letter-spacing: normal; }
</style>
