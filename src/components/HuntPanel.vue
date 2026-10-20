<script setup lang="ts">
/**
 * The Hunt panel (Ames 2026-10-20): a narrow panel at the right, opened from
 * the Hunt pill in the top bar or a Hunt notification. Before the start: the
 * countdown and the prizes. While it runs: open the hunt, drop gold gems on
 * the mergers, submit, see how many you found and the top ten. After the
 * end: the awards ceremony. Logic in src/hunt.ts; rules on the server
 * (functions/hunts.js).
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  huntState, loadHunts, featuredHunt, phaseNow, countdown, localTime, goToHunt, submitGems,
  gemsOnScreen, startGemWatch, type HuntInfo, type HuntResult, type HuntTier,
} from '../hunt';
import { canonicalDataset, currentDatasetTag, datasetAbbrev, findDatasetByCanonical, segLayerName } from '../datasets';

const props = defineProps<{ huntId?: number | null }>();
const emit = defineEmits({ hide: null });

const busy = ref('');
const error = ref('');
const result = ref<HuntResult | null>(null);
const gems = ref(-1);

const hunt = computed<HuntInfo | null>(() =>
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
const mergers = computed(() => {
  const n = hunt.value?.target_count ?? 0;
  return n === 1 ? '1 merger' : `${n} mergers`;
});
const TIER_WORD: Record<HuntTier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const TIERS: HuntTier[] = ['gold', 'silver', 'bronze'];

function need(t: HuntTier): string {
  const h = hunt.value; if (!h) return '';
  const k = h.tiers[t];
  return k >= h.target_count ? `all ${h.target_count}` : `${k} or more`;
}

let gemTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  if (!huntState.loaded) void loadHunts();
  startGemWatch();
  gemTimer = setInterval(() => { if (hunt.value) gems.value = gemsOnScreen(hunt.value); }, 1500);
});
onUnmounted(() => { if (gemTimer) clearInterval(gemTimer); });

// A new hunt in the panel starts with no answer shown.
watch(() => hunt.value?.id, () => { result.value = null; error.value = ''; });

async function go() {
  const h = hunt.value; if (!h || busy.value) return;
  busy.value = 'go'; error.value = '';
  try {
    const r = await goToHunt(h);
    if (r === 'ok') gems.value = gemsOnScreen(h);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

async function submit(e?: Event) {
  const h = hunt.value; if (!h || busy.value) return;
  busy.value = 'submit'; error.value = '';
  try {
    const r = await submitGems(h);
    result.value = r;
    if (r.found > 0 && r.found === r.of) {
      let origin: { x: number; y: number } | undefined;
      try { const b = (e?.currentTarget as HTMLElement | null)?.getBoundingClientRect(); if (b) origin = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } catch { /* no button */ }
      document.dispatchEvent(new CustomEvent('nge:quest-confetti', { detail: { origin } }));
    }
  } catch (err: any) { error.value = err?.message || String(err); }
  finally { busy.value = ''; }
}

