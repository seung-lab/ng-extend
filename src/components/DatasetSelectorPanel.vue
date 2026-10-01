<script setup lang="ts">
/**
 * DatasetSelectorPanel — lets users switch between known datasets at runtime.
 * Displays as a compact centred hologram panel with dataset cards.
 * Switching loads new neuroglancer layers + updates CAVE config automatically.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { DATASETS, DATASET_GROUPS, switchToDataset, currentSegLayerName, findDatasetBySegName, findDatasetByCanonical, canonicalDataset, type DatasetEntry, type DatasetSection } from '../datasets';
import { runPanelTrace } from '../util/holo_trace';
import { startDatasetTransition } from '../util/dataset_transition';
import { loadDatasetPermissions, datasetAccess } from '../util/dataset_access';

const emit = defineEmits({ hide: null });
const panelEl = ref<HTMLElement | null>(null);

// Particle trace on arrival (scifi-ui): the beam runs the panel boundary once.
onMounted(() => {
  setTimeout(() => { if (panelEl.value) runPanelTrace(panelEl.value); }, 60);
});

// ── Current dataset detection ───────────────────────────────────────────────

const currentDatasetId = ref('');

function detectCurrentDataset() {
  try {
    // Exact match on the ACTIVE (visible, non-archived) seg layer name.
    // The old scan walked every managed layer with a fuzzy URL match, so an
    // archived layer from a previous dataset (or a URL merely containing
    // the id, like minnie65_phase3_v1 containing "minnie65") stamped the
    // Active badge on the wrong card.
    const name = currentSegLayerName();
    const exact = findDatasetBySegName(name);
    if (exact) { currentDatasetId.value = exact.id; return; }
    const canonEntry = findDatasetByCanonical(canonicalDataset(name));
    if (canonEntry) { currentDatasetId.value = canonEntry.id; return; }
  } catch {}
  currentDatasetId.value = '';
}

onMounted(detectCurrentDataset);

// ── Access (from CAVE): locked cards are greyed and do not switch ───────────
onMounted(() => { loadDatasetPermissions(); });
/** The dataset on screen is never shown locked, whatever the lookup says. */
const accessOf = (ds: DatasetEntry) => ds.id === currentDatasetId.value ? 'edit' : datasetAccess(ds.caveDataset);
const lockedTip = 'Your CAVE account does not have access to this dataset yet. Ask an EyeWire II admin to request it for you.';
const viewTip = 'You can look around here, but your CAVE account cannot save edits in this dataset.';

// ── Switch dataset ──────────────────────────────────────────────────────────

const switching = ref(false);

// ── Cards: single datasets, and one card per group (MICrONS) ──────────────
type Card = { kind: 'one'; ds: DatasetEntry } | { kind: 'group'; key: string; members: DatasetEntry[] };
const cards = computed<Card[]>(() => {
  const out: Card[] = [];
  const seen = new Set<string>();
  for (const ds of DATASETS) {
    if (ds.group && DATASET_GROUPS[ds.group]) {
      if (seen.has(ds.group)) continue;
      seen.add(ds.group);
      // A group lists every version, including ones hidden as their own card.
      out.push({ kind: 'group', key: ds.group, members: DATASETS.filter(d => d.group === ds.group) });
    } else if (!ds.hidden || ds.id === currentDatasetId.value) {
      out.push({ kind: 'one', ds });
    }
  }
  return out;
});
// ── Sections (Ames 2026-09-30): Sandbox and View Only on the left,
// Production on the right, each with a ? that explains it ──────────────────
const sectionOf = (c: Card): DatasetSection =>
  (c.kind === 'group' ? DATASET_GROUPS[c.key].section : c.ds.section) ?? 'production';
const SECTIONS: Record<DatasetSection, { title: string; kicker: string; help: string }> = {
  sandbox: {
    title: 'Sandbox',
    kicker: 'Practice freely',
    help: 'A practice copy of real data. Split, merge and experiment as much as you like: nothing you do here touches the research datasets, so it is the place to learn the tools and try ideas.',
  },
  viewonly: {
    title: 'View Only',
    kicker: 'Explore published connectomes',
    help: 'Publicly available connectomes. Fly through them, look at cells, compare them with ours and share views, but edits are not saved here (unless your account has proofreading access for that dataset).',
  },
  production: {
    title: 'Production Data',
    kicker: 'Live science',
    help: 'Datasets actively undergoing proofreading. Every split, merge and completed cell goes into the real connectome. Claim a cell in the Cell Library, work carefully, and ask for a second opinion when unsure. Play carefully: this is really for science!',
  },
};
const COLUMNS: DatasetSection[][] = [['sandbox', 'viewonly'], ['production']];
const cardsIn = (s: DatasetSection) => cards.value.filter(c => sectionOf(c) === s);
const helpOpen = ref<DatasetSection | null>(null);
function toggleHelp(s: DatasetSection) { helpOpen.value = helpOpen.value === s ? null : s; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); emit('hide'); } }
onMounted(() => window.addEventListener('keydown', onKey, true));
onUnmounted(() => window.removeEventListener('keydown', onKey, true));

