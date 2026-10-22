const {test} = require('node:test');
const assert = require('node:assert/strict');
const {handle, adminNote, decide, endpointResults, cleanAnnotations, graphResults} = require('./proofreading-test');

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
    // An undo reverses this edit only, as the chunkedgraph's does.
    const before = {}; for (const k of Object.keys(changes)) before[k] = g.roots[k];
    g.log.push({operation_id: id, timestamp: when, before});
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
      // Every logged op is in every root's history (one cell), except one
      // the test hides until another has been undone (as a cut on a piece no
      // registered spot sits on stays out of the cell's history).
      const shown = g.log.filter(op => !(g.hiddenUntil && g.hiddenUntil[op.operation_id] !== undefined && !g.undone.includes(g.hiddenUntil[op.operation_id])));
      return json({[m[1]]: shown.map(op => ({operation_id: op.operation_id, timestamp: op.timestamp}))});
    }
    if (u.pathname.endsWith('/operation_details')) {
      const ids = JSON.parse(u.searchParams.get('operation_ids'));
      return json(Object.fromEntries(ids.map(i => [String(i), g.details[String(i)]])));
    }
    if (u.pathname.endsWith('/undo')) {
      const {operation_id} = JSON.parse(init.body);
      const op = g.log.find(o => o.operation_id === operation_id);
      g.undone.push(operation_id);
      Object.assign(g.roots, op.before);
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
  // 89.6 percent against a mark of 90: shown as 89, not a pass.
  const nearly = decide({...T, pass_mark: 90}, [{kind: 'merge', ok: true, weight: 896}, {kind: 'merge', ok: false, weight: 104}], 0);
  assert.equal(nearly.percent, 89); assert.equal(nearly.passed, false);
  assert.equal(decide({...T, pass_mark: 90}, [{kind: 'merge', ok: true, weight: 9}, {kind: 'merge', ok: false, weight: 1}], 0).passed, true, 'exactly 90 passes');
});

test('endpoints: within the radius in nm, one point serves one endpoint, strays are counted', () => {
  // 1500 nm radius: 300 voxels in x is 1200 nm (hit), 400 is 1600 nm (miss); 30 slices in z is 1200 nm.
  assert.equal(endpointResults(CHECKS, [[1300, 1000, 100]]).results[0].ok, true);
  assert.equal(endpointResults(CHECKS, [[1400, 1000, 100]]).results[0].ok, false);
  assert.equal(endpointResults(CHECKS, [[1000, 1000, 130]]).results[0].ok, true);
  const r = endpointResults(CHECKS, [[1000, 1000, 100], [5000, 5000, 500]]);
  assert.equal(r.results[0].ok, true); assert.equal(r.stray, 1);
  assert.deepEqual(cleanAnnotations([[1, 2, 3], ['4', '5', '6'], [1], null, [1e9, 0, 0]]), [[1, 2, 3], [4, 5, 6]]);
  // Two ends 2000 nm apart (500 voxels in x), each with a 1500 nm radius.
  const two = [
    {id: 'a', ordinal: 1, kind: 'endpoint', label: 'A', point_a: [1000, 1000, 100], radius_nm: 1500},
    {id: 'b', ordinal: 2, kind: 'endpoint', label: 'B', point_a: [1500, 1000, 100], radius_nm: 1500},
  ];
  const oks = pts => endpointResults(two, pts).results.map(x => x.ok);
  // One point between them marks one end, not both.
  assert.deepEqual(oks([[1250, 1000, 100]]), [true, false]);
  // Two points between them mark both.
  assert.deepEqual(oks([[1250, 1000, 100], [1260, 1000, 100]]), [true, true]);
  // A point only A can use and a point both can use: both ends are marked,
  // in either order the player placed them.
  assert.deepEqual(oks([[1250, 1000, 100], [800, 1000, 100]]), [true, true]);
  assert.deepEqual(oks([[800, 1000, 100], [1250, 1000, 100]]), [true, true]);
  assert.equal(endpointResults(two, [[1250, 1000, 100], [9000, 9000, 900]]).stray, 1);
});

