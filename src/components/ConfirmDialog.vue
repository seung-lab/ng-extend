<script setup lang="ts">
/**
 * ConfirmDialog: a yes that cannot be clicked through by accident (Ames
 * 2026-10-16, for deleting a player's access request: "wouldn't want to
 * accidentally delete their work!!"). In the middle of the screen, Cancel
 * has the focus, Escape or a click outside cancels, and the button that
 * does it is red and says what it does.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';

// enterYes: the yes button has the focus, so Enter confirms (Ames 2026-11-13,
// Highlight's Clear all: "make sure Enter is ok so they don't have to click").
const props = defineProps<{ title: string; text: string; yes: string; enterYes?: boolean }>();
const emit = defineEmits({ yes: null, no: null });
const cancelEl = ref<HTMLButtonElement | null>(null);
const yesEl = ref<HTMLButtonElement | null>(null);
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { e.stopPropagation(); emit('no'); return; }
  // Enter does what the focused button does, and nothing else in Pyr (Enter
  // also submits a cut) sees it.
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    if (document.activeElement === cancelEl.value) emit('no'); else if (document.activeElement === yesEl.value || props.enterYes) emit('yes'); else emit('no');
  }
};
onMounted(() => { (props.enterYes ? yesEl : cancelEl).value?.focus(); window.addEventListener('keydown', onKey, true); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <teleport to="body">
    <div class="nge-cfm-backdrop" @click.self="emit('no')">
      <div class="nge-cfm" role="alertdialog" aria-modal="true" :aria-label="title">
        <h3 class="nge-cfm-title">{{ title }}</h3>
        <p class="nge-cfm-text">{{ text }}</p>
        <div class="nge-cfm-btns">
          <button ref="cancelEl" class="nge-cfm-no" @click="emit('no')">Cancel</button>
          <button ref="yesEl" class="nge-cfm-yes" @click="emit('yes')">{{ yes }}</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.nge-cfm-backdrop { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.55); }
.nge-cfm {
  width: 420px; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 18px 20px;
  background: #0b1220; border: 1px solid rgba(224, 96, 96, 0.6); border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #e4ecf5; font-size: 15px; line-height: 1.5;
}
.nge-cfm-title { margin: 0 0 8px; font-size: 17px; font-weight: 600; color: #ff9b9b; }
.nge-cfm-text { margin: 0 0 16px; }
.nge-cfm-btns { display: flex; justify-content: flex-end; gap: 10px; }
.nge-cfm-no, .nge-cfm-yes { font: inherit; font-size: 15px; padding: 7px 16px; border-radius: 8px; cursor: pointer; }
.nge-cfm-no { color: #e4ecf5; background: #152434; border: 1px solid #74859a; }
.nge-cfm-yes { color: #fff; background: #a83232; border: 1px solid #e06060; font-weight: 600; }
.nge-cfm-yes:hover { background: #c03b3b; }
.nge-cfm-no:focus-visible, .nge-cfm-yes:focus-visible { outline: 2px solid #9fd3ff; outline-offset: 2px; }
</style>
