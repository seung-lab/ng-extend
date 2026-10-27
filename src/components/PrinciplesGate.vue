<script setup lang="ts">
/**
 * PrinciplesGate: the Eyewire II Principles (Ames 2026-10-27: "we need a way
 * to ask players to agree to community principles when they go to Retina
 * dataset", https://eyewire.ai/principles). When a signed in player who is
 * past the beta gate has the Retina dataset on screen, the server is asked
 * whether they agreed to this version (functions/access-request.js,
 * access.principlesStatus); if not, this covers the game until they agree or
 * choose another dataset. Agreeing is recorded by the server, once per
 * account and version, so it is asked once on any device.
 *
 * Fails open, like BetaGate: if the server cannot be asked, nothing shows.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useLayersStore, useProofreadingBackendStore } from '../store';
import { secureWrite } from '../secure_write';
import { currentSegLayerName, canonicalDataset } from '../datasets';
import { betaGate } from '../beta_gate';
import { runPanelTrace } from '../util/holo_trace';

const PRINCIPLES_URL = 'https://eyewire.ai/principles';
const RETINA = 'stroeh_mouse_retina';
const backend = useProofreadingBackendStore();
const layers = useLayersStore();

const show = ref(false);
const ticked = ref(false);
const sending = ref(false);
const error = ref('');
const panelEl = ref<HTMLElement | null>(null);
// The version the server asked about, sent back when agreeing.
let version = '';
// Agreed this page load, by user id: never asked twice.
const agreedFor = ref('');
// "Choose another dataset" sets this aside until the dataset changes.
let setAsideOn = '';

// `activeLayers` is touched so this recomputes on a dataset switch;
// currentSegLayerName reads the non-reactive viewer.
const onRetina = computed(() => {
  void layers.activeLayers.size;
  return canonicalDataset(currentSegLayerName()) === RETINA;
});

let asking = false;
async function check() {
  const id = backend.userId;
  if (!id || betaGate.value !== 'in' || !onRetina.value || agreedFor.value === id) { show.value = false; return; }
  if (setAsideOn === id) return;
  if (asking) return;
  asking = true;
  try {
    const s = await secureWrite<{ version?: string; agreed?: boolean }>('access.principlesStatus');
    if (backend.userId !== id) return;
    if (s && s.agreed === false && s.version) {
      version = s.version;
      ticked.value = false; error.value = '';
      show.value = onRetina.value;
      if (show.value) setTimeout(() => { if (panelEl.value) runPanelTrace(panelEl.value); }, 80);
    } else if (s && s.agreed) {
      agreedFor.value = id;
      show.value = false;
    }
  } catch { /* fail open; asked again on the next dataset switch */ }
  finally { asking = false; }
}
watch([() => backend.userId, () => betaGate.value, onRetina], ([, , retina]) => {
  if (!retina) setAsideOn = '';
  void check();
}, { immediate: true });

async function agree() {
  if (sending.value) return;
  if (!ticked.value) { error.value = 'Please tick the box to say you have read and agree to the principles.'; return; }
  sending.value = true; error.value = '';
  try {
    await secureWrite('access.principlesAgree', { version });
    agreedFor.value = backend.userId || '';
    show.value = false;
  } catch (e: any) {
    error.value = e?.message || 'That did not go through. Please try again.';
  } finally {
    sending.value = false;
  }
}
function chooseAnother() {
  setAsideOn = backend.userId || '';
  show.value = false;
  document.dispatchEvent(new CustomEvent('nge:open-dataset-selector'));
}
// Nothing behind the screen takes keys while it is up.
function swallow(e: KeyboardEvent) {
  if (!show.value) return;
  const t = e.target as HTMLElement | null;
  if (t && t.closest && t.closest('.nge-principles-panel')) return;
  e.stopPropagation();
}
onMounted(() => window.addEventListener('keydown', swallow, true));
onUnmounted(() => window.removeEventListener('keydown', swallow, true));
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="nge-principles-screen" role="presentation">
      <div ref="panelEl" class="nge-principles-panel" role="dialog" aria-modal="true" aria-labelledby="nge-principles-title">
        <div class="nge-principles-kicker"><span class="nge-principles-dot" aria-hidden="true"></span>Retina dataset</div>
        <h2 id="nge-principles-title" class="nge-principles-title">The Eyewire II Principles</h2>
        <p class="nge-principles-text">The retina dataset is shared with the Eyewire II community before it is published. To map it, please read and agree to the community's principles. In short:</p>
        <ul class="nge-principles-list">
          <li><b>Share.</b> Your proofreading and annotations are shared right away with the whole community. Unpublished data stays inside the community.</li>
          <li><b>Give credit.</b> Before reporting research that uses unpublished cells, get permission from the labs that made a significant contribution to them.</li>
          <li><b>Be open.</b> Before reporting research, send the list of neurons you used to support@eyewire.ai.</li>
          <li><b>Respect each other.</b> Talk early, work things out together, and respect everyone's effort.</li>
        </ul>
        <p class="nge-principles-text"><a :href="PRINCIPLES_URL" target="_blank" rel="noopener noreferrer">Read the full Eyewire II Principles</a>, including the embargo and how credit works.</p>
        <label class="nge-principles-agree">
          <input v-model="ticked" type="checkbox" @change="error = ''" />
          <span>I have read and agree to the Eyewire II Principles.</span>
        </label>
        <button class="nge-principles-btn" :disabled="sending" @click="agree">{{ sending ? 'Saving...' : 'Agree and continue' }}</button>
        <p v-if="error" class="nge-principles-error" role="alert">{{ error }}</p>
        <p class="nge-principles-foot">
          <button class="nge-principles-link" @click="chooseAnother">Choose another dataset</button>
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Above the game and its panels, under the beta screen (10001), which never
   shows at the same time. */
