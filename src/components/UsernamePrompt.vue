<script setup lang="ts">
/**
 * UsernamePrompt.vue — "Reserve your username"
 *
 * Shown once, after the user finishes Tutorial 1. Deliberately NOT at login:
 * that's already a multi-step middleauth flow, and asking before the user has
 * seen chat means asking before they know what a username is for. By the end of
 * the tutorial they've seen the community side of the app, so the ask lands.
 *
 * Dismissing is permanent — if they X out we never ask again (the field stays
 * available in Settings). Nothing breaks without one: chat falls back to the
 * display name, they're just harder to @mention.
 */
import { ref } from 'vue';
import { useProofreadingBackendStore } from '../store';

const backend = useProofreadingBackendStore();

/** Set once the user dismisses, so the prompt never returns. */
const DISMISS_KEY = 'nge_username_prompt_dismissed_v1';

const visible = ref(false);
const value = ref('');
const error = ref('');
const ok = ref('');
const checking = ref(false);
const saving = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

/** Open the prompt, unless the user already has a handle or waved it away. */
async function maybeOpen() {
  if (visible.value) return;
  if (backend.username) return;                              // already has one
  if (localStorage.getItem(DISMISS_KEY) === '1') return;     // asked and declined
  if (!backend.userId) return;                               // not signed in yet
  visible.value = true;
  // Pre-fill something we've already confirmed is free, so the common path is
  // a single click.
  try { value.value = await backend.suggestUsername(); } catch { /* leave blank */ }
}

function dismiss() {
  visible.value = false;
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
}

function onInput() {
  error.value = '';
  ok.value = '';
  if (timer) clearTimeout(timer);
  const v = value.value.trim();
  if (!v) return;
  const invalid = backend.validateUsername(v);
  if (invalid) { error.value = invalid; return; }
  checking.value = true;
  timer = setTimeout(async () => {
    try {
      const free = await backend.isUsernameAvailable(v);
      if (value.value.trim() !== v) return;     // typed on since
      if (free) ok.value = 'Available';
      else error.value = 'That username is taken.';
    } finally { checking.value = false; }
  }, 400);
}

async function reserve() {
  const v = value.value.trim();
  saving.value = true;
  error.value = '';
  try {
    await backend.saveUsername(v);
    // Reserving counts as answering, so don't ask again either way.
    localStorage.setItem(DISMISS_KEY, '1');
    visible.value = false;
  } catch (e: any) {
    error.value = e?.message || 'Could not save that username.';
  } finally {
    saving.value = false;
  }
}

// Tutorial 1 completion fires this.
document.addEventListener('nge:prompt-username', maybeOpen as EventListener);
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-un">
      <div v-if="visible" class="nge-un-backdrop" @click.self="dismiss">
        <div class="nge-un-modal">
          <button class="nge-un-x" @click="dismiss" title="Not now">×</button>
          <div class="nge-un-title">Reserve your username</div>
          <p class="nge-un-sub">
            This is how you'll appear in chat, and how teammates tag you:
            <strong>@{{ value || 'yourname' }}</strong>
          </p>

          <div class="nge-un-row">
            <span class="nge-un-at">@</span>
            <input
              v-model="value"
              class="nge-un-input"
              maxlength="20"
              spellcheck="false"
              autocomplete="off"
              placeholder="yourname"
              @input="onInput"
              @keydown.enter="reserve"
              @keydown.stop
            />
          </div>

          <div class="nge-un-note" :class="{ 'nge-un-note--err': error, 'nge-un-note--ok': ok && !error }">
            <span v-if="checking">Checking…</span>
            <span v-else-if="error">{{ error }}</span>
            <span v-else-if="ok">{{ ok }}</span>
            <span v-else>3-20 characters. Letters, numbers and underscore.</span>
          </div>

          <div class="nge-un-actions">
            <button
              class="nge-un-save"
              :disabled="saving || !!error || !value.trim()"
              @click="reserve"
            >{{ saving ? 'Reserving…' : 'Reserve it' }}</button>
            <button class="nge-un-later" @click="dismiss">Not now</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nge-un-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(0, 12, 30, 0.82), rgba(0, 0, 0, 0.92));
  backdrop-filter: blur(6px) saturate(1.2);
}
.nge-un-modal {
  position: relative;
  width: 380px;
  max-width: calc(100vw - 32px);
  padding: 22px 24px 20px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.97), rgba(8, 12, 24, 0.96));
  border: 1px solid rgba(74, 158, 255, 0.22);
  box-shadow: 0 0 60px rgba(0, 150, 255, 0.08), 0 16px 48px rgba(0, 0, 0, 0.5);
  font-family: 'Inter', system-ui, sans-serif;
}
.nge-un-x {
  position: absolute;
  top: 10px; right: 12px;
  background: none; border: none;
  color: rgba(150, 175, 215, 0.6);
  font-size: 1.3em; cursor: pointer;
}
.nge-un-x:hover { color: #cfdcef; }
.nge-un-title {
  font-size: 1.15em;
  font-weight: 600;
  color: #e0ecff;
  margin-bottom: 6px;
}
.nge-un-sub {
  font-size: 0.85em;
  line-height: 1.5;
  color: #8b9bb4;
  margin: 0 0 14px;
}
.nge-un-sub strong { color: #9db8ff; font-weight: 600; }
.nge-un-row {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  overflow: hidden;
}
.nge-un-row:focus-within { border-color: rgba(74, 158, 255, 0.5); }
.nge-un-at {
  padding: 0 2px 0 12px;
  color: rgba(150, 175, 215, 0.8);
  font-family: 'Consolas', 'Monaco', monospace;
}
.nge-un-input {
  flex: 1;
  background: none; border: none; outline: none;
  color: #e0e0e0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.95em;
  padding: 10px 12px 10px 2px;
}
.nge-un-note {
  margin-top: 7px;
  min-height: 16px;
  font-size: 0.76em;
  color: #6f7a8d;
}
.nge-un-note--err { color: #ff9b9b; }
.nge-un-note--ok { color: #7fe0a8; }
.nge-un-actions { display: flex; gap: 8px; margin-top: 16px; }
.nge-un-save {
  flex: 1;
  padding: 9px 0;
  border-radius: 8px;
  border: 1px solid rgba(74, 158, 255, 0.5);
  background: rgba(74, 158, 255, 0.18);
  color: #dbe9ff;
  font-weight: 600;
  font-size: 0.9em;
  cursor: pointer;
}
.nge-un-save:hover:not(:disabled) { background: rgba(74, 158, 255, 0.3); }
.nge-un-save:disabled { opacity: 0.45; cursor: default; }
.nge-un-later {
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: none;
  color: #99a3b5;
  font-size: 0.9em;
  cursor: pointer;
}
.nge-un-later:hover { background: rgba(255, 255, 255, 0.06); color: #cfd6e6; }

.nge-un-enter-active, .nge-un-leave-active { transition: opacity 0.22s ease; }
.nge-un-enter-from, .nge-un-leave-to { opacity: 0; }
</style>
