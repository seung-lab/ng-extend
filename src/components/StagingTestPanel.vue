<script setup lang="ts">
/**
 * Staging test (test sites only, never the live site): pretend to be a brand
 * new player and step through time, to see which top bar icons arrive when
 * (util/toolbar_staging.ts). The pretend player lives only in this browser;
 * nothing is saved to the account. Real tutorial steps reveal icons for the
 * pretend player too, so a tutorial can be played as a newcomer would.
 */
import { computed, nextTick, ref } from 'vue';
import { STAGE_MOMENTS, NEVER_AUTO, ALL_AUTO, simulating, simState, simHistory, setSimulating, resetSim, runMoment, simBack,
  simSnapshot, simRestore, announcement, checkTutorialWiring } from '../util/toolbar_staging';
import { getToolbarIconDef, DEFAULT_TOOLBAR_ORDER, resolveToolbarOrder } from '../data/toolbar-icons';
import { useUserPreferencesStore } from '../store';
import { steps as advancedSteps } from '../tutorial-2';
import { steps as mergeSteps } from '../tutorial-3';
import { steps as cutSteps } from '../tutorial-cut';
import { steps as sandboxSteps } from '../merger-sandbox';
import { steps as testSteps } from '../proofreading-test';

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
const nameOf = (id: string) => (def(id)?.label || id).split(' (')[0].split(':')[0];

// Each row shows only the icons it is the first to bring; the return days
// fill in whatever was skipped, so they mostly repeat rows above.
const newIcons: Record<string, string[]> = {};
{
  const seen = new Set(['notif']);
  for (const m of moments) {
    const icons = m.icons;
    newIcons[m.key] = icons.filter(id => !seen.has(id));
    icons.forEach(id => seen.add(id));
  }
}
const FILLS_IN = ['day2', 'day3', 'production'];

// ── The check: is staging still wired, and does the top bar follow it? ──
const STEPS: Record<number, any[]> = { 2: advancedSteps, 3: mergeSteps, 5: cutSteps, 9: sandboxSteps, 11: testSteps };
const checking = ref(false);
const results = ref<{ ok: boolean; text: string }[]>([]);
const problems = computed(() => results.value.filter(r => !r.ok).length);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runCheck() {
  if (checking.value) return;
  checking.value = true;
  const out: { ok: boolean; text: string }[] = [];
  const snap = simSnapshot();
  try {
    // 1. Every tutorial step that should bring an icon still does.
    for (const r of checkTutorialWiring(n => STEPS[n])) {
      out.push(r.step
        ? { ok: true, text: `${r.name}, step ${r.step} brings ${nameOf(r.icon)}` }
        : { ok: false, text: `${r.name}: no step brings ${nameOf(r.icon)} any more` });
    }
    // 2. Walk every moment and read the real top bar after each.
    const bar = () => new Set([...document.querySelectorAll<HTMLElement>('#extensionBar .nge-toolbar-icons [data-icon-id]')].map(b => b.dataset.iconId!));
    if (!document.querySelector('#extensionBar .nge-toolbar-icons')) {
      out.push({ ok: false, text: 'The top bar is not showing (sign in first), so it could not be read' });
    } else {
      const p = useUserPreferencesStore().prefs;
      const kept = resolveToolbarOrder(p.toolbarIcons, p.toolbarIconsInjected); // icons you have not turned off
      const expected = new Set(['notif']);
      const look = async (label: string, card?: string) => {
        await nextTick(); await wait(120);
        const shown = bar();
        const missing = [...expected].filter(id => kept.includes(id) && !shown.has(id));
        const early = [...shown].filter(id => !expected.has(id));
        const bad: string[] = [];
        if (missing.length) bad.push('missing ' + missing.map(nameOf).join(', '));
        if (early.length) bad.push('too early ' + early.map(nameOf).join(', '));
        if (card !== undefined && announcement.value?.text !== card) bad.push("Nurro's card did not show");
        out.push(bad.length ? { ok: false, text: `${label}: ${bad.join('; ')}` } : { ok: true, text: `${label}: top bar right` + (card ? ', Nurro spoke' : '') });
        announcement.value = null;
      };
      resetSim();
      await look('First visit');
      for (const m of moments) {
        const icons = m.key === 'production' ? ALL_AUTO : m.icons;
        const fresh = icons.filter(id => !expected.has(id));
        runMoment(m.key);
        icons.forEach(id => expected.add(id));
        await look(m.label, m.nurro && fresh.length ? m.nurro : undefined);
      }
      // 3. Back undoes the last moment.
      simBack();
      await look('Back after production access');
    }
  } catch (e: any) {
    out.push({ ok: false, text: 'The check stopped: ' + (e?.message || e) });
  } finally {
    simRestore(snap);
    results.value = out;
    checking.value = false;
  }
}

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
        <button id="nge-stt-check" class="nge-hud-btn nge-hud-btn--quiet" :disabled="checking" @click="runCheck">{{ checking ? 'Checking...' : 'Run the check' }}</button>
      </div>
      <div v-if="results.length" class="nge-stt-results" :class="problems ? 'nge-stt-results--bad' : 'nge-stt-results--ok'">
        <div class="nge-stt-verdict">{{ problems ? `${problems} problem${problems === 1 ? '' : 's'} found` : `All ${results.length} checks passed` }}</div>
        <ul>
          <li v-for="(r, i) in results" :key="i" :class="{ 'nge-stt-fail': !r.ok }"><span class="nge-stt-mark">{{ r.ok ? '✓' : '✗' }}</span>{{ r.text }}</li>
        </ul>
        <button class="nge-stt-step" @click="results = []">Hide</button>
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
          <span class="nge-stt-label">{{ m.label }}<span v-if="FILLS_IN.includes(m.key)" class="nge-stt-fill">and anything skipped so far</span></span>
          <span class="nge-stt-icons">
            <span v-for="id in newIcons[m.key]" :key="id" class="nge-stt-ic" :title="def(id)?.label" v-html="def(id)?.svg"></span>
          </span>
          <button v-if="!isDone(m.key)" class="nge-stt-step" @click="step(m.key)">Step</button>
        </li>
      </ol>

      <div class="nge-stt-sub">Still on the way ({{ waiting.length }})</div>
      <div class="nge-stt-icons nge-stt-waiting">
        <span v-for="id in waiting" :key="id" class="nge-stt-ic" :title="def(id)?.label" v-html="def(id)?.svg"></span>
        <span v-if="!waiting.length" class="nge-stt-none">Nothing. The top bar is complete.</span>
      </div>
      <p class="nge-stt-note">Dataset Stats and Batch never arrive by themselves; Settings turns them on. Playing a real tutorial step also brings its icon in. Run the check walks every moment on its own and puts your place back after. Finishing Get Started for real starts the Merge tutorial; the Step button only brings the icons.</p>
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
.nge-stt-fill { display: block; font-size: 11px; color: #9fb4d0; }
.nge-stt-results { border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.nge-stt-results--ok { border: 1px solid rgba(124, 255, 178, 0.5); background: rgba(124, 255, 178, 0.06); }
.nge-stt-results--bad { border: 1px solid rgba(255, 120, 120, 0.6); background: rgba(255, 120, 120, 0.08); }
.nge-stt-verdict { font-weight: 700; }
.nge-stt-results ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12px; max-height: 260px; overflow-y: auto; }
.nge-stt-results li { display: grid; grid-template-columns: 16px 1fr; gap: 6px; }
.nge-stt-fail { color: #ffb4b4; }
.nge-stt-fail .nge-stt-mark { color: #ff7878; }
.nge-stt-results .nge-stt-step { align-self: flex-start; }
</style>
