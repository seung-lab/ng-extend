/**
 * retina-lab-sheet.mjs
 * --------------------------------------------------------------------
 * Reading the lab's retina sheet (the one where the retina proofreadings and
 * annotations live) into the rows of ew_retina_lab_sheet. Pure functions, no
 * network: scripts/sync-retina-lab-sheet.mjs does the fetching and writing,
 * scripts/retina-lab-sheet.test.mjs checks these.
 *
 * Columns are found by their header text, never by position, so a column the
 * lab inserts does not shift anything.
 *
 * WHAT IS COPIED is the list below and nothing else. The sheet also holds
 * proofreaders' names and free text notes; the mirror is readable by anyone,
 * so those stay out until Ames says players may see them. To add a column:
 * add it here, to supabase-retina-lab-sheet.sql, and to src/util/lab_sheet.ts.
 */

export const SHEET_ID = '1o4i53h92oyzsBc8jEWKmF8ZnfyXKXtFCTaYSecs8tBk';
export const SHEET_GID = '1690313708';
export const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

/** table column -> the sheet's header, exactly as written there. */
export const COLUMNS = {
  sheet_index: 'Index',
  soma_supervoxel_id: 'Soma SupervoxID',
  latest_seg_id: 'Latest SegID',
  proofread_seg_id: 'Proofread SegID',
  status: 'Status',
  cell_class: 'Cell Class',
  cell_type: 'Cell Type',
  cell_type_machine: 'Cell Type (machine)',
  cell_type_confidence: 'Confidence Cell Type (machine)',
  ew2_type: 'EW2 type',
  type_guess: 'Proofreader Cell Type Guess',
};
/** Without these the sheet is not the sheet we know: write nothing. */
const REQUIRED = ['sheet_index', 'soma_supervoxel_id', 'latest_seg_id', 'status'];
const ID_COLUMNS = ['soma_supervoxel_id', 'latest_seg_id', 'proofread_seg_id'];

/** Quote-aware CSV parser (cells hold commas and line breaks). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** An ID is digits only. "0", "-", and "7.20576E+17" (a number the sheet has
 *  already rounded) are not IDs and must never be matched against. */
function cleanId(v) {
  const s = String(v ?? '').trim();
  return /^\d{10,}$/.test(s) ? s : null;
}
function cleanText(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : null;
}

/**
 * CSV rows -> mirror rows. Throws when a required column is missing, so a
 * changed sheet stops the sync instead of emptying the table.
 */
export function extractRows(csvRows) {
  const headerAt = csvRows.slice(0, 10).findIndex(r => r.some(c => norm(c) === 'index'));
  if (headerAt < 0) throw new Error('No header row with an "Index" column in the first 10 rows');
  const header = csvRows[headerAt].map(norm);
  const at = {};
  for (const [col, title] of Object.entries(COLUMNS)) at[col] = header.indexOf(norm(title));
  const missing = REQUIRED.filter(c => at[c] < 0);
  if (missing.length) throw new Error(`Sheet is missing column(s): ${missing.map(c => COLUMNS[c]).join(', ')}`);

  const out = new Map();
  for (const r of csvRows.slice(headerAt + 1)) {
    const index = cleanText(r[at.sheet_index]);
    if (!index) continue;
    const row = {};
    for (const col of Object.keys(COLUMNS)) {
      const v = at[col] < 0 ? null : r[at[col]];
      row[col] = ID_COLUMNS.includes(col) ? cleanId(v) : cleanText(v);
    }
    // A row with no cell ID can never be matched to a cell on screen (the lab
    // adds numbered rows ahead of filling them in): not worth a table row.
    if (!row.latest_seg_id && !row.proofread_seg_id) continue;
    out.set(index, row);   // a repeated Index: the later row wins
  }
  return [...out.values()];
}

/** Do two mirror rows say the same thing? (synced_at aside) */
export function sameRow(a, b) {
  return Object.keys(COLUMNS).every(c => (a?.[c] ?? null) === (b?.[c] ?? null));
}

/** What the table needs to become the sheet: rows to write, indexes to drop. */
export function diffRows(sheetRows, tableRows) {
  const have = new Map(tableRows.map(r => [r.sheet_index, r]));
  const upserts = sheetRows.filter(r => !sameRow(r, have.get(r.sheet_index)));
  const keep = new Set(sheetRows.map(r => r.sheet_index));
  const removals = tableRows.map(r => r.sheet_index).filter(i => !keep.has(i));
  return { upserts, removals };
}
