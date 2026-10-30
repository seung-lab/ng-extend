'use strict';
// Access to one dataset (Ames 2026-10-28): a player asks once per dataset, the
// admins are told, an admin marks it Granted or Not now and the player gets a
// bell. Against a fake database and a fake mark store.
// Run: cd functions && node --test dataset-access.test.js
const test = require('node:test');
const assert = require('node:assert');
const {handle} = require('./access-request');

const MEC = {datasetId: 'pni_mec', label: 'Medial Entorhinal Cortex', caveDataset: 'HiMC'};

function world() {
  const issues = [];
  const told = [], posted = [], players = [];
  const marks = {};
  const caveIds = {'u-player': 3072};
  const grants = [];
  const edits = [];
  const sb = async (p, init = {}) => {
    if (p.startsWith('users?')) {
      const id = new URLSearchParams(p.split('?')[1]).get('id') || '';
      if (id.startsWith('in.(')) return id.slice(4, -1).split(',').map(u => ({id: u, cave_user_id: caveIds[u], created_at: '2026-09-01T00:00:00Z'}));
      return [{cave_user_id: caveIds[id.replace(/^eq\./, '')]}];
    }
    if (p.startsWith('edit_log?')) {
      const q = new URLSearchParams(p.split('?')[1]);
      const hit = edits.filter(e => q.get('dataset') === 'eq.' + e.dataset && q.get('user_id') === 'eq.' + e.user_id)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (q.get('order') === 'timestamp.desc') hit.reverse();
      return hit.slice(0, 1);
    }
    if (p.startsWith('site_issues?')) {
      const q = new URLSearchParams(p.split('?')[1]);
      const eq = k => (q.get(k) || '').replace(/^eq\./, '');
      return issues.filter(i => i.category === eq('category')
        && (!q.get('user_id') || i.user_id === eq('user_id'))
        && (!q.get('id') || i.id === eq('id'))).slice().reverse();
    }
    if (p === 'site_issues' && init.method === 'POST') {
      for (const r of JSON.parse(init.body)) {
        issues.push({id: `00000000-0000-0000-0000-00000000000${issues.length + 1}`, created_at: new Date(Date.now() + issues.length).toISOString(), ...r});
      }
      return [];
    }
    throw new Error('unexpected ' + p);
  };
  const datasetMarks = {
    all: async () => ({...marks}),
    set: async (id, v) => { if (v) marks[id] = v; else delete marks[id]; },
  };
  const me = {id: 'u-player', username: 'andrearwen'};
  const io = (over = {}) => ({sb, me, who: {email: 'player@example.org'}, isAdmin: false, isPilot: true, datasetMarks,
    notifyAdmins: async n => { told.push(n); }, notifyPlayer: async n => { players.push(n); },
    grantCave: async (caveId, group) => { grants.push({caveId, group}); return {ok: true}; },
    postIssue: async p => { posted.push(p); }, ...over});
  return {issues, told, posted, players, marks, caveIds, grants, edits, io};
}

test('a request: one report, a bell to every admin, a Slack post, then Requested', async () => {
  const w = world();
  assert.deepStrictEqual(await handle('access.datasetStatus', {}, w.io()), {requests: {}});
  const out = await handle('access.dataset', {...MEC, note: 'I trace grid cells.'}, w.io());
  assert.strictEqual(out.requested, true);
  assert.strictEqual(out.requests.pni_mec.mark, null);
  assert.strictEqual(w.issues.length, 1);
  const r = w.issues[0];
  assert.strictEqual(r.category, 'Dataset access');
  assert.strictEqual(r.dataset, 'pni_mec');
  assert.strictEqual(r.title, 'Medial Entorhinal Cortex access request from andrearwen');
  assert.match(r.message, /CAVE dataset: HiMC/);
  assert.match(r.message, /Sign in email: player@example\.org/);
  assert.strictEqual(w.told.length, 1);
  assert.match(w.told[0].title, /Medial Entorhinal Cortex, from andrearwen/);
  assert.strictEqual(w.posted.length, 1);
});

