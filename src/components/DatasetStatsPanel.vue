<script setup lang="ts">
/**
 * Dataset Stats: what has been done on one dataset as a whole, with a short
 * strip for the signed-in player's part in it. Not a second profile: the
 * profile is about a person, this is about the dataset.
 *
 * Every number is read from the views in supabase-dataset-stats.sql through
 * util/dataset_stats.ts. A part that can not be read says so; nothing is
 * ever filled in with a zero or a sample.
 *
 * These are counts of cells and edits. Not a scoring system.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import RollUp from 'components/RollUp.vue';
import GrowingCell from 'components/GrowingCell.vue';
import { canonicalDataset, currentDatasetTag, type DatasetEntry } from '../datasets';
import { datasetKey } from '../util/completion_rule';
import { datasetsWithStats, loadDatasetStats, statsKey, weeklySeries, type DatasetStats } from '../util/dataset_stats';
import { useProofreadingBackendStore } from '../store';

const emit = defineEmits({ hide: null });
/** Peek (desktop): no dim, the site stays usable, a click elsewhere puts it away.
 *  Embedded: the profile's Dataset Stats tab. No window of its own, and the
 *  parts sit side by side across the profile's width. */
const props = defineProps<{ peek?: boolean; embedded?: boolean; person?: StatsPerson | null }>();
/**
 * Whose part the amber strip shows. In someone else's profile it is that
 * person, not the reader (a player opened Ames's profile and saw their own
 * numbers under her name, 2026-10-06). Left out, it is the signed-in player.
 * Passed as null while the other person is still loading: no strip yet.
 */
interface StatsPerson { id: string; names: string[]; label: string; }
const backend = useProofreadingBackendStore();

type Phase = 'loading' | 'ready' | 'unavailable';
const phase = ref<Phase>('loading');
const datasets = ref<DatasetEntry[]>([]);
const active = ref<DatasetEntry | null>(null);
const stats = ref<DatasetStats | null>(null);
const reading = ref(false);
let ticket = 0;
const who = computed<{ id: string | null; names: string[] } | null>(() => (props.person === undefined
  ? { id: backend.userId, names: [backend.userName, backend.username] }
  : props.person));
/** "Your part", or "Ames's part" in her profile. */
const partTitle = computed(() => (props.person ? `${props.person.label}'s part` : 'Your part'));

async function read(ds: DatasetEntry) {
  const mine = ++ticket;
  reading.value = true;
  const s = await loadDatasetStats(ds, who.value ?? undefined);
  if (mine !== ticket) return;          // a newer dataset was picked meanwhile
  stats.value = s;
  reading.value = false;
}

function pick(ds: DatasetEntry) {
  if (active.value === ds) return;
  active.value = ds;
  stats.value = null;
  hoverWeek.value = null;
  void read(ds);
}

onMounted(async () => {
  const list = await datasetsWithStats();
  if (!list) { phase.value = 'unavailable'; return; }
  datasets.value = list;
  phase.value = 'ready';
  if (!list.length) return;
  // Open on the dataset on screen when it has anything to show.
  const here = datasetKey(canonicalDataset(currentDatasetTag()));
  pick(list.find(ds => statsKey(ds) === here) ?? list[0]);
});

// Signing in while the panel is open, or the profile moving to another
// person: read again so the strip is theirs.
watch(() => [who.value?.id, (who.value?.names ?? []).join('|')], () => { if (active.value) void read(active.value); });

// ── Progress: the figure and the bar come from the same three numbers ────
const progress = computed(() => stats.value?.progress ?? null);
const hasList = computed(() => !!progress.value && progress.value.total > 0);
/** Cells from the dataset's own records, when the game has no cell list for it. */
const outsideCells = computed(() => (hasList.value ? 0 : stats.value?.outsideCells ?? 0));
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctDone = computed(() => (progress.value ? share(progress.value.done, progress.value.total) : 0));
const pctClaimed = computed(() => (progress.value ? share(progress.value.claimed, progress.value.total) : 0));
/** A share of something small enough to round to nothing still happened. */
function shareText(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return '0%';
  const p = (part / whole) * 100;
  return p < 0.1 ? 'under 0.1%' : `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`;
}

