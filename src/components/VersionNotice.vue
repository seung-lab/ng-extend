<script setup lang="ts">
/**
 * "A newer version is out": a small panel in the corner, once, when the game
 * has been updated since this page loaded (util/version_watch.ts). "Later"
 * folds it down to a chip that stays, so it is not forgotten and never asks
 * twice. Nothing reloads unless the player presses Reload.
 *
 * In the kit's terms this is an arrival, so it is a corner panel and its
 * light runs once: the particle trace on arriving (holo_trace.ts, the same
 * one the Cell Library opens with). Nothing here loops.
 */
import { nextTick, ref, watch } from 'vue';
import { version, startVersionWatch, reloadForUpdate } from '../util/version_watch';
import { runPanelTrace } from '../util/holo_trace';

startVersionWatch();

const folded = ref(false);
const panelEl = ref<HTMLElement | null>(null);
const reloading = ref(false);

watch(() => version.newer, async (now, was) => {
  // The first newer version opens the panel. One after that changes nothing:
  // the player has already been told, and has the chip.
  if (!now || was) return;
  await nextTick();
  if (panelEl.value) runPanelTrace(panelEl.value);
  panelEl.value?.querySelector<HTMLButtonElement>('.nge-ver-go')?.focus({ preventScroll: true });
});

function reload() { reloading.value = true; reloadForUpdate(); }

/** The chip lives in the top bar with the other tools, first in the row, so
 *  it can never sit on top of one. Before sign in there is no such row and it
 *  floats under the bar instead. */
const inBar = ref(false);
watch([() => version.newer, folded], () => { inBar.value = !!document.querySelector('.nge-toolbar-icons'); });
</script>

<template>
  <Teleport to="body">
    <div v-if="version.newer && !folded" ref="panelEl" class="nge-ver" role="status" aria-live="polite">
      <span class="nge-ver-corner nge-ver-corner--tl" aria-hidden="true"></span>
      <span class="nge-ver-corner nge-ver-corner--br" aria-hidden="true"></span>
      <div class="nge-ver-label"><span class="nge-ver-pip" aria-hidden="true"></span>New version ready</div>
      <div class="nge-ver-text">Pyr was updated while you were here. Reload to get the newest fixes. Your edits are already saved.</div>
      <div class="nge-ver-actions">
        <button type="button" class="nge-ver-btn nge-ver-go" :disabled="reloading" @click="reload">{{ reloading ? 'Reloading' : 'Reload now' }}</button>
        <button type="button" class="nge-ver-btn" @click="folded = true">Later</button>
      </div>
    </div>
  </Teleport>
  <Teleport v-if="version.newer && folded" :to="inBar ? '.nge-toolbar-icons' : 'body'">
    <button type="button" class="nge-ver-chip" :class="{ 'nge-ver-chip--bar': inBar }" :disabled="reloading"
            title="A newer version of Pyr is out. Click to reload and get it." @click="reload">
      <span class="nge-ver-pip" aria-hidden="true"></span>{{ reloading ? 'Reloading' : 'Update ready' }}
    </button>
  </Teleport>
</template>

