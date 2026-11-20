<script setup lang="ts">
/**
 * Time in Pyr for the team, on the Access page (Ames 2026-11-19: "see how much
 * time they're actually spending in Pyr and also maybe what area of the site
 * they're in"). Admins only, from team_time_days (supabase-team-time.sql):
 * every minute Pyr is open, and whether it was really in use (the tab in
 * front, mouse or keyboard in the last two minutes), by area and dataset.
 */
import { computed, onMounted, ref } from 'vue';
import { supabase } from '../supabase';
import { datasetDisplayName } from '../datasets';

interface Row { user_id: string; name: string; day: string; area: string; dataset: string; active_min: number; open_min: number; last_at: string }

const AREA_NAMES: Record<string, string> = {
  viewer: 'Viewer (editing)', tutorial: 'Tutorials', cell_library: 'Cell Library', quests: 'Quests',
  profile: 'Profile', leaderboard: 'Leaderboard', settings: 'Settings', admin: 'Admin pages',
};
const areaName = (a: string) => AREA_NAMES[a] || a.replace(/_/g, ' ');
const DAYS = 14;

const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const shown = ref(true);

/** A day key in Eastern time, as the server counts days. */
const etDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dayList = computed(() => {
  const out: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) out.push(etDay(new Date(Date.now() - i * 86_400_000)));
  return out;
});
const today = computed(() => dayList.value[dayList.value.length - 1]);
const week = computed(() => new Set(dayList.value.slice(-7)));

const hm = (min: number) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 2) return 'in Pyr now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

const people = computed(() => {
  const by = new Map<string, Row[]>();
  for (const r of rows.value) by.set(r.user_id, [...(by.get(r.user_id) || []), r]);
  return [...by.entries()].map(([id, rs]) => {
    const sum = (f: (r: Row) => boolean, k: 'active_min' | 'open_min') => rs.filter(f).reduce((s, r) => s + r[k], 0);
    const perDay = dayList.value.map(d => ({ day: d, active: sum(r => r.day === d, 'active_min'), open: sum(r => r.day === d, 'open_min') }));
    const wk = (r: Row) => week.value.has(r.day);
    const areas = new Map<string, number>();
    const sets = new Map<string, number>();
    for (const r of rs.filter(wk)) {
      areas.set(r.area, (areas.get(r.area) || 0) + r.active_min);
      if (r.dataset) sets.set(r.dataset, (sets.get(r.dataset) || 0) + r.active_min);
    }
    const weekActive = sum(wk, 'active_min');
    const pct = (n: number) => weekActive ? Math.round(n / weekActive * 100) : 0;
    return {
      id, name: rs[0].name,
      todayActive: sum(r => r.day === today.value, 'active_min'), todayOpen: sum(r => r.day === today.value, 'open_min'),
      weekActive, weekOpen: sum(wk, 'open_min'),
      daysActive: perDay.slice(-7).filter(d => d.active > 0).length,
      perDay,
      areas: [...areas].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([a, n]) => ({ name: areaName(a), pct: pct(n) })),
      datasets: [...sets].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, n]) => ({ name: datasetDisplayName(d) || d, pct: pct(n) })),
      last: rs.reduce((a, r) => (r.last_at > a ? r.last_at : a), ''),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
});
const barMax = computed(() => Math.max(60, ...people.value.flatMap(p => p.perDay.map(d => d.open))));
const since = computed(() => rows.value.reduce((a, r) => (!a || r.day < a ? r.day : a), ''));

onMounted(async () => {
  const from = dayList.value[0];
  const { data, error: e } = await supabase.from('team_time_days')
    .select('user_id,name,day,area,dataset,active_min,open_min,last_at').gte('day', from).order('day', { ascending: false }).limit(500);
  loading.value = false;
  if (e) { error.value = /does not exist|relation|schema cache/i.test(e.message) ? 'Time in Pyr is not set up on the database yet.' : e.message; return; }
  rows.value = (data ?? []) as Row[];
});
</script>