test('start: edits since the baseline are undone before the cell is handed over', async () => {
  const g = fakeGraph(START);
  g.edit({201: '700'}, Date.parse('2026-10-10T20:10:00Z')); // someone cut the neighbour off after the baseline
  const {rpc, calls} = fakeRpc({});
  const out = await handle({action: 'test.start', args: {}, who, me, io: io(g, rpc)});
  assert.equal(out.session, SESSION); assert.equal(out.checks, 2, 'the keep check is not a thing to fix'); assert.equal(out.endpoints, 1); assert.equal(out.root, '900');
  assert.deepEqual(g.undone, [2000]);
  assert.equal(g.roots[201], '900');
  assert.ok(calls.some(c => c.action === 'cleaned'));
  assert.ok(!('supervoxel_a' in out) && !('point_a' in out));
});

test('start: a resumed session keeps the player\'s edits', async () => {
  const g = fakeGraph(START);
  g.edit({201: '700'});
  const {rpc} = fakeRpc({resumed: true});
  const putBackDone = {...T, claimed_at: '2026-10-19T10:00:00Z', last_reset_at: '2026-10-19T10:01:00Z'};
  const out = await handle({action: 'test.start', args: {}, who, me, io: {...io(g, rpc), sb: async path => path.startsWith('proofreading_tests?') ? [putBackDone] : CHECKS}});
  assert.equal(out.resumed, true); assert.deepEqual(g.undone, []); assert.equal(g.roots[201], '700'); assert.equal(out.root, '900');
});

test('start: an edit that shows only once another is undone is found in a second pass', async () => {
  const g = fakeGraph(START);
  const base = Date.parse(T.baseline_at);
  const first = g.edit({301: '900'}, base + 60000);     // a piece merged on
  const hidden = g.edit({201: '700'}, base + 120000);   // a cut the cell's history shows only later
  g.hiddenUntil = {[hidden]: first};
  const {rpc, calls} = fakeRpc({});
  const out = await handle({action: 'test.start', args: {}, who, me, io: io(g, rpc)});
  assert.equal(out.resetting, undefined); assert.equal(out.session, SESSION);
  assert.deepEqual(g.undone.sort(), [first, hidden].sort());
  assert.deepEqual({201: g.roots[201], 301: g.roots[301]}, {201: '900', 301: '800'}, 'back at the start');
  assert.ok(calls.some(c => c.action === 'cleaned'), 'always marked as put back');
  assert.ok(!calls.some(c => c.action === 'record'), 'nothing recorded as an error');
});

