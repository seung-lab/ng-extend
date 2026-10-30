<script setup lang="ts">
/**
 * TutorialTimesTab: Admin Hub > Tutorial times (Ames, 2026-10-29). How long
 * players spend on each tutorial box, from tutorial_step_events
 * (src/tutorial_timing.ts). Per tutorial, every box with its median and
 * slowest tenth, how often Help me was pressed and how many left there; and
 * the latest runs, one line per player per go.
 */
import { ref, computed, onMounted } from 'vue';
import { supabase } from '../supabase';
import { TUTORIAL_NAMES } from '../tutorial_edits';

interface Stat { tutorial: number; step: number; last_box: string | null; n: number; players: number; median_s: number; p90_s: number; help_rate: number; closes: number }
interface Ev { user_id: string; tutorial: number; step: number; box: string | null; seconds: number; left_by: string; help: number; run: string | null; created_at: string }

const stats = ref<Stat[]>([]);
const events = ref<Ev[]>([]);
const names = ref<Record<string, string>>({});
const loading = ref(false);
const error = ref('');
const pick = ref<number | null>(null);

async function load() {
  loading.value = true; error.value = '';
  try {
    const [s, e] = await Promise.all([
      supabase.from('tutorial_step_stats').select('*').limit(500),
      supabase.from('tutorial_step_events').select('user_id,tutorial,step,box,seconds,left_by,help,run,created_at').order('created_at', { ascending: false }).limit(500),
    ]);
    if (s.error) throw s.error;
    if (e.error) throw e.error;
    stats.value = (s.data ?? []) as Stat[];
    events.value = (e.data ?? []) as Ev[];
    const ids = [...new Set(events.value.map(x => x.user_id))].slice(0, 100);
    if (ids.length) {
      const { data } = await supabase.from('users').select('id,display_name').in('id', ids);
      names.value = Object.fromEntries(((data ?? []) as any[]).map(u => [u.id, u.display_name || 'Player']));
    }
    if (pick.value == null) pick.value = tutorials.value[0] ?? null;
  } catch (err: any) {
    error.value = err?.message || 'The times could not be loaded.';
  } finally { loading.value = false; }
}
onMounted(load);

const tutorials = computed(() => [...new Set(stats.value.map(s => s.tutorial))].sort((a, b) => a - b));
const name = (t: number) => TUTORIAL_NAMES[t] ?? `Tutorial ${t}`;
const rows = computed(() => stats.value.filter(s => s.tutorial === pick.value).sort((a, b) => a.step - b.step));
/** The slowest median in this tutorial, for the bars. */
const maxMedian = computed(() => Math.max(1, ...rows.value.map(r => Number(r.median_s) || 0)));
const secs = (v: number) => { const s = Math.round(Number(v) || 0); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim(); };
const pct = (v: number) => `${Math.round((Number(v) || 0) * 100)}%`;

