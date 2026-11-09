'use strict';
// The team's notes on a person, for the Access page (Celia 2026-11-09).
// Run: cd functions && node --test access-notes.test.js
const test = require('node:test');
const assert = require('node:assert');
const {handle} = require('./access-request');

function store() {
  const rows = [];
  let n = 0;
  return {
    rows,
    all: async () => { const out = {}; for (const r of rows) (out[r.key] = out[r.key] || []).push({id: r.id, text: r.text, by: r.by, at: r.at}); return out; },
    add: async (key, v) => { rows.push({id: 'n' + (++n), key, ...v}); },
    remove: async (key, id) => { const i = rows.findIndex(r => r.id === id && r.key === key); if (i >= 0) rows.splice(i, 1); },
  };
}
const admin = notes => ({isAdmin: true, notes, me: {display_name: 'Celia D'}, who: {email: 'celia@x.org'}});

test('admins add, read and take away notes, keyed by email', async () => {
  const notes = store();
  let all = await handle('access.note', {key: 'Ken@Example.org', text: '  Do we know him?  '}, admin(notes));
  assert.deepEqual(all['ken@example.org'].map(x => [x.text, x.by]), [['Do we know him?', 'Celia D']]);
  all = await handle('access.note', {key: 'user:0b6c3f1e-1111-4222-8333-444455556666', text: 'Asked twice'}, admin(notes));
  assert.equal(Object.keys(all).length, 2);
  assert.equal(notes.rows[0].byEmail, 'celia@x.org');
  all = await handle('access.noteDelete', {key: 'ken@example.org', id: 'n1'}, admin(notes));
  assert.equal(all['ken@example.org'], undefined);
});

test('players cannot read or write notes', async () => {
  const notes = store();
  for (const [action, args] of [['access.notes', {}], ['access.note', {key: 'a@b.org', text: 'x'}], ['access.noteDelete', {key: 'a@b.org', id: 'n1'}]]) {
    await assert.rejects(handle(action, args, {...admin(notes), isAdmin: false}), /Admins only/);
  }
  assert.equal(notes.rows.length, 0);
});

test('a note needs words, fits, and names a real person', async () => {
  const notes = store();
  await assert.rejects(handle('access.note', {key: 'a@b.org', text: '   '}, admin(notes)), /empty/);
  await assert.rejects(handle('access.note', {key: 'a@b.org', text: 'x'.repeat(1001)}, admin(notes)), /too long/);
  await assert.rejects(handle('access.note', {key: 'not an email', text: 'x'}, admin(notes)), /Unknown person/);
  await assert.rejects(handle('access.noteDelete', {key: 'a@b.org', id: '../x'}, admin(notes)), /Unknown note/);
  assert.equal(notes.rows.length, 0);
});
