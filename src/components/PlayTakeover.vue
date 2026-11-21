<script setup lang="ts">
/**
 * A notification that fills the screen and takes the player straight to a
 * mode (Ames 2026-11-20, the Lost Fragments notification: "I want this to be
 * a full screen notification you click [and] it takes you to lost frags").
 *
 * Any unread notification with a picture and a play link in its body,
 * "[Play Lost Fragments](#nge-play=lost-fragments)", opens like this once,
 * by itself, when the player arrives. Clicking the picture or the button
 * plays; closing it marks it read. It stays in the bell like any other.
 * Without edit access on Retina it says so and points to the access form.
 */
import { computed, ref, watch } from 'vue';
import { takeTurn } from '../util/popup_queue';
import { useProofreadingBackendStore } from '../store';
import { startPlay, canQuest, settleAccess } from '../util/play';
import { flyNurroAcross } from '../util/nurro_fly';

const backend = useProofreadingBackendStore();
const PLAY_LINK = '#nge-play=lost-fragments';
const SHOWN_KEY = 'nge-takeover-shown-v1';
function shownIds(): number[] {
  try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]'); } catch { return []; }
}
function markShown(id: number) {
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...new Set([...shownIds(), id])].slice(-50))); } catch { /* private window */ }
}

const current = ref<any | null>(null);
const blocked = ref(false);
const busy = ref(false);

/** The newest unread one, not shown in this browser yet. */
const waiting = computed(() => {
  const seen = new Set(shownIds());
  return (backend.notifications as any[]).find(n => n && n.id != null && (n.image_url || n.thumbnail_url)
    && String(n.body || '').includes(PLAY_LINK) && !backend.notifRead(n) && !seen.has(n.id)) || null;
});
// One popup at a time (popup_queue.ts): it waits for its turn.
let queued: any = null;
watch(waiting, n => {
  if (!n || current.value || queued) return;
  queued = n;
  void takeTurn('play-takeover', () => current.value === n || (current.value?.id != null && current.value.id === n.id)).then(ok => {
    queued = null;
    if (ok && !current.value && waiting.value?.id === n.id) { current.value = n; blocked.value = false; markShown(n.id); }
  });
}, { immediate: true });

/** The words above the button: the body without its play link line. */
const words = computed(() => String(current.value?.body || '')
  .split('\n').filter(l => !l.includes(PLAY_LINK)).join('\n').trim());
const paragraphs = computed(() => words.value.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean));