/** The latest runs: one line per player per go at a tutorial. */
const runs = computed(() => {
  const by = new Map<string, Ev[]>();
  for (const e of events.value) {
    if (pick.value != null && e.tutorial !== pick.value) continue;
    const k = e.run || `${e.user_id}-${e.tutorial}-${e.created_at.slice(0, 13)}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(e);
  }
  return [...by.values()].map(list => {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = sorted[sorted.length - 1];
    return {
      who: names.value[last.user_id] ?? 'Player',
      when: new Date(last.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      boxes: new Set(sorted.map(e => e.step)).size,
      total: sorted.reduce((a, e) => a + e.seconds, 0),
      help: sorted.reduce((a, e) => a + e.help, 0),
      ended: last.left_by === 'close' ? `left at box ${last.step + 1}` : `last box ${last.step + 1}, ${last.left_by}`,
      slowest: sorted.reduce((m, e) => e.seconds > m.seconds ? e : m, sorted[0]),
    };
  }).slice(0, 60);
});
</script>

<template>
  <div class="nge-tt">
    <div class="nge-tt-top">
      <h2>Tutorial times</h2>
      <span class="nge-tt-sub">How long players spend on each box. A box is counted up to 10 minutes.</span>
      <button class="nge-hud-btn nge-hud-btn--sm nge-tt-refresh" :disabled="loading" @click="load">{{ loading ? 'Loading' : 'Refresh' }}</button>
    </div>
    <p v-if="error" class="nge-tt-err">{{ error }}</p>
    <p v-else-if="!loading && !stats.length" class="nge-tt-how">No times yet. They arrive as players go through tutorials.</p>
    <div v-if="tutorials.length" class="nge-tt-picks">
      <button v-for="t in tutorials" :key="t" class="nge-tt-pick" :class="{ 'nge-tt-pick--on': pick === t }" @click="pick = t">{{ name(t) }}</button>
    </div>
    <table v-if="rows.length" class="nge-tt-table">
      <thead><tr><th>Box</th><th>Title</th><th>Seen</th><th>Players</th><th>Median</th><th>Slowest 10%</th><th>Help me</th><th>Left here</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.step">
          <td>{{ r.step + 1 }}</td>
          <td class="nge-tt-title">{{ r.last_box || '' }}</td>
          <td>{{ r.n }}</td>
          <td>{{ r.players }}</td>
          <td class="nge-tt-median"><span class="nge-tt-bar" :style="{ width: (Number(r.median_s) / maxMedian * 100) + '%' }"></span><span>{{ secs(r.median_s) }}</span></td>
          <td>{{ secs(r.p90_s) }}</td>
          <td>{{ pct(r.help_rate) }}</td>
          <td :class="{ 'nge-tt-hot': r.closes > 0 }">{{ r.closes }}</td>
        </tr>
      </tbody>
    </table>
    <h3 v-if="runs.length" class="nge-tt-h3">Latest runs</h3>
    <ul v-if="runs.length" class="nge-tt-runs">
      <li v-for="(r, i) in runs" :key="i">
        <b>{{ r.who }}</b> <span class="nge-tt-sub">{{ r.when }}</span>
        · {{ r.boxes }} boxes in {{ secs(r.total) }} · {{ r.ended }}
        <template v-if="r.help"> · Help me {{ r.help }}×</template>
        · slowest: box {{ r.slowest.step + 1 }} ({{ secs(r.slowest.seconds) }})
      </li>
    </ul>
  </div>
</template>

<style scoped>
.nge-tt { font-size: 1rem; line-height: 1.5; color: #f1f5f9; padding: 16px; }
.nge-tt h2 { font-size: 1.25rem; margin: 0; }
.nge-tt-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.nge-tt-sub { color: #9fb0c4; font-size: 0.9rem; }
.nge-tt-refresh { margin-left: auto; }
.nge-tt-err { color: #f5d142; }
.nge-tt-how { color: #b6c4d4; }
.nge-tt-picks { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.nge-tt-pick { font: inherit; font-size: 0.9rem; padding: 4px 12px; border-radius: 6px; border: 1px solid #3b4b5e; background: #152434; color: #c9d6e6; cursor: pointer; }
.nge-tt-pick--on { border-color: #9fd3ff; color: #fff; background: #183049; }
.nge-tt-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.nge-tt-table th { text-align: left; color: #9fb0c4; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #2f4155; }
.nge-tt-table td { padding: 6px 8px; border-bottom: 1px solid #1d2c3c; vertical-align: top; }
.nge-tt-title { color: #dce6f5; max-width: 340px; }
.nge-tt-median { position: relative; min-width: 120px; }
.nge-tt-median span:last-child { position: relative; }
.nge-tt-bar { position: absolute; left: 0; top: 6px; bottom: 6px; background: rgba(126, 224, 255, 0.18); border-radius: 3px; }
.nge-tt-hot { color: #f5d142; font-weight: 600; }
.nge-tt-h3 { font-size: 1rem; margin: 18px 0 6px; }
.nge-tt-runs { margin: 0; padding-left: 18px; color: #dce6f5; font-size: 0.92rem; }
.nge-tt-runs li { margin: 3px 0; }
</style>
