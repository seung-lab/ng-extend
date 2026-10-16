'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {handle} = require('./access-request');

const U = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const sam = {id: U(2), display_name: 'Sam'}, celia = {id: U(3), username: 'celiad'};

/** A small stand-in for the PostgREST helper: the shapes access-request.js uses. */
function world({installed = true} = {}) {
  const state = {access_requests: [], access_request_items: [], pilot_members: [], told: [], slack: [], players: []};
  let nextId = 1;
  const match = (r, q) => [...q].every(([k, v]) => {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
    if (v === 'is.null') return r[k] == null;
    throw new Error('filter ' + v);
  });
  const sb = async (path, init = {}) => {
    const [table, qs = ''] = path.split('?');
    if (!installed && table.startsWith('access_')) throw new Error('supabase 404');
    const q = new URLSearchParams(qs), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    const rows = state[table];
    if (method === 'POST') {
      const conflict = q.get('on_conflict');
      if (conflict) {
        const keys = conflict.split(',');
        const hit = rows.find(r => keys.every(k => String(r[k]) === String(body[k])));
        if (hit) { Object.assign(hit, body); return [{...hit}]; }
      }
      const row = {id: nextId++, status: 'draft', tries: 0, verdict: null, point_marks: {}, ...body};
      rows.push(row); return [{...row}];
    }
    const hits = rows.filter(r => match(r, q));
    if (method === 'PATCH') { hits.forEach(r => Object.assign(r, body)); return hits.map(r => ({...r})); }
    if (method === 'DELETE') { state[table] = rows.filter(r => !hits.includes(r)); return []; }
    return hits.map(r => ({...r}));
  };
  const io = (me, isAdmin = false) => ({sb, me, isAdmin, who: {email: me === sam ? 'Sam@Example.org' : 'c@example.org'},
    notifyReviewers: async n => { state.told.push(n); },
    postSlack: async p => { state.slack.push(p); },
    notifyPlayer: async n => { state.players.push(n); }});
  const as = (me, isAdmin) => (action, args) => handle(action, args, io(me, isAdmin));
  return {state, as};
}
const rejects = (p, status, re) => assert.rejects(p, e => e.status === status && (!re || re.test(e.message)));
const LINK = 'https://connectome.quest/play/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/1';
const cut = slot => ({kind: 'cut', slot, link: LINK, dataset: 'pinky', points: {red: [{position: [1, 2, 3], segmentId: '11', rootId: '99'}], blue: [{position: [4, 5, 6]}]}, segments: ['99']});
const merge = slot => ({kind: 'merge', slot, link: LINK, dataset: 'pinky', points: {merge: [{position: [1, 1, 1]}, {position: [2, 2, 2]}]}, segments: ['5', '6']});

async function fillAll(player) {
  for (let s = 1; s <= 7; s++) await player('access.save', cut(s));
  for (let s = 1; s <= 3; s++) await player('access.save', merge(s));
}

test('a player saves ten examples, sends them, and the reviewers are told', async () => {
  const {state, as} = world();
  const sam_ = as(sam);
  assert.deepEqual(await sam_('access.mine', {}), {request: null, items: []});
  await fillAll(sam_);
  const sent = await sam_('access.submit', {eyewireUsername: '  sam_ew ', note: 'My first try.'});
  assert.equal(sent.request.status, 'submitted');
  assert.equal(sent.request.tries, 1);
  assert.equal(sent.request.eyewire_username, 'sam_ew');
  assert.equal(sent.request.player_note, 'My first try.');
  assert.equal(sent.items.length, 10);
  assert.equal(state.access_requests[0].email, 'sam@example.org');
  assert.equal(state.told.length, 1);
  assert.match(state.told[0].title, /Sam/);
  assert.match(state.told[0].image, /brax-slice\.png$/);
  assert.deepEqual(state.slack[0], {name: 'Sam', email: 'sam@example.org', tries: 1, eyewireUsername: 'sam_ew'});
  // While it is with a reviewer, nothing changes and nothing is sent twice.
  await rejects(sam_('access.save', cut(1)), 409, /with a reviewer/);
  await rejects(sam_('access.submit', {}), 409);
});

