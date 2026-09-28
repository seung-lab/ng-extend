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
  if (count == null) return null;
  return { label: ds.shortLabel || ds.label, count: count + (mirrored ? 0 : 1) };
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
  const [edits, completions, helpRequests] = await Promise.all([
    supabase.from('edit_log').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).then((r: any) => r.count ?? 0),
    caveId == null ? Promise.resolve(0) :
      supabase.from('cave_completions_mirror').select('segment_id', { count: 'exact', head: true })
        .eq('cave_user_id', caveId).in('dataset', tags).then((r: any) => r.count ?? 0),
    supabase.from('help_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('dataset', tags).then((r: any) => r.count ?? 0),
  ]);
  return { edits, completions, helpRequests };
}
