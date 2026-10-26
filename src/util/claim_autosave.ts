/**
 * The cell you are working on keeps its own view saved (toknow, report 253:
 * "sometimes I lose my highlight when re-opening an unfinished cell").
 *
 * A claim's view (its working link, the one the Cell Library reopens) was
 * saved only when you switched to another claim or pressed Save view. The
 * browser autosave (view_autosave.ts) skips any view over 240 KB, and a cell
 * with a lot of highlighting is bigger than that, so after a reload, a closed
 * tab or a crash the cell came back without its newer highlights.
 *
 * Now, while a claim is the working one and its cell is on screen, its view is
 * saved to the claim the same way Save view does: a while after the last
 * change, and when the tab is hidden. Only when the claimed cell is in view, so
 * looking at another cell never overwrites the claim's view.
 */
import { useProofreadingBackendStore } from '../store';
import { mintShortStateLink } from './state_link';
import { currentSegLayer } from '../datasets';

const WORKING_KEY = 'nge_cl_working_task';   // CellLibraryPanel.vue writes it
const QUIET_MS = 90_000;                       // save this long after the last change
const MIN_GAP_MS = 120_000;                    // and at most this often

function workingTask(): number | null {
  for (const store of [sessionStorage, localStorage]) {
    try { const v = Number(store.getItem(WORKING_KEY)); if (Number.isFinite(v) && v > 0) return v; } catch { /* blocked */ }
  }
  return null;
}

/** The claimed cell (or its current id after edits) is shown in the view. */
function claimOnScreen(taskId: number): boolean {
  const backend = useProofreadingBackendStore();
  const t = backend.tasks.find(x => x.id === taskId);
  if (!t) return false;
  const ids = new Set([t.segment_id, (t as any).final_segment_id, backend.currentRoots[taskId]].filter(Boolean).map(String));
  try {
    const shown = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    for (const s of shown ?? []) if (ids.has(s.toString())) return true;
  } catch { /* no layer */ }
  return false;
}

let lastSaved = '';
let lastAt = 0;
let saving = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function saveClaim(force = false) {
  timer = null;
  const id = workingTask();
  const viewer: any = (window as any).viewer;
  if (!id || !viewer?.state || saving || !claimOnScreen(id)) return;
  let text = '';
  try { text = JSON.stringify(viewer.state.toJSON()); } catch { return; }
  if (text === lastSaved) return;
  const wait = MIN_GAP_MS - (Date.now() - lastAt);
  if (!force && wait > 0) { timer = setTimeout(() => void saveClaim(), wait); return; }
  saving = true;
  lastAt = Date.now();
  try {
    const link = await mintShortStateLink();
    if (link && await useProofreadingBackendStore().saveWorkingLink(id, link)) lastSaved = text;
  } catch (e) {
    console.warn('[claim autosave]', e);
  } finally { saving = false; }
}

export function startClaimAutosave(viewer: any) {
  try {
    viewer.state.changed.add(() => {
      if (!workingTask()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveClaim(), QUIET_MS);
    });
  } catch { /* no state signal */ }
  document.addEventListener('visibilitychange', () => { if (document.hidden) void saveClaim(true); });
}
