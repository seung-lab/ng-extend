/**
 * One way to finish a claimed cell (Amy 2026-09-28). "Mark as Proofread" in
 * the segment menu or the Cell Profile used to write CAVE only and RELEASE the
 * claim, so the sheet never heard about it and the Cell Library showed the
 * cell as available again. When you hold a Cell Library claim, those buttons
 * now hand off to the Cell Library's Complete form instead, which writes CAVE,
 * the claim and the sheet together.
 *
 * The request carries the segment you were looking at. It may not equal the
 * claim's Start SegID once you have edited the cell (edits give it a new root),
 * so the Cell Library matches it where it can and otherwise asks which claim
 * you finished; the Complete form then records the root under the crosshairs
 * as the Final SegID.
 */
import { ref } from 'vue';
import { useProofreadingBackendStore } from '../store';

export const pendingCompleteRequest = ref<{ segId: string } | null>(null);

/** Returns true when the request was handed to the Cell Library. */
export function requestCompleteClaim(segId: string): boolean {
  const backend = useProofreadingBackendStore();
  if (!backend.userId) return false;
  const mine = backend.tasks.filter(t =>
    t.assigned_to === backend.userId && (t.status === 'assigned' || t.status === 'in_progress'));
  if (!mine.length) return false;
  pendingCompleteRequest.value = { segId };
  document.dispatchEvent(new CustomEvent('nge:open-cell-library'));
  return true;
}
