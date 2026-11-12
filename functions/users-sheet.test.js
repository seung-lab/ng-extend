const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rows, stepOf, syncUsersSheet, readKept, readCanEdit, editList, HEADERS, USERS_SHEET_ID } = require('./users-sheet');
const col = (h) => HEADERS.indexOf(h);

const base = { user_id: null, name: null, username: null, request_id: null, asked_at: null, gave_email: null, ew_name: null, ew_rank: null, found_us: null, their_note: null,
  pilot_enabled: null, let_in_at: null, from_list: false, joined_at: null, tutorial_at: null, tutorials: 0, first_edit_at: null, last_edit_at: null, edits: 0, last_dataset: null,
  edits_30d: 0, cells: 0, cells_30d: 0, chats_30d: 0, help_asked: 0, help_answered_for: 0, help_given: 0 };
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('each person lands on the Access page\'s step', () => {
  assert.equal(stepOf({ ...base, request_id: 'r', asked_at: '2026-11-01' }), 'Asked');
  assert.equal(stepOf({ ...base, request_id: 'r', asked_at: '2026-11-01' }, { mark: 'removed', at: '2026-11-02' }), 'Removed or paused');
  assert.equal(stepOf({ ...base, request_id: 'r', asked_at: '2026-11-05' }, { mark: 'removed', at: '2026-11-02' }), 'Asked'); // asked again after
  assert.equal(stepOf({ ...base, pilot_enabled: true }), 'Let in');
  assert.equal(stepOf({ ...base, pilot_enabled: true, user_id: U }), 'Signed in');
  assert.equal(stepOf({ ...base, pilot_enabled: true, user_id: U, tutorial_at: 'x' }), 'Tutorial done');
  assert.equal(stepOf({ ...base, pilot_enabled: true, user_id: U, tutorial_at: 'x', edits: 3 }), 'Editing');
  assert.equal(stepOf({ ...base, pilot_enabled: false, user_id: U, edits: 3 }), 'Removed or paused');
  assert.equal(stepOf({ ...base, pilot_enabled: false, user_id: U, edits: 3, is_admin: true }), 'Admin');
  assert.equal(stepOf({ ...base, is_admin: true }), 'Admin');
});

test('rows: one per person, in step order, with CAVE IDs; test accounts left out; nothing a sheet would run', () => {
  const people = [
    { ...base, email: 'nik@x.org', name: 'Nik', pilot_enabled: true, user_id: U, tutorial_at: '2026-10-01T00:00:00Z', edits: 4210, edits_30d: 1880, last_dataset: 'stroeh_mouse_retina', help_given: 27, chats_30d: 12 },
    { ...base, email: 'ken@x.org', name: '=HYPERLINK("http://evil")', request_id: 'r', asked_at: '2026-11-01T12:00:00Z', ew_name: 'kmierow', their_note: 'line one\nline two' },
    { ...base, email: 'test@example.org', name: 'Test', request_id: 'r' },
  ];
  const r = rows(people, { [U]: 2815 });
  assert.equal(r.length, 2);
  assert.equal(r[0][col('Step')], 'Asked'); assert.equal(r[1][col('Step')], 'Editing');
  assert.equal(r[0][0], '\'=HYPERLINK("http://evil")');           // text, not a formula
  assert.equal(r[0][col('Asked')], '2026-11-01');
  assert.equal(r[0][col('Their note when they asked')], 'line one line two');
  assert.equal(r[1][col('CAVE ID')], '2815'); assert.equal(r[1][col('Last dataset')], 'EyeWire II (Retina)');
  assert.equal(r[1][col('Edits')], 4210); assert.equal(r[1][col('Edits, 30 days')], 1880); assert.equal(r[1][col('Help given')], 27); assert.equal(r[1][col('Chat messages, 30 days')], 12);
  for (const row of r) assert.equal(row.length, HEADERS.length);
});

test('a sync clears the Users tab, then writes headers, rows and when it ran', async () => {
  const calls = [];
  const io = {
    // pat@ was only emailed an invite (Ames 2026-11-12): off the sheet.
    sb: async (path) => (path.startsWith('access_hub_people') ? [{ ...base, email: 'a@x.org', name: 'A', pilot_enabled: true }, { ...base, email: 'pat@x.org', name: 'patew', pilot_enabled: null }] : [{ id: U, cave_user_id: 9 }]),
    api: async (path, init) => { calls.push({ path: decodeURIComponent(path), method: init.method, body: init.body }); return {}; },
  };
  const out = await syncUsersSheet(io, { now: new Date('2026-11-10T03:00:00Z') });
  assert.equal(out.people, 1);
  assert.equal(calls[0].method, 'GET');                       // the hand columns, read first
  assert.match(calls[1].path, new RegExp(`^${USERS_SHEET_ID}/values/'Users'!A1:AZ20000:clear$`));
  assert.equal(calls[2].method, 'PUT');
  const values = JSON.parse(calls[2].body).values;
  assert.deepEqual(values[0], HEADERS);
  assert.equal(values[1][1], 'a@x.org');
  assert.match(values[values.length - 1][0], /^Updated 2026-11-10 03:00 UTC by Pyr/);
});

