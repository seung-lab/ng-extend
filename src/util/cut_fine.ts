/**
 * The fine picture of a cut: a small grid round the points in which every
 * cell is red, blue or empty.
 *
 * It starts from the volume itself: each voxel near the points whose
 * supervoxel the server put on one side is marked with that side
 * (ngeGrapheneCutVoxels). That is the server's own answer, drawn where it
 * is. The server only answers for a small room round the points, so the
 * rest of the stretch the coarse picture leaves pale is filled from there
 * outward: each empty cell takes the side of the marked cell nearest to it.
 * Near the cut the colours are exact; farther along the pale stretch they
 * are carried from the nearest exact ones, and never past the pale blocks.
 *
 * No viewer and no network, so it can be tested as it is
 * (scripts/cut-fine.test.mjs).
 */
export interface CutVoxels {
  originNm: number[]; voxelNm: number[]; dims: number[];
  /** x fastest, then y, then z. 0 neither side, 1 red, 2 blue. */
  labels: Uint8Array;
}

export interface FineGrid {
  /** Premultiplied RGBA, x fastest, then y, then z. */
  data: Uint8Array;
  dims: [number, number, number];
  /** The grid's corner and the size of one cell, in nanometres. */
  loNm: number[]; cellNm: number[];
  /** Cells marked straight from the volume, and cells filled from them. */
  exact: { red: number; blue: number }; filled: { red: number; blue: number };
}

const MAX_CELLS = 5e6;

/**
 * @param vox      the marked voxels round the points
 * @param paleNm   the blocks the coarse picture left pale, [x0,y0,z0,x1,y1,z1] in nanometres
 * @param red,blue the two colours, 0 to 255
 * @param spread   how many cells the exact marks spread outside the pale
 *                 blocks: the surface of a cell lies on the edge of its
 *                 voxels, and must find a colour just outside them
 */
export function buildFineGrid(
    vox: CutVoxels, paleNm: readonly (readonly number[])[], red: readonly number[], blue: readonly number[], spread = 2): FineGrid | null {
  const vHi = [0, 1, 2].map(i => vox.originNm[i] + vox.dims[i] * vox.voxelNm[i]);
  const lo = [...vox.originNm], hi = [...vHi];
  for (const b of paleNm) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b[i]); hi[i] = Math.max(hi[i], b[i + 3]); }
  // One cell is one voxel, made larger on every axis alike if the pale
  // stretch is too long for the grid to hold at that size.
  const ext = [0, 1, 2].map(i => hi[i] - lo[i]);
  let grow = 1;
  const cellsAt = (g: number) => [0, 1, 2].map(i => Math.max(1, Math.ceil(ext[i] / (vox.voxelNm[i] * g))));
  while (cellsAt(grow).reduce((a, b) => a * b, 1) > MAX_CELLS) grow *= 1.15;
  const cell = vox.voxelNm.map(v => v * grow);
  const dims = cellsAt(grow) as [number, number, number];
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const side = new Uint8Array(n);

  // 1. The server's answer, voxel by voxel.
  const exact = { red: 0, blue: 0 };
  const [vx, vy, vz] = vox.dims;
  for (let z = 0; z < vz; z++) {
    const cz = Math.min(nz - 1, Math.floor((vox.originNm[2] + (z + 0.5) * vox.voxelNm[2] - lo[2]) / cell[2]));
    for (let y = 0; y < vy; y++) {
      const cy = Math.min(ny - 1, Math.floor((vox.originNm[1] + (y + 0.5) * vox.voxelNm[1] - lo[1]) / cell[1]));
      let k = vx * (y + vy * z);
      for (let x = 0; x < vx; x++, k++) {
        const s = vox.labels[k];
        if (!s) continue;
        const cx = Math.min(nx - 1, Math.floor((vox.originNm[0] + (x + 0.5) * vox.voxelNm[0] - lo[0]) / cell[0]));
        const o = cx + nx * (cy + ny * cz);
        if (side[o] === 0) { side[o] = s; if (s === 1) exact.red++; else exact.blue++; }
      }
    }
  }
  if (!exact.red && !exact.blue) return null;

  // 2. Where filling is allowed: inside a pale block.
  const pale = new Uint8Array(n);
  for (const b of paleNm) {
    const a0 = [0, 1, 2].map(i => Math.max(0, Math.floor((b[i] - lo[i]) / cell[i])));
    const a1 = [0, 1, 2].map(i => Math.min(dims[i], Math.ceil((b[i + 3] - lo[i]) / cell[i])));
    for (let z = a0[2]; z < a1[2]; z++) for (let y = a0[1]; y < a1[1]; y++) pale.fill(1, a0[0] + nx * (y + ny * z), a1[0] + nx * (y + ny * z));
  }

  // 3. Fill outward from the exact cells, nearest first: one step at a time
  //    to every neighbour that is still empty. Inside a pale block it goes on
  //    until the block is full; outside one it stops after `spread` steps.
  const filled = { red: 0, blue: 0 };
  let frontier = new Int32Array(exact.red + exact.blue);
  let count = 0;
  for (let o = 0; o < n; o++) if (side[o]) frontier[count++] = o;
  const stepsOut = new Uint8Array(n);   // steps taken outside the pale blocks to reach a cell
  const strideY = nx, strideZ = nx * ny;
  while (count) {
    const next = new Int32Array(Math.min(n, count * 6));
    let m = 0;
    for (let f = 0; f < count; f++) {
      const o = frontier[f], s = side[o], out = stepsOut[o];
      const x = o % nx, y = Math.floor(o / nx) % ny, z = Math.floor(o / strideZ);
      const visit = (p: number) => {
        if (side[p]) return;
        let steps = 0;
        if (!pale[p]) { steps = out + 1; if (steps > spread) return; }
        side[p] = s; stepsOut[p] = steps;
        if (s === 1) filled.red++; else filled.blue++;
        next[m++] = p;
      };
      if (x > 0) visit(o - 1);
      if (x < nx - 1) visit(o + 1);
      if (y > 0) visit(o - strideY);
      if (y < ny - 1) visit(o + strideY);
      if (z > 0) visit(o - strideZ);
      if (z < nz - 1) visit(o + strideZ);
    }
    frontier = next; count = m;
  }

  const data = new Uint8Array(n * 4);
  for (let o = 0, k = 0; o < n; o++, k += 4) {
    const s = side[o];
    if (!s) continue;
    const c = s === 1 ? red : blue;
    data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
  }
  return { data, dims, loNm: lo, cellNm: cell, exact, filled };
}
