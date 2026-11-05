/**
 * A highlight's shape, kept small (Ames 2026-10-26: "optimize it!"). A mark
 * used to save as one line annotation per step of the path: hundreds per
 * stroke, thousands for a Beyond, each with its own id and two points written
 * out to sixteen digits. That filled saved views past the autosave limit, so
 * a cell reopened without its highlights (toknow, report 253).
 *
 * Now a mark is a few polylines: the steps are joined into runs, points that
 * add nothing to the shape are dropped (closer than SIMPLIFY_NM to the line
 * already there, far finer than the colour's reach of 500 nm or more), and
 * every coordinate is rounded to half a voxel, which JSON writes short.
 * Everything here works in nanometres, so it does not depend on the viewer.
 */

export type P3 = number[];

/** A point left out lies at most this far from the polyline that is kept. */
export const SIMPLIFY_NM = 50;

const key = (p: P3) => `${p[0]},${p[1]},${p[2]}`;

/**
 * Join line pieces into as few runs as the shape allows: a run goes on
 * through every point where exactly two pieces meet, and stops at a branch
 * point or an end. A tree of N pieces with B branch points becomes about
 * 2B + 1 runs. Pieces are joined only where their ends are the same point.
 */
export function joinRuns(segments: [P3, P3][]): P3[][] {
  const pts = new Map<string, P3>();
  const adj = new Map<string, { to: string; seg: number }[]>();
  segments.forEach(([a, b], seg) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    pts.set(ka, a); pts.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ to: kb, seg });
    adj.get(kb)!.push({ to: ka, seg });
  });
  const used = new Set<number>();
  const runs: P3[][] = [];
  const walk = (start: string, first: { to: string; seg: number }) => {
    const run = [pts.get(start)!];
    let at = start, step: { to: string; seg: number } | undefined = first;
    while (step && !used.has(step.seg)) {
      used.add(step.seg);
      at = step.to;
      run.push(pts.get(at)!);
      const next = adj.get(at)!;
      step = next.length === 2 ? next.find(n => !used.has(n.seg)) : undefined;
    }
    if (run.length >= 2) runs.push(run);
  };
  // From every end and branch point first, then whatever is left (loops).
  for (const [k, list] of adj) if (list.length !== 2) for (const e of list) walk(k, e);
  for (const [k, list] of adj) for (const e of list) if (!used.has(e.seg)) walk(k, e);
  return runs;
}

function distToSegment(p: P3, a: P3, b: P3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  let t = len2 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1], p[2] - a[2] - t * d[2]);
}

/** Drop the points that lie within `tolNm` of the line kept around them
 *  (Douglas-Peucker). The two ends always stay. */
export function simplifyRun(run: P3[], tolNm = SIMPLIFY_NM): P3[] {
  if (run.length <= 2) return run.slice();
  const keep = new Uint8Array(run.length);
  keep[0] = keep[run.length - 1] = 1;
  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1, farD = tolNm;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(run[k], run[i], run[j]);
      if (d > farD) { farD = d; far = k; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([i, far], [far, j]);
  }
  return run.filter((_, k) => keep[k]);
}

/** Line pieces (nanometres) to the polylines to save, in viewer coordinates
 *  rounded to half a voxel. */
export function strokeRuns(segments: [P3, P3][], scalesNm: number[], tolNm = SIMPLIFY_NM): Float32Array[][] {
  const out: Float32Array[][] = [];
  for (const run of joinRuns(segments)) {
    const pts = simplifyRun(run, tolNm)
      .map(p => Float32Array.from([0, 1, 2].map(i => Math.round(p[i] / (scalesNm[i] || 1) * 2) / 2)));
    // Rounding can land two neighbouring points on one spot.
    const kept = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1] || p[2] !== pts[i - 1][2]);
    if (kept.length >= 2) out.push(kept);
  }
  return out;
}
