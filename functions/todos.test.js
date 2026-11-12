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

// Subtasks, followers (Ames 2026-11-02, from Asana).
function memFollows() { const m = {}; return { m, all: async () => ({ ...m }), get: async id => m[id] || [], set: async (id, ids) => { m[id] = ids; } }; }
test('a checklist item keeps its own owner and due day', () => {
  const f = cleanFields({ checklist: [{ text: 'Write it', done: false, due: '2026-11-10', owner_id: CELIA.id }, { text: 'Plain', done: true }] }, false);
  assert.deepEqual(f.checklist, [{ text: 'Write it', done: false, due: '2026-11-10', owner_id: CELIA.id }, { text: 'Plain', done: true }]);
  assert.throws(() => cleanFields({ checklist: [{ text: 'x', due: 'soon' }] }, false), /due date/);
});
test('the maker follows; a follower hears of changes, never of their own', async () => {
  const db = memDb(), follows = memFollows(), told = [];
  const bell = async (ids, card, what) => told.push({ ids, what });
  const base = { db, byName: 'Ames', tag: async () => {}, follows, bell };
  const { card } = await todoAction('todo.save', { fields: { title: 'Ship it' } }, { ...base, me: { id: AMES.id } });
  assert.deepEqual(follows.m[card.id], [AMES.id]);
  await todoAction('todo.follow', { id: card.id }, { ...base, me: { id: CELIA.id } });
  assert.deepEqual(follows.m[card.id], [AMES.id, CELIA.id]);
  await todoAction('todo.save', { id: card.id, fields: { list: 'done' } }, { ...base, me: { id: AMES.id } });
  assert.deepEqual(told, [{ ids: [CELIA.id], what: 'finished' }]);
  await todoAction('todo.save', { id: card.id, fields: { rank: 3 } }, { ...base, me: { id: AMES.id } });
  assert.equal(told.length, 1, 'a drag in the list tells nobody');
  await todoAction('todo.comment', { id: card.id, text: 'nice' }, { ...base, me: { id: CELIA.id } });
  assert.equal(told.length, 1, 'a comment tells followers nothing; only Done does');
  await todoAction('todo.save', { id: card.id, fields: { list: 'doing' } }, { ...base, me: { id: CELIA.id } });
  assert.equal(told.length, 1, 'a move to Doing tells followers nothing');
  await todoAction('todo.follow', { id: card.id, on: false }, { ...base, me: { id: CELIA.id } });
  assert.deepEqual(follows.m[card.id], [AMES.id]);
  const list = await todoAction('todo.list', {}, { ...base, me: { id: AMES.id } });
  assert.deepEqual(list.followers[card.id], [AMES.id]);
});

test('opening a card marks it seen, for me only, and the list says when', async () => {
  const db = memDb(), m = {};
  const seen = { get: async (me) => ({ ...(m[me] || {}) }), mark: async (me, id, at) => { m[me] = { ...(m[me] || {}), [id]: at }; } };
  const base = { db, byName: 'Ames', tag: async () => {}, seen };
  const { card } = await todoAction('todo.save', { fields: { title: 'Look' } }, { ...base, me: { id: AMES.id } });
  const r = await todoAction('todo.seen', { id: card.id }, { ...base, me: { id: AMES.id } });
  assert.equal(m[AMES.id][card.id], r.at);
  assert.equal((await todoAction('todo.list', {}, { ...base, me: { id: AMES.id } })).seen[card.id], r.at);
  assert.deepEqual((await todoAction('todo.list', {}, { ...base, me: { id: CELIA.id } })).seen, {});
  await assert.rejects(todoAction('todo.seen', { id: 'nope' }, { ...base, me: { id: AMES.id } }));
});