// Celia 2026-11-10: hand columns for a known name and another email, and the
// datasets each player can edit.
test('the hand columns survive a rewrite, follow the person, and are never lost', async () => {
  const H = HEADERS;
  const old = [H, (() => { const r = H.map(() => ''); r[col('Email')] = 'A@x.org'; r[col('Known name')] = 'Anna Real'; r[col('Other email')] = 'anna@lab.edu'; r[col('Can edit')] = 'Retina'; return r; })(),
    (() => { const r = H.map(() => ''); r[col('Email')] = 'gone@x.org'; r[col('Known name')] = 'Gone But Typed'; return r; })(),
    [], ['Updated ... by Pyr']];
  const kept = readKept(old);
  assert.deepEqual(kept['a@x.org'], { known: 'Anna Real', other: 'anna@lab.edu', canEdit: 'Retina' });
  const calls = [];
  const io = {
    sb: async (path) => (path.startsWith('access_hub_people')
      ? [{ ...base, email: 'b@x.org', name: 'B', pilot_enabled: true }, { ...base, email: 'a@x.org', name: 'A', pilot_enabled: true, user_id: U }]
      : [{ id: U, cave_user_id: 9 }]),
    api: async (path, init) => { calls.push({ method: init.method, body: init.body }); return init.method === 'GET' ? { values: old } : {}; },
    cavePerms: async (cave) => (cave === 9 ? { permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'], HiMC: ['view'] }, permissions_v2_ignore_tos: { HiMC: ['edit'], fafb: ['view'] } } : null),
  };
  await syncUsersSheet(io, { now: new Date('2026-11-10T03:00:00Z') });
  const values = JSON.parse(calls.find(c => c.method === 'PUT').body).values;
  const a = values.find(r => r[col('Email')] === 'a@x.org');
  assert.equal(a[col('Known name')], 'Anna Real'); assert.equal(a[col('Other email')], 'anna@lab.edu');
  assert.equal(a[col('Can edit')], 'MEC, Retina');                 // from CAVE, both permission lists
  const gone = values.find(r => r[col('Email')] === 'gone@x.org');
  assert.equal(gone[col('Known name')], 'Gone But Typed'); assert.equal(gone[col('Step')], 'Not listed now');
  assert.ok(values.indexOf(gone) > values.indexOf(a));
  // CAVE down: the last value stays.
  calls.length = 0;
  await syncUsersSheet({ ...io, cavePerms: async () => null }, {});
  assert.equal(JSON.parse(calls.find(c => c.method === 'PUT').body).values.find(r => r[col('Email')] === 'a@x.org')[col('Can edit')], 'Retina');
  // The sheet can't be read: nothing is cleared.
  calls.length = 0;
  await assert.rejects(syncUsersSheet({ ...io, api: async (p, init) => { calls.push(init.method || 'POST'); if (init.method === 'GET') throw new Error('sheets 503'); return {}; } }, {}));
  assert.deepEqual(calls, ['GET']);
  assert.equal(editList(null), null);
  assert.equal(editList({ permissions_v2: { BANC: ['view'] } }), '');
  assert.equal(editList({ permissions_v2: { pinky100: ['edit'], FANC_sandbox: ['edit'], fafb_sandbox: ['edit'], fake_dataset_debug_chris: ['edit'], fafb: ['edit'] } }), 'FlyWire');
});

test('readCanEdit: the Can edit column by email, read only, blanks left out', async () => {
  const calls = [];
  const api = async (url, init) => { calls.push({ url, method: init.method });
    return { values: [HEADERS, (() => { const r = new Array(HEADERS.length).fill(''); r[1] = 'A@X.org'; r[HEADERS.indexOf('Can edit')] = 'MEC, Retina'; return r; })(),
      (() => { const r = new Array(HEADERS.length).fill(''); r[1] = 'b@x.org'; return r; })()] }; };
  const out = await readCanEdit({ api });
  assert.deepStrictEqual(out, { 'a@x.org': 'MEC, Retina' });
  assert.deepStrictEqual(calls.map(c => c.method), ['GET']);
});
