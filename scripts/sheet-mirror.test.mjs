// node --test scripts/sheet-mirror.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorChanges, sameMirrorRow } from './sheet-mirror.mjs';

const row = (id, o = {}) => ({ dataset: 'stroeh_mouse_retina', segment_id: id, status: 'Complete', proofreader: 'annkri', date_complete: '2026-10-20', cell_type: 'OFF SAC', ...o });

test('an unchanged sheet writes nothing', () => {
  const sheet = [row('1'), row('2', { status: null, proofreader: null, date_complete: null, cell_type: null })];
  const table = sheet.map(r => ({ ...r, synced_at: '2026-10-25T10:23:00Z' }));
  assert.deepEqual(mirrorChanges(sheet, table), { writes: [], added: 0, changed: 0, unchanged: 2 });
});

test('new rows and changed rows are written, the rest are not', () => {
  const table = [row('1'), row('2'), row('3')];
  const sheet = [row('1'), row('2', { status: 'WIP' }), row('3', { cell_type: 'ON SAC' }), row('4')];
  const { writes, added, changed, unchanged } = mirrorChanges(sheet, table);
  assert.deepEqual(writes.map(r => r.segment_id), ['2', '3', '4']);
  assert.deepEqual({ added, changed, unchanged }, { added: 1, changed: 2, unchanged: 1 });
});

test('the table reading back a date or a number does not count as a change', () => {
  assert.ok(sameMirrorRow(row('5'), { ...row('5'), date_complete: '2026-10-20T00:00:00+00:00' }));
  assert.ok(sameMirrorRow(row('5', { cell_type: '' }), { ...row('5'), cell_type: null }));
  const { writes } = mirrorChanges([row('720575940572159335')], [{ ...row('720575940572159335'), segment_id: 720575940572159335n.toString() }]);
  assert.equal(writes.length, 0);
});

test('a value cleared in the sheet is written', () => {
  const { writes } = mirrorChanges([row('6', { proofreader: null })], [row('6')]);
  assert.equal(writes.length, 1);
});

test('rows the sheet no longer lists are left alone', () => {
  const { writes, unchanged } = mirrorChanges([row('1')], [row('1'), row('9')]);
  assert.equal(writes.length, 0);
  assert.equal(unchanged, 1);
});
