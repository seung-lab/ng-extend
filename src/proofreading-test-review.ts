/**
 * proofreading-test-review.ts: what the admins see of the Proofreading Test
 * (Ames, 2026-10-21: "we need a way for admins to see the results").
 *
 * Admin Hub > Test tries (TestTriesTab.vue) lists every try. One try opens
 * with its score and what was fixed, missed and damaged; "Look at their
 * cell" loads the test view with the cell exactly as the player left it,
 * the points they placed, and pins on what they missed (TestReviewBar.vue).
 * The server keeps each try's cell as a root id, which names that set of
 * supervoxels for good, so it still shows after the undos
 * (functions/proofreading-test.js, keepTry). Admins only, on the server.
 */
import { ref } from 'vue';
import { secureWrite } from './secure_write';
import { setStateRewriter, useLayersStore } from './store';
import { startDatasetTransition, releaseDatasetTransition } from './util/dataset_transition';
import { showExactly, endLayerSpec } from './proofreading-test';
import { Uint64 } from 'neuroglancer/util/uint64';
import { makeLayer } from 'neuroglancer/layer';
import imgInspectorNurro from './images/inspector-nurro.png';

export interface TestTry {
  id: number; test_id: string; started_at: string; submitted_at: string | null;
  /** pass, fail; expired = left without submitting; abandoned = left the test; null = not finished yet */
  outcome: 'pass' | 'fail' | 'expired' | 'abandoned' | 'error' | null;
  found: number | null; errors: number | null; damaged: number | null; percent: number | null;
  timed_out: boolean; error: string | null;
  /** The player's cell as they left it (kept from 2026-10-21). */
  end_root?: string | null; ends_found?: number | null; ends_total?: number | null;
  username: string | null; cave_user_id: number | null;
}
export interface TestLineEntry { user_id: string; test_id: string; joined_at: string; called_at: string | null; username: string | null }
export interface TestTriesList {
  /** False until supabase-proofreading-test-tries.sql has run: no cells kept. */
  kept: boolean;
  test: { id: string; title: string; enabled: boolean; status: string; pass_mark: number; time_limit_minutes: number | null;
    holder: string | null; claimed_at: string | null; deadline_at: string | null } | null;
  /** The key as it stands, in counts only. */
  key: { mistakes: number; ends: number; protect: number; points: number } | null;
  tries: TestTry[];
  /** The line for the cell, first in line first. */
  line?: TestLineEntry[];
}
export interface TestTryCheck {
  kind: string; label: string; ok: boolean; weight: number; point: number[] | null;
  /** The heat map: this mistake's piece as a segment of its own, or the part
   *  of a real branch they cut off. Null when the try has none kept. */
  seg?: string | null;
  /** An end: how near a point must be, in nm. */
  radius?: number;
}
export interface TestTryDetail extends TestTry {
  dataset: string; state_url: string; checks: TestTryCheck[];
  /** Every point annotation the player had when it was scored. */
  given: number[][]; stray: number | null;
}

export function listTestTries(): Promise<TestTriesList> {
  return secureWrite<TestTriesList>('test.tries', {});
}
/** Admins: take a player out of the line (the next is called if it was their turn). */
export async function removeFromLine(userId: string): Promise<void> {
  await secureWrite('test.queueRemove', { user: userId });
}
export function loadTestTry(id: number): Promise<TestTryDetail> {
  return secureWrite<TestTryDetail>('test.try', { attempt: id });
}

export const playerName = (t: Pick<TestTry, 'username' | 'cave_user_id'>) => t.username || (t.cave_user_id ? `CAVE user ${t.cave_user_id}` : 'A player');

export function outcomeWord(t: TestTry): string {
  switch (t.outcome) {
    case 'pass': return 'Passed';
    case 'fail': return 'Did not pass';
    case 'expired': return 'Left unfinished';
    case 'abandoned': return 'Left the test';
    case 'error': return 'Error';
    default: return 'Not finished yet';
  }
}

/** A try's checks, grouped the way an admin reads them: damage first, then
 *  the mistakes missed (biggest first), the ends missed, and what was fixed. */
export function tryParts(t: TestTryDetail) {
  const isDamage = (c: TestTryCheck) => c.kind === 'keep' || c.kind === 'apart';
  const isMistake = (c: TestTryCheck) => c.kind === 'cut' || c.kind === 'merge';
  const big = (a: TestTryCheck, b: TestTryCheck) => (b.weight ?? 1) - (a.weight ?? 1);
  return {
    damage: t.checks.filter(c => isDamage(c) && !c.ok),
    missed: t.checks.filter(c => isMistake(c) && !c.ok).sort(big),
    fixed: t.checks.filter(c => isMistake(c) && c.ok).sort(big),
    endsMissed: t.checks.filter(c => c.kind === 'endpoint' && !c.ok),
    endsFound: t.checks.filter(c => c.kind === 'endpoint' && c.ok),
  };
}

// ─── In the view ───────────────────────────────────────────────────────────

