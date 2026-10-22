'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { todoAction, slackIdOf, cleanFields } = require('./todos');

const AMES = { id: '11111111-1111-1111-1111-111111111111', name: 'Amy R. Sterling', email: 'amy@x.org' };
const CELIA = { id: '22222222-2222-2222-2222-222222222222', name: 'Celia D.', email: 'celia@x.org' };
const REPORT = '33333333-3333-3333-3333-333333333333';

function memDb() {
  const cards = new Map();
  const reports = {};
  let n = 0;
  return {
    cards: async () => [...cards.values()],
    card: async id => cards.get(id) || null,
    cardByReport: async id => [...cards.values()].find(c => c.triage_id === id) || null,
    maxRank: async list => Math.max(0, ...[...cards.values()].filter(c => c.list === list).map(c => c.rank)),
    insert: async row => { const id = `44444444-4444-4444-4444-${String(++n).padStart(12, '0')}`; const c = { id, comments: [], checklist: [], owner_id: null, ...row }; cards.set(id, c); return c; },
    patch: async (id, row) => { const c = { ...cards.get(id), ...row }; cards.set(id, c); return c; },
    remove: async id => { cards.delete(id); },
    people: async () => [AMES, CELIA],
    reportToTodo: async id => { reports[id] = 'todo'; },
    closeReport: async id => { reports[id] = 'done'; },
    reports,
  };
}
const ctx = (db, tags) => ({ db, me: { id: AMES.id }, byName: 'Ames', tag: async (who, card, what) => tags.push({ who: who.map(p => p.name), title: card.title, what }) });

test('a new card goes to the bottom of To do', async () => {
  const db = memDb(), tags = [];
  await todoAction('todo.save', { fields: { title: 'One' } }, ctx(db, tags));
  const { card } = await todoAction('todo.save', { fields: { title: 'Two', size: 'M' } }, ctx(db, tags));
  assert.equal(card.list, 'todo');
  assert.equal(card.rank, 2);
  assert.equal(card.size, 'M');
  assert.equal(card.created_by, 'Ames');
});

test('a title is needed and fields are checked', async () => {
  const db = memDb();
  await assert.rejects(todoAction('todo.save', { fields: { title: '  ' } }, ctx(db, [])), /title/);
  await assert.rejects(todoAction('todo.save', { fields: { title: 'x', size: 'XL' } }, ctx(db, [])), /size/);
  await assert.rejects(todoAction('todo.save', { fields: { title: 'x', list: 'later' } }, ctx(db, [])), /list/);
  assert.deepEqual(cleanFields({ title: 'x', created_by: 'someone', comments: [1] }, true), { title: 'x' });
});

test('only admins can be tagged, and never yourself', async () => {
  const db = memDb(), tags = [];
  await todoAction('todo.save', { fields: { title: 'Atlas page' }, tagIds: [CELIA.id, AMES.id, 'not-a-person'] }, ctx(db, tags));
  assert.deepEqual(tags, [{ who: ['Celia D.'], title: 'Atlas page', what: 'tagged you on' }]);
});

test('giving a card to someone tells them; giving it to yourself does not', async () => {
  const db = memDb(), tags = [];
  const { card } = await todoAction('todo.save', { fields: { title: 'A' } }, ctx(db, tags));
  await todoAction('todo.save', { id: card.id, fields: { owner_id: AMES.id } }, ctx(db, tags));
  assert.equal(tags.length, 0);
  await todoAction('todo.save', { id: card.id, fields: { owner_id: CELIA.id } }, ctx(db, tags));
  assert.deepEqual(tags.map(t => t.what), ['gave you']);
});

test('moving to Done stamps it, and can close the report behind it', async () => {
  const db = memDb();
  const { card } = await todoAction('todo.save', { fields: { title: '#158', triage_id: REPORT } }, ctx(db, []));
  assert.equal(db.reports[REPORT], 'todo');
  const { card: done } = await todoAction('todo.save', { id: card.id, fields: { list: 'done' }, closeReport: true }, ctx(db, []));
  assert.ok(done.done_at);
  assert.equal(db.reports[REPORT], 'done');
  const { card: back } = await todoAction('todo.save', { id: card.id, fields: { list: 'doing' } }, ctx(db, []));
  assert.equal(back.done_at, null);
});