const resultLine = computed(() => {
  const r = result.value; if (!r) return '';
  const found = r.found === 0 ? 'None of your gems found a merger' : r.found === r.of ? `Every merger found: all ${r.of}` : `Your gems found ${r.found} of ${r.of} mergers`;
  const close = r.close === 1 ? ' One more gem is close.' : r.close > 1 ? ` ${r.close} more gems are close.` : '';
  return `${found}.${close}`;
});

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
  if (!y.submissions) return 'You did not send an answer this time. The next Hunt is yours.';
  if (y.tier) return `You found ${y.best} of ${h.target_count}: ${TIER_WORD[y.tier]}! Your Achievement is in your profile.`;
  return `You found ${y.best} of ${h.target_count}. No medal this time, but every merger you spot helps.`;
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
  <aside class="nge-hunt" role="dialog" aria-label="The Hunt">
    <header class="nge-hunt-head">
      <div class="nge-hunt-eyebrow">The Hunt</div>
      <button class="nge-hunt-x" title="Close" aria-label="Close" @click="emit('hide')">×</button>
    </header>

    <div v-if="!hunt" class="nge-hunt-body">
      <p v-if="huntState.loading" class="nge-hunt-muted">Looking for a Hunt…</p>
      <p v-else-if="huntState.error" class="nge-hunt-error">{{ huntState.error }}</p>
      <p v-else class="nge-hunt-muted">No Hunt right now. When one is coming, it is announced in your notifications.</p>
    </div>

    <div v-else class="nge-hunt-body">
      <h2 class="nge-hunt-title">{{ hunt.title }}</h2>

      <!-- Before the start -->
      <template v-if="phase === 'announced'">
        <div class="nge-hunt-clock"><span class="nge-hunt-clock-label">Starts in</span><span class="nge-hunt-clock-time">{{ countdown(hunt.start_at) }}</span></div>
        <p class="nge-hunt-when">{{ localTime(hunt.start_at) }} until {{ localTime(hunt.end_at) }}</p>
        <p v-if="hunt.description" class="nge-hunt-desc">{{ hunt.description }}</p>
        <p class="nge-hunt-text">{{ mergers }} {{ hunt.target_count === 1 ? 'is' : 'are' }} hidden on {{ where }} in {{ datasetName }}. When it starts, find each one, drop a gold gem on it, and submit.</p>
      </template>

      <!-- While it runs -->
      <template v-else-if="phase === 'live'">
        <div class="nge-hunt-clock nge-hunt-clock--live"><span class="nge-hunt-clock-label">Ends in</span><span class="nge-hunt-clock-time">{{ countdown(hunt.end_at) }}</span></div>
        <p v-if="hunt.description" class="nge-hunt-desc">{{ hunt.description }}</p>
        <ol class="nge-hunt-steps">
          <li>Open the Hunt: {{ mergers }} {{ hunt.target_count === 1 ? 'is' : 'are' }} hidden on {{ where }}.</li>
          <li>Drop a gold gem on each merger: <b>Ctrl</b> + click (<b>⌘</b> + click on a Mac) where two cells join.</li>
          <li>Submit. You hear how many gems found a merger, never which.</li>
        </ol>
        <p class="nge-hunt-muted nge-hunt-frozen">{{ (hunt.cell_count || 1) > 1 ? 'The cells are' : 'The cell is' }} frozen while the Hunt runs: nobody can merge or cut {{ (hunt.cell_count || 1) > 1 ? 'them' : 'it' }}.</p>
        <button class="nge-hunt-btn" :disabled="!!busy" @click="go">
          {{ busy === 'go' ? 'Opening…' : onDataset ? (gems >= 0 ? 'Back to the start view' : 'Open the Hunt') : `Switch to ${datasetName} and open the Hunt` }}
        </button>
        <div class="nge-hunt-answer">
          <span class="nge-hunt-gems">{{ gems >= 0 ? (gems === 1 ? '1 gem down' : `${gems} gems down`) : 'No gems down yet' }}</span>
          <button class="nge-hunt-btn nge-hunt-btn--gold" :disabled="!!busy || gems <= 0 || hunt.you.left <= 0" @click="submit($event)">
            {{ busy === 'submit' ? 'Checking…' : 'Submit' }}
          </button>
        </div>
        <p class="nge-hunt-fine">{{ hunt.you.left === 1 ? '1 answer left' : `${hunt.you.left} answers left` }}. At most {{ hunt.max_points }} gems per answer. Your best answer counts.</p>
        <div v-if="resultLine" class="nge-hunt-result" role="status">{{ resultLine }}</div>
        <p v-if="hunt.you.best" class="nge-hunt-best">Your best: {{ hunt.you.best }} of {{ hunt.target_count }}<template v-if="hunt.you.tier">, {{ TIER_WORD[hunt.you.tier] }} so far</template>.</p>
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

      <section class="nge-hunt-tiers" aria-label="Prizes">
        <div v-for="t in TIERS" :key="t" class="nge-hunt-tier" :class="{ 'nge-hunt-tier--yours': hunt.you.tier === t }">
          <span class="nge-hunt-medal" :class="`nge-hunt-medal--${t}`">{{ TIER_WORD[t] }}</span>
          <span>find {{ need(t) }}</span>
        </div>
      </section>

      <section v-if="hunt.board.length && phase !== 'announced'" class="nge-hunt-board" aria-label="Top hunters">
        <div class="nge-hunt-board-title">Top hunters</div>
        <ol>
          <li v-for="b in hunt.board" :key="b.rank" :class="{ 'nge-hunt-board--you': b.you }">
            <span class="nge-hunt-rank">{{ b.rank }}</span>
            <span class="nge-hunt-who">{{ b.name }}</span>
            <span class="nge-hunt-found">{{ b.found }} / {{ hunt.target_count }}</span>
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
.nge-hunt-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 0; }
.nge-hunt-eyebrow { font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #f5d142; }
.nge-hunt-x { background: none; border: none; color: #a9bbd3; font-size: 22px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-hunt-x:hover, .nge-hunt-x:focus-visible { color: #fff; }
.nge-hunt-body { padding: 6px 14px 14px; }
.nge-hunt-title { margin: 2px 0 10px; font: 600 18px 'Inter', system-ui, sans-serif; color: #fff; }
.nge-hunt-clock { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(90, 170, 255, 0.08); border: 1px solid rgba(90, 170, 255, 0.25); }
.nge-hunt-clock--live { background: rgba(245, 209, 66, 0.08); border-color: rgba(245, 209, 66, 0.35); }
.nge-hunt-clock-label { font-size: 12px; color: #a9bbd3; text-transform: uppercase; letter-spacing: 0.08em; }
.nge-hunt-clock-time { font: 600 20px 'Orbitron', 'Inter', sans-serif; color: #fff; font-variant-numeric: tabular-nums; }
.nge-hunt-when { margin: 6px 0 0; font-size: 12.5px; color: #a9bbd3; }
.nge-hunt-desc { margin: 10px 0 0; white-space: pre-wrap; }
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
</style>
