/**
 * The completed-cell rule, for one player's log rows.
 *
 * The rule itself lives in supabase-leaderboard-accuracy.sql (the view
 * ew_cell_completions), which the board, the weekly podium and the weekly
 * announcement all read. This is the same rule for the places in the app
 * that count from rows they already hold (the profile's per-dataset numbers).
 * functions/leaderboard-accuracy.test.js runs both on the same rows and fails
 * if they ever disagree, so change them together.
 *
 * No imports on purpose: the test loads this file on its own.
 */
export interface CompletionLogRow {
  id?: number | string | null;
  operation: string;
  timestamp: string;
  task_id?: number | null;
  metadata?: Record<string, any> | null;
  dataset?: string | null;
  success?: boolean | null;
}
export interface CompletedCell {
  dataset: string;
  /** 'task:12', a root id, or 'at:202610051147' for a row with no id at all. */
  cell: string;
  /** When it was completed (ms): the first mark after the last un-mark. */
  doneAt: number;
  /** Every root id this cell was logged under. */
  roots: string[];
}

/** One name per dataset (SQL: ew_dataset_key). */
export function datasetKey(d: string | null | undefined): string {
  return d == null || d === 'eyewire_ii' || d === 'eyewire_ii_retina' ? 'stroeh_mouse_retina' : d;
}

const TWO_MINUTES = 120_000;
const isMark = (op: string) => op === 'complete_task' || op === 'mark_complete';

/** The cells ONE player has completed and not un-marked. Pass every
 *  completion row of that player (complete_task, mark_complete,
 *  unmark_complete), on every dataset, whole history: when a cell was
 *  completed is decided before any time window is applied. */
export function completedCells(rows: CompletionLogRow[]): CompletedCell[] {
  const ev = rows
    .filter(r => r.success !== false && (isMark(r.operation) || r.operation === 'unmark_complete'))
    .map((r, i) => {
      const m = r.metadata ?? {};
      const rid = m.final_segment_id ?? m.root_id ?? m.segment_id;
      return {
        i, op: r.operation, ts: Date.parse(r.timestamp), dataset: datasetKey(r.dataset),
        task: r.task_id ?? null, rid: rid == null || rid === '' ? null : String(rid),
      };
    });
  // A root id that a task was completed with belongs to that task.
  const taskOfRoot = new Map<string, number>();
  for (const e of ev) {
    if (e.op !== 'complete_task' || e.task == null || e.rid == null) continue;
    const k = e.dataset + '|' + e.rid;
    const had = taskOfRoot.get(k);
    if (had == null || e.task < had) taskOfRoot.set(k, e.task);
  }
  const keyOf = (e: typeof ev[number]): string | null => {
    if (e.op === 'complete_task' && e.task != null && e.rid != null) return 'task:' + e.task;
    if (e.rid != null) {
      const t = taskOfRoot.get(e.dataset + '|' + e.rid);
      return t != null ? 'task:' + t : e.rid;
    }
    if (e.op === 'unmark_complete') return null;
    // No id: the echo of a completion that has one, within two minutes.
    if (ev.some(d => d.i !== e.i && d.dataset === e.dataset && isMark(d.op) && d.rid != null &&
        Math.abs(d.ts - e.ts) <= TWO_MINUTES)) return null;
    if (e.task != null) return 'task:' + e.task;
    return 'at:' + new Date(e.ts).toISOString().slice(0, 16).replace(/[-T:]/g, '');
  };
  const keyed = ev.map(e => ({ ...e, cell: keyOf(e) })).filter(e => e.cell != null);
  const lastUnmark = new Map<string, number>();
  for (const e of keyed) {
    if (e.op !== 'unmark_complete') continue;
    const k = e.dataset + '|' + e.cell;
    if (!(lastUnmark.get(k)! >= e.ts)) lastUnmark.set(k, e.ts);
  }
  const cells = new Map<string, CompletedCell>();
  const roots = new Map<string, Set<string>>();
  for (const e of keyed) {
    if (e.op === 'unmark_complete') continue;
    const k = e.dataset + '|' + e.cell;
    if (e.rid != null) (roots.get(k) ?? roots.set(k, new Set()).get(k)!).add(e.rid);
    const un = lastUnmark.get(k);
    if (un != null && e.ts <= un) continue;
    const had = cells.get(k);
    if (!had || e.ts < had.doneAt) cells.set(k, { dataset: e.dataset, cell: e.cell!, doneAt: e.ts, roots: [] });
  }
  for (const [k, c] of cells) c.roots = [...(roots.get(k) ?? [])];
  return [...cells.values()].sort((a, b) => a.doneAt - b.doneAt || (a.cell < b.cell ? -1 : 1));
}