<template>
  <section class="tt" aria-label="Time in Pyr">
    <button type="button" class="tt-head" :aria-expanded="shown" @click="shown = !shown">
      <span class="tt-title">Time in Pyr</span>
      <span class="tt-sub">The team, the last {{ DAYS }} days. Active means Pyr was in front and in use; open counts every minute a tab was open.<template v-if="since"> Counted since {{ since }}.</template></span>
      <span class="tt-caret" aria-hidden="true">{{ shown ? '▾' : '▸' }}</span>
    </button>
    <template v-if="shown">
      <p v-if="loading" class="tt-quiet">Reading…</p>
      <p v-else-if="error" class="tt-quiet">{{ error }}</p>
      <p v-else-if="!people.length" class="tt-quiet">Nothing counted yet. Time starts counting the next time each of you opens Pyr.</p>
      <div v-else class="tt-grid">
        <article v-for="p in people" :key="p.id" class="tt-card">
          <header class="tt-card-head">
            <b class="tt-name">{{ p.name }}</b>
            <span class="tt-last">{{ p.last ? ago(p.last) : '' }}</span>
          </header>
          <div class="tt-nums">
            <div><b>{{ hm(p.todayActive) }}</b><span>active today</span><i>{{ hm(p.todayOpen) }} open</i></div>
            <div><b>{{ hm(p.weekActive) }}</b><span>active, last 7 days</span><i>{{ hm(p.weekOpen) }} open · on {{ p.daysActive }} of 7 days</i></div>
          </div>
          <div class="tt-bars" role="img" :aria-label="`Minutes active each day, the last ${DAYS} days`">
            <div v-for="d in p.perDay" :key="d.day" class="tt-bar" :title="`${d.day}: ${hm(d.active)} active, ${hm(d.open)} open`">
              <span class="tt-bar-open" :style="{ height: (d.open / barMax * 100) + '%' }"></span>
              <span class="tt-bar-active" :style="{ height: (d.active / barMax * 100) + '%' }"></span>
            </div>
          </div>
          <div v-if="p.areas.length" class="tt-chips"><span class="tt-k">Where, last 7 days</span>
            <span v-for="a in p.areas" :key="a.name" class="tt-chip">{{ a.name }} <b>{{ a.pct }}%</b></span>
          </div>
          <div v-if="p.datasets.length" class="tt-chips"><span class="tt-k">Datasets</span>
            <span v-for="d in p.datasets" :key="d.name" class="tt-chip tt-chip--ds">{{ d.name }} <b>{{ d.pct }}%</b></span>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style>
.tt { margin: 0 0 14px; border: 1px solid rgba(110,150,220,.25); border-radius: 10px; background: rgba(14,22,40,.75); }
.tt-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; width: 100%; padding: 10px 14px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.tt-title { font-weight: 700; font-size: 15px; color: #eef4ff; }
.tt-sub { color: #93a8c6; font-size: 12.5px; flex: 1; min-width: 240px; }
.tt-caret { color: #93a8c6; }
.tt-quiet { margin: 0; padding: 0 14px 12px; color: #93a8c6; }
.tt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; padding: 0 14px 14px; }
.tt-card { display: flex; flex-direction: column; gap: 9px; padding: 11px 12px; border-radius: 9px; border: 1px solid rgba(110,150,220,.25); background: rgba(24,38,66,.9); }
.tt-card-head { display: flex; align-items: baseline; gap: 8px; }
.tt-name { color: #f2f7ff; font-size: 15px; }
.tt-last { margin-left: auto; color: #93a8c6; font-size: 12px; }
.tt-nums { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tt-nums > div { display: flex; flex-direction: column; }
.tt-nums b { font-size: 19px; color: #9fe0b8; font-variant-numeric: tabular-nums; }
.tt-nums span { color: #c9d7ea; font-size: 12px; }
.tt-nums i { color: #8197b5; font-size: 11.5px; font-style: normal; }
.tt-bars { display: grid; grid-template-columns: repeat(14, 1fr); gap: 3px; align-items: end; height: 44px; }
.tt-bar { position: relative; height: 100%; }
.tt-bar span { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 2px 2px 0 0; }
.tt-bar-open { background: rgba(127,160,210,.25); }
.tt-bar-active { background: #5fcf8f; }
.tt-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.tt-k { color: #8197b5; font-size: 11.5px; margin-right: 2px; }
.tt-chip { padding: 2px 8px; border-radius: 999px; background: rgba(60,90,150,.35); color: #dbe6f5; font-size: 12px; }
.tt-chip b { color: #9fd3ff; font-weight: 700; }
.tt-chip--ds b { color: #f5c76a; }
</style>
