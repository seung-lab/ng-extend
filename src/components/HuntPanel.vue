<script setup lang="ts">
/**
 * The Hunt box (Ames 2026-10-20, rules of play 2026-10-21): a narrow box at
 * the right, dragged by its header, opened from the Hunt pill in the top bar
 * or a Hunt notification. Before the start: the countdown and the awards.
 * While it runs: Ames's five lines of instructions, the Cut and Extend gems
 * (which layer Ctrl + Click drops into), what is found and what gems are left,
 * and each gem's answer as it lands (the burst on the spot is HuntGemFx.vue).
 * After the end: the awards ceremony. Logic in src/hunt.ts; rules on the
 * server (functions/hunts.js).
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  huntState, loadHunts, featuredHunt, phaseNow, countdown, localTime, goToHunt, goToSoma, gemKinds, pickKind,
  gemsOnScreen, startGemWatch, type HuntInfo, type HuntTier, type GemKind,
} from '../hunt';
import { canonicalDataset, currentDatasetTag, datasetAbbrev, findDatasetByCanonical, segLayerName } from '../datasets';
import { useDragBox } from '../util/drag_box';
import { renderSafeMarkdown } from '../util/safe_markdown';

const props = defineProps<{ huntId?: number | null; test?: boolean }>();
const emit = defineEmits({ hide: null });

// Ames 2026-10-21: "this box needs to be draggable". By its header; it remembers where it was put.
const boxEl = ref<HTMLElement | null>(null);
const { posStyle, dragging, startDrag } = useDragBox('nge-hunt-panel-pos', boxEl);

const busy = ref('');
const error = ref('');
const gems = ref(-1);

const hunt = computed<HuntInfo | null>(() => props.test ? huntState.test :
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

function need(t: HuntTier): string {
  const h = hunt.value; if (!h) return '';
  const k = h.tiers[t];
  const finds = k >= h.target_count ? (h.target_count === 1 ? 'find it' : `find all ${h.target_count}`) : `find ${k} or more`;
  const g = h.gem_limits?.[t];
  return g ? `${finds} using ${g} ${g === 1 ? 'gem' : 'gems'} or fewer` : finds;
}
/** The awards that can be won: a medal that asks no less than the one above it is never given. */
const awards = computed<HuntTier[]>(() => {
  const h = hunt.value; if (!h) return [];
  const gl = h.gem_limits ?? { gold: 0, silver: 0, bronze: 0 };
  return TIERS.filter((t, i) => {
    if (i === 0) return true;
    const up = TIERS[i - 1];
    return h.tiers[t] < h.tiers[up] || (!!gl[up] && (!gl[t] || gl[t] > gl[up]));
  });
});

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
function choose(k: GemKind) { if (hunt.value) pickKind(hunt.value, k); }
const run = computed(() => hunt.value?.you);
/** One pip per gem: gold while unused, gray once dropped (up to 30; beyond that, the number alone). */
const pips = computed(() => {
  const r = run.value; if (!r || !r.budget || r.budget > 30) return [];
  return Array.from({ length: r.budget }, (_, i) => i < r.gems_used);
});
/** The last gem's answer, fresh for a few seconds after it lands. */
const news = computed(() => {
  const n = huntState.news; const h = hunt.value;
  if (!n || !h || huntState.now - n.at > 15000) return null;
  return n;
});
const newsLine = computed(() => {
  const n = news.value; if (!n) return null;
  if (n.result === 'hit') return { cls: 'hit', head: 'Got it!', text: n.kind === 'merge' ? 'A missing extension.' : 'A merger.' };
  if (n.result === 'already') return { cls: 'already', head: 'Found already', text: 'You found that one before. No gem used.' };
  if (n.result === 'refused') return { cls: 'refused', head: 'No gem dropped', text: n.text || '' };
  const other = n.other ? `Something is there, but it needs ${n.other === 'merge' ? 'an extension' : 'a cut'}, not ${n.gem === 'merge' ? 'an extension' : 'a cut'}.` : '';
  const near = n.nearest_um != null && hunt.value?.test ? ` The nearest ${n.gem === 'merge' ? 'missing extension' : 'merger'} is ${n.nearest_um} µm away (tolerance ${hunt.value.tolerance_um} µm).` : '';
  return { cls: 'miss', head: 'Not there', text: (other || 'No problem at that spot.') + near };
});
// Confetti when a run is done with everything found (once per run in this browser).
watch(() => [hunt.value?.id, run.value?.done, run.value?.found, run.value?.of] as const, ([id, done, found, of]) => {
  if (!id || !done || !of || found !== of) return;
  const key = `nge-hunt-allfound-${hunt.value?.test ? 'test-' : ''}${id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* still celebrate */ }
  setTimeout(() => document.dispatchEvent(new CustomEvent('nge:quest-confetti', { detail: {} })), 300);
});
const doneLine = computed(() => {
  const r = run.value; const h = hunt.value; if (!r || !h || !r.done) return '';
  const gemsWord = `${r.gems_used} ${r.gems_used === 1 ? 'gem' : 'gems'}`;
  return r.found === r.of ? `You found all ${r.of} with ${gemsWord}!` : `You found ${r.found} of ${r.of} and used all your gems.`;
});
const description = computed(() => (hunt.value?.description ? renderSafeMarkdown(hunt.value.description, true) : ''));

// ── The awards ceremony ──
const podium = computed(() => {
  const h = hunt.value; if (!h) return [];
  return TIERS.map(t => {
    const names = h.board.filter(b => b.tier === t).map(b => b.name);
    const more = Math.max(0, (h.winners?.[t] ?? 0) - names.length);
    return { tier: t, names, more };
  }).filter(p => p.names.length || p.more);
});
const myLine = computed(() => {
  const h = hunt.value; if (!h) return '';
  const y = h.you;
  if (!y.gems_used && !y.best) return 'You did not hunt this time. The next Hunt is yours.';
  const gemsWord = `${y.gems_used} ${y.gems_used === 1 ? 'gem' : 'gems'}`;
  if (y.tier) return `You found ${y.found} of ${h.target_count} with ${gemsWord}: ${TIER_WORD[y.tier]}! Your Achievement is in your profile.`;
  return `You found ${y.found} of ${h.target_count} with ${gemsWord}. No medal this time, but every problem you spot helps.`;
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
  <aside ref="boxEl" class="nge-hunt" :class="{ 'nge-hunt--dragging': dragging }" :style="posStyle" role="dialog" aria-label="The Hunt">
    <header class="nge-hunt-head" title="Drag to move" @pointerdown="startDrag">
      <div class="nge-hunt-eyebrow">The Hunt<span v-if="test" class="nge-hunt-testchip">Test run</span><span v-else-if="hunt?.admins_only" class="nge-hunt-testchip">Admins' test</span></div>
      <button class="nge-hunt-x" title="Close" aria-label="Close" @click="emit('hide')">×</button>
    </header>

    <div v-if="!hunt" class="nge-hunt-body">
      <p v-if="test && huntState.error" class="nge-hunt-error">{{ huntState.error }}</p>
      <p v-else-if="test" class="nge-hunt-muted">Opening your test run…</p>
      <p v-else-if="huntState.loading" class="nge-hunt-muted">Looking for a Hunt…</p>
      <p v-else-if="huntState.error" class="nge-hunt-error">{{ huntState.error }}</p>
      <p v-else class="nge-hunt-muted">No Hunt right now. When one is coming, it is announced in your notifications.</p>
    </div>

    <div v-else class="nge-hunt-body">
      <h2 class="nge-hunt-title">{{ hunt.title }}</h2>
      <p v-if="hunt.admins_only && !test" class="nge-hunt-adminsonly">A test Hunt: only admins see it and get its notes.</p>

      <!-- Before the start -->
      <template v-if="phase === 'announced'">
        <div class="nge-hunt-clock"><span class="nge-hunt-clock-label">Starts in</span><span class="nge-hunt-clock-time">{{ countdown(hunt.start_at) }}</span></div>
        <p class="nge-hunt-when">{{ localTime(hunt.start_at) }} until {{ localTime(hunt.end_at) }}</p>
        <div v-if="description" class="nge-hunt-desc" v-html="description"></div>
        <p class="nge-hunt-text">{{ mergers }} {{ isAre }} hidden on {{ where }} in {{ datasetName }}. When it starts, Ctrl + Click to drop a gem on each one you find. You will have {{ hunt.budget }} gems.</p>
      </template>

      <!-- While it runs -->
      <template v-else-if="phase === 'live'">
        <div v-if="hunt.test" class="nge-hunt-testnote">Only you see this test run. Each gem is judged against the real answer key, but nothing is kept, shown to players or awarded.</div>
        <div v-else class="nge-hunt-clock nge-hunt-clock--live"><span class="nge-hunt-clock-label">Ends in</span><span class="nge-hunt-clock-time">{{ countdown(hunt.end_at) }}</span></div>
        <div v-if="description" class="nge-hunt-desc" v-html="description"></div>
        <p class="nge-hunt-text">{{ mergers }} {{ isAre }} hidden on {{ where }}.</p>
        <!-- Ames's own words (2026-10-21) -->
        <ol class="nge-hunt-steps">
          <li>Ctrl + Click to drop a gem on a merger or missing extension <span class="nge-hunt-mac">(⌘ + Click on a Mac)</span></li>
          <li>The Hunt will let you know if you got it right or wrong, and how many Hunt problems and gems remain</li>
          <li>The Hunt finishes when you find all the problems or run out of gems</li>
          <li>You'll be awarded Gold, Silver or Bronze based on how many problems were found and how many gems were used</li>
          <li>Happy Hunting!</li>
        </ol>
        <p v-if="!hunt.test" class="nge-hunt-muted nge-hunt-frozen">{{ (hunt.cell_count || 1) > 1 ? 'The cells are' : 'The cell is' }} frozen while the Hunt runs: nobody can merge or cut {{ (hunt.cell_count || 1) > 1 ? 'them' : 'it' }}.</p>
        <button v-if="!run?.done || !opened" class="nge-hunt-btn" :disabled="!!busy" @click="go">
          {{ busy === 'go' ? 'Opening…' : onDataset ? (opened ? 'Back to the start view' : 'Open the Hunt') : `Switch to ${datasetName} and open the Hunt` }}
        </button>
        <div v-if="opened && somaCells.length > 1" class="nge-hunt-cells">
          <button v-for="(c, i) in somaCells" :key="c.root" class="nge-hunt-cellbtn" :title="c.label || `Cell ${i + 1}`" @click="goToSoma(c.soma || [])">Cell {{ i + 1 }}</button>
        </div>

        <!-- Which gem Ctrl + Click drops -->
        <div v-if="opened && !run?.done" class="nge-hunt-kinds" role="radiogroup" aria-label="Which gem to drop">
          <button v-for="k in kinds" :key="k" class="nge-hunt-kind" :class="[`nge-hunt-kind--${k}`, { 'nge-hunt-kind--on': huntState.kind === k }]"
                  role="radio" :aria-checked="huntState.kind === k" @click="choose(k)">
            <svg class="nge-hunt-kind-gem" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
            <span><b>{{ KIND[k].word }} gem</b><small>for {{ KIND[k].finds }}</small></span>
          </button>
        </div>

        <!-- What is found, what is left -->
        <div v-if="run && run.budget" class="nge-hunt-score">
          <div class="nge-hunt-stat">
            <span class="nge-hunt-stat-label">Found</span>
            <span class="nge-hunt-stat-num"><span :key="'f' + run.found" class="nge-hunt-pop">{{ run.found }}</span> / {{ run.of }}</span>
            <span v-if="run.of_by && run.of_by.cut && run.of_by.merge" class="nge-hunt-stat-sub">{{ run.found_by?.cut ?? 0 }}/{{ run.of_by.cut }} mergers · {{ run.found_by?.merge ?? 0 }}/{{ run.of_by.merge }} extensions</span>
          </div>
          <div class="nge-hunt-stat">
            <span class="nge-hunt-stat-label">Gems left</span>
            <span class="nge-hunt-stat-num"><span :key="'g' + run.gems_left" class="nge-hunt-pop">{{ run.gems_left }}</span> / {{ run.budget }}</span>
            <span v-if="run.tier && !run.done" class="nge-hunt-stat-sub">{{ TIER_WORD[run.tier] }} so far</span>
          </div>
        </div>
        <div v-if="pips.length" class="nge-hunt-pips" aria-hidden="true">
          <span v-for="(used, i) in pips" :key="i" class="nge-hunt-pip" :class="{ 'nge-hunt-pip--used': used }"></span>
        </div>

        <!-- The last gem's answer -->
        <div v-if="huntState.pending && opened" class="nge-hunt-news nge-hunt-news--pending" role="status"><span class="nge-hunt-news-head">Checking your gem…</span></div>
        <div v-else-if="newsLine" :key="news?.at" class="nge-hunt-news" :class="`nge-hunt-news--${newsLine.cls}`" role="status">
          <span class="nge-hunt-news-head">{{ newsLine.head }}</span>
          <span class="nge-hunt-news-text">{{ newsLine.text }}</span>
        </div>

        <!-- Done -->
        <div v-if="run?.done" class="nge-hunt-done" :class="{ 'nge-hunt-done--all': run.found === run.of }">
          <div class="nge-hunt-done-head">Your Hunt is done</div>
          <p>{{ doneLine }}</p>
          <p v-if="run.tier" class="nge-hunt-done-tier"><span class="nge-hunt-medal" :class="`nge-hunt-medal--${run.tier}`">{{ TIER_WORD[run.tier] }}</span> <template v-if="hunt.test">is what a player would win.</template><template v-else>is yours when the Hunt ends, {{ localTime(hunt.end_at) }}.</template></p>
          <p v-else class="nge-hunt-muted">No medal this time, but every problem you spot helps.</p>
        </div>
      </template>

      <!-- The awards ceremony -->
      <template v-else-if="phase === 'ended'">
        <div class="nge-hunt-ceremony">Awards ceremony</div>
        <p class="nge-hunt-text">{{ hunt.players === 1 ? '1 hunter' : `${hunt.players} hunters` }} searched for {{ mergers }}.</p>
        <p v-if="!hunt.awarded" class="nge-hunt-muted">The awards are being given…</p>
        <ul v-if="podium.length" class="nge-hunt-podium">
          <li v-for="p in podium" :key="p.tier" :class="`nge-hunt-podium--${p.tier}`">
            <span class="nge-hunt-medal" :class="`nge-hunt-medal--${p.tier}`">{{ TIER_WORD[p.tier] }}</span>
            <span class="nge-hunt-names">{{ p.names.join(', ') }}<template v-if="p.more"> and {{ p.more }} more</template></span>
          </li>
        </ul>
        <p class="nge-hunt-mine">{{ myLine }}</p>
      </template>

      <p v-if="error" class="nge-hunt-error" role="alert">{{ error }}</p>

      <section class="nge-hunt-tiers" aria-label="Awards">
        <div class="nge-hunt-board-title">Awards</div>
        <div v-for="t in awards" :key="t" class="nge-hunt-tier" :class="{ 'nge-hunt-tier--yours': hunt.you.tier === t }">
          <span class="nge-hunt-medal" :class="`nge-hunt-medal--${t}`">{{ TIER_WORD[t] }}</span>
          <span class="nge-hunt-need">{{ need(t) }}</span>
          <img v-if="hunt.prizes?.[t]" :src="hunt.prizes[t].image" :alt="hunt.prizes[t].name" :title="hunt.prizes[t].name" class="nge-hunt-prize-img" />
        </div>
      </section>

      <section v-if="hunt.board.length && phase !== 'announced'" class="nge-hunt-board" aria-label="Top hunters">
        <div class="nge-hunt-board-title">Top hunters</div>
        <ol>
          <li v-for="b in hunt.board" :key="b.rank" :class="{ 'nge-hunt-board--you': b.you }">
            <span class="nge-hunt-rank">{{ b.rank }}</span>
            <span class="nge-hunt-who">{{ b.name }}</span>
            <span class="nge-hunt-found">{{ b.found }} / {{ hunt.target_count }}<span class="nge-hunt-gemcount"> · {{ b.gems }} {{ b.gems === 1 ? 'gem' : 'gems' }}</span></span>
          </li>
        </ol>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.nge-hunt {
  position: fixed; top: 64px; right: 12px; z-index: 950;
  width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 88px); overflow-y: auto;
  background: rgba(8, 13, 26, 0.97);
  border: 1px solid rgba(245, 209, 66, 0.45);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 24px rgba(245, 209, 66, 0.08);
  color: #dbe7f7; font-family: 'Inter', system-ui, sans-serif; font-size: 14px; line-height: 1.45;
}
.nge-hunt-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 0; cursor: grab; touch-action: none; user-select: none; }
.nge-hunt--dragging .nge-hunt-head { cursor: grabbing; }
.nge-hunt-eyebrow { font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #f5d142; display: flex; align-items: center; gap: 8px; }
.nge-hunt-testchip { padding: 1px 7px; border-radius: 999px; background: rgba(90, 170, 255, 0.18); border: 1px solid rgba(90, 170, 255, 0.5); color: #9fd0ff; font: 600 10px 'Inter', sans-serif; letter-spacing: 0.08em; }
.nge-hunt-cells { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.nge-hunt-cellbtn { padding: 3px 10px; border-radius: 999px; cursor: pointer; background: rgba(90, 170, 255, 0.1); border: 1px solid rgba(90, 170, 255, 0.4); color: #cfe4ff; font: 600 12px 'Inter', sans-serif; }
.nge-hunt-cellbtn:hover, .nge-hunt-cellbtn:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-hunt-adminsonly { margin: 2px 0 6px; font-size: 12px; color: #9fd0ff; }
.nge-hunt-testnote { margin: 8px 0 4px; padding: 8px 10px; border-radius: 8px; background: rgba(90, 170, 255, 0.08); border: 1px solid rgba(90, 170, 255, 0.35); color: #cfe4ff; font-size: 13px; }
.nge-hunt-testlines { list-style: none; margin: 6px 0 0; padding: 0; font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
.nge-hunt-test-found { color: #b8f5cf; }
.nge-hunt-test-missed { color: #ffc4c4; }
.nge-hunt-x { background: none; border: none; color: #a9bbd3; font-size: 22px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-hunt-x:hover, .nge-hunt-x:focus-visible { color: #fff; }
.nge-hunt-body { padding: 6px 14px 14px; }
.nge-hunt-title { margin: 2px 0 10px; font: 600 18px 'Inter', system-ui, sans-serif; color: #fff; }
.nge-hunt-clock { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(90, 170, 255, 0.08); border: 1px solid rgba(90, 170, 255, 0.25); }
.nge-hunt-clock--live { background: rgba(245, 209, 66, 0.08); border-color: rgba(245, 209, 66, 0.35); }
.nge-hunt-clock-label { font-size: 12px; color: #a9bbd3; text-transform: uppercase; letter-spacing: 0.08em; }
.nge-hunt-clock-time { font: 600 20px 'Orbitron', 'Inter', sans-serif; color: #fff; font-variant-numeric: tabular-nums; }
.nge-hunt-when { margin: 6px 0 0; font-size: 12.5px; color: #a9bbd3; }
.nge-hunt-desc { margin: 10px 0 0; }
.nge-hunt-desc :deep(p) { margin: 0 0 6px; }
.nge-hunt-desc :deep(ol), .nge-hunt-desc :deep(ul) { margin: 4px 0 6px; padding-left: 20px; }
.nge-hunt-desc :deep(li) { margin: 2px 0; }
.nge-hunt-text { margin: 10px 0 0; }
.nge-hunt-steps { margin: 10px 0 0; padding-left: 20px; }
.nge-hunt-steps li { margin: 4px 0; }
.nge-hunt-frozen { margin: 6px 0 10px; font-size: 12px; }
.nge-hunt-btn {
  display: block; width: 100%; margin-top: 12px; padding: 9px 12px; border-radius: 8px; cursor: pointer;
  background: rgba(90, 170, 255, 0.14); border: 1px solid rgba(90, 170, 255, 0.55); color: #e6f0ff; font: 600 13.5px 'Inter', sans-serif;
}
.nge-hunt-btn:hover:not(:disabled), .nge-hunt-btn:focus-visible { background: rgba(90, 170, 255, 0.24); }
.nge-hunt-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hunt-btn--gold { width: auto; margin-top: 0; padding: 8px 18px; background: rgba(245, 209, 66, 0.16); border-color: rgba(245, 209, 66, 0.7); color: #fff3c4; }
.nge-hunt-btn--gold:hover:not(:disabled), .nge-hunt-btn--gold:focus-visible { background: rgba(245, 209, 66, 0.28); }
.nge-hunt-answer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
.nge-hunt-gems { color: #f5d142; font-weight: 600; }
.nge-hunt-fine { margin: 6px 0 0; font-size: 12px; color: #8fa3bf; }
.nge-hunt-result { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: rgba(124, 255, 178, 0.08); border: 1px solid rgba(124, 255, 178, 0.35); color: #dfffe9; }
.nge-hunt-best { margin: 8px 0 0; color: #cfe0f5; }
.nge-hunt-ceremony { font: 600 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #f5d142; }
.nge-hunt-podium { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.nge-hunt-podium li { display: flex; gap: 10px; align-items: baseline; }
.nge-hunt-names { color: #fff; }
.nge-hunt-mine { margin: 12px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(90, 170, 255, 0.08); }
.nge-hunt-medal { flex: none; display: inline-block; min-width: 54px; text-align: center; padding: 1px 8px; border-radius: 999px; font: 600 11px 'Inter', sans-serif; letter-spacing: 0.06em; text-transform: uppercase; }
.nge-hunt-medal--gold { background: rgba(245, 209, 66, 0.2); color: #f8e08a; border: 1px solid rgba(245, 209, 66, 0.6); }
.nge-hunt-medal--silver { background: rgba(200, 214, 230, 0.16); color: #e3ecf6; border: 1px solid rgba(200, 214, 230, 0.55); }
.nge-hunt-medal--bronze { background: rgba(176, 141, 110, 0.18); color: #e2c9ae; border: 1px solid rgba(176, 141, 110, 0.55); }
.nge-hunt-tiers { margin-top: 14px; display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: #cfe0f5; }
.nge-hunt-tier { display: flex; gap: 10px; align-items: center; }
.nge-hunt-tier--yours { color: #fff; font-weight: 600; }
.nge-hunt-prize-img { width: 24px; height: 24px; border-radius: 6px; object-fit: cover; flex: none; }
.nge-hunt-board { margin-top: 14px; }
.nge-hunt-board-title { font-size: 12px; color: #a9bbd3; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
.nge-hunt-board ol { list-style: none; margin: 0; padding: 0; }
.nge-hunt-board li { display: flex; gap: 8px; padding: 3px 4px; border-radius: 6px; }
.nge-hunt-board--you { background: rgba(245, 209, 66, 0.1); }
.nge-hunt-rank { width: 18px; text-align: right; color: #8fa3bf; font-variant-numeric: tabular-nums; }
.nge-hunt-who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-hunt-found { color: #f5d142; font-variant-numeric: tabular-nums; }
.nge-hunt-muted { color: #8fa3bf; }
.nge-hunt-error { margin-top: 10px; color: #ff9c9c; }

/* ── Rules of play 2026-10-21: the gems, the score, each gem's answer ── */
.nge-hunt-mac { color: #8fa3bf; font-size: 12px; }
.nge-hunt-kinds { display: flex; gap: 8px; margin-top: 12px; }
.nge-hunt-kind {
  flex: 1; min-width: 0; display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 10px; cursor: pointer;
  background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.16); color: #cfdcef; text-align: left;
  font: 13px 'Inter', system-ui, sans-serif; transition: transform 0.12s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.nge-hunt-kind b { display: block; font-weight: 700; color: #fff; }
.nge-hunt-kind small { display: block; font-size: 11.5px; color: #a9bbd3; }
.nge-hunt-kind-gem { flex: none; }
.nge-hunt-kind--cut .nge-hunt-kind-gem { color: #e06060; }
.nge-hunt-kind--merge .nge-hunt-kind-gem { color: #5aaaff; }
.nge-hunt-kind--cut.nge-hunt-kind--on { background: rgba(224, 96, 96, 0.14); border-color: rgba(224, 96, 96, 0.85); box-shadow: 0 0 0 2px rgba(224, 96, 96, 0.2); }
.nge-hunt-kind--merge.nge-hunt-kind--on { background: rgba(90, 170, 255, 0.14); border-color: rgba(90, 170, 255, 0.85); box-shadow: 0 0 0 2px rgba(90, 170, 255, 0.2); }
.nge-hunt-kind:active { transform: scale(0.97); }
.nge-hunt-score { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.nge-hunt-stat { padding: 8px 10px; border-radius: 10px; background: rgba(90, 170, 255, 0.06); border: 1px solid rgba(90, 170, 255, 0.2); display: flex; flex-direction: column; min-width: 0; }
.nge-hunt-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #a9bbd3; }
.nge-hunt-stat-num { font: 600 22px 'Orbitron', 'Inter', sans-serif; color: #fff; font-variant-numeric: tabular-nums; }
.nge-hunt-stat-sub { font-size: 11.5px; color: #a9bbd3; }
.nge-hunt-pop { display: inline-block; color: #f5d142; animation: nge-hunt-pop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
.nge-hunt-pips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.nge-hunt-pip { width: 11px; height: 13px; background: #f5d142; clip-path: polygon(15% 32%, 35% 0, 65% 0, 85% 32%, 50% 100%); transition: background 0.4s, opacity 0.4s, transform 0.4s; }
.nge-hunt-pip--used { background: #4a5263; opacity: 0.7; transform: scale(0.85); }
.nge-hunt-news { margin-top: 10px; padding: 10px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; }
.nge-hunt-news-head { font: 700 15px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; }
.nge-hunt-news-text { font-size: 13px; }
.nge-hunt-news--pending { background: rgba(90, 170, 255, 0.08); border: 1px dashed rgba(90, 170, 255, 0.5); color: #cfe4ff; animation: nge-hunt-breathe 1s ease-in-out infinite; }
.nge-hunt-news--hit { background: rgba(245, 209, 66, 0.14); border: 1px solid rgba(245, 209, 66, 0.8); color: #fff3c4; box-shadow: 0 0 18px rgba(245, 209, 66, 0.25); animation: nge-hunt-hit 0.6s cubic-bezier(0.2, 1.5, 0.4, 1); }
.nge-hunt-news--hit .nge-hunt-news-head { color: #f5d142; }
.nge-hunt-news--miss { background: rgba(125, 135, 153, 0.12); border: 1px solid rgba(125, 135, 153, 0.6); color: #dfe6f1; animation: nge-hunt-shake 0.45s; }
.nge-hunt-news--already { background: rgba(90, 170, 255, 0.1); border: 1px solid rgba(90, 170, 255, 0.5); color: #cfe4ff; animation: nge-hunt-rise 0.3s; }
.nge-hunt-news--refused { background: rgba(224, 96, 96, 0.1); border: 1px solid rgba(224, 96, 96, 0.5); color: #ffd2d2; animation: nge-hunt-rise 0.3s; }
.nge-hunt-done { margin-top: 12px; padding: 12px; border-radius: 12px; background: rgba(90, 170, 255, 0.08); border: 1px solid rgba(90, 170, 255, 0.4); animation: nge-hunt-hit 0.6s cubic-bezier(0.2, 1.5, 0.4, 1); }
.nge-hunt-done--all { background: rgba(245, 209, 66, 0.12); border-color: rgba(245, 209, 66, 0.75); box-shadow: 0 0 22px rgba(245, 209, 66, 0.2); }
.nge-hunt-done-head { font: 700 14px 'Orbitron', 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.1em; color: #f5d142; }
.nge-hunt-done p { margin: 6px 0 0; }
.nge-hunt-need { flex: 1; min-width: 0; }
.nge-hunt-gemcount { color: #8fa3bf; font-weight: 400; }
@keyframes nge-hunt-pop { 0% { transform: scale(1.8); } 100% { transform: scale(1); } }
@keyframes nge-hunt-hit { 0% { transform: scale(0.85); opacity: 0; } 60% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(1); } }
@keyframes nge-hunt-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
@keyframes nge-hunt-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@keyframes nge-hunt-breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .nge-hunt-pop, .nge-hunt-news, .nge-hunt-done, .nge-hunt-pip { animation: none !important; transition: none !important; } }
:global(body.nge-calm) .nge-hunt-pop, :global(body.nge-calm) .nge-hunt-news, :global(body.nge-calm) .nge-hunt-done { animation: none !important; }
</style>
