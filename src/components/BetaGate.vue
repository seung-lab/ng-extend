<script setup lang="ts">
/**
 * BetaGate: Pyr is invite only for now (Ames 2026-10-24: "If they are not on
 * the pilot tester list they should receive a popup"). Once a player is
 * signed in, the server says whether they are on Pilot testers; if not, this
 * covers the game and offers Request beta access, once per account. The
 * request lands on the triage board, in the reviewers' Admin tab and in
 * Slack (functions/access-request.js, access.beta).
 *
 * Fails open: if the server cannot be asked, nothing shows. The server still
 * refuses every write from a player who is not on the list.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useLoginStore, useProofreadingBackendStore } from '../store';
import { secureWrite } from '../secure_write';
import { runPanelTrace } from '../util/holo_trace';

const SUPPORT = 'support@eyewire.ai';
const backend = useProofreadingBackendStore();
const login = useLoginStore();

const show = ref(false);
const requested = ref(false);
const note = ref('');
const sending = ref(false);
const error = ref('');
const panelEl = ref<HTMLElement | null>(null);

let askedFor = '';
async function check(userId: string) {
  if (!userId || askedFor === userId) return;
  askedFor = userId;
  try {
    const s = await secureWrite<{ invited?: boolean; requested?: boolean }>('access.betaStatus');
    // Only a plain "no" from the server shows the popup.
    if (s && s.invited === false) {
      requested.value = !!s.requested;
      show.value = true;
      setTimeout(() => { if (panelEl.value) runPanelTrace(panelEl.value); }, 80);
    } else {
      show.value = false;
    }
  } catch { askedFor = ''; /* fail open; asked again on the next sign in */ }
}
watch(() => backend.userId, id => { if (id) void check(id); else { show.value = false; askedFor = ''; } }, { immediate: true });

async function request() {
  if (sending.value) return;
  sending.value = true;
  error.value = '';
  try {
    const r = await secureWrite<{ invited?: boolean; requested?: boolean }>('access.beta', { note: note.value.trim() || undefined });
    if (r?.invited) { show.value = false; return; }
    requested.value = true;
  } catch (e: any) {
    error.value = e?.message || 'That did not go through. Please try again.';
  } finally {
    sending.value = false;
  }
}
function signOut() {
  for (const s of [...login.sessions]) login.logout(s);
  show.value = false;
  askedFor = '';
}
// Nothing behind the popup takes keys while it is up.
function swallow(e: KeyboardEvent) {
  if (!show.value) return;
  const t = e.target as HTMLElement | null;
  if (t && t.closest && t.closest('.nge-beta-panel')) return;
  e.stopPropagation();
}
onMounted(() => window.addEventListener('keydown', swallow, true));
onUnmounted(() => window.removeEventListener('keydown', swallow, true));
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="nge-beta-screen" role="presentation">
      <div ref="panelEl" class="nge-beta-panel" role="dialog" aria-modal="true" aria-labelledby="nge-beta-title">
        <div class="nge-beta-kicker"><span class="nge-beta-dot" aria-hidden="true"></span>Closed beta</div>
        <h2 id="nge-beta-title" class="nge-beta-title">Pyr is invite only for now</h2>
        <template v-if="!requested">
          <p class="nge-beta-text">Thanks for signing in! Pyr is in a closed beta while we get it ready. Ask to join and we'll add you as soon as we can.</p>
          <label class="nge-beta-label" for="nge-beta-note">Anything you'd like us to know? <span>(optional)</span></label>
          <textarea id="nge-beta-note" v-model="note" class="nge-beta-note" rows="3" maxlength="1000"
                    placeholder="Where you heard about Pyr, or your EyeWire username"></textarea>
          <button class="nge-beta-btn" :disabled="sending" @click="request">{{ sending ? 'Sending...' : 'Request beta access' }}</button>
          <p v-if="error" class="nge-beta-error" role="alert">{{ error }}</p>
        </template>
        <template v-else>
          <p class="nge-beta-text nge-beta-text--done"><span class="nge-beta-check" aria-hidden="true">✓</span>Your request is in. Once you're in, this message goes away the next time you open Pyr.</p>
        </template>
        <p class="nge-beta-foot">
          Questions? Email <a :href="'mailto:' + SUPPORT">{{ SUPPORT }}</a>
          <span class="nge-beta-sep" aria-hidden="true">·</span>
          <button class="nge-beta-link" @click="signOut">Sign out</button>
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Above the game and its panels; the sign in screen (10000) never shows at
   the same time, since this needs a signed in player. */
