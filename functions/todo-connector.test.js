'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleConnector, tagIdsIn } = require('./todo-connector');
const { hashKey, todoAction } = require('./todos');

const AMES = { id: '11111111-1111-1111-1111-111111111111', name: 'Amy R. Sterling', email: 'amy@x.org' };
const CELIA = { id: '22222222-2222-2222-2222-222222222222', name: 'Celia D.', email: 'celia@x.org' };
const KEY = 'abcdefghijklmnopqrstuvwxyz012345';

function memDb() {
  const cards = new Map();
  const keys = [{ id: 'k1', user_id: CELIA.id, key_hash: hashKey(KEY), revoked_at: null, last_used_at: null }];
  let n = 0;
  return {
    cards: async () => [...cards.values()],
    card: async id => cards.get(id) || null,
    cardByReport: async () => null,
    maxRank: async list => Math.max(0, ...[...cards.values()].filter(c => c.list === list).map(c => c.rank)),
    insert: async row => { const id = `44444444-4444-4444-4444-${String(++n).padStart(12, '0')}`; const c = { id, comments: [], checklist: [], owner_id: null, notes: '', size: null, created_at: '2026-10-20T00:00:00Z', ...row }; cards.set(id, c); return c; },
    patch: async (id, row) => { const c = { ...cards.get(id), ...row }; cards.set(id, c); return c; },
    remove: async id => { cards.delete(id); },
    people: async () => [AMES, CELIA],
    reportToTodo: async () => {}, closeReport: async () => {},
    keyOwner: async hash => keys.find(k => k.key_hash === hash && !k.revoked_at) || null,
    keyUsed: async id => { keys.find(k => k.id === id).last_used_at = new Date().toISOString(); },
    activeKey: async userId => keys.find(k => k.user_id === userId && !k.revoked_at) || null,
    revokeKeys: async userId => { for (const k of keys) if (k.user_id === userId) k.revoked_at = 'now'; },
    addKey: async (userId, hash) => { keys.push({ id: 'k' + keys.length + 1, user_id: userId, key_hash: hash, revoked_at: null }); },
    keys,
  };
}
function setup() {
  const db = memDb(), tags = [];
  const deps = { db, makeCtx: me => ({ db, me, byName: `${me.name} (via AI)`, site: 'https://site',
    tag: async (who, card, what) => tags.push({ who: who.map(p => p.name), title: card.title, what }) }) };
  const rpc = (method, params, id = 1) => handleConnector('POST', KEY, { jsonrpc: '2.0', id, method, params }, deps);
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).body.result;
  return { db, tags, deps, rpc, call };
}

test('it says hello the MCP way and lists its tools, with no delete', async () => {
  const { rpc } = setup();
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.ok(init.body.result.capabilities.tools);
  const tools = (await rpc('tools/list', {})).body.result.tools.map(t => t.name);
  assert.ok(tools.includes('add_card') && tools.includes('comment'));
  assert.ok(!tools.some(t => /delete/.test(t)));
});

test('a notification is accepted with no answer', async () => {
  const { deps } = setup();
  const out = await handleConnector('POST', KEY, { jsonrpc: '2.0', method: 'notifications/initialized' }, deps);
  assert.equal(out.status, 202);
  assert.equal(out.body, null);
});

test('a wrong or switched off key, or someone no longer an admin, is turned away', async () => {
  const { deps, db } = setup();
  assert.equal((await handleConnector('POST', 'x'.repeat(32), { jsonrpc: '2.0', id: 1, method: 'ping' }, deps)).status, 404);
  assert.equal((await handleConnector('GET', KEY, null, deps)).status, 405);
  db.people = async () => [AMES];
  assert.equal((await handleConnector('POST', KEY, { jsonrpc: '2.0', id: 1, method: 'ping' }, deps)).status, 403);
  db.keys[0].revoked_at = 'now';
  assert.equal((await handleConnector('POST', KEY, { jsonrpc: '2.0', id: 1, method: 'ping' }, deps)).status, 404);
});

