/**
 * The "Now entering <dataset>" moment when switching datasets.
 *
 * Switching to a dataset with a curated view RELOADS the page (selectLayers
 * sets the hash and calls location.reload()), which wiped any confirmation
 * the old code showed. So the transition is written to sessionStorage before
 * the switch and picked up again after the reload, and DatasetTransition.vue
 * plays it through: large thumbnail and a loading animation for a couple of
 * seconds, then the tag mode zip up, then a particle pop.
 */
import { reactive } from 'vue';

export interface DatasetTransition {
  id: string;
  label: string;
  thumbnail?: string;
  /** When the switch was clicked, so time spent reloading counts. */
  t0: number;
  /** Custom cards (the tutorials' "Moving you to the Sandbox"): */
  eyebrow?: string;
  steps?: string[];
  /** Show the whole picture rather than filling the frame. */
  contain?: boolean;
  /** Stay up until releaseDatasetTransition() (or 25 s), for loads that
   *  take as long as they take. */
  hold?: boolean;
}

const KEY = 'nge-ds-transition';

export const datasetTransition = reactive<{ current: DatasetTransition | null; resumed: boolean; released: boolean }>({
  current: null,
  resumed: false,
  released: false,
});

export function startDatasetTransition(ds: Omit<DatasetTransition, 't0'>) {
  const t: DatasetTransition = { ...ds, t0: Date.now() };
  datasetTransition.current = t;
  datasetTransition.resumed = false;
  datasetTransition.released = false;
  try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

/** After a reload: continue a transition that started in the last 20 s. */
export function resumeDatasetTransition() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    const t = JSON.parse(raw) as DatasetTransition;
    if (!t?.label || Date.now() - t.t0 > 20000) { sessionStorage.removeItem(KEY); return; }
    datasetTransition.current = t;
    datasetTransition.resumed = true;
  } catch { /* nothing to resume */ }
}

/** A held card may now play out (it zips away once its minimum time is up). */
export function releaseDatasetTransition() {
  datasetTransition.released = true;
}

export function endDatasetTransition() {
  datasetTransition.current = null;
  datasetTransition.resumed = false;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
