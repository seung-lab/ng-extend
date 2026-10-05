/**
 * One person's contribution to one dataset: edits (edit_log), cells
 * proofread (cave_completions_mirror, keyed by the numeric CAVE id) and help
 * requests. Shared by the profile's Datasets tab and the "Now entering"
 * card, so the two can never show different numbers.
 */
import { segLayerName, canonicalDataset, currentDatasetTag, findDatasetByCanonical, type DatasetEntry } from '../datasets';

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
 * Cells completed on a dataset according to the app's own log (edit_log),
 * by the leaderboard's rule: one cell per distinct root id, not counted when
 * its newest event is an un-mark. The CAVE mirror only fills from CAVE's
 * materialized snapshots, which never include the EyeWire table on MICrONS
 * and do not exist for MEC, so those datasets always showed 0 cells
 * (Ames 2026-10-04). Null when the log cannot be read.
 */
async function loggedCompletions(uid: string, tags: string[]): Promise<number | null> {
  try {
    const { supabase } = await import('../supabase');
    const { data, error } = await supabase.from('edit_log')
      .select('operation,metadata,segment_after,success,created_at')
      .eq('user_id', uid).in('dataset', tags)
      .in('operation', ['complete_task', 'mark_complete', 'unmark_complete'])
      .order('created_at', { ascending: true }).limit(5000);
    if (error || !data) return null;
    const done = new Map<string, boolean>();
    for (const r of data as any[]) {
      if (r.success === false) continue;
      const id = String(r.metadata?.root_id ?? r.metadata?.final_segment_id ?? r.segment_after ?? '');
      // No id: its own cell, keyed by the minute (the leaderboard's rule).
      const key = id || `t:${String(r.created_at).slice(0, 16)}`;
      done.set(key, r.operation !== 'unmark_complete');
    }
    return [...done.values()].filter(Boolean).length;
  } catch { return null; }
}

/**
 * Cells you have completed on the dataset on screen, for the completion
 * celebration (Amy 2026-09-28). The mirror syncs from CAVE every 30 minutes,
 * so a cell completed just now may not be in it yet: count it when missing.
 * Two tiny queries, only when a celebration shows.
 */
export async function datasetCellCount(uid: string, segId?: string): Promise<{ label: string; count: number } | null> {
  const ds = findDatasetByCanonical(canonicalDataset(currentDatasetTag()));
  const caveId = await caveIdFor(uid);
  if (!ds || caveId == null) return null;
  const { supabase } = await import('../supabase');
  const tags = datasetTagVariants(ds);
  const [count, mirrored] = await Promise.all([
    supabase.from('cave_completions_mirror').select('segment_id', { count: 'exact', head: true })
      .eq('cave_user_id', caveId).in('dataset', tags).then((r: any) => r.count ?? null),
    segId ? supabase.from('cave_completions_mirror').select('segment_id').eq('cave_user_id', caveId)
      .in('dataset', tags).eq('segment_id', segId).limit(1).then((r: any) => (r.data?.length ?? 0) > 0)
      : Promise.resolve(true),
  ]);
  const logged = await loggedCompletions(uid, tags);
  if (count == null && logged == null) return null;
  // The mirror holds older history, the log holds what CAVE's snapshots miss:
  // whichever knows of more cells is right.
  return { label: ds.shortLabel || ds.label, count: Math.max((count ?? 0) + (count != null && !mirrored ? 1 : 0), logged ?? 0) };
}

export async function loadContribution(ds: DatasetEntry, uid: string): Promise<DatasetContribution> {
  const { supabase } = await import('../supabase');
  if (!caveIdCache || caveIdCache.uid !== uid) {
    let caveId: number | null = null;
    try {
      const { data } = await supabase.from('users').select('cave_user_id').eq('id', uid).single();
      caveId = data?.cave_user_id ?? null;
    } catch { /* no CAVE id yet */ }
    caveIdCache = { uid, caveId };
  }
  const caveId = caveIdCache.caveId;
  const tags = datasetTagVariants(ds);
  const [edits, mirrored, helpRequests, logged] = await Promise.all([
    supabase.from('edit_log').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).then((r: any) => r.count ?? 0),
    caveId == null ? Promise.resolve(0) :
      supabase.from('cave_completions_mirror').select('segment_id', { count: 'exact', head: true })
        .eq('cave_user_id', caveId).in('dataset', tags).then((r: any) => r.count ?? 0),
    supabase.from('help_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).then((r: any) => r.count ?? 0),
    loggedCompletions(uid, tags),
  ]);
  return { edits, completions: Math.max(mirrored, logged ?? 0), helpRequests };
}
