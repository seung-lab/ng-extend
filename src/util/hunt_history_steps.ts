/**
 * Make a Hunt from a proofread cell (Ames 2026-10-26, docs/HUNT-FROM-EDITS.md):
 * the cell's own edits, from the chunked graph's history, as Hunt places. Each
 * cut a proofreader made is a merger to Cut, each join an extension to Extend.
 * No imports, so the node tests (scripts/hunt-history-steps.test.mjs) load it
 * as it is; src/util/hunt_from_edits.ts does the asking.
 *
 * The cell's own edits are the ones that changed the object holding the soma:
 * from the soma's root before the first edit, an edit is the cell's when the
 * cell is among its before roots, and the cell is then its first after root
 * (the change log lists only the root kept). The rest of a big history is
 * work on pieces before they were joined, which players never see.
 *
 * Players see the cell as it was at one moment, the start of an editing
 * session. Only what was wrong in that cell can be found: a cut whose edges
 * were inside it (not one inside a piece joined later), and a join with one
 * side in it and the other not (not the second join of a chain).
 */

export type PlaceKind = 'cut' | 'merge';

export interface HistoryOp {
  id: number;
  /** Milliseconds since 1970. */
  at: number;
  isMerge: boolean;
  before: string[];
  after: string[];
  user: string;
}

export interface OpDetail {
  added: [string, string][];
  removed: [string, string][];
  /** The proofreader's points, in the graph's base voxels. */
  src: number[][];
  snk: number[][];
  roots: string[];
  undoOf: number | null;
  redoOf: number | null;
  /** 0 when the edit went through; missing on older graphs. */
  status: number | null;
}

export interface CellEdit {
  op: HistoryOp;
  /** The cell's root just before this edit. */
  prev: string;
  kind: PlaceKind;
  /** Supervoxel pairs joined (merge) or cut apart (cut), at most PAIRS_KEPT. */
  pairs: [string, string][];
  /** Where it happened, nm: the middle of the proofreader's points. */
  nm: number[];
  /** How far apart the two sides' points were, nm. Wide cuts need a look by hand. */
  gapNm: number;
  undone: boolean;
  /** It did not go through (operation_status not 0). */
  failed: boolean;
  /** A cut that separated nothing: the graph made no second root, so nothing was fixed yet. */
  idle: boolean;
  /** The piece joined (merge) or cut off (cut): its roots. */
  piece: string[];
}

export interface Place {
  kind: PlaceKind;
  nm: number[];
  op: number;
  at: number;
  user: string;
  /** The proofreader's points were further apart than the tolerance: check where the gem should go. */
  wide: boolean;
}

/** Why edits were left out of a start's places: taken back, did not go through, a cut that separated nothing,
 *  in pieces not yet part of the cell, a tiny piece, and a second one of a kind on the same spot. */
export interface Dropped { undone: number; failed: number; idle: number; hidden: number; tiny: number; closeCut: number; closeMerge: number }

export const PAIRS_KEPT = 60;
/** Edits more than this far apart in time are separate editing sessions. */
export const SESSION_GAP_MS = 60 * 60 * 1000;
/** A piece this many level 2 chunks or fewer is a spine or a crumb, too small to hunt. */
export const TINY_L2 = 1;

