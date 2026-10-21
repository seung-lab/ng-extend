<script setup lang="ts">
/**
 * TestTriesTab: Admin Hub > Test tries (Ames, 2026-10-21: "we need a way for
 * admins to see the results"). Every Proofreading Test try, newest first,
 * with its score. Open one for what was fixed, missed and damaged, and look
 * at the player's cell as they left it (src/proofreading-test-review.ts).
 */
import { ref, computed, onMounted } from 'vue';
import { listTestTries, loadTestTry, reviewTryInView, reviewingTry, tryParts, outcomeWord, playerName, removeFromLine,
  type TestTriesList, type TestTry, type TestTryDetail } from '../proofreading-test-review';

const data = ref<TestTriesList | null>(null);
const loading = ref(false);
const error = ref('');
const openId = ref<number | null>(null);
const details = ref<Record<number, TestTryDetail>>({});
const detailError = ref<Record<number, string>>({});
const showAll = ref<Record<string, boolean>>({});
const busy = ref(0);

type Filter = 'scored' | 'all';
const filter = ref<Filter>('scored');

async function load() {
  loading.value = true; error.value = '';
  try {
    data.value = await listTestTries();
    // Back from the view: the try just looked at stays open.
    const back = reviewingTry.value?.id;
    if (back) { openId.value = back; details.value[back] = reviewingTry.value!; }
  } catch (e: any) { error.value = e?.message || 'The tries could not be loaded.'; }
  finally { loading.value = false; }
}
onMounted(load);

/** Scored: passes and fails, and unfinished tries whose cell was kept. */
const tries = computed(() => (data.value?.tries ?? []).filter(t => filter.value === 'all' || t.outcome === 'pass' || t.outcome === 'fail' || (t.outcome === 'expired' && !!t.end_root)));
const scoredCount = computed(() => (data.value?.tries ?? []).filter(t => t.outcome === 'pass' || t.outcome === 'fail').length);
const passCount = computed(() => (data.value?.tries ?? []).filter(t => t.outcome === 'pass').length);

async function toggle(t: TestTry) {
  if (openId.value === t.id) { openId.value = null; return; }
  openId.value = t.id;
  if (details.value[t.id] || t.outcome === null) return;
  busy.value = t.id; delete detailError.value[t.id];
  try { details.value[t.id] = await loadTestTry(t.id); }
  catch (e: any) { detailError.value[t.id] = e?.message || 'That try could not be loaded.'; }
  finally { busy.value = 0; }
}

const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
/** How long a scored try took. An unfinished try's end is only when the
 *  server next noticed, so it gets none. */
function took(t: TestTry): string {
  if (!t.submitted_at || !t.started_at || (t.outcome !== 'pass' && t.outcome !== 'fail')) return '';
  const m = Math.round((Date.parse(t.submitted_at) - Date.parse(t.started_at)) / 60000);
  return m < 1 ? 'under a minute' : `${m} min`;
}
const n = (v: number) => v.toLocaleString('en-US');
const plural = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;

