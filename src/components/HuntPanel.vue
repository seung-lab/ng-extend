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
  huntState, loadHunts, featuredHunt, phaseNow, countdown, localTime, goToHunt, goToSoma, gemKinds, pickKind, huntPrefs, setAutoJudge, submitWaiting,
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
  // The browser's own clock: n.at is too (huntState.now is the server's, which can differ).
  void huntState.now;   // ticks every second, so the card goes after its time
  if (!n || !h || Date.now() - n.at > 15000) return null;
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
/** A medal's ask, short, for its tile. */
function needShort(t: HuntTier): string {
  const h = hunt.value; if (!h) return '';
  const k = h.tiers[t];
  const finds = k >= h.target_count ? (h.target_count === 1 ? 'find it' : `all ${h.target_count}`) : `${k}+ found`;
  const g = h.gem_limits?.[t];
  return g ? `${finds} · ≤${g} gems` : finds;
}
/** Folded to a strip: the readouts, the gem switch and the last answer (kept in this browser). */
const mini = ref((() => { try { return localStorage.getItem('nge-hunt-mini') === '1'; } catch { return false; } })());
function toggleMini() { mini.value = !mini.value; try { localStorage.setItem('nge-hunt-mini', mini.value ? '1' : '0'); } catch { /* private window */ } }
const medalArt = (t: HuntTier) => hunt.value?.prizes?.[t]?.image || `hunt/${t}-128.png`;

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
  <aside ref="boxEl" class="nge-hunt" :class="{ 'nge-hunt--dragging': dragging, 'nge-hunt--live': phase === 'live', 'nge-hunt--mini': mini }" :style="posStyle" role="dialog" aria-label="The Hunt">
    <!-- Pyr's instrument chrome, as the notification window carries it: corner brackets that settle in once, one scan pass. -->
    <span class="nge-hunt-bracket nge-hunt-bracket--tl" aria-hidden="true"></span>
    <span class="nge-hunt-bracket nge-hunt-bracket--tr" aria-hidden="true"></span>
    <span class="nge-hunt-bracket nge-hunt-bracket--bl" aria-hidden="true"></span>
    <span class="nge-hunt-bracket nge-hunt-bracket--br" aria-hidden="true"></span>
    <span class="nge-hunt-scan" aria-hidden="true"></span>

    <header class="nge-hunt-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-hunt-eyebrow">
        <svg class="nge-hunt-eyegem" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
        The Hunt
      </span>
      <span v-if="test" class="nge-hunt-chip">Test run</span>
      <span v-else-if="hunt?.admins_only" class="nge-hunt-chip" title="A test Hunt: only admins see it and get its notes">Admins' test</span>
      <button class="nge-hunt-min" :title="mini ? 'Show everything' : 'Make it small'" :aria-label="mini ? 'Show everything' : 'Make it small'" :aria-pressed="mini" @click="toggleMini">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path v-if="mini" d="M3 3h10v10H3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path v-else d="M3 12h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
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
      <div class="nge-hunt-titlerow">
        <h2 class="nge-hunt-title">{{ hunt.title }}</h2>
        <div v-if="clock" class="nge-hunt-clock"><span class="nge-hunt-clock-label">{{ clock.label }}</span><span class="nge-hunt-clock-time">{{ clock.value }}</span></div>
      </div>
      <p v-if="!mini" class="nge-hunt-brief">{{ mergers }} {{ isAre }} hidden on {{ where }}<template v-if="phase !== 'ended'"> · {{ hunt.budget }} gems each</template></p>
      <p v-if="phase === 'announced' && !mini" class="nge-hunt-when">{{ localTime(hunt.start_at) }} until {{ localTime(hunt.end_at) }}</p>
      <div v-if="description && !mini" class="nge-hunt-desc" v-html="description"></div>

      <!-- While it runs -->
      <template v-if="phase === 'live'">
        <div v-if="hunt.test && !mini" class="nge-hunt-testnote">Only you see this test run. Each gem is judged against the real key; nothing is kept or awarded.</div>

        <template v-if="opened && run">
          <!-- The HUD: what is found, what is left, the medal so far -->
          <div class="nge-hunt-hud">
            <div class="nge-hunt-read">
              <span class="nge-hunt-read-label">Found</span>
              <span class="nge-hunt-read-val"><b :key="'f' + run.found" class="nge-hunt-pop">{{ run.found }}</b><i>/{{ run.of }}</i></span>
              <span v-if="run.of_by && run.of_by.cut && run.of_by.merge" class="nge-hunt-read-sub">cut {{ run.found_by?.cut ?? 0 }}/{{ run.of_by.cut }} · ext {{ run.found_by?.merge ?? 0 }}/{{ run.of_by.merge }}</span>
            </div>
            <div class="nge-hunt-read">
              <span class="nge-hunt-read-label">Gems</span>
              <span class="nge-hunt-read-val"><b :key="'g' + run.gems_left" class="nge-hunt-pop">{{ run.gems_left }}</b><i>/{{ run.budget }}</i></span>
              <span v-if="huntState.waiting" class="nge-hunt-read-sub">{{ huntState.waiting }} waiting</span>
            </div>
            <div class="nge-hunt-read">
              <span class="nge-hunt-read-label">Medal</span>
              <span class="nge-hunt-read-val nge-hunt-read-medal" :class="run.tier ? `nge-hunt-tierword--${run.tier}` : ''">{{ run.tier ? TIER_WORD[run.tier] : 'none' }}</span>
              <span class="nge-hunt-read-sub">{{ run.done ? 'final' : 'so far' }}</span>
            </div>
          </div>
          <!-- One gem per chance: gold while left, dark once dropped -->
          <div v-if="pips.length && !mini" class="nge-hunt-pips" :title="`${run.gems_left} of ${run.budget} gems left`" aria-hidden="true">
            <span v-for="(used, i) in pips" :key="i" class="nge-hunt-pip" :class="{ 'nge-hunt-pip--used': used }"></span>
          </div>

          <div v-if="!run.done" class="nge-hunt-controls">
            <div class="nge-hunt-seg" role="radiogroup" aria-label="Which gem Ctrl + Click drops">
              <button v-for="k in kinds" :key="k" class="nge-hunt-seg-btn" :class="[`nge-hunt-seg-btn--${k}`, { 'nge-hunt-seg-btn--on': huntState.kind === k }]"
                      role="radio" :aria-checked="huntState.kind === k" :title="`Ctrl + Click drops a ${KIND[k].word.toLowerCase()} gem, for ${KIND[k].finds}`" @click="choose(k)">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
                <span>{{ KIND[k].word }}</span><small>{{ KIND[k].finds }}</small>
              </button>
            </div>
            <div v-if="!mini" class="nge-hunt-seg nge-hunt-seg--mode" role="radiogroup" aria-label="When gems are checked">
              <button class="nge-hunt-seg-btn" :class="{ 'nge-hunt-seg-btn--on': huntPrefs.auto }" role="radio" :aria-checked="huntPrefs.auto" @click="setAutoJudge(true)">Check each gem</button>
              <button class="nge-hunt-seg-btn" :class="{ 'nge-hunt-seg-btn--on': !huntPrefs.auto }" role="radio" :aria-checked="!huntPrefs.auto" @click="setAutoJudge(false)">I'll submit</button>
            </div>
            <button v-if="!huntPrefs.auto" class="nge-hunt-submit" :disabled="!huntState.waiting" @click="submitWaiting">
              {{ huntState.waiting ? `Submit ${huntState.waiting} ${huntState.waiting === 1 ? 'gem' : 'gems'}` : 'Drop gems, then submit' }}
            </button>
          </div>

          <!-- The last gem's answer -->
          <div v-if="huntState.pending" class="nge-hunt-news nge-hunt-news--pending" role="status"><span class="nge-hunt-news-head">Checking…</span></div>
          <div v-else-if="newsLine" :key="news?.at" class="nge-hunt-news" :class="`nge-hunt-news--${newsLine.cls}`" role="status">
            <span class="nge-hunt-news-head">{{ newsLine.head }}</span>
            <span class="nge-hunt-news-text">{{ newsLine.text }}</span>
          </div>

          <!-- Done -->
          <div v-if="run.done && !mini" class="nge-hunt-done" :class="{ 'nge-hunt-done--all': run.found === run.of }">
            <div class="nge-hunt-done-head">Hunt complete</div>
            <p>{{ doneLine }}</p>
            <p v-if="run.tier" class="nge-hunt-done-tier"><b :class="`nge-hunt-tierword--${run.tier}`">{{ TIER_WORD[run.tier] }}</b>
              <template v-if="hunt.test"> is what a player would win.</template><template v-else> is yours when the Hunt ends, {{ localTime(hunt.end_at) }}.</template></p>
            <p v-else class="nge-hunt-muted">No medal this time, but every problem you spot helps.</p>
          </div>
        </template>

        <div v-if="!mini || !opened" class="nge-hunt-actions">
          <button class="nge-hunt-btn" :class="{ 'nge-hunt-btn--primary': !opened }" :disabled="!!busy" @click="go">
            {{ busy === 'go' ? 'Opening…' : onDataset ? (opened ? 'Back to the start view' : 'Open the Hunt') : `Switch to ${datasetName} and open the Hunt` }}
          </button>
          <button v-for="(c, i) in (opened && somaCells.length > 1 ? somaCells : [])" :key="c.root" class="nge-hunt-cellbtn" :title="c.label || `Cell ${i + 1}`" @click="goToSoma(c.soma || [])">Cell {{ i + 1 }}</button>
        </div>
      </template>

      <!-- The awards ceremony -->
      <template v-else-if="phase === 'ended'">
        <div class="nge-hunt-ceremony">Awards ceremony</div>
        <p class="nge-hunt-text">{{ hunt.players === 1 ? '1 hunter' : `${hunt.players} hunters` }} searched for {{ mergers }}.</p>
        <p v-if="!hunt.awarded" class="nge-hunt-muted">The awards are being given…</p>
        <ul v-if="podium.length" class="nge-hunt-podium">
          <li v-for="p in podium" :key="p.tier">
            <span class="nge-hunt-chipmedal" :class="`nge-hunt-chipmedal--${p.tier}`">{{ TIER_WORD[p.tier] }}</span>
            <span class="nge-hunt-names">{{ p.names.join(', ') }}<template v-if="p.more"> and {{ p.more }} more</template></span>
          </li>
        </ul>
        <p class="nge-hunt-mine">{{ myLine }}</p>
      </template>

      <p v-if="error" class="nge-hunt-error" role="alert">{{ error }}</p>

      <!-- How to play: Ames's own words (2026-10-21), folded once the Hunt is open; a click opens them. -->
      <section v-if="phase !== 'ended' && !mini" class="nge-hunt-how" :class="{ 'nge-hunt-how--open': howOpen }">
        <button class="nge-hunt-how-head" :aria-expanded="howOpen" @click="toggleHow">
          <span>How to play</span><span class="nge-hunt-how-chev" aria-hidden="true">▾</span>
        </button>
        <div v-if="howOpen" class="nge-hunt-how-body">
          <ol class="nge-hunt-steps">
            <li>Ctrl + Click to drop a gem on a merger or missing extension</li>
            <li>The Hunt will let you know if you got it right or wrong, and how many Hunt problems and gems remain</li>
            <li>The Hunt finishes when you find all the problems or run out of gems</li>
            <li>You'll be awarded Gold, Silver or Bronze based on how many problems were found and how many gems were used</li>
            <li>Happy Hunting!</li>
          </ol>
          <p v-if="!hunt.test" class="nge-hunt-fine">{{ (hunt.cell_count || 1) > 1 ? 'The cells are' : 'The cell is' }} frozen while the Hunt runs: nobody can merge or cut {{ (hunt.cell_count || 1) > 1 ? 'them' : 'it' }}.</p>
        </div>
      </section>

      <!-- Awards: Ames's medals -->
      <section v-if="!mini" class="nge-hunt-awards" aria-label="Awards">
        <div class="nge-hunt-label">Awards</div>
        <div class="nge-hunt-tiles">
          <div v-for="t in awards" :key="t" class="nge-hunt-tile" :class="[`nge-hunt-tile--${t}`, { 'nge-hunt-tile--yours': hunt.you.tier === t }]" :title="hunt.prizes?.[t]?.name || TIER_WORD[t]">
            <img :src="medalArt(t)" alt="" class="nge-hunt-tile-img" />
            <span class="nge-hunt-tile-word" :class="`nge-hunt-tierword--${t}`">{{ TIER_WORD[t] }}</span>
            <span class="nge-hunt-tile-need">{{ needShort(t) }}</span>
          </div>
        </div>
      </section>

      <section v-if="hunt.board.length && phase !== 'announced' && !mini" class="nge-hunt-board" aria-label="Top hunters">
        <div class="nge-hunt-label">Top hunters</div>
        <ol>
          <li v-for="b in hunt.board" :key="b.rank" :class="{ 'nge-hunt-board--you': b.you }">
            <span class="nge-hunt-rank">{{ b.rank }}</span>
            <span class="nge-hunt-who">{{ b.name }}</span>
            <span v-if="b.tier" class="nge-hunt-tierdot" :class="`nge-hunt-tierdot--${b.tier}`" :title="TIER_WORD[b.tier]"></span>
            <span class="nge-hunt-found">{{ b.found }}/{{ hunt.target_count }}<span class="nge-hunt-gemcount"> · {{ b.gems }}◆</span></span>
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
   hairline along the top, faint scanlines, four 13px corner brackets that settle
   in once from 7px outside, and one scan pass. The Hunt's own colour is the gold
   of the color key (#f5d142); the instrument lines stay Pyr blue. */
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
.nge-hunt > .nge-hunt-bracket, .nge-hunt > .nge-hunt-scan { position: absolute; }
@keyframes ngeHuntMaterialize {
  0%   { opacity: 0; transform: translateY(10px) scale(0.97); filter: blur(10px) brightness(2.5); }
  60%  { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) brightness(1.15); }
  100% { opacity: 1; transform: none; filter: none; }
}
.nge-hunt-bracket { z-index: 3; width: 13px; height: 13px; pointer-events: none; border: 1px solid rgb(var(--hn-line) / 0.55); animation: ngeHuntBracketIn 560ms cubic-bezier(0.2, 0.8, 0.25, 1) 160ms backwards; }
.nge-hunt-bracket--tl { top: 7px; left: 7px; border-right: 0; border-bottom: 0; --hn-from: -7px, -7px; }
.nge-hunt-bracket--tr { top: 7px; right: 7px; border-left: 0; border-bottom: 0; --hn-from: 7px, -7px; }
.nge-hunt-bracket--bl { bottom: 7px; left: 7px; border-right: 0; border-top: 0; --hn-from: -7px, 7px; }
.nge-hunt-bracket--br { bottom: 7px; right: 7px; border-left: 0; border-top: 0; --hn-from: 7px, 7px; }
@keyframes ngeHuntBracketIn { from { opacity: 0; transform: translate(var(--hn-from)); } to { opacity: 1; transform: translate(0, 0); } }
.nge-hunt-scan {   /* one band, one pass, then gone */
  left: 0; right: 0; top: 0; height: 12%; z-index: 2; pointer-events: none; opacity: 0;
  background: linear-gradient(180deg, transparent, rgb(var(--hn-cyan) / 0.11) 70%, rgb(var(--hn-cyan) / 0.22) 98%, transparent);
  animation: ngeHuntScanPass 1600ms cubic-bezier(0.22, 0.9, 0.28, 1) 240ms 1 both;
}
@keyframes ngeHuntScanPass { from { transform: translateY(-100%); opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } to { transform: translateY(950%); opacity: 0; } }

