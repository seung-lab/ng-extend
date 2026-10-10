/**
 * Which part of a cell lies toward the soma from a point, and which part
 * lies beyond it. For Highlight mode's "To soma" and "Beyond" (the idea is
 * Krzysztof Kruk's, 2026-10-09, after EyeWire's highlight parents and
 * highlight children).
 *
 * A cell is a graph of small pieces with a point inside each. Walking that
 * graph outward from a reference piece (the soma, or any piece on the soma
 * side) gives every other piece one way back: its parent. "Toward" is the
 * chain of parents from the clicked piece. "Beyond" is everything whose way
 * back passes through the clicked piece.
 *
 * The graph is not always a tree: branches that touch make loops, and a
 * false merge joins two cells. The way back is then the one with the fewest
 * pieces, so "beyond" can include or miss a branch right where the cell is
 * wrongly joined. That is worth knowing when reading the result, and it is
 * said in the panel.
 *
 * No imports on purpose: the tests load this file on its own.
 */
export interface BranchGraph {
  /** Links between pieces, as pairs of piece ids. */
  edges: [string, string][];
  /** A point inside each piece, in nanometers. Some pieces may have none. */
  points: Map<string, number[]>;
}
export type BranchWay = 'toward' | 'away';
export type Segment = [number[], number[]];

/** The piece whose point is nearest to `nm`, and how far away it is. */
export function nearestPiece(graph: BranchGraph, nm: ArrayLike<number>): { id: string; distNm: number } | undefined {
  let best: { id: string; distNm: number } | undefined;
  for (const [id, p] of graph.points) {
    const d = Math.hypot(p[0] - nm[0], p[1] - nm[1], p[2] - nm[2]);
    if (!best || d < best.distNm) best = { id, distNm: d };
  }
  return best;
}

function neighbours(graph: BranchGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
  for (const [a, b] of graph.edges) { if (a !== b) { link(a, b); link(b, a); } }
  return adj;
}

/**
 * The strokes to draw, each a pair of points in nanometers.
 *   from       the clicked piece
 *   ref        a piece on the soma side (the soma's own piece when known)
 *   fromPoint  where the click was; the strokes start there
 *   refPoint   toward only: where to end (the soma, or the second click)
 * Throws with a message a player can read when there is nothing to draw.
 */
export function branchSegments(graph: BranchGraph, from: string, ref: string, way: BranchWay,
                               fromPoint?: number[], refPoint?: number[]): { segments: Segment[]; pieces: number } {
  const adj = neighbours(graph);
  if (!adj.has(from) && !graph.points.has(from)) throw new Error('That point is not on a mapped part of this cell.');
  if (from === ref) throw new Error(way === 'toward'
    ? 'That point is already at the soma.'
    : 'Those two points are in the same small piece of the cell. Pick the second one closer to the soma.');
  // Breadth first from the reference: parent = one step back toward it.
  const parent = new Map<string, string | null>([[ref, null]]);
  const order: string[] = [ref];
  for (let i = 0; i < order.length; i++) {
    for (const n of adj.get(order[i]) ?? []) if (!parent.has(n)) { parent.set(n, order[i]); order.push(n); }
  }
  if (!parent.has(from)) throw new Error('No connection was found between that point and the soma side of the cell.');
  const segments: Segment[] = [];
  const join = (a: number[] | undefined, b: number[] | undefined) => {
    if (a && b && (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2])) segments.push([a, b]);
  };

  if (way === 'toward') {
    let last = fromPoint ?? graph.points.get(from);
    let pieces = 1;
    // A click that is not exactly on its piece's point: start at the click.
    if (fromPoint && graph.points.get(from)) { join(fromPoint, graph.points.get(from)); last = graph.points.get(from); }
    for (let n = parent.get(from) ?? null; n != null; n = parent.get(n) ?? null) {
      pieces++;
      const p = graph.points.get(n);
      if (!p) continue;            // no point for this piece: bridge over it
      join(last, p);
      last = p;
    }
    if (refPoint) join(last, refPoint);
    if (!segments.length) throw new Error('The server has no positions for that stretch of the cell.');
    return { segments, pieces };
  }

  // Beyond: every piece whose way back passes through `from`.
  const children = new Map<string, string[]>();
  for (const [n, p] of parent) if (p != null) { const l = children.get(p); if (l) l.push(n); else children.set(p, [n]); }
  if (fromPoint && graph.points.get(from)) join(fromPoint, graph.points.get(from));
  let pieces = 1;
  // [piece, the nearest point back toward `from` that a stroke can start at]
  const stack: [string, number[] | undefined][] = [[from, graph.points.get(from) ?? fromPoint]];
  while (stack.length) {
    const [n, anchor] = stack.pop()!;
    for (const child of children.get(n) ?? []) {
      pieces++;
      const p = graph.points.get(child);
      join(anchor, p);
      stack.push([child, p ?? anchor]);
    }
  }
  if (pieces === 1) throw new Error('Nothing lies beyond that point: it is at the tip of its branch.');
  if (!segments.length) throw new Error('The server has no positions for that part of the cell.');
  return { segments, pieces };
}
