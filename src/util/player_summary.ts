/**
 * One player's record in a few small reads, shared by the profile and its
 * Datasets tab (Ames 2026-10-25, after the database ran out of CPU). The
 * profile used to read every edit the player ever made, 1,000 rows a request,
 * on every open; the Datasets tab asked 15 datasets for counts at once.
 *
 * Edits come from ew_user_edit_hours (supabase-db-load.sql, step 6): one row
 * per player, dataset and UTC hour with that hour's merges and splits, kept
 * by a trigger on edit_log, by the board's rule. Null until that table exists,
 * and callers then read edit_log as before.
 *
 * Each read is shared while it runs and kept for 30 seconds, so opening a tab
 * or coming back to Overview does not ask again.
 */
export interface EditHour { dataset: string; hour: number; merges: number; splits: number; }

const KEEP_MS = 30_000;
const kept = new Map<string, { at: number; p: Promise<any> }>();
function shared<T>(key: string, read: () => Promise<T | null>): Promise<T | null> {
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.p;
  const p = read().catch(() => null);
  kept.set(key, { at: Date.now(), p });
  // A failed read is not kept: the next open tries again.
  void p.then(v => { if (v === null && kept.get(key)?.p === p) kept.delete(key); });
  return p;
}

/** Every row of a query, a page at a time. Null if unreadable. */
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error || !data) return null;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/** The player's merges and splits by hour, all datasets, oldest first. */
export function editHours(uid: string): Promise<EditHour[] | null> {
  return shared('hours:' + uid, async () => {
    const { supabase } = await import('../supabase');
    const rows = await pages<any>((a, b) => supabase.from('ew_user_edit_hours')
      .select('dataset,hour,merges,splits').eq('user_id', uid)
      .order('hour', { ascending: true }).order('dataset', { ascending: true }).range(a, b));
    return rows && rows.map(r => ({ dataset: String(r.dataset ?? ''), hour: new Date(r.hour).getTime(), merges: Number(r.merges) || 0, splits: Number(r.splits) || 0 }));
  });
}

/** The dataset of each help request the player asked. */
export function helpRequestDatasets(uid: string): Promise<string[] | null> {
  return shared('help:' + uid, async () => {
    const { supabase } = await import('../supabase');
    const rows = await pages<any>((a, b) => supabase.from('help_requests').select('id,dataset')
      .eq('user_id', uid).order('id', { ascending: true }).range(a, b));
    return rows && rows.map(r => String(r.dataset ?? ''));
  });
}

/** The cells CAVE's copies of the datasets' own records credit to the
 *  player, every dataset at once. Empty when the player has no CAVE id. */
export function caveMirrorCells(uid: string): Promise<Array<{ dataset: string; segment: string }> | null> {
  return shared('mirror:' + uid, async () => {
    const { supabase } = await import('../supabase');
    const { data: me } = await supabase.from('users').select('cave_user_id').eq('id', uid).single();
    const caveId = (me as any)?.cave_user_id;
    if (caveId == null) return [];
    const rows = await pages<any>((a, b) => supabase.from('cave_completions_mirror').select('dataset,segment_id')
      .eq('cave_user_id', caveId).order('dataset', { ascending: true }).order('segment_id', { ascending: true }).range(a, b));
    return rows && rows.map(r => ({ dataset: String(r.dataset ?? ''), segment: String(r.segment_id) }));
  });
}