.nge-principles-screen {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(20, 60, 110, 0.35), transparent 65%),
    rgba(2, 5, 12, 0.88);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif;
  animation: nge-principles-fade 0.35s ease both;
}
@keyframes nge-principles-fade { from { opacity: 0; } to { opacity: 1; } }
.nge-principles-panel {
  position: relative;
  width: min(540px, 100%);
  max-height: calc(100vh - 32px); overflow-y: auto;
  padding: 28px 32px 20px;
  background: rgba(6, 10, 20, 0.94);
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-radius: 14px;
  box-shadow: 0 10px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(53, 181, 255, 0.12), inset 0 0 40px rgba(53, 181, 255, 0.04);
  color: rgba(230, 240, 255, 0.92);
}
.nge-principles-panel::before, .nge-principles-panel::after {
  content: ''; position: absolute; width: 18px; height: 18px;
  border: 2px solid rgba(79, 207, 255, 0.7); pointer-events: none;
}
.nge-principles-panel::before { top: 6px; left: 6px; border-right: none; border-bottom: none; border-top-left-radius: 8px; }
.nge-principles-panel::after { bottom: 6px; right: 6px; border-left: none; border-top: none; border-bottom-right-radius: 8px; }
@media (prefers-reduced-motion: reduce) { .nge-principles-screen { animation: none; } }
.nge-principles-kicker {
  display: flex; align-items: center; gap: 8px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #4fcfff;
}
.nge-principles-dot { width: 8px; height: 8px; border-radius: 50%; background: #4fcfff; box-shadow: 0 0 8px rgba(79, 207, 255, 0.9); }
.nge-principles-title {
  margin: 10px 0 12px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 19px; font-weight: 600; letter-spacing: 0.04em; line-height: 1.3;
  color: #fff;
}
.nge-principles-text { margin: 0 0 14px; font-size: 14px; line-height: 1.55; color: rgba(215, 230, 250, 0.85); }
.nge-principles-text a { color: #7ee0ff; }
.nge-principles-list { margin: 0 0 14px; padding-left: 18px; font-size: 14px; line-height: 1.5; color: rgba(215, 230, 250, 0.85); }
.nge-principles-list li { margin-bottom: 8px; }
.nge-principles-list b { color: #fff; }
.nge-principles-agree { display: flex; gap: 10px; align-items: flex-start; margin: 4px 0 16px; font-size: 14px; line-height: 1.45; cursor: pointer; }
.nge-principles-agree input { width: 18px; height: 18px; margin: 1px 0 0; flex: 0 0 auto; accent-color: #4fcfff; }
.nge-principles-btn {
  width: 100%; height: 42px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #04121f;
  background: linear-gradient(180deg, #7ee0ff, #3fb6f0);
  border: 0;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  cursor: pointer;
}
.nge-principles-btn:hover:not(:disabled), .nge-principles-btn:focus-visible { filter: brightness(1.12); outline: none; }
.nge-principles-btn:disabled { cursor: default; filter: saturate(0.5) brightness(0.8); }
.nge-principles-error { margin: 10px 0 0; font-size: 13px; color: #ff9a9a; }
.nge-principles-foot { margin: 16px 0 0; padding-top: 12px; border-top: 1px solid rgba(79, 207, 255, 0.15); font-size: 13px; }
.nge-principles-link { padding: 0; background: none; border: 0; font: inherit; color: rgba(200, 220, 245, 0.75); cursor: pointer; }
.nge-principles-link:hover, .nge-principles-link:focus-visible { color: #fff; text-decoration: underline; }
</style>
