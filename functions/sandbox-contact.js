'use strict';
// Where a piece meets a cell, to the voxel (Ames 2026-11-14: the hint's pin
// sat "in empty space on the wrong cell"; it should be "at or near the end of
// the branch of the current segmented cell / near origin of merger").
//
// The Sandbox graph keeps no point per piece (no l2cache), and a supervoxel id
// only says which 4 µm chunk it is in. So this reads the supervoxels
// themselves, the public watershed volume at 16 x 16 x 40 nm, around the two
// chunks where the cell and the piece come nearest, and finds the voxels of
// the cell that touch the piece.

const WS = {
  url: 'https://storage.googleapis.com/pcg_ws/pinky100_v0/ws/pinky100_ca_com/16_16_40',
  res: [16, 16, 40], offset: [9048, 7639, 21], size: [21482, 12768, 2136], chunk: [256, 256, 32],
};
/** A graph chunk (512 x 512 x 128 at 8 nm) in 16 nm voxels. */
const GRAPH = {size: [256, 256, 128]};
const CHUNK_SHIFT = 64n - 8n - 30n;

/** Is bigint v in the sorted BigUint64Array set? */
function has(set, v) {
  let lo = 0, hi = set.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (set[m] === v) return true;
    if (set[m] < v) lo = m + 1; else hi = m - 1;
  }
  return false;
}

/** The chunk of a supervoxel as [x, y, z]. */
function chunkXYZ(sv) {
  const c = BigInt(sv) >> CHUNK_SHIFT;
  return [Number((c >> 20n) & 1023n), Number((c >> 10n) & 1023n), Number(c & 1023n)];
}

/** Decode one compressed_segmentation (uint64, one channel) chunk of dims
 *  [x, y, z] into classes per voxel (x fastest), through classOf(bigint). */
function decodeClasses(buf, dims, classOf) {
  const u = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
  const base = u[0];
  const out = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const g = dims.map(d => Math.ceil(d / 8));
  const cache = new Map();
  for (let bz = 0; bz < g[2]; bz++) for (let by = 0; by < g[1]; by++) for (let bx = 0; bx < g[0]; bx++) {
    const bi = (bz * g[1] + by) * g[0] + bx;
    const h0 = u[base + 2 * bi], h1 = u[base + 2 * bi + 1];
    const table = base + (h0 & 0xffffff), bits = h0 >>> 24, values = base + h1;
    const mask = bits ? (bits === 32 ? 0xffffffff : (1 << bits) - 1) : 0;
    for (let z = 0; z < 8; z++) {
      const vz = bz * 8 + z; if (vz >= dims[2]) break;
      for (let y = 0; y < 8; y++) {
        const vy = by * 8 + y; if (vy >= dims[1]) break;
        for (let x = 0; x < 8; x++) {
          const vx = bx * 8 + x; if (vx >= dims[0]) break;
          let k = 0;
          if (bits) {
            const i = ((z * 8 + y) * 8 + x) * bits;
            k = (u[values + (i >>> 5)] >>> (i & 31)) & mask;
          }
          const at = table + 2 * k;
          let c = cache.get(at);
          if (c === undefined) {
            c = classOf((BigInt(u[at + 1]) << 32n) | BigInt(u[at]));
            cache.set(at, c);
          }
          out[(vz * dims[1] + vy) * dims[0] + vx] = c;
        }
      }
    }
  }
  return out;
}

/** The box of graph chunks lo..hi (inclusive), in 16 nm voxels, clipped to the volume. */
function boxOf(lo, hi) {
  const a = [0, 1, 2].map(i => WS.offset[i] + lo[i] * GRAPH.size[i]);
  const b = [0, 1, 2].map(i => Math.min(WS.offset[i] + (hi[i] + 1) * GRAPH.size[i], WS.offset[i] + WS.size[i]));
  return {a, b, dims: [0, 1, 2].map(i => b[i] - a[i])};
}

/** Classes over a box: 1 = the cell, 2 = the piece, 0 = other. */
async function readBox(fetchImpl, box, classOf) {
  const vol = new Uint8Array(box.dims[0] * box.dims[1] * box.dims[2]);
  const jobs = [];
  const start = i => WS.offset[i] + Math.floor((box.a[i] - WS.offset[i]) / WS.chunk[i]) * WS.chunk[i];
  for (let z = start(2); z < box.b[2]; z += WS.chunk[2])
    for (let y = start(1); y < box.b[1]; y += WS.chunk[1])
      for (let x = start(0); x < box.b[0]; x += WS.chunk[0]) jobs.push([x, y, z]);
  if (jobs.length > 32) throw new Error('too much to read for one hint');
  const end = i => WS.offset[i] + WS.size[i];
  await Promise.all(jobs.map(async ([x, y, z]) => {
    const e = [Math.min(x + WS.chunk[0], end(0)), Math.min(y + WS.chunk[1], end(1)), Math.min(z + WS.chunk[2], end(2))];
    const r = await fetchImpl(`${WS.url}/${x}-${e[0]}_${y}-${e[1]}_${z}-${e[2]}`, {signal: AbortSignal.timeout(20000)});
    if (r.status === 404) return; // empty space
    if (!r.ok) throw new Error(`watershed answered ${r.status}`);
    const dims = [e[0] - x, e[1] - y, e[2] - z];
    const c = decodeClasses(Buffer.from(await r.arrayBuffer()), dims, classOf);
    // Copy the part inside the box.
    for (let vz = Math.max(z, box.a[2]); vz < Math.min(e[2], box.b[2]); vz++)
      for (let vy = Math.max(y, box.a[1]); vy < Math.min(e[1], box.b[1]); vy++) {
        const src = ((vz - z) * dims[1] + (vy - y)) * dims[0];
        const dst = ((vz - box.a[2]) * box.dims[1] + (vy - box.a[1])) * box.dims[0];
        const x0 = Math.max(x, box.a[0]), x1 = Math.min(e[0], box.b[0]);
        vol.set(c.subarray(src + (x0 - x), src + (x1 - x)), dst + (x0 - box.a[0]));
      }
  }));
  return vol;
}

