<script setup lang="ts">
/**
 * The Hunt box (Ames 2026-10-20, rules of play 2026-10-21): a narrow box at
 * the right, dragged by its header, opened from the Hunt pill in the top bar
 * or a Hunt notification. Before the start: the countdown and the instructions
 * (with the medals at their foot). While it runs: the Cut and Extend gems
 * (which layer Ctrl + Click drops into), what is found and what gems are left,
 * and each gem's answer as it lands (the burst on the spot is HuntGemFx.vue).
 * After the end: the congratulations. Made small, a slim strip with the same
 * main things (found, gems left, the gem switch, Submit). Logic in src/hunt.ts; rules on the
 * server (functions/hunts.js).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  huntState, loadHunts, featuredHunt, phaseNow, countdown, localTime, goToHunt, goToSoma, gemKinds, pickKind, huntPrefs, setAutoJudge, setHuntPanels, setHuntEdges, submitWaiting, takeBackGem, GEM_KEY, EDGE_COLOR,
  gemsOnScreen, startGemWatch, type HuntInfo, type HuntTier, type GemKind,
} from '../hunt';
import { canonicalDataset, currentDatasetTag, datasetAbbrev, findDatasetByCanonical, segLayerName } from '../datasets';
import { useDragBox } from '../util/drag_box';
import EditableText from './EditableText.vue';
import { snapshotPanel, morphIntoSlim, revealWithBeam } from '../util/panel_collapse';
import { renderSafeMarkdown } from '../util/safe_markdown';

const props = defineProps<{ huntId?: number | null; test?: boolean }>();
const emit = defineEmits<{ (e: 'hide'): void; (e: 'pick', id: number): void }>();
/** Several Hunts at once: a tab for each (running or coming), to switch the box between them. */
const otherHunts = computed(() => (props.test ? [] : huntState.hunts.filter(h => phaseNow(h) !== 'ended')));

// Ames 2026-10-21: "this box needs to be draggable". By its header; it remembers where it was put.
const boxEl = ref<HTMLElement | null>(null);
const { posStyle, dragging, startDrag } = useDragBox('nge-hunt-panel-pos', boxEl);

const busy = ref('');
const error = ref('');
const gems = ref(-1);

const hunt = computed<HuntInfo | null>(() => props.test ? huntState.test :
  props.huntId != null && props.huntId < 0 ? null :
  (props.huntId ? huntState.hunts.find(h => h.id === props.huntId) : null) ?? featuredHunt());
const phase = computed(() => (hunt.value ? phaseNow(hunt.value) : null));
const onDataset = computed(() => !!hunt.value && canonicalDataset(currentDatasetTag()) === canonicalDataset(hunt.value.dataset));
const datasetName = computed(() => {
  const ds = hunt.value ? findDatasetByCanonical(canonicalDataset(hunt.value.dataset)) : null;
  return ds ? datasetAbbrev(segLayerName(ds)) : (hunt.value?.dataset ?? '');
});
const where = computed(() => {
  const n = hunt.value?.cell_count ?? hunt.value?.cells.length ?? 0;
  return n > 1 ? `${n} cells` : 'one cell';
});
// What is hidden (Ames 2026-10-21): mergers (two cells joined, a cut fixes it) and
// missing extensions (a piece left off, a merge fixes it).
const spots = computed(() => hunt.value?.spots ?? { cut: hunt.value?.target_count ?? 0, merge: 0 });
const mergers = computed(() => {
  const { cut, merge } = spots.value;
  const c = cut === 1 ? '1 merger' : `${cut} mergers`;
  const m = merge === 1 ? '1 missing extension' : `${merge} missing extensions`;
  return !merge ? c : !cut ? m : `${c} and ${m}`;
});
/** With several cells, a button takes the player to each one's soma. */
const somaCells = computed(() => (hunt.value?.cells ?? []).filter(c => Array.isArray(c.soma) && c.soma.length === 3));
const isAre = computed(() => ((hunt.value?.target_count ?? 0) === 1 ? 'is' : 'are'));
const TIER_WORD: Record<HuntTier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const TIERS: HuntTier[] = ['gold', 'silver', 'bronze'];
const KIND: Record<GemKind, { word: string; finds: string; one: string }> = {
  cut: { word: 'Cut', finds: 'mergers', one: 'merger' },
  merge: { word: 'Extend', finds: 'missing extensions', one: 'missing extension' },
};

let gemTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  if (!huntState.loaded) void loadHunts();
  startGemWatch();
  gemTimer = setInterval(() => { if (hunt.value) gems.value = gemsOnScreen(hunt.value); }, 1000);
});
onUnmounted(() => { if (gemTimer) clearInterval(gemTimer); });

// A new hunt in the panel (or a switch between a test run and the real one) starts clean.
watch(() => `${hunt.value?.id ?? ''}:${hunt.value?.test ? 'test' : ''}`, () => { error.value = ''; });