test('adding a card signs it "via AI", gives it an owner by first name and tags by first name', async () => {
  const { call, db, tags } = setup();
  const r = await call('add_card', { title: 'Atlas page', notes: 'For @Amy to check', owner: 'amy', size: 'M', checklist: ['boxes', 'purple'] });
  assert.match(r.content[0].text, /Added: - Atlas page/);
  const [card] = await db.cards();
  assert.equal(card.created_by, 'Celia D. (via AI)');
  assert.equal(card.owner_id, AMES.id);
  assert.equal(card.checklist.length, 2);
  assert.deepEqual(tags.map(t => t.what).sort(), ['gave you', 'tagged you on']);
});

test('cards are found by the start of their id; ticking and moving work', async () => {
  const { call, db } = setup();
  await call('add_card', { title: 'One', checklist: ['a', 'b'] });
  const [card] = await db.cards();
  const short = card.id.slice(0, 8);
  await call('checklist', { card: short, tick: 2 });
  assert.deepEqual((await db.card(card.id)).checklist.map(i => i.done), [false, true]);
  const bad = await call('checklist', { card: short, tick: 9 });
  assert.equal(bad.isError, true);
  await call('update_card', { card: short, list: 'Doing' });
  assert.equal((await db.card(card.id)).list, 'doing');
  const listed = (await call('list_cards', { list: 'Doing' })).content[0].text;
  assert.match(listed, /Doing \(1\)/);
});

test('a comment tags, and only new tags in notes ping again', async () => {
  const { call, db, tags } = setup();
  await call('add_card', { title: 'T', notes: '@Amy see this' });
  const [card] = await db.cards();
  tags.length = 0;
  await call('update_card', { card: card.id, notes: '@Amy see this, updated' });
  assert.equal(tags.length, 0);
  await call('comment', { card: card.id, text: 'done, @Amy' });
  assert.equal(tags.length, 1);
  assert.equal((await db.card(card.id)).comments[0].by, 'Celia D. (via AI)');
});

test('an unknown owner is explained, not guessed', async () => {
  const { call } = setup();
  const r = await call('add_card', { title: 'X', owner: 'Bob' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No admin matches "Bob"/);
});

test('tags match whole names and first names, not parts of words', () => {
  const people = [AMES, CELIA];
  assert.deepEqual(tagIdsIn('ask @celia', people), [CELIA.id]);
  assert.deepEqual(tagIdsIn('ask @Celia D. now', people), [CELIA.id]);
  assert.deepEqual(tagIdsIn('email celia@x.org', people), []);
  assert.deepEqual(tagIdsIn('@amyx', people), []);
});

test('a connector address: made once, the old one switched off', async () => {
  const { db } = setup();
  const me = { id: CELIA.id };
  const r = await todoAction('todo.key', {}, { db, me, byName: 'Celia', tag: async () => {}, connectorBase: 'https://fn' });
  assert.match(r.url, /^https:\/\/fn\/[A-Za-z0-9_-]{32}$/);
  assert.equal(db.keys.filter(k => !k.revoked_at).length, 1);
  assert.notEqual(db.keys.find(k => !k.revoked_at).key_hash, hashKey(KEY));
  const off = await todoAction('todo.key', { off: true }, { db, me, byName: 'Celia', tag: async () => {} });
  assert.equal(off.connected, false);
  assert.equal(db.keys.filter(k => !k.revoked_at).length, 0);
});

test('cards take a status, a due day and links; a test site is recognized', async () => {
  const { call, db } = setup();
  await call('add_card', { title: 'Proofreading Test', status: 'on the test site', due: '2026-10-31',
    links: [{ url: 'https://todo-board-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/?x' }] });
  const [card] = await db.cards();
  assert.equal(card.status, 'on the test site');
  assert.equal(card.due_on, '2026-10-31');
  assert.equal(card.links[0].kind, 'test');
  await call('link', { card: card.id, add: { url: 'https://github.com/seung-lab/ng-extend/pull/1', kind: 'pr' } });
  const text = (await call('get_card', { card: card.id })).content[0].text;
  assert.match(text, /Status: on the test site/);
  assert.match(text, /2\. Pull request: https:\/\/github.com/);
  await call('link', { card: card.id, remove: 1 });
  await call('update_card', { card: card.id, due: 'none', status: '' });
  const after = await db.card(card.id);
  assert.deepEqual([after.links.length, after.due_on, after.status], [1, null, '']);
});