.nge-beta-screen {
  position: fixed; inset: 0; z-index: 10001;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(20, 60, 110, 0.35), transparent 65%),
    rgba(2, 5, 12, 0.9);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif;
  animation: nge-beta-fade 0.35s ease both;
}
@keyframes nge-beta-fade { from { opacity: 0; } to { opacity: 1; } }
.nge-beta-panel {
  position: relative;
  width: min(460px, 100%);
  padding: 30px 32px 22px;
  background: rgba(6, 10, 20, 0.94);
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-radius: 14px;
  box-shadow: 0 10px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(53, 181, 255, 0.12), inset 0 0 40px rgba(53, 181, 255, 0.04);
  color: rgba(230, 240, 255, 0.92);
  animation: nge-beta-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* Corner brackets, the scifi-ui frame mark (as in Switch Dataset). */
.nge-beta-panel::before, .nge-beta-panel::after {
  content: ''; position: absolute; width: 18px; height: 18px;
  border: 2px solid rgba(79, 207, 255, 0.7); pointer-events: none;
}
.nge-beta-panel::before { top: 6px; left: 6px; border-right: none; border-bottom: none; border-top-left-radius: 8px; }
.nge-beta-panel::after { bottom: 6px; right: 6px; border-left: none; border-top: none; border-bottom-right-radius: 8px; }
@keyframes nge-beta-materialize {
  0%   { opacity: 0; transform: scale(1.02) translateY(-8px); filter: blur(14px); }
  60%  { opacity: 1; transform: scale(0.997); filter: blur(0); }
  100% { opacity: 1; transform: none; filter: blur(0); }
}
@media (prefers-reduced-motion: reduce) { .nge-beta-panel, .nge-beta-screen { animation: none; } }
.nge-beta-kicker {
  display: flex; align-items: center; gap: 8px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #4fcfff;
}
.nge-beta-dot { width: 8px; height: 8px; border-radius: 50%; background: #4fcfff; box-shadow: 0 0 8px rgba(79, 207, 255, 0.9); }
.nge-beta-title {
  margin: 10px 0 12px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 19px; font-weight: 600; letter-spacing: 0.04em; line-height: 1.3;
  color: #fff;
}
.nge-beta-text { margin: 0 0 18px; font-size: 14px; line-height: 1.55; color: rgba(215, 230, 250, 0.85); }
.nge-beta-text--done { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-left: 2px solid #4fcfff; background: rgba(79, 207, 255, 0.08); border-radius: 0 8px 8px 0; }
.nge-beta-check { color: #7ee0ff; font-weight: 700; }
.nge-beta-label { display: block; margin-bottom: 6px; font-size: 13px; color: rgba(200, 220, 245, 0.85); }
.nge-beta-label span { color: rgba(200, 220, 245, 0.5); }
.nge-beta-note {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px;
  padding: 9px 11px; margin-bottom: 16px;
  font: 14px/1.45 'Inter', sans-serif; color: #e6f0ff;
  background: rgba(10, 20, 40, 0.9);
  border: 1px solid rgba(100, 200, 255, 0.28); border-radius: 6px;
}
.nge-beta-note:focus { outline: none; border-color: rgba(100, 200, 255, 0.7); box-shadow: 0 0 0 2px rgba(79, 207, 255, 0.15); }
.nge-beta-note::placeholder { color: rgba(190, 210, 240, 0.4); }
/* The one action, in the Dataset Stats button's voice, filled. */
.nge-beta-btn {
  width: 100%; height: 42px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #04121f;
  background: linear-gradient(180deg, #7ee0ff, #3fb6f0);
  border: 0;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  cursor: pointer;
  transition: filter 0.15s ease;
}
.nge-beta-btn:hover:not(:disabled), .nge-beta-btn:focus-visible { filter: brightness(1.12); outline: none; }
.nge-beta-btn:disabled { cursor: default; filter: saturate(0.5) brightness(0.8); }
.nge-beta-error { margin: 10px 0 0; font-size: 13px; color: #ff9a9a; }
.nge-beta-foot {
  margin: 20px 0 0; padding-top: 14px;
  border-top: 1px solid rgba(79, 207, 255, 0.15);
  font-size: 13px; color: rgba(200, 220, 245, 0.7);
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.nge-beta-foot a { color: #7ee0ff; text-decoration: none; }
.nge-beta-foot a:hover { text-decoration: underline; }
.nge-beta-sep { color: rgba(200, 220, 245, 0.35); }
.nge-beta-link { padding: 0; background: none; border: 0; font: inherit; color: rgba(200, 220, 245, 0.7); cursor: pointer; }
.nge-beta-link:hover { color: #fff; text-decoration: underline; }
</style>