/* ── Head ── */
.nge-hunt-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px 18px; cursor: grab; touch-action: none; user-select: none; border-bottom: 1px solid rgb(var(--hn-accent) / 0.14); }
.nge-hunt--dragging .nge-hunt-head { cursor: grabbing; }
.nge-hunt-eyebrow { display: flex; align-items: center; gap: 6px; font: 600 10.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: rgb(var(--hn-gold)); }
.nge-hunt-eyegem { filter: drop-shadow(0 0 4px rgb(var(--hn-gold) / 0.7)); }
.nge-hunt-chip { padding: 1px 7px; border-radius: 999px; background: rgb(var(--hn-accent) / 0.16); border: 1px solid rgb(var(--hn-accent) / 0.45); color: #9fd0ff; font: 600 9.5px 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
.nge-hunt-min { margin-left: auto; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer; background: none; border: 1px solid transparent; color: rgb(var(--hn-line) / 0.6); }
.nge-hunt-min:hover, .nge-hunt-min:focus-visible { color: #fff; border-color: rgb(var(--hn-accent) / 0.4); }
.nge-hunt-min + .nge-hunt-x { margin-left: 2px; }
.nge-hunt--mini { width: min(260px, calc(100vw - 24px)); }
.nge-hunt--mini .nge-hunt-head { padding: 8px 10px 6px 14px; }
.nge-hunt--mini .nge-hunt-body { padding: 8px 12px 12px 14px; gap: 6px; }
.nge-hunt--mini .nge-hunt-title { font-size: 13px; }
.nge-hunt--mini .nge-hunt-read { padding: 5px 8px 6px; }
.nge-hunt--mini .nge-hunt-read-val { font-size: 16px; }
.nge-hunt--mini .nge-hunt-news { padding: 5px 9px; }
.nge-hunt--mini .nge-hunt-news-head { font-size: 12px; }
.nge-hunt--mini .nge-hunt-news-text { font-size: 11.5px; }
.nge-hunt--mini .nge-hunt-seg-btn small { display: none; }
.nge-hunt--mini .nge-hunt-read-medal { font-size: 10.5px; letter-spacing: 0.02em; }
.nge-hunt-read-medal { overflow: hidden; text-overflow: ellipsis; }
.nge-hunt-x { margin-left: auto; background: none; border: none; color: rgb(var(--hn-line) / 0.6); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-hunt-x:hover, .nge-hunt-x:focus-visible { color: #fff; }

/* ── Body ── */
.nge-hunt-body { padding: 10px 16px 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.nge-hunt-titlerow { display: flex; align-items: flex-start; gap: 10px; }
.nge-hunt-title { flex: 1; min-width: 0; margin: 0; font: 600 16px 'Inter', system-ui, sans-serif; color: #fff; overflow-wrap: anywhere; }
.nge-hunt-clock { flex: none; display: flex; flex-direction: column; align-items: flex-end; }
.nge-hunt-clock-label { font: 600 9px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: rgb(var(--hn-line) / 0.55); }
.nge-hunt-clock-time { font: 700 17px 'Orbitron', 'Inter', sans-serif; color: rgb(var(--hn-gold)); font-variant-numeric: tabular-nums; text-shadow: 0 0 10px rgb(var(--hn-gold) / 0.35); }
.nge-hunt-brief { margin: 0; color: rgb(var(--hn-line) / 0.8); font-size: 12.5px; }
.nge-hunt-when { margin: 0; color: rgb(var(--hn-line) / 0.6); font-size: 12px; }
.nge-hunt-desc { font-size: 13px; color: rgb(var(--hn-ink) / 0.85); }
.nge-hunt-desc :deep(p) { margin: 0 0 4px; }
.nge-hunt-desc :deep(ol), .nge-hunt-desc :deep(ul) { margin: 2px 0 4px; padding-left: 18px; }
.nge-hunt-desc :deep(li) { margin: 1px 0; }
.nge-hunt-testnote { padding: 6px 9px; border-radius: 8px; background: rgb(var(--hn-accent) / 0.08); border: 1px solid rgb(var(--hn-accent) / 0.35); color: #cfe4ff; font-size: 12px; }
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
.nge-hunt-read-medal { font-size: 13px; line-height: 1.9; text-transform: uppercase; letter-spacing: 0.06em; color: rgb(var(--hn-line) / 0.45); }
.nge-hunt-read-sub { font-size: 10.5px; color: rgb(var(--hn-line) / 0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hunt-pop { display: inline-block; animation: ngeHuntPop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
@keyframes ngeHuntPop { 0% { transform: scale(1.8); } 100% { transform: scale(1); } }
.nge-hunt-tierword--gold { color: #f5d142 !important; text-shadow: 0 0 8px rgba(245, 209, 66, 0.4); }
.nge-hunt-tierword--silver { color: #dfe8f3 !important; text-shadow: 0 0 8px rgba(223, 232, 243, 0.3); }
.nge-hunt-tierword--bronze { color: #d9a77c !important; text-shadow: 0 0 8px rgba(217, 167, 124, 0.3); }

/* ── Chances: one gem a pip ── */
.nge-hunt-pips { display: flex; flex-wrap: wrap; gap: 3px 4px; padding: 0 2px; }
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
.nge-hunt-seg--mode .nge-hunt-seg-btn { font-size: 11.5px; padding: 4px 8px; }
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
.nge-hunt-btn--primary { padding: 9px 10px; font: 700 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; background: rgb(var(--hn-gold) / 0.16); border-color: rgb(var(--hn-gold) / 0.75); color: #fff3c4; box-shadow: 0 0 18px rgb(var(--hn-gold) / 0.15); }
.nge-hunt-btn:hover:not(:disabled), .nge-hunt-btn:focus-visible { background: rgb(var(--hn-accent) / 0.2); }
.nge-hunt-btn--primary:hover:not(:disabled), .nge-hunt-btn--primary:focus-visible { background: rgb(var(--hn-gold) / 0.28); }
.nge-hunt-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hunt-cellbtn { padding: 3px 10px; border-radius: 999px; cursor: pointer; background: rgb(var(--hn-accent) / 0.1); border: 1px solid rgb(var(--hn-accent) / 0.4); color: #cfe4ff; font: 600 11.5px 'Inter', sans-serif; }
.nge-hunt-cellbtn:hover, .nge-hunt-cellbtn:focus-visible { background: rgb(var(--hn-accent) / 0.22); }

/* ── How to play ── */
.nge-hunt-how { border: 1px solid rgb(var(--hn-accent) / 0.2); border-radius: 9px; background: rgba(4, 8, 18, 0.45); }
.nge-hunt-how-head { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; cursor: pointer; background: none; border: none; color: rgb(var(--hn-line) / 0.75); font: 600 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; }
.nge-hunt-how-head:hover, .nge-hunt-how-head:focus-visible { color: #fff; }
.nge-hunt-how-chev { transition: transform 0.2s; }
.nge-hunt-how--open .nge-hunt-how-chev { transform: rotate(180deg); }
.nge-hunt-how-body { padding: 0 10px 8px; }
.nge-hunt-steps { margin: 0; padding-left: 18px; font-size: 12.5px; }
.nge-hunt-steps li { margin: 2px 0; }
.nge-hunt-steps li::marker { color: rgb(var(--hn-gold)); font-family: 'Orbitron', 'Inter', sans-serif; font-weight: 700; }
.nge-hunt-mac { color: rgb(var(--hn-line) / 0.5); font-size: 11px; }

/* ── Awards: medal tiles ── */
.nge-hunt-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 6px; }
.nge-hunt-tile { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 4px 7px; border-radius: 10px; background: rgba(4, 8, 18, 0.5); border: 1px solid rgb(var(--hn-accent) / 0.18); text-align: center; min-width: 0; }
.nge-hunt-tile-img { width: 44px; height: 44px; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5)); }
.nge-hunt-tile-word { font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-hunt-tile-need { font-size: 10.5px; color: rgb(var(--hn-line) / 0.6); line-height: 1.25; }
.nge-hunt-tile--yours { border-color: rgb(var(--hn-gold) / 0.8); box-shadow: 0 0 14px rgb(var(--hn-gold) / 0.25), inset 0 0 12px rgb(var(--hn-gold) / 0.08); }

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
.nge-hunt-podium { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.nge-hunt-podium li { display: flex; gap: 8px; align-items: baseline; }
.nge-hunt-names { color: #fff; }
.nge-hunt-mine { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgb(var(--hn-accent) / 0.08); }
.nge-hunt-chipmedal { flex: none; min-width: 54px; text-align: center; padding: 1px 8px; border-radius: 999px; font: 600 10.5px 'Inter', sans-serif; letter-spacing: 0.06em; text-transform: uppercase; }
.nge-hunt-chipmedal--gold { background: rgba(245, 209, 66, 0.2); color: #f8e08a; border: 1px solid rgba(245, 209, 66, 0.6); }
.nge-hunt-chipmedal--silver { background: rgba(200, 214, 230, 0.16); color: #e3ecf6; border: 1px solid rgba(200, 214, 230, 0.55); }
.nge-hunt-chipmedal--bronze { background: rgba(176, 141, 110, 0.18); color: #e2c9ae; border: 1px solid rgba(176, 141, 110, 0.55); }

/* Calm screen and reduced motion: the same box, still. */
@media (prefers-reduced-motion: reduce) {
  .nge-hunt, .nge-hunt-bracket, .nge-hunt-pop, .nge-hunt-news, .nge-hunt-done { animation: none !important; }
  .nge-hunt-scan { display: none; }
  .nge-hunt-pip { transition: none; }
}
:global(body.nge-calm) .nge-hunt, :global(body.nge-calm) .nge-hunt-bracket, :global(body.nge-calm) .nge-hunt-pop,
:global(body.nge-calm) .nge-hunt-news, :global(body.nge-calm) .nge-hunt-done { animation: none !important; }
:global(body.nge-calm) .nge-hunt-scan { display: none; }
</style>
