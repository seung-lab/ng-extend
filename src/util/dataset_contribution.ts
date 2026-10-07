/**
 * One person's contribution to one dataset: edits, cells completed and help
 * requests. Shared by the profile's Datasets tab and the "Now entering"
 * card, so the two can never show different numbers.
 *
 * ONE SOURCE, AND ONLY THE GAME (Ames 2026-10-07: "stats for this game
 * should only include things that were done in this game"). Cells completed
 * are the game's own log by the completed cell rule (completion_rule.ts,
 * the same rule as the SQL view ew_cell_completions that the leaderboard and
 * the career counter users.cells_completed are built on). They used to be
 * joined with CAVE's copy of each dataset's own records, which also holds
 * cells a player marked in other tools: a profile said 360 cells completed
 * while its Retina card said 365, and a BANC card said 1,939 for work never
 * done here. Summed over datasets, the cards now equal the career number.
 */
import { segLayerName, canonicalDataset, currentDatasetTag, findDatasetByCanonical, type DatasetEntry } from '../datasets';
import { completedCells, datasetKey, type CompletedCell, type CompletionLogRow } from './completion_rule';

export interface DatasetContribution { edits: number; completions: number; helpRequests: number; }

/**
 * Datasets whose work happens in the game, so edits and help requests there
 * are the player's whole record. Everywhere else (BANC, FlyWire, MICrONS...)
 * most of a player's work was done in other tools, and "0 edits" beside
 * 1,939 cells reads as wrong (Ames 2026-10-06): those cards lead with cells
 * proofread and show edits or help requests only when there are some.
 */
const GAME_NATIVE = new Set(['stroeh_mouse_retina', 'pni_mec', 'pinky_sandbox']);
export function showsAllStats(ds: DatasetEntry): boolean {
  return GAME_NATIVE.has(ds.id);
}

/** Every name a dataset has been logged under. */
export function datasetTagVariants(ds: DatasetEntry): string[] {
  const canon = canonicalDataset(segLayerName(ds));
  // edit_log.dataset DEFAULTs to 'eyewire_ii', so any row written without an
  // explicit tag carries that legacy retina name.
  const legacy = canon === 'stroeh_mouse_retina' ? ['eyewire_ii', 'eyewire_ii_retina'] : [];
  return [...new Set([canon, ds.id, segLayerName(ds), ...legacy])];
}

/**
 * The cells a player has completed on a dataset, from the app's own log
 * (edit_log) by the leaderboard's rule (completion_rule.ts, the same rule as
 * the SQL view ew_cell_completions). The CAVE mirror only fills from CAVE's
 * materialized snapshots, which never include the EyeWire table on MICrONS
 * and do not exist for MEC, so those datasets always showed 0 cells
 * (Ames 2026-10-04). Null when the log cannot be read.
 *
 * The rule needs the player's whole completion history on every dataset
 * (when a cell was completed is decided before anything is filtered), so
 * this reads all of it, a page at a time, and keeps it for a minute.
 */
let logCache: { uid: string; at: number; cells: CompletedCell[] } | null = null;
async function loggedCells(uid: string, tags: string[]): Promise<CompletedCell[] | null> {
  try {
    if (!logCache || logCache.uid !== uid || Date.now() - logCache.at > 60_000) {
      const { supabase } = await import('../supabase');
      const rows: CompletionLogRow[] = [];
      for (let from = 0; ; from += 1000) {
        // The log's time column is `timestamp`. (It was read as `created_at`,
        // which does not exist, so this always failed and the mirror's number
        // was shown alone: audit of 2026-10-05.)
        const { data, error } = await supabase.from('edit_log')
          .select('id,operation,metadata,task_id,dataset,success,timestamp')
          .eq('user_id', uid)
          .in('operation', ['complete_task', 'mark_complete', 'unmark_complete'])
          .order('timestamp', { ascending: true }).order('id', { ascending: true })
          .range(from, from + 999);
        if (error || !data) return null;
        rows.push(...(data as any[]));
        if (data.length < 1000) break;
      }
      logCache = { uid, at: Date.now(), cells: completedCells(rows) };
    }
    const keys = new Set(tags.map(datasetKey));
    return logCache.cells.filter(c => keys.has(c.dataset));
  } catch { return null; }
}

/**
 * Both numbers of the completion celebration from ONE place: the database's
 * own list of a player's completed cells (ew_cell_completions, the rule the
 * leaderboard uses). They used to come from two: the dataset's number from
 * the CAVE mirror joined with the log, the overall number from a counter on
 * the profile. The two disagreed, and the celebration said "your EyeWire II
 * total is 72" over "63 cells across all datasets" (Ames 2026-10-07). Counted
 * from one list, a dataset can never have more cells than all datasets do.
 * Null when the list can not be read.
 */
export async function celebrationCellCounts(uid: string): Promise<{ label: string; here: number; all: number } | null> {
  const ds = findDatasetByCanonical(canonicalDataset(currentDatasetTag()));
  try {
    const { supabase } = await import('../supabase');
    const rows: { dataset: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('ew_cell_completions').select('dataset,cell')
        .eq('user_id', uid).order('cell', { ascending: true }).range(from, from + 999);
      if (error || !data) return null;
      rows.push(...(data as any[]));
      if (data.length < 1000) break;
    }
    const keys = new Set(ds ? datasetTagVariants(ds).map(datasetKey) : []);
    const here = rows.filter(r => keys.has(datasetKey(r.dataset))).length;
    return { label: ds ? (ds.shortLabel || ds.label) : '', here, all: rows.length };
  } catch { return null; }
}

export async function loadContribution(ds: DatasetEntry, uid: string): Promise<DatasetContribution> {
  const { supabase } = await import('../supabase');
  const tags = datasetTagVariants(ds);
  const [edits, helpRequests, logged] = await Promise.all([
    // Splits and merges that went through: the same rows the board counts.
    supabase.from('edit_log').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).in('operation', ['split', 'merge']).not('success', 'is', false)
      .then((r: any) => r.count ?? 0),
    supabase.from('help_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).then((r: any) => r.count ?? 0),
    loggedCells(uid, tags),
  ]);
  return { edits, completions: logged?.length ?? 0, helpRequests };
}
