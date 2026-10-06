/**
 * Dataset progress: how far along one dataset is as a whole, for the
 * Dataset Progress panel.
 *
 * Every number comes from the views in supabase-dataset-stats.sql, which do
 * the counting. Nothing is recounted here: this file reads rows and adds up
 * columns. Each part loads on its own and is null when it can not be read,
 * so the panel can say "not available" for that part and never show a zero
 * it did not read.
 *
 * These are counts of cells and edits. Not a scoring system.
 */
import { DATASETS, canonicalDataset, segLayerName, type DatasetEntry } from '../datasets';
import { datasetKey } from './completion_rule';

export interface DatasetProgress {
  done: number; claimed: number; waiting: number;
  /** Skipped, "Can't Complete", "Not BC": not part of the total. */
  setAside: number;
  /** Finished, but nothing records the day: left out of the weekly chart. */
  undated: number;
  /** done + claimed + waiting. */
  total: number;
}
export interface DatasetWeek { weekStart: string; cells: number; edits: number; }
export interface DatasetType { type: string | null; done: number; left: number; }
export interface DatasetWork { splits: number; merges: number; edits: number; annotations: number; players: number; }
export interface MyPart {
  /** Cells finished under your name in the cell list, or null if unread. */
  cells: number | null;
  /** Your edits and annotations here, or null if unread. */
  splits: number | null; merges: number | null; edits: number | null; annotations: number | null;
}
export interface DatasetStats {
  key: string;
  progress: DatasetProgress | null;
  weeks: DatasetWeek[] | null;
  types: DatasetType[] | null;
  work: DatasetWork | null;
  mine: MyPart | null;
  readAt: number;
}

/** The dataset's one name in the database (SQL: ew_dataset_key). */
export function statsKey(ds: DatasetEntry): string {
  return datasetKey(canonicalDataset(segLayerName(ds)));
}

/** Every row of a view for one dataset, a page at a time. Null if unreadable. */
async function rows(view: string, key: string, columns: string, order: string): Promise<any[] | null> {
  try {
    const { supabase } = await import('../supabase');
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(view).select(columns)
        .eq('dataset', key).order(order, { ascending: true }).range(from, from + 999);
      if (error || !data) return null;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  } catch { return null; }
}

const n = (v: unknown) => Number(v) || 0;

/**
 * The datasets that have something to show: a cell list, or work logged in
 * the game. Null when that can not be read.
 */
export async function datasetsWithStats(): Promise<DatasetEntry[] | null> {
  try {
    const { supabase } = await import('../supabase');
    const [p, w] = await Promise.all([
      supabase.from('ew_dataset_progress').select('dataset').limit(1000),
      supabase.from('ew_dataset_weekly').select('dataset').limit(10000),
    ]);
    if (p.error || !p.data) return null;
    const keys = new Set<string>([...(p.data as any[]), ...((w.data as any[]) ?? [])].map(r => r.dataset));
    const seen = new Set<string>();
    return DATASETS.filter(ds => {
      const k = statsKey(ds);
      if (ds.hidden || !keys.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch { return null; }
}

/**
 * Everything the panel shows for one dataset. `me` is the signed-in player:
 * their id, and the names the game may have written for them in the cell
 * list (display name and username).
 */
export async function loadDatasetStats(ds: DatasetEntry, me?: { id: string | null; names: string[] }): Promise<DatasetStats> {
  const key = statsKey(ds);
  const [p, w, t, work, people] = await Promise.all([
    rows('ew_dataset_progress', key, 'cells_done,cells_claimed,cells_waiting,cells_set_aside,cells_done_undated', 'dataset'),
    rows('ew_dataset_weekly', key, 'week_start,cells_done,edits', 'week_start'),
    rows('ew_dataset_types', key, 'cell_type,cells_done,cells_left', 'cell_type'),
    rows('ew_dataset_work', key, 'user_id,splits,merges,annotations', 'user_id'),
    rows('ew_dataset_people', key, 'proofreader,cells_done', 'proofreader'),
  ]);

  let progress: DatasetProgress | null = null;
  if (p) {
    // No row means the dataset has no cell list: zeros that were read.
    const r = p[0] ?? {};
    const done = n(r.cells_done), claimed = n(r.cells_claimed), waiting = n(r.cells_waiting);
    progress = { done, claimed, waiting, setAside: n(r.cells_set_aside), undated: n(r.cells_done_undated), total: done + claimed + waiting };
  }

  const weeks = w && w.map(r => ({ weekStart: String(r.week_start), cells: n(r.cells_done), edits: n(r.edits) }));

  const types = t && t.map(r => ({ type: r.cell_type ?? null, done: n(r.cells_done), left: n(r.cells_left) }));

  let workAll: DatasetWork | null = null;
  if (work) {
    const splits = work.reduce((s, r) => s + n(r.splits), 0), merges = work.reduce((s, r) => s + n(r.merges), 0);
    workAll = {
      splits, merges, edits: splits + merges,
      annotations: work.reduce((s, r) => s + n(r.annotations), 0),
      players: work.filter(r => n(r.splits) + n(r.merges) > 0).length,
    };
  }

  let mine: MyPart | null = null;
  if (me?.id) {
    const names = new Set(me.names.map(s => s.trim()).filter(Boolean));
    const row = work && work.find(r => r.user_id === me.id);
    mine = {
      cells: people ? people.filter(r => names.has(String(r.proofreader))).reduce((s, r) => s + n(r.cells_done), 0) : null,
      splits: work ? n(row?.splits) : null,
      merges: work ? n(row?.merges) : null,
      edits: work ? n(row?.splits) + n(row?.merges) : null,
      annotations: work ? n(row?.annotations) : null,
    };
  }

  return { key, progress, weeks, types, work: workAll, mine, readAt: Date.now() };
}

/**
 * The weekly rows as a gapless run of Mondays from the first week with
 * anything in it to the last, with the running total of cells. Weeks with
 * nothing are real zeros: the view was read and had no row for them.
 */
export function weeklySeries(weeks: DatasetWeek[]): { weekStart: string; cells: number; edits: number; running: number }[] {
  if (!weeks.length) return [];
  const by = new Map(weeks.map(r => [r.weekStart, r]));
  const out: { weekStart: string; cells: number; edits: number; running: number }[] = [];
  const first = Date.parse(weeks[0].weekStart + 'T00:00:00Z');
  const last = Date.parse(weeks[weeks.length - 1].weekStart + 'T00:00:00Z');
  let running = 0;
  for (let t = first; t <= last; t += 7 * 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    const r = by.get(k);
    running += r?.cells ?? 0;
    out.push({ weekStart: k, cells: r?.cells ?? 0, edits: r?.edits ?? 0, running });
  }
  return out;
}
