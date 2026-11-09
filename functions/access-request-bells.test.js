'use strict';
// Retina access request bells go read for the reviewers once the player has
// the retina (Ames 2026-11-06): on Grant, for every try, and for bells sent
// before this, when the list opens or a reviewer's bell asks.
const test = require('node:test');
const assert = require('node:assert/strict');
const {handle} = require('./access-request');

const U = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const amy = {id: U(1), username: 'amy'}, celia = {id: U(3), username: 'celiad'};
const hi = {id: U(10), username: 'hi529'}, bo = {id: U(11), username: 'bo'}, cy = {id: U(12), username: 'cy'};
const dee = {id: U(13), username: 'dee'}; // CAVE answers are kept 10 minutes per player: one player per CAVE test
const stranger = {id: U(20), username: 'nobody'};
const BELL = n => `🔬 Retina access request from ${n}`;

/** The PostgREST shapes access-request.js uses, over plain arrays. */
function world() {
  const state = {access_requests: [], access_request_items: [], access_request_item_history: [], pilot_members: [],
    notifications: [], notification_reads: [], users: [], caveCalls: [], granted: [], told: []};
  let nextId = 1000;
  const like = (value, pattern) => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(String(value));
  const match = (r, q) => [...q].every(([k, v]) => {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
    if (v.startsWith('like.')) return like(r[k], v.slice(5));
    throw new Error('filter ' + v);
  });
  const sb = async (path, init = {}) => {
    const [table, qs = ''] = path.split('?');
    const q = new URLSearchParams(qs), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    const rows = state[table];
    if (!rows) throw new Error('supabase 404');
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const keys = (q.get('on_conflict') || '').split(',').filter(Boolean);
      const ignore = /ignore-duplicates/.test((init.headers || {}).Prefer || '');
      const out = [];
      for (const b of list) {
        const hit = keys.length && rows.find(r => keys.every(k => String(r[k]) === String(b[k])));
        if (hit) { if (!ignore) Object.assign(hit, b); out.push({...hit}); continue; }
        if (table === 'notification_reads' && rows.some(r => r.notification_id === b.notification_id && r.user_id === b.user_id)) throw new Error('supabase 409');
        const row = {id: nextId++, ...(table === 'access_requests' ? {status: 'draft', tries: 0} : {}), ...b};
        rows.push(row); out.push({...row});
      }
      return out;
    }
    let hits = rows.filter(r => match(r, q));
    if (method === 'PATCH') { hits.forEach(r => Object.assign(r, body)); return hits.map(r => ({...r})); }
    if (method === 'DELETE') { state[table] = rows.filter(r => !hits.includes(r)); return []; }
    if (q.get('order') === 'id.desc') hits = [...hits].sort((a, b) => b.id - a.id);
    if (q.get('limit')) hits = hits.slice(0, Number(q.get('limit')));
    return hits.map(r => ({...r}));
  };
  // CAVE: who edits the retina. cave id -> list of datasets they edit; missing = CAVE can't say.
  const cave = {};
  const io = (me, isAdmin = false) => ({sb, me, isAdmin, who: {email: `${me.username}@example.org`, caveId: 77},
    grantCave: async id => { state.granted.push(id); return {ok: true, status: 200}; },
    notifyPlayer: async n => { state.told.push(n); },
    caveAccessOf: async id => { state.caveCalls.push(id); return id in cave ? {edit: cave[id], view: [], groups: []} : null; }});
  const as = (me, isAdmin) => (action, args) => handle(action, args, io(me, isAdmin));
  // A request bell from a player to each reviewer, the way index.js writes it.
  const bell = (player, tries = 1) => {
    const ids = [];
    for (const r of [amy, celia]) {
      const id = nextId++;
      state.notifications.push({id, title: BELL(player.username) + (tries > 1 ? ` (try ${tries})` : ''), body: '...',
        target_type: 'user', target_id: r.id, created_by: player.id});
      ids.push(id);
    }
    return ids;
  };
  const request = (player, status, caveId = null) => {
    state.access_requests.push({id: nextId++, user_id: player.id, email: `${player.username}@example.org`, status, tries: 2,
      cave_user_id: caveId, player_name: player.username});
  };
  const unread = (userId) => state.notifications.filter(n => n.target_id === userId && n.title.startsWith('🔬 Retina access request from')
    && !state.notification_reads.some(r => r.notification_id === n.id && r.user_id === userId)).map(n => n.id);
  return {state, as, bell, request, unread, cave};
}

