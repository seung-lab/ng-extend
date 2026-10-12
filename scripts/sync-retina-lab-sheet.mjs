#!/usr/bin/env node
/**
 * sync-retina-lab-sheet.mjs
 * --------------------------------------------------------------------
 * Hourly: copy what the lab's retina sheet says about each cell into the
 * Supabase table ew_retina_lab_sheet, which the Delta menu reads for the cell
 * it is open on (src/util/lab_sheet.ts). See supabase-retina-lab-sheet.sql.
 *
 * The sheet is READ ONLY here: one GET of its CSV export, nothing else. This
 * script has no code that writes to a sheet, and must not gain any.
 *
 * It touches no task, no completion and no player number: the mirror is
 * information shown in the menu, and nothing is counted from it.
 *
 * Only rows that changed are written, and rows that left the sheet are
 * removed, so an hour with no edits writes nothing.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/sync-retina-lab-sheet.mjs [--dry-run]
 */
import { CSV_URL, COLUMNS, parseCsv, extractRows, diffRows } from './retina-lab-sheet.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const TABLE = 'ew_retina_lab_sheet';
/** The sheet has 28,000 rows. Far fewer means a broken export, not a cleanup. */
const MIN_ROWS = 5000;

if (!dryRun && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const headers = {
  apikey: SUPABASE_KEY,
  ...(String(SUPABASE_KEY).startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
  'Content-Type': 'application/json',
};

/** Every row now in the table, or null when the table is not installed. */
async function tableRows() {
  const all = [];
  const select = Object.keys(COLUMNS).join(',');
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=${select}&order=sheet_index&limit=1000&offset=${offset}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`read ${TABLE} ${r.status}: ${await r.text()}`);
    const page = await r.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`sheet fetch ${res.status}`);
  const rows = extractRows(parseCsv(await res.text()));
  const withId = rows.filter(r => r.latest_seg_id || r.proofread_seg_id).length;
  console.log(`[retina sheet] ${rows.length} cells in the sheet, ${withId} with a cell ID`);
  if (rows.length < MIN_ROWS) throw new Error(`only ${rows.length} rows: refusing to sync from what looks like a broken export`);
  if (dryRun && (!SUPABASE_URL || !SUPABASE_KEY)) { console.log('[retina sheet] dry run without Supabase: nothing compared'); return; }

  const existing = await tableRows();
  if (existing === null) {
    console.log(`[retina sheet] ${TABLE} does not exist yet (run supabase-retina-lab-sheet.sql). Nothing written.`);
    return;
  }
  const { upserts, removals } = diffRows(rows, existing);
  console.log(`[retina sheet] table has ${existing.length}; ${upserts.length} to write, ${removals.length} to remove`);
  if (dryRun) return;

  const now = new Date().toISOString();
  for (let i = 0; i < upserts.length; i += 500) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=sheet_index`, {
      method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(upserts.slice(i, i + 500).map(row => ({ ...row, synced_at: now }))),
    });
    if (!r.ok) throw new Error(`write ${TABLE} ${r.status}: ${await r.text()}`);
  }
  for (let i = 0; i < removals.length; i += 100) {
    const list = removals.slice(i, i + 100).map(x => `"${x.replace(/["\\]/g, '\\$&')}"`).join(',');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?sheet_index=in.(${encodeURIComponent(list)})`, {
      method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' },
    });
    if (!r.ok) throw new Error(`remove from ${TABLE} ${r.status}: ${await r.text()}`);
  }
  console.log('[retina sheet] done');
}

main().catch(e => { console.error('[retina sheet] failed:', e.message); process.exit(1); });