/** JSON with every long number turned into text first: the ids are 18 digits and JSON numbers would round them. */
export function parseBigJson(text: string): any {
  return JSON.parse(text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

function stampMs(value: unknown): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(\.\d+)?$/.test(value)) return stampMs(Number(value));
  const iso = value.replace(' ', 'T');
  const t = Date.parse(iso + (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
  return Number.isFinite(t) ? t : Date.parse(value);
}

const ids = (v: any): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String).filter(x => /^\d+$/.test(x));
const pair = (e: any): [string, string] | null => (Array.isArray(e) && e.length >= 2 && /^\d+$/.test(String(e[0])) && /^\d+$/.test(String(e[1])) ? [String(e[0]), String(e[1])] : null);
const pairs = (v: any): [string, string][] => (Array.isArray(v) ? v.map(pair).filter((p): p is [string, string] => !!p) : []);
const points = (v: any): number[][] => (Array.isArray(v) ? v.filter(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((x: any) => Number.isFinite(Number(x)))).map(p => p.slice(0, 3).map(Number)) : []);
const opId = (v: any): number | null => (v == null || v === '' ? null : Number.isSafeInteger(Number(v)) ? Number(v) : null);

/** The edits in a tabular_change_log answer (filtered=false), oldest first. Rows, or columns as lists or {index: value}, bare or under the root. */
export function parseHistory(data: any, rootId: string): HistoryOp[] {
  let rows = data?.[rootId] ?? data;
  if (typeof rows === 'string') rows = parseBigJson(rows);
  if (!Array.isArray(rows)) {
    if (!rows || typeof rows !== 'object' || !rows.operation_id) throw Error('Unrecognized change log');
    const col = (name: string) => rows[name] ?? {};
    const keys = Array.isArray(rows.operation_id) ? rows.operation_id.map((_: any, i: number) => i) : Object.keys(rows.operation_id);
    rows = keys.map((k: any) => ({
      operation_id: col('operation_id')[k], timestamp: col('timestamp')[k], is_merge: col('is_merge')[k],
      before_root_ids: col('before_root_ids')[k], after_root_ids: col('after_root_ids')[k], user_name: col('user_name')[k], user_id: col('user_id')[k],
    }));
  }
  const out: HistoryOp[] = [];
  for (const r of rows) {
    const id = Number(r?.operation_id), at = stampMs(r?.timestamp);
    if (!Number.isSafeInteger(id) || !Number.isFinite(at)) continue;
    out.push({ id, at, isMerge: r?.is_merge === true || r?.is_merge === 'true' || r?.is_merge === 1,
      before: ids(r?.before_root_ids), after: ids(r?.after_root_ids), user: String(r?.user_name || r?.user_id || '') });
  }
  return out.sort((a, b) => a.at - b.at || a.id - b.id);
}

/** An operation_details answer: {op id: details}. */
export function parseDetails(data: any): Map<number, OpDetail> {
  const out = new Map<number, OpDetail>();
  for (const [k, x] of Object.entries(data && typeof data === 'object' ? data : {})) {
    const id = Number(k);
    if (!Number.isSafeInteger(id) || !x || typeof x !== 'object') continue;
    const d: any = x;
    out.set(id, { added: pairs(d.added_edges), removed: pairs(d.removed_edges), src: points(d.source_coords), snk: points(d.sink_coords),
      roots: ids(d.roots), undoOf: opId(d.undo_operation_id), redoOf: opId(d.redo_operation_id),
      status: d.operation_status == null || d.operation_status === '' ? null : Number(d.operation_status) });
  }
  return out;
}

const key = (p: [string, string]) => (p[0] < p[1] ? `${p[0]}-${p[1]}` : `${p[1]}-${p[0]}`);

/**
 * Edits that were taken back: an undo or redo and the edit it names (the Sandbox marks these),
 * and a cut that removes an edge an earlier join added (MICrONS public marks no undos at all).
 */
export function undoneOps(ops: HistoryOp[], details: Map<number, OpDetail>): Set<number> {
  const out = new Set<number>();
  for (const [id, d] of details) {
    for (const t of [d.undoOf, d.redoOf]) if (t != null) { out.add(id); out.add(t); }
  }
  const firstAdded = new Map<string, number>();
  const order = [...ops].sort((a, b) => a.id - b.id);
  for (const o of order) for (const p of details.get(o.id)?.added ?? []) if (!firstAdded.has(key(p))) firstAdded.set(key(p), o.id);
  for (const o of order) {
    for (const p of details.get(o.id)?.removed ?? []) {
      const m = firstAdded.get(key(p));
      if (m != null && m < o.id) { out.add(o.id); out.add(m); }
    }
  }
  return out;
}

const centre = (ps: number[][]) => [0, 1, 2].map(k => ps.reduce((s, p) => s + p[k], 0) / ps.length);
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The cell's own edits, from its root before the first edit; reaches = the walk ended at the cell asked about. */
export function cellEdits(ops: HistoryOp[], details: Map<number, OpDetail>, start: string, finalRoot: string, resNm: number[]): { edits: CellEdit[]; reaches: boolean } {
  const undone = undoneOps(ops, details);
  const edits: CellEdit[] = [];
  let cur = start;
  for (const op of ops) {
    if (!op.before.includes(cur) || !op.after.length) continue;
    const d = details.get(op.id);
    const kind: PlaceKind = op.isMerge ? 'merge' : 'cut';
    const src = (d?.src ?? []).map(p => p.map((v, k) => v * resNm[k]));
    const snk = (d?.snk ?? []).map(p => p.map((v, k) => v * resNm[k]));
    const A = src.length ? centre(src) : null, B = snk.length ? centre(snk) : null;
    const nm = A && B ? centre([A, B]) : A || B || [NaN, NaN, NaN];
    const piece = op.isMerge ? op.before.filter(r => r !== cur) : (d?.roots ?? []).filter(r => !op.after.includes(r));
    edits.push({ op, prev: cur, kind, pairs: (op.isMerge ? d?.added : d?.removed ?? [])?.slice(0, PAIRS_KEPT) ?? [], nm: nm.map(v => Math.round(v)),
      gapNm: A && B ? Math.round(dist(A, B)) : 0, undone: undone.has(op.id),
      failed: d?.status != null && d.status !== 0, idle: !op.isMerge && !!d && !piece.length, piece });
    cur = op.after[0];
  }
  return { edits, reaches: cur === finalRoot };
}

/** Where each editing session starts: indexes into the cell's edits. */
export function sessionStarts(edits: CellEdit[], gapMs = SESSION_GAP_MS): number[] {
  return edits.map((_, i) => i).filter(i => i === 0 || edits[i].op.at - edits[i - 1].op.at > gapMs);
}

/** The supervoxels to look up for a session: every one in the edits from it on. */
export function sessionSupervoxels(edits: CellEdit[], from: number): string[] {
  const s = new Set<string>();
  for (const e of edits.slice(from)) for (const [u, v] of e.pairs) { s.add(u); s.add(v); }
  return [...s];
}

/** Can a player see it in the cell R? rootOf: each supervoxel's root at that moment. */
export function visibleIn(e: CellEdit, rootOf: Map<string, string>, R: string): boolean {
  const ins = e.pairs.map(([u, v]) => [rootOf.get(u) === R, rootOf.get(v) === R]);
  if (e.kind === 'cut') return ins.some(([a, b]) => a && b);
  return ins.some(([a, b]) => a !== b) && !ins.some(([a, b]) => a && b);
}

/**
 * The places for a start: visible, not taken back, not a tiny piece, and one per kind within the tolerance
 * (two of a kind that close would need two gems on one spot). pieceL2: each edit's piece size, by op id
 * (unknown sizes are kept). Also how many each rule dropped.
 */
export function placesFor(edits: CellEdit[], from: number, visible: Set<number>, pieceL2: Map<number, number>, tolNm: number, tinyL2 = TINY_L2): { places: Place[]; dropped: Dropped } {
  const dropped: Dropped = { undone: 0, failed: 0, idle: 0, hidden: 0, tiny: 0, closeCut: 0, closeMerge: 0 };
  const places: Place[] = [];
  for (const e of edits.slice(from)) {
    if (e.undone) { dropped.undone++; continue; }
    if (e.failed) { dropped.failed++; continue; }
    if (e.idle) { dropped.idle++; continue; }
    if (!visible.has(e.op.id)) { dropped.hidden++; continue; }
    const l2 = pieceL2.get(e.op.id);
    if (l2 != null && l2 <= tinyL2) { dropped.tiny++; continue; }
    if (!e.nm.every(Number.isFinite)) { dropped.hidden++; continue; }
    if (places.some(p => p.kind === e.kind && dist(p.nm, e.nm) < tolNm)) { if (e.kind === 'cut') dropped.closeCut++; else dropped.closeMerge++; continue; }
    places.push({ kind: e.kind, nm: e.nm, op: e.op.id, at: e.op.at, user: e.op.user, wide: e.gapNm > tolNm });
  }
  return { places, dropped };
}