<style>
.nge-ver, .nge-ver-chip {
  --ver-line: 53, 181, 255;   /* the kit's beam blue, as holo_trace.ts draws it */
  /* Top centre: the one stretch of the screen no panel, list or menu uses. */
  position: fixed; left: 50%; z-index: 10040;
  font-family: 'Inter', system-ui, sans-serif;
  color: #dbe7f7;
}
.nge-ver {
  top: 64px; width: 300px; max-width: calc(100vw - 32px); margin-left: max(-150px, calc(-50vw + 16px)); padding: 13px 15px 12px;
  background: linear-gradient(180deg, rgba(13, 22, 40, 0.97), rgba(6, 10, 20, 0.97));
  border: 1px solid rgba(var(--ver-line), 0.34);
  border-radius: 10px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(var(--ver-line), 0.35);
  /* Arrives once: rises a little and sharpens. */
  animation: nge-ver-in 0.42s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes nge-ver-in {
  from { opacity: 0; transform: translateY(-10px) scale(0.985); filter: blur(3px); }
  to { opacity: 1; transform: none; filter: none; }
}
/* Corner brackets that settle outward as the panel arrives, then rest. */
.nge-ver-corner { position: absolute; width: 11px; height: 11px; border: 1px solid rgba(var(--ver-line), 0.9); pointer-events: none; animation: nge-ver-corner 0.6s 0.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.nge-ver-corner--tl { top: -1px; left: -1px; border-right: 0; border-bottom: 0; border-top-left-radius: 10px; --cx: 4px; --cy: 4px; }
.nge-ver-corner--br { bottom: -1px; right: -1px; border-left: 0; border-top: 0; border-bottom-right-radius: 10px; --cx: -4px; --cy: -4px; }
@keyframes nge-ver-corner {
  from { opacity: 0; transform: translate(var(--cx), var(--cy)); }
  to { opacity: 1; transform: none; }
}
.nge-ver-label {
  display: flex; align-items: center; gap: 8px;
  font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase;
  color: rgb(124, 196, 255); margin-bottom: 7px;
}
.nge-ver-pip { width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--ver-line)); box-shadow: 0 0 8px rgba(var(--ver-line), 0.9); flex-shrink: 0; }
.nge-ver-text { font-size: 12.5px; line-height: 1.45; color: #b9c9de; }
.nge-ver-actions { display: flex; gap: 8px; margin-top: 11px; }
.nge-ver-btn {
  font: 600 10.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 7px 12px; border-radius: 6px; cursor: pointer;
  background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.16); color: #cfdcef;
  transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s;
}
.nge-ver-go { background: rgba(var(--ver-line), 0.18); border-color: rgba(var(--ver-line), 0.75); color: #eef7ff; }
.nge-ver-btn:hover:not(:disabled), .nge-ver-btn.holo-on { border-color: rgba(var(--ver-line), 0.9); color: #fff; }
.nge-ver-go:hover:not(:disabled), .nge-ver-go.holo-on { background: rgba(var(--ver-line), 0.3); box-shadow: 0 0 14px rgba(var(--ver-line), 0.35); }
.nge-ver-btn:focus-visible, .nge-ver-chip:focus-visible { outline: 2px solid rgb(124, 196, 255); outline-offset: 2px; }
.nge-ver-btn:disabled, .nge-ver-chip:disabled { opacity: 0.6; cursor: default; }
.nge-ver-chip {
  display: inline-flex; align-items: center; gap: 7px;
  font: 600 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase;
  top: 58px; transform: translateX(-50%);
  padding: 6px 11px; border-radius: 14px; cursor: pointer; white-space: nowrap;
  background: rgba(8, 13, 26, 0.95); border: 1px solid rgba(var(--ver-line), 0.5);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.nge-ver-chip:hover:not(:disabled), .nge-ver-chip.holo-on { border-color: rgba(var(--ver-line), 0.95); box-shadow: 0 0 12px rgba(var(--ver-line), 0.3); }
@media (prefers-reduced-motion: reduce) {
  .nge-ver, .nge-ver-corner { animation: none; }
}
/* In the top bar it is one of the row's own items, first in line. */
.nge-ver-chip.nge-ver-chip--bar { position: static; transform: none; order: -1; margin-right: 8px; flex-shrink: 0; }
/* The bar strips its buttons bare; this one keeps its outline and its light. */
#extensionBar .nge-ver-chip.nge-ver-chip--bar {
  display: inline-flex !important; align-items: center; gap: 7px; width: auto; height: auto;
  padding: 5px 11px !important; border-radius: 14px !important;
  background: rgba(8, 13, 26, 0.95) !important; border: 1px solid rgba(var(--ver-line), 0.55) !important;
  color: #dbe7f7 !important; font: 600 10px 'Orbitron', 'Inter', sans-serif !important; letter-spacing: 0.14em !important;
}
#extensionBar .nge-ver-chip.nge-ver-chip--bar:hover:not(:disabled),
#extensionBar .nge-ver-chip.nge-ver-chip--bar.holo-on { border-color: rgba(var(--ver-line), 0.95) !important; box-shadow: 0 0 12px rgba(var(--ver-line), 0.3); }
#extensionBar .nge-ver-chip .nge-ver-pip { display: inline-block !important; width: 7px !important; height: 7px !important; border-radius: 50%; background: rgb(var(--ver-line)) !important; box-shadow: 0 0 8px rgba(var(--ver-line), 0.9); }
</style>