test('start: a long history is put back over several calls, never in one that runs out of time', async () => {
  const g = fakeGraph(START);
  const base = Date.parse(T.baseline_at);
  for (let i = 0; i < 5; i++) g.edit({201: i % 2 ? '900' : '700'}, base + 60000 * (i + 1));
  // Each undo takes 30 ms here, and a call may spend 50 ms.
  const slow = async (url, init) => { if (String(url).includes('/undo')) await new Promise(r => setTimeout(r, 30)); return g.fetch(url, init); };
  const state = {resumed: false};
  const {rpc, calls} = fakeRpc(state);
  const claimedAt = new Date(Date.now() - 1000).toISOString();
  const row = () => ({...T, claimed_at: claimedAt, last_reset_at: calls.some(c => c.action === 'cleaned') ? new Date().toISOString() : '2026-10-11T02:30:00Z'});
  const callIo = {...io(g, rpc), fetch: slow, resetBudgetMs: 50, sb: async path => path.startsWith('proofreading_tests?') ? [row()] : CHECKS};
  const firstCall = await handle({action: 'test.start', args: {}, who, me, io: callIo});
  assert.equal(firstCall.resetting, true); assert.ok(firstCall.left > 0); assert.ok(g.undone.length > 0 && g.undone.length < 5);
  assert.ok(!calls.some(c => c.action === 'record'), 'running out of time is not a failure');
  state.resumed = true;   // the page calls again: the same claim
  let out = firstCall;
  for (let i = 0; i < 10 && out.resetting; i++) out = await handle({action: 'test.start', args: {}, who, me, io: callIo});
  assert.equal(out.resetting, undefined); assert.equal(out.root, '900');
  assert.equal(g.roots[201], '900', 'back at the start');
  assert.ok(calls.some(c => c.action === 'cleaned'));
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
    if (level === 'none') assert.deepEqual(Object.keys(out).sort(), ['feedback', 'passed', 'timedOut']);
    if (level === 'detail') {
      const miss = out.checks.find(c => c.kind === 'cut');
      assert.deepEqual(miss.point, [2, 2, 2]);
      assert.equal(miss.weight, 1, 'each check says what it weighs, so the page can list the biggest misses first');
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

test('submit: the admins are told the result, and a failed notice never costs the player theirs', async () => {
  assert.deepEqual(adminNote({username: 'nseraf'}, {passed: false, found: 3, errors: 7, endpoints: 39, endpointsFound: 12, damaged: 1, percent: 33}),
    {title: 'Proofreading Test: nseraf did not pass', body: '33 percent. 3 of 7 mistakes fixed, 12 of 39 branch ends marked, 1 real part of the cell damaged.'});
  assert.deepEqual(adminNote(null, {passed: true, found: 7, errors: 7, endpoints: 0, endpointsFound: 0, damaged: 0, percent: 100}),
    {title: 'Proofreading Test: A player passed', body: '100 percent. 7 of 7 mistakes fixed, nothing damaged.'});
  const g = fakeGraph(START);
  const {rpc} = fakeRpc({});
  const notes = [];
  const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me: {...me, username: 'ames'}, io: {...io(g, rpc), notifyAdmins: async n => { notes.push(n); }}});
  assert.equal(out.passed, false);
  assert.equal(notes.length, 1); assert.match(notes[0].title, /^Proofreading Test: ames did not pass$/); assert.match(notes[0].body, /0 of 2 mistakes fixed, 0 of 1 branch ends marked, nothing damaged/);
  const g2 = fakeGraph(START);
  const again = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me, io: {...io(g2, fakeRpc({}).rpc), notifyAdmins: async () => { throw new Error('no table'); }}});
  assert.equal(again.passed, false, 'the result still comes back');
  // Nothing is sent when a player only hands the cell back.
  const quiet = [];
  await handle({action: 'test.abandon', args: {id: T.id, session: SESSION}, who, me, io: {...io(fakeGraph(START), fakeRpc({}).rpc), notifyAdmins: async n => { quiet.push(n); }}});
  assert.equal(quiet.length, 0);
});

test('submit after the time limit: scored as it stands, marked as timed out', async () => {
  const late = {...T, deadline_at: new Date(Date.now() - 30000).toISOString()};
  const g = fakeGraph(START);
  const {rpc, calls} = fakeRpc({});
  const notes = [];
  const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me,
    io: {...io(g, rpc), sb: async path => path.startsWith('proofreading_tests?') ? [late] : CHECKS, notifyAdmins: async n => { notes.push(n); }}});
  assert.equal(out.timedOut, true); assert.equal(out.passed, false);
  assert.equal(calls.find(c => c.action === 'record').args.timed_out, true);
  assert.match(notes[0].body, /Time ran out\.$/);
  // In time: not marked.
  const onTime = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me,
    io: {...io(fakeGraph(START), fakeRpc({}).rpc), sb: async path => path.startsWith('proofreading_tests?') ? [{...T, deadline_at: new Date(Date.now() + 600000).toISOString()}] : CHECKS}});
  assert.equal(onTime.timedOut, false);
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

// ─── What the admins see (Admin Hub > Test tries, 2026-10-21) ────────────────

