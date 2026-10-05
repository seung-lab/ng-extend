/**
 * One person's contribution to one dataset: edits (edit_log), cells
 * proofread (cave_completions_mirror, keyed by the numeric CAVE id) and help
 * requests. Shared by the profile's Datasets tab and the "Now entering"
 * card, so the two can never show different numbers.
 */
import { segLayerName, canonicalDataset, currentDatasetTag, findDatasetByCanonical, type DatasetEntry } from '../datasets';
import { completedCells, datasetKey, type CompletedCell, type CompletionLogRow } from './completion_rule';

export interface DatasetContribution { edits: number; completions: number; helpRequests: number; }

/** Every name a dataset has been logged under. */
export function datasetTagVariants(ds: DatasetEntry): string[] {
  const canon = canonicalDataset(segLayerName(ds));
  // edit_log.dataset DEFAULTs to 'eyewire_ii', so any row written without an
  // explicit tag carries that legacy retina name.
  const legacy = canon === 'stroeh_mouse_retina' ? ['eyewire_ii', 'eyewire_ii_retina'] : [];
  return [...new Set([canon, ds.id, segLayerName(ds), ...legacy])];
}

let caveIdCache: { uid: string; caveId: number | null } | null = null;

async function caveIdFor(uid: string): Promise<number | null> {
  const { supabase } = await import('../supabase');
  if (!caveIdCache || caveIdCache.uid !== uid) {
    let caveId: number | null = null;
    try {
      const { data } = await supabase.from('users').select('cave_user_id').eq('id', uid).single();
      caveId = data?.cave_user_id ?? null;
    } catch { /* no CAVE id yet */ }
    caveIdCache = { uid, caveId };
  }
  return caveIdCache.caveId;
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

/** The mirror's cells for a dataset (root ids), or null when it cannot be read. */
async function mirroredCells(caveId: number | null, tags: string[]): Promise<Set<string> | null> {
  if (caveId == null) return new Set();
  try {
    const { supabase } = await import('../supabase');
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('cave_completions_mirror').select('segment_id')
        .eq('cave_user_id', caveId).in('dataset', tags).order('segment_id', { ascending: true }).range(from, from + 999);
      if (error || !data) return null;
      for (const r of data as any[]) ids.add(String(r.segment_id));
      if (data.length < 1000) break;
    }
    return ids;
  } catch { return null; }
}

/**
 * Cells on a dataset: the mirror's and the log's, each cell once. The mirror
 * holds older history, the log holds what CAVE's snapshots miss, and most
 * recent cells are in both. A logged cell is the same as a mirrored one when
 * any root id it was logged under is in the mirror. (This used to be the
 * larger of the two counts, which loses cells whenever each side knows of
 * some the other does not.) Null when neither can be read.
 */
function unionCount(mirror: Set<string> | null, logged: CompletedCell[] | null, alsoSeg?: string): number | null {
  if (mirror == null && logged == null) return null;
  const seen = new Set(mirror ?? []);
  let n = seen.size;
  for (const c of logged ?? []) {
    if (!c.roots.some(r => seen.has(r))) n++;
    for (const r of c.roots) seen.add(r);
  }
  // A cell completed this second may be in neither yet.
  if (alsoSeg && !seen.has(alsoSeg)) n++;
  return n;
}

/**
 * Cells you have completed on the dataset on screen, for the completion
 * celebration (Amy 2026-09-28). The cell completed just now is counted even
 * when neither the mirror nor the log has caught up with it.
 */
export async function datasetCellCount(uid: string, segId?: string): Promise<{ label: string; count: number } | null> {
  const ds = findDatasetByCanonical(canonicalDataset(currentDatasetTag()));
  if (!ds) return null;
  const caveId = await caveIdFor(uid);
  const tags = datasetTagVariants(ds);
  if (logCache?.uid === uid) logCache = null;   // a cell was just completed
  const [mirror, logged] = await Promise.all([mirroredCells(caveId, tags), loggedCells(uid, tags)]);
  const count = unionCount(mirror, logged, segId);
  return count == null ? null : { label: ds.shortLabel || ds.label, count };
}

export async function loadContribution(ds: DatasetEntry, uid: string): Promise<DatasetContribution> {
  const { supabase } = await import('../supabase');
  const caveId = await caveIdFor(uid);
  const tags = datasetTagVariants(ds);
  const [edits, mirror, helpRequests, logged] = await Promise.all([
    // Splits and merges that went through: the same rows the board counts.
    supabase.from('edit_log').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).in('operation', ['split', 'merge']).not('success', 'is', false)
      .then((r: any) => r.count ?? 0),
    mirroredCells(caveId, tags),
    supabase.from('help_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).then((r: any) => r.count ?? 0),
    loggedCells(uid, tags),
  ]);
  return { edits, completions: unionCount(mirror, logged) ?? 0, helpRequests };
}
