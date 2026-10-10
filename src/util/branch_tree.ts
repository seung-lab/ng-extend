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
 * The graph is not always a tree: a thick part of the cell (the soma) is
 * several pieces that all touch, branches that touch make loops, and a
 * false merge joins two cells. Measured on one retina cell, 2026-10-10: 65
 * pieces, 5 loops, 15 pieces on a loop. Where there are two ways back, the
 * way back is the SHORTER ONE IN DISTANCE along the cell (it was the one
 * with the fewest pieces, which a few large pieces could win while going the
 * long way round). So inside a loop "beyond" stops where the other way round
 * becomes the shorter, and near a false merge it can include or miss a
 * branch. That is worth knowing when reading the result.
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
 * For every piece that can be reached from `ref`, the next piece back toward
 * it on the shortest way, by distance between the pieces' points. A link to
 * or from a piece with no point counts as the typical link of this cell, so
 * a missing position neither blocks a way nor makes it look free.
 */
function shortestWaysBack(graph: BranchGraph, adj: Map<string, string[]>, ref: string): Map<string, string | null> {
  const lengths: number[] = [];
  const span = (a: string, b: string): number | undefined => {
    const p = graph.points.get(a), q = graph.points.get(b);
    return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : undefined;
  };
  for (const [a, b] of graph.edges) { const d = span(a, b); if (d !== undefined) lengths.push(d); }
  lengths.sort((x, y) => x - y);
  const typical = lengths.length ? lengths[lengths.length >> 1] : 1;
  const parent = new Map<string, string | null>();
  const dist = new Map<string, number>([[ref, 0]]);
  // A small binary heap of [distance, piece, the piece it was reached from].
  const heap: [number, string, string | null][] = [[0, ref, null]];
  const push = (item: [number, string, string | null]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]]; i = up;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n, via] = pop();
    if (parent.has(n)) continue;          // already settled by a shorter way
    parent.set(n, via);
    for (const next of adj.get(n) ?? []) {
      if (parent.has(next)) continue;
      const nd = d + (span(n, next) ?? typical);
      if (!(dist.get(next)! <= nd)) { dist.set(next, nd); push([nd, next, n]); }
    }
  }
  return parent;
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
  // Outward from the reference by distance along the cell (Dijkstra):
  // parent = one step back toward it, on the shortest way.
  const parent = shortestWaysBack(graph, adj, ref);
  if (!parent.has(from)) throw new Error('No connection was found between that point and the soma side of the cell.');
  const segments: Segment[] = [];
  const join = (a: number[] | undefined, b: number[] | undefined) => {
    if (a && b && (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2])) segments.push([a, b]);
  };
  // The clicked piece has a point of its own, somewhere inside the piece:
  // it can lie on either side of the click. A mark drawn through it when it
  // is on the wrong side runs a little way in the wrong direction (Ames
  // 2026-10-10: "it extends a bit upstream from where I clicked"). So the
  // piece's point is used only when it lies on the side being marked, judged
  // against the next point back toward the soma. Otherwise the mark starts
  // at the click itself.
  const ownPoint = graph.points.get(from);
  let back: number[] | undefined;
  for (let n = parent.get(from) ?? null; n != null && !back; n = parent.get(n) ?? null) back = graph.points.get(n);
  /** Is `p` on the soma side of the click? */
  const somaSide = (p: number[]) => {
    if (!fromPoint || !back) return false;
    let dot = 0;
    for (let i = 0; i < 3; i++) dot += (p[i] - fromPoint[i]) * (back[i] - fromPoint[i]);
    return dot > 0;
  };

  if (way === 'toward') {
    let last = fromPoint ?? ownPoint;
    let pieces = 1;
    // Through the clicked piece's own point only when that is on the way.
    if (fromPoint && ownPoint && somaSide(ownPoint)) { join(fromPoint, ownPoint); last = ownPoint; }
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
  // Start from the clicked piece's own point only when it lies beyond the
  // click; otherwise straight from the click to what comes next.
  const start = fromPoint && ownPoint && !somaSide(ownPoint) ? ownPoint : (fromPoint ?? ownPoint);
  if (fromPoint && start === ownPoint) join(fromPoint, ownPoint);
  let pieces = 1;
  // [piece, the nearest point back toward `from` that a stroke can start at]
  const stack: [string, number[] | undefined][] = [[from, start]];
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