test('submit keeps the player\'s cell and their ends on the try, for the admins', async () => {
  const g = fakeGraph(START);
  g.edit({201: '700'}, Date.parse(T.baseline_at) + 60000);   // the neighbour cut off: the cell is now 900 without 201
  const {rpc} = fakeRpc({});
  const writes = [];
  const sb = async (path, init) => {
    if (init && init.method === 'PATCH') { writes.push({path, body: JSON.parse(init.body)}); return []; }
    return path.startsWith('proofreading_tests?') ? [T] : CHECKS;
  };
  await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: [[1000, 1000, 100]]}, who, me, io: {...io(g, rpc), sb}});
  assert.deepEqual(writes, [{path: 'proofreading_test_attempts?id=eq.7', body: {end_root: '900', ends_found: 1, ends_total: 1}}],
    'the root the soma had when scored, before the undos');
  // The columns not there yet: the player still gets their result.
  const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me,
    io: {...io(fakeGraph(START), fakeRpc({}).rpc), sb: async (path, init) => { if (init && init.method === 'PATCH') throw new Error('supabase 400'); return path.startsWith('proofreading_tests?') ? [T] : CHECKS; }}});
  assert.equal(out.passed, false);
  // An abandon keeps nothing.
  const quiet = [];
  await handle({action: 'test.abandon', args: {id: T.id, session: SESSION}, who, me,
    io: {...io(fakeGraph(START), fakeRpc({}).rpc), sb: async (path, init) => { if (init && init.method === 'PATCH') quiet.push(path); return path.startsWith('proofreading_tests?') ? [T] : CHECKS; }}});
  assert.deepEqual(quiet, []);
});

test('start: a try left unfinished is kept as it was left, before the cell is put back', async () => {
  const handed = '2026-10-21T02:50:00Z';
  const run = async (last, testRow = {...T, last_reset_at: handed}) => {
    const g = fakeGraph(START);
    g.edit({201: '700'}, Date.parse(T.baseline_at) + 60000); // their one fix, still on the cell
    const writes = [];
    const sb = async (path, init) => {
      if (init && init.method === 'PATCH') { writes.push({path, body: JSON.parse(init.body)}); return []; }
      if (path.startsWith('proofreading_tests?')) return [testRow];
      if (path.startsWith('proofreading_test_attempts?')) { assert.match(path, /test_id=eq\.[0-9a-f-]+&id=neq\.7&/); return last ? [last] : []; }
      return CHECKS;
    };
    const out = await handle({action: 'test.start', args: {}, who, me, io: {...io(g, fakeRpc({}).rpc), sb}});
    assert.equal(g.roots[201], '900', 'the cell was still put back');
    assert.equal(out.root, '900');
    return writes;
  };
  const kept = await run({id: 6, outcome: 'expired', started_at: '2026-10-21T02:49:00Z', end_root: null});
  assert.equal(kept.length, 1); assert.equal(kept[0].path, 'proofreading_test_attempts?id=eq.6');
  const b = kept[0].body;
  assert.equal(b.end_root, '900'); assert.equal(b.found, 1); assert.equal(b.errors, 2); assert.equal(b.damaged, 0);
  assert.deepEqual(b.checks.map(c => [c.kind, c.ok]), [['cut', true], ['keep', true], ['merge', false]], 'each mistake as it was left; no ends, they never reached the server');
  assert.equal('percent' in b, false, 'not a score');
  // Nothing kept: a scored try, one already kept, one never handed a clean cell, or none at all.
  assert.deepEqual(await run({id: 6, outcome: 'fail', started_at: '2026-10-21T02:49:00Z', end_root: null}), []);
  assert.deepEqual(await run({id: 6, outcome: 'expired', started_at: '2026-10-21T02:49:00Z', end_root: '123'}), []);
  assert.deepEqual(await run({id: 6, outcome: 'expired', started_at: '2026-10-21T02:55:00Z', end_root: null}), []);
  assert.deepEqual(await run(null), []);
});