/** The try an admin is looking at in the view (TestReviewBar). */
export const reviewingTry = ref<TestTryDetail | null>(null);
/** Said in the bar when the cell did not reach the screen. */
export const reviewProblem = ref('');

/** Whether the test's segmentation layer is showing this root. */
function cellShowing(dataset: string, root: string): boolean {
  try {
    const want = Uint64.parseString(root);
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      const url: string = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (!(ml.name === dataset || url.includes(`/table/${dataset}`))) continue;
      if (ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments?.has(want)) return true;
    }
  } catch { /* not showing */ }
  return false;
}

/** The layers the review adds; they go when it ends (Ames, 2026-10-21: "a
 *  heat map for right wrongness"). Their cell is see-through; every scored
 *  piece is drawn on its own, green when they got it right and red when
 *  not; their points are green on an end and red near no end. */
const LAYERS = {
  heat: 'Right and wrong',
  onEnd: 'Their points: on an end',
  offEnd: 'Their points: near no end',
  missed: 'Missed',
  fixed: 'Fixed',
} as const;
const LAYER_NAMES: string[] = Object.values(LAYERS);
/** The point layers, placed after the view loads (see keepTryPoints). */
const POINT_NAMES: string[] = [LAYERS.onEnd, LAYERS.offEnd, LAYERS.missed, LAYERS.fixed];
/** The colour key's green and red (toolbar-icons.ts), and a quiet grey blue for their cell. */
export const RIGHT = '#7CFFB2', WRONG = '#e06060', CELL = '#a9b6c8';
const CELL_ALPHA = 0.3;
/** Viewer voxels on the Sandbox, in nm, for how near an end a point is. */
const VIEW_NM = [4, 4, 40];

/** Each segment the heat map draws, green or red. A piece both right and
 *  wrong cannot happen: each check has its own piece. */
export function heatColors(t: TestTryDetail): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of t.checks) {
    if (!c.seg) continue;
    if (c.kind === 'cut' || c.kind === 'merge') out[c.seg] = c.ok ? RIGHT : WRONG;
    else if (!c.ok) out[c.seg] = WRONG;   // a real branch they cut off
  }
  return out;
}
/** Their points, split by whether each is within an end's reach. */
export function pointsByEnd(t: TestTryDetail): { onEnd: number[][]; offEnd: number[][] } {
  const ends = t.checks.filter(c => c.kind === 'endpoint' && Array.isArray(c.point));
  const nm = (p: number[]) => p.slice(0, 3).map((v, i) => v * VIEW_NM[i]);
  const near = (g: number[]) => ends.some(e => {
    const a = nm(g), b = nm(e.point as number[]);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= (e.radius ?? 1500);
  });
  const given = t.given.filter(g => Array.isArray(g) && g.length >= 3);
  return { onEnd: given.filter(near), offEnd: given.filter(g => !near(g)) };
}

function pointLayer(color: string, pts: { point: number[]; text: string }[], visible = true): Record<string, any> {
  return {
    type: 'annotation', source: { url: 'local://annotations' }, annotationColor: color, pointSize: 2, ...(visible ? {} : { visible: false }),
    annotations: pts.map((p, i) => ({ type: 'point', id: `r${i}`, point: p.point.slice(0, 3), description: p.text })),
  };
}
const worth = (c: TestTryCheck) => (c.kind === 'endpoint' ? c.label : `${c.label}, worth ${(c.weight ?? 1).toLocaleString('en-US')}`);
const placed = (cs: TestTryCheck[]) => cs.filter(c => Array.isArray(c.point) && c.point.length >= 3).map(c => ({ point: c.point as number[], text: worth(c) }));

function gems(color: string, pts: number[][]): Record<string, any> {
  return { ...endLayerSpec(), annotationColor: color, annotations: pts.map((g, i) => ({ type: 'point', id: `g${i}`, point: g.slice(0, 3) })) };
}

/** The annotation layers: their points, and pins on what they missed (red:
 *  a small piece is easier to find with a pin) and fixed (green, off). */
function reviewLayers(t: TestTryDetail): Record<string, any>[] {
  const p = tryParts(t), pts = pointsByEnd(t);
  return [
    { name: LAYERS.onEnd, ...gems(RIGHT, pts.onEnd) },
    { name: LAYERS.offEnd, ...gems(WRONG, pts.offEnd) },
    { name: LAYERS.missed, ...pointLayer(WRONG, placed([...p.damage, ...p.missed, ...p.endsMissed])) },
    // Off at first: on when an admin wants to see what they did find.
    { name: LAYERS.fixed, ...pointLayer(RIGHT, placed([...p.fixed, ...p.endsFound]), false) },
  ];
}

/** Leave the Admin Hub and load the test view with the player's cell as
 *  they left it. The saved view names the cell's root at registration; it is
 *  rewritten on the way in, as the test itself does, so no other copy of the
 *  cell reaches the segment list. */