test('a nickname tags too: @Marissa reaches M Sorek', () => {
  const { tagIdsIn } = require('./todo-connector');
  const MARISSA = { id: '55555555-5555-5555-5555-555555555555', name: 'M Sorek' };
  const people = [AMES, CELIA, MARISSA];
  assert.deepEqual(tagIdsIn('@Marissa can you look?', people), [MARISSA.id]);
  assert.deepEqual(tagIdsIn('thanks @ames and @celia', people), [AMES.id, CELIA.id]);
  assert.deepEqual(tagIdsIn('email marissa@x.org, no tag', people), []);
  assert.deepEqual(tagIdsIn('@Marissanne is someone else', people), []);
});

test('a comment can be changed by its writer, and its first wording is kept', async () => {
  const db = memDb();
  const base = { db, tag: async () => {} };
  const { card } = await todoAction('todo.save', { fields: { title: 'x' } }, { ...base, me: { id: AMES.id }, byName: 'Ames' });
  await todoAction('todo.comment', { id: card.id, text: 'first try' }, { ...base, me: { id: AMES.id }, byName: 'Ames' });
  const r1 = await todoAction('todo.commentEdit', { id: card.id, index: 0, text: 'second try' }, { ...base, me: { id: AMES.id }, byName: 'Ames' });
  assert.equal(r1.card.comments[0].text, 'second try');
  assert.equal(r1.card.comments[0].original, 'first try');
  const r2 = await todoAction('todo.commentEdit', { id: card.id, index: 0, text: 'third try' }, { ...base, me: { id: AMES.id }, byName: 'Ames' });
  assert.equal(r2.card.comments[0].original, 'first try', 'the first wording stays the original');
  await assert.rejects(todoAction('todo.commentEdit', { id: card.id, index: 0, text: 'mine now' }, { ...base, me: { id: CELIA.id }, byName: 'Celia' }), /Only the person/);
});

test('a reaction on a comment: one of the six, the same again takes it away', async () => {
  const db = memDb();
  const as = (who, name) => ({ db, byName: name, me: { id: who.id }, tag: async () => {} });
  const { card } = await todoAction('todo.save', { fields: { title: 'Thumbs' } }, as(CELIA, 'Celia D.'));
  const c1 = await todoAction('todo.comment', { id: card.id, text: 'the email draft' }, as(CELIA, 'Celia D.'));
  const at = c1.card.comments[0].at;
  const r = await todoAction('todo.react', { id: card.id, index: 0, at, emoji: '👍' }, as(AMES, 'Amy R. Sterling'));
  assert.deepEqual(r.card.comments[0].reactions.map(x => [x.emoji, x.by]), [['👍', 'Amy R. Sterling']]);
  assert.equal(r.card.comments[0].text, 'the email draft');
  const off = await todoAction('todo.react', { id: card.id, index: 0, at, emoji: '👍' }, as(AMES, 'Amy R. Sterling'));
  assert.deepEqual(off.card.comments[0].reactions, []);
  await assert.rejects(todoAction('todo.react', { id: card.id, index: 0, at, emoji: '💩' }, as(AMES, 'Amy R. Sterling')), /Pick one/);
  await assert.rejects(todoAction('todo.react', { id: card.id, index: 0, at: 'x', emoji: '👍' }, as(AMES, 'Amy R. Sterling')), /moved/);
});

test('a card can have collaborators: they hear, and they follow it', async () => {
  const db = memDb(), follows = memFollows(), helpers = memFollows(), tags = [];
  const base = { db, byName: 'Ames', tag: async (who, card, what) => tags.push({ who: who.map(p => p.name), what }), follows, helpers, me: { id: AMES.id } };
  const { card } = await todoAction('todo.save', { fields: { title: 'Two of us' } }, base);
  const r = await todoAction('todo.helpers', { id: card.id, ids: [CELIA.id] }, base);
  assert.deepEqual(r.helpers, [CELIA.id]);
  assert.deepEqual(tags.at(-1), { who: ['Celia D.'], what: 'added you as a collaborator on' });
  assert.ok(follows.m[card.id].includes(CELIA.id));
  const n = tags.length;
  await todoAction('todo.helpers', { id: card.id, ids: [CELIA.id] }, base);
  assert.equal(tags.length, n, 'nobody is told twice');
  await assert.rejects(todoAction('todo.helpers', { id: card.id, ids: ['99999999-9999-9999-9999-999999999999'] }, base), /must be an admin/);
  assert.deepEqual((await todoAction('todo.list', {}, base)).helpers[card.id], [CELIA.id]);
});

