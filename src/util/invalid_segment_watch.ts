/**
 * Says so when an ID that cannot be a cell is added to the view.
 *
 * A player pasted a cell ID that had lost its first digit; the 3D view simply
 * stayed empty and it was reported as "segment won't load" (Nseraf
 * 2026-10-07). An ID in a proofreading dataset carries the level it lives on
 * in its top bits, and level 0 does not exist: a cell ID with digits missing
 * from the front always lands there. Such an ID is taken back out of the view
 * and the player is told why.
 *
 * This only catches IDs that can be ruled out without asking the server. An
 * ID with a digit missing from the END still looks like a real level and is
 * not caught here.
 */
import { Uint64 } from 'neuroglancer/util/uint64';
import { StatusMessage } from 'neuroglancer/status';

const watched = new WeakSet<object>();

function levelOf(id: Uint64, nBitsForLayerId: number): number {
  return Uint64.rshift(new Uint64(), id, 64 - nBitsForLayerId).low;
}

function check(managed: any) {
  const layer = managed?.layer;
  const nBits = layer?.graphConnection?.value?.graph?.info?.graph?.nBitsForLayerId;
  const visible = layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!nBits || !visible) return;
  const bad: Uint64[] = [];
  for (const id of visible) {
    const copy = new Uint64(id.low, id.high);
    if ((copy.low !== 0 || copy.high !== 0) && levelOf(copy, nBits) === 0) bad.push(copy);
  }
  if (!bad.length) return;
  for (const id of bad) visible.delete(id);
  const list = bad.slice(0, 3).map(b => b.toString()).join(', ') + (bad.length > 3 ? ` and ${bad.length - 3} more` : '');
  StatusMessage.showTemporaryMessage(
    `${list} is not a cell ID in this dataset. It looks like digits are missing from the start, so it was not added. Check the ID and paste it again.`, 9000);
}

export function startInvalidSegmentWatch(viewer: any) {
  const scan = () => {
    for (const managed of viewer?.layerManager?.managedLayers ?? []) {
      const visible = managed?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
      if (!visible?.changed?.add) continue;
      // The graph arrives a moment after the layer: look again each time.
      if (!watched.has(visible)) {
        watched.add(visible);
        visible.changed.add(() => { try { check(managed); } catch { /* never in the way */ } });
      }
      try { check(managed); } catch { /* never in the way */ }
    }
  };
  try { viewer.layerManager.layersChanged.add(scan); } catch { /* no viewer */ }
  scan();
}
