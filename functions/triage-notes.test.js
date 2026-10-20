'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addNote } = require('./triage-notes');

const AMES = { id: '11111111-1111-1111-1111-111111111111', name: 'Amy R. Sterling' };
const CELIA = { id: '22222222-2222-2222-2222-222222222222', name: 'Celia D.' };
const ID = '99999999-0000-0000-0000-000000000178';

function setup(row = {}) {
  const store = { [ID]: { id: ID, source_excerpt: 'Can we have notes?', slack_ts: '123.456', slack_channel: 'C1', admin_notes: [], status: 'proposed', ...row } };
  const bells = [], posts = [];
  const deps = {
    db: { row: async id => store[id] || null, saveNotes: async (id, notes) => { store[id] = { ...store[id], admin_notes: notes }; }, people: async () => [AMES, CELIA] },
    me: { id: AMES.id }, byName: 'Ames', channel: 'CMAIN', site: 'https://site',
    bell: async rows => bells.push(...rows), slack: async (channel, thread, text) => posts.push({ channel, thread, text }),
  };
  return { store, bells, posts, deps };
}

test('a note is added and nothing else on the card changes', async () => {
  const { store, bells, posts, deps } = setup();
  const r = await addNote({ id: ID, text: 'Looked at this, it is the folder sort.' }, deps);
  assert.equal(r.admin_notes.length, 1);
  assert.equal(store[ID].admin_notes[0].by, 'Ames');
  assert.equal(store[ID].status, 'proposed');
  assert.equal(bells.length + posts.length, 0);
});

test('a tag rings the bell and pings in the report\'s own thread', async () => {
  const { bells, posts, deps } = setup();
  const r = await addNote({ id: ID, text: '@Celia can you check this one?' }, deps);
  assert.equal(r.tagged, 1);
  assert.equal(bells[0].target_id, CELIA.id);
  assert.deepEqual([posts[0].channel, posts[0].thread], ['C1', '123.456']);
  assert.match(posts[0].text, /<@U033NHWDE>/);
});

test('with no Slack thread the ping goes to the channel; tagging yourself pings nobody', async () => {
  const { posts, deps } = setup({ slack_ts: null });
  await addNote({ id: ID, text: '@Celia here' }, deps);
  assert.deepEqual([posts[0].channel, posts[0].thread], ['CMAIN', null]);
  await addNote({ id: ID, text: 'note to self @Amy' }, deps);
  assert.equal(posts.length, 1);
});

test('empty, too long, or unknown reports are refused', async () => {
  const { deps } = setup();
  await assert.rejects(addNote({ id: ID, text: '   ' }, deps), /Write something/);
  await assert.rejects(addNote({ id: ID, text: 'x'.repeat(2001) }, deps), /2000/);
  await assert.rejects(addNote({ id: '99999999-0000-0000-0000-000000000000', text: 'hi' }, deps), /gone/);
  await assert.rejects(addNote({ id: 'nope', text: 'hi' }, deps), /Bad report/);
});
