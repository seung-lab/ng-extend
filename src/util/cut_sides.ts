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
