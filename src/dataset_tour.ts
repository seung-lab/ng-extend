/**
 * Dataset onboarding (Ames 2026-10-05): the first time someone enters a
 * dataset from the dataset switcher, they get that dataset's guided tour of
 * its cell types. Each tour is a tutorial (Tutorial.vue); MEC is the first
 * (tutorial 6, src/tutorial-mec-tour.ts). Add a dataset by writing its steps
 * and registering the tutorial number here.
 *
 * A tour runs once per browser on its own. It can be replayed any time from
 * the "tour" link at the top of the Cell Library.
 */
import { useTutorialStore } from './store-pyr';
import { canonicalDataset } from './datasets';

const TOUR_TUTORIAL: Record<string, number> = {
  pni_mec: 6,
  stroeh_mouse_retina: 7,
  flywire_fafb_public: 8,
  flywire_fafb_production: 8,
};

const seenKey = (dataset: string) => `nge-dataset-tour-seen:${dataset}`;

/** Does this dataset have a guided tour? */
export function datasetHasTour(dataset: string): boolean {
  return canonicalDataset(dataset) in TOUR_TUTORIAL;
}

/** Another tutorial (or its resume card) is on screen. */
function tutorialOnScreen(): boolean {
  return !!document.querySelector('.introductionStep, .nge-tut-resume');
}

/** Start the dataset's tour from its first step. */
export function startDatasetTour(dataset: string): boolean {
  const canon = canonicalDataset(dataset);
  const tutorial = TOUR_TUTORIAL[canon];
  if (!tutorial) return false;
  try { localStorage.setItem(seenKey(canon), new Date().toISOString()); } catch { /* private window */ }
  const store = useTutorialStore();
  store.activeTutorial = tutorial;
  store.setTutorialStep(0);
  return true;
}

const PENDING_KEY = 'nge-dataset-tour-pending';

/**
 * Called by the dataset switcher just before it switches. Entering a curated
 * dataset reloads the page, so the request is parked in sessionStorage and
 * picked up by runPendingDatasetTour, on this page or the reloaded one.
 */
export function queueDatasetTour(dataset: string) {
  const canon = canonicalDataset(dataset);
  if (!TOUR_TUTORIAL[canon]) return;
  try {
    if (localStorage.getItem(seenKey(canon))) return;
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ dataset: canon, t0: Date.now() }));
  } catch { /* private window: no tour */ }
}

/** The dataset whose segmentation layer is in the viewer right now. */
function datasetInViewer(): string {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const layers: any[] = (window as any)['viewer']?.layerManager?.managedLayers ?? [];
  const seg = layers.find(l => l.layer?.tabs?.options?.has?.('segments'));
  return seg ? canonicalDataset(seg.name) : '';
}

let waiting = false;
/** Start a queued tour once its dataset has arrived (app start, and after a
 *  switch that did not reload). Gives up quietly after a minute. */
export function runPendingDatasetTour() {
  if (waiting) return;
  let pending: { dataset: string; t0: number } | null = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { /* ignore */ }
  if (!pending?.dataset) return;
  const clear = () => { waiting = false; try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } };
  if (Date.now() - pending.t0 > 60000) { clear(); return; }
  waiting = true;
  const { dataset, t0 } = pending;
  const tick = () => {
    if (Date.now() - t0 > 60000) { clear(); return; }
    if (datasetInViewer() !== dataset) { setTimeout(tick, 500); return; }
    clear();
    // Let the "Now entering" card finish before the welcome box appears.
    setTimeout(() => { if (!tutorialOnScreen()) startDatasetTour(dataset); }, 2500);
  };
  tick();
}
