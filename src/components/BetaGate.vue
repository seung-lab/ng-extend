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
import { betaGate } from '../beta_gate';

const SUPPORT = 'support@eyewire.ai';
const backend = useProofreadingBackendStore();
const login = useLoginStore();

const show = ref(false);
const requested = ref(false);
// Name and email (Ames 2026-10-24: "It should just ask for their name and
// email", "and we can have an optional note"), filled in from the sign in.
const name = ref('');
const email = ref('');
const note = ref('');
// Both optional (Ames 2026-10-26: "eyewire username, Eyewire rank").
const ewName = ref('');
const ewRank = ref('');
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
      if (!name.value) name.value = backend.userName || login.sessions[0]?.name || '';
      if (!email.value) email.value = login.sessions[0]?.email || '';
      show.value = true;
      betaGate.value = 'out';
      setTimeout(() => { if (panelEl.value) runPanelTrace(panelEl.value); }, 80);
    } else {
      show.value = false;
      betaGate.value = 'in';
    }
  } catch { askedFor = ''; betaGate.value = 'in'; /* fail open; asked again on the next sign in */ }
}
watch(() => backend.userId, id => { if (id) void check(id); else { show.value = false; askedFor = ''; betaGate.value = 'unknown'; } }, { immediate: true });

// The same checks as the server (functions/access-request.js), so a typo is
// caught here; the server checks again and is the one that counts.
const NAME_OK = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const EMAIL_OK = /^[^\s@<>()\[\],;:"]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const EW_NAME_OK = /^[A-Za-z0-9_.\- ]+$/;
const EW_RANK_OK = /^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u;
function problem(): string {
  const n = name.value.trim(), e = email.value.trim();
  if (!n) return 'Please add your name.';
  if (!NAME_OK.test(n)) return 'Your name can have letters, spaces, periods, apostrophes and hyphens only.';
  if (!e) return 'Please add your email.';
  if (!EMAIL_OK.test(e)) return 'That email does not look right.';
  if (ewName.value.trim() && !EW_NAME_OK.test(ewName.value.trim())) return 'An EyeWire username has letters, numbers, dots, dashes and underscores only.';
  if (ewRank.value.trim() && !EW_RANK_OK.test(ewRank.value.trim())) return 'An EyeWire rank has letters, numbers and spaces only.';
  return '';
}
async function request() {
  if (sending.value) return;
  error.value = problem();
  if (error.value) return;
  sending.value = true;
  try {
    const r = await secureWrite<{ invited?: boolean; requested?: boolean }>('access.beta', {
      name: name.value.trim(), email: email.value.trim(), note: note.value.trim() || undefined,
      eyewireUsername: ewName.value.trim() || undefined, eyewireRank: ewRank.value.trim() || undefined });
    if (r?.invited) { show.value = false; betaGate.value = 'in'; return; }
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
  betaGate.value = 'unknown';
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
          <label class="nge-beta-label" for="nge-beta-name">Your name</label>
          <input id="nge-beta-name" v-model="name" class="nge-beta-field" type="text" maxlength="80" autocomplete="name" @input="error = ''" />
          <label class="nge-beta-label" for="nge-beta-email">Your email</label>
          <input id="nge-beta-email" v-model="email" class="nge-beta-field" type="email" maxlength="254" autocomplete="email" @input="error = ''" />
          <div class="nge-beta-pair">
            <div>
              <label class="nge-beta-label" for="nge-beta-ewname">EyeWire username <span>(optional)</span></label>
              <input id="nge-beta-ewname" v-model="ewName" class="nge-beta-field" type="text" maxlength="60" autocomplete="off" spellcheck="false" @input="error = ''" />
            </div>
            <div>
              <label class="nge-beta-label" for="nge-beta-ewrank">EyeWire rank <span>(optional)</span></label>
              <input id="nge-beta-ewrank" v-model="ewRank" class="nge-beta-field" type="text" maxlength="40" autocomplete="off" @input="error = ''" />
            </div>
          </div>
          <label class="nge-beta-label" for="nge-beta-note">Anything you'd like us to know? <span>(optional)</span></label>
          <textarea id="nge-beta-note" v-model="note" class="nge-beta-note" rows="2" maxlength="500"
                    placeholder="Where you heard about Pyr"></textarea>
          <button class="nge-beta-btn" :disabled="sending" @click="request">{{ sending ? 'Sending...' : 'Request beta access' }}</button>
          <p v-if="error" class="nge-beta-error" role="alert">{{ error }}</p>
        </template>
        <template v-else>
          <!-- Ames 2026-10-26: the thanks, the sign off, and things to do meanwhile. -->
          <div class="nge-beta-text nge-beta-text--done">
            <span class="nge-beta-check" aria-hidden="true">✓</span>
            <div>
              <p class="nge-beta-thanks">Thanks for requesting early access to map the brain! We'll let you know by email when you're in.</p>
              <p class="nge-beta-sign">The Pyr (pronounced "peer") team at Princeton University</p>
            </div>
          </div>
          <p class="nge-beta-label">While you wait</p>
          <ul class="nge-beta-links">
            <li><a href="https://eyewire.org" target="_blank" rel="noreferrer">Play EyeWire</a>, the original brain mapping game, right in your browser.</li>
            <li><a href="https://connectome.quest/learn.html" target="_blank" rel="noreferrer">Neuro 101</a>, a guided zoom from a whole brain down to a single neuron.</li>
            <li><a href="https://connectome.quest/atlas/" target="_blank" rel="noreferrer">Connectome 101</a>, what a connectome is and how scientists map one.</li>
            <li><a href="https://connectome.quest/videos.html" target="_blank" rel="noreferrer">Neuron videos</a>, animations of real neurons from mouse and fly brains.</li>
          </ul>
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
.nge-beta-thanks { margin: 0; }
.nge-beta-sign { margin: 8px 0 0; font-size: 13px; font-style: italic; color: rgba(200, 220, 245, 0.7); }
.nge-beta-links { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: rgba(215, 230, 250, 0.8); }
.nge-beta-links li { margin-bottom: 6px; }
.nge-beta-links a { color: #7ee0ff; text-decoration: none; }
.nge-beta-links a:hover, .nge-beta-links a:focus-visible { text-decoration: underline; }
.nge-beta-label { display: block; margin-bottom: 6px; font-size: 13px; color: rgba(200, 220, 245, 0.85); }
.nge-beta-label span { color: rgba(200, 220, 245, 0.5); }
.nge-beta-note, .nge-beta-field {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 52px;
  padding: 9px 11px; margin-bottom: 16px;
  font: 14px/1.45 'Inter', sans-serif; color: #e6f0ff;
  background: rgba(10, 20, 40, 0.9);
  border: 1px solid rgba(100, 200, 255, 0.28); border-radius: 6px;
}
.nge-beta-field { min-height: 0; height: 38px; resize: none; margin-bottom: 12px; }
.nge-beta-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 420px) { .nge-beta-pair { grid-template-columns: 1fr; gap: 0; } }
.nge-beta-note:focus, .nge-beta-field:focus { outline: none; border-color: rgba(100, 200, 255, 0.7); box-shadow: 0 0 0 2px rgba(79, 207, 255, 0.15); }
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