test('comments are added, not replaced, and can tag', async () => {
  const db = memDb(), tags = [];
  const { card } = await todoAction('todo.save', { fields: { title: 'C' } }, ctx(db, tags));
  await todoAction('todo.comment', { id: card.id, text: 'first' }, ctx(db, tags));
  const { card: c2 } = await todoAction('todo.comment', { id: card.id, text: 'over to you', tagIds: [CELIA.id] }, ctx(db, tags));
  assert.deepEqual(c2.comments.map(c => c.text), ['first', 'over to you']);
  assert.equal(tags.length, 1);
});

test('a checklist keeps text and ticks only', async () => {
  const f = cleanFields({ checklist: [{ text: ' glia ', done: 1, extra: 'x' }, { text: '' }] }, false);
  assert.deepEqual(f.checklist, [{ text: 'glia', done: true }]);
});

test('Slack ids for the known admins', () => {
  assert.equal(slackIdOf({ name: 'Celia D.' }), 'U033NHWDE');
  assert.equal(slackIdOf({ name: 'Amy R. Sterling' }), 'U02FH1DRC');
  assert.equal(slackIdOf({ name: 'M Sorek' }), 'U033TSX9A');
  assert.equal(slackIdOf({ name: 'Someone New' }), null);
});

test('a report sent twice keeps one card, back in To do', async () => {
  const db = memDb();
  const { card } = await todoAction('todo.save', { fields: { title: '#158', triage_id: REPORT } }, ctx(db, []));
  await todoAction('todo.save', { id: card.id, fields: { list: 'done' } }, ctx(db, []));
  const { card: again } = await todoAction('todo.save', { fields: { title: '#158 again', triage_id: REPORT } }, ctx(db, []));
  assert.equal(again.id, card.id);
  assert.equal(again.list, 'todo');
  assert.equal((await db.cards()).length, 1);
});

test('links, a status line and a due date are optional and checked', () => {
  const f = cleanFields({ status: '  waiting   for Celia ', due_on: '2026-10-31',
    links: [{ kind: 'test', url: 'https://x-dot-brain-wire-dot-seung-lab.ue.r.appspot.com', label: '' }, { kind: 'weird', url: 'https://a.b/c', label: 'Spec' }] }, false);
  assert.equal(f.status, 'waiting for Celia');
  assert.equal(f.due_on, '2026-10-31');
  assert.deepEqual(f.links.map(l => l.kind), ['test', 'other']);
  assert.equal(cleanFields({ due_on: '' }, false).due_on, null);
  assert.throws(() => cleanFields({ due_on: 'Friday' }, false), /due date/);
  assert.throws(() => cleanFields({ links: [{ url: 'javascript:alert(1)' }] }, false), /https/);
  assert.throws(() => cleanFields({ links: [{ url: 'https://a b' }] }, false), /https/);
});

test('a new card given to someone else tells them; to yourself, nobody', async () => {
  const db = memDb(), tags = [];
  await todoAction('todo.save', { fields: { title: 'Mine', owner_id: AMES.id } }, ctx(db, tags));
  assert.equal(tags.length, 0);
  await todoAction('todo.save', { fields: { title: 'Hers', owner_id: CELIA.id } }, ctx(db, tags));
  assert.deepEqual(tags.map(t => [t.who[0], t.what]), [['Celia D.', 'gave you']]);
});

test('card images must be ones added on the board', () => {
  const ok = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads/todo-images/a/1.png';
  assert.deepEqual(cleanFields({ images: [ok] }, false).images, [ok]);
  assert.throws(() => cleanFields({ images: ['https://evil.example/1.png'] }, false), /added on the board/);
});