// ── Cells per week ───────────────────────────────────────────────────────
const CHART_W = 320, CHART_H = 96, CHART_PAD = 4;
const series = computed(() => (stats.value?.weeks ? weeklySeries(stats.value.weeks) : []));
const hasCellWeeks = computed(() => series.value.some(w => w.cells > 0));
const weekMax = computed(() => Math.max(1, ...series.value.map(w => w.cells)));
const bars = computed(() => {
  const s = series.value, n = s.length;
  if (!n) return [];
  const slot = CHART_W / n, w = Math.max(1, Math.min(14, slot - 2));
  return s.map((wk, i) => {
    const h = wk.cells > 0 ? Math.max(1.5, (wk.cells / weekMax.value) * (CHART_H - CHART_PAD)) : 0;
    return { ...wk, i, x: i * slot + (slot - w) / 2, w, h, y: CHART_H - h };
  });
});
/** The running total of dated cells, drawn over the bars. */
const runningPath = computed(() => {
  const s = series.value, n = s.length;
  const top = s[n - 1]?.running ?? 0;
  if (n < 2 || !top) return '';
  const slot = CHART_W / n;
  return s.map((wk, i) => {
    const x = i * slot + slot / 2, y = CHART_H - (wk.running / top) * (CHART_H - CHART_PAD);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
});
const hoverWeek = ref<number | null>(null);
function onChartPoint(e: PointerEvent) {
  const el = e.currentTarget as SVGSVGElement, r = el.getBoundingClientRect(), n = series.value.length;
  if (!n || !r.width) return;
  hoverWeek.value = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
}
/** The week the readout describes: the one under the pointer, else the latest. */
const shownWeek = computed(() => {
  const s = series.value;
  if (!s.length) return null;
  return s[hoverWeek.value ?? s.length - 1] ?? null;
});
function weekLabel(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── By cell type ─────────────────────────────────────────────────────────
const typeRows = computed(() => {
  const t = stats.value?.types;
  if (!t) return [];
  return t.map(r => ({ ...r, total: r.done + r.left, pct: share(r.done, r.done + r.left) }))
    .filter(r => r.total > 0)
    // Largest first, cells with no predicted type last.
    .sort((a, b) => (a.type === null ? 1 : 0) - (b.type === null ? 1 : 0) || b.total - a.total);
});
/** Types are worth a chart only when the list names at least one. */
const hasTypes = computed(() => typeRows.value.some(r => r.type !== null));

// ── Work in the game, and your part ──────────────────────────────────────
const work = computed(() => stats.value?.work ?? null);
const pctSplits = computed(() => (work.value ? share(work.value.splits, work.value.edits) : 0));
const mine = computed(() => stats.value?.mine ?? null);
const nothingHere = computed(() =>
  !!stats.value && !hasList.value && !!work.value && work.value.edits === 0 && work.value.annotations === 0);

const readAt = computed(() => (stats.value
  ? new Date(stats.value.readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''));

// ── Peek: a click outside, or Escape, puts the panel away ────────────────
function onPeekPointerDown(e: PointerEvent) {
  const panel = document.querySelector('#nge-dsp-modal .nge-overlay');
  if (panel && !panel.contains(e.target as Node)) emit('hide');
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('hide'); }
onMounted(() => {
  if (props.embedded) return;        // the profile owns Escape and its own close
  document.addEventListener('keydown', onKey);
  if (props.peek) document.addEventListener('pointerdown', onPeekPointerDown, true);
});
onUnmounted(() => {
  ticket++;
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onPeekPointerDown, true);
});
</script>

<template>
  <component
    :is="props.embedded ? 'div' : ModalOverlay"
    :id="props.embedded ? undefined : 'nge-dsp-modal'"
    :class="props.embedded ? 'nge-dsp-embedded' : ['nge-dsp-modal', { 'nge-dsp-modal--peek': props.peek }]"
    @hide="emit('hide')"
  >
    <div class="nge-dsp-shell" :class="{ 'nge-dsp-shell--wide': props.embedded }">
      <div v-if="!props.embedded" class="nge-dsp-topbar">
        <button class="nge-dsp-exit" aria-label="Close" @click="emit('hide')">×</button>
      </div>

      <div v-if="!props.embedded" class="nge-dsp-hero">
        <div class="nge-dsp-hero-grid"></div>
        <div class="nge-dsp-title-rule"></div>
        <h2 class="nge-dsp-title">Dataset Stats</h2>
        <div class="nge-dsp-title-sub">{{ active ? active.label : 'What has been done on each dataset' }}</div>
        <div class="nge-dsp-title-rule"></div>
      </div>

      <div v-if="datasets.length > 1" class="nge-dsp-tabs" role="tablist" aria-label="Dataset">
        <button
          v-for="ds in datasets" :key="ds.id" role="tab" class="nge-dsp-tab"
          :class="{ 'nge-dsp-tab--active': active === ds }" :aria-selected="active === ds"
          @click="pick(ds)"
        >{{ ds.shortLabel }}</button>
      </div>

      <div v-if="props.embedded && active" class="nge-dsp-wide-title">{{ active.label }}</div>
      <div class="nge-dsp-content">
        <!-- Whole panel states -->
        <div v-if="phase === 'loading' || (phase === 'ready' && active && !stats)" class="nge-dsp-loading" role="status">
          <GrowingCell :size="110" />
          <div class="nge-dsp-loading-text">Reading the dataset</div>
        </div>
        <div v-else-if="phase === 'unavailable'" class="nge-dsp-note" role="status">
          Dataset stats are not available right now. Nothing is shown rather than a guess.
        </div>
        <div v-else-if="!datasets.length" class="nge-dsp-note" role="status">
          No dataset has a cell list or logged work yet.
        </div>

        <template v-else-if="stats">
          <!-- ── Progress ── -->
          <section class="nge-dsp-section nge-dsp-s-prog">
            <div class="nge-dsp-label">▌ Cells completed</div>
            <div v-if="!progress" class="nge-dsp-na">Not available right now.</div>
            <template v-else-if="!hasList && outsideCells > 0">
              <div class="nge-dsp-big">
                <span class="nge-dsp-big-num"><RollUp :value="outsideCells" /></span>
              </div>
              <div class="nge-dsp-big-sub">
                cell{{ outsideCells === 1 ? '' : 's' }} proofread by EyeWire II players
              </div>
              <div v-if="active?.published" class="nge-dsp-scale">
                The whole dataset has <strong>{{ active.published.cells.toLocaleString() }}</strong> proofread cells
                (<a :href="active.published.url" target="_blank" rel="noopener">{{ active.published.source }}</a>).
              </div>
              <div class="nge-dsp-foot">From this dataset's own records, read once a night. The work was done outside the game, so it does not count toward Achievements or the leaderboard.</div>
            </template>
            <div v-else-if="!hasList" class="nge-dsp-empty">This dataset has no cell list yet, so there is no total to measure against.</div>
            <template v-else>
              <!-- The headline is the count, not a percentage (Ames 2026-10-06). -->
              <div class="nge-dsp-big">
                <span class="nge-dsp-big-num"><RollUp :value="progress.done" /></span>
              </div>
              <div class="nge-dsp-big-sub">
                cell{{ progress.done === 1 ? '' : 's' }} completed, of
                <strong>{{ progress.total.toLocaleString() }}</strong> in the cell list
              </div>
              <div class="nge-dsp-track" role="img"
                   :aria-label="`${progress.done.toLocaleString()} completed, ${progress.claimed.toLocaleString()} claimed, ${progress.waiting.toLocaleString()} waiting`">
                <div class="nge-dsp-fill nge-dsp-fill--done" :style="{ width: pctDone + '%' }"></div>
                <div class="nge-dsp-fill nge-dsp-fill--claimed" :style="{ width: pctClaimed + '%' }"></div>
              </div>
              <div class="nge-dsp-trio">
                <div class="nge-dsp-tile">
                  <div class="nge-dsp-tile-num nge-dsp-c-done">{{ progress.done.toLocaleString() }}</div>
                  <div class="nge-dsp-tile-key">completed</div>
                </div>
                <div class="nge-dsp-tile">
                  <div class="nge-dsp-tile-num nge-dsp-c-claimed">{{ progress.claimed.toLocaleString() }}</div>
                  <div class="nge-dsp-tile-key">claimed</div>
                </div>
                <div class="nge-dsp-tile">
                  <div class="nge-dsp-tile-num nge-dsp-c-left">{{ progress.waiting.toLocaleString() }}</div>
                  <div class="nge-dsp-tile-key">waiting</div>
                </div>
              </div>
              <div v-if="progress.setAside > 0" class="nge-dsp-foot">
                {{ progress.setAside.toLocaleString() }} more were set aside (retired, could not be completed, or not this kind of cell) and are not in the total.
              </div>
            </template>
          </section>

          <!-- ── Cells per week ── -->
          <section v-if="hasList || (!outsideCells && stats.weeks && stats.weeks.length)" class="nge-dsp-section nge-dsp-s-week">
            <div class="nge-dsp-label">▌ Cells per week</div>
            <div v-if="!stats.weeks" class="nge-dsp-na">Not available right now.</div>
            <div v-else-if="!hasCellWeeks" class="nge-dsp-empty">
              No finished cell has a recorded date yet.
            </div>
            <template v-else>
              <div class="nge-dsp-readout" v-if="shownWeek">
                <span class="nge-dsp-readout-week">Week of {{ weekLabel(shownWeek.weekStart) }}</span>
                <span class="nge-dsp-readout-num">{{ shownWeek.cells.toLocaleString() }} cell{{ shownWeek.cells === 1 ? '' : 's' }}</span>
                <span class="nge-dsp-readout-run">{{ shownWeek.running.toLocaleString() }} so far</span>
              </div>
              <svg class="nge-dsp-chart" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none"
                   role="img" :aria-label="`Cells finished each week, ${series.length} weeks`"
                   @pointermove="onChartPoint" @pointerdown="onChartPoint" @pointerleave="hoverWeek = null">
                <line class="nge-dsp-chart-base" x1="0" :y1="CHART_H - 0.5" :x2="CHART_W" :y2="CHART_H - 0.5" />
                <rect v-for="b in bars" :key="b.weekStart" class="nge-dsp-bar"
                      :class="{ 'nge-dsp-bar--on': shownWeek && shownWeek.weekStart === b.weekStart }"
                      :x="b.x" :y="b.y" :width="b.w" :height="b.h" :style="{ animationDelay: Math.min(b.i * 14, 600) + 'ms' }" />
                <path v-if="runningPath" class="nge-dsp-run" :d="runningPath" />
              </svg>
              <div class="nge-dsp-axis">
                <span>{{ shortDate(series[0].weekStart) }}</span>
                <span>most in a week: {{ weekMax.toLocaleString() }}</span>
                <span>{{ shortDate(series[series.length - 1].weekStart) }}</span>
              </div>
              <div class="nge-dsp-legend">
                <span><i class="nge-dsp-key nge-dsp-key--bar"></i>cells that week</span>
                <span><i class="nge-dsp-key nge-dsp-key--line"></i>running total</span>
              </div>
              <div v-if="progress && progress.undated > 0" class="nge-dsp-foot">
                {{ progress.undated.toLocaleString() }} finished cell{{ progress.undated === 1 ? ' has' : 's have' }} no recorded date, so {{ progress.undated === 1 ? 'it is' : 'they are' }} not in this chart.
              </div>
            </template>
          </section>

          <!-- ── By cell type ── -->
          <section v-if="hasList && (!stats.types || hasTypes)" class="nge-dsp-section nge-dsp-s-types">
            <div class="nge-dsp-label">▌ By predicted cell type</div>
            <div v-if="!stats.types" class="nge-dsp-na">Not available right now.</div>
            <div v-else class="nge-dsp-types">
              <div v-for="(r, i) in typeRows" :key="r.type ?? '(none)'" class="nge-dsp-type"
                   :title="`${r.done.toLocaleString()} finished, ${r.left.toLocaleString()} left`">
                <span class="nge-dsp-type-name" :class="{ 'nge-dsp-type-name--none': r.type === null }">{{ r.type ?? 'No type' }}</span>
                <span class="nge-dsp-type-track">
                  <i class="nge-dsp-type-fill" :style="{ width: r.pct + '%', animationDelay: Math.min(i * 30, 600) + 'ms' }"></i>
                </span>
                <span class="nge-dsp-type-count">{{ r.done.toLocaleString() }}<span class="nge-dsp-type-of"> / {{ r.total.toLocaleString() }}</span></span>
              </div>
              <div class="nge-dsp-foot">Finished out of all cells of that type. Types are the classifier's prediction from the cell list.</div>
            </div>
          </section>

          <!-- ── Work in the game ── -->
          <section class="nge-dsp-section nge-dsp-s-work">
            <div class="nge-dsp-label">▌ Work in EyeWire II</div>
            <div v-if="!work" class="nge-dsp-na">Not available right now.</div>
            <div v-else-if="nothingHere" class="nge-dsp-empty">No edits have been logged on this dataset yet.</div>
            <template v-else>
              <div class="nge-dsp-trio">
                <div class="nge-dsp-tile">
                  <div class="nge-dsp-tile-num"><RollUp :value="work.edits" /></div>
                  <div class="nge-dsp-tile-key">edits</div>
                </div>
                <div class="nge-dsp-tile">
                  <div class="nge-dsp-tile-num nge-dsp-c-ann"><RollUp :value="work.annotations" /></div>
                  <div class="nge-dsp-tile-key">annotations</div>
                </div>
                <div class="nge-dsp-tile">
                  <div class="nge-dsp-tile-num nge-dsp-c-people"><RollUp :value="work.players" /></div>
                  <div class="nge-dsp-tile-key">{{ work.players === 1 ? 'person' : 'people' }} editing</div>
                </div>
              </div>
              <template v-if="work.edits > 0">
                <div class="nge-dsp-track nge-dsp-track--split" role="img"
                     :aria-label="`${work.splits.toLocaleString()} splits, ${work.merges.toLocaleString()} merges`">
                  <div class="nge-dsp-fill nge-dsp-fill--split" :style="{ width: pctSplits + '%' }"></div>
                  <div class="nge-dsp-fill nge-dsp-fill--merge" :style="{ width: (100 - pctSplits) + '%' }"></div>
                </div>
                <div class="nge-dsp-splitkey">
                  <span><i class="nge-dsp-key nge-dsp-key--split"></i>{{ work.splits.toLocaleString() }} splits</span>
                  <span><i class="nge-dsp-key nge-dsp-key--merge"></i>{{ work.merges.toLocaleString() }} merges</span>
                </div>
              </template>
              <div class="nge-dsp-foot">Edits and annotations made in the game. Work done outside it is not counted here. Annotations are counted per dataset from October 2026 on.</div>
            </template>
          </section>

          <!-- ── Your part ── -->
          <section v-if="mine" class="nge-dsp-section nge-dsp-section--mine nge-dsp-s-mine">
            <div class="nge-dsp-label nge-dsp-label--amber">▌ {{ partTitle }}</div>
            <div class="nge-dsp-mine">
              <div class="nge-dsp-mine-row">
                <span class="nge-dsp-mine-key">Cells completed</span>
                <span v-if="mine.cells === null" class="nge-dsp-mine-na">not available</span>
                <template v-else>
                  <span class="nge-dsp-mine-num">{{ mine.cells.toLocaleString() }}</span>
                  <span v-if="hasList && progress" class="nge-dsp-mine-share">{{ shareText(mine.cells, progress.total) }} of the dataset</span>
                </template>
              </div>
              <div v-if="hasList || !outsideCells || mine.edits" class="nge-dsp-mine-row">
                <span class="nge-dsp-mine-key">Edits</span>
                <span v-if="mine.edits === null" class="nge-dsp-mine-na">not available</span>
                <template v-else>
                  <span class="nge-dsp-mine-num">{{ mine.edits.toLocaleString() }}</span>
                  <span v-if="work && work.edits > 0" class="nge-dsp-mine-share">{{ shareText(mine.edits, work.edits) }} of all edits here</span>
                </template>
              </div>
              <div v-if="hasList || !outsideCells || mine.annotations" class="nge-dsp-mine-row">
                <span class="nge-dsp-mine-key">Annotations</span>
                <span v-if="mine.annotations === null" class="nge-dsp-mine-na">not available</span>
                <template v-else>
                  <span class="nge-dsp-mine-num">{{ mine.annotations.toLocaleString() }}</span>
                  <span v-if="work && work.annotations > 0" class="nge-dsp-mine-share">{{ shareText(mine.annotations, work.annotations) }} of all annotations here</span>
                </template>
              </div>
            </div>
            <div v-if="hasList" class="nge-dsp-foot">Cells are the ones under {{ props.person ? 'their' : 'your' }} name in the cell list.</div>
            <div v-else-if="outsideCells" class="nge-dsp-foot">Cells are the ones this dataset's own records credit to {{ props.person ? 'them' : 'you' }}.</div>
          </section>
        </template>
      </div>

      <div v-if="readAt" class="nge-dsp-readat" :class="{ 'nge-dsp-readat--busy': reading }">Read at {{ readAt }}</div>
    </div>
  </component>
</template>

<style scoped>
/* Values carried from LeaderboardPanel.vue (the sidebar, hero, tabs) and
   WeeklyRecapPanel.vue (labels, tiles, the progress track), so this panel
   sits beside them as one family. */
.nge-dsp-modal { font-size: 0.9em; }
.nge-dsp-modal--peek {
  background: none !important;
  backdrop-filter: none !important;
  pointer-events: none !important;
}
.nge-dsp-modal--peek :deep(.nge-holo-modal-particles) { display: none; }
.nge-dsp-modal--peek :deep(.nge-overlay) { pointer-events: auto; }

.nge-dsp-modal :deep(.nge-overlay) {
  right: 0 !important;
  top: 0 !important;
  left: auto !important;
  bottom: 0 !important;
  transform: none !important;
  width: 380px;
  overflow: hidden;
  border-left: 1px solid rgba(74, 158, 255, 0.14);
  animation: ngeDsSlideIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes ngeDsSlideIn {
  0%   { opacity: 0; translate: 40px 0; filter: blur(8px) brightness(2); }
  35%  { opacity: 1; filter: blur(0.5px) brightness(1.15); }
  100% { opacity: 1; translate: 0 0; filter: blur(0) brightness(1); }
}

.nge-dsp-shell { display: flex; flex-direction: column; width: 380px; height: 100%; color: #dbe6f5; }
.nge-dsp-topbar { position: relative; height: 0; flex-shrink: 0; }
.nge-dsp-exit {
  position: absolute; top: 10px; right: 12px; z-index: 5;
  background: none; border: none; color: #aaa; font-size: 1.6em; cursor: pointer; line-height: 1; padding: 0;
}
.nge-dsp-exit:hover { color: #fff; }

/* ── Hero ── */
.nge-dsp-hero {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 26px 16px 16px; overflow: hidden; flex-shrink: 0;
  border-bottom: 1px solid rgba(120, 180, 255, 0.12);
  background:
    radial-gradient(ellipse 70% 60% at 50% 30%, rgba(80, 150, 255, 0.10) 0%, rgba(80, 150, 255, 0) 60%),
    linear-gradient(180deg, rgba(10, 16, 32, 0.6) 0%, rgba(8, 12, 24, 0.0) 100%);
}
.nge-dsp-hero-grid {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(120, 180, 255, 0.06) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(120, 180, 255, 0.06) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: radial-gradient(ellipse 80% 75% at 50% 45%, black 30%, transparent 90%);
  -webkit-mask-image: radial-gradient(ellipse 80% 75% at 50% 45%, black 30%, transparent 90%);
}
.nge-dsp-title-rule {
  position: relative; width: 220px; height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(120, 180, 255, 0.5) 50%, transparent 100%);
}
.nge-dsp-title {
  position: relative; margin: 4px 0 2px;
  font-family: 'Orbitron', 'Rajdhani', sans-serif; font-size: 1.2em; font-weight: 700;
  letter-spacing: 0.24em; text-transform: uppercase; text-align: center;
  color: #d8ecff; text-shadow: 0 0 12px rgba(120, 180, 255, 0.5), 0 0 24px rgba(120, 180, 255, 0.25);
}
.nge-dsp-title-sub {
  position: relative; margin-bottom: 4px; text-align: center;
  font-size: 0.82em; letter-spacing: 0.04em; color: rgba(170, 205, 255, 0.8);
}

/* ── Dataset tabs ── */
.nge-dsp-tabs { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px 6px; flex-shrink: 0; justify-content: center; }
.nge-dsp-tab {
  position: relative; padding: 7px 14px;
  background: rgba(120, 180, 255, 0.04); border: 1px solid rgba(120, 180, 255, 0.18);
  color: rgba(180, 200, 230, 0.7);
  font-family: 'Orbitron', 'Rajdhani', sans-serif; font-size: 0.72em; font-weight: 600; letter-spacing: 0.12em;
  border-radius: 3px; cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.nge-dsp-tab:hover { background: rgba(120, 180, 255, 0.10); color: rgba(200, 220, 245, 0.9); }
.nge-dsp-tab--active {
  background: rgba(120, 180, 255, 0.18); border-color: rgba(120, 180, 255, 0.6); color: #d8ecff;
  box-shadow: 0 0 12px rgba(120, 180, 255, 0.35), inset 0 0 8px rgba(120, 180, 255, 0.18);
}

/* ── Scrolling body ── */
.nge-dsp-content {
  overflow-y: auto; flex: 1; min-height: 0; padding: 14px 18px 18px;
  scrollbar-width: thin; scrollbar-color: rgba(120, 180, 255, 0.35) rgba(8, 14, 26, 0.6);
}
.nge-dsp-section { margin-bottom: 18px; padding-bottom: 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.nge-dsp-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.nge-dsp-label {
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em;
  color: rgba(126, 224, 255, 0.9); margin-bottom: 10px;
}
.nge-dsp-label--amber { color: rgba(255, 195, 110, 0.95); }
.nge-dsp-na, .nge-dsp-empty { font-size: 0.86em; line-height: 1.45; color: #b4c3d6; }
.nge-dsp-na { color: #9aa9bd; }
.nge-dsp-foot { margin-top: 9px; font-size: 0.74em; line-height: 1.45; color: #8fa0b6; }
.nge-dsp-note {
  margin: 4px 0; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.45; color: #cfe3ff;
  background: rgba(120, 170, 255, 0.08); border: 1px solid rgba(120, 170, 255, 0.25);
}

/* ── Loading: the game's growing cell (GrowingCell.vue), the only thing here
   that loops, and it stands still under reduced motion ── */
.nge-dsp-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 0; }
.nge-dsp-loading-text { font-size: 0.78em; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(170, 205, 255, 0.75); }

/* ── Progress ── */
.nge-dsp-big { text-align: center; }
.nge-dsp-big-num {
  font-size: 3.2em; font-weight: 800; color: #fff; line-height: 1; letter-spacing: -0.02em;
  text-shadow: 0 0 18px rgba(120, 190, 255, 0.45), 0 2px 10px rgba(0, 0, 0, 0.8);
}
.nge-dsp-big-sub { margin: 6px 0 12px; text-align: center; font-size: 0.95em; color: #c9d6e3; }
.nge-dsp-big-sub strong { color: #f2f6fb; }
.nge-dsp-scale { margin: -4px 0 10px; text-align: center; font-size: 0.86em; line-height: 1.45; color: #b4c3d6; }
.nge-dsp-scale strong { color: #f2f6fb; }
.nge-dsp-scale a { color: #7ee0ff; text-decoration: none; }
.nge-dsp-scale a:hover { text-decoration: underline; }

.nge-dsp-track {
  display: flex; height: 8px; border-radius: 4px; overflow: hidden;
  background: rgba(255, 255, 255, 0.10);
}
.nge-dsp-fill { height: 100%; transform-origin: left center; animation: ngeDsGrow 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
.nge-dsp-fill--done { background: rgb(126, 224, 255); box-shadow: 0 0 10px rgba(126, 224, 255, 0.5); }
.nge-dsp-fill--claimed { background: rgb(74, 158, 255); animation-delay: 0.12s; }
.nge-dsp-fill--split { background: #f0a35e; }
.nge-dsp-fill--merge { background: #5fd6a0; animation-delay: 0.12s; }
.nge-dsp-track--split { height: 6px; margin-top: 10px; }
@keyframes ngeDsGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

.nge-dsp-trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.nge-dsp-tile {
  background: rgba(74, 158, 255, 0.06); border: 1px solid rgba(74, 158, 255, 0.12);
  border-radius: 8px; padding: 10px 6px; text-align: center; min-width: 0;
}
.nge-dsp-tile-num { font-size: 1.3em; font-weight: 700; color: #4a9eff; font-variant-numeric: tabular-nums; }
.nge-dsp-tile-key { font-size: 0.7em; color: #b4c3d6; margin-top: 2px; }
.nge-dsp-c-done { color: rgb(126, 224, 255); }
.nge-dsp-c-claimed { color: rgb(74, 158, 255); }
.nge-dsp-c-left { color: #c9d6e3; }
.nge-dsp-c-ann { color: #c98bff; }
.nge-dsp-c-people { color: #7f8; }

/* ── Weekly chart ── */
.nge-dsp-readout {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px;
  font-size: 0.8em; font-variant-numeric: tabular-nums;
}
.nge-dsp-readout-week { color: #b4c3d6; }
.nge-dsp-readout-num { color: rgb(126, 224, 255); font-weight: 700; }
.nge-dsp-readout-run { color: #ffd08a; margin-left: auto; }
.nge-dsp-chart { display: block; width: 100%; height: 96px; overflow: visible; touch-action: pan-y; cursor: crosshair; }
.nge-dsp-chart-base { stroke: rgba(126, 224, 255, 0.25); stroke-width: 1; vector-effect: non-scaling-stroke; }
.nge-dsp-bar {
  fill: rgba(74, 158, 255, 0.55);
  transform-box: fill-box; transform-origin: 50% 100%;
  animation: ngeDsRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.nge-dsp-bar--on { fill: rgb(126, 224, 255); }
@keyframes ngeDsRise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.nge-dsp-run {
  fill: none; stroke: #ffd08a; stroke-width: 1.25; vector-effect: non-scaling-stroke;
  stroke-linejoin: round; stroke-linecap: round; opacity: 0.9; pointer-events: none;
  /* Fades in after the bars. Not a dash draw: the chart is stretched to
     its box and the stroke is not, so a dash length measured on one is
     wrong on the other and the line stopped short in the wide layout. */
  animation: ngeDsFade 0.7s ease-out 0.45s both;
}
@keyframes ngeDsFade { from { opacity: 0; } to { opacity: 0.9; } }
.nge-dsp-axis { display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.68em; color: #8fa0b6; }
.nge-dsp-legend, .nge-dsp-splitkey { display: flex; gap: 14px; margin-top: 6px; font-size: 0.72em; color: #b4c3d6; }
.nge-dsp-key { display: inline-block; margin-right: 5px; vertical-align: middle; }
.nge-dsp-key--bar { width: 8px; height: 8px; background: rgba(74, 158, 255, 0.75); }
.nge-dsp-key--line { width: 12px; height: 2px; background: #ffd08a; }
.nge-dsp-key--split { width: 8px; height: 8px; border-radius: 2px; background: #f0a35e; }
.nge-dsp-key--merge { width: 8px; height: 8px; border-radius: 2px; background: #5fd6a0; }

/* ── Cell types ── */
.nge-dsp-type {
  display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 8px;
  padding: 3px 0; font-size: 0.8em;
}
.nge-dsp-type-name { color: #e6eef8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-dsp-type-name--none { color: #8fa0b6; }
.nge-dsp-type-track { display: block; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.10); }
.nge-dsp-type-fill {
  display: block; height: 100%; background: rgb(126, 224, 255);
  transform-origin: left center; animation: ngeDsGrow 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.nge-dsp-type-count { color: #dbe6f5; font-variant-numeric: tabular-nums; text-align: right; }
.nge-dsp-type-of { color: #8fa0b6; }

/* ── Your part ── */
.nge-dsp-section--mine {
  padding: 12px 14px; border: 1px solid rgba(255, 195, 110, 0.22); border-radius: 8px;
  background: rgba(255, 195, 110, 0.04);
}
.nge-dsp-section--mine:last-child { padding: 12px 14px; }
.nge-dsp-mine-row { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; font-size: 0.86em; }
.nge-dsp-mine-key { width: 92px; flex-shrink: 0; color: #b4c3d6; }
.nge-dsp-mine-num { color: #ffd08a; font-weight: 700; font-variant-numeric: tabular-nums; }
.nge-dsp-mine-share { color: #9fb0c6; font-size: 0.92em; }
.nge-dsp-mine-na { color: #9aa9bd; }

.nge-dsp-readat {
  flex-shrink: 0; padding: 7px 18px 9px; text-align: right; font-size: 11px; color: #8a97ad;
  border-top: 1px solid rgba(120, 180, 255, 0.08); transition: opacity 0.2s;
}
.nge-dsp-readat--busy { opacity: 0.5; }

/* ── Embedded in the profile: the same parts, side by side ── */
.nge-dsp-embedded { display: block; width: 100%; font-size: 0.9em; }
.nge-dsp-shell--wide { width: 100%; height: auto; }
.nge-dsp-shell--wide .nge-dsp-tabs { justify-content: flex-start; padding: 16px 22px 4px; }
.nge-dsp-wide-title { padding: 6px 22px 0; font-size: 0.86em; letter-spacing: 0.04em; color: rgba(170, 205, 255, 0.8); }
.nge-dsp-shell--wide .nge-dsp-content {
  overflow: visible; padding: 14px 22px 8px;
  display: grid; gap: 14px; align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr);
  grid-template-areas: "prog week types" "mine work types";
}
.nge-dsp-shell--wide .nge-dsp-loading,
.nge-dsp-shell--wide .nge-dsp-note { grid-column: 1 / -1; }
.nge-dsp-shell--wide .nge-dsp-section {
  margin: 0; padding: 14px 16px; border-radius: 8px;
  border: 1px solid rgba(74, 158, 255, 0.14); background: rgba(74, 158, 255, 0.04);
}
.nge-dsp-shell--wide .nge-dsp-section--mine { border-color: rgba(255, 195, 110, 0.22); background: rgba(255, 195, 110, 0.04); }
.nge-dsp-shell--wide .nge-dsp-s-prog { grid-area: prog; }
.nge-dsp-shell--wide .nge-dsp-s-week { grid-area: week; }
.nge-dsp-shell--wide .nge-dsp-s-types { grid-area: types; }
.nge-dsp-shell--wide .nge-dsp-s-work { grid-area: work; }
.nge-dsp-shell--wide .nge-dsp-s-mine { grid-area: mine; }
.nge-dsp-shell--wide .nge-dsp-chart { height: 150px; }
.nge-dsp-shell--wide .nge-dsp-readat { border-top: none; padding: 0 22px 14px; }

/* Nothing moves for a reader who asked for stillness: the page is drawn
   in its finished state. */
@media (prefers-reduced-motion: reduce) {
  .nge-dsp-modal :deep(.nge-overlay), .nge-dsp-fill, .nge-dsp-type-fill, .nge-dsp-bar { animation: none; }
  .nge-dsp-run { animation: none; }
}
</style>

<style>
/* Phones: the shared modal rule makes the panel full screen; the shell
   follows it instead of holding its desktop width. */
/* The overlay's min-width is max-content, which for a column of prose is the
   longest unwrapped line, wider than a phone. */
body.nge-mobile #nge-dsp-modal .nge-overlay { min-width: 0 !important; left: 0 !important; }
body.nge-mobile #nge-dsp-modal .nge-dsp-shell { width: 100%; }
/* Clear the bottom nav (56px, mobile.css), which sits over every sheet. */
body.nge-mobile #nge-dsp-modal .nge-dsp-shell { padding-bottom: calc(56px + env(safe-area-inset-bottom)); box-sizing: border-box; }
</style>
