/**
 * Which rows of ew_sheet_cells a run of `sync-sheet-cells.mjs --mirror`
 * needs to write. The mirror used to upsert every row of every sheet every
 * hour, each with a new synced_at, so Postgres rewrote tens of thousands of
 * unchanged rows an hour (2026-10-25: the database ran out of CPU). Now only
 * rows that are new, or whose sheet values changed, are written, and only
 * those get a new synced_at. Rows the sheet no longer lists are left alone,
 * as before.
 */

/** The sheet values the mirror keeps, beside dataset and segment_id. */
export const MIRROR_FIELDS = ['status', 'proofreader', 'date_complete', 'cell_type'];

/** The table's date column reads back as 'yyyy-mm-dd' (or a timestamp). */
const norm = (field, v) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  return field === 'date_complete' ? s.slice(0, 10) : s;
};

/** Does a table row already say what the sheet says? */
export function sameMirrorRow(sheetRow, tableRow) {
  if (!tableRow) return false;
  return MIRROR_FIELDS.every(f => norm(f, sheetRow[f]) === norm(f, tableRow[f]));
}

/**
 * The sheet's rows split into the ones to write and a count of the rest.
 * `sheetRows` and `tableRows` are for one dataset; rows match by segment_id.
 */
export function mirrorChanges(sheetRows, tableRows) {
  const have = new Map(tableRows.map(r => [String(r.segment_id), r]));
  const writes = [];
  let added = 0, changed = 0, unchanged = 0;
  for (const r of sheetRows) {
    const old = have.get(String(r.segment_id));
    if (!old) { added++; writes.push(r); }
    else if (!sameMirrorRow(r, old)) { changed++; writes.push(r); }
    else unchanged++;
  }
  return { writes, added, changed, unchanged };
}
