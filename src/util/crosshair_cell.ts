/**
 * Which cell is under the crosshairs (Amy 2026-09-28: Complete must "make sure
 * crosshairs are in cell"). Reads the segmentation value at the viewer's
 * crosshair position from chunks neuroglancer has already loaded
 * (UserLayer.getValueAt, the same lookup the hover readout uses), then asks the
 * PyChunkedGraph for that supervoxel's CURRENT root, so edits made while
 * proofreading are accounted for.
 */
import { currentSegLayer } from '../datasets';
import { authHeaders, getPcgInfo, getRootFromSupervoxel } from '../widgets/pcg_service';

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

/**
 * The supervoxel at a place, read straight from the stored segmentation: one
 * chunk of the finest scale, fetched by itself. Needs no 2D view and nothing
 * loaded on screen, so a pasted coordinate finds its cell wherever the player
 * is looking (Ames and a player, 2026-10-20: pasted coordinates "never ever
 * appear", and opening the 2D view for them was unwanted). Only for chunked
 * graph layers whose finest scale is stored raw; null otherwise, and the
 * caller falls back to cellAtCrosshair.
 */
const infoCache = new Map<string, Promise<any>>();
export async function supervoxelAtPlace(place: number[]): Promise<string | null> {
  try {
    const pcg = getPcgInfo();
    const viewer: any = (window as any)['viewer'];
    if (!pcg || !viewer) return null;
    const key = `${pcg.server}/${pcg.table}`;
    if (!infoCache.has(key)) {
      infoCache.set(key, fetch(`${pcg.server}/segmentation/table/${pcg.table}/info`, { headers: authHeaders(pcg.server) })
        .then(r => (r.ok ? r.json() : null)).catch(() => null));
    }
    const info = await infoCache.get(key);
    const dataDir: string = info?.data_dir ?? '';
    const scale = info?.scales?.[0];
    if (!dataDir || !scale || scale.encoding !== 'raw' || (info.data_type && info.data_type !== 'uint64')) { infoCache.delete(key); return null; }
    const base = dataDir.replace(/^gs:\/\//, 'https://storage.googleapis.com/').replace(/\/$/, '');
    // Viewer coordinates to nanometres, then to this scale's voxels.
    const scales: Float64Array = viewer.coordinateSpace.value.scales;
    const nm = place.slice(0, 3).map((v, i) => v * scales[i] * 1e9);
    const res: number[] = scale.resolution, off: number[] = scale.voxel_offset, size: number[] = scale.size, chunk: number[] = scale.chunk_sizes[0];
    const vox = nm.map((v, i) => Math.floor(v / res[i]));
    if (vox.some((v, i) => v < off[i] || v >= off[i] + size[i])) return '0';
    const c0 = vox.map((v, i) => off[i] + Math.floor((v - off[i]) / chunk[i]) * chunk[i]);
    const c1 = c0.map((v, i) => Math.min(v + chunk[i], off[i] + size[i]));
    const url = `${base}/${scale.key}/${c0[0]}-${c1[0]}_${c0[1]}-${c1[1]}_${c0[2]}-${c1[2]}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const dx = c1[0] - c0[0], dy = c1[1] - c0[1];
    const idx = (vox[0] - c0[0]) + dx * ((vox[1] - c0[1]) + dy * (vox[2] - c0[2]));
    if ((idx + 1) * 8 > buf.byteLength) return null;
    return new DataView(buf).getBigUint64(idx * 8, true).toString();
  } catch {
    return null;
  }
}
