/**
 * Are the cell types the game logged really in CAVE?
 *
 * Until 2026-10-12 a cell type that CAVE refused was kept in the browser and
 * shown as Saved (Ames: "we have to make sure cell types are saved"). The
 * game's own log has every save, so the two can be compared, and a save that
 * CAVE never took can be sent again from the point the log kept with it.
 *
 * This file only decides; it asks nothing of any server, so it can be tested
 * as it is (scripts/cell-type-check.test.mjs).
 */

/** One "Save Cell Type" from the game's log. */
export interface LoggedType {
  userId: string;
  at: string;              // ISO time
  segId: string;           // the cell's ID when it was saved
  type: string;
  /** Only saves CAVE did not take have a point in the log. */
  point: [number, number, number] | null;
}

/** One row of CAVE's cell type table. */
export interface CaveType {
  rootId: string;          // the cell the row belongs to now ('0' if unknown)
  type: string;
  point: [number, number, number] | null;
  created: string | null;
}

export type CheckStatus =
  | 'in_cave'          // CAVE has this type on this cell
  | 'other_type'       // CAVE has a different type on this cell
  | 'resend'           // CAVE never took it, and its point is on record: can be sent again
  | 'needs_point'      // CAVE never took it, but its point was shared with other cells (the batch tool)
  | 'tried_again'      // CAVE never took it, and a later failed save sits on the same spot: that one stands for both
  | 'missing'          // the game thought it saved, CAVE has no row, and no point is on record
  | 'too_new'          // saved after the newest row CAVE lists: cannot be checked yet
  | 'unknown';         // the cell's current ID could not be looked up

export interface CheckedType extends LoggedType { status: CheckStatus; caveType?: string; }

export interface CheckResult {
  rows: CheckedType[];
  counts: Record<CheckStatus, number>;
  /** The newest row CAVE listed. Saves after this cannot be checked yet. */
  caveUpTo: string | null;
}

const samePoint = (a: number[] | null, b: number[] | null) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** Within a few steps of each other: the same spot on the same cell. */
const NEAR = 40;
const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) <= NEAR && Math.abs(a[1] - b[1]) <= NEAR && Math.abs(a[2] - b[2]) <= NEAR;
const sameType = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * @param logged     every logged save on this dataset
 * @param cave       every row of CAVE's table
 * @param currentIds for a logged cell ID, the ID or IDs the cell has now
 *                   (itself if never edited); null if that could not be found
 */
export function checkCellTypes(
    logged: readonly LoggedType[], cave: readonly CaveType[],
    currentIds: ReadonlyMap<string, string[] | null>): CheckResult {
  const byRoot = new Map<string, CaveType[]>();
  let caveUpTo: string | null = null;
  for (const c of cave) {
    if (c.rootId && c.rootId !== '0') (byRoot.get(c.rootId) ?? byRoot.set(c.rootId, []).get(c.rootId)!).push(c);
    if (c.created && (!caveUpTo || c.created > caveUpTo)) caveUpTo = c.created;
  }

  // The newest save of each cell is the one that should be in CAVE.
  const latest = new Map<string, LoggedType>();
  for (const l of [...logged].sort((a, b) => a.at.localeCompare(b.at))) latest.set(l.segId, l);

  // A point used for more than one cell cannot say which cell it meant.
  const cellsAtPoint = new Map<string, Set<string>>();
  for (const l of logged) {
    if (!l.point) continue;
    const key = l.point.join(',');
    (cellsAtPoint.get(key) ?? cellsAtPoint.set(key, new Set()).get(key)!).add(l.segId);
  }

  const rows: CheckedType[] = [];
  for (const l of latest.values()) {
    const ids = currentIds.get(l.segId);
    const onCell = (ids ?? []).flatMap(id => byRoot.get(id) ?? []);
    const atPoint = l.point ? cave.filter(c => samePoint(c.point, l.point)) : [];
    const match = [...onCell, ...atPoint].find(c => sameType(c.type, l.type));
    let status: CheckStatus;
    let caveType: string | undefined;
    if (match) status = 'in_cave';
    else if (onCell.length) { status = 'other_type'; caveType = onCell[onCell.length - 1].type; }
    else if (l.point) status = (cellsAtPoint.get(l.point.join(','))?.size ?? 0) > 1 ? 'needs_point' : 'resend';
    else if (ids === null || ids === undefined) status = 'unknown';
    else if (!caveUpTo || l.at > caveUpTo) status = 'too_new';
    else status = 'missing';
    rows.push({ ...l, status, ...(caveType ? { caveType } : {}) });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  // A save that failed is usually tried again on the spot, and by then an
  // edit may have given the cell a new ID, so the two look like two cells.
  // Of failed saves of one type a few steps apart, only the newest is sent.
  const kept: CheckedType[] = [];
  for (const r of rows) {
    if (r.status !== 'resend') continue;
    if (kept.some(k => sameType(k.type, r.type) && near(k.point!, r.point!))) r.status = 'tried_again';
    else kept.push(r);
  }
  const counts: Record<CheckStatus, number> = { in_cave: 0, other_type: 0, resend: 0, needs_point: 0, tried_again: 0, missing: 0, too_new: 0, unknown: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, counts, caveUpTo };
}