const openGroup = ref<string | null>(null);
const groupActive = (c: Card) => c.kind === 'group' && c.members.some(m => m.id === currentDatasetId.value);
function toggleGroup(key: string) { openGroup.value = openGroup.value === key ? null : key; }
onMounted(() => {
  // Open the group you are in, so its current version is visible.
  const here = DATASETS.find(d => d.id === currentDatasetId.value);
  if (here?.group) openGroup.value = here.group;
});

async function switchTo(ds: DatasetEntry) {
  if (ds.id === currentDatasetId.value) return;
  if (accessOf(ds) === 'none') return;
  // Close the switcher and play "Now entering" (it survives the reload a
  // curated dataset triggers). Let it paint before the switch blocks.
  // Close the Cell Library first (Amy 2026-09-30): it belongs to the dataset
  // being left, and reloading under it mid-switch showed the wrong cells.
  document.dispatchEvent(new CustomEvent('nge:close-cell-library'));
  startDatasetTransition(ds);
  emit('hide');
  await new Promise(r => setTimeout(r, 60));
  switching.value = true;
  const ok = await switchToDataset(ds);
  if (ok) currentDatasetId.value = ds.id;
  switching.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div class="nge-ds-screen" @click.self="emit('hide')">
      <div ref="panelEl" class="nge-dataset-panel" role="dialog" aria-label="Switch dataset">
        <div class="nge-ds-header">
          <div class="nge-ds-heading">
            <span class="nge-ds-title">Switch Dataset</span>
            <span class="nge-ds-sub">Choose where to work. Production data is live science.</span>
          </div>
          <button class="nge-ds-close" aria-label="Close" @click="emit('hide')">×</button>
        </div>
        <div class="nge-ds-columns">
          <div v-for="(col, ci) in COLUMNS" :key="ci" class="nge-ds-col" :class="{ 'nge-ds-col--prod': ci === 1 }">
            <section v-for="sec in col" :key="sec" class="nge-ds-section" :class="'nge-ds-section--' + sec">
              <header class="nge-ds-section-head">
                <span class="nge-ds-section-dot" aria-hidden="true"></span>
                <span class="nge-ds-section-title">{{ SECTIONS[sec].title }}</span>
                <span class="nge-ds-section-kicker">{{ SECTIONS[sec].kicker }}</span>
                <button
                  class="nge-ds-help"
                  :class="{ 'nge-ds-help--on': helpOpen === sec }"
                  :aria-expanded="helpOpen === sec ? 'true' : 'false'"
                  :aria-label="'What is ' + SECTIONS[sec].title + '?'"
                  @click="toggleHelp(sec)"
                >?</button>
              </header>
              <p v-if="helpOpen === sec" class="nge-ds-help-text">{{ SECTIONS[sec].help }}</p>
              <div class="nge-ds-list">
                <template v-for="c in cardsIn(sec)" :key="c.kind === 'group' ? 'g:' + c.key : c.ds.id">
                <div v-if="c.kind === 'group'" class="nge-ds-group" :class="{ 'nge-ds-group--open': openGroup === c.key }">
                  <div
                    class="nge-ds-card nge-ds-group-card"
                    :class="{ 'nge-ds-active': groupActive(c) }"
                    role="button"
                    :aria-expanded="openGroup === c.key ? 'true' : 'false'"
                    @click="toggleGroup(c.key)"
                  >
                    <img v-if="DATASET_GROUPS[c.key].thumbnail" :src="DATASET_GROUPS[c.key].thumbnail" class="nge-ds-card-thumb" alt="" loading="lazy" />
                    <div class="nge-ds-card-text">
                      <div class="nge-ds-card-label">{{ DATASET_GROUPS[c.key].label }}</div>
                      <div class="nge-ds-card-desc">{{ DATASET_GROUPS[c.key].description }}</div>
                    </div>
                    <div v-if="groupActive(c)" class="nge-ds-badge">Active</div>
                    <span class="nge-ds-versions" :title="`${c.members.length} versions`" :aria-label="`${c.members.length} versions`">
                      <svg class="nge-ds-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </span>
                  </div>
                  <div v-if="openGroup === c.key" class="nge-ds-variants">
                    <div
                      v-for="ds in c.members"
                      :key="ds.id"
                      class="nge-ds-variant"
                      :class="{
                        'nge-ds-active': ds.id === currentDatasetId,
                        'nge-ds-switching': switching,
                        'nge-ds-locked': accessOf(ds) === 'none',
                      }"
                      :title="accessOf(ds) === 'none' ? lockedTip : accessOf(ds) === 'view' ? viewTip : undefined"
                      :aria-disabled="accessOf(ds) === 'none' ? 'true' : undefined"
                      @click="switchTo(ds)"
                    >
                      <div class="nge-ds-variant-text">
                        <div class="nge-ds-variant-label">{{ ds.variantLabel || ds.label }}</div>
                        <div class="nge-ds-card-desc">{{ ds.description }}</div>
                      </div>
                      <div v-if="ds.id === currentDatasetId" class="nge-ds-tag">Active</div>
                      <div v-else-if="accessOf(ds) === 'none'" class="nge-ds-tag nge-ds-badge--locked"><span aria-hidden="true">🔒</span> No access</div>
                      <div v-else-if="accessOf(ds) === 'view'" class="nge-ds-tag nge-ds-badge--view">View only</div>
                    </div>
                  </div>
                </div>
                <template v-else><div
                  v-for="ds in [c.ds]"
                  :key="ds.id"
                  class="nge-ds-card"
                  :class="{
                    'nge-ds-active': ds.id === currentDatasetId,
                    'nge-ds-switching': switching,
                    'nge-ds-locked': accessOf(ds) === 'none',
                  }"
                  :title="accessOf(ds) === 'none' ? lockedTip : accessOf(ds) === 'view' ? viewTip : undefined"
                  :aria-disabled="accessOf(ds) === 'none' ? 'true' : undefined"
                  @click="switchTo(ds)"
                >
                  <img v-if="ds.thumbnail" :src="ds.thumbnail" class="nge-ds-card-thumb" alt="" loading="lazy" />
                  <div class="nge-ds-card-text">
                  <div class="nge-ds-card-label">{{ ds.label }}</div>
                  <div class="nge-ds-card-desc">{{ ds.description }}</div>
                  </div>
                  <div v-if="ds.id === currentDatasetId" class="nge-ds-badge">Active</div>
                  <div v-else-if="accessOf(ds) === 'none'" class="nge-ds-badge nge-ds-badge--locked"><span aria-hidden="true">🔒</span> No access</div>
                  <div v-else-if="accessOf(ds) === 'view'" class="nge-ds-badge nge-ds-badge--view">View only</div>
                </div></template>
                </template>

                <div v-if="!cardsIn(sec).length" class="nge-ds-empty">Nothing here yet.</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Full screen (Ames 2026-09-30): Sandbox and View Only on the left,
   Production on the right. Hologram frame and materialize from scifi-ui. */
