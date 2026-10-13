/**
 * What the lab's own sheet says about a Retina cell.
 *
 * On Retina the lab keeps a sheet of every cell's proofreading and
 * annotations (28,000 rows, 13 MB). Browsers never download it: a copy of a
 * few columns lives in Supabase (supabase-retina-lab-sheet.sql, filled hourly
 * by scripts/sync-retina-lab-sheet.mjs) and this asks it about the cells on
 * screen.
 *
 * READ ONLY. The game never writes to that sheet or to its copy.
 *
 * FOR SHOWING ONLY. The sheet fills in what a player sees: the Delta menu,
 * the coloured mark beside a cell and the label that stands in for its ID
 * (Ames 2026-10-12: "Lab sheet should FILL IN the delta menu"). It never
 * becomes the cell's saved status: nothing here is written to the game's
 * tables, and it must never reach a player's stats, the leaderboard or an
 * Achievement, which count only what was done in the game.
 *
 * Finding the row. A cell gets a new ID with every edit, and the sheet's IDs
 * are as of some past day, so:
 *   1. ask for rows holding this exact ID (the whole segment list in one
 *      small request; an unedited cell stops here);
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

const COLUMNS = 'sheet_index,soma_supervoxel_id,latest_seg_id,proofread_seg_id,status,cell_class,cell_type,cell_type_machine,cell_type_confidence,ew2_type,type_guess';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rows: LabSheetRow[] }>();
const inflight = new Map<string, Promise<LabSheetRow[]>>();
/** The copy is not installed (or not reachable): stop asking for a while. */
let unavailableUntil = 0;
/** More candidates than this is not one cell's story; confirm only these. */
const MAX_CONFIRM = 8;

function unavailable(what: unknown, quiet = false): null {
  unavailableUntil = Date.now() + CACHE_MS;
  if (!quiet) console.warn('[lab sheet] lookup failed:', what);
  return null;
}

// ── Step 1, batched ────────────────────────────────────────────────────────
// Every row of the segment list asks at once when a view loads, so the exact
// ID lookups of one moment travel together: one request for the whole list.
const BATCH_MS = 60, BATCH_MAX = 80;
type Waiter = (rows: LabSheetRow[] | null) => void;
const waiting = new Map<string, Waiter[]>();
let batchTable = '';
let batchTimer: ReturnType<typeof setTimeout> | null = null;

async function flushExact() {
  batchTimer = null;
  const table = batchTable;
  const ids = [...waiting.keys()].slice(0, BATCH_MAX);
  const waiters = ids.map(id => waiting.get(id)!);
  ids.forEach(id => waiting.delete(id));
  if (waiting.size) batchTimer = setTimeout(flushExact, 0);
  let rows: LabSheetRow[] | null = null;
  try {
    const list = ids.join(',');
    const { data, error } = await supabase.from(table).select(COLUMNS)
        .or(`latest_seg_id.in.(${list}),proofread_seg_id.in.(${list})`);
    // Before the SQL is installed the table does not exist: quiet.
    rows = error ? unavailable(error.message, /PGRST205|42P01/.test(error.code || ''))
                 : (data ?? []) as unknown as LabSheetRow[];
  } catch (e) { rows = unavailable(e); }
  ids.forEach((id, i) => {
    const mine = rows && rows.filter(r => r.latest_seg_id === id || r.proofread_seg_id === id);
    waiters[i].forEach(done => done(mine));
  });
}

/** Rows holding exactly this ID, or null when the copy cannot be asked. */
function exactRows(table: string, id: string): Promise<LabSheetRow[] | null> {
  return new Promise(done => {
    batchTable = table;
    waiting.set(id, [...(waiting.get(id) ?? []), done]);
    if (!batchTimer) batchTimer = setTimeout(flushExact, BATCH_MS);
  });
}

// ── Steps 2 and 3, a few at a time ─────────────────────────────────────────
// A cell's edit history is the costly request (the graph server walks every
// past edit), so a long segment list asks for two at a time, not all at once.
let historySlots = 2;
const historyQueue: (() => void)[] = [];
async function withHistorySlot<T>(work: () => Promise<T>): Promise<T> {
  if (historySlots > 0) historySlots--;
  else await new Promise<void>(go => historyQueue.push(go));
  try { return await work(); } finally {
    const next = historyQueue.shift();
    if (next) next(); else historySlots++;
  }
}

/** Rows holding any of `ids`, or null when the copy cannot be asked. */
async function rowsFor(rpc: string, ids: string[]): Promise<LabSheetRow[] | null> {
  try {
    const { data, error } = await supabase.rpc(rpc, { ids });
    if (error) return unavailable(error.message, error.code === 'PGRST202');
    return (data ?? []) as LabSheetRow[];
  } catch (e) { return unavailable(e); }
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
export function labSheetRowsFor(segId: string): Promise<LabSheetRow[]> {
  const cfg = getDatasetCaveConfig(currentSegLayerName());
  const table = cfg.labSheetTable, rpc = cfg.labSheetRpc;
  if (!table || !rpc || !/^\d+$/.test(segId) || Date.now() < unavailableUntil) return Promise.resolve([]);
  const key = `${table}:${segId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.rows);
  const running = inflight.get(key);
  if (running) return running;
  const lookup = (async () => {
    let rows = await exactRows(table, segId);
    if (rows === null) return [];
    if (!rows.length) {
      const found = await withHistorySlot(async () => {
        const history = await lineageIds(segId);
        if (!history) return null;            // not cached: try again next time
        const older = history.filter(id => id !== segId);
        const candidates = older.length ? await rowsFor(rpc, older) : [];
        if (candidates === null) return null;
        return candidates.length ? confirmBySoma(segId, candidates) : [];
      });
      if (found === null) return [];
      rows = found;
    }
    rows.sort((a, b) => a.sheet_index.localeCompare(b.sheet_index, undefined, { numeric: true }));
    cache.set(key, { at: Date.now(), rows });
    return rows;
  })().finally(() => inflight.delete(key));
  inflight.set(key, lookup);
  return lookup;
}

/**
 * What the sheet says in the game's own three words, for the menu, the
 * coloured mark beside a cell and the label that stands in for its ID:
 *   proofread  its Status is Complete or Complete (cut off)
 *   cellType   a Cell Type a person gave it (a machine's prediction or a
 *              proofreader's guess is not a type)
 *   cellClass  its Cell Class (AC, RGC, ...)
 * For SHOWING only. This never becomes the cell's saved status.
 */
export interface LabSheetSummary { proofread: boolean; cellType: string; cellClass: string }
export function labSheetSummary(rows: LabSheetRow[] | null | undefined): LabSheetSummary | null {
  if (!rows?.length) return null;
  const typed = rows.find(r => r.cell_type);
  const sum = {
    proofread: rows.some(r => /^complete\b/i.test(r.status || '')),
    cellType: typed?.cell_type || '',
    cellClass: (typed ?? rows.find(r => r.cell_class))?.cell_class || '',
  };
  return sum.proofread || sum.cellType || sum.cellClass ? sum : null;
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
