<script setup lang="ts">
/**
 * EyeWire Radio (Ames 2026-10-05): music while you proofread.
 *
 * A small control in the bottom right, where mute and volume traditionally
 * live. The speaker turns the station on and off; hovering (or focusing) it
 * opens restart, skip, the volume and the song's name.
 *
 * - The songs are served from Firebase Hosting (scripts/build-radio.mjs), not
 *   Supabase. Nothing is downloaded until the station is turned on.
 * - It never plays unasked. Off by default; your choice and your volume are
 *   remembered, and a station left on resumes on your first click of the next
 *   visit (browsers do not let a page start sound by itself).
 * - Off means paused, not silently streaming.
 * - It keeps clear of what else lives on that edge: a side panel or the
 *   leaderboard docked on the right, neuroglancer's status bar, the cut and
 *   merge bar, and the 3D view's own "Sections" tick box.
 */
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';

interface Track { id: string; title: string; file: string; duration: number }

const BASE = (() => {
  try { const o = localStorage.getItem('nge_radio_base'); if (o) return o.replace(/\/?$/, '/'); } catch { /* private mode */ }
  return 'https://eyewire-ii-e4d52.web.app/radio/';
})();
const PREF_KEY = 'nge_radio_v1';

const tracks = ref<Track[]>([]);
const current = ref<Track | null>(null);
const on = ref(false);            // what the listener asked for
const playing = ref(false);       // what the audio element is doing
const volume = ref(0.35);
const progress = ref(0);          // 0..1 through the song
const expanded = ref(false);
const loadError = ref(false);
const rootEl = ref<HTMLElement | null>(null);

let audio: HTMLAudioElement | null = null;
let queue: Track[] = [];          // songs still to come this lap
let opened = false;               // the opener has played this visit
let waitingForGesture = false;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    if (typeof p.volume === 'number') volume.value = Math.min(1, Math.max(0, p.volume));
    return p.on === true;
  } catch { return false; }
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ on: on.value, volume: volume.value })); } catch { /* private mode */ }
}

async function loadPlaylist(): Promise<boolean> {
  if (tracks.value.length) return true;
  try {
    const r = await fetch(BASE + 'playlist.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    tracks.value = (j.tracks || []).filter((t: any) => t && t.file && t.title);
    loadError.value = tracks.value.length === 0;
  } catch {
    loadError.value = true;
  }
  return tracks.value.length > 0;
}

/** The next song: the station's opener first, then every song once in a
 *  shuffled lap, never the same song twice in a row across laps. */
function nextTrack(): Track | null {
  const all = tracks.value;
  if (!all.length) return null;
  if (!opened) { opened = true; return all[0]; }
  if (!queue.length) {
    queue = all.slice();
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    if (queue.length > 1 && queue[0].id === current.value?.id) queue.push(queue.shift()!);
  }
  return queue.shift() || null;
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = volume.value;
  audio.addEventListener('ended', () => { void playNext(); });
  audio.addEventListener('playing', () => { playing.value = true; });
  audio.addEventListener('pause', () => { playing.value = false; });
  audio.addEventListener('timeupdate', () => { progress.value = audio && audio.duration ? audio.currentTime / audio.duration : 0; });
  // A song that will not load is skipped, but not in a tight loop.
  let errors = 0;
  audio.addEventListener('error', () => { if (on.value && ++errors <= tracks.value.length) setTimeout(() => { void playNext(); }, 800); });
  audio.addEventListener('playing', () => { errors = 0; });
  return audio;
}

async function playNext() {
  const t = nextTrack();
  if (!t) return;
  const a = ensureAudio();
  current.value = t;
  progress.value = 0;
  a.src = BASE + t.file;
  setMediaSession(t);
  await tryPlay();
}

async function tryPlay() {
  if (!audio) return;
  try {
    await audio.play();
    waitingForGesture = false;
  } catch {
    // Not allowed to start sound yet: begin on the next click or key anywhere.
    if (!waitingForGesture) {
      waitingForGesture = true;
      const go = () => {
        window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true);
        waitingForGesture = false;
        if (on.value) void audio?.play().catch(() => {});
      };
      window.addEventListener('pointerdown', go, true); window.addEventListener('keydown', go, true);
    }
  }
}

