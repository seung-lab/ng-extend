const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rows, stepOf, syncUsersSheet, HEADERS, USERS_SHEET_ID } = require('./users-sheet');

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
  assert.equal(r[0][2], 'Asked'); assert.equal(r[1][2], 'Editing');
  assert.equal(r[0][0], '\'=HYPERLINK("http://evil")');           // text, not a formula
  assert.equal(r[0][7], '2026-11-01');
  assert.equal(r[0][25], 'line one line two');
  assert.equal(r[1][6], '2815'); assert.equal(r[1][14], 'EyeWire II (Retina)');
  assert.equal(r[1][15], 4210); assert.equal(r[1][16], 1880); assert.equal(r[1][21], 27); assert.equal(r[1][22], 12);
  for (const row of r) assert.equal(row.length, HEADERS.length);
});

test('a sync clears the Users tab, then writes headers, rows and when it ran', async () => {
  const calls = [];
  const io = {
    sb: async (path) => (path.startsWith('access_hub_people') ? [{ ...base, email: 'a@x.org', name: 'A', pilot_enabled: true }] : [{ id: U, cave_user_id: 9 }]),
    api: async (path, init) => { calls.push({ path: decodeURIComponent(path), method: init.method, body: init.body }); return {}; },
  };
  const out = await syncUsersSheet(io, { now: new Date('2026-11-10T03:00:00Z') });
  assert.equal(out.people, 1);
  assert.match(calls[0].path, new RegExp(`^${USERS_SHEET_ID}/values/'Users'!A1:AZ20000:clear$`));
  assert.equal(calls[1].method, 'PUT');
  const values = JSON.parse(calls[1].body).values;
  assert.deepEqual(values[0], HEADERS);
  assert.equal(values[1][1], 'a@x.org');
  assert.match(values[values.length - 1][0], /^Updated 2026-11-10 03:00 UTC by Pyr/);
});