test('each example is checked before it is kept', async () => {
  const {as} = world();
  const p = as(sam);
  await rejects(p('access.save', {...cut(1), points: {red: [{position: [1, 2, 3]}], blue: []}}), 400, /red and blue/);
  await rejects(p('access.save', {...merge(1), points: {}}), 400, /merge points/);
  await rejects(p('access.save', {...merge(1), points: {merge: [{position: [1, 1, 1]}]}}), 400, /both of its points/);
  await rejects(p('access.save', {...cut(8)}), 400, /slot/);
  await rejects(p('access.save', {...merge(4)}), 400, /slot/);
  await rejects(p('access.save', {...cut(1), link: 'javascript:alert(1)'}), 400);
  await rejects(p('access.save', {...cut(1), points: {red: [{position: [1, 2]}], blue: [{position: [1, 2, 3]}]}}), 400, /position/);
  // Players place many points: 27 red and 29 blue is fine, past 200 is not.
  const many = (n, x) => Array.from({length: n}, (_, i) => ({position: [x + i, 2, 3]}));
  await p('access.save', {...cut(5), points: {red: many(27, 0), blue: many(29, 100)}});
  await rejects(p('access.save', {...cut(6), points: {red: many(150, 0), blue: many(51, 500)}}), 400, /200 points/);
  await p('access.remove', {kind: 'cut', slot: 5});
  await rejects(p('access.submit', {}), 400, /0 of 7 cuts/);
  await p('access.save', cut(1));
  await rejects(p('access.submit', {}), 400, /1 of 7 cuts and 0 of 3/);
});

test('a player can empty a slot while collecting', async () => {
  const {as} = world();
  const p = as(sam);
  await p('access.save', cut(1));
  await p('access.save', cut(2));
  const after = await p('access.remove', {kind: 'cut', slot: 1});
  assert.deepEqual(after.items.map(i => i.slot), [2]);
});

test('reviews stay hidden until sent; a redo reopens only the examples marked redo', async () => {
  const {state, as} = world();
  const p = as(sam), rev = as(celia, true);
  await fillAll(p);
  await p('access.submit', {});
  const {requests} = await rev('access.list', {});
  assert.equal(requests.length, 1);
  const items = requests[0].items;
  const c2 = items.find(i => i.kind === 'cut' && i.slot === 2);
  await rev('access.review', {itemId: c2.id, verdict: 'redo', pointMarks: {'red:0': 'good', 'blue:0': 'off'}, feedback: 'The blue point sits on the merger.'});
  await rev('access.review', {itemId: items[0].id, verdict: 'good'});
  await rejects(rev('access.review', {itemId: c2.id, pointMarks: {'blue:3': 'off'}}), 400, /Unknown point/);
  // The player sees nothing of a review in progress.
  const during = await p('access.mine', {});
  assert.equal(during.items.find(i => i.slot === 2 && i.kind === 'cut').verdict, undefined);

  const decided = await rev('access.decide', {requestId: requests[0].id, outcome: 'redo', note: 'Close! One to fix.'});
  assert.equal(decided.status, 'redo');
  assert.equal(state.players[0].userId, sam.id);
  assert.match(state.players[0].body, /one again/);
  const seen = await p('access.mine', {});
  const back = seen.items.find(i => i.kind === 'cut' && i.slot === 2);
  assert.equal(back.verdict, 'redo');
  assert.deepEqual(back.point_marks, {'red:0': 'good', 'blue:0': 'off'});
  assert.equal(seen.request.reviewer_note, 'Close! One to fix.');

  await rejects(p('access.submit', {}), 400, /marked redo/);
  // Any example can change in a redo, even one marked good: a new example starts unmarked.
  await p('access.save', {...cut(1), note: 'A better one'});
  assert.equal(state.access_request_items.find(i => i.kind === 'cut' && i.slot === 1).verdict, null);
  await p('access.save', cut(2));
  const again = await p('access.submit', {});
  assert.equal(again.request.tries, 2);
  assert.match(state.told[1].title, /try 2/);
});