test('whoever finishes a card they do not own joins its collaborators; the owner does not', async () => {
  const db = memDb(), follows = memFollows(), helpers = memFollows(), tags = [];
  const as = (who) => ({ db, byName: who.name, tag: async () => {}, follows, helpers, me: { id: who.id } });
  const { card } = await todoAction('todo.save', { fields: { title: 'Celia owns it', owner_id: CELIA.id } }, as(CELIA));
  await todoAction('todo.save', { id: card.id, fields: { list: 'done' } }, as(AMES));
  assert.deepEqual(helpers.m[card.id], [AMES.id]);
  await todoAction('todo.save', { id: card.id, fields: { list: 'todo' } }, as(AMES));
  await todoAction('todo.save', { id: card.id, fields: { list: 'done' } }, as(AMES));
  assert.deepEqual(helpers.m[card.id], [AMES.id], 'added once');
  const two = (await todoAction('todo.save', { fields: { title: 'Mine', owner_id: CELIA.id } }, as(CELIA))).card;
  await todoAction('todo.save', { id: two.id, fields: { list: 'done' } }, as(CELIA));
  assert.deepEqual(helpers.m[two.id] || [], [], 'the owner is not a collaborator');
});

test('a reply joins its thread, one level deep, and its writer hears', async () => {
  const db = memDb(), tags = [];
  const ctxOf = (who, name) => ({ db, byName: name, me: { id: who.id }, tag: async (w, card, what) => tags.push({ who: w.map(p => p.name), what }) });
  const { card } = await todoAction('todo.save', { fields: { title: 'Thread' } }, ctxOf(AMES, 'Amy R. Sterling'));
  const c1 = await todoAction('todo.comment', { id: card.id, text: 'first' }, ctxOf(AMES, 'Amy R. Sterling'));
  const rootAt = c1.card.comments[0].at;
  await new Promise(r => setTimeout(r, 5));
  const c2 = await todoAction('todo.comment', { id: card.id, text: 'an answer', replyTo: rootAt }, ctxOf(CELIA, 'Celia D.'));
  assert.equal(c2.card.comments[1].reply_to, rootAt);
  assert.deepEqual(tags.at(-1), { who: ['Amy R. Sterling'], what: 'replied to you on' });
  await new Promise(r => setTimeout(r, 5));
  const c3 = await todoAction('todo.comment', { id: card.id, text: 'and back', replyTo: c2.card.comments[1].at }, ctxOf(AMES, 'Amy R. Sterling'));
  assert.equal(c3.card.comments[2].reply_to, rootAt, 'a reply to a reply stays in the same thread');
  assert.deepEqual(tags.at(-1), { who: ['Celia D.'], what: 'replied to you on' });
  await assert.rejects(todoAction('todo.comment', { id: card.id, text: 'x', replyTo: '1999-01-01T00:00:00Z' }, ctxOf(AMES, 'Amy R. Sterling')), /gone/);
});

