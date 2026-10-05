<script setup lang="ts">
/**
 * TriagePage.vue
 * The triage board on its own, at "?triage=board": no viewer, no data, no
 * game (Ames 2026-10-05). main.ts mounts this instead of App when the address
 * asks for it. It is the Admin Hub's own Triage tab, so the cards, the
 * buttons and what they do are the same code.
 *
 * Who you are comes from the sign-in the game already saved in this browser
 * (the same token the game uses). The server decides what an admin may read
 * and change, exactly as in the game.
 */
import { ref, onMounted } from 'vue';
import AdminHub from 'components/AdminHub.vue';
import { useProofreadingBackendStore } from '../store';
import { caveToken } from '../secure_write';

const backend = useProofreadingBackendStore();
const state = ref<'checking' | 'ready' | 'signedOut'>('checking');
const gameUrl = `${window.location.origin}${window.location.pathname}`;

onMounted(async () => {
  document.title = 'EyeWire II · Triage';
  const token = caveToken();
  if (!token) { state.value = 'signedOut'; return; }
  // The name shown on your decisions ("approved · Amy Sterling").
  for (const url of ['https://global.daf-apis.com/auth/api/v1/user/me', 'https://minnie.microns-daf.com/auth/api/v1/user/me']) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const me = await r.json();
      if (me?.email) {
        backend.userEmail = String(me.email);
        backend.userName = String(me.name || me.email.split('@')[0]);
        break;
      }
    } catch { /* try the next server */ }
  }
  state.value = backend.userEmail ? 'ready' : 'signedOut';
});
</script>

<template>
  <div class="nge-triage-page">
    <AdminHub v-if="state === 'ready'" initial-sub-tab="triage" standalone />
    <div v-else class="nge-triage-page-msg">
      <template v-if="state === 'checking'">Opening the triage board…</template>
      <template v-else>
        <div class="nge-triage-page-title">Sign in to EyeWire II first</div>
        <div>The triage board uses the sign-in from the game in this browser.</div>
        <a class="nge-triage-page-link" :href="gameUrl">Open EyeWire II</a>
      </template>
    </div>
  </div>
</template>

<style scoped>
.nge-triage-page {
  position: fixed; inset: 0; background: #070b14; color: #dbe6f5;
  font-family: 'Inter', 'Roboto', system-ui, sans-serif; font-size: 14px;
}
.nge-triage-page-msg {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  color: #a9bbd3;
}
.nge-triage-page-title { font-size: 1.3em; font-weight: 700; color: #eef4ff; }
.nge-triage-page-link {
  margin-top: 6px; padding: 8px 18px; border-radius: 7px; text-decoration: none; font-weight: 600;
  color: #fff; background: rgba(90, 130, 255, 0.9); border: 1px solid rgba(120, 150, 255, 0.7);
}
</style>
