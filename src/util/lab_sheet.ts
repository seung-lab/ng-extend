/**
 * What the lab's own sheet says about the cell the Delta menu is open on.
 *
 * On Retina the lab keeps a sheet of every cell's proofreading and
 * annotations (28,000 rows, 13 MB). Browsers never download it: a copy of a
 * few columns lives in Supabase (supabase-retina-lab-sheet.sql, filled hourly
 * by scripts/sync-retina-lab-sheet.mjs) and this asks it for one cell's rows.
 *
 * READ ONLY. The game never writes to that sheet or to its copy.
 *
 * INFORMATION ONLY. What comes back is shown in the menu, labelled as the
 * lab's. It must never mark a cell complete in the game, set its type, or
 * reach a player's stats, the leaderboard or an Achievement: those count only
 * what was done in the game.
 *
 * Finding the row. A cell gets a new ID with every edit, and the sheet's IDs
 * are as of some past day, so:
 *   1. ask for rows holding this exact ID (one small request; an unedited
 *      cell stops here);
 *   2. otherwise ask for rows holding any ID in the cell's edit history;
 *   3. and keep only rows whose soma is in this cell today. A history also
 *      contains pieces that were once merged in by mistake and cut away
 *      again, and each of those may be another cell with its own row. The
 *      soma's supervoxel never changes, so "which cell holds it now" settles
 *      it.
 * Nothing found, or any lookup failing, shows nothing rather than a guess.
 */
import { supabase } from '../supabase';
import { getDatasetCaveConfig } from '../config';
import { currentSegLayerName } from '../datasets';
import { lineageIds, getRootFromSupervoxel } from '../widgets/pcg_service';

export interface LabSheetRow {
  sheet_index: string;
  soma_supervoxel_id: string | null;
  latest_seg_id: string | null;
  proofread_seg_id: string | null;
  status: string | null;
  cell_class: string | null;
  cell_type: string | null;
  cell_type_machine: string | null;
  cell_type_confidence: string | null;
  ew2_type: string | null;
  type_guess: string | null;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rows: LabSheetRow[] }>();
/** The copy is not installed (or not reachable): stop asking for a while. */
let unavailableUntil = 0;
/** More candidates than this is not one cell's story; confirm only these. */
const MAX_CONFIRM = 8;

/** Rows holding any of `ids`, or null when the copy cannot be asked. */
async function rowsFor(rpc: string, ids: string[]): Promise<LabSheetRow[] | null> {
  try {
    const { data, error } = await supabase.rpc(rpc, { ids });
    if (error) {
      // Before the SQL is installed the function does not exist: quiet.
      unavailableUntil = Date.now() + CACHE_MS;
      if (error.code !== 'PGRST202') console.warn('[lab sheet] lookup failed:', error.message);
      return null;
    }
    return (data ?? []) as LabSheetRow[];
  } catch (e) {
    unavailableUntil = Date.now() + CACHE_MS;
    console.warn('[lab sheet] lookup failed:', e);
    return null;
  }
}

/** Keep the rows whose soma is in `segId` today. */
export async function confirmBySoma(
    segId: string, candidates: LabSheetRow[],
    rootOf: (supervoxel: string) => Promise<string | null> = getRootFromSupervoxel): Promise<LabSheetRow[]> {
  const some = candidates.slice(0, MAX_CONFIRM);
  const kept = await Promise.all(some.map(async r => {
    // No soma on the row: nothing to confirm with. Believe it only when it
    // is the one row the cell's history points to.
    if (!r.soma_supervoxel_id) return some.length === 1;
    return (await rootOf(r.soma_supervoxel_id)) === segId;
  }));
  return some.filter((_, i) => kept[i]);
}

/** The lab's sheet rows for this cell: usually one, empty when it has none,
 *  when this dataset has no such sheet, or when anything could not be read. */
export async function labSheetRowsFor(segId: string): Promise<LabSheetRow[]> {
  const rpc = getDatasetCaveConfig(currentSegLayerName()).labSheetRpc;
  if (!rpc || !/^\d+$/.test(segId) || Date.now() < unavailableUntil) return [];
  const key = `${rpc}:${segId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  let rows = await rowsFor(rpc, [segId]);
  if (rows === null) return [];
  if (!rows.length) {
    const history = await lineageIds(segId);
    if (!history) return [];              // not cached: try again next time
    const older = history.filter(id => id !== segId);
    const candidates = older.length ? await rowsFor(rpc, older) : [];
    if (candidates === null) return [];
    rows = candidates.length ? await confirmBySoma(segId, candidates) : [];
  }
  rows.sort((a, b) => a.sheet_index.localeCompare(b.sheet_index, undefined, { numeric: true }));
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

const CLASS_NAMES: Record<string, string> = {
  AC: 'Amacrine cell', RGC: 'Retinal ganglion cell', BC: 'Bipolar cell', HC: 'Horizontal cell',
};

/** The label and value lines the menu shows for one row. Only what the sheet
 *  says; a blank column is left out. */
export function labSheetLines(r: LabSheetRow): [string, string][] {
  const lines: [string, string][] = [];
  if (r.status) lines.push(['Status', r.status]);
  if (r.cell_class) lines.push(['Class', CLASS_NAMES[r.cell_class] ? `${CLASS_NAMES[r.cell_class]} (${r.cell_class})` : r.cell_class]);
  if (r.cell_type) lines.push(['Type', r.cell_type]);
  else if (r.cell_type_machine) {
    const sure = Number(r.cell_type_confidence);
    lines.push(['Predicted type', sure > 0 && sure <= 1 ? `${r.cell_type_machine} (${Math.round(sure * 100)}% sure)` : r.cell_type_machine]);
  } else if (r.type_guess && !/^unknown$/i.test(r.type_guess)) lines.push(['Proofreader guess', r.type_guess]);
  if (r.ew2_type) lines.push(['EW2 type', r.ew2_type]);
  return lines;
}