// ── Hierarchy (Ames 2026-11-11): cards inside cards, sections of a column, nested checklist items ──
function withSections(db) {
  const secs = new Map(); let k = 0;
  return Object.assign(db, {
    children: async id => [...(await db.cards())].filter(c => c.parent_id === id),
    sections: async () => [...secs.values()],
    section: async id => secs.get(id) || null,
    insertSection: async row => { const id = `55555555-5555-4555-8555-${String(++k).padStart(12, '0')}`; const s = { id, ...row }; secs.set(id, s); return s; },
    patchSection: async (id, row) => { const s = { ...secs.get(id), ...row }; secs.set(id, s); return s; },
    removeSection: async id => { secs.delete(id); for (const c of await db.cards()) if (c.section_id === id) await db.patch(c.id, { section_id: null }); },
  });
}
test('a card goes inside another, one level deep, never inside itself', async () => {
  const db = withSections(memDb()), tags = [];
  const save = (args) => todoAction('todo.save', args, ctx(db, tags));
  const parent = (await save({ fields: { title: 'Tutorials' } })).card;
  const kid = (await save({ fields: { title: 'Cut examples', parent_id: parent.id } })).card;
  assert.equal(kid.parent_id, parent.id);
  const other = (await save({ fields: { title: 'Other' } })).card;
  await assert.rejects(save({ id: other.id, fields: { parent_id: kid.id } }), /already inside another card/);
  await assert.rejects(save({ id: parent.id, fields: { parent_id: other.id } }), /has sub cards of its own/);
  await assert.rejects(save({ id: other.id, fields: { parent_id: other.id } }), /inside itself/);
  assert.equal((await save({ id: kid.id, fields: { parent_id: null } })).card.parent_id, null, 'taken back out');
});
test('sections: added, renamed, a card in one, and it leaves when the card changes column', async () => {
  const db = withSections(memDb()), tags = [];
  const act = (a, args) => todoAction(a, args, ctx(db, tags));
  const sec = (await act('todo.section', { list: 'todo', name: '  Tutorial  ' })).section;
  assert.deepEqual([sec.name, sec.list, sec.rank], ['Tutorial', 'todo', 1]);
  assert.equal((await act('todo.section', { list: 'todo', name: 'Cilia' })).section.rank, 2);
  assert.equal((await act('todo.section', { id: sec.id, name: 'Tutorials' })).section.name, 'Tutorials');
  const c = (await act('todo.save', { fields: { title: 'x', section_id: sec.id } })).card;
  assert.equal(c.section_id, sec.id);
  await assert.rejects(act('todo.save', { id: c.id, fields: { list: 'doing', section_id: sec.id } }), /another column/);
  assert.equal((await act('todo.save', { id: c.id, fields: { list: 'doing' } })).card.section_id, null);
  assert.ok((await act('todo.list', {})).sections.length === 2);
  await act('todo.section', { id: sec.id, remove: true });
  assert.equal((await act('todo.list', {})).sections.length, 1);
  await assert.rejects(act('todo.section', { list: 'todo', name: '   ' }), /needs a name/);
});
test('checklist items keep their level, two in at most', async () => {
  const db = withSections(memDb()), tags = [];
  const c = (await todoAction('todo.save', { fields: { title: 'x', checklist: [{ text: 'a' }, { text: 'b', level: 1 }, { text: 'c', level: 7 }, { text: 'd', level: 'x' }] } }, ctx(db, tags))).card;
  assert.deepEqual(c.checklist.map(i => i.level || 0), [0, 1, 2, 0]);
});

test('only Ames closes a card as not finished, and only she reopens it (Ames 2026-11-12)', async () => {
  const db = memDb(), tags = [];
  const as = owner => (a, args) => todoAction(a, args, { ...ctx(db, tags), isOwner: owner });
  const c = (await as(false)('todo.save', { fields: { title: 'Unfinished thing' } })).card;
  await assert.rejects(as(false)('todo.save', { id: c.id, fields: { list: 'incomplete' } }), /Only Ames/);
  await assert.rejects(as(true)('todo.save', { fields: { title: 'x', list: 'incomplete' } }), /Only Ames/);
  const closed = (await as(true)('todo.save', { id: c.id, fields: { list: 'incomplete' } })).card;
  assert.equal(closed.list, 'incomplete');
  assert.ok(closed.done_at, 'when it was closed');
  await assert.rejects(as(false)('todo.save', { id: c.id, fields: { title: 'renamed' } }), /Only Ames reopens/);
  const back = (await as(true)('todo.save', { id: c.id, fields: { list: 'todo' } })).card;
  assert.deepEqual([back.list, back.done_at], ['todo', null]);
});
