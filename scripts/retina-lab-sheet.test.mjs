// node --test scripts/retina-lab-sheet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, extractRows, diffRows, COLUMNS } from './retina-lab-sheet.mjs';

const HEADER = 'Index,Nuc Coords,Soma Coords,Soma SupervoxID,Latest SegID,Latest SegID Update Date: 2026-09-29,Proofreader Cell Type Guess,Proofreader 1,Status,Proofread SegID,Proofreading Notes,Cell Class,Cell Type,Cell Type (machine),Confidence Cell Type (machine),EW2 type';
const csv = (...lines) => [HEADER, ...lines].join('\n');

test('reads a row by header name', () => {
  const [r] = extractRows(parseCsv(csv(
    'A7,"63573, 49070, 1720","63537, 49048, 1697",80789847069331283,720575940572159335,,OFF-SAC,April Grace,Complete,720575940572159335,a note,AC,OFF SAC,OFF SAC,0.95,n13:7')));
  assert.deepEqual(r, {
    sheet_index: 'A7', soma_supervoxel_id: '80789847069331283', latest_seg_id: '720575940572159335',
    proofread_seg_id: '720575940572159335', status: 'Complete', cell_class: 'AC', cell_type: 'OFF SAC',
    cell_type_machine: 'OFF SAC', cell_type_confidence: '0.95', ew2_type: 'n13:7', type_guess: 'OFF-SAC',
  });
});

test('names and notes are never copied', () => {
  const [r] = extractRows(parseCsv(csv('A7,,,80789847069331283,720575940572159335,,x,April Grace,Complete,,a private note,AC,,,,')));
  const text = JSON.stringify(r);
  assert.ok(!text.includes('April Grace'));
  assert.ok(!text.includes('private note'));
  for (const title of Object.values(COLUMNS)) assert.ok(!/proofreader \d|notes|typer|updater/i.test(title), title);
});

test('"0", "-" and rounded numbers are not IDs', () => {
  const rows = extractRows(parseCsv(csv(
    'B1,,,0,-,,,,Complete,7.20576E+17,,,,,,',
    'B2,,,0,720575940561794892,,,,WIP,0,,,,,,')));
  assert.equal(rows.length, 1, 'B1 has no usable ID at all');
  assert.deepEqual([rows[0].soma_supervoxel_id, rows[0].latest_seg_id, rows[0].proofread_seg_id], [null, '720575940561794892', null]);
});

test('rows without an Index or without a cell ID are skipped; blanks become null', () => {
  const rows = extractRows(parseCsv(csv(
    ',,,1,720575940561794892,,,,Complete,,,,,,,', 'C3,,,,,,,,,,,,,,,', 'C4,,,80789847069331283,,,,,Complete,,,,,,,',
    'C5,,,,,,,,,720575940561794892,,,,,,')));
  assert.deepEqual(rows.map(r => r.sheet_index), ['C5']);
  assert.equal(rows[0].status, null);
});

test('a sheet without its key columns stops the sync', () => {
  assert.throws(() => extractRows(parseCsv('Index,Status\nA1,Complete')), /missing column/);
  assert.throws(() => extractRows(parseCsv('a,b\n1,2')), /No header row/);
});

test('diff writes only what changed and removes what left the sheet', () => {
  const sheet = extractRows(parseCsv(csv(
    'A1,,,,720575940561794892,,,,Complete,,,AC,,,,',
    'A2,,,,720575940561794893,,,,WIP,,,,,,,')));
  const table = [{ ...sheet[0] }, { ...sheet[1], status: 'Complete' }, { sheet_index: 'GONE', status: 'x' }];
  const { upserts, removals } = diffRows(sheet, table);
  assert.deepEqual(upserts.map(r => r.sheet_index), ['A2']);
  assert.deepEqual(removals, ['GONE']);
  assert.deepEqual(diffRows(sheet, sheet.map(r => ({ ...r, synced_at: 'x' }))), { upserts: [], removals: [] });
});

test('the sync script never writes to a sheet', () => {
  const src = readFileSync(new URL('./sync-retina-lab-sheet.mjs', import.meta.url), 'utf8')
    + readFileSync(new URL('./retina-lab-sheet.mjs', import.meta.url), 'utf8');
  assert.ok(!/sheets\.googleapis|script\.google\.com|values:(append|update|batchUpdate)/i.test(src));
  assert.equal((src.match(/docs\.google\.com/g) || []).length, 1, 'one Google URL: the CSV export');
});
