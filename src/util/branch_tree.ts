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

/** Every piece whose way back to `ref` passes through `from` (`from` too):
 *  the far side of a click. For MEC, the far side of the AIS is the axon. */
export function piecesBeyond(graph: BranchGraph, from: string, ref: string): Set<string> {
  const adj = neighbours(graph);
  const parent = shortestWaysBack(graph, adj, ref);
  const out = new Set<string>();
  if (!parent.has(from) || from === ref) return out;
  const children = new Map<string, string[]>();
  for (const [n, p] of parent) if (p != null) { const l = children.get(p); if (l) l.push(n); else children.set(p, [n]); }
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    out.add(n);
    for (const c of children.get(n) ?? []) stack.push(c);
  }
  return out;
}

/**
 * Branch ends that run into the edge of the data: the pieces at the tip of a
 * branch (one neighbour or none) within `marginNm` of a face of the volume.
 * `bounds` is [[x, y, z] low, [x, y, z] high] in nanometres, the rule the Hunt
 * judges "edge of the dataset" by (5 um there). Tips closer than `joinNm` to
 * one already found are the same place. Nearest the face first.
 * `only`: look at these pieces alone (the axon).
 */
export function edgeEnds(graph: BranchGraph, bounds: number[][], marginNm = 5000, joinNm = 3000,
                         only?: Set<string>): number[][] {
  const adj = neighbours(graph);
  const [lo, hi] = bounds;
  const tips: { p: number[]; d: number }[] = [];
  for (const [id, p] of graph.points) {
    if ((adj.get(id)?.length ?? 0) > 1 || (only && !only.has(id))) continue;
    const d = Math.min(p[0] - lo[0], hi[0] - p[0], p[1] - lo[1], hi[1] - p[1], p[2] - lo[2], hi[2] - p[2]);
    if (d <= marginNm) tips.push({ p, d });
  }
  tips.sort((a, b) => a.d - b.d);
  const out: number[][] = [];
  for (const t of tips) {
    if (out.some(q => Math.hypot(q[0] - t.p[0], q[1] - t.p[1], q[2] - t.p[2]) < joinNm)) continue;
    out.push(t.p);
  }
  return out;
}

/**
 * Lantern mode's "Clicked branch" (Ames 2026-10-27: "a mode in lantern mode
 * where it only highlights the branch you click on"): the branch a click is
 * on, from the fork where it leaves its parent branch out to all its tips.
 *
 * From the clicked piece, walk back toward the soma one piece at a time.
 * The walk stops at the first real fork: where another branch leaves that
 * carries at least `minSideNm` of cable and at least a third as much as the
 * side walked up. Spines and the small knots the
 * graph has in thick parts are shorter than that, so they never count. The
 * walk also stops at the soma (within `somaRadiusNm` of `somaNm`). The
 * branch is the last piece reached and everything beyond it.
 *
 * A click on the soma itself gives the soma: the pieces within
 * `somaRadiusNm` of it.
 *
 * `segments` are the links inside the branch, plus the one back to its fork
 * so the light reaches the fork; a piece on its own is a segment of length 0.
 */
