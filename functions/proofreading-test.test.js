const {test} = require('node:test');
const assert = require('node:assert/strict');
const {handle, decide, endpointResults, cleanAnnotations, graphResults} = require('./proofreading-test');

const T = {id: '11111111-1111-4111-8111-111111111111', title: 'Test', dataset: 'pinky_nf_v2', pcg_server: 'https://minnie.microns-daf.com', pcg_table: 'pinky_nf_v2',
  state_url: 'middleauth+https://x/1', anchor_supervoxel: '100', baseline_at: '2026-10-10T20:00:00Z', hold_minutes: 60, pass_mark: 100, damage_fails: true,
  attempts_allowed: null, retry_hours: 0, feedback: 'summary', grant_pilot: true, cave_groups: [203], status: 'ready', enabled: true};
const CHECKS = [
  {id: 'c1', ordinal: 1, kind: 'cut', label: 'neighbour', supervoxel_a: '101', supervoxel_b: '201', point_a: [1, 1, 1], point_b: [2, 2, 2], weight: 1},
  {id: 'c2', ordinal: 2, kind: 'keep', label: 'spine', supervoxel_a: '101', supervoxel_b: '100', point_a: [1, 1, 1], weight: 1},
  {id: 'c3', ordinal: 3, kind: 'merge', label: 'piece', supervoxel_a: '100', supervoxel_b: '301', point_a: [3, 3, 3], weight: 1},
  {id: 'c4', ordinal: 4, kind: 'endpoint', label: 'end', supervoxel_a: '', supervoxel_b: '', point_a: [1000, 1000, 100], radius_nm: 1500, weight: 1},
];
const SESSION = '22222222-2222-4222-8222-222222222222';
const who = {email: 'player@example.invalid', caveId: 4242}, me = {id: '33333333-3333-4333-8333-333333333333'};

/** A fake chunkedgraph: supervoxel -> root, with an edit log the undo rewinds. */
function fakeGraph(start) {
  const g = {roots: {...start}, log: [], details: {}, undone: [], groupAdds: [], nextOp: 2000};
  g.edit = (changes, when = Date.now()) => { // changes: {sv: newRoot}
    const id = g.nextOp++;
    g.log.push({operation_id: id, timestamp: when, before: {...g.roots}});
    Object.assign(g.roots, changes);
    g.details[String(id)] = {operation_status: 0};
    return id;
  };
  g.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const json = body => ({ok: true, status: 200, json: async () => body});
    let m;
    if ((m = u.pathname.match(/\/node\/(\d+)\/root$/))) return json({root_id: g.roots[m[1]]});
    if ((m = u.pathname.match(/\/root\/(\d+)\/tabular_change_log$/))) {
      // Every logged op is in every root's history (one cell).
      return json({[m[1]]: g.log.map(op => ({operation_id: op.operation_id, timestamp: op.timestamp}))});
    }
    if (u.pathname.endsWith('/operation_details')) {
      const ids = JSON.parse(u.searchParams.get('operation_ids'));
      return json(Object.fromEntries(ids.map(i => [String(i), g.details[String(i)]])));
    }
    if (u.pathname.endsWith('/undo')) {
      const {operation_id} = JSON.parse(init.body);
      const op = g.log.find(o => o.operation_id === operation_id);
      g.undone.push(operation_id);
      g.roots = {...op.before};
      const id = g.nextOp++;
      g.log.push({operation_id: id, timestamp: Date.now(), before: null});
      g.details[String(id)] = {operation_status: 0, undo_operation_id: operation_id};
      return json({});
    }
    if ((m = u.pathname.match(/\/group\/(\d+)\/user$/))) { g.groupAdds.push({group: Number(m[1]), body: JSON.parse(init.body)}); return {ok: true, status: 200, json: async () => 'success'}; }
    throw new Error('unexpected url ' + url);
  };
  return g;
}

function fakeRpc(state) {
  const calls = [];
  const rpc = async (action, args) => {
    calls.push({action, args});
    if (action === 'status') return {test: T, free: true, attempts: 0, passed: false, can_start: true};
    if (action === 'claim') return {test: T, session: SESSION, attempt: 7, resumed: !!state.resumed, was: 'ready'};
    if (action === 'heartbeat') { if (state.ended) throw Object.assign(new Error('This test session has ended'), {status: 409}); return {expires_at: 'soon'}; }
    if (action === 'cleaned') return {ok: true};
    if (action === 'record') return {attempt: 7, outcome: args.outcome, status: args.clean ? 'ready' : 'needs_reset'};
    throw new Error('unknown rpc ' + action);
  };
  return {rpc, calls};
}

