<script setup lang="ts">
/**
 * Server status (Nseraf, report 554: "in EW we had a 'backlog' in profile
 * which showed if ... it's slowed down (having problems) or crashed. ... a
 * server status display ... which will only show if retina/CAVE/MEC etc
 * server(s) are Okay/ slow/ down").
 *
 * For each dataset players proofread: the lab's proofreading server (cuts,
 * merges, cell IDs) and the image server (the 2D pictures), each asked for a
 * small file, timed. Checked when the box opens and every minute while it
 * is open; Check again asks at once.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { DATASETS } from '../datasets';
import { authHeaders } from '../widgets/pcg_service';

type State = 'checking' | 'ok' | 'slow' | 'down';
interface Check { label: string; state: State; ms?: number; note?: string }
interface Row { id: string; name: string; checks: Check[] }

const SLOW_MS = 2500;
const DOWN_MS = 12000;

const sets = DATASETS.filter(d => d.cellTasks && !d.hidden);
const rows = ref<Row[]>(sets.map(d => ({ id: d.id, name: d.label, checks: [
  { label: 'Proofreading', state: 'checking' as State },
  { label: '2D images', state: 'checking' as State },
] })));
const checkedAt = ref<Date | null>(null);

function segUrl(d: typeof sets[number]): { server: string; url: string } | null {
  const seg = d.layers.find(l => l.type === 'segmentation');
  const raw = typeof seg?.source === 'string' ? seg.source : (seg?.source as any)?.url;
  const m = /^graphene:\/\/(?:middleauth\+)?(https:\/\/[^/]+)\/segmentation\/table\/([^/?#]+)/.exec(raw || '');
  // The graph's info, as neuroglancer reads it (the api/v1 path answers 404).
  return m ? { server: m[1], url: `${m[1]}/segmentation/table/${m[2]}/info` } : null;
}
function imageUrl(d: typeof sets[number]): string | null {
  const img = d.layers.find(l => l.type === 'image');
  const src = typeof img?.source === 'string' ? img.source : (img?.source as any)?.url;
  if (!src) return null;
  const s = String(src).replace(/^precomputed:\/\//, '').replace(/\/$/, '');
  if (s.startsWith('gs://')) return `https://storage.googleapis.com/${s.slice(5)}/info`;
  if (s.startsWith('https://')) return `${s}/info`;
  return null;
}

async function timed(url: string, init?: RequestInit): Promise<Check> {
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(DOWN_MS) });
    const ms = Math.round(performance.now() - started);
    if (res.status === 401 || res.status === 403) return { label: '', state: 'ok', ms, note: 'answering' };
    if (!res.ok) return { label: '', state: res.status >= 500 ? 'down' : 'slow', ms, note: `error ${res.status}` };
    return { label: '', state: ms > SLOW_MS ? 'slow' : 'ok', ms };
  } catch (e: any) {
    return { label: '', state: 'down', note: e?.name === 'TimeoutError' ? 'no answer' : 'unreachable' };
  }
}

let busy = false;
async function checkAll() {
  if (busy) return;
  busy = true;
  try {
    await Promise.all(sets.map(async (d, i) => {
      const seg = segUrl(d), img = imageUrl(d);
      const [a, b] = await Promise.all([
        seg ? timed(seg.url, { headers: authHeaders(seg.server) }) : Promise.resolve<Check>({ label: '', state: 'ok', note: 'n/a' }),
        img ? timed(img) : Promise.resolve<Check>({ label: '', state: 'ok', note: 'n/a' }),
      ]);
      rows.value[i].checks = [{ ...a, label: 'Proofreading' }, { ...b, label: '2D images' }];
    }));
    checkedAt.value = new Date();
  } finally { busy = false; }
}

const WORD: Record<State, string> = { checking: 'Checking…', ok: 'OK', slow: 'Slow', down: 'Down' };
let timer = 0;
onMounted(() => { void checkAll(); timer = window.setInterval(() => { if (!document.hidden) void checkAll(); }, 60_000); });
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <section class="nge-srv" aria-label="Server status">
    <header class="nge-srv-head">
      <span class="nge-srv-title">Server status</span>
      <span class="nge-srv-sub">Whether the lab's servers are answering, and how fast.<template v-if="checkedAt"> Checked {{ checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}.</template></span>
      <button type="button" class="nge-srv-again" @click="checkAll">Check again</button>
    </header>
    <div class="nge-srv-grid">
      <div v-for="r in rows" :key="r.id" class="nge-srv-row">
        <span class="nge-srv-name">{{ r.name }}</span>
        <span v-for="c in r.checks" :key="c.label" class="nge-srv-check" :class="`nge-srv--${c.state}`"
              :title="c.ms != null ? `${c.label}: answered in ${(c.ms / 1000).toFixed(1)} s` : c.label">
          <i aria-hidden="true"></i>{{ c.label }}: <b>{{ WORD[c.state] }}</b><span v-if="c.ms != null && c.state !== 'checking'" class="nge-srv-ms"> {{ (c.ms / 1000).toFixed(1) }} s</span>
        </span>
      </div>
    </div>
    <p class="nge-srv-foot">Slow or Down usually clears up on its own. If cuts, merges or images fail for a long time, send a bug report.</p>
  </section>
</template>

<style>
.nge-srv { margin: 0 0 14px; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(110,150,220,.25); background: rgba(14,22,40,.75); }
.nge-srv-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.nge-srv-title { font-weight: 700; font-size: 15px; color: #eef4ff; }
.nge-srv-sub { color: #93a8c6; font-size: 12.5px; flex: 1; min-width: 220px; }
.nge-srv-again { padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(120,170,255,.4); background: rgba(60,100,170,.25); color: #dbe8ff; font: inherit; font-size: 12px; cursor: pointer; }
.nge-srv-again:hover { background: rgba(80,130,210,.35); }
.nge-srv-grid { display: flex; flex-direction: column; gap: 6px; }
.nge-srv-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 7px 10px; border-radius: 8px; background: rgba(24,38,66,.85); }
.nge-srv-name { min-width: 170px; color: #f2f7ff; font-weight: 600; font-size: 13px; }
.nge-srv-check { display: inline-flex; align-items: center; gap: 6px; color: #c9d7ea; font-size: 12.5px; }
.nge-srv-check i { width: 9px; height: 9px; border-radius: 50%; background: #6b7a90; }
.nge-srv--ok i { background: #5fcf8f; box-shadow: 0 0 6px rgba(95,207,143,.7); }
.nge-srv--slow i { background: #f5c76a; box-shadow: 0 0 6px rgba(245,199,106,.7); }
.nge-srv--down i { background: #ff6b6b; box-shadow: 0 0 6px rgba(255,107,107,.7); }
.nge-srv--checking i { animation: nge-srv-pulse 1s ease-in-out infinite; }
.nge-srv--ok b { color: #9fe0b8; } .nge-srv--slow b { color: #f5c76a; } .nge-srv--down b { color: #ff9a9a; }
.nge-srv-ms { color: #8197b5; font-variant-numeric: tabular-nums; }
.nge-srv-foot { margin: 8px 0 0; color: #8197b5; font-size: 12px; }
@keyframes nge-srv-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .nge-srv--checking i { animation: none; } }
</style>
