/**
 * Which side of a cut each part of a cell would fall on.
 *
 * A cell is a chain of small pieces linked to their neighbours (the same map
 * Highlight mode walks). Given the pieces known to be on the red side and on
 * the blue side, colour spreads outward from both at once, piece to piece,
 * and never across a link that joins a red piece to a blue one: that link is
 * where the cut falls. What comes back is the lines to paint, in nanometres.
 *
 * No network and no viewer, so it can be tested as it is
 * (scripts/cut-sides.test.mjs).
 */
export type Side = 'red' | 'blue';

export interface CutSideLine { a: number[]; b: number[]; side: Side; }

export interface CutSidesResult {
  lines: CutSideLine[];
  /** How many pieces took each colour. */
  red: number;
  blue: number;
}

/**
 * @param edges    links between pieces
 * @param points   a point inside each piece, in nanometres
 * @param known    pieces whose side is known for certain (from the server's
 *                 preview of the cut, and from where the points were placed)
 * @param maxSteps how far from the known pieces the colour spreads
 */
export function cutSides(
    edges: readonly (readonly [string, string])[], points: ReadonlyMap<string, number[]>,
    known: ReadonlyMap<string, Side>, maxSteps = 120): CutSidesResult {
  const side = spreadSides(edges, known, maxSteps);

  const lines: CutSideLine[] = [];
  const drawn = new Set<string>();
  for (const [a, b] of edges) {
    const sa = side.get(a), sb = side.get(b);
    if (!sa || sa !== sb) continue;
    const pa = points.get(a), pb = points.get(b);
    if (!pa || !pb) continue;
    lines.push({ a: pa, b: pb, side: sa });
    drawn.add(a); drawn.add(b);
  }
  // A piece with no same coloured neighbour still gets its own dot.
  for (const [piece, s] of side) {
    if (drawn.has(piece)) continue;
    const p = points.get(piece);
    if (p) lines.push({ a: p, b: p, side: s });
  }
  let red = 0, blue = 0;
  for (const s of side.values()) { if (s === 'red') red++; else blue++; }
  return { lines, red, blue };
}

/** The side of every piece the colour reaches, spreading from the known ones. */
export function spreadSides(
    edges: readonly (readonly [string, string])[], known: ReadonlyMap<string, Side>, maxSteps = 120): Map<string, Side> {
  const next = new Map<string, string[]>();
  const link = (a: string, b: string) => { (next.get(a) ?? next.set(a, []).get(a)!).push(b); };
  for (const [a, b] of edges) { if (a !== b) { link(a, b); link(b, a); } }

  const side = new Map<string, Side>(known);
  let frontier = [...known.keys()];
  for (let step = 0; step < maxSteps && frontier.length; step++) {
    const reached: string[] = [];
    for (const piece of frontier) {
      const s = side.get(piece)!;
      for (const n of next.get(piece) ?? []) {
        if (side.has(n)) continue;       // taken already, by either colour: the cut lies between
        side.set(n, s);
        reached.push(n);
      }
    }
    frontier = reached;
  }
  return side;
}

/** A block of the volume and what to paint it: one side's colour, or 'both'
 *  where pieces of both sides lie in it, which is where the cut falls. */
export interface CutSideBlock { box: number[]; side: Side | 'both'; }

/**
 * The cell block by block. Every piece lies in one block of the volume, and
 * a block is small, so painting whole blocks colours the whole surface of
 * the cell with nothing left out. `boxes` gives each piece's block as
 * [x0, y0, z0, x1, y1, z1] in nanometres.
 */
export function cutSideBlocks(side: ReadonlyMap<string, Side>, boxes: ReadonlyMap<string, number[]>): CutSideBlock[] {
  const blocks = new Map<string, CutSideBlock>();
  for (const [piece, s] of side) {
    const box = boxes.get(piece);
    if (!box) continue;
    const key = box.join(',');
    const have = blocks.get(key);
    if (!have) blocks.set(key, { box, side: s });
    else if (have.side !== s) have.side = 'both';
  }
  return [...blocks.values()];
}

/**
 * The side of each piece, from the server's preview: it lists the smallest
 * bits of the cell (supervoxels) on each side near the cut, and each bit
 * belongs to one piece. A piece split by the cut has bits on both sides and
 * takes the side most of them are on; an exact tie is left out.
 */
export function piecesFromPreview(
    redBits: readonly string[], blueBits: readonly string[], pieceOf: ReadonlyMap<string, string>): Map<string, Side> {
  const count = new Map<string, [number, number]>();
  const add = (bits: readonly string[], i: 0 | 1) => {
    for (const bit of bits) {
      const piece = pieceOf.get(bit);
      if (!piece) continue;
      (count.get(piece) ?? count.set(piece, [0, 0]).get(piece)!)[i]++;
    }
  };
  add(redBits, 0); add(blueBits, 1);
  const out = new Map<string, Side>();
  for (const [piece, [r, b]] of count) if (r !== b) out.set(piece, r > b ? 'red' : 'blue');
  return out;
}