/** In a class volume, a voxel of the cell (1) where it touches the piece (2):
 *  the one nearest the middle of all such voxels. With no touch, the cell
 *  voxel nearest the piece. Null when the box holds no cell. In box voxels. */
function meetingVoxel(vol, dims) {
  const [X, Y, Z] = dims, XY = X * Y;
  let sx = 0, sy = 0, sz = 0, n = 0;
  const touch = [];
  let n1 = 0, n2 = 0;
  for (let z = 0; z < Z; z++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    const i = z * XY + y * X + x;
    const v = vol[i];
    if (v === 2) { n2++; continue; }
    if (v !== 1) continue;
    n1++;
    if ((x > 0 && vol[i - 1] === 2) || (x < X - 1 && vol[i + 1] === 2)
      || (y > 0 && vol[i - X] === 2) || (y < Y - 1 && vol[i + X] === 2)
      || (z > 0 && vol[i - XY] === 2) || (z < Z - 1 && vol[i + XY] === 2)) {
      touch.push([x, y, z]); sx += x; sy += y; sz += z; n++;
    }
  }
  const d2 = (a, b) => ((a[0] - b[0]) * 16) ** 2 + ((a[1] - b[1]) * 16) ** 2 + ((a[2] - b[2]) * 40) ** 2;
  const nearest = (list, to) => { let best = null, bd = Infinity; for (const p of list) { const d = d2(p, to); if (d < bd) { bd = d; best = p; } } return best; };
  if (n) return nearest(touch, [sx / n, sy / n, sz / n]);
  if (!n1 || !n2) return null;
  // Not touching in this box: the cell voxel nearest the piece, on evenly
  // thinned lists (every kth voxel of each).
  const cs = [], ps = [], k1 = Math.ceil(n1 / 3000), k2 = Math.ceil(n2 / 3000);
  let c1 = 0, c2 = 0;
  for (let z = 0; z < Z; z++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    const v = vol[z * XY + y * X + x];
    if (v === 1 && c1++ % k1 === 0) cs.push([x, y, z]);
    else if (v === 2 && c2++ % k2 === 0) ps.push([x, y, z]);
  }
  let best = null, bd = Infinity;
  for (const c of cs) for (const p of ps) { const d = d2(c, p); if (d < bd) { bd = d; best = c; } }
  return best;
}

/** Where `piece` (a set) meets `cell` (a set), in nm, near the piece's
 *  samples; null when it cannot be read. Both sets are sorted BigUint64Arrays.
 *  `cellSvs` and `pieceSvs` pick the chunks (any members will do). */
async function meetingNm({fetchImpl = fetch, cell, piece, near}) {
  // The cell chunk nearest any chunk of the piece's samples.
  const pc = [...new Set(near.map(sv => chunkXYZ(sv).join(',')))].map(s => s.split(',').map(Number));
  const cc = new Map();
  for (const sv of cell) { const c = chunkXYZ(sv); cc.set(c.join(','), c); }
  let best = null, bd = Infinity;
  for (const c of cc.values()) for (const p of pc) {
    const d = ((c[0] - p[0]) * 4.1) ** 2 + ((c[1] - p[1]) * 4.1) ** 2 + ((c[2] - p[2]) * 5.1) ** 2;
    if (d < bd) { bd = d; best = [c, p]; }
  }
  if (!best) return null;
  const [c, p] = best;
  const adjacent = c.every((v, i) => Math.abs(v - p[i]) <= 1);
  const lo = adjacent ? c.map((v, i) => Math.min(v, p[i])) : c;
  const hi = adjacent ? c.map((v, i) => Math.max(v, p[i])) : c;
  const box = boxOf(lo, hi);
  const classOf = v => has(cell, v) ? 1 : has(piece, v) ? 2 : 0;
  const vol = await readBox(fetchImpl, box, classOf);
  let at = meetingVoxel(vol, box.dims);
  if (!at && !adjacent) return null;
  if (!at) return null;
  return [0, 1, 2].map(i => (box.a[i] + at[i] + 0.5) * WS.res[i]);
}

module.exports = {meetingNm, meetingVoxel, decodeClasses, chunkXYZ, has, WS};