async function turnOn() {
  on.value = true; savePrefs();
  if (!(await loadPlaylist())) { on.value = false; return; }
  if (!on.value) return;
  if (audio && current.value) await tryPlay(); else await playNext();
}
function turnOff() {
  on.value = false; savePrefs();
  audio?.pause();
}
function toggle() { if (on.value) turnOff(); else void turnOn(); }
function skip() { if (!on.value) { void turnOn(); return; } void playNext(); }
function restart() {
  if (!audio || !current.value) { void turnOn(); return; }
  audio.currentTime = 0;
  if (on.value) void tryPlay();
}
function onVolume(e: Event) {
  volume.value = Number((e.target as HTMLInputElement).value);
  if (audio) audio.volume = volume.value;
  savePrefs();
  // dragging the volume up from silence is asking for music
  if (!on.value && volume.value > 0) void turnOn();
}

function setMediaSession(t: Track) {
  const ms = (navigator as any).mediaSession;
  if (!ms) return;
  try {
    ms.metadata = new (window as any).MediaMetadata({ title: t.title, artist: 'EyeWire Radio', album: 'EyeWire II' });
    ms.setActionHandler('nexttrack', () => skip());
    ms.setActionHandler('previoustrack', () => restart());
    ms.setActionHandler('play', () => { void turnOn(); });
    ms.setActionHandler('pause', () => turnOff());
  } catch { /* older browsers */ }
}

const level = computed(() => !on.value ? 'off' : volume.value === 0 ? 'zero' : volume.value < 0.5 ? 'low' : 'high');
const label = computed(() => on.value
  ? `EyeWire Radio is on${current.value ? `: ${current.value.title}` : ''}. Click to turn the music off.`
  : 'EyeWire Radio: click for music while you work');

// ── Keeping clear of the rest of the bottom right ──────────────────────────
// Anything docked against the right edge and reaching the bottom (a layer
// side panel, the leaderboard) pushes the control to its left.
const dock = ref(0);
let dockTimer = 0;
const DOCKED = ['.neuroglancer-side-panel-column', '.neuroglancer-side-panel', '#nge-lb-modal .nge-overlay', '.nge-lb-modal .nge-overlay'];
function measureDock() {
  const W = window.innerWidth, H = window.innerHeight;
  let d = 0;
  for (const sel of DOCKED) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 80 || r.width > W * 0.7) continue;
      if (r.right >= W - 6 && r.bottom >= H - 70 && r.left > W * 0.3) d = Math.max(d, Math.round(W - r.left));
    }
  }
  if (d !== dock.value) dock.value = d;
}

// The tray opens on hover, or when the keyboard lands on it. A mouse click
// leaves focus on the button, which must not hold the tray open after the
// pointer has gone.
let hovering = false;
const keyboardInside = () => !!rootEl.value?.querySelector(':focus-visible');
function onLeave() { hovering = false; if (!keyboardInside()) expanded.value = false; }
function onFocusIn() { if (keyboardInside()) expanded.value = true; }
function onFocusOut() { setTimeout(() => { if (!hovering && !rootEl.value?.contains(document.activeElement)) expanded.value = false; }, 0); }
function onDocDown(e: Event) { if (expanded.value && !rootEl.value?.contains(e.target as Node)) expanded.value = false; }

onMounted(() => {
  const wasOn = loadPrefs();
  measureDock();
  dockTimer = window.setInterval(measureDock, 350);
  window.addEventListener('resize', measureDock);
  document.addEventListener('pointerdown', onDocDown, true);
  // Left on last time: pick the station back up (on the first click, if the
  // browser wants one before any sound).
  if (wasOn) void turnOn();
});
onUnmounted(() => {
  clearInterval(dockTimer);
  window.removeEventListener('resize', measureDock);
  document.removeEventListener('pointerdown', onDocDown, true);
  audio?.pause(); audio = null;
});
watch(volume, v => { if (audio) audio.volume = v; });
</script>