test('asking again while it is open files nothing more', async () => {
  const w = world();
  await handle('access.dataset', MEC, w.io());
  const again = await handle('access.dataset', MEC, w.io());
  assert.strictEqual(again.already, true);
  assert.strictEqual(w.issues.length, 1);
  assert.strictEqual(w.told.length, 1);
});

test('retina and made up datasets are refused; a note can not carry markdown into the bell', async () => {
  const w = world();
  await assert.rejects(handle('access.dataset', {...MEC, datasetId: 'stroeh_mouse_retina'}, w.io()), /Unknown dataset/);
  await assert.rejects(handle('access.dataset', {...MEC, datasetId: '../x'}, w.io()), /Unknown dataset/);
  await assert.rejects(handle('access.dataset', {...MEC, label: '[click](http://evil)'}, w.io()), /Unknown dataset/);
  const fly = await handle('access.dataset', {datasetId: 'flywire_public', label: 'FlyWire: Fruit Fly Brain', caveDataset: 'flywire_public'}, w.io());
  assert.strictEqual(fly.requested, true);
  await handle('access.dataset', {...MEC, note: '[click](http://evil)'}, w.io());
  assert.ok(!/\[click\]\(http/.test(w.told[0].body));
});

test('only admins list and decide; Granted tells the player and shows on their status', async () => {
  const w = world();
  await handle('access.dataset', MEC, w.io());
  await assert.rejects(handle('access.datasetList', {}, w.io()), /Admins only/);
  const list = await handle('access.datasetList', {}, w.io({isAdmin: true}));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].label, 'Medial Entorhinal Cortex');
  assert.strictEqual(list[0].cave, 'HiMC');
  await assert.rejects(handle('access.datasetDecide', {id: list[0].id, mark: 'granted'}, w.io()), /Admins only/);
  const after = await handle('access.datasetDecide', {id: list[0].id, mark: 'granted'}, w.io({isAdmin: true}));
  assert.strictEqual(after[0].mark, 'granted');
  assert.strictEqual(w.players.length, 1);
  assert.strictEqual(w.players[0].userId, 'u-player');
  assert.match(w.players[0].title, /You have access to Medial Entorhinal Cortex/);
  const status = await handle('access.datasetStatus', {}, w.io());
  assert.strictEqual(status.requests.pni_mec.mark, 'granted');
});

test('Not now tells the player, and they may ask again', async () => {
  const w = world();
  await handle('access.dataset', MEC, w.io());
  const [r] = await handle('access.datasetList', {}, w.io({isAdmin: true}));
  await handle('access.datasetDecide', {id: r.id, mark: 'declined', note: 'Finish the MEC tutorial first.'}, w.io({isAdmin: true}));
  assert.match(w.players[0].body, /Finish the MEC tutorial first/);
  const again = await handle('access.dataset', MEC, w.io());
  assert.strictEqual(again.requested, true);
  assert.strictEqual(w.issues.length, 2);
});

test('tiers: no retina edit access, no request; an admin, or CAVE not answering, is not held back', async () => {
  const w = world();
  await assert.rejects(handle('access.dataset', MEC, w.io({canEditRetina: async () => false})), /starts with the retina/);
  assert.strictEqual(w.issues.length, 0);
  assert.strictEqual((await handle('access.dataset', MEC, w.io({canEditRetina: async () => null}))).requested, true);
  const w2 = world();
  assert.strictEqual((await handle('access.dataset', MEC, w2.io({isAdmin: true, canEditRetina: async () => false}))).requested, true);
  const w3 = world();
  assert.strictEqual((await handle('access.dataset', MEC, w3.io({canEditRetina: async () => true}))).requested, true);
});