function close() {
  if (current.value) backend.markNotificationRead(current.value.id);
  current.value = null;
}
async function play() {
  if (!current.value || busy.value) return;
  busy.value = true;
  try {
    if (!canQuest()) await settleAccess().catch(() => undefined);
    if (!canQuest()) { blocked.value = true; return; }
    close();
    void flyNurroAcross();
    void startPlay('fragments');
  } finally { busy.value = false; }
}
function openAccessForm() {
  close();
  document.dispatchEvent(new CustomEvent('nge:access-open'));
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && current.value) { e.stopPropagation(); close(); } }
watch(current, c => {
  if (c) window.addEventListener('keydown', onKey, true); else window.removeEventListener('keydown', onKey, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-tk">
      <div v-if="current" class="nge-tk" role="dialog" aria-modal="true" :aria-label="current.title" @click.self="close">
        <button class="nge-tk-close" aria-label="Close" title="Close" @click="close">
          <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="nge-tk-inner">
          <button class="nge-tk-picture" :title="'Play Lost Fragments'" @click="play">
            <img :src="current.image_url || current.thumbnail_url" :alt="current.title" />
          </button>
          <div class="nge-tk-text">
            <h2 class="nge-tk-title">{{ current.title }}</h2>
            <p v-for="(p, i) in paragraphs" :key="i" class="nge-tk-p">{{ p }}</p>
          </div>
          <div v-if="blocked" class="nge-tk-blocked" role="alert">
            <b>Lost Fragments is open to players with edit access on Retina.</b>
            <span>To get it, send your test edits through the Dataset Access form. A reviewer checks them, and Retina opens for you.</span>
            <div class="nge-tk-row">
              <button class="nge-tk-go" @click="openAccessForm">Open the access form</button>
              <button class="nge-tk-later" @click="close">Not now</button>
            </div>
          </div>
          <div v-else class="nge-tk-row">
            <button class="nge-tk-play" :disabled="busy" @click="play">
              <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" fill="currentColor"/></svg>
              Play Lost Fragments
            </button>
            <button class="nge-tk-later" @click="close">Later</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nge-tk { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 24px 16px; box-sizing: border-box;
  background: radial-gradient(ellipse at 50% 40%, rgba(10, 24, 54, 0.88), rgba(2, 5, 14, 0.96)); backdrop-filter: blur(6px); overflow-y: auto; }
.nge-tk-inner { width: min(1100px, 100%); display: flex; flex-direction: column; align-items: center; gap: 18px; }
.nge-tk-picture { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; line-height: 0;
  filter: drop-shadow(0 0 40px rgba(74, 158, 255, 0.35)); transition: transform 0.25s ease, filter 0.25s ease; }
.nge-tk-picture:hover { transform: scale(1.01); filter: drop-shadow(0 0 56px rgba(110, 200, 255, 0.55)); }
.nge-tk-picture img { width: 100%; max-height: 62vh; object-fit: contain; }
.nge-tk-text { width: min(860px, 100%); text-align: center; color: #cfe4fa; }
.nge-tk-title { margin: 0 0 10px; font: 700 26px/1.25 'Orbitron', Inter, sans-serif; letter-spacing: 0.03em; color: #fff; text-shadow: 0 0 16px rgba(126, 210, 255, 0.5); }
.nge-tk-p { margin: 0 0 8px; font: 400 16px/1.55 Inter, system-ui, sans-serif; }
.nge-tk-row { display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap; }
.nge-tk-play { display: inline-flex; align-items: center; gap: 10px; padding: 14px 30px; border-radius: 12px; border: 1px solid rgba(255, 211, 90, 0.85);
  background: linear-gradient(180deg, #ffd35a, #e6a91f); color: #1a1203; font: 700 18px/1 Inter, system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 0 0 4px rgba(255, 211, 90, 0.15), 0 8px 30px rgba(255, 190, 40, 0.45); transition: transform 0.15s ease; }
.nge-tk-play:hover:not(:disabled) { transform: translateY(-2px); }
.nge-tk-later { padding: 12px 18px; border-radius: 10px; border: 1px solid rgba(127, 190, 255, 0.3); background: transparent; color: #a9c3e0; font: 500 15px Inter, sans-serif; cursor: pointer; }
.nge-tk-later:hover { color: #fff; border-color: rgba(143, 214, 255, 0.7); }
.nge-tk-close { position: fixed; top: 18px; right: 18px; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%;
  border: 1px solid rgba(127, 190, 255, 0.4); background: rgba(8, 16, 34, 0.8); color: #cfe4fa; cursor: pointer; z-index: 1; }
.nge-tk-close:hover { color: #fff; border-color: rgba(143, 214, 255, 0.8); }
.nge-tk-blocked { width: min(640px, 100%); display: flex; flex-direction: column; gap: 6px; padding: 16px 18px; border-radius: 12px;
  border: 1px solid rgba(126, 202, 255, 0.5); background: rgba(74, 158, 255, 0.12); color: #cfe4fa; font: 400 15px/1.5 Inter, sans-serif; text-align: center; }
.nge-tk-blocked b { color: #fff; }
.nge-tk-go { padding: 10px 18px; border-radius: 10px; border: 1px solid rgba(143, 214, 255, 0.75); background: rgba(74, 158, 255, 0.28); color: #fff; font: 600 15px Inter, sans-serif; cursor: pointer; }
.nge-tk-enter-active { transition: opacity 0.4s ease; }
.nge-tk-enter-active .nge-tk-picture { animation: nge-tk-in 700ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.nge-tk-leave-active { transition: opacity 0.25s ease; }
.nge-tk-enter-from, .nge-tk-leave-to { opacity: 0; }
@keyframes nge-tk-in { 0% { opacity: 0; transform: scale(0.94); filter: blur(10px) brightness(2); } 100% { opacity: 1; transform: none; filter: none; } }
@media (max-width: 600px) { .nge-tk-title { font-size: 20px; } .nge-tk-p { font-size: 14px; } }
</style>