<template>
  <Teleport to="body">
    <div ref="rootEl" class="nge-radio" :class="{ 'nge-radio--on': on, 'nge-radio--playing': playing, 'nge-radio--open': expanded, 'holo-on': expanded }"
         :style="{ '--nge-radio-dock': dock + 'px' }"
         @pointerenter="hovering = true; expanded = true" @pointerleave="onLeave" @focusin="onFocusIn" @focusout="onFocusOut"
         @keydown.esc="expanded = false">
      <div class="nge-radio-tray" :aria-hidden="!expanded">
        <div class="nge-radio-now">
          <span class="nge-radio-kicker">EyeWire Radio</span>
          <span class="nge-radio-title" :title="current?.title">{{ loadError ? 'The station is off the air' : current ? current.title : 'Music while you work' }}</span>
        </div>
        <button class="nge-radio-btn" :tabindex="expanded ? 0 : -1" title="Start this song again" aria-label="Start this song again" @click="restart">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 2.6v2.7h2.7"/></svg>
        </button>
        <button class="nge-radio-btn" :tabindex="expanded ? 0 : -1" title="Skip to the next song" aria-label="Skip to the next song" @click="skip">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3 3.4v9.2a.5.5 0 0 0 .8.4L10 8.4a.5.5 0 0 0 0-.8L3.800 3a.5.5 0 0 0-.8.4z"/><rect x="11.300" y="3" width="1.700" height="10" rx=".6"/></svg>
        </button>
        <input class="nge-radio-vol" type="range" min="0" max="1" step="0.01" :value="volume" :tabindex="expanded ? 0 : -1"
               :style="{ '--v': Math.round(volume * 100) + '%' }" aria-label="Music volume" title="Volume" @input="onVolume" />
      </div>
      <button class="nge-radio-main" :title="label" :aria-label="label" :aria-pressed="on" @click="toggle">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.200 7.700h2.500l3.600-3v10.600l-3.600-3H3.200z" fill="currentColor" fill-opacity=".18"/>
          <template v-if="level === 'off' || level === 'zero'"><path d="M12.600 7.800l4 4.400M16.600 7.800l-4 4.400"/></template>
          <template v-else>
            <path class="nge-radio-wave nge-radio-wave--1" d="M12.200 7.600a3.400 3.400 0 0 1 0 4.800"/>
            <path v-if="level === 'high'" class="nge-radio-wave nge-radio-wave--2" d="M14.300 5.600a6.200 6.200 0 0 1 0 8.800"/>
          </template>
        </svg>
        <span class="nge-radio-progress" aria-hidden="true"><i :style="{ transform: `scaleX(${progress})` }"></i></span>
      </button>
    </div>
  </Teleport>
</template>