const START = {100: '900', 101: '900', 201: '900', 301: '800'}; // neighbour fused (201 on R), piece loose (301 on P)

function io(g, rpc) {
  return {fetch: g.fetch, caveToken: 'tok', rpc, sb: async path => path.startsWith('proofreading_tests?') ? [T] : CHECKS, onGranted() { g.grantedCleared = true; }};
}

test('scoring: every cut, merge and endpoint counts, damage fails outright', () => {
  const roots = {100: '900', 101: '900', 201: '700', 301: '900'};
  const results = [...graphResults(CHECKS, roots, 'end'), ...endpointResults(CHECKS, [[1000, 1100, 100]]).results];
  const d = decide(T, results, 0);
  assert.deepEqual({passed: d.passed, found: d.found, errors: d.errors, damaged: d.damaged, percent: d.percent, endpointsFound: d.endpointsFound}, {passed: true, found: 2, errors: 2, damaged: 0, percent: 100, endpointsFound: 1});
  // The spine cut off: damage, so no pass even with every error fixed.
  const hurt = decide(T, [...graphResults(CHECKS, {...roots, 101: '600'}, 'end'), ...endpointResults(CHECKS, [[1000, 1100, 100]]).results], 0);
  assert.equal(hurt.passed, false); assert.equal(hurt.damaged, 1);
  assert.equal(decide({...T, damage_fails: false}, [...graphResults(CHECKS, {...roots, 101: '600'}, 'end'), ...endpointResults(CHECKS, [[1000, 1100, 100]]).results], 0).passed, true);
  // A missed endpoint and a missed merge: 1 of 3 points, 33 percent.
  const half = decide(T, [...graphResults(CHECKS, {...roots, 301: '800'}, 'end'), ...endpointResults(CHECKS, []).results], 0);
  assert.equal(half.percent, 33); assert.equal(half.passed, false);
  assert.equal(decide({...T, pass_mark: 30}, [...graphResults(CHECKS, {...roots, 301: '800'}, 'end'), ...endpointResults(CHECKS, []).results], 0).passed, true);
});

test('endpoints: within the radius in nm, one point serves one endpoint, strays are counted', () => {
  // 1500 nm radius: 300 voxels in x is 1200 nm (hit), 400 is 1600 nm (miss); 30 slices in z is 1200 nm.
  assert.equal(endpointResults(CHECKS, [[1300, 1000, 100]]).results[0].ok, true);
  assert.equal(endpointResults(CHECKS, [[1400, 1000, 100]]).results[0].ok, false);
  assert.equal(endpointResults(CHECKS, [[1000, 1000, 130]]).results[0].ok, true);
  const r = endpointResults(CHECKS, [[1000, 1000, 100], [5000, 5000, 500]]);
  assert.equal(r.results[0].ok, true); assert.equal(r.stray, 1);
  assert.deepEqual(cleanAnnotations([[1, 2, 3], ['4', '5', '6'], [1], null, [1e9, 0, 0]]), [[1, 2, 3], [4, 5, 6]]);
});

test('start: edits since the baseline are undone before the cell is handed over', async () => {
  const g = fakeGraph(START);
  g.edit({201: '700'}, Date.parse('2026-10-10T20:10:00Z')); // someone cut the neighbour off after the baseline
  const {rpc, calls} = fakeRpc({});
  const out = await handle({action: 'test.start', args: {}, who, me, io: io(g, rpc)});
  assert.equal(out.session, SESSION); assert.equal(out.checks, 3); assert.equal(out.endpoints, 1); assert.equal(out.root, '900');
  assert.deepEqual(g.undone, [2000]);
  assert.equal(g.roots[201], '900');
  assert.ok(calls.some(c => c.action === 'cleaned'));
  assert.ok(!('supervoxel_a' in out) && !('point_a' in out));
});

test('start: a resumed session keeps the player\'s edits', async () => {
  const g = fakeGraph(START);
  g.edit({201: '700'});
  const {rpc} = fakeRpc({resumed: true});
  const out = await handle({action: 'test.start', args: {}, who, me, io: io(g, rpc)});
  assert.equal(out.resumed, true); assert.deepEqual(g.undone, []); assert.equal(g.roots[201], '700'); assert.equal(out.root, '900');
});

test('start: a cell that will not go back to its start is reported, never handed over', async () => {
  const g = fakeGraph({...START, 301: '900'}); // the piece is already merged at the baseline: wrong registration
  const {rpc, calls} = fakeRpc({});
  await assert.rejects(() => handle({action: 'test.start', args: {}, who, me, io: io(g, rpc)}), /not in its starting state/);
  const rec = calls.find(c => c.action === 'record');
  assert.equal(rec.args.outcome, 'error'); assert.equal(rec.args.clean, false); assert.match(rec.args.error, /merge piece/);
});