export function clickedBranch(graph: BranchGraph, from: string, ref: string,
                              opts: { minSideNm?: number; somaNm?: number[]; somaRadiusNm?: number;
                                      /** The most of the cell's pieces a branch may be (0 to 1). */
                                      maxShare?: number } = {}):
    { pieces: Set<string>; fork: string | null; segments: Segment[]; soma: boolean } {
  const minSide = opts.minSideNm ?? 6000;
  const somaR = opts.somaRadiusNm ?? 0;
  const somaNm = opts.somaNm ?? graph.points.get(ref);
  const nearSoma = (id: string) => {
    const p = graph.points.get(id);
    return !!(somaR > 0 && p && somaNm && Math.hypot(p[0] - somaNm[0], p[1] - somaNm[1], p[2] - somaNm[2]) <= somaR);
  };
  const adj = neighbours(graph);
  const span = (a: string, b: string) => {
    const p = graph.points.get(a), q = graph.points.get(b);
    return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : 0;
  };
  // A click on the soma: the soma.
  if (from === ref || nearSoma(from)) {
    const pieces = new Set<string>([from]);
    for (const id of graph.points.keys()) if (id === ref || nearSoma(id)) pieces.add(id);
    const segments: Segment[] = [];
    for (const [a, b] of graph.edges) {
      const p = graph.points.get(a), q = graph.points.get(b);
      if (p && q && pieces.has(a) && pieces.has(b)) segments.push([p, q]);
    }
    for (const id of pieces) { const p = graph.points.get(id); if (p) segments.push([p, p]); }
    return { pieces, fork: null, segments, soma: true };
  }
  const parent = shortestWaysBack(graph, adj, ref);
  if (!parent.has(from)) throw new Error('No connection was found between that point and the rest of the cell.');
  const children = new Map<string, string[]>();
  for (const [n, p] of parent) if (p != null) { const l = children.get(p); if (l) l.push(n); else children.set(p, [n]); }
  // The cable beyond each piece, worked out tips first.
  const order: string[] = [];
  const stack = [ref];
  while (stack.length) { const n = stack.pop()!; order.push(n); for (const c of children.get(n) ?? []) stack.push(c); }
  const cable = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    let sum = 0;
    for (const c of children.get(n) ?? []) sum += span(n, c) + (cable.get(c) ?? 0);
    cable.set(n, sum);
  }
  // At each fork on the way back, the walk goes on only past a twig: another
  // side under a third the size of the side walked up. A twig off a long
  // dendrite does not cut the dendrite short (on the retina's big cells it
  // did, 2026-10-27), a click on the twig still gives the twig, and where a
  // stem splits into big dendrites the light stays on the one clicked.
  let top = from;
  const path = [from];
  for (;;) {
    const p = parent.get(top);
    if (p == null || p === ref || nearSoma(p)) break;
    const mine = span(p, top) + (cable.get(top) ?? 0);
    const side = (children.get(p) ?? []).some(s => {
      if (s === top) return false;
      const other = span(p, s) + (cable.get(s) ?? 0);
      return other >= minSide && other >= 0.3 * mine;
    });
    if (side) break;
    top = p;
    path.push(p);
  }
  // Never most of the cell: a big soma the walk went on into joins whole
  // dendrites up. Step back toward the click until the branch is a share.
  const count = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    let c = 1;
    for (const k of children.get(n) ?? []) c += count.get(k) ?? 0;
    count.set(n, c);
  }
  const cap = (opts.maxShare ?? 1) * parent.size;
  while (path.length > 1 && (count.get(top) ?? 0) > cap) { path.pop(); top = path[path.length - 1]; }
  const pieces = new Set<string>();
  const segments: Segment[] = [];
  const walk = [top];
  while (walk.length) {
    const n = walk.pop()!;
    pieces.add(n);
    const p = graph.points.get(n);
    if (p) segments.push([p, p]);
    for (const c of children.get(n) ?? []) {
      const q = graph.points.get(c);
      if (p && q) segments.push([p, q]);
      walk.push(c);
    }
  }
  const fork = parent.get(top) ?? null;
  const tp = graph.points.get(top), fp = fork ? graph.points.get(fork) : undefined;
  if (tp && fp) segments.push([tp, fp]);
  return { pieces, fork, segments, soma: false };
}

/**
 * Where the soma most likely is when none is on record: the piece with the
 * most other pieces within `radiusNm`. A soma is one big lump of the cell,
 * so it is made of many pieces close together. A guess, so a soma on record
 * is always used first.
 */
export function densestPiece(graph: BranchGraph, radiusNm = 6000): string | undefined {
  const grid = new Map<string, number[][]>();
  const cellOf = (v: number) => Math.floor(v / radiusNm);
  for (const p of graph.points.values()) {
    const k = `${cellOf(p[0])},${cellOf(p[1])},${cellOf(p[2])}`;
    const l = grid.get(k); if (l) l.push(p); else grid.set(k, [p]);
  }
  let best: string | undefined, bestN = -1;
  const r2 = radiusNm * radiusNm;
  for (const [id, p] of graph.points) {
    const gx = cellOf(p[0]), gy = cellOf(p[1]), gz = cellOf(p[2]);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const q of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const ex = q[0] - p[0], ey = q[1] - p[1], ez = q[2] - p[2];
        if (ex * ex + ey * ey + ez * ez <= r2) n++;
      }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  return best;
}