<style>
.nge-radio {
  position: fixed;
  /* Left of anything docked on the right edge; above the 3D view's "Sections"
     tick box, neuroglancer's status bar, and the cut and merge bar. */
  right: calc(8px + var(--nge-radio-dock, 0px));
  bottom: calc(34px + var(--nge-bottom-bar, 0px));
  z-index: 900;
  display: flex;
  align-items: center;
  height: 32px;
  border-radius: 8px;
  background: rgba(6, 12, 24, 0.82);
  border: 1px solid rgba(100, 180, 255, 0.16);
  color: #8797ad;
  font-family: 'Inter', 'Roboto', sans-serif;
  transition: right 0.25s ease, bottom 0.25s ease, border-color 0.2s ease, background 0.2s ease;
  user-select: none;
}
body.nge-tool-bar-open .nge-radio { bottom: calc(34px + var(--nge-tool-bar-h, 66px) + var(--nge-bottom-bar, 0px)); }
/* Behind any full-screen window, like the chat. */
body:has(.nge-overlay-blocker) .nge-radio { z-index: 140; }
body.nge-mobile .nge-radio { display: none; }
.nge-radio--open { border-color: rgba(100, 180, 255, 0.4); background: rgba(8, 14, 28, 0.95); }
.nge-radio--on { color: #a9bdd6; }

.nge-radio-main {
  position: relative;
  flex: none;
  width: 32px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  padding: 0; border: 0; border-radius: 7px;
  background: none; color: inherit; cursor: pointer;
  transition: color 0.15s ease;
}
.nge-radio-main:hover, .nge-radio-main:focus-visible { color: #dcebfb; outline: none; }
/* the waves breathe while a song is actually sounding */
.nge-radio--playing .nge-radio-wave { animation: nge-radio-wave 1.8s ease-in-out infinite; }
.nge-radio--playing .nge-radio-wave--2 { animation-delay: 0.3s; }
@keyframes nge-radio-wave { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
/* how far through the song, as a hairline under the speaker */
.nge-radio-progress { position: absolute; left: 6px; right: 6px; bottom: 3px; height: 1.5px; border-radius: 1px; background: rgba(100, 180, 255, 0.14); overflow: hidden; opacity: 0; transition: opacity 0.2s ease; }
.nge-radio--on .nge-radio-progress { opacity: 1; }
.nge-radio-progress > i { display: block; height: 100%; background: #4fcfff; transform-origin: 0 50%; }

/* The tray opens to the left of the speaker, so the speaker never moves. */
.nge-radio-tray {
  display: flex; align-items: center; gap: 4px;
  max-width: 0; opacity: 0; overflow: hidden;
  padding-left: 0;
  transition: max-width 0.28s cubic-bezier(.16, 1, .3, 1), opacity 0.18s ease, padding 0.28s ease;
}
.nge-radio--open .nge-radio-tray { max-width: 320px; opacity: 1; padding-left: 10px; }
.nge-radio-now { display: flex; flex-direction: column; min-width: 0; width: 132px; line-height: 1.15; margin-right: 4px; }
.nge-radio-kicker { font: 600 8.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #4fcfff; white-space: nowrap; }
.nge-radio-title { font-size: 12px; font-weight: 500; color: #dce9fb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-radio-btn {
  flex: none; width: 26px; height: 26px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 6px; background: none; color: #9fb1c8; cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.nge-radio-btn:hover, .nge-radio-btn:focus-visible { color: #e6f3ff; background: rgba(79, 207, 255, 0.1); border-color: rgba(79, 207, 255, 0.35); outline: none; }
.nge-radio-btn:active { transform: scale(0.9); }
.nge-radio-vol {
  flex: none; width: 76px; height: 16px; margin: 0 4px 0 2px; padding: 0;
  -webkit-appearance: none; appearance: none; background: none; cursor: pointer;
}
.nge-radio-vol::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: linear-gradient(90deg, #4fcfff var(--v), rgba(100, 180, 255, 0.2) var(--v)); }
.nge-radio-vol::-moz-range-track { height: 3px; border-radius: 2px; background: rgba(100, 180, 255, 0.2); }
.nge-radio-vol::-moz-range-progress { height: 3px; border-radius: 2px; background: #4fcfff; }
.nge-radio-vol::-webkit-slider-thumb { -webkit-appearance: none; width: 11px; height: 11px; margin-top: -4px; border-radius: 50%; background: #dff3ff; border: 0; box-shadow: 0 0 6px rgba(79, 207, 255, 0.7); }
.nge-radio-vol::-moz-range-thumb { width: 11px; height: 11px; border-radius: 50%; background: #dff3ff; border: 0; box-shadow: 0 0 6px rgba(79, 207, 255, 0.7); }
.nge-radio-vol:focus-visible { outline: 1px solid rgba(79, 207, 255, 0.6); outline-offset: 3px; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .nge-radio, .nge-radio-tray { transition: none; }
  .nge-radio--playing .nge-radio-wave { animation: none; }
}
</style>