test('submit: a full proofread passes, grants the groups, puts the cell back and records', async () => {
  const g = fakeGraph(START);
  const baseline = Date.parse(T.baseline_at);
  g.edit({201: '700'}, baseline + 60000);   // the neighbour cut off
  g.edit({301: '900'}, baseline + 120000);  // the piece merged on
  const {rpc, calls} = fakeRpc({});
  const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: [[1000, 1000, 100]]}, who, me, io: io(g, rpc)});
  assert.equal(out.passed, true); assert.equal(out.percent, 100); assert.equal(out.found, 2); assert.equal(out.damaged, 0);
  assert.deepEqual(out.granted, {pilot: true, groups: [{id: 203, ok: true}]});
  assert.equal(out.checks, undefined, 'summary feedback carries no answers');
  assert.deepEqual(g.groupAdds, [{group: 203, body: {user_id: 4242}}]);
  assert.deepEqual(g.undone, [2001, 2000], 'newest first');
  assert.deepEqual({201: g.roots[201], 301: g.roots[301]}, {201: '900', 301: '800'}, 'back at the start');
  const rec = calls.find(c => c.action === 'record');
  assert.equal(rec.args.outcome, 'pass'); assert.equal(rec.args.clean, true); assert.equal(rec.args.checks.length, 4);
  assert.equal(g.grantedCleared, true);
});

test('submit: a cut through the spine fails even with every error fixed, and grants nothing', async () => {
  const g = fakeGraph(START);
  const baseline = Date.parse(T.baseline_at);
  g.edit({201: '700', 101: '700'}, baseline + 60000); // cut on the wrong side of the spine: spine goes with the neighbour
  g.edit({301: '900'}, baseline + 120000);
  const {rpc, calls} = fakeRpc({});
  const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me, io: io(g, rpc)});
  // The cut check pairs the spine with the neighbour: cut before the spine, they stay together, so it is a missed cut as well as damage.
  assert.equal(out.passed, false); assert.equal(out.damaged, 1); assert.equal(out.found, 1); assert.equal(out.endpointsFound, 0);
  assert.equal(out.granted, undefined); assert.deepEqual(g.groupAdds, []);
  assert.equal(calls.find(c => c.action === 'record').args.outcome, 'fail');
});

test('submit: detail feedback names each miss with a place to look; none says only pass or fail', async () => {
  for (const [level, expectKeys] of [['detail', ['checks', 'percent']], ['none', []]]) {
    const g = fakeGraph(START);
    const sbWith = async path => path.startsWith('proofreading_tests?') ? [{...T, feedback: level}] : CHECKS;
    const {rpc} = fakeRpc({});
    const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me, io: {...io(g, rpc), sb: sbWith}});
    for (const k of expectKeys) assert.ok(k in out, level + ' has ' + k);
    if (level === 'none') assert.deepEqual(Object.keys(out).sort(), ['feedback', 'passed']);
    if (level === 'detail') {
      const miss = out.checks.find(c => c.kind === 'cut');
      assert.deepEqual(miss.point, [2, 2, 2]);
      assert.equal(out.checks.find(c => c.kind === 'keep').point, null);
    }
  }
});

test('submit: a hold that ended is refused; abandon after it just says so', async () => {
  const g = fakeGraph(START);
  const {rpc} = fakeRpc({ended: true});
  await assert.rejects(() => handle({action: 'test.submit', args: {id: T.id, session: SESSION}, who, me, io: io(g, rpc)}), /has ended/);
  assert.deepEqual(await handle({action: 'test.abandon', args: {id: T.id, session: SESSION}, who, me, io: io(g, rpc)}), {ended: true});
  await assert.rejects(() => handle({action: 'test.submit', args: {id: 'nope', session: SESSION}, who, me, io: io(g, rpc)}), /Unknown test/);
  await assert.rejects(() => handle({action: 'test.status', args: {}, who, me: null, io: io(g, rpc)}), /Sign in/);
});

test('abandon: the edits come off and the attempt is closed without a score', async () => {
  const g = fakeGraph(START);
  g.edit({201: '700'}, Date.parse(T.baseline_at) + 60000);
  const {rpc, calls} = fakeRpc({});
  const out = await handle({action: 'test.abandon', args: {id: T.id, session: SESSION}, who, me, io: io(g, rpc)});
  assert.deepEqual(out, {ended: true, clean: true});
  assert.equal(g.roots[201], '900');
  const rec = calls.find(c => c.action === 'record');
  assert.equal(rec.args.outcome, 'abandoned'); assert.equal(rec.args.found, undefined);
});
