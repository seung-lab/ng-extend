/**
 * A cell as a web address (Krzysztof #153, 2026-10-16: "right-click on a cell
 * id ... in chat to open it in a new tab/window, without disrupting our
 * current work"). A cell ID shared in chat is a real link,
 *
 *   <the game>/?cell=<segment ID>&ds=<dataset layer name>
 *
 * so the browser's own Open in new tab, middle click and Ctrl+click work. A
 * plain click still jumps in place, as before (ChatPanel.vue). Opened in a
 * new tab, the game switches to that dataset when it is another one, shows
 * the cell and moves to it, then takes the two words out of the address so a
 * reload does not jump again.
 */
import { Uint64 } from 'neuroglancer/util/uint64';
import { canonicalDataset, currentSegLayer, DATASETS, segLayerName, switchToDataset } from '../datasets';

/** A spot as a web address: <the game>/?at=x,y,z&ds=<dataset>. Used when a
 *  short link to a whole view cannot be made (a report sent without one,
 *  Ames 2026-10-18: the old "page @ x,y,z" text made a link to a missing page). */
export function spotLinkHref(pos: ArrayLike<number>, dataset?: string | null): string {
  const u = new URL(window.location.pathname, window.location.origin);
  u.searchParams.set('at', [0, 1, 2].map(i => Math.round(Number(pos[i]) || 0)).join(','));
  if (dataset) u.searchParams.set('ds', dataset);
  return u.toString();
}

export function cellLinkHref(segId: string, dataset?: string | null): string {
  const u = new URL(window.location.pathname, window.location.origin);
  u.searchParams.set('cell', segId.replace('#', ''));
  if (dataset) u.searchParams.set('ds', dataset);
  return u.toString();
}

/** Show a cell in the active segmentation layer and move to it. */
export function showCell(segId: string): boolean {
  try {
    const layer = currentSegLayer()?.layer;
    const group = layer?.displayState?.segmentationGroupState?.value;
    if (!layer || !group?.visibleSegments) return false;
    const seg = Uint64.parseString(segId);
    if (!group.visibleSegments.has(seg)) group.visibleSegments.add(seg);
    // The mesh may not be loaded yet: try the move a few times.
    const move = (attempt = 0) => {
      try { layer.moveToSegment(seg); } catch { if (attempt < 10) setTimeout(() => move(attempt + 1), 300); }
    };
    move();
    return true;
  } catch (e) {
    console.warn('[cellLink] could not show the cell:', e);
    return false;
  }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Called once at start up: opens the cell a ?cell= address names. */
export async function startCellLinks() {
  const params = new URLSearchParams(window.location.search);
  const segId = (params.get('cell') || '').replace('#', '');
  const ds = params.get('ds');
  const at = (params.get('at') || '').split(',').map(Number);
  const spot = at.length === 3 && at.every(n => Number.isFinite(n)) ? at : null;
  if (!/^\d{1,20}$/.test(segId) && !spot) return;
  // Take the words out of the address, keeping the view after the '#'.
  try {
    params.delete('cell'); params.delete('ds'); params.delete('at');
    const q = params.toString();
    history.replaceState(history.state, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
  } catch { /* the address keeps them; harmless */ }
  // Wait for a segmentation layer (the start view loads first).
  for (let i = 0; i < 60 && !currentSegLayer()?.layer; i++) await wait(500);
  if (!currentSegLayer()?.layer) return;
  await wait(1500);
  const target = ds ? DATASETS.find(d => canonicalDataset(segLayerName(d)) === canonicalDataset(ds)) : undefined;
  const active = currentSegLayer()?.name;
  if (target && (!active || canonicalDataset(ds!) !== canonicalDataset(active))) {
    const ok = await switchToDataset(target, { forJump: true });
    if (ok) await wait(1200);
  }
  if (spot) {
    try { (window as any).viewer.navigationState.position.value = Float32Array.from(spot); } catch { /* the view stays put */ }
    return;
  }
  for (let i = 0; i < 10 && !showCell(segId); i++) await wait(500);
}