async function go() {
  const h = hunt.value; if (!h || busy.value) return;
  busy.value = 'go'; error.value = '';
  try {
    const r = await goToHunt(h);
    if (r === 'ok') gems.value = gemsOnScreen(h);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

// ── While it runs: the gems ──
const kinds = computed<GemKind[]>(() => (hunt.value ? gemKinds(hunt.value) : ['cut']));
const opened = computed(() => onDataset.value && gems.value >= 0);
function choose(k: GemKind) {
  if (!hunt.value) return;
  pickKind(hunt.value, k);
  // The number keys work straight after a button: the keyboard goes back to the view.
  try { (document.querySelector('.neuroglancer-rendered-data-panel') as HTMLElement | null)?.focus(); } catch { /* optional */ }
}
/** "Ctrl + Click drops a cut gem, for mergers. Press 3 to switch to Cut." (Ames 2026-10-26: "add in tooltip that you can press 3 or 4"). */
function kindTitle(k: GemKind) {
  const key = huntState.keys[k];
  return `Ctrl + Click drops a ${KIND[k].word.toLowerCase()} gem, for ${KIND[k].finds}.${key ? ` Press ${key} to switch to ${KIND[k].word}.` : ''}`;
}
const run = computed(() => hunt.value?.you);
/** One pip per gem: gold while unused, gray once dropped (up to 30; beyond that, the number alone). */
const pips = computed(() => {
  const r = run.value; if (!r || !r.budget || r.budget > 30) return [];
  return Array.from({ length: r.budget }, (_, i) => i < r.gems_used);
});
/** The last gem's answer, fresh for a few seconds after it lands. */
const news = computed(() => {
  const n = huntState.news; const h = hunt.value;
  // The browser's own clock: n.at is too (huntState.now is the server's, which can differ).
  void huntState.now;   // ticks every second, so the card goes after its time
  if (!n || !h || Date.now() - n.at > 15000) return null;
  return n;
});
/** One answer in words (the big card for the newest, short lines for the ones before). */
function wordsFor(n: any) {
  if (n.result === 'hit') return { cls: 'hit', head: 'Got it!', text: n.kind === 'merge' ? 'A missing extension.' : 'A merger.', ext: n.kind === 'merge' };
  if (n.result === 'already') return { cls: 'already', head: 'Found already', text: 'You found that one before. No gem used.' };
  if (n.result === 'edge') return { cls: 'edge', head: 'Edge of the dataset', text: 'The branch leaves the data here. No gem used.' };
  if (n.result === 'refused') return { cls: 'refused', head: 'No gem dropped', text: n.text || '' };
  if (n.result === 'kept') return { cls: 'already', head: 'Checked gems stay', text: 'That gem is back. Once a gem is checked it stays on the cell.' };
  if (n.other) return { cls: 'miss', head: 'Wrong gem', text: `Something is there, but it needs ${n.other === 'merge' ? 'an extension' : 'a cut'}.` };
  return { cls: 'miss', head: 'Not there', text: 'No problem at that spot.' };
}
/** The answers before the newest, so a quick second gem never hides the first one's answer. */
const earlier = computed(() => {
  void huntState.now;
  return huntState.log.slice(1, 3).filter(n => Date.now() - n.at < 60000).map(n => ({ at: n.at, ...wordsFor(n) }));
});
/** Your clock: from your first open of the Hunt; it stops at your last find once you are done. */
const yourTime = computed(() => {
  void huntState.now;
  const r = run.value; if (!r || !r.started_at) return '';
  const msTime = r.done ? r.time_ms : Date.now() - Date.parse(r.started_at) - (huntState.offset || 0);
  if (msTime == null || !Number.isFinite(msTime) || msTime < 0) return '';
  const sec = Math.round(msTime / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(x).padStart(2, '0')}s`;
});
const newsLine = computed(() => {
  const n = news.value; if (!n) return null;
  if (n.result === 'hit') return { cls: 'hit', head: 'Got it!', text: n.kind === 'merge' ? 'A missing extension.' : 'A merger.', ext: n.kind === 'merge' };
  if (n.result === 'already') return { cls: 'already', head: 'Found already', text: 'You found that one before. No gem used.' };
  if (n.result === 'edge') return { cls: 'edge', head: 'Edge of the dataset', text: 'The branch leaves the data here. No gem used.' };
  if (n.result === 'refused') return { cls: 'refused', head: 'No gem dropped', text: n.text || '' };
  if (n.result === 'kept') return { cls: 'already', head: 'Checked gems stay', text: 'That gem is back. Once a gem is checked it stays on the cell.' };
  const w = wordsFor(n);
  const near = n.nearest_um != null && hunt.value?.test ? ` The nearest ${n.gem === 'merge' ? 'missing extension' : 'merger'} is ${n.nearest_um} µm away (tolerance ${hunt.value.tolerance_um} µm).` : '';
  return { ...w, text: w.text + near, other: n.other || null };
});
// Confetti when a run is done with everything found (once per run in this browser).
watch(() => [hunt.value?.id, run.value?.done, run.value?.found, run.value?.of] as const, ([id, done, found, of]) => {
  if (!id || !done || !of || found !== of) return;
  const key = `nge-hunt-allfound-${hunt.value?.test ? 'test-' : ''}${id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* still celebrate */ }
  setTimeout(() => document.dispatchEvent(new CustomEvent('nge:quest-confetti', { detail: {} })), 300);
});
/** Why a run is over: everything found, or every gem used. */
const doneWhy = computed(() => {
  const r = run.value; if (!r) return { head: '', text: '', short: '' };
  if (r.of && r.found >= r.of) return { head: 'All found!', text: `You found all ${r.of} with ${r.gems_used} ${r.gems_used === 1 ? 'gem' : 'gems'}. Your Hunt is complete.`, short: `with ${r.gems_used} ${r.gems_used === 1 ? 'gem' : 'gems'}` };
  return { head: 'Out of gems', text: `All ${r.budget} gems used, so your Hunt is complete.`, short: 'Hunt complete' };
});
const description = computed(() => (hunt.value?.description ? renderSafeMarkdown(hunt.value.description, true) : ''));

// ── The look (Ames 2026-10-21: "needs to fit better", "use badass scifi design") ──
/** The clock in the title row. */
const clock = computed(() => {
  const h = hunt.value; if (!h) return null;
  void huntState.now;
  if (h.test) return null;
  if (phase.value === 'announced') return { label: 'Starts in', value: countdown(h.start_at) };
  if (phase.value === 'live') return { label: 'Ends in', value: countdown(h.end_at) };
  return null;
});
/** How to play: open until the Hunt is open on screen, then folded; a click opens or folds it (Ames: "click to expand"). */
const howChoice = ref<boolean | null>(null);
const howOpen = computed(() => howChoice.value ?? !opened.value);
function toggleHow() { howChoice.value = !howOpen.value; }
/** Ames's own five lines (2026-10-21); admins can change them in the game (site text howto.hunt). */
const HUNT_STEPS = [
  'Ctrl + Click to drop a gem on a merger or missing extension',
  'The Hunt will let you know if you got it right or wrong, and how many Hunt problems and gems remain',
  'The Hunt finishes when you find all the problems or run out of gems',
  "You'll be awarded Gold, Silver or Bronze based on how many problems were found and how many gems were used",
  'Happy Hunting!',
];
/** A medal is a place (Ames 2026-10-21: "it's not one per person"): 1st, 2nd, 3rd. */
/** A medal's ask, short: "all 10 · ≤13 gems", "7+ found". */
function needShort(t: HuntTier): string {
  const h = hunt.value; if (!h) return '';
  const k = h.tiers?.[t] ?? 0;
  const finds = k >= h.target_count ? (h.target_count === 1 ? 'find it' : `all ${h.target_count}`) : `${k}+ found`;
  const g = h.gem_limits?.[t];
  return g ? `${finds} · ≤${g} gems` : finds;
}
/** Folded to a slim strip: found, gems left, the gem switch, Submit, the last answer (kept in this browser). */
const miniPref = ref((() => { try { return localStorage.getItem('nge-hunt-mini') === '1'; } catch { return false; } })());
/** The results always show in full (Ames 2026-10-22: "no slim view option on results"). */
const mini = computed(() => miniPref.value && phase.value !== 'ended');
function setMini(on: boolean) { miniPref.value = on; try { localStorage.setItem('nge-hunt-mini', on ? '1' : '0'); } catch { /* private window */ } }
/** The caret: the box zips up under a light bar into its slim form, and beams back open
 *  (Ames 2026-10-22: "use the cool minimize/expand animation light bar from cell library"). */
async function toggleMini() {
  const el = boxEl.value;
  if (!mini.value) {
    const ghost = el ? snapshotPanel(el) : null;
    setMini(true);
    await nextTick();
    if (ghost && el) morphIntoSlim(ghost, el, []);
  } else {
    const still = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (el && still) el.style.clipPath = 'inset(0 0 100% 0)';
    setMini(false);
    await nextTick();
    if (el) revealWithBeam(el);
  }
}
/** The check switch. */
function onAutoChange(e: Event) { setAutoJudge(!!(e.target as HTMLInputElement | null)?.checked); }
function onEdgesChange(e: Event) { setHuntEdges(!!(e.target as HTMLInputElement | null)?.checked); }
/** "5 mergers · 5 extensions · 2 cells · 15 gems" (Ames 2026-10-21: "too much text!"). */
const briefShort = computed(() => {
  const h = hunt.value; if (!h) return '';
  const { cut, merge } = spots.value;
  const bits = [];
  if (cut) bits.push(cut === 1 ? '1 merger' : `${cut} mergers`);
  if (merge) bits.push(merge === 1 ? '1 extension' : `${merge} extensions`);
  const n = h.cell_count ?? h.cells.length ?? 1;
  bits.push(n === 1 ? '1 cell' : `${n} cells`);
  if (phase.value !== 'ended') bits.push(`${h.budget} gems`);
  return bits.join(' · ');
});
const fastestShort = computed(() => (hunt.value?.fastest?.reason || '').replace(/, the fastest in .*$/, ''));
const medalArt = (t: HuntTier) => hunt.value?.prizes?.[t]?.image || `hunt/${t}-128.png`;

// ── The end ──
const myResult = computed(() => {
  const h = hunt.value; if (!h) return null;
  const y = h.you;
  if (!y.gems_used && !y.best) return null;
  return { tier: y.tier, found: y.found || y.best, of: h.target_count, gems: y.gems_used };
});
// Confetti once per hunt for a winner opening the ceremony.
watch(() => [hunt.value?.id, phase.value, hunt.value?.you.tier] as const, ([id, p, tier]) => {
  if (!id || p !== 'ended' || !tier || !hunt.value?.awarded) return;
  const key = `nge-hunt-ceremony-${id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  setTimeout(() => document.dispatchEvent(new CustomEvent('nge:quest-confetti', { detail: {} })), 400);
}, { immediate: true });
</script>

<template>
  <aside ref="boxEl" class="nge-hunt" :class="{ 'nge-hunt--dragging': dragging, 'nge-hunt--live': phase === 'live', 'nge-hunt--mini': mini }" :style="posStyle" role="dialog" aria-label="The Hunt">
    <!-- Pyr's instrument chrome, as the notification window carries it (no corner brackets: Ames 2026-10-21). -->
    <span class="nge-hunt-scan" aria-hidden="true"></span>

    <header class="nge-hunt-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-hunt-eyebrow">
        <svg class="nge-hunt-eyegem" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
        The Hunt
      </span>
      <span v-if="mini && clock" class="nge-hunt-headclock"><span>{{ clock.label }}</span><b>{{ clock.value }}</b></span>
      <button v-if="opened && phase === 'live' && !mini" class="nge-hunt-panelsbtn" :class="{ 'nge-hunt-panelsbtn--on': huntPrefs.panels }" :aria-pressed="huntPrefs.panels"
              :title="huntPrefs.panels ? 'Hide the Annotations and Selection panels while hunting' : 'Show the Annotations and Selection panels (your gems in Found and Missed)'"
              :aria-label="huntPrefs.panels ? 'Hide the side panels' : 'Show the side panels'" @pointerdown.stop @click="setHuntPanels(!huntPrefs.panels)">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 3v10" stroke="currentColor" stroke-width="1.4"/><path v-if="huntPrefs.panels" d="M11.2 5.5h1.8M11.2 8h1.8M11.2 10.5h1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
      <button v-if="phase !== 'ended'" class="nge-hunt-caret" :class="{ 'nge-hunt-caret--down': mini }" :title="mini ? 'Show everything' : 'Make it small'" :aria-label="mini ? 'Show everything' : 'Make it small'" :aria-expanded="!mini" @pointerdown.stop @click="toggleMini">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="nge-hunt-x" title="Close" aria-label="Close" @pointerdown.stop @click="emit('hide')">×</button>
    </header>

    <div v-if="otherHunts.length > 1 && !mini" class="nge-hunt-tabs" role="tablist" aria-label="Hunts">
      <button v-for="h in otherHunts" :key="h.id" class="nge-hunt-tab" :class="{ 'nge-hunt-tab--on': hunt?.id === h.id, 'nge-hunt-tab--live': phaseNow(h) === 'live' }"
              role="tab" :aria-selected="hunt?.id === h.id" :title="h.title" @click="emit('pick', h.id)">{{ h.title }}</button>
    </div>

    <div v-if="!hunt" class="nge-hunt-body">
      <p v-if="test && huntState.error" class="nge-hunt-error">{{ huntState.error }}</p>
      <p v-else-if="test" class="nge-hunt-muted">Opening your test run…</p>
      <p v-else-if="huntId === -2" class="nge-hunt-muted">That Hunt is over and no longer listed.</p>
      <p v-else-if="huntState.loading || huntId === -1" class="nge-hunt-muted">Looking for the Hunt…</p>
      <p v-else-if="huntState.error" class="nge-hunt-error">{{ huntState.error }}</p>
      <p v-else class="nge-hunt-muted">No Hunt right now. When one is coming, it is announced in your notifications.</p>
    </div>

    <!-- Small before the start: the header alone, with its countdown (Ames 2026-10-22: "this looks wonky") -->
    <div v-else-if="!(mini && phase === 'announced' && !error)" class="nge-hunt-body">
      <div v-if="!mini" class="nge-hunt-titlerow">
        <h2 class="nge-hunt-title">{{ hunt.title }}</h2>
        <div v-if="clock" class="nge-hunt-clock"><span class="nge-hunt-clock-label">{{ clock.label }}</span><span class="nge-hunt-clock-time">{{ clock.value }}</span></div>
      </div>
      <p v-if="!mini" class="nge-hunt-brief">{{ briefShort }}</p>
      <p v-if="phase === 'announced' && !mini" class="nge-hunt-when">{{ localTime(hunt.start_at) }} until {{ localTime(hunt.end_at) }}</p>

      <!-- While it runs -->
      <template v-if="phase === 'live'">

        <!-- Small (Ames 2026-10-21: "a slim version of the main functions"): found of all, gems left,
             the gem switch, Submit, and the last answer, in two thin rows. -->
        <div v-if="mini && run" class="nge-hunt-slim">
          <div class="nge-hunt-slim-row">
            <span class="nge-hunt-slim-read" :title="`${run.found} of ${run.of} found`"><b :key="'f' + run.found" class="nge-hunt-pop">{{ run.found }}</b><i>/{{ run.of }}</i><small>found</small></span>
            <!-- Gems left as a count, no fraction, so only the finds read as one (Ames 2026-10-22: "kind of confusing to see the 7/10 and 8/15") -->
            <span class="nge-hunt-slim-read" :title="`${run.gems_left} of ${run.budget} gems left`"><b :key="'g' + run.gems_left" class="nge-hunt-pop">{{ run.gems_left }}</b><small>{{ run.gems_left === 1 ? 'gem left' : 'gems left' }}</small></span>
          </div>
          <div v-if="opened && !run.done && (kinds.length > 1 || !huntPrefs.auto)" class="nge-hunt-slim-row">
            <div v-if="kinds.length > 1" class="nge-hunt-kinds nge-hunt-kinds--slim" :class="{ 'nge-hunt-kinds--fill': huntPrefs.auto }" role="radiogroup" aria-label="Which gem Ctrl + Click drops">
              <button v-for="k in kinds" :key="k" class="nge-hunt-kind" :class="[`nge-hunt-kind--${k}`, { 'nge-hunt-kind--on': huntState.kind === k }]"
                      role="radio" :aria-checked="huntState.kind === k" :title="kindTitle(k)" @click="choose(k)">
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
                <span>{{ KIND[k].word }}</span>
              </button>
            </div>
            <button v-if="!huntPrefs.auto" class="nge-hunt-submit nge-hunt-submit--slim" :class="{ 'nge-hunt-submit--alone': kinds.length < 2 }" :disabled="!huntState.waiting" :title="huntState.waiting ? '' : 'Drop gems, then submit'" @click="submitWaiting">
              {{ huntState.waiting ? `Submit ${huntState.waiting}` : 'Submit' }}
            </button>
            <button v-if="!huntPrefs.auto" class="nge-hunt-takeback nge-hunt-takeback--slim" :disabled="!huntState.waiting" title="Take back your last gem (not sent yet)" aria-label="Take back your last gem" @click="takeBackGem">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6 4L3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <button v-if="!opened" class="nge-hunt-btn nge-hunt-btn--primary nge-hunt-btn--slim" :disabled="!!busy" @click="go">
            {{ busy === 'go' ? 'Opening…' : onDataset ? 'Open the Hunt' : `Open on ${datasetName}` }}
          </button>
          <p v-if="run.done" class="nge-hunt-slim-done">{{ doneWhy.head }}<span>{{ doneWhy.short }}</span></p>
          <div v-if="huntState.pending" class="nge-hunt-slim-news nge-hunt-news--pending" role="status"><b>Checking…</b></div>
          <div v-else-if="newsLine" :key="news?.at" class="nge-hunt-slim-news" :class="[`nge-hunt-news--${newsLine.cls}`, { 'nge-hunt-news--ext': newsLine.ext }]" role="status">
            <b>{{ newsLine.head }}</b><span>{{ newsLine.text }}</span>
            <button v-if="newsLine.other && kinds.includes(newsLine.other)" class="nge-hunt-news-switch" @click="choose(newsLine.other)">Switch to {{ KIND[newsLine.other].word }}</button>
          </div>
        </div>

        <template v-if="opened && run && !mini">
          <!-- The HUD: what is found, what is left, the medal so far -->
          <div class="nge-hunt-hud">
            <div class="nge-hunt-read">
              <span class="nge-hunt-read-label">Found</span>
              <span class="nge-hunt-read-val"><b :key="'f' + run.found" class="nge-hunt-pop">{{ run.found }}</b><i>/{{ run.of }}</i></span>
            </div>
            <div class="nge-hunt-read">
              <span class="nge-hunt-read-label">Gems</span>
              <span class="nge-hunt-read-val"><b :key="'g' + run.gems_left" class="nge-hunt-pop">{{ run.gems_left }}</b><i>/{{ run.budget }}</i></span>
              <span v-if="huntState.waiting" class="nge-hunt-read-sub">{{ huntState.waiting }} waiting</span>
              <span v-else-if="run.gems_left === 0" class="nge-hunt-read-sub">none left</span>
            </div>
            <!-- The medal stays a secret until the end (Ames 2026-10-21: "do we want to reveal what achievement they have before they win it?"); the clock shows instead. -->
            <div class="nge-hunt-read" title="Your clock started when you first opened the Hunt, and runs once">
              <span class="nge-hunt-read-label">Time</span>
              <span class="nge-hunt-read-val nge-hunt-read-time">{{ yourTime || '0m 00s' }}</span>
              <span class="nge-hunt-read-sub">{{ run.done ? 'final' : 'one try' }}</span>
            </div>
          </div>
          <!-- One gem per chance: gold while left, dark once dropped -->
          <div v-if="pips.length && !mini" class="nge-hunt-pips" :style="{ '--pips': pips.length }" :title="`${run.gems_left} of ${run.budget} gems left`" aria-hidden="true">
            <span v-for="(used, i) in pips" :key="i" class="nge-hunt-pip" :class="{ 'nge-hunt-pip--used': used }"></span>
          </div>

          <div v-if="!run.done" class="nge-hunt-controls">
            <div v-if="kinds.length > 1" class="nge-hunt-kinds" role="radiogroup" aria-label="Which gem Ctrl + Click drops">
              <button v-for="k in kinds" :key="k" class="nge-hunt-kind" :class="[`nge-hunt-kind--${k}`, { 'nge-hunt-kind--on': huntState.kind === k }]"
                      role="radio" :aria-checked="huntState.kind === k" :title="kindTitle(k)" @click="choose(k)">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
                <span class="nge-hunt-kind-word">{{ KIND[k].word }}</span>
                <span class="nge-hunt-kind-count">{{ run.found_by?.[k] ?? 0 }}<i>/{{ run.of_by?.[k] ?? 0 }}</i></span>
              </button>
            </div>
            <label class="nge-hunt-switch" title="On: each gem is checked as it lands. Off: gems wait until you press Submit.">
              <input type="checkbox" role="switch" :checked="huntPrefs.auto" @change="onAutoChange" />
              <span class="nge-hunt-switch-track" aria-hidden="true"><span class="nge-hunt-switch-knob"></span></span>
              <span class="nge-hunt-switch-text">Check each gem as it lands</span>
            </label>
            <div v-if="!huntPrefs.auto" class="nge-hunt-submitrow">
              <button class="nge-hunt-submit" :disabled="!huntState.waiting" @click="submitWaiting">
                {{ huntState.waiting ? `Submit ${huntState.waiting} ${huntState.waiting === 1 ? 'gem' : 'gems'}` : 'Drop gems, then submit' }}
              </button>
              <!-- A gem dropped by mistake comes off before Submit (Ames 2026-10-26, from Celia) -->
              <button class="nge-hunt-takeback" :disabled="!huntState.waiting" title="Take back your last gem (not sent yet)" @click="takeBackGem">
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6 4L3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Take back
              </button>
            </div>
          </div>
          <!-- The cells glow teal where they run out of the data; off if it distracts (Ames 2026-10-23) -->
          <label v-if="opened && hunt?.bounds_nm" class="nge-hunt-switch nge-hunt-switch--edge" title="On: the cells glow teal where they run out of the data. An Extend gem there is the edge of the dataset and uses no gem.">
            <input type="checkbox" role="switch" :checked="huntPrefs.edges" @change="onEdgesChange" />
            <span class="nge-hunt-switch-track" aria-hidden="true"><span class="nge-hunt-switch-knob"></span></span>
            <span class="nge-hunt-switch-text">Show the edge of the dataset</span>
          </label>

          <!-- The last gem's answer -->
          <div v-if="huntState.pending" class="nge-hunt-news nge-hunt-news--pending" role="status"><span class="nge-hunt-news-head">Checking…</span></div>
          <div v-else-if="newsLine" :key="news?.at" class="nge-hunt-news" :class="[`nge-hunt-news--${newsLine.cls}`, { 'nge-hunt-news--ext': newsLine.ext }]" role="status">
            <span class="nge-hunt-news-head">{{ newsLine.head }}</span>
            <span class="nge-hunt-news-text">{{ newsLine.text }}</span>
            <button v-if="newsLine.other && kinds.includes(newsLine.other)" class="nge-hunt-news-switch" @click="choose(newsLine.other)">Switch to {{ KIND[newsLine.other].word }}</button>
          </div>
          <ul v-if="earlier.length && !mini" class="nge-hunt-log" aria-label="Your answers before">
            <li v-for="e in earlier" :key="e.at" :class="[`nge-hunt-log--${e.cls}`, { 'nge-hunt-log--ext': e.ext }]"><b>{{ e.head }}</b> {{ e.text }}</li>
          </ul>

          <!-- Done -->
          <div v-if="run.done && !mini" class="nge-hunt-done" :class="{ 'nge-hunt-done--all': run.found === run.of }">
            <div class="nge-hunt-done-head">{{ doneWhy.head }}</div>
            <p class="nge-hunt-done-why">{{ doneWhy.text }}</p>
            <p>{{ run.found }}/{{ run.of }} found<template v-if="yourTime"> · {{ yourTime }}</template></p>
            <p v-if="!hunt.test" class="nge-hunt-muted">Medals at the end, {{ localTime(hunt.end_at) }}.</p>
          </div>
        </template>

        <div v-if="!mini" class="nge-hunt-actions">
          <button class="nge-hunt-btn" :class="{ 'nge-hunt-btn--primary': !opened }" :disabled="!!busy" @click="go">
            {{ busy === 'go' ? 'Opening…' : onDataset && opened ? 'Back to the start view' : 'Open the Hunt' }}
            <small v-if="!onDataset && busy !== 'go'" class="nge-hunt-btn-sub">switches to {{ datasetName }}</small>
          </button>
          <button v-for="(c, i) in (opened && somaCells.length > 1 ? somaCells : [])" :key="c.root" class="nge-hunt-cellbtn" :title="c.label || `Cell ${i + 1}`" @click="goToSoma(c.soma || [])">Cell {{ i + 1 }}</button>
        </div>
      </template>

      <!-- The end: a celebration (Ames 2026-10-21: "this shouldn't say awards ceremony, make it more congratulatory") -->
      <template v-else-if="phase === 'ended'">
        <div class="nge-hunt-congrats">
          <!-- Two set lines, not a wrap (Ames 2026-10-22: "no comma after congratulations", "better type design on the title") -->
          <div class="nge-hunt-congrats-head"><span class="nge-hunt-congrats-big">Congratulations</span> <span class="nge-hunt-congrats-small">hunters!</span></div>
          <p>{{ hunt.players ? `${hunt.players === 1 ? '1 hunter' : `${hunt.players} hunters`} took part` : 'The Hunt is over' }}</p>
        </div>
        <p v-if="!hunt.awarded" class="nge-hunt-muted">The medals are being given…</p>
        <div v-if="myResult && myResult.tier" class="nge-hunt-mymedal" :class="`nge-hunt-mymedal--${myResult.tier}`">
          <img :src="medalArt(myResult.tier)" alt="" />
          <div><b :class="`nge-hunt-tierword--${myResult.tier}`">{{ TIER_WORD[myResult.tier] }} is yours!</b>
            <span>{{ myResult.found }}/{{ myResult.of }} found · {{ myResult.gems }} gems</span></div>
        </div>
        <p v-else-if="myResult" class="nge-hunt-mine">{{ myResult.found }}/{{ myResult.of }} found · {{ myResult.gems }} gems. Thanks for hunting!</p>
        <div v-if="hunt.fastest" class="nge-hunt-mymedal nge-hunt-mymedal--speed">
          <img src="hunt/fastest-128.png" alt="" />
          <div><b>Fastest: {{ hunt.fastest.you ? 'you!' : hunt.fastest.name }}</b><span>{{ fastestShort }}</span></div>
        </div>
      </template>

      <p v-if="error" class="nge-hunt-error" role="alert">{{ error }}</p>

      <!-- Instructions, as Cell Library shows them (Ames 2026-10-21): a small link that opens a panel with the
           Hunt's description, Ames's five lines (admins can change them in the game, EditableText), and the
           medals in one slim row at the bottom ("we can put tiers at bottom of instructions"). Open before the
           Hunt is opened, folded while hunting. -->
      <button v-if="phase !== 'ended' && !mini" class="nge-hunt-howtoggle" :class="{ 'nge-hunt-howtoggle--open': howOpen }" :aria-expanded="howOpen" @click="toggleHow">
        <span>Instructions</span>
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div v-if="howOpen && phase !== 'ended' && !mini" class="nge-hunt-howpanel">
        <div v-if="description" class="nge-hunt-desc nge-hunt-desc--how" v-html="description"></div>
        <EditableText text-key="howto.hunt" :original="HUNT_STEPS" list-class="nge-hunt-howto-steps" />
        <!-- What the colors mean (Ames 2026-10-26): the gems' own colors, and the glow on a cell -->
        <div class="nge-hunt-key" aria-label="What the colors mean">
          <span v-for="k in GEM_KEY" :key="k.words" class="nge-hunt-keyitem">
            <svg v-for="c in k.colors" :key="c" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" :fill="c"/></svg>
            {{ k.words }}
          </span>
          <span v-if="hunt.bounds_nm" class="nge-hunt-keyitem nge-hunt-keyitem--wide">
            <i class="nge-hunt-keyglow" :style="{ '--edge': EDGE_COLOR }" aria-hidden="true"></i>
            A teal glow on a cell: the data ends there. An Extend gem there costs nothing.
          </span>
        </div>
        <div class="nge-hunt-medalrow" aria-label="Medals">
          <span v-for="t in TIERS" :key="t" class="nge-hunt-medalmini" :title="`${TIER_WORD[t]}: ${needShort(t)}`">
            <img :src="medalArt(t)" alt="" /><b :class="`nge-hunt-tierword--${t}`">{{ TIER_WORD[t] }}</b><small>{{ needShort(t) }}</small>
          </span>
          <span class="nge-hunt-medalmini" title="Speed: the fastest to find them all (or the most, if nobody finds all), from your first open of the Hunt. One try.">
            <img src="hunt/fastest-128.png" alt="" /><b class="nge-hunt-tierword--speed">Speed</b><small>fastest</small>
          </span>
        </div>
        <p v-if="!hunt.test" class="nge-hunt-fine">{{ (hunt.cell_count || 1) > 1 ? 'The cells are' : 'The cell is' }} frozen while the Hunt runs: nobody can merge or cut {{ (hunt.cell_count || 1) > 1 ? 'them' : 'it' }}.</p>
      </div>

      <section v-if="hunt.board.length && phase !== 'announced' && !mini" class="nge-hunt-board" aria-label="Top hunters">
        <div class="nge-hunt-label">{{ phase === 'ended' ? 'Everyone who took part' : 'Top hunters' }}</div>
        <ol>
          <li v-for="b in hunt.board" :key="b.rank" :class="{ 'nge-hunt-board--you': b.you }">
            <span class="nge-hunt-rank">{{ b.rank }}</span>
            <span class="nge-hunt-who">{{ b.name }}</span>
            <img v-if="b.fastest" src="hunt/fastest-128.png" class="nge-hunt-speedmark" title="Fastest" alt="Fastest" />
            <span v-if="b.tier && phase === 'ended'" class="nge-hunt-tierdot" :class="`nge-hunt-tierdot--${b.tier}`" :title="TIER_WORD[b.tier]"></span>
            <!-- While it runs, found only: no gem counts (Ames 2026-10-26); the results show them, as the medals count them -->
            <span class="nge-hunt-found">{{ b.found }}/{{ hunt.target_count }}<span v-if="phase === 'ended'" class="nge-hunt-gemcount"> · {{ b.gems }} {{ b.gems === 1 ? 'gem' : 'gems' }}</span></span>
          </li>
        </ol>
      </section>
    </div>
  </aside>
</template>

<style scoped>
/* The Hunt box (redesign 2026-10-21, Ames: "needs to fit better", "use badass scifi design").
   Built on Pyr's own instrument chrome, carried from the notification window
   (NotificationFeedPanel .nge-notif-detail): the dark gradient surface, the lit
   hairline along the top, faint scanlines and one scan pass (the corner brackets
   left: Ames, "doesn't need corner brackets at all"). The Hunt's own color is the
   gold of the color key (#f5d142); the instrument lines stay Pyr blue. */
.nge-hunt {
  --hn-accent: 74 158 255;
  --hn-cyan: 126 224 255;
  --hn-line: 196 228 255;
  --hn-ink: 236 243 252;
  --hn-gold: 245 209 66;
  position: fixed; top: 64px; right: 12px; z-index: 950; isolation: isolate;
  width: min(316px, calc(100vw - 24px)); max-height: calc(100vh - 84px); overflow-y: auto; overflow-x: hidden;
  background:
    radial-gradient(120% 50% at 50% -10%, rgb(var(--hn-gold) / 0.07), transparent 60%),
    linear-gradient(158deg, rgba(10, 17, 32, 0.97) 0%, rgba(5, 9, 19, 0.985) 100%);
  border: 1px solid rgb(var(--hn-accent) / 0.30);
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 0 60px rgb(var(--hn-accent) / 0.10), inset 0 1px 0 rgb(var(--hn-line) / 0.10), inset 0 0 60px rgba(0, 120, 255, 0.05);
  backdrop-filter: blur(10px) saturate(1.2);
  color: rgb(var(--hn-ink) / 0.92); font-family: 'Inter', system-ui, sans-serif; font-size: 13px; line-height: 1.4;
  scrollbar-width: thin; scrollbar-color: rgb(var(--hn-accent) / 0.4) transparent;
  animation: ngeHuntMaterialize 720ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
.nge-hunt--live { border-color: rgb(var(--hn-gold) / 0.45); }
.nge-hunt::before {   /* the lit hairline */
  content: ''; position: absolute; left: 8%; right: 8%; top: 0; height: 1px; z-index: 3; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgb(var(--hn-line) / 0.95) 50%, transparent);
  box-shadow: 0 0 12px rgb(var(--hn-cyan) / 0.55);
}
.nge-hunt::after {   /* faint scanlines, a texture, not motion */
  content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: repeating-linear-gradient(180deg, rgb(var(--hn-line) / 0.022) 0px, rgb(var(--hn-line) / 0.022) 1px, transparent 1px, transparent 3px);
}
.nge-hunt > * { position: relative; z-index: 1; }
.nge-hunt > .nge-hunt-scan { position: absolute; }
@keyframes ngeHuntMaterialize {
  0%   { opacity: 0; transform: translateY(10px) scale(0.97); filter: blur(10px) brightness(2.5); }
  60%  { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) brightness(1.15); }
  100% { opacity: 1; transform: none; filter: none; }
}
.nge-hunt-scan {   /* one band, one pass, then gone */
  left: 0; right: 0; top: 0; height: 12%; z-index: 2; pointer-events: none; opacity: 0;
  background: linear-gradient(180deg, transparent, rgb(var(--hn-cyan) / 0.11) 70%, rgb(var(--hn-cyan) / 0.22) 98%, transparent);
  animation: ngeHuntScanPass 1600ms cubic-bezier(0.22, 0.9, 0.28, 1) 240ms 1 backwards;
}
/* The band ends at the bottom edge (733% of its 12% height) and then goes: one that ended past the
   edge stayed there, unseen, and gave the box a scroll bar (Ames 2026-10-22: "why is there a scroll bar here?"). */
@keyframes ngeHuntScanPass { from { transform: translateY(-100%); opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } to { transform: translateY(733%); opacity: 0; } }

/* ── Head ── */
.nge-hunt-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px 18px; cursor: grab; touch-action: none; user-select: none; border-bottom: 1px solid rgb(var(--hn-accent) / 0.14); }
.nge-hunt--dragging .nge-hunt-head { cursor: grabbing; }
.nge-hunt-eyebrow { display: flex; align-items: center; gap: 6px; white-space: nowrap; font: 600 10.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: rgb(var(--hn-gold)); }
.nge-hunt-eyegem { filter: drop-shadow(0 0 4px rgb(var(--hn-gold) / 0.7)); }
.nge-hunt--mini { width: min(300px, calc(100vw - 24px)); }
.nge-hunt--mini .nge-hunt-eyebrow { letter-spacing: 0.16em; }
.nge-hunt--mini .nge-hunt-head { gap: 6px; }
.nge-hunt-headclock { margin-left: auto; display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.nge-hunt-headclock span { font: 600 8.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: rgb(var(--hn-line) / 0.55); }
.nge-hunt-headclock b { font: 700 13px 'Orbitron', 'Inter', sans-serif; color: rgb(var(--hn-gold)); font-variant-numeric: tabular-nums; text-shadow: 0 0 10px rgb(var(--hn-gold) / 0.35); }

.nge-hunt--mini .nge-hunt-head { padding: 8px 14px 6px 14px; }
.nge-hunt--mini .nge-hunt-body { padding: 8px 12px 12px 14px; gap: 6px; }
.nge-hunt--mini .nge-hunt-title { font-size: 13px; }
.nge-hunt--mini .nge-hunt-titlerow { align-items: baseline; }
.nge-hunt--mini .nge-hunt-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; }
.nge-hunt--mini .nge-hunt-clock { flex-direction: row; align-items: baseline; gap: 5px; }
.nge-hunt--mini .nge-hunt-clock-time { font-size: 13px; }
/* The slim strip */
.nge-hunt-slim { display: flex; flex-direction: column; gap: 6px; }
.nge-hunt-slim-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.nge-hunt-slim-read {
  flex: 1 1 0; min-width: 0; display: flex; align-items: baseline; justify-content: center; padding: 3px 6px; border-radius: 8px; white-space: nowrap;
  border: 1px solid rgb(var(--hn-accent) / 0.22); background: rgb(var(--hn-accent) / 0.05);
  font: 700 15px 'Orbitron', 'Inter', sans-serif; color: #fff; font-variant-numeric: tabular-nums;
}
.nge-hunt-slim-read b { color: rgb(var(--hn-gold)); text-shadow: 0 0 10px rgb(var(--hn-gold) / 0.35); }
.nge-hunt-slim-read i { font-style: normal; font-size: 11px; color: rgb(var(--hn-line) / 0.6); }
.nge-hunt-slim-read small { margin-left: 5px; font: 600 8.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: rgb(var(--hn-line) / 0.55); }
.nge-hunt-slim-time { margin-left: auto; font: 600 11px 'Orbitron', 'Inter', sans-serif; color: rgb(var(--hn-line) / 0.7); font-variant-numeric: tabular-nums; white-space: nowrap; }
.nge-hunt-submitrow { display: flex; gap: 6px; }
.nge-hunt-submitrow .nge-hunt-submit { flex: 1; min-width: 0; }
.nge-hunt-takeback { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 9px; cursor: pointer;
  background: rgba(4, 8, 18, 0.55); border: 1px solid rgb(var(--hn-accent) / 0.45); color: rgb(var(--hn-line) / 0.85); font: 600 12px 'Inter', sans-serif; }
.nge-hunt-takeback:hover:not(:disabled), .nge-hunt-takeback:focus-visible { color: #fff; border-color: rgb(var(--hn-cyan) / 0.8); }
.nge-hunt-takeback:disabled { opacity: 0.4; cursor: default; }
.nge-hunt-takeback--slim { padding: 5px 7px; border-radius: 8px; }
/* The color key, under the instructions */
.nge-hunt-key { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; padding: 8px 2px 2px; border-top: 1px solid rgb(var(--hn-accent) / 0.18); font: 11.5px 'Inter', sans-serif; color: rgb(var(--hn-line) / 0.8); }
.nge-hunt-keyitem { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.nge-hunt-keyitem svg { flex: none; filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6)); }
.nge-hunt-keyitem--wide { white-space: normal; grid-column: 1 / -1; align-items: flex-start; }
.nge-hunt-keyitem--wide .nge-hunt-keyglow { margin-top: 5px; }
.nge-hunt-keyglow { flex: none; width: 18px; height: 7px; border-radius: 4px; background: var(--edge); box-shadow: 0 0 6px var(--edge); }
.nge-hunt-submit--slim { flex: 1 1 auto; min-width: 0; padding: 5px 10px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hunt-btn--slim { flex: none; padding: 6px 10px; font-size: 11.5px; }
.nge-hunt-slim-done { margin: 0; display: flex; align-items: baseline; gap: 8px; font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: rgb(var(--hn-gold)); }
.nge-hunt-slim-done span { font: 500 11px 'Inter', sans-serif; letter-spacing: 0; text-transform: none; color: rgb(var(--hn-line) / 0.7); }
.nge-hunt-done-why { color: #fff; }
.nge-hunt-slim-news { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; padding: 4px 8px; border-radius: 8px; font-size: 11.5px; border-left-width: 3px !important; }
.nge-hunt-slim-news b { font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; }
.nge-hunt-slim-news.nge-hunt-news--hit b { color: rgb(var(--hn-gold)); }
.nge-hunt-slim-news .nge-hunt-news-switch { margin-top: 0; padding: 2px 8px; font-size: 11px; }
.nge-hunt-read-medal { overflow: hidden; text-overflow: ellipsis; }
.nge-hunt-x { margin-left: auto; background: none; border: none; color: rgb(var(--hn-line) / 0.6); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-hunt-x:hover, .nge-hunt-x:focus-visible { color: #fff; }

/* ── Tabs, when several Hunts are on ── */
.nge-hunt-tabs { display: flex; gap: 4px; padding: 6px 12px 0 16px; overflow-x: auto; scrollbar-width: none; }
.nge-hunt-tab { flex: none; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 9px; border-radius: 6px; cursor: pointer;
  background: rgba(4, 8, 18, 0.5); border: 1px solid rgb(var(--hn-accent) / 0.25); color: rgb(var(--hn-line) / 0.7); font: 600 11px 'Inter', sans-serif; }
.nge-hunt-tab--live { border-color: rgb(var(--hn-gold) / 0.4); }
.nge-hunt-tab--on { color: #fff; background: rgb(var(--hn-accent) / 0.18); border-color: rgb(var(--hn-cyan) / 0.7); }
.nge-hunt-tab--live.nge-hunt-tab--on { background: rgb(var(--hn-gold) / 0.14); border-color: rgb(var(--hn-gold) / 0.85); }

/* ── Body ── */
.nge-hunt-body { padding: 10px 16px 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.nge-hunt-titlerow { display: flex; align-items: flex-start; gap: 10px; }
.nge-hunt-title {
  flex: 1; min-width: 0; margin: 0; padding-left: 9px; position: relative;
  font: 700 14px/1.28 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; text-transform: uppercase;
  color: #eef6ff; text-shadow: 0 0 12px rgb(var(--hn-cyan) / 0.35); overflow-wrap: anywhere;
}
.nge-hunt-title::before {   /* a lit gold bar, as the profile's section labels carry */
  content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 3px; border-radius: 2px;
  background: rgb(var(--hn-gold)); box-shadow: 0 0 8px rgb(var(--hn-gold) / 0.6);
}
.nge-hunt-clock { flex: none; display: flex; flex-direction: column; align-items: flex-end; }
.nge-hunt-clock-label { font: 600 9px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: rgb(var(--hn-line) / 0.55); }
.nge-hunt-clock-time { font: 700 17px 'Orbitron', 'Inter', sans-serif; color: rgb(var(--hn-gold)); font-variant-numeric: tabular-nums; text-shadow: 0 0 10px rgb(var(--hn-gold) / 0.35); }
.nge-hunt-brief { margin: 0; color: rgb(var(--hn-line) / 0.8); font-size: 12.5px; }
.nge-hunt-when { margin: 0; color: rgb(var(--hn-line) / 0.6); font-size: 12px; }
.nge-hunt-desc { font-size: 13px; color: rgb(var(--hn-ink) / 0.85); }
.nge-hunt-desc :deep(p) { margin: 0 0 4px; }
.nge-hunt-desc :deep(ol), .nge-hunt-desc :deep(ul) { margin: 2px 0 4px; padding-left: 18px; }
.nge-hunt-desc :deep(li) { margin: 1px 0; }
.nge-hunt-muted { color: rgb(var(--hn-line) / 0.55); margin: 0; }
.nge-hunt-fine { margin: 6px 0 0; font-size: 11.5px; color: rgb(var(--hn-line) / 0.5); }
.nge-hunt-error { margin: 0; color: #ff9c9c; }
.nge-hunt-label { font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: rgb(var(--hn-line) / 0.5); margin-bottom: 6px; }

/* ── HUD readouts ── */
.nge-hunt-hud { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid rgb(var(--hn-accent) / 0.22); border-radius: 10px; background: rgb(var(--hn-accent) / 0.05); overflow: hidden; }
.nge-hunt-read { display: flex; flex-direction: column; padding: 7px 10px 8px; min-width: 0; }
.nge-hunt-read + .nge-hunt-read { border-left: 1px solid rgb(var(--hn-accent) / 0.16); }
.nge-hunt-read-label { font: 600 9px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: rgb(var(--hn-line) / 0.55); }
.nge-hunt-read-val { font: 700 20px 'Orbitron', 'Inter', sans-serif; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.25; }
.nge-hunt-read-val b { color: rgb(var(--hn-gold)); text-shadow: 0 0 10px rgb(var(--hn-gold) / 0.35); }
.nge-hunt-read-val i { font-style: normal; font-size: 13px; color: rgb(var(--hn-line) / 0.6); }
.nge-hunt-read-time { font-size: 15px; line-height: 1.6; }
.nge-hunt-read-medal { font-size: 13px; line-height: 1.9; text-transform: uppercase; letter-spacing: 0.06em; color: rgb(var(--hn-line) / 0.45); }
.nge-hunt-read-sub { font-size: 10.5px; color: rgb(var(--hn-line) / 0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hunt-pop { display: inline-block; animation: ngeHuntPop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
@keyframes ngeHuntPop { 0% { transform: scale(1.8); } 100% { transform: scale(1); } }
.nge-hunt-tierword--gold { color: #f5d142 !important; text-shadow: 0 0 8px rgba(245, 209, 66, 0.4); }
.nge-hunt-tierword--silver { color: #dfe8f3 !important; text-shadow: 0 0 8px rgba(223, 232, 243, 0.3); }
.nge-hunt-tierword--bronze { color: #d9a77c !important; text-shadow: 0 0 8px rgba(217, 167, 124, 0.3); }

/* ── Chances: one gem a pip ── */
.nge-hunt-pips { display: grid; grid-template-columns: repeat(var(--pips, 10), minmax(0, 1fr)); justify-items: center; align-items: center; gap: 3px 0; padding: 0 2px; }
.nge-hunt-pip {
  width: 9px; height: 11px; background: rgb(var(--hn-gold)); clip-path: polygon(15% 32%, 35% 0, 65% 0, 85% 32%, 50% 100%);
  filter: drop-shadow(0 0 3px rgb(var(--hn-gold) / 0.8)); transition: background 0.4s, transform 0.4s, filter 0.4s;
}
.nge-hunt-pip--used { background: rgb(var(--hn-line) / 0.18); filter: none; transform: scale(0.8); }

/* ── Controls: which gem, when they are checked ── */
.nge-hunt-controls { display: flex; flex-direction: column; gap: 6px; }
.nge-hunt-seg { display: flex; border: 1px solid rgb(var(--hn-accent) / 0.3); border-radius: 9px; overflow: hidden; background: rgba(4, 8, 18, 0.6); }
.nge-hunt-seg-btn {
  flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 8px; cursor: pointer;
  background: none; border: none; color: rgb(var(--hn-line) / 0.65); font: 600 12px 'Inter', sans-serif; transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.nge-hunt-seg-btn + .nge-hunt-seg-btn { border-left: 1px solid rgb(var(--hn-accent) / 0.22); }
.nge-hunt-seg-btn small { font-weight: 400; font-size: 10.5px; color: rgb(var(--hn-line) / 0.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hunt-seg-btn:hover, .nge-hunt-seg-btn:focus-visible { color: #fff; background: rgb(var(--hn-accent) / 0.1); }
.nge-hunt-seg-btn--cut svg { color: #e06060; }
.nge-hunt-seg-btn--merge svg { color: #5aaaff; }
.nge-hunt-seg-btn--on { color: #fff; background: rgb(var(--hn-accent) / 0.18); box-shadow: inset 0 -2px 0 rgb(var(--hn-cyan) / 0.8); }
.nge-hunt-seg-btn--cut.nge-hunt-seg-btn--on { background: rgba(224, 96, 96, 0.16); box-shadow: inset 0 -2px 0 #e06060; }
.nge-hunt-seg-btn--merge.nge-hunt-seg-btn--on { background: rgba(90, 170, 255, 0.16); box-shadow: inset 0 -2px 0 #5aaaff; }
.nge-hunt-seg-btn--on small { color: rgb(var(--hn-line) / 0.7); }
.nge-hunt-submit {
  padding: 7px 10px; border-radius: 9px; cursor: pointer; font: 700 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase;
  background: rgb(var(--hn-gold) / 0.16); border: 1px solid rgb(var(--hn-gold) / 0.7); color: #fff3c4;
}
.nge-hunt-submit:hover:not(:disabled), .nge-hunt-submit:focus-visible { background: rgb(var(--hn-gold) / 0.28); box-shadow: 0 0 16px rgb(var(--hn-gold) / 0.25); }
.nge-hunt-submit:disabled { opacity: 0.45; cursor: default; letter-spacing: 0.04em; text-transform: none; font-family: 'Inter', sans-serif; font-weight: 600; }

/* ── Each gem's answer ── */
.nge-hunt-news { padding: 8px 11px; border-radius: 9px; display: flex; flex-direction: column; gap: 1px; border-left-width: 3px !important; }
.nge-hunt-news-head { font: 700 14px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; }
.nge-hunt-news-text { font-size: 12.5px; }
.nge-hunt-news--pending { background: rgb(var(--hn-accent) / 0.07); border: 1px dashed rgb(var(--hn-accent) / 0.5); color: #cfe4ff; animation: ngeHuntBreathe 1s ease-in-out infinite; }
.nge-hunt-news--hit { background: rgb(var(--hn-gold) / 0.12); border: 1px solid rgb(var(--hn-gold) / 0.75); color: #fff3c4; box-shadow: 0 0 18px rgb(var(--hn-gold) / 0.2); animation: ngeHuntHit 0.6s cubic-bezier(0.2, 1.5, 0.4, 1); }
.nge-hunt-news--hit .nge-hunt-news-head { color: rgb(var(--hn-gold)); text-shadow: 0 0 10px rgb(var(--hn-gold) / 0.5); }
/* A missing extension found: violet (Ames 2026-10-22) */
.nge-hunt-news--edge { background: rgba(66, 213, 236, 0.1); border: 1px solid rgba(66, 213, 236, 0.6); color: #e2f8fc; animation: ngeHuntRise 0.3s; }
.nge-hunt-news--edge .nge-hunt-news-head, .nge-hunt-slim-news.nge-hunt-news--edge b, .nge-hunt-log--edge b { color: #42d5ec; text-shadow: 0 0 10px rgba(66, 213, 236, 0.45); }
.nge-hunt-news--hit.nge-hunt-news--ext { background: rgba(155, 92, 255, 0.16); border-color: rgba(155, 92, 255, 0.85); color: #efe6ff; box-shadow: 0 0 18px rgba(155, 92, 255, 0.28); }
.nge-hunt-news--ext .nge-hunt-news-head, .nge-hunt-slim-news.nge-hunt-news--ext b, .nge-hunt-log--ext b { color: #b98cff; text-shadow: 0 0 10px rgba(155, 92, 255, 0.6); }
.nge-hunt-news--miss { background: rgba(125, 135, 153, 0.1); border: 1px solid rgba(125, 135, 153, 0.55); color: #dfe6f1; animation: ngeHuntShake 0.45s; }
.nge-hunt-news--already { background: rgb(var(--hn-accent) / 0.08); border: 1px solid rgb(var(--hn-accent) / 0.5); color: #cfe4ff; animation: ngeHuntRise 0.3s; }
.nge-hunt-news--refused { background: rgba(224, 96, 96, 0.08); border: 1px solid rgba(224, 96, 96, 0.5); color: #ffd2d2; animation: ngeHuntRise 0.3s; }
.nge-hunt-done { padding: 10px 12px; border-radius: 10px; background: rgb(var(--hn-accent) / 0.07); border: 1px solid rgb(var(--hn-accent) / 0.4); animation: ngeHuntHit 0.6s cubic-bezier(0.2, 1.5, 0.4, 1); }
.nge-hunt-done--all { background: rgb(var(--hn-gold) / 0.1); border-color: rgb(var(--hn-gold) / 0.7); box-shadow: 0 0 22px rgb(var(--hn-gold) / 0.18); }
.nge-hunt-done-head { font: 700 13px 'Orbitron', 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.14em; color: rgb(var(--hn-gold)); }
.nge-hunt-done p { margin: 4px 0 0; }
@keyframes ngeHuntHit { 0% { transform: scale(0.85); opacity: 0; } 60% { transform: scale(1.03); opacity: 1; } 100% { transform: scale(1); } }
@keyframes ngeHuntShake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
@keyframes ngeHuntRise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@keyframes ngeHuntBreathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

/* ── Buttons ── */
.nge-hunt-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-hunt-btn {
  flex: 1 1 100%; padding: 7px 10px; border-radius: 9px; cursor: pointer; font: 600 12.5px 'Inter', sans-serif;
  background: rgb(var(--hn-accent) / 0.1); border: 1px solid rgb(var(--hn-accent) / 0.45); color: #e6f0ff;
}
.nge-hunt-btn-sub { display: block; margin-top: 2px; font: 500 10.5px 'Inter', sans-serif; letter-spacing: 0; text-transform: none; opacity: 0.75; }
.nge-hunt-btn--primary { padding: 9px 10px; font: 700 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; background: rgb(var(--hn-gold) / 0.16); border-color: rgb(var(--hn-gold) / 0.75); color: #fff3c4; box-shadow: 0 0 18px rgb(var(--hn-gold) / 0.15); }
.nge-hunt-btn:hover:not(:disabled), .nge-hunt-btn:focus-visible { background: rgb(var(--hn-accent) / 0.2); }
.nge-hunt-btn--primary:hover:not(:disabled), .nge-hunt-btn--primary:focus-visible { background: rgb(var(--hn-gold) / 0.28); }
.nge-hunt-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hunt-cellbtn { padding: 3px 10px; border-radius: 999px; cursor: pointer; background: rgb(var(--hn-accent) / 0.1); border: 1px solid rgb(var(--hn-accent) / 0.4); color: #cfe4ff; font: 600 11.5px 'Inter', sans-serif; }
.nge-hunt-cellbtn:hover, .nge-hunt-cellbtn:focus-visible { background: rgb(var(--hn-accent) / 0.22); }

/* ── Instructions, as Cell Library shows them (CellLibraryPanel .nge-cl-howto, .nge-cl-howto-panel, .nge-cl-howto-steps) ── */
/* The caret, as Cell Library's (on the left, Ames 2026-10-20: "the shrink/expand arrow should be consistently left") */
.nge-hunt-caret {
  margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; flex: none;
  border-radius: 999px; cursor: pointer; color: #9fdcff; background: rgba(100, 200, 255, 0.12); border: 1px solid rgba(100, 200, 255, 0.4);
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.nge-hunt-caret:hover, .nge-hunt-caret:focus-visible { background: rgba(100, 200, 255, 0.22); border-color: rgba(100, 200, 255, 0.75); color: #d4f0ff; box-shadow: 0 0 10px rgba(79, 207, 255, 0.35); }
.nge-hunt-caret svg { transition: transform 0.2s ease; }
.nge-hunt-caret--down svg { transform: rotate(180deg); }
.nge-hunt-panelsbtn { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer; background: none; border: 1px solid transparent; color: rgb(var(--hn-line) / 0.6); }
.nge-hunt-panelsbtn:hover, .nge-hunt-panelsbtn:focus-visible { color: #fff; border-color: rgb(var(--hn-accent) / 0.4); }
.nge-hunt-panelsbtn--on { color: #9fdcff; border-color: rgba(100, 200, 255, 0.45); background: rgba(100, 200, 255, 0.12); }
.nge-hunt-panelsbtn + .nge-hunt-caret, .nge-hunt-headclock + .nge-hunt-caret { margin-left: 8px; }
.nge-hunt-caret + .nge-hunt-x { margin-left: 10px; }
/* Instructions: a centered dropdown (Ames 2026-10-22: "dropdown, not X", not left aligned) */
.nge-hunt-howtoggle {
  display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; padding: 6px 10px; cursor: pointer;
  border-radius: 10px; background: rgba(66, 213, 236, 0.04); border: 1px solid rgba(66, 213, 236, 0.22);
  color: rgba(126, 202, 255, 0.85); font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.nge-hunt-howtoggle::before { content: ''; width: 5px; height: 5px; transform: rotate(45deg); background: currentColor; opacity: 0.8; }
.nge-hunt-howtoggle svg { transition: transform 0.2s ease; }
.nge-hunt-howtoggle:hover, .nge-hunt-howtoggle:focus-visible { color: #fff; background: rgba(66, 213, 236, 0.08); border-color: rgba(66, 213, 236, 0.4); }
.nge-hunt-howtoggle--open { color: #7ee8ff; border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-color: transparent; background: rgba(66, 213, 236, 0.06); }
.nge-hunt-howtoggle--open svg { transform: rotate(180deg); }
.nge-hunt-howtoggle--open + .nge-hunt-howpanel { margin-top: -10px; border-top-left-radius: 0; border-top-right-radius: 0; border-top: none; }
/* Cut and Extend: two gem buttons, each lit in its layer's color, with its count (Ames 2026-10-22) */
.nge-hunt-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.nge-hunt-kind {
  --k: 125 135 153; display: flex; align-items: center; gap: 7px; min-width: 0; padding: 7px 10px; cursor: pointer;
  border-radius: 10px; background: rgba(4, 8, 18, 0.55); border: 1px solid rgb(var(--k) / 0.35);
  color: rgb(var(--hn-line) / 0.7); font: 600 12.5px 'Inter', sans-serif;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, color 0.15s;
}
.nge-hunt-kind--cut { --k: 224 96 96; }
.nge-hunt-kind--merge { --k: 90 170 255; }
.nge-hunt-kind svg { color: rgb(var(--k)); flex: none; filter: drop-shadow(0 0 3px rgb(var(--k) / 0.6)); }
.nge-hunt-kind-word { flex: 1; min-width: 0; text-align: left; }
.nge-hunt-kind-count { font: 700 12px 'Orbitron', 'Inter', sans-serif; color: rgb(var(--hn-line) / 0.8); font-variant-numeric: tabular-nums; }
.nge-hunt-kind-count i { font-style: normal; font-size: 10px; color: rgb(var(--hn-line) / 0.5); }
.nge-hunt-kind:hover, .nge-hunt-kind:focus-visible { color: #fff; border-color: rgb(var(--k) / 0.7); }
.nge-hunt-kind--on { color: #fff; background: rgb(var(--k) / 0.16); border-color: rgb(var(--k) / 0.9); box-shadow: 0 0 14px rgb(var(--k) / 0.28), inset 0 0 10px rgb(var(--k) / 0.12); }
.nge-hunt-kind--on .nge-hunt-kind-count { color: #fff; }
/* Small box: Cut and Extend keep their words whole and Submit takes the rest (Ames 2026-10-26: "display bug",
   the two were squeezed under each other beside Submit 1); with no Submit they share the row. */
.nge-hunt-kinds--slim { flex: none; grid-template-columns: auto auto; gap: 4px; }
.nge-hunt-kinds--slim.nge-hunt-kinds--fill { flex: 1; grid-template-columns: 1fr 1fr; }
.nge-hunt-kinds--slim .nge-hunt-kind { padding: 4px 8px; font-size: 11.5px; border-radius: 8px; white-space: nowrap; }
.nge-hunt-submit--alone { flex: 1 1 auto; }
/* The check switch */
.nge-hunt-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; color: rgb(var(--hn-line) / 0.8); font-size: 12px; padding: 1px 2px; }
.nge-hunt-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.nge-hunt-switch-track { position: relative; flex: none; width: 30px; height: 16px; border-radius: 999px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgb(var(--hn-accent) / 0.45); transition: background 0.15s, border-color 0.15s; }
.nge-hunt-switch-knob { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: rgb(var(--hn-line) / 0.6); transition: transform 0.18s ease, background 0.15s, box-shadow 0.15s; }
.nge-hunt-switch input:checked + .nge-hunt-switch-track { background: rgb(var(--hn-accent) / 0.3); border-color: rgb(var(--hn-cyan) / 0.8); }
.nge-hunt-switch input:checked + .nge-hunt-switch-track .nge-hunt-switch-knob { transform: translateX(14px); background: #e6f7ff; box-shadow: 0 0 8px rgb(var(--hn-cyan) / 0.8); }
.nge-hunt-switch input:focus-visible + .nge-hunt-switch-track { box-shadow: 0 0 0 2px rgb(var(--hn-cyan) / 0.5); }
.nge-hunt-switch:hover { color: #fff; }
.nge-hunt-switch--edge input:checked + .nge-hunt-switch-track { background: rgba(66, 213, 236, 0.22); border-color: rgba(66, 213, 236, 0.85); }
.nge-hunt-switch--edge input:checked + .nge-hunt-switch-track .nge-hunt-switch-knob { background: #dffaff; box-shadow: 0 0 8px rgba(66, 213, 236, 0.9); }
.nge-hunt-howpanel {
  padding: 10px 12px 8px; border-radius: 10px;
  background: rgba(66, 213, 236, 0.06); border: 1px solid rgba(66, 213, 236, 0.28);
  animation: ngeHuntHowIn 0.2s ease-out both;
}
@keyframes ngeHuntHowIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
:deep(.nge-hunt-howto-steps) { margin: 0; padding-left: 20px; font-size: 12.5px; line-height: 1.5; color: #cfdcef; }
:deep(.nge-hunt-howto-steps li) { margin: 3px 0; padding-left: 2px; }
:deep(.nge-hunt-howto-steps li::marker) { color: #42d5ec; font-weight: 700; }
:deep(.nge-hunt-howto-steps b) { color: #fff; font-weight: 600; }
.nge-hunt-medalrow { display: flex; gap: 4px; margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(66, 213, 236, 0.18); }
.nge-hunt-medalmini { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 0; text-align: center; }
.nge-hunt-medalmini img { width: 30px; height: 30px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5)); }
.nge-hunt-medalmini b { font: 700 9px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; }
.nge-hunt-medalmini small { font-size: 10px; color: rgb(var(--hn-line) / 0.6); }
.nge-hunt-desc--how { margin: 0 0 6px; padding-bottom: 6px; border-bottom: 1px solid rgba(66, 213, 236, 0.18); font-size: 12.5px; }

/* ── Board and ceremony ── */
.nge-hunt-board ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nge-hunt-board li { display: flex; align-items: center; gap: 8px; padding: 3px 8px; border-radius: 6px; font-size: 12.5px; }
.nge-hunt-board--you { background: rgb(var(--hn-gold) / 0.08); }
.nge-hunt-rank { width: 16px; color: rgb(var(--hn-line) / 0.5); font-family: 'Orbitron', 'Inter', sans-serif; font-size: 11px; }
.nge-hunt-who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-hunt-found { color: rgb(var(--hn-gold)); font-variant-numeric: tabular-nums; font-weight: 600; }
.nge-hunt-gemcount { color: rgb(var(--hn-line) / 0.5); font-weight: 400; }
.nge-hunt-tierdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.nge-hunt-tierdot--gold { background: #f5d142; box-shadow: 0 0 6px #f5d142; }
.nge-hunt-tierdot--silver { background: #dfe8f3; }
.nge-hunt-tierdot--bronze { background: #b88a63; }
.nge-hunt-ceremony { font: 700 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: rgb(var(--hn-gold)); }
.nge-hunt-text { margin: 0; }
.nge-hunt-names { color: #fff; }
.nge-hunt-mine { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgb(var(--hn-accent) / 0.08); }
.nge-hunt-chipmedal { flex: none; min-width: 54px; text-align: center; padding: 1px 8px; border-radius: 999px; font: 600 10.5px 'Inter', sans-serif; letter-spacing: 0.06em; text-transform: uppercase; }
.nge-hunt-chipmedal--gold { background: rgba(245, 209, 66, 0.2); color: #f8e08a; border: 1px solid rgba(245, 209, 66, 0.6); }
.nge-hunt-chipmedal--silver { background: rgba(200, 214, 230, 0.16); color: #e3ecf6; border: 1px solid rgba(200, 214, 230, 0.55); }
.nge-hunt-chipmedal--bronze { background: rgba(176, 141, 110, 0.18); color: #e2c9ae; border: 1px solid rgba(176, 141, 110, 0.55); }

/* ── The answers before, the switch, the celebration ── */
.nge-hunt-news-switch { align-self: flex-start; margin-top: 4px; padding: 3px 10px; border-radius: 999px; cursor: pointer; background: rgb(var(--hn-accent) / 0.14); border: 1px solid rgb(var(--hn-accent) / 0.55); color: #e6f0ff; font: 600 11.5px 'Inter', sans-serif; }
.nge-hunt-news-switch:hover, .nge-hunt-news-switch:focus-visible { background: rgb(var(--hn-accent) / 0.26); }
.nge-hunt-log { list-style: none; margin: -2px 0 0; padding: 0 2px; display: flex; flex-direction: column; gap: 1px; font-size: 11.5px; color: rgb(var(--hn-line) / 0.55); }
.nge-hunt-log b { font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; text-transform: uppercase; margin-right: 4px; }
.nge-hunt-log--hit b { color: rgb(var(--hn-gold)); }
.nge-hunt-log--miss b { color: #a7b0bf; }
.nge-hunt-log--already b { color: #9fd0ff; }
.nge-hunt-log--refused b { color: #ffb3b3; }
.nge-hunt-congrats { padding: 10px 12px; border-radius: 10px; text-align: center; background: radial-gradient(120% 120% at 50% 0%, rgb(var(--hn-gold) / 0.16), rgb(var(--hn-accent) / 0.05) 70%); border: 1px solid rgb(var(--hn-gold) / 0.55); animation: ngeHuntHit 0.7s cubic-bezier(0.2, 1.5, 0.4, 1); }
.nge-hunt-congrats-head { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 2px 0 2px; }
.nge-hunt-congrats-big { font: 700 19px/1.1 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; color: rgb(var(--hn-gold)); text-shadow: 0 0 14px rgb(var(--hn-gold) / 0.45); }
.nge-hunt-congrats-small { display: flex; align-items: center; gap: 10px; width: 100%; justify-content: center; font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.42em; text-transform: uppercase; color: #d4ecff; text-shadow: 0 0 10px rgb(var(--hn-cyan) / 0.45); }
.nge-hunt-congrats-small::before, .nge-hunt-congrats-small::after { content: ''; flex: 0 1 46px; height: 1px; background: linear-gradient(90deg, transparent, rgb(var(--hn-gold) / 0.7)); }
.nge-hunt-congrats-small::after { background: linear-gradient(90deg, rgb(var(--hn-gold) / 0.7), transparent); }
.nge-hunt-congrats p { margin: 4px 0 0; color: rgb(var(--hn-ink) / 0.85); }
.nge-hunt-mymedal { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(4, 8, 18, 0.5); border: 1px solid rgb(var(--hn-accent) / 0.25); }
.nge-hunt-mymedal img { width: 56px; height: 56px; object-fit: contain; flex: none; filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.6)); }
.nge-hunt-mymedal div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nge-hunt-mymedal b { font: 800 14px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; text-transform: uppercase; color: #fff; }
.nge-hunt-mymedal span { font-size: 12px; color: rgb(var(--hn-ink) / 0.8); }
.nge-hunt-mymedal--gold { border-color: rgb(var(--hn-gold) / 0.75); box-shadow: 0 0 18px rgb(var(--hn-gold) / 0.2); }
.nge-hunt-mymedal--speed b { color: #7fd8ff; }
.nge-hunt-tierword--speed { color: #7fd8ff !important; text-shadow: 0 0 8px rgba(127, 216, 255, 0.35); }
.nge-hunt-speedmark { width: 18px; height: 18px; object-fit: contain; flex: none; }

/* Calm screen and reduced motion: the same box, still. */
@media (prefers-reduced-motion: reduce) {
  .nge-hunt, .nge-hunt-pop, .nge-hunt-news, .nge-hunt-done { animation: none !important; }
  .nge-hunt-scan { display: none; }
  .nge-hunt-pip { transition: none; }
}
:global(body.nge-calm) .nge-hunt, :global(body.nge-calm) .nge-hunt-pop,
:global(body.nge-calm) .nge-hunt-news, :global(body.nge-calm) .nge-hunt-done { animation: none !important; }
:global(body.nge-calm) .nge-hunt-scan { display: none; }
</style>