test('test.tries and test.try: admins only; the list has counts, a try has its checks and cell', async () => {
  const PLAYER = {username: 'Kim_OZ', cave_user_id: 10711};
  const TRY = {id: 9, test_id: T.id, started_at: '2026-10-20T05:27:00Z', submitted_at: '2026-10-20T06:28:45Z', outcome: 'fail', found: 6, errors: 57,
    damaged: 1, percent: 16, timed_out: true, error: null, end_root: '648518346350612738', ends_found: 0, ends_total: 39, player: PLAYER,
    checks: [{kind: 'merge', label: 'piece', ok: false, weight: 6475, point_a: [3, 3, 3], point_b: null, state: 'apart'},
      {kind: 'keep', label: 'Branch 14', ok: false, weight: 0, point_a: [115194, 43603, 1000], point_b: null},
      {kind: 'endpoint', label: 'Branch end 1', ok: true, weight: 236, point_a: [9, 9, 9], point_b: null, radius: 1500}],
    endpoints: {given: [[9, 9, 9]], hit: 1, stray: 0}};
  const sb = admins => async path => {
    if (path.startsWith('admins?')) return admins;
    if (path.startsWith('proofreading_test_attempts?id=eq.9')) return [TRY];
    if (path.startsWith('proofreading_test_attempts?')) { const {checks, endpoints, ...row} = TRY; return [row]; }
    if (path.startsWith('proofreading_tests?select=id,title')) return [{...T, claimed_by: me.id, claimed_at: 'now'}];
    if (path.startsWith('proofreading_tests?')) return [T];
    if (path.startsWith('proofreading_test_checks?')) return CHECKS;
    if (path.startsWith('users?')) return [{username: 'Celia'}];
    throw new Error('unexpected ' + path);
  };
  const g = fakeGraph(START), {rpc} = fakeRpc({});
  for (const action of ['test.tries', 'test.try']) {
    await assert.rejects(() => handle({action, args: {attempt: 9}, who, me, io: {...io(g, rpc), sb: sb([{email: 'someone@else.invalid'}])}}), e => e.status === 403);
  }
  const admin = sb([{email: 'Player@Example.invalid'}]);   // the same person, other case
  const list = await handle({action: 'test.tries', args: {}, who, me, io: {...io(g, rpc), sb: admin}});
  assert.equal(list.kept, true);
  assert.deepEqual(list.key, {mistakes: 2, ends: 1, protect: 1, points: 3});
  assert.equal(list.test.holder, 'Celia'); assert.equal(list.test.pass_mark, 100);
  assert.equal(list.tries.length, 1);
  assert.equal(list.tries[0].username, 'Kim_OZ'); assert.equal(list.tries[0].cave_user_id, 10711); assert.equal(list.tries[0].end_root, '648518346350612738');
  assert.equal('player' in list.tries[0], false); assert.equal('checks' in list.tries[0], false, 'the list stays small');
  const one = await handle({action: 'test.try', args: {attempt: 9}, who, me, io: {...io(g, rpc), sb: admin}});
  assert.equal(one.end_root, '648518346350612738'); assert.equal(one.state_url, T.state_url); assert.equal(one.username, 'Kim_OZ');
  assert.deepEqual(one.checks.map(c => [c.kind, c.ok, c.point]), [['merge', false, [3, 3, 3]], ['keep', false, [115194, 43603, 1000]], ['endpoint', true, [9, 9, 9]]]);
  assert.deepEqual(one.given, [[9, 9, 9]]); assert.equal(one.stray, 0);
  await assert.rejects(() => handle({action: 'test.try', args: {attempt: 'x'}, who, me, io: {...io(g, rpc), sb: admin}}), /Unknown try/);
  // Before the tries SQL: the list still comes, without the cells.
  const old = async path => { if (path.startsWith('proofreading_test_attempts?') && path.includes('end_root')) throw new Error('supabase 400'); return admin(path); };
  const before = await handle({action: 'test.tries', args: {}, who, me, io: {...io(g, rpc), sb: old}});
  assert.equal(before.kept, false); assert.equal(before.tries.length, 1);
});