/** One line under the name: what they did, in counts. */
function tally(t: TestTry): string {
  if (t.found == null || t.errors == null) {
    if (t.outcome === 'expired') return t.end_root ? 'Left without submitting. Their cell was kept, not checked.' : 'Left without submitting, before cells were kept.';
    return t.outcome === null ? 'Working on it now, or left without the server hearing yet.' : '';
  }
  const bits = [`${t.found} of ${plural(t.errors, 'mistake')} fixed`];
  if (t.ends_total) bits.push(`${t.ends_found ?? 0} of ${t.ends_total} ends marked`);
  bits.push(t.damaged ? `${plural(t.damaged, 'real branch', 'real branches')} cut off` : 'nothing damaged');
  return bits.join(' · ');
}
const chip = (t: TestTry) => t.outcome === 'pass' ? 'pass' : t.outcome === 'fail' ? 'fail' : 'other';
const FIRST = 8;
/** Take someone out of the line (Ames, 2026-10-21). */
const removing = ref('');
async function takeOut(userId: string) {
  removing.value = userId; error.value = '';
  try { await removeFromLine(userId); await load(); }
  catch (e: any) { error.value = e?.message || 'They were not taken out of the line.'; }
  finally { removing.value = ''; }
}
const turnUntil = (iso: string) => new Date(Date.parse(iso) + 10 * 60000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** Each opened try's checks, grouped once. */
const partsOf = computed(() => Object.fromEntries(Object.entries(details.value).map(([id, d]) => [id, tryParts(d)])));
const PARTS = [
  { key: 'damage', title: 'Real branches cut off', why: 'Each of these fails the test on its own.' },
  { key: 'missed', title: 'Mistakes missed, biggest first', why: 'The number is what each was worth: the piece’s size in supervoxels.' },
  { key: 'fixed', title: 'Mistakes fixed', why: '' },
] as const;
</script>

<template>
  <section class="nge-ttr">
    <div class="nge-ttr-top">
      <h2>Proofreading Test tries</h2>
      <span class="nge-ttr-sub" v-if="data">{{ plural(scoredCount, 'scored try', 'scored tries') }} · {{ passCount }} passed</span>
      <button class="nge-ttr-filter nge-ttr-refresh" :disabled="loading" title="Look for new tries" @click="load">Refresh</button>
      <div class="nge-ttr-filters" role="tablist">
        <button class="nge-ttr-filter" :class="{ 'nge-ttr-filter--on': filter === 'scored' }" role="tab" :aria-selected="filter === 'scored'" @click="filter = 'scored'">Scored</button>
        <button class="nge-ttr-filter" :class="{ 'nge-ttr-filter--on': filter === 'all' }" role="tab" :aria-selected="filter === 'all'" @click="filter = 'all'">All</button>
      </div>
    </div>

    <p v-if="data?.test && data.key" class="nge-ttr-how">
      The test now: {{ plural(data.key.mistakes, 'mistake') }} to fix, {{ plural(data.key.ends, 'branch end') }} to mark,
      {{ plural(data.key.protect, 'real branch tip', 'real branch tips') }} not to cut off. A pass needs {{ data.test.pass_mark }} percent of
      {{ n(data.key.points) }} points.
      <template v-if="data.test.holder"> <b>{{ data.test.holder }}</b> has the cell now<template v-if="data.test.deadline_at">, until {{ when(data.test.deadline_at) }}</template>.</template>
      <template v-else> Nobody has the cell now.</template>
    </p>
    <div v-if="data?.line?.length" class="nge-ttr-line">
      <h3>In line ({{ data.line.length }})</h3>
      <ol>
        <li v-for="p in data.line" :key="p.user_id">
          <span class="nge-ttr-line-name">{{ p.username || 'A player' }}</span>
          <span class="nge-ttr-meta">joined {{ when(p.joined_at) }}<template v-if="p.called_at">, called: their turn until {{ turnUntil(p.called_at) }}</template></span>
          <button class="nge-ttr-btn nge-ttr-btn--small" :disabled="removing === p.user_id" @click="takeOut(p.user_id)">Take out of the line</button>
        </li>
      </ol>
    </div>
    <p v-if="data && !data.kept" class="nge-ttr-warn">Players' cells are not being kept yet: run supabase-proofreading-test-tries.sql in Supabase.</p>
    <p v-if="error" class="nge-ttr-err" role="alert">{{ error }}</p>
    <p v-if="loading" class="nge-ttr-how">Loading…</p>
    <p v-else-if="data && !tries.length && !error" class="nge-ttr-how">No tries here yet.</p>

    <article v-for="t in tries" :key="t.id" class="nge-ttr-card" :class="`nge-ttr-card--${chip(t)}`">
      <button class="nge-ttr-head" :aria-expanded="openId === t.id" @click="toggle(t)">
        <span class="nge-ttr-name">{{ playerName(t) }}</span>
        <span class="nge-ttr-meta">{{ when(t.started_at) }}<template v-if="took(t)"> · took {{ took(t) }}</template><template v-if="t.timed_out"> · time ran out</template></span>
        <span class="nge-ttr-status">{{ outcomeWord(t) }}<template v-if="t.percent != null"> · {{ t.percent }}%</template></span>
        <span class="nge-ttr-tally">{{ tally(t) }}</span>
      </button>

      <div v-if="openId === t.id" class="nge-ttr-body">
        <p v-if="busy === t.id" class="nge-ttr-how">Loading the try…</p>
        <p v-else-if="detailError[t.id]" class="nge-ttr-err" role="alert">{{ detailError[t.id] }}</p>
        <template v-else-if="details[t.id]">
          <p v-if="t.outcome === 'expired'" class="nge-ttr-note">
            {{ playerName(t) }} left without submitting, so this try has no score. What is below is the cell as they left it; the branch ends they marked never reached the server.
          </p>
          <p v-if="t.error" class="nge-ttr-note">Server note: {{ t.error }}</p>

          <template v-for="part in PARTS" :key="part.key">
            <div v-if="partsOf[t.id][part.key].length" class="nge-ttr-part" :class="`nge-ttr-part--${part.key}`">
              <h3>{{ part.title }} ({{ partsOf[t.id][part.key].length }})</h3>
              <p v-if="part.why" class="nge-ttr-why">{{ part.why }}</p>
              <ul>
                <li v-for="(c, i) in (showAll[`${t.id}${part.key}`] ? partsOf[t.id][part.key] : partsOf[t.id][part.key].slice(0, FIRST))" :key="i">
                  <span>{{ c.label }}</span><span v-if="part.key !== 'damage'" class="nge-ttr-worth">{{ n(c.weight) }}</span>
                </li>
              </ul>
              <button v-if="partsOf[t.id][part.key].length > FIRST" class="nge-ttr-more" @click="showAll[`${t.id}${part.key}`] = !showAll[`${t.id}${part.key}`]">
                {{ showAll[`${t.id}${part.key}`] ? 'Show fewer' : `Show all ${partsOf[t.id][part.key].length}` }}
              </button>
            </div>
          </template>
          <p v-if="t.outcome !== 'expired' && (partsOf[t.id].endsFound.length + partsOf[t.id].endsMissed.length)" class="nge-ttr-ends">
            Branch ends: {{ partsOf[t.id].endsFound.length }} of {{ partsOf[t.id].endsFound.length + partsOf[t.id].endsMissed.length }} marked,
            from {{ plural(details[t.id].given.length, 'point') }} placed<template v-if="details[t.id].stray">, {{ details[t.id].stray }} of them near no end</template>.
          </p>

          <div class="nge-ttr-acts">
            <button v-if="details[t.id].end_root" class="nge-ttr-btn nge-ttr-btn--look" @click="reviewTryInView(details[t.id])">Look at their cell</button>
            <span v-else class="nge-ttr-why">Their cell was not kept: cells are kept from Oct 21 on.</span>
            <span v-if="details[t.id].end_root" class="nge-ttr-root" title="Their cell's segment ID as they left it">{{ details[t.id].end_root }}</span>
          </div>
        </template>
        <p v-else-if="t.outcome === null" class="nge-ttr-how">Nothing to show until this try ends.</p>
      </div>
    </article>
  </section>
</template>

<style scoped>
.nge-ttr { font-size: 1rem; line-height: 1.5; color: #f1f5f9; padding: 16px; }
.nge-ttr h2 { font-size: 1.25rem; margin: 0; }
.nge-ttr-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.nge-ttr-sub { color: #9fb0c4; }
.nge-ttr-refresh { margin-left: auto; }
.nge-ttr-filters { display: flex; gap: 6px; }
.nge-ttr-filter { font: inherit; font-size: 0.9rem; padding: 4px 12px; border-radius: 6px; border: 1px solid #3b4b5e; background: #152434; color: #c9d6e6; cursor: pointer; }
.nge-ttr-filter--on { border-color: #9fd3ff; color: #fff; background: #183049; }
.nge-ttr-how { color: #b6c4d4; margin: 10px 0; }
.nge-ttr-warn { color: #f5d142; margin: 10px 0; }
.nge-ttr-err { color: #f5d142; }
.nge-ttr-card { border: 1px solid #2f4155; border-radius: 10px; margin: 10px 0; background: #0f1b28; }
.nge-ttr-card--pass { border-color: rgba(124, 255, 178, 0.6); }
.nge-ttr-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: none; padding: 12px 14px; cursor: pointer; }
.nge-ttr-name { font-weight: 600; font-size: 1.05rem; }
.nge-ttr-meta { color: #9fb0c4; font-size: 0.9rem; }
.nge-ttr-status { margin-left: auto; font-size: 0.85rem; padding: 2px 8px; border-radius: 6px; background: #22344a; }
.nge-ttr-card--pass .nge-ttr-status { background: #1b3a2c; color: #7CFFB2; }
.nge-ttr-card--fail .nge-ttr-status { color: #f5d142; }
.nge-ttr-tally { flex-basis: 100%; color: #9fb0c4; font-size: 0.9rem; }
.nge-ttr-body { padding: 0 14px 14px; }
.nge-ttr-note { color: #e4ecf5; background: rgba(159, 211, 255, 0.08); border-radius: 6px; padding: 6px 10px; margin: 0 0 10px; }
.nge-ttr-part { border-top: 1px solid #22344a; padding-top: 8px; margin-top: 8px; }
.nge-ttr-part h3 { font-size: 0.95rem; margin: 0; font-weight: 600; }
.nge-ttr-part--damage h3 { color: #e06060; }
.nge-ttr-part--missed h3 { color: #f5d142; }
.nge-ttr-part--fixed h3 { color: #7CFFB2; }
.nge-ttr-why { color: #9fb0c4; font-size: 0.85rem; margin: 2px 0 0; }
.nge-ttr-part ul { margin: 4px 0 0; padding-left: 18px; columns: 2 320px; column-gap: 24px; }
.nge-ttr-part li { break-inside: avoid; color: #dce6f5; display: flex; gap: 12px; }
.nge-ttr-worth { margin-left: auto; color: #9fb0c4; font-variant-numeric: tabular-nums; }
.nge-ttr-more { font: inherit; font-size: 0.85rem; color: #9fd3ff; background: none; border: none; padding: 0; margin-top: 4px; cursor: pointer; }
.nge-ttr-ends { border-top: 1px solid #22344a; padding-top: 8px; margin: 8px 0 0; color: #dce6f5; }
.nge-ttr-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
.nge-ttr-btn { font: inherit; font-size: 0.95rem; padding: 5px 12px; border-radius: 6px; border: 1px solid #74859a; background: #152434; color: #f1f5f9; cursor: pointer; }
.nge-ttr-btn--look { border-color: #9fd3ff; color: #fff; background: #183049; }
.nge-ttr-line { border: 1px solid #2f4155; border-radius: 10px; padding: 8px 14px; margin: 10px 0; background: #0f1b28; }
.nge-ttr-line h3 { font-size: 0.95rem; margin: 0 0 4px; color: #9fd3ff; }
.nge-ttr-line ol { margin: 0; padding-left: 20px; }
.nge-ttr-line li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 3px 0; }
.nge-ttr-line-name { font-weight: 600; }
.nge-ttr-btn--small { font-size: 0.8rem; padding: 2px 8px; margin-left: auto; }
.nge-ttr-root { color: #9fb0c4; font-size: 0.85rem; font-variant-numeric: tabular-nums; user-select: all; }
</style>
