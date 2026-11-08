'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addIssue, consoleSummary, readInput, HEADERS } = require('./mec-issues');

const TRIAGE = '33333333-3333-3333-3333-333333333333';
const ISSUE = {
  id: 'abc', user_id: '44444444-4444-4444-4444-444444444444', user_name: 'Nseraf', title: 'cut bug in MEC',
  message: '"Cut won\'t submit even after F5 https://imgur.com/a/FTrzijQ"', url: 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/1',
  screenshot_url: null, created_at: '2026-11-07T02:28:10.000Z',
  console_log: [
    '02:27:01 ERROR [pcg] lineage_graph 500 https://hc.himc-cave.com/segmentation/api/v1/table/pni_mec/root/720575947460909334/lineage_graph?x=1',
    '02:27:02 ERROR [pcg] lineage_graph 500 https://hc.himc-cave.com/segmentation/api/v1/table/pni_mec/root/720575947460909999/lineage_graph?x=1',
    '02:27:03 WARN something mild',
    '02:27:04 ERROR TypeError: Cannot read properties of undefined',
  ].join('\n'),
};

function fake({ sheet = [HEADERS], edits = [] } = {}) {
  const calls = [], bells = [];
  return {
    calls, bells,
    bell: async (row) => { bells.push(row); },
    sb: async (path) => {
      calls.push(['sb', path]);
      if (path.startsWith('feedback_triage')) return [{ id: TRIAGE, source: 'site_issue', source_id: 'abc' }];
      if (path.startsWith('site_issues')) return [ISSUE];
      if (path.startsWith('edit_log')) return edits;
      return [];
    },
    api: async (path, init) => {
      calls.push(['api', path, init]);
      if (path.endsWith('?fields=sheets.properties(sheetId,title,index)')) return { sheets: [{ properties: { sheetId: 0, title: 'Untitled', index: 0 } }] };
      if (path.includes(encodeURIComponent("'Untitled'!A1:A5000"))) return { values: sheet.map(r => [r[0]]) };
      if (path.includes(':append')) return { updates: { updatedRange: `'Untitled'!A${sheet.length + 1}:N${sheet.length + 1}` } };
      throw new Error('unexpected ' + path);
    },
  };
}

test('adds the report as one row in the sheet\'s columns', async () => {
  const io = fake({ edits: [{ operation: 'split', metadata: { operation_id: 145300 }, created_at: '2026-11-07T02:20:05.000Z' }] });
  const out = await addIssue({ triageId: TRIAGE, number: 419, segments: ['720575947460909334', '!720575947460909078', 'junk'], at: [155113.4, 134396, 7743] }, io);
  assert.deepEqual(out, { row: 2, already: false, notified: true });
  const [bell] = io.bells;
  assert.equal(io.bells.length, 1);
  assert.equal(bell.target_type, 'user');
  assert.equal(bell.target_id, ISSUE.user_id);
  assert.equal(bell.body, 'Your triage #419 about "cut bug in MEC" has been added to the MEC known segment error report. Thank you for reporting it.');
  const append = io.calls.find(c => c[0] === 'api' && c[1].includes(':append'));
  const [row] = JSON.parse(append[2].body).values;
  assert.equal(row.length, HEADERS.length);
  assert.equal(row[0], '419');
  assert.equal(row[1], '2026-11-07 02:28');
  assert.equal(row[2], 'Nseraf');
  assert.equal(row[3], 'cut bug in MEC: Cut won\'t submit even after F5');
  assert.equal(row[4], '720575947460909334, 720575947460909078');
  assert.match(row[5], /^split 145300 \(02:20:05\)/);
  assert.deepEqual(row.slice(6, 9), ['155113', '134396', '7743']);
  assert.equal(row[9], 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/?at=155113%2C134396%2C7743&ds=pni_mec');
  assert.equal(row[10], ISSUE.url);
  assert.equal(row[11], 'https://imgur.com/a/FTrzijQ');
  assert.equal(row[12], '[pcg] lineage_graph 500 lineage_graph (2 times); TypeError: Cannot read properties of undefined (once)');
  assert.equal(row[13], 'Open');
  // The edit log is asked about this player, in MEC, in the hour before.
  const ask = io.calls.find(c => c[0] === 'sb' && c[1].startsWith('edit_log'))[1];
  assert.match(ask, /user_id=eq\.44444444/);
  assert.match(ask, /dataset=eq\.pni_mec/);
});

test('a report already on the sheet is not added twice', async () => {
  const io = fake({ sheet: [HEADERS, ['302'], ['419']] });
  assert.deepEqual(await addIssue({ triageId: TRIAGE, number: 419 }, io), { row: 3, already: true });
  assert.equal(io.bells.length, 0);  // and the player is not told twice
  assert.ok(!io.calls.some(c => c[0] === 'api' && c[1].includes(':append')));
});

test('no view numbers: the row says to open the view', async () => {
  const io = fake();
  await addIssue({ triageId: TRIAGE, number: 7 }, io);
  const [row] = JSON.parse(io.calls.find(c => c[1].includes(':append'))[2].body).values;
  assert.equal(row[4], 'not given: open the view to read them');
  assert.deepEqual(row.slice(5, 10), ['', '', '', '', '']);
});

test('a sheet whose columns moved is refused, not written into', async () => {
  const io = fake({ sheet: [['Something else']] });
  await assert.rejects(addIssue({ triageId: TRIAGE, number: 7 }, io), /Triage #/);
});

test('input is checked', () => {
  assert.throws(() => readInput({ triageId: 'x', number: 1 }), /bad report id/);
  assert.throws(() => readInput({ triageId: TRIAGE, number: 0 }), /bad report number/);
  assert.equal(readInput({ triageId: TRIAGE, number: 3, at: [1, 2] }).at, null);
});

test('console summary', () => {
  assert.equal(consoleSummary(''), '');
  assert.equal(consoleSummary('01:00:00 WARN x'), 'no errors');
});