test('Grant marks every reviewer\'s bell for every try of that player read, and only theirs', async () => {
  const w = world();
  const t1 = w.bell(hi, 1), t2 = w.bell(hi, 2), other = w.bell(bo, 1);
  w.request(hi, 'submitted', 4242);
  w.request(bo, 'submitted', 5151);
  // Celia had already read try 1: that row stays as it was.
  w.state.notification_reads.push({id: 1, notification_id: t1[1], user_id: celia.id, read_at: 'earlier', dismissed: true});
  const reqId = w.state.access_requests.find(r => r.user_id === hi.id).id;
  const r = await w.as(amy, true)('access.decide', {requestId: reqId, outcome: 'invited'});
  assert.equal(r.status, 'invited');
  assert.deepEqual(w.state.granted, [4242]);
  assert.deepEqual(w.unread(amy.id).sort(), [other[0]]);
  assert.deepEqual(w.unread(celia.id).sort(), [other[1]]);
  const kept = w.state.notification_reads.find(x => x.id === 1);
  assert.equal(kept.read_at, 'earlier');
  assert.equal(kept.dismissed, true);
  for (const id of [...t1, ...t2]) assert.ok(w.state.notification_reads.some(x => x.notification_id === id));
});

test('Ask for redos leaves the bells unread', async () => {
  const w = world();
  w.bell(hi, 1);
  w.request(hi, 'submitted', 4242);
  const req = w.state.access_requests[0];
  w.state.access_request_items.push({id: 1, request_id: req.id, kind: 'cut', slot: 1, verdict: 'redo', points: {}});
  await w.as(amy, true)('access.decide', {requestId: req.id, outcome: 'redo'});
  assert.equal(w.unread(amy.id).length, 1);
  assert.equal(w.unread(celia.id).length, 1);
});

test('older bells: the list sweep marks granted players read, by request or by CAVE, and leaves the rest', async () => {
  const w = world();
  const granted = w.bell(hi, 2);                 // request granted earlier, bells never read
  const waiting = w.bell(bo, 1);                 // still waiting for a review
  const deleted = w.bell(cy, 3);                 // request deleted with Start over, edits in CAVE
  w.request(hi, 'invited', 4242);
  w.request(bo, 'submitted', 5151);
  w.state.users.push({id: bo.id, cave_user_id: 5151}, {id: cy.id, cave_user_id: 6262});
  w.cave[5151] = [];                             // bo: no edit anywhere yet
  w.cave[6262] = ['stroeh-mouse-retina', 'HiMC'];
  await w.as(celia, true)('access.list', {});
  assert.deepEqual(w.unread(amy.id), [waiting[0]]);
  assert.deepEqual(w.unread(celia.id), [waiting[1]]);
  for (const id of [...granted, ...deleted]) assert.ok(w.state.notification_reads.some(x => x.notification_id === id));
  // hi was known from the request: CAVE is asked only for the others.
  assert.deepEqual(w.state.caveCalls.sort(), [5151, 6262]);
});

test('CAVE that cannot answer marks nothing, and is asked again next time', async () => {
  const w = world();
  w.bell(dee, 1);
  w.state.users.push({id: dee.id, cave_user_id: 7373});
  const r1 = await w.as(amy, true)('access.readGrantedBells', {});
  assert.equal(r1.marked, 0);
  assert.equal(w.unread(amy.id).length, 1);
  w.cave[7373] = ['stroeh-mouse-retina'];
  const r2 = await w.as(amy, true)('access.readGrantedBells', {});
  assert.equal(r2.marked, 2);
  assert.equal(w.unread(amy.id).length, 0);
  assert.equal(r2.ids.length, 1, 'only the caller\'s own bell ids come back');
});

test('readGrantedBells: a reviewer who is not an admin may run it, a stranger may not; a second run marks nothing', async () => {
  const w = world();
  w.bell(hi, 1);
  w.request(hi, 'invited', 4242);
  await assert.rejects(w.as(stranger, false)('access.readGrantedBells', {}), e => e.status === 403);
  assert.equal(w.unread(amy.id).length, 1);
  const r = await w.as(celia, false)('access.readGrantedBells', {});
  assert.equal(r.marked, 2);
  assert.equal(w.unread(amy.id).length, 0);
  const again = await w.as(amy, true)('access.readGrantedBells', {});
  assert.equal(again.marked, 0);
});

test('other bells with a similar look are never touched', async () => {
  const w = world();
  w.request(hi, 'invited', 4242);
  w.state.notifications.push(
    {id: 1, title: '🔬 Notes on your retina access request', body: '', target_type: 'user', target_id: hi.id, created_by: amy.id},
    {id: 2, title: '🔓 Dataset access request from hi529', body: '', target_type: 'user', target_id: amy.id, created_by: hi.id},
    {id: 3, title: BELL('hi529'), body: '', target_type: 'all', target_id: null, created_by: hi.id});
  const r = await w.as(amy, true)('access.readGrantedBells', {});
  assert.equal(r.marked, 0);
  assert.equal(w.state.notification_reads.length, 0);
});