.nge-ds-screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(20, 60, 110, 0.35), transparent 65%),
    rgba(2, 5, 12, 0.86);
  backdrop-filter: blur(6px);
  animation: nge-ds-fade 0.35s ease both;
}
@keyframes nge-ds-fade { from { opacity: 0; } to { opacity: 1; } }
.nge-dataset-panel {
  position: relative;
  width: min(1240px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(6, 10, 20, 0.92);
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-radius: 14px;
  box-shadow: 0 10px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(53, 181, 255, 0.12), inset 0 0 40px rgba(53, 181, 255, 0.04);
  overflow: hidden;
  font-family: 'Inter', 'Segoe UI', sans-serif;
  animation: nge-ds-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* Corner brackets, the scifi-ui frame mark. */
.nge-dataset-panel::before, .nge-dataset-panel::after {
  content: '';
  position: absolute;
  width: 18px; height: 18px;
  border: 2px solid rgba(79, 207, 255, 0.7);
  pointer-events: none;
}
.nge-dataset-panel::before { top: 6px; left: 6px; border-right: none; border-bottom: none; border-top-left-radius: 8px; }
.nge-dataset-panel::after { bottom: 6px; right: 6px; border-left: none; border-top: none; border-bottom-right-radius: 8px; }
@keyframes nge-ds-materialize {
  0%   { opacity: 0; transform: scale(1.02) translateY(-8px); filter: blur(14px); }
  60%  { opacity: 1; transform: scale(0.997); filter: blur(0); }
  100% { opacity: 1; transform: none; filter: blur(0); }
}
@media (prefers-reduced-motion: reduce) {
  .nge-dataset-panel, .nge-ds-screen { animation: none; }
}
.nge-ds-heading { display: flex; flex-direction: column; gap: 3px; }
.nge-ds-sub { font-size: 12px; color: rgba(190, 215, 245, 0.6); }
.nge-ds-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 22px;
  padding: 18px 22px 22px;
  overflow-y: auto;
  min-height: 0;
}
.nge-ds-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
@media (max-width: 820px) {
  .nge-ds-screen { padding: 0; }
  .nge-dataset-panel { max-height: 100%; border-radius: 0; }
  .nge-ds-columns { grid-template-columns: minmax(0, 1fr); padding: 12px; }
  /* Production first on a phone: it is where the work is. */
  .nge-ds-col--prod { order: -1; }

}
.nge-ds-section {
  --sec: 79, 207, 255;
  position: relative;
  padding: 12px;
  border: 1px solid rgba(var(--sec), 0.22);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(var(--sec), 0.06), rgba(var(--sec), 0.015));
}
.nge-ds-section--sandbox { --sec: 61, 220, 151; }
.nge-ds-section--viewonly { --sec: 232, 196, 106; flex: 1; }
.nge-ds-section--production { --sec: 79, 207, 255; flex: 1; box-shadow: 0 0 22px rgba(79, 207, 255, 0.08); }
.nge-ds-section-head { display: flex; align-items: center; gap: 9px; margin: 0 2px 10px; }
.nge-ds-section-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: rgb(var(--sec));
  box-shadow: 0 0 8px rgba(var(--sec), 0.9);
}
.nge-ds-section-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: rgb(var(--sec));
}
.nge-ds-section-kicker { font-size: 11.5px; color: rgba(200, 220, 245, 0.55); flex: 1; min-width: 0; }
.nge-ds-help {
  flex-shrink: 0;
  width: 22px; height: 22px; padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(var(--sec), 0.5);
  background: rgba(var(--sec), 0.08);
  color: rgb(var(--sec));
  font: 700 12px/20px 'Inter', sans-serif;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
}
.nge-ds-help:hover, .nge-ds-help--on { background: rgba(var(--sec), 0.22); box-shadow: 0 0 10px rgba(var(--sec), 0.45); }
.nge-ds-help-text {
  margin: -2px 2px 12px;
  padding: 10px 12px;
  border-left: 2px solid rgb(var(--sec));
  border-radius: 0 8px 8px 0;
  background: rgba(var(--sec), 0.08);
  font-size: 12.5px; line-height: 1.5;
  color: rgba(225, 238, 255, 0.88);
}
.nge-ds-empty { font-size: 12px; color: rgba(255, 255, 255, 0.35); padding: 6px 4px; }