test('the line: join and leave go to the database; only admins take someone out; admins see the line', async () => {
  const calls = [];
  const rpc = async (action, args) => { calls.push({action, args}); return {ok: true}; };
  const sb = admins => async path => {
    if (path.startsWith('admins?')) return admins;
    if (path.startsWith('proofreading_test_queue?')) return [{user_id: me.id, test_id: T.id, joined_at: 't1', called_at: null, player: {username: 'Kim_OZ'}}];
    if (path.startsWith('proofreading_test_attempts?')) return [];
    if (path.startsWith('proofreading_tests?')) return [T];
    if (path.startsWith('proofreading_test_checks?')) return CHECKS;
    throw new Error('unexpected ' + path);
  };
  const g = fakeGraph(START);
  const base = {...io(g, rpc), sb: sb([])};
  await handle({action: 'test.queueJoin', args: {}, who, me, io: base});
  await handle({action: 'test.queueJoin', args: {id: T.id}, who, me, io: base});
  await handle({action: 'test.queueLeave', args: {}, who, me, io: base});
  assert.deepEqual(calls, [{action: 'queue_join', args: {}}, {action: 'queue_join', args: {id: T.id}}, {action: 'queue_leave', args: {}}]);
  await assert.rejects(() => handle({action: 'test.queueJoin', args: {id: 'x'}, who, me, io: base}), /Unknown test/);
  // Taking someone out: admins only, a real player id.
  await assert.rejects(() => handle({action: 'test.queueRemove', args: {user: me.id}, who, me, io: base}), e => e.status === 403);
  const admin = {...io(g, rpc), sb: sb([{email: who.email}])};
  await assert.rejects(() => handle({action: 'test.queueRemove', args: {user: 'nobody'}, who, me, io: admin}), /Unknown player/);
  await handle({action: 'test.queueRemove', args: {user: me.id}, who, me, io: admin});
  assert.deepEqual(calls.at(-1), {action: 'queue_remove', args: {user: me.id}});
  const list = await handle({action: 'test.tries', args: {}, who, me, io: admin});
  assert.deepEqual(list.line, [{user_id: me.id, test_id: T.id, joined_at: 't1', called_at: null, username: 'Kim_OZ'}]);
  // Before the line's SQL: an empty line, the list still comes.
  const noLine = async path => { if (path.startsWith('proofreading_test_queue?')) throw new Error('supabase 404'); return sb([{email: who.email}])(path); };
  assert.deepEqual((await handle({action: 'test.tries', args: {}, who, me, io: {...io(g, rpc), sb: noLine}})).line, []);
});

test('heat map: each try keeps the piece to color for each mistake, and the part a broken branch lost; the player never gets them', async () => {
  const g = fakeGraph(START);
  const baseline = Date.parse(T.baseline_at);
  g.edit({201: '700', 101: '700'}, baseline + 60000); // the spine cut off with the neighbour: damage
  const keyed = CHECKS.map(c => c.kind === 'cut' ? {...c, piece_root: '5550001'} : c.kind === 'merge' ? {...c, piece_root: '5550002'} : c);
  const {rpc, calls} = fakeRpc({});
  const sb = async path => path.startsWith('proofreading_tests?') ? [{...T, feedback: 'detail'}] : keyed;
  const out = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me, io: {...io(g, rpc), sb}});
  const kept = calls.find(c => c.action === 'record').args.checks;
  assert.deepEqual(kept.map(c => [c.kind, c.ok, c.seg]), [['cut', false, '5550001'], ['keep', false, '700'], ['merge', false, '5550002'], ['endpoint', false, undefined]],
    'the cut and merge pieces from the key; the spine as it was cut off');
  assert.ok(out.checks.every(c => !('seg' in c)), 'nothing for the heat map reaches the player');
  // A key without piece roots (before its SQL): nothing to color, the try still scores.
  const plain = await handle({action: 'test.submit', args: {id: T.id, session: SESSION, annotations: []}, who, me, io: io(fakeGraph(START), fakeRpc({}).rpc)});
  assert.equal(plain.passed, false);
  // What the admins get back for one try.
  const TRY = {id: 9, test_id: T.id, outcome: 'fail', end_root: '900', endpoints: {given: [[1, 1, 1]], hit: 0, stray: 1},
    checks: [...kept, {kind: 'endpoint', label: 'end', ok: false, weight: 1, point_a: [1000, 1000, 100], radius: 1500, seg: 'x'}]};
  const admin = async path => path.startsWith('admins?') ? [{email: who.email}] : path.startsWith('proofreading_test_attempts?') ? [TRY] : [T];
  const one = await handle({action: 'test.try', args: {attempt: 9}, who, me, io: {...io(g, rpc), sb: admin}});
  assert.deepEqual(one.checks.map(c => [c.kind, c.seg, c.radius]),
    [['cut', '5550001', undefined], ['keep', '700', undefined], ['merge', '5550002', undefined], ['endpoint', null, 1500], ['endpoint', null, 1500]],
    'segment ids only when they are ids; every end says its radius');
});
