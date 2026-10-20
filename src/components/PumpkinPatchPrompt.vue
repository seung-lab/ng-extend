<script setup lang="ts">
/**
 * "Visit the pumpkin patch?" (Ames 2026-10-20): the chat bar's pumpkin
 * button, pressed away from the Sandbox, asks before taking the player
 * there. Escape or a click outside says no. Orange, not the red of
 * ConfirmDialog: nothing is lost by going.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits({ yes: null, no: null });
const yesEl = ref<HTMLButtonElement | null>(null);
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); emit('no'); } };
onMounted(() => { yesEl.value?.focus(); window.addEventListener('keydown', onKey, true); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <teleport to="body">
    <div class="nge-patch-backdrop" @click.self="emit('no')">
      <div class="nge-patch" role="dialog" aria-modal="true" aria-label="Visit the pumpkin patch?">
        <div class="nge-patch-pumpkin" aria-hidden="true">🎃</div>
        <h3 class="nge-patch-title">Visit the pumpkin patch?</h3>
        <p class="nge-patch-text">A cell in the Sandbox is wearing a jack o' lantern. Pop over and say boo!</p>
        <div class="nge-patch-btns">
          <button class="nge-patch-no" @click="emit('no')">Not now</button>
          <button ref="yesEl" class="nge-patch-yes" @click="emit('yes')">Take me to the patch</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.nge-patch-backdrop { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.5); }
.nge-patch {
  width: 380px; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 18px 20px 16px; text-align: center;
  background: linear-gradient(180deg, #1b1208, #0b1220 70%); border: 1px solid rgba(255, 150, 40, 0.6); border-radius: 14px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(255, 130, 20, 0.15);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #f3ead9; font-size: 15px; line-height: 1.5;
}
.nge-patch-pumpkin { font-size: 40px; line-height: 1; margin-bottom: 6px; animation: nge-patch-bob 2.4s ease-in-out infinite; }
@keyframes nge-patch-bob { 50% { transform: translateY(-4px) rotate(-4deg); } }
.nge-patch-title { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: #ffb35c; }
.nge-patch-text { margin: 0 0 16px; color: #d9cdb6; }
.nge-patch-btns { display: flex; justify-content: center; gap: 10px; }
.nge-patch-no, .nge-patch-yes { font: inherit; font-size: 15px; padding: 7px 16px; border-radius: 9px; cursor: pointer; }
.nge-patch-no { color: #e4ecf5; background: #1a2232; border: 1px solid #5d6b80; }
.nge-patch-yes { color: #1a0d00; background: #ff9a2e; border: 1px solid #ffc27a; font-weight: 700; }
.nge-patch-yes:hover { background: #ffad52; }
.nge-patch-no:focus-visible, .nge-patch-yes:focus-visible { outline: 2px solid #ffd59a; outline-offset: 2px; }
</style>
