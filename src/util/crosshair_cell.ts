/**
 * Which cell is under the crosshairs (Amy 2026-09-28: Complete must "make sure
 * crosshairs are in cell"). Reads the segmentation value at the viewer's
 * crosshair position from chunks neuroglancer has already loaded
 * (UserLayer.getValueAt, the same lookup the hover readout uses), then asks the
 * PyChunkedGraph for that supervoxel's CURRENT root, so edits made while
 * proofreading are accounted for.
 */
import { currentSegLayer } from '../datasets';
import { getRootFromSupervoxel } from '../widgets/pcg_service';

export interface CrosshairCell {
  /** Crosshair position, rounded voxel coordinates. */
  position: [number, number, number];
  /** Supervoxel at the crosshairs, or null (no data loaded there / empty space). */
  supervoxel: string | null;
  /** Current root of that supervoxel, or null if it could not be resolved. */
  root: string | null;
  /** Why root is null, in plain words. */
  problem?: string;
}

function idString(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'string') return v;
  // Uint64 ({low, high} with toString), or an equivalence entry {key, value}.
  if (typeof v.low === 'number' && typeof v.toString === 'function') return v.toString();
  if (v.key != null) return idString(v.key);
  if (Array.isArray(v)) return idString(v[0]);
  return null;
}

export async function cellAtCrosshair(): Promise<CrosshairCell> {
  const viewer: any = (window as any)['viewer'];
  const raw = viewer?.navigationState?.position?.value;
  const position = (raw ? Array.from(raw as Float32Array).slice(0, 3).map(v => Math.round(Number(v))) : [0, 0, 0]) as [number, number, number];
  const ml = currentSegLayer();
  if (!ml?.layer?.getValueAt || !raw) {
    return { position, supervoxel: null, root: null, problem: 'No segmentation layer is loaded.' };
  }
  let value: any = null;
  try { value = ml.layer.getValueAt(raw, { pickedRenderLayer: null }); } catch { value = null; }
  const sv = idString(value);
  if (!sv) {
    return { position, supervoxel: null, root: null,
      problem: 'Nothing is loaded at the crosshairs yet. Look at the 2D view so it can load, then check again.' };
  }
  if (sv === '0') {
    return { position, supervoxel: sv, root: null, problem: 'The crosshairs are on empty space, not inside a cell.' };
  }
  const root = await getRootFromSupervoxel(sv);
  if (!root) return { position, supervoxel: sv, root: null, problem: 'Could not look up the cell at the crosshairs (sign in, or try again).' };
  return { position, supervoxel: sv, root };
}