test('Granted on MEC adds the player to MEC_Edit (217) first; with no CAVE id it refuses, by hand it skips CAVE', async () => {
  const w = world();
  await handle('access.dataset', MEC, w.io());
  const [r] = await handle('access.datasetList', {}, w.io({isAdmin: true}));
  assert.strictEqual(r.caveGroup, 'MEC_Edit');
  await handle('access.datasetDecide', {id: r.id, mark: 'granted'}, w.io({isAdmin: true}));
  assert.deepStrictEqual(w.grants, [{caveId: 3072, group: 217}]);
  assert.strictEqual(w.players.length, 1);
  // CAVE refusing: nothing marked, nobody told.
  const w2 = world();
  await handle('access.dataset', MEC, w2.io());
  const [r2] = await handle('access.datasetList', {}, w2.io({isAdmin: true}));
  await assert.rejects(handle('access.datasetDecide', {id: r2.id, mark: 'granted'}, w2.io({isAdmin: true, grantCave: async () => ({ok: false, status: 403})})), /did not add them to MEC_Edit/);
  assert.strictEqual(w2.players.length, 0);
  assert.strictEqual(w2.marks[r2.id], undefined);
  // No CAVE id known: refused; by hand works.
  w2.caveIds['u-player'] = null;
  await assert.rejects(handle('access.datasetDecide', {id: r2.id, mark: 'granted'}, w2.io({isAdmin: true})), /CAVE id/);
  await handle('access.datasetDecide', {id: r2.id, mark: 'granted', byHand: true}, w2.io({isAdmin: true}));
  assert.strictEqual(w2.players.length, 1);
});

test('the list shows what a waiting player can do in CAVE and how long they have edited each dataset', async () => {
  const w = world();
  w.edits.push({user_id: 'u-player', dataset: 'stroeh_mouse_retina', timestamp: '2026-09-10T00:00:00Z'},
    {user_id: 'u-player', dataset: 'stroeh_mouse_retina', timestamp: '2026-10-20T00:00:00Z'});
  await handle('access.dataset', MEC, w.io());
  const asked = [];
  const caveAccessOf = async id => { asked.push(id); return {edit: ['stroeh-mouse-retina'], view: ['pinky100'], groups: ['Eyewire_2_Edit']}; };
  const [r] = await handle('access.datasetList', {}, w.io({isAdmin: true, caveAccessOf}));
  assert.deepStrictEqual(asked, [3072]);
  assert.deepStrictEqual(r.access.edit, ['stroeh-mouse-retina']);
  assert.strictEqual(r.history.joined, '2026-09-01T00:00:00Z');
  assert.deepStrictEqual(r.history.datasets, [{dataset: 'stroeh_mouse_retina', first: '2026-09-10T00:00:00Z', last: '2026-10-20T00:00:00Z'}]);
  // Once answered, CAVE is not asked again.
  await handle('access.datasetDecide', {id: r.id, mark: 'granted', byHand: true}, w.io({isAdmin: true}));
  const [r2] = await handle('access.datasetList', {}, w.io({isAdmin: true, caveAccessOf}));
  assert.strictEqual(asked.length, 1);
  assert.strictEqual(r2.access, null);
  assert.strictEqual(r2.history, null);
});

// The chat line for a grant (Ames 2026-10-30).
test('a grant is said in chat once, on the next visit', async () => {
  const lines = [], asked = [];
  const sb = async (p, init = {}) => {
    if (p.startsWith('notifications?')) { asked.push(decodeURIComponent(p)); return [
      {title: '🎉 Congratulations! Your edit access has been granted!', body: 'x'},
      {title: '🔓 You have access to Medial Entorhinal Cortex', body: '[Explore MEC ›](#nge-open-dataset=pni_mec)'}]; }
    if (p === 'chat_messages') { lines.push(JSON.parse(init.body)); return []; }
    if (p.startsWith('chat_messages?')) return lines.filter(l => p.includes(encodeURIComponent(l.dataset)));
    return [];
  };
  const io = {sb, me: {id: 'u-1', username: 'Rae'}};
  assert.equal((await handle('access.grantLines', {}, io)).announced, 2);
  assert.deepEqual(lines.map(l => [l.name, l.rank, l.text, l.dataset]), [
    ['Rae', 'achievement', 'now has edit access to the Retina', 'access:stroeh_mouse_retina'],
    ['Rae', 'achievement', 'now has edit access to MEC', 'access:pni_mec']]);
  assert.equal((await handle('access.grantLines', {}, io)).announced, 0);
  assert.ok(asked[0].includes('target_id=eq.u-1') && asked[0].includes('send_at=gte.2026-10-30'));
  assert.equal((await handle('access.grantLines', {}, {sb, me: null})).announced, 0);
});
