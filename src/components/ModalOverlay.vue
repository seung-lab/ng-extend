<script setup lang="ts">
import Overlay from "components/Overlay.vue";
</script>

<template>
  <div class="nge-overlay-blocker" @click.stop="$emit('hide')" @mousedown.stop>
    <!-- Subtle floating particle grid -->
    <div class="nge-holo-modal-particles"></div>
    <overlay class="modal overlay-content nge-overlay-content">
      <slot></slot>
    </overlay>
  </div>
</template>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   HOLOGRAPHIC MODAL OVERLAY — Shared sci-fi treatment for all panels
   ══════════════════════════════════════════════════════════════════════════ */

.nge-overlay-blocker {
  height: 100%;
  width: 100%;
  position: fixed;
  z-index: 99;
  top: 0;
  left: 0;
  background: radial-gradient(ellipse at center, rgba(0, 12, 30, 0.82) 0%, rgba(0, 0, 0, 0.92) 100%);
  backdrop-filter: blur(6px) saturate(1.2);
  pointer-events: initial;
}

/* ── Floating particle grid on backdrop ── */
.nge-holo-modal-particles {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(1px 1px at 18% 25%, rgba(74, 158, 255, 0.25) 0%, transparent 100%),
    radial-gradient(1px 1px at 45% 65%, rgba(0, 210, 255, 0.15) 0%, transparent 100%),
    radial-gradient(1px 1px at 75% 35%, rgba(206, 147, 216, 0.15) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 60% 80%, rgba(74, 158, 255, 0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 88% 18%, rgba(0, 255, 200, 0.12) 0%, transparent 100%),
    radial-gradient(1px 1px at 8% 82%, rgba(74, 158, 255, 0.15) 0%, transparent 100%);
  background-size: 250px 250px, 300px 300px, 200px 200px, 350px 350px, 180px 180px, 280px 280px;
  animation: ngeHoloModalDrift 25s linear infinite;
  pointer-events: none;
  opacity: 0.5;
}

@keyframes ngeHoloModalDrift {
  0%   { transform: translate(0, 0); }
  100% { transform: translate(-50px, -35px); }
}

/* ── Holographic border + glow on overlay panel ── */
.nge-overlay-blocker .nge-overlay {
  border: 1px solid rgba(0, 180, 255, 0.18) !important;
  box-shadow:
    0 0 60px rgba(0, 150, 255, 0.07),
    0 0 160px rgba(0, 150, 255, 0.03),
    inset 0 0 60px rgba(0, 100, 200, 0.02),
    0 16px 48px rgba(0, 0, 0, 0.45);
}

.nge-overlay-content {
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