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

// Tags (Ames 2026-11-10: "if I leave a note here can it tag celia / Marissa?").
test('@Marissa or @celia in a note tags them: a bell and a Slack ping, never the writer', async () => {
  const notes = store();
  const PEOPLE = [{id: 'u-ames', name: 'amy', email: 'amyleerobinson@gmail.com'}, {id: 'u-celia', name: 'Celia D', email: 'celia@eyewire.org'}, {id: 'u-m', name: 'Marissa Sorek', email: 'm@eyewire.org'}];
  const bells = [], pings = [];
  const io = {...admin(notes), me: {id: 'u-celia', display_name: 'Celia D'}, people: async () => PEOPLE,
    notifyPeople: async b => { bells.push(b); }, slackPing: async (who, text, by) => { pings.push({who: who.map(p => p.id), text, by}); }};
  await handle('access.note', {key: 'rudometkin@gmail.com', name: 'Egor', text: 'Emailing him FlyWire and BANC. @Marissa @celia can you look?'}, io);
  assert.deepEqual(bells.map(b => b.ids), [['u-m']], 'Marissa only: Celia wrote it');
  assert.match(bells[0].title, /Celia D tagged you on the Access page/);
  assert.match(bells[0].body, /triage=access&person=rudometkin%40gmail\.com/);
  assert.match(bells[0].body, /Egor/);
  assert.deepEqual(pings.map(p => p.who), [['u-m']]);
  assert.match(pings[0].text, /Egor \(rudometkin@gmail\.com\)/);
  // No tag: nothing sent. A failing bell never loses the note.
  await handle('access.note', {key: 'a@b.org', text: 'email to a@b.org later'}, io);
  assert.equal(bells.length, 1);
  await handle('access.note', {key: 'a@b.org', text: '@marissa'}, {...io, notifyPeople: async () => { throw new Error('down'); }});
  assert.equal(notes.rows.length, 3);
});
