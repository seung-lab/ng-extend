/**
 * Watch it grow (Nseraf, triage #194): the steps of a cell's history, from
 * the chunked graph's tabular change log. No imports, so the node tests
 * (scripts/cell-history-steps.test.mjs) can load it as it is.
 *
 * One step before any edit, then one after each edit, oldest first. The last
 * step is the cell as it is today. Each step has a moment to ask the graph
 * about: the root of a supervoxel at that moment is what the cell was then.
 */

export interface HistoryEdit {
  operationId: number;
  /** Milliseconds since 1970. */
  at: number;
  userId: string;
  isMerge: boolean;
}

export interface HistoryStep {
  /** Index into the full edit list, or -1 for "before any edits". */
  edit: number;
  /** The moment to ask the graph about, in milliseconds. Null: today. */
  askAt: number | null;
}

/** Most steps the slider offers. A longer history is spread evenly. */
export const MAX_HISTORY_STEPS = 150;

function stampMs(value: unknown): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(\.\d+)?$/.test(value)) return stampMs(Number(value));
  const iso = value.replace(' ', 'T');
  return Date.parse(iso + (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
}

/** The edits in a tabular_change_log answer, oldest first. Takes the shapes
 *  the server has been seen to send: a list of rows, or columns (as lists or
 *  as {index: value} objects), either bare or under the root's id. */
export function parseChangeLog(data: any, rootId: string): HistoryEdit[] {
  let rows = data?.[rootId] ?? data;
  if (typeof rows === 'string') rows = JSON.parse(rows);
  if (!Array.isArray(rows)) {
    if (!rows || typeof rows !== 'object' || !rows.operation_id) throw Error('Unrecognized change log');
    const col = (name: string) => rows[name] ?? {};
    const keys = Array.isArray(rows.operation_id) ? rows.operation_id.map((_: any, i: number) => i) : Object.keys(rows.operation_id);
    rows = keys.map((k: any) => ({
      operation_id: col('operation_id')[k], timestamp: col('timestamp')[k],
      user_id: col('user_id')[k], is_merge: col('is_merge')[k],
    }));
  }
  const edits: HistoryEdit[] = [];
  for (const r of rows) {
    const at = stampMs(r?.timestamp);
    const operationId = Number(r?.operation_id);
    if (!Number.isFinite(at) || !Number.isFinite(operationId)) continue;
    edits.push({
      operationId, at,
      userId: r?.user_id == null ? '' : String(r.user_id),
      isMerge: r?.is_merge === true || r?.is_merge === 'true' || r?.is_merge === 1,
    });
  }
  return edits.sort((a, b) => a.at - b.at || a.operationId - b.operationId);
}

/** Which edits get a step: all of them, or `max` spread evenly with the
 *  first and the last always kept. */
export function sampleEdits(count: number, max = MAX_HISTORY_STEPS): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  if (max <= 1) return [count - 1];
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const k = Math.round(i * (count - 1) / (max - 1));
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

/** The slider's steps. After an edit, the moment asked about is halfway to
 *  the next edit, safely after the one and before the other; the last edit
 *  gives today's cell, so it needs no lookup. */
export function historySteps(edits: HistoryEdit[], max = MAX_HISTORY_STEPS): HistoryStep[] {
  if (!edits.length) return [];
  const steps: HistoryStep[] = [{ edit: -1, askAt: edits[0].at - 1000 }];
  for (const i of sampleEdits(edits.length, max)) {
    const next = edits[i + 1];
    steps.push({ edit: i, askAt: next ? (edits[i].at + next.at) / 2 : null });
  }
  return steps;
}

/** "unknown" unless the lab login belongs to a Pyr player with a name. */
export function editorName(userId: string, names: Map<string, string>): string {
  return names.get(userId) || 'unknown';
}
