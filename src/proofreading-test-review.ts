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
export interface TestTriesList {
  /** False until supabase-proofreading-test-tries.sql has run: no cells kept. */
  kept: boolean;
  test: { id: string; title: string; enabled: boolean; status: string; pass_mark: number; time_limit_minutes: number | null;
    holder: string | null; claimed_at: string | null; deadline_at: string | null } | null;
  /** The key as it stands, in counts only. */
  key: { mistakes: number; ends: number; protect: number; points: number } | null;
  tries: TestTry[];
}
export interface TestTryCheck { kind: string; label: string; ok: boolean; weight: number; point: number[] | null }
export interface TestTryDetail extends TestTry {
  dataset: string; state_url: string; checks: TestTryCheck[];
  /** Every point annotation the player had when it was scored. */
  given: number[][]; stray: number | null;
}

export function listTestTries(): Promise<TestTriesList> {
  return secureWrite<TestTriesList>('test.tries', {});
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

/** The layers the review adds; they go when it ends. Their own points are
 *  the pink Pyr gems they placed in the test's End layer. */
const LAYERS = {
  points: 'Their points',
  missed: 'Missed',
  damage: 'Damage',
  fixed: 'Fixed',
} as const;
const LAYER_NAMES: string[] = Object.values(LAYERS);

function pointLayer(color: string, pts: { point: number[]; text: string }[], visible = true): Record<string, any> {
  return {
    type: 'annotation', source: { url: 'local://annotations' }, annotationColor: color, pointSize: 2, ...(visible ? {} : { visible: false }),
    annotations: pts.map((p, i) => ({ type: 'point', id: `r${i}`, point: p.point.slice(0, 3), description: p.text })),
  };
}
const worth = (c: TestTryCheck) => (c.kind === 'endpoint' ? c.label : `${c.label}, worth ${(c.weight ?? 1).toLocaleString('en-US')}`);
const placed = (cs: TestTryCheck[]) => cs.filter(c => Array.isArray(c.point) && c.point.length >= 3).map(c => ({ point: c.point as number[], text: worth(c) }));

function reviewLayers(t: TestTryDetail): Record<string, any>[] {
  const p = tryParts(t);
  return [
    { name: LAYERS.points, ...endLayerSpec(), annotations: t.given.filter(g => Array.isArray(g) && g.length >= 3).map((g, i) => ({ type: 'point', id: `g${i}`, point: g.slice(0, 3) })) },
    { name: LAYERS.missed, ...pointLayer('#f5d142', placed([...p.missed, ...p.endsMissed])) },
    { name: LAYERS.damage, ...pointLayer('#e06060', placed(p.damage)) },
    // Off at first: on when an admin wants to see what they did find.
    { name: LAYERS.fixed, ...pointLayer('#7CFFB2', placed([...p.fixed, ...p.endsFound]), false) },
  ];
}

/** Leave the Admin Hub and load the test view with the player's cell as
 *  they left it. The saved view names the cell's root at registration; it is
 *  rewritten on the way in, as the test itself does, so no other copy of the
 *  cell reaches the segment list. */
export async function reviewTryInView(t: TestTryDetail) {
  if (!t.end_root) return;
  reviewingTry.value = t;
  document.dispatchEvent(new CustomEvent('nge:test-review'));
  startDatasetTransition({
    id: 'proofreading-test-review', label: `${playerName(t)}'s cell`, eyebrow: 'Proofreading Test · Review', thumbnail: imgInspectorNurro, contain: true, hold: true,
    steps: ['Loading the test view', 'Their cell as they left it', 'Pinning what they missed'],
  });
  const root = t.end_root, dataset = t.dataset;
  setStateRewriter(async (state: any) => {
    const layers: any[] = Array.isArray(state?.layers) ? state.layers : [];
    for (const l of layers) {
      if (l?.type !== 'segmentation') continue;
      const src = JSON.stringify(l.source ?? '');
      if (l.name === dataset || src.includes(`/table/${dataset}`)) { l.segments = [root]; delete l.equivalences; }
    }
    state.layers = layers.filter(l => !(l?.type === 'annotation' && (l.name === 'End' || LAYER_NAMES.includes(l.name)))).concat(reviewLayers(t));
    return state;
  });
  try { await useLayersStore().loadState(t.state_url); }
  catch (e) { console.warn('[test review] the test view did not load:', e); }
  finally { setStateRewriter(null); }
  await new Promise(r => setTimeout(r, 800));
  showExactly(dataset, root);
  releaseDatasetTransition();
}

/** The review ends: its layers go; the cell stays on screen. */
export function endTryReview() {
  reviewingTry.value = null;
  try {
    const v = (window as any).viewer;
    for (const ml of [...(v?.layerManager?.managedLayers ?? [])]) {
      if (LAYER_NAMES.includes(ml.name)) v.layerManager.removeManagedLayer(ml);
    }
  } catch (e) { console.warn('[test review] could not end the review:', e); }
}

/** Back to the list in the Admin Hub. */
export function backToTries() {
  endTryReview();
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'tests' } }));
}
