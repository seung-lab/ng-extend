/**
 * Play carries a new player through the training first (Ames 2026-11-12: "if
 * player has not completed the tutorials (started, cut, merge, annotations,
 * advanced) then Start Playing carries them on in the training").
 *
 * The order is the game's own: Get Started, Merge, Cut, Annotations, then
 * Advanced Interface. Until all five are finished, Play (the button, a dataset
 * card's Start playing, Play here) opens the first one not yet finished, or
 * brings back the one under way, instead of claiming a cell.
 *
 * Finished means any of: a row in tutorial_completions for the account, the
 * tutorial's Achievement on the account, or this browser's own record of it
 * (players who finished before the table existed, or while signed out).
 */
import { supabase } from '../supabase';
import { useProofreadingBackendStore } from '../store';
import { useTutorialStore } from '../store-pyr';
import { DATASETS } from '../datasets';
import { editsAny, loadDatasetPermissions } from './dataset_access';

export const TRAINING: number[] = [1, 3, 5, 15, 2];

/** This browser's own note of each finish, and the Achievement that says so. */
const LOCAL: Record<number, string> = {
  1: 'nge-badge-citizen-scientist',
  2: 'nge-badge-advanced-operator',
  3: 'nge-badge-mini-michelangelo',
  5: 'nge-badge-safety-scissors',
  15: 'nge-annotations-tutorial-finished',
};
const ACHIEVEMENT: Record<number, string[]> = {
  1: ['citizen-scientist', 'Citizen Scientist'],
  2: ['advanced-operator', 'Advanced Operator'],
  3: ['mini-michelangelo', 'Mini Michelangelo'],
  5: ['safety-scissors', 'Safety Scissors'],
  15: ['annotations-tutorial'],
};

/** Tutorials finished, as far as can be told. */
async function finished(): Promise<Set<number>> {
  const done = new Set<number>();
  for (const t of TRAINING) {
    try { if (localStorage.getItem(LOCAL[t])) done.add(t); } catch { /* private window */ }
  }
  try {
    const backend = useProofreadingBackendStore();
    for (const a of backend.mySpecialBadges as any[]) {
      const names = [a?.badge?.slug, a?.badge?.name].filter(Boolean);
      for (const t of TRAINING) if (ACHIEVEMENT[t].some(n => names.includes(n) || names.includes('nge-badge-' + n))) done.add(t);
    }
    const uid = backend.userId;
    if (uid && done.size < TRAINING.length) {
      const { data } = await supabase.from('tutorial_completions')
        .select('tutorial').eq('user_id', uid).in('tutorial', TRAINING);
      for (const r of (data ?? []) as Array<{ tutorial: number }>) done.add(Number(r.tutorial));
    }
  } catch { /* what is known locally stands */ }
  return done;
}

/** Production access (or an admin): the training is behind them, whatever
 *  the records say (Ames 2026-11-12). */
async function hasProduction(): Promise<boolean> {
  try { if (useProofreadingBackendStore().isAdmin) return true; } catch { /* store not ready */ }
  try {
    await loadDatasetPermissions();
    return editsAny(DATASETS.filter(d => d.section === 'production').map(d => d.caveDataset)) === true;
  } catch { return false; }
}

/** The first tutorial still to do, or null when the training is behind them. */
export async function trainingLeft(): Promise<number | null> {
  const pro = await Promise.race([hasProduction(), new Promise<boolean>(r => setTimeout(() => r(false), 3000))]);
  if (pro) return null;
  const done = await Promise.race([
    finished(),
    new Promise<null>(r => setTimeout(() => r(null), 4000)),
  ]);
  // Could not tell in time: let them play rather than trap them.
  if (!done) return null;
  return TRAINING.find(t => !done.has(t)) ?? null;
}

/** Open that tutorial: the one under way comes back where it was. */
export function openTraining(t: number) {
  const store = useTutorialStore();
  const underWay = store.activeTutorial === t && store.getTutorialStep() > 0;
  document.dispatchEvent(new CustomEvent(underWay ? 'nge:start-here' : 'nge:tutorial-start', { detail: { id: t } }));
}