/**
 * Which of the server's groups is the red side and which the blue.
 *
 * The preview answers with groups of supervoxels the cut would leave apart.
 * A group holding red points is the red side, one holding blue points the
 * blue side; that is certain whatever order they come in. A group holding
 * points of both colours says nothing and is left out.
 *
 * Often no group holds any point: a point placed on the 3D surface carries
 * the cell's ID, not a supervoxel's, and the server finds the supervoxel
 * itself from where the point is (Ames's first run, 2026-10-12). Then the
 * order is all there is: the server puts the side of the first points sent
 * first and the side of the others second, and any further groups are loose
 * bits that belong to neither and are left uncoloured.
 */
export interface GroupSides {
  red: string[];
  blue: string[];
  /** How the sides were told apart: by the points, by the order, or not at all. */
  how: 'points' | 'order' | 'none';
  /** Per group: its size and how many red and blue points it holds. */
  groups: { size: number; red: number; blue: number }[];
}
export function sidesOfGroups(
    groups: readonly (readonly string[])[], redPicks: readonly string[], bluePicks: readonly string[]): GroupSides {
  const redSet = new Set(redPicks), blueSet = new Set(bluePicks);
  const detail = groups.map(g => {
    let red = 0, blue = 0;
    for (const bit of g) { if (redSet.has(bit)) red++; if (blueSet.has(bit)) blue++; }
    return { size: g.length, red, blue };
  });
  const red: string[] = [], blue: string[] = [];
  groups.forEach((g, i) => {
    const d = detail[i];
    if (d.red && !d.blue) red.push(...g);
    else if (d.blue && !d.red) blue.push(...g);
  });
  if (red.length && blue.length) return { red, blue, how: 'points', groups: detail };
  if (groups.length >= 2 && detail.every(d => !d.red && !d.blue) && groups[0].length && groups[1].length) {
    return { red: [...groups[0]], blue: [...groups[1]], how: 'order', groups: detail };
  }
  return { red: [], blue: [], how: 'none', groups: detail };
}

/**
 * The blocks near the cut, from the supervoxels themselves: a block with
 * supervoxels of one side only is that side's colour, and a block with both
 * is where the cut passes. `boxes` gives each supervoxel's block.
 */
export function localBlocks(
    red: readonly string[], blue: readonly string[], boxes: ReadonlyMap<string, number[]>): CutSideBlock[] {
  const blocks = new Map<string, CutSideBlock>();
  const add = (bits: readonly string[], s: Side) => {
    for (const bit of bits) {
      const box = boxes.get(bit);
      if (!box) continue;
      const key = box.join(',');
      const have = blocks.get(key);
      if (!have) blocks.set(key, { box, side: s });
      else if (have.side !== s) have.side = 'both';
    }
  };
  add(red, 'red'); add(blue, 'blue');
  return [...blocks.values()];
}

/** A few supervoxels of each side from each block, to ask which piece of the
 *  cell they are in: enough to start the colour spreading from every block
 *  the preview covers, without asking about thousands. */
export function sampleBits(
    red: readonly string[], blue: readonly string[], boxes: ReadonlyMap<string, number[]>, perBlock = 2, limit = 160): string[] {
  const out: string[] = [];
  for (const bits of [red, blue]) {
    const taken = new Map<string, number>();
    for (const bit of bits) {
      const box = boxes.get(bit);
      if (!box) continue;
      const key = box.join(',');
      const n = taken.get(key) ?? 0;
      if (n >= perBlock) continue;
      taken.set(key, n + 1);
      out.push(bit);
    }
  }
  return out.slice(0, limit);
}

/** The pieces whose side is certain: every sampled supervoxel of a piece is
 *  on the same side. A piece seen on both sides has the cut inside it and
 *  starts nothing. */
export function certainPieces(
    red: readonly string[], blue: readonly string[], pieceOf: ReadonlyMap<string, string>): Map<string, Side> {
  const seen = new Map<string, Side | 'both'>();
  const add = (bits: readonly string[], s: Side) => {
    for (const bit of bits) {
      const piece = pieceOf.get(bit);
      if (!piece) continue;
      const have = seen.get(piece);
      seen.set(piece, have === undefined || have === s ? s : 'both');
    }
  };
  add(red, 'red'); add(blue, 'blue');
  const out = new Map<string, Side>();
  for (const [piece, s] of seen) if (s !== 'both') out.set(piece, s);
  return out;
}

/** Far blocks from the spread, near blocks from the supervoxels: where the
 *  two disagree about a block, both sides are in it. */
export function mergeBlocks(far: readonly CutSideBlock[], near: readonly CutSideBlock[]): CutSideBlock[] {
  const blocks = new Map<string, CutSideBlock>();
  for (const b of far) blocks.set(b.box.join(','), { box: b.box, side: b.side });
  for (const b of near) {
    const key = b.box.join(',');
    const have = blocks.get(key);
    if (!have) blocks.set(key, { box: b.box, side: b.side });
    else if (have.side !== b.side) have.side = 'both';
  }
  return [...blocks.values()];
}