test('an invite adds the player to the pilot list and tells them', async () => {
  const {state, as} = world();
  const p = as(sam), rev = as(celia, true);
  await fillAll(p);
  await p('access.submit', {});
  const id = state.access_requests[0].id;
  await rejects(rev('access.decide', {requestId: id, outcome: 'redo'}), 400, /Mark at least one/);
  const done = await rev('access.decide', {requestId: id, outcome: 'invited', note: 'Lovely cuts.'});
  assert.equal(done.status, 'invited');
  assert.equal(done.pilot_added, true);
  assert.deepEqual(state.pilot_members.map(m => [m.email, m.enabled, m.added_by]), [['sam@example.org', true, celia.id]]);
  assert.match(state.players[0].title, /Congratulations! Your edit access has been granted!/);
  assert.match(state.players[0].image, /fly-neurons-by-neurotransmitter\.jpg$/);
  await rejects(rev('access.decide', {requestId: id, outcome: 'invited'}), 409, /already granted/);
  await rejects(p('access.save', cut(1)), 409, /already granted/);
});

test('a player takes sent examples back, changes them, and sends again', async () => {
  const {state, as} = world();
  const p = as(sam), rev = as(celia, true);
  await rejects(p('access.withdraw', {}), 409, /nothing waiting/);
  await fillAll(p);
  await p('access.submit', {});
  await rejects(p('access.save', cut(3)), 409, /take them back/);
  const back = await p('access.withdraw', {});
  assert.equal(back.request.status, 'draft');
  await p('access.remove', {kind: 'merge', slot: 3});
  await rejects(p('access.submit', {}), 400, /2 of 3 merges/);
  await p('access.save', merge(3));
  assert.equal((await p('access.submit', {})).request.tries, 2);
  // After a review, taking it back returns to the notes.
  const c4 = state.access_request_items.find(i => i.kind === 'cut' && i.slot === 4);
  await rev('access.review', {itemId: c4.id, verdict: 'redo', feedback: 'Too close to the soma.'});
  await rev('access.decide', {requestId: state.access_requests[0].id, outcome: 'redo'});
  await p('access.save', cut(4));
  await p('access.submit', {});
  const again = await p('access.withdraw', {});
  assert.equal(again.request.status, 'redo');
  assert.equal(again.request.reviewer_note, null);
});

test('an admin starts over, for a test or for a player', async () => {
  const {state, as} = world();
  const p = as(sam), rev = as(celia, true);
  await fillAll(p);
  await p('access.submit', {});
  await rejects(p('access.reset', {}), 403);
  await rev('access.reset', {requestId: state.access_requests[0].id});
  assert.equal(state.access_requests.length, 0);
  assert.equal(state.access_request_items.length, 0);
  assert.deepEqual(await p('access.mine', {}), {request: null, items: []});
  // An admin's own request, without an id.
  await rev('access.save', cut(1));
  await rev('access.reset', {});
  assert.equal(state.access_requests.length, 0);
  await rejects(rev('access.reset', {}), 404);
});

test('marks a reviewer never sent do not block a send (Ames 2026-10-16)', async () => {
  const {state, as} = world();
  const p = as(sam), rev = as(celia, true);
  await fillAll(p);
  await p('access.submit', {});
  const c2 = state.access_request_items.find(i => i.kind === 'cut' && i.slot === 2);
  await rev('access.review', {itemId: c2.id, verdict: 'redo', pointMarks: {'red:0': 'off'}, feedback: 'half done'});
  await p('access.withdraw', {});
  const back = state.access_request_items.find(i => i.id === c2.id);
  assert.equal(back.verdict, null);
  assert.deepEqual(back.point_marks, {});
  // And data left over from before the fix: a hidden redo on a draft.
  back.verdict = 'redo';
  const sent = await p('access.submit', {});
  assert.equal(sent.request.status, 'submitted');
  assert.equal(state.access_request_items.find(i => i.id === c2.id).verdict, null);
  await rejects(p('access.save', {...cut(1), eyewireUsername: 'bad<name>'}), 409);
});

test('reviewer actions are admins only, and a missing table says what to run', async () => {
  const {as} = world();
  await rejects(as(sam)('access.list', {}), 403);
  await rejects(as(sam)('access.review', {itemId: 1, verdict: 'good'}), 403);
  await rejects(as(sam)('access.decide', {requestId: 1, outcome: 'invited'}), 403);
  const off = world({installed: false});
  await rejects(off.as(sam)('access.mine', {}), 409, /supabase-access-requests\.sql/);
  await rejects(off.as(celia, true)('access.list', {}), 409, /supabase-access-requests\.sql/);
});