export async function reviewTryInView(t: TestTryDetail) {
  if (!t.end_root) return;
  reviewingTry.value = t;
  reviewProblem.value = '';
  document.dispatchEvent(new CustomEvent('nge:test-review'));
  startDatasetTransition({
    id: 'proofreading-test-review', label: `${playerName(t)}'s cell`, eyebrow: 'Proofreading Test · Review', thumbnail: imgInspectorNurro, contain: true, hold: true,
    steps: ['Loading the test view', 'Their cell as they left it', 'Pinning what they missed'],
  });
  const root = t.end_root, dataset = t.dataset;
  const colors = heatColors(t);
  let baseName = dataset;
  setStateRewriter(async (state: any) => {
    const layers: any[] = (Array.isArray(state?.layers) ? state.layers : []).filter((l: any) => !LAYER_NAMES.includes(l?.name) && !(l?.type === 'annotation' && l.name === 'End'));
    let base: any = null;
    for (const l of layers) {
      if (l?.type !== 'segmentation') continue;
      const src = JSON.stringify(l.source ?? '');
      if (l.name === dataset || src.includes(`/table/${dataset}`)) {
        // Their cell, see-through, so the pieces inside it show.
        l.segments = [root]; delete l.equivalences;
        l.segmentColors = { [root]: CELL };
        l.objectAlpha = CELL_ALPHA;
        base = base ?? l;
      }
    }
    const extra: any[] = [];
    if (base && Object.keys(colors).length) {
      baseName = base.name;
      extra.push({ type: 'segmentation', name: LAYERS.heat, source: base.source, segments: Object.keys(colors), segmentColors: colors, objectAlpha: 1 });
    }
    state.layers = layers.concat(extra);
    return state;
  });
  try { await useLayersStore().loadState(t.state_url); }
  catch (e) { console.warn('[test review] the test view did not load:', e); }
  finally { setStateRewriter(null); }
  await new Promise(r => setTimeout(r, 800));
  showExactly(dataset, root, baseName);
  keepTryPoints(t);
  if (!cellShowing(dataset, root)) reviewProblem.value = `The test view did not load, so their cell is not on screen. Its segment ID is ${root}: paste it into the Sandbox to see it.`;
  releaseDatasetTransition();
}

// ─── Their points and the pins ───────────────────────────────────────────────
// A view's annotation layer takes points only once it knows the view's
// space, a moment after the view loads; points in the saved view itself are
// dropped (the Access review found the same, 2026-10-16). So the point layers
// are added after the load and put back whenever they are missing or short,
// for as long as the try is being looked at.
let pointsTimer: number | undefined;
function pointCount(name: string): number {
  const ml = ((window as any).viewer?.layerManager?.managedLayers ?? []).find((x: any) => x.name === name);
  try { return ml?.layer?.localAnnotations ? ml.layer.localAnnotations.toJSON().length : -1; } catch { return -1; }
}
function placeTryPoints(t: TestTryDetail): boolean {
  const v = (window as any).viewer;
  if (!v?.layerSpecification) return false;
  for (const ml of [...(v.layerManager?.managedLayers ?? [])]) if (POINT_NAMES.includes(ml.name)) v.layerManager.removeManagedLayer(ml);
  for (const { name, visible, ...spec } of reviewLayers(t)) {
    const ml = makeLayer(v.layerSpecification, name, spec);
    v.layerSpecification.add(ml);
    if (visible === false) { try { ml.setVisible(false); } catch { /* shown, then */ } }
  }
  return true;
}
function keepTryPoints(t: TestTryDetail) {
  window.clearInterval(pointsTimer);
  const want = reviewLayers(t).map(l => ({ name: l.name as string, n: (l.annotations as unknown[]).length }));
  let first = true;
  pointsTimer = window.setInterval(() => {
    if (reviewingTry.value !== t) { window.clearInterval(pointsTimer); return; }
    // A layer still loading reports nothing yet: a beat before the first try.
    if (first) { first = false; return; }
    if (!want.every(w => pointCount(w.name) === w.n)) placeTryPoints(t);
  }, 600);
}

/** The review ends: its layers go; the cell stays on screen. */
export function endTryReview() {
  const t = reviewingTry.value;
  window.clearInterval(pointsTimer);
  reviewingTry.value = null;
  reviewProblem.value = '';
  try {
    const v = (window as any).viewer;
    for (const ml of [...(v?.layerManager?.managedLayers ?? [])]) {
      if (LAYER_NAMES.includes(ml.name)) { v.layerManager.removeManagedLayer(ml); continue; }
      // Their cell, solid again.
      const url: string = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (t && (ml.name === t.dataset || url.includes(`/table/${t.dataset}`)) && ml.layer?.displayState?.objectAlpha) ml.layer.displayState.objectAlpha.value = 1;
    }
  } catch (e) { console.warn('[test review] could not end the review:', e); }
}

/** Back to the list in the Admin Hub. */
export function backToTries() {
  endTryReview();
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'tests' } }));
}
