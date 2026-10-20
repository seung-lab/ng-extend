<script setup lang="ts">
/**
 * Staging test (test sites only, never the live site): pretend to be a brand
 * new player and step through time, to see which top bar icons arrive when
 * (util/toolbar_staging.ts). The pretend player lives only in this browser;
 * nothing is saved to the account. Real tutorial steps reveal icons for the
 * pretend player too, so a tutorial can be played as a newcomer would.
 */
import { computed, ref } from 'vue';
import { STAGE_MOMENTS, NEVER_AUTO, simulating, simState, simHistory, setSimulating, resetSim, runMoment, simBack } from '../util/toolbar_staging';
import { getToolbarIconDef, DEFAULT_TOOLBAR_ORDER } from '../data/toolbar-icons';

const OPEN_KEY = 'nge-staging-panel-open';
let wasOpen = true;
try { wasOpen = localStorage.getItem(OPEN_KEY) !== '0'; } catch { /* no storage */ }
const open = ref(wasOpen);
function setOpen(v: boolean) {
  open.value = v;
  try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* no storage */ }
}

const moments = STAGE_MOMENTS.filter(m => m.key !== 'start');
const isDone = (key: string) => {
  const m = STAGE_MOMENTS.find(x => x.key === key)!;
  return simState.done.includes(key) || m.icons.every(id => simState.revealed.includes(id));
};
const nextMoment = computed(() => moments.find(m => !isDone(m.key)) || null);
// Every icon the default top bar holds (screenshot is added after batch).
const ALL = [...DEFAULT_TOOLBAR_ORDER.slice(0, DEFAULT_TOOLBAR_ORDER.indexOf('batch') + 1), 'screenshot', ...DEFAULT_TOOLBAR_ORDER.slice(DEFAULT_TOOLBAR_ORDER.indexOf('batch') + 1)];
const waiting = computed(() => ALL.filter(id => !simState.revealed.includes(id) && !NEVER_AUTO.includes(id)));
const def = (id: string) => getToolbarIconDef(id);

function step(key: string) { runMoment(key); }
function stepNext() { if (nextMoment.value) runMoment(nextMoment.value.key); }
function startOver() { resetSim(); }
const lastStep = computed(() => simHistory.length ? simHistory[simHistory.length - 1].label : '');
function back() { simBack(); }
function toggleSim(e: Event) { setSimulating((e.target as HTMLInputElement).checked); }
</script>

<template>
  <button v-if="!open" class="ng-extend nge-stt-tab" @click="setOpen(true)" title="Staging test: step through a new player's first days">
    Staging test<span v-if="simulating" class="nge-stt-dot" aria-label="pretend new player is on"></span>
  </button>
  <aside v-else class="ng-extend nge-stt" aria-label="Staging test">
    <header class="nge-stt-head">
      <span class="nge-stt-title">Staging test</span>
      <button class="nge-stt-x" @click="setOpen(false)" title="Fold away" aria-label="Fold away">×</button>
    </header>
    <p class="nge-stt-note">Test site only. Pretend to be a brand new player and step through their first days. Nothing here is saved to your account.</p>
    <label class="nge-stt-switch">
      <input id="nge-stt-sim" type="checkbox" :checked="simulating" @change="toggleSim" />
      <span>Pretend I am a new player</span>
    </label>

    <template v-if="simulating">
      <div class="nge-stt-actions">
        <button class="nge-hud-btn nge-hud-btn--go" :disabled="!nextMoment" @click="stepNext">
          {{ nextMoment ? 'Next: ' + nextMoment.label : 'All moments done' }}
        </button>
        <button class="nge-hud-btn nge-hud-btn--quiet" :disabled="!lastStep" :title="lastStep ? 'Undo: ' + lastStep : 'Nothing to undo'" @click="back">‹ Back</button>
        <button class="nge-hud-btn nge-hud-btn--quiet" @click="startOver">Start over</button>
      </div>

      <p v-if="lastStep" class="nge-stt-note">Back undoes: {{ lastStep }}</p>
      <ol class="nge-stt-list">
        <li class="nge-stt-row nge-stt-row--done">
          <span class="nge-stt-mark">✓</span>
          <span class="nge-stt-label">First visit</span>
          <span class="nge-stt-icons"><span class="nge-stt-ic" v-html="def('notif')?.svg"></span></span>
        </li>
        <li v-for="m in moments" :key="m.key" class="nge-stt-row" :class="{ 'nge-stt-row--done': isDone(m.key) }">
          <span class="nge-stt-mark">{{ isDone(m.key) ? '✓' : '' }}</span>
          <span class="nge-stt-label">{{ m.label }}</span>
          <span class="nge-stt-icons">
            <span v-for="id in (m.key === 'production' ? ['batch'] : m.icons)" :key="id" class="nge-stt-ic" :title="def(id)?.label" v-html="def(id)?.svg"></span>
          </span>
          <button v-if="!isDone(m.key)" class="nge-stt-step" @click="step(m.key)">Step</button>
        </li>
      </ol>

      <div class="nge-stt-sub">Still on the way ({{ waiting.length }})</div>
      <div class="nge-stt-icons nge-stt-waiting">
        <span v-for="id in waiting" :key="id" class="nge-stt-ic" :title="def(id)?.label" v-html="def(id)?.svg"></span>
        <span v-if="!waiting.length" class="nge-stt-none">Nothing. The top bar is complete.</span>
      </div>
      <p class="nge-stt-note">Your Week and Dataset Stats never arrive by themselves; Settings turns them on. Playing a real tutorial step also brings its icon in. Finishing Get Started for real starts the Merge tutorial; the Step button only brings the icons.</p>
    </template>
  </aside>