.nge-ds-section--production .nge-ds-card-label { font-size: 14px; }
.nge-ds-section--production .nge-ds-card-desc { font-size: 12px; }

.nge-ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px 14px;
  border-bottom: 1px solid rgba(79, 207, 255, 0.18);
}

.nge-ds-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 0.08em;
}

.nge-ds-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 24px;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
}
.nge-ds-close:hover { color: #fff; }

.nge-ds-list {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Never a sideways scrollbar: long names and descriptions wrap. */
.nge-ds-columns { overflow-x: hidden; }
.nge-ds-card-text, .nge-ds-variant-text { min-width: 0; overflow-wrap: anywhere; }

/* A group (MICrONS): one card that opens into a plain list of versions. */
.nge-ds-group { display: flex; flex-direction: column; gap: 4px; }
.nge-ds-group-card { padding-right: 46px; }
/* The open/close control: just the caret (Amy 2026-09-30: the "3 versions"
   pill overlapped the description). The count is in its tooltip. */
.nge-ds-versions {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border-radius: 999px;
  color: #9fdcff; background: rgba(100, 200, 255, 0.12);
  border: 1px solid rgba(100, 200, 255, 0.4);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.nge-ds-group-card:hover .nge-ds-versions { background: rgba(100, 200, 255, 0.2); border-color: rgba(100, 200, 255, 0.7); color: #d4f0ff; }
.nge-ds-chevron { transition: transform 0.2s ease; }
.nge-ds-group--open .nge-ds-chevron { transform: rotate(180deg); }
/* The Active badge sits above the pill on a group card. */
.nge-ds-group-card .nge-ds-badge { top: 8px; right: 10px; }
.nge-ds-group-card:has(.nge-ds-badge) .nge-ds-versions { top: auto; bottom: 8px; transform: none; }
.nge-ds-variants {
  display: flex; flex-direction: column; gap: 2px;
  margin-left: 14px; padding-left: 10px;
  border-left: 1px solid rgba(100, 200, 255, 0.25);
}
.nge-ds-variant {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 10px; border-radius: 5px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.nge-ds-variant:hover:not(.nge-ds-active):not(.nge-ds-locked) { background: rgba(100, 200, 255, 0.06); border-color: rgba(100, 200, 255, 0.2); }
.nge-ds-variant.nge-ds-active { background: rgba(100, 200, 255, 0.1); border-color: rgba(100, 200, 255, 0.35); cursor: default; }
.nge-ds-variant.nge-ds-locked { cursor: not-allowed; }
.nge-ds-variant.nge-ds-locked .nge-ds-variant-text { opacity: 0.45; }
.nge-ds-variant-text { flex: 1; }
.nge-ds-variant-label { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.88); margin-bottom: 2px; }
.nge-ds-tag {
  flex-shrink: 0; font-size: 10px; font-weight: 600; white-space: nowrap;
  color: #64c8ff; background: rgba(100, 200, 255, 0.12);
  padding: 1px 6px; border-radius: 3px; margin-top: 1px;
}

.nge-ds-card {
  position: relative;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.nge-ds-card:hover:not(.nge-ds-active) {
  background: rgba(100, 200, 255, 0.06);
  border-color: rgba(100, 200, 255, 0.2);
}
.nge-ds-active {
  background: rgba(100, 200, 255, 0.1);
  border-color: rgba(100, 200, 255, 0.4);
  cursor: default;
}
.nge-ds-switching {
  opacity: 0.5;
  pointer-events: none;
}
/* No CAVE access: greyed, not clickable, the reason in the tooltip. */
.nge-ds-locked { cursor: not-allowed; }
.nge-ds-locked .nge-ds-card-thumb { filter: grayscale(1) brightness(0.55); }
.nge-ds-locked .nge-ds-card-text { opacity: 0.45; }
.nge-ds-card.nge-ds-locked:hover { background: none; border-color: rgba(255, 255, 255, 0.08); }
.nge-ds-badge--locked { color: #c9ccd4; background: rgba(255, 255, 255, 0.08); }
.nge-ds-badge--view { color: #e8c46a; background: rgba(232, 196, 106, 0.12); }

.nge-ds-card:has(.nge-ds-card-thumb) {
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: 12px;
  align-items: center;
}
.nge-ds-card-text { min-width: 0; }
.nge-ds-card-thumb {
  width: 104px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.nge-ds-card-label {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 3px;
}

.nge-ds-card-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.35;
}

.nge-ds-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 10px;
  font-weight: 600;
  color: #64c8ff;
  background: rgba(100, 200, 255, 0.12);
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.03em;
}

/* Section card sizes. Last in the file on purpose: they override the base
   card grid above (same specificity, so order decides). */
.nge-ds-section .nge-ds-card:has(.nge-ds-card-thumb) { grid-template-columns: 132px minmax(0, 1fr); }
.nge-ds-section .nge-ds-card-thumb { width: 132px; }
.nge-ds-section--production .nge-ds-card:has(.nge-ds-card-thumb) { grid-template-columns: 200px minmax(0, 1fr); padding: 16px; gap: 18px; }
.nge-ds-section--production .nge-ds-card-thumb { width: 200px; }
.nge-ds-section--production .nge-ds-list { gap: 10px; }
@media (max-width: 820px) {
  .nge-ds-section .nge-ds-card:has(.nge-ds-card-thumb),
  .nge-ds-section--production .nge-ds-card:has(.nge-ds-card-thumb) { grid-template-columns: 96px minmax(0, 1fr); padding: 10px; gap: 12px; }
  .nge-ds-section .nge-ds-card-thumb,
  .nge-ds-section--production .nge-ds-card-thumb { width: 96px; }
  .nge-ds-section--production .nge-ds-card-label { font-size: 13px; }
}
</style>
