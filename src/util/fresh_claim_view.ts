/**
 * Bring a claim's view up to date after its saved view is opened.
 */
import { currentSegLayer } from '../datasets';
import { isLatestRoots } from '../widgets/pcg_service';
import { currentIdsOf } from './outdated_ids';
import { Uint64 } from 'neuroglancer/util/uint64';

/** The store's part this needs: the claims' current roots, freshly looked up. */
export interface ClaimRoots { liveRoots: Record<number, string>; refreshLiveRoots(): Promise<void> }

/** A claim's saved view (or its start view) keeps the cell's ID from when it
 *  was saved, so it showed the cell as it was then: a cut made since looked
 *  undone (Ames 2026-11-13: "it reverted my cut (loaded old state)"). The
 *  edits are on the server; only the ID was old. Once the view has loaded,
 *  any ID of this claim's cell that is out of date is swapped for the cell's
 *  current ID. Only that one: a piece cut off is not brought back, and other
 *  cells in the view are left as they are. */
export async function freshenClaimView(taskId: number, backend: ClaimRoots): Promise<string[]> {
  const swapped: string[] = [];
  const visible = () => currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value;
  // The view loads from the address a moment after it is set.
  for (let i = 0; i < 20 && !visible()?.visibleSegments?.size; i++) await new Promise(res => setTimeout(res, 300));
  await new Promise(res => setTimeout(res, 600));
  await backend.refreshLiveRoots().catch(() => null);
  const root = backend.liveRoots[taskId];
  const group = visible();
  if (!root || !group?.visibleSegments) return swapped;
  const shown = [...group.visibleSegments].map(String).filter(id => id !== root && /^\d+$/.test(id));
  if (!shown.length) return swapped;
  let latest: Map<string, boolean> | null = null;
  try { latest = await isLatestRoots(shown); } catch { return swapped; }
  for (const id of shown) {
    if (latest?.get(id) !== false) continue;
    const ends = await currentIdsOf(id).catch(() => null);
    if (!ends || !ends.includes(root)) continue;
    try {
      const old = Uint64.parseString(id);
      const now = Uint64.parseString(root);
      const wasSelected = !!group.selectedSegments?.has(old);
      group.visibleSegments.delete(old);
      group.selectedSegments?.delete(old);
      group.visibleSegments.add(now);
      if (wasSelected) group.selectedSegments?.add(now);
      swapped.push(id);
      console.debug('[cell library] claim', taskId, 'view had', id, 'now', root);
    } catch { /* layer went away */ }
  }
  return swapped;
}

/** For headless checks. */
(window as any).__ngeFreshenClaimView = freshenClaimView;