</template>

<style scoped>
.nge-stt-tab {
  position: fixed; left: 12px; bottom: 56px; z-index: 9300;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 8px;
  border: 1px solid rgba(74, 150, 224, 0.45);
  background: rgba(8, 13, 24, 0.94); color: #cfe6ff;
  font: 600 12px 'Roboto', 'Inter', sans-serif; letter-spacing: 0.04em; cursor: pointer;
}
.nge-stt-tab:focus-visible, .nge-stt-x:focus-visible, .nge-stt-step:focus-visible { outline: 2px solid #7ecaff; outline-offset: 2px; }
.nge-stt-dot { width: 8px; height: 8px; border-radius: 50%; background: #7cffb2; }
.nge-stt {
  position: fixed; left: 12px; top: 58px; z-index: 9300;
  width: 300px; max-width: calc(100vw - 24px); max-height: calc(100vh - 120px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px 14px; border-radius: 10px;
  border: 1px solid rgba(74, 150, 224, 0.4);
  background: rgba(8, 13, 24, 0.96);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  color: rgba(226, 238, 251, 0.92);
  font: 13px/1.45 'Roboto', 'Inter', sans-serif;
}
.nge-stt-head { display: flex; align-items: center; justify-content: space-between; }
.nge-stt-title { font-family: 'Orbitron', 'Inter', sans-serif; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #7ecaff; }
.nge-stt-x { background: none; border: 0; color: #9fb4d0; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
.nge-stt-note { margin: 0; color: #9fb4d0; font-size: 12px; }
.nge-stt-switch { display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
.nge-stt-switch input { width: 16px; height: 16px; accent-color: #4a9eff; }
.nge-stt-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.nge-stt-actions .nge-hud-btn { white-space: normal; text-align: left; }
.nge-stt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nge-stt-row {
  display: grid; grid-template-columns: 16px 1fr auto auto; align-items: center; gap: 8px;
  padding: 5px 6px; border-radius: 6px;
}
.nge-stt-row:hover { background: rgba(126, 224, 255, 0.05); }
.nge-stt-row--done .nge-stt-label { color: #8aa0bd; }
.nge-stt-mark { color: #7cffb2; font-weight: 700; }
.nge-stt-label { min-width: 0; }
.nge-stt-icons { display: inline-flex; flex-wrap: wrap; gap: 4px; font-size: 15px; }
.nge-stt-ic { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; }
.nge-stt-step {
  border: 1px solid rgba(74, 150, 224, 0.5); background: rgba(74, 158, 255, 0.12);
  color: #cfe6ff; border-radius: 5px; padding: 2px 8px; font-size: 12px; cursor: pointer;
}
.nge-stt-step:hover { background: rgba(74, 158, 255, 0.25); }
.nge-stt-sub { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9fb4d0; margin-top: 4px; }
.nge-stt-waiting { gap: 6px; font-size: 17px; }
.nge-stt-waiting .nge-stt-ic { width: 22px; height: 22px; }
.nge-stt-none { font-size: 12px; color: #9fb4d0; }
</style>
