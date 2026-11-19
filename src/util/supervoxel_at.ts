/**
 * The supervoxel at a place in viewer coordinates, read from the stored
 * segmentation's finest scale, one chunk fetched by itself. Works on raw AND
 * compressed_segmentation chunks (Retina stores compressed_segmentation, so
 * supervoxelAtPlace in crosshair_cell.ts returns null there). Decoded with
 * neuroglancer's own reader. Added for the Muller Glia Quest's split check
 * (2026-11-19); needs nothing loaded on screen.
 */
import { Uint64 } from 'neuroglancer/util/uint64';
import { readSingleChannelValue } from 'neuroglancer/sliceview/compressed_segmentation/decode_uint64';
import { authHeaders, getPcgInfo } from '../widgets/pcg_service';
import { supervoxelAtPlace } from './crosshair_cell';

const infoCache = new Map<string, Promise<any>>();

export async function supervoxelAt(place: number[]): Promise<string | null> {
  const raw = await supervoxelAtPlace(place);
  if (raw) return raw;
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
    const scale = info?.scales?.[0];
    const dataDir: string = info?.data_dir ?? '';
    if (!dataDir || !scale || scale.encoding !== 'compressed_segmentation') { infoCache.delete(key); return null; }
    const block: number[] = scale.compressed_segmentation_block_size || [8, 8, 8];
    const base = dataDir.replace(/^gs:\/\//, 'https://storage.googleapis.com/').replace(/\/$/, '');
    const scales: Float64Array = viewer.coordinateSpace.value.scales;
    const nm = place.slice(0, 3).map((v, i) => v * scales[i] * 1e9);
    const res: number[] = scale.resolution, off: number[] = scale.voxel_offset, size: number[] = scale.size, chunk: number[] = scale.chunk_sizes[0];
    const vox = nm.map((v, i) => Math.floor(v / res[i]));
    if (vox.some((v, i) => v < off[i] || v >= off[i] + size[i])) return '0';
    const c0 = vox.map((v, i) => off[i] + Math.floor((v - off[i]) / chunk[i]) * chunk[i]);
    const c1 = c0.map((v, i) => Math.min(v + chunk[i], off[i] + size[i]));
    const r = await fetch(`${base}/${scale.key}/${c0[0]}-${c1[0]}_${c0[1]}-${c1[1]}_${c0[2]}-${c1[2]}`);
    if (!r.ok) return null;
    const data = new Uint32Array(await r.arrayBuffer());
    const out = new Uint64();
    readSingleChannelValue(out, data, data[0], c1.map((v, i) => v - c0[i]), block, vox.map((v, i) => v - c0[i]));
    return out.toString();
  } catch {
    return null;
  }
}
