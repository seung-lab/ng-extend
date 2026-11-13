'use strict';
// Cell match (sandbox-match.js) against a fake chunkedgraph and database,
// and its SQL (supabase-sandbox-match.sql) on an in-memory PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./sandbox-match');

const ME = {id: '22222222-2222-4222-8222-222222222222'};
const OTHER = {id: '33333333-3333-4333-8333-333333333333'};
const range = (a, b) => Array.from({length: b - a + 1}, (_, i) => String(a + i));

// ── The pure rules ─────────────────────────────────────────────────────────

test('sets: sorted, unique, and differences', () => {
  const a = M.toSet(['5', '3', '3', '76492337823715273', '1']);
  assert.deepEqual([...a].map(String), ['1', '3', '5', '76492337823715273']);
  const b = M.toSet(['3', '4', '76492337823715273']);
  assert.deepEqual([...M.minus(a, b)].map(String), ['1', '5']);
  assert.equal(M.countMinus(a, b), 2);
  assert.equal(M.countMinus(b, a), 1);
  assert.equal(M.countMinus(a, new BigUint64Array()), 4);
});

test('ids past 2^53 keep every digit', () => {
  const big = ['648518346351543560', '648518346351543561'];
  assert.deepEqual([...M.toSet(big)].map(String), big);
});

test('score: shared over the two cells together, 0 to 100, rounded down', () => {
  // A cell that starts close reads high from the start, not 0.
  assert.equal(M.scorePercent({truthSize: 1000, missingNow: 100, extraNow: 60}), 84);
  assert.equal(M.scorePercent({truthSize: 1000, missingNow: 0, extraNow: 0}), 100);
  // A wrong merge brings it down.
  assert.equal(M.scorePercent({truthSize: 1000, missingNow: 0, extraNow: 1000}), 50);
  assert.equal(M.scorePercent({truthSize: 0, missingNow: 0, extraNow: 0}), null);
});

test('match: share of the starting error that is fixed, 0 to 100, rounded down', () => {
  assert.equal(M.matchPercent({missingNow: 100, extraNow: 60, missingStart: 100, extraStart: 60}), 0);
  assert.equal(M.matchPercent({missingNow: 40, extraNow: 60, missingStart: 100, extraStart: 60}), 37);
  assert.equal(M.matchPercent({missingNow: 0, extraNow: 0, missingStart: 100, extraStart: 60}), 100);
  // Worse than the start never reads below 0.
  assert.equal(M.matchPercent({missingNow: 300, extraNow: 60, missingStart: 100, extraStart: 60}), 0);
  // Nothing wrong at the start: nothing to measure.
  assert.equal(M.matchPercent({missingNow: 0, extraNow: 0, missingStart: 0, extraStart: 0}), null);
});

test('merge and cut: each its own share, by size; nothing to cut stays null until something is', () => {
  // Ames's cell 16753: a 322 supervoxel merger, 12 left after her cut.
  assert.equal(M.partPercent(12, 322), 96);
  assert.equal(M.partPercent(32650, 32650), 0);
  assert.equal(M.partPercent(32650 - 11292, 32650), 34);
  assert.equal(M.partPercent(0, 322), 100);
  // Worse than the start never reads below 0.
  assert.equal(M.partPercent(500, 322), 0);
  assert.equal(M.partPercent(0, 0), null);
  assert.equal(M.partPercent(40, 0), 0);
});

test('pieces: grouped by segment, specks left out, biggest first, same samples every time', () => {
  const svs = [...range(1, 60), ...range(61, 100), ...range(101, 220)];
  const roots = [...svs.slice(0, 60).map(() => 'A'), ...svs.slice(60, 100).map(() => 'B'), ...svs.slice(100).map(() => 'C')];
  const p = M.groupPieces(svs, roots, {seed: '7'});
  assert.deepEqual(p.map(x => [x.root, x.size]), [['C', 120], ['A', 60]]);
  for (const x of p) assert.equal(x.samples.length, M.SAMPLES);
  assert.deepEqual(M.groupPieces(svs, roots, {seed: '7'}), p);
  assert.ok(p[1].samples.every(sv => +sv >= 1 && +sv <= 60));
});

test('pieces left: found at 80 percent of samples in, removed at 80 percent out', () => {
  const piece = {root: 'A', size: 60, samples: ['1', '2', '3', '4', '5']};
  const roots = (inside) => Object.fromEntries(piece.samples.map((sv, i) => [sv, i < inside ? 'CELL' : 'X']));
  assert.equal(M.piecesLeft([piece], roots(3), 'CELL', 'missing'), 1);
  assert.equal(M.piecesLeft([piece], roots(4), 'CELL', 'missing'), 0);
  assert.equal(M.piecesLeft([piece], roots(2), 'CELL', 'extra'), 1);
  assert.equal(M.piecesLeft([piece], roots(1), 'CELL', 'extra'), 0);
});

// ── A fake world ───────────────────────────────────────────────────────────
// pinky_training (the truth): cell T = svs 1..200 (soma 1); a neighbor N =
// 300..359. The Sandbox at the start: the player's cell = 1..100 + 300..359;
// missing segment A = 101..160 (a piece), B = 161..200 (40, a speck).

function world() {
  const T0 = Date.parse('2026-11-01T00:00:00Z');
  const sandbox = {
    events: [{at: 0, groups: {S0: [...range(1, 100), ...range(300, 359)], A: range(101, 160), B: range(161, 200)}}],
    rootAt(sv, at) { let g = this.events[0].groups; for (const e of this.events) if (e.at <= at) g = e.groups; for (const [r, l] of Object.entries(g)) if (l.includes(sv)) return r; return '0'; },
    leaves(root) { for (const e of this.events) if (e.groups[root]) return e.groups[root]; return []; },
    edit(groups) { this.events.push({at: Date.now(), groups}); },
  };
  const truth = {
    groups: {T: range(1, 200), N: range(300, 359)},
    rootAt(sv) { for (const [r, l] of Object.entries(this.groups)) if (l.includes(sv)) return r; return '0'; },
    leaves(root) { return this.groups[root] || []; },
  };
  // Root names that look like ids.
  const ID = {S0: '9001', A: '9002', B: '9003', S1: '9004', S2: '9005', N2: '9006', T: '8001', N: '8002'};
  const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]));
  const calls = {leaves: 0, roots: 0, root: 0};
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const g = u.pathname.includes('/table/pinky_training/') ? truth : sandbox;
    const ts = u.searchParams.get('timestamp');
    const at = ts ? Number(ts) * 1000 : Date.now() + 1;
    const ok = body => ({ok: true, status: 200, json: async () => body, arrayBuffer: async () => body});
    let m;
    if ((m = u.pathname.match(/\/node\/(\d+)\/root$/))) { calls.root++; return ok({root_id: ID[g.rootAt(m[1], at)] || '0'}); }
    if ((m = u.pathname.match(/\/node\/(\d+)\/leaves$/))) { calls.leaves++; return ok({leaf_ids: g.leaves(NAME[m[1]])}); }
    if (u.pathname.endsWith('/roots_binary')) {
      calls.roots++;
      const buf = Buffer.from(init.body); const out = Buffer.alloc(buf.length);
      for (let i = 0; i < buf.length / 8; i++) out.writeBigUInt64LE(BigInt(ID[g.rootAt(buf.readBigUInt64LE(i * 8).toString(), at)] || 0), i * 8);
      return ok(out.buffer.slice(out.byteOffset, out.byteOffset + out.length));
    }
    return {ok: false, status: 404};
  };
  const db = {
    tasks: [
      {id: 1, dataset: 'pinky_nf_v2', supervoxel_id: '1', created_at: new Date(T0).toISOString(), assigned_to: ME.id, status: 'assigned'},
      {id: 2, dataset: 'stroeh_mouse_retina', supervoxel_id: '1', created_at: new Date(T0).toISOString(), assigned_to: ME.id, status: 'assigned'},
      {id: 3, dataset: 'pinky_nf_v2', supervoxel_id: '1', created_at: new Date(T0).toISOString(), assigned_to: OTHER.id, status: 'assigned'},
    ],
    keys: {}, records: [],
  };
  const sb = async (p, init = {}) => {
    let m;
    if ((m = p.match(/^proofreading_tasks\?id=eq\.(\d+)/))) return db.tasks.filter(t => t.id === +m[1]);
    if ((m = p.match(/^sandbox_match_keys\?task_id=eq\.(\d+)/))) return db.keys[m[1]] ? [JSON.parse(JSON.stringify(db.keys[m[1]]))] : [];
    if (p.startsWith('sandbox_match_keys?on_conflict')) { const k = JSON.parse(init.body); db.keys[k.task_id] = k; return null; }
    if (p === 'rpc/sandbox_match_record') { db.records.push(JSON.parse(init.body)); return null; }
    throw new Error('unexpected ' + p);
  };
  return {io: {fetch, sb, caveToken: 'x'}, sandbox, truth, ID, calls, db};
}

test('a check builds the key once, then scores each edit', async () => {
  M._reset();
  const w = world();
  const first = await M.check(w.io, {taskId: 1, me: ME});
  assert.deepEqual(first, {taskId: 1, scorable: true, root: w.ID.S0, match: 0, score: 38, merge: 0, cut: 0, missing: {left: 1, total: 1}, extra: {left: 1, total: 1}});
  const key = w.db.keys[1];
  assert.equal(key.truth_root, w.ID.T);
  assert.equal(key.start_root, w.ID.S0);
  assert.equal(key.missing_start, 100);
  assert.equal(key.extra_start, 60);
  assert.deepEqual(key.missing_pieces.map(p => [p.root, p.size]), [[w.ID.A, 60]]);
  assert.deepEqual(key.extra_pieces.map(p => [p.root, p.size]), [[w.ID.N, 60]]);

  // The player merges A.
  w.sandbox.edit({S1: [...range(1, 160), ...range(300, 359)], B: range(161, 200)});
  const merged = await M.check(w.io, {taskId: 1, me: ME});
  assert.equal(merged.match, 37);
  // Merge and cut each count their own start: 60 of 100 missing merged in.
  assert.equal(merged.merge, 60);
  assert.equal(merged.cut, 0);
  assert.deepEqual(merged.missing, {left: 0, total: 1});
  assert.deepEqual(merged.extra, {left: 1, total: 1});

  // Then cuts the neighbor off.
  w.sandbox.edit({S2: range(1, 160), N2: range(300, 359), B: range(161, 200)});
  const cut = await M.check(w.io, {taskId: 1, me: ME});
  assert.equal(cut.match, 75);
  assert.equal(cut.merge, 60);
  assert.equal(cut.cut, 100);
  assert.deepEqual(cut.extra, {left: 0, total: 1});

  // The key was kept, not rebuilt; every check was recorded.
  assert.equal(w.db.records.length, 3);
  assert.deepEqual(w.db.records.map(r => r.p_match), [0, 37, 75]);
  assert.equal(w.db.records[2].p_user, ME.id);
});

test('review: the missed pieces as their own segments, the mergers still attached as points', async () => {
  M._reset();
  const w = world();
  const r = await M.review(w.io, {taskId: 1, me: ME});
  assert.equal(r.merge, 0);
  assert.deepEqual(r.missed.map(p => [p.root, p.size]), [[w.ID.A, 60]]);
  assert.equal(r.mergers.length, 1);
  assert.equal(r.mergers[0].size, 60);
  assert.equal(r.mergers[0].pointNm.length, 3);
  // Merged A and cut the neighbor off: nothing left to show.
  w.sandbox.edit({S2: range(1, 160), N2: range(300, 359), B: range(161, 200)});
  const done = await M.review(w.io, {taskId: 1, me: ME});
  assert.deepEqual([done.missed, done.mergers], [[], []]);
  // Someone else's cell is not reviewed.
  await assert.rejects(M.review(w.io, {taskId: 3, me: ME}), {status: 403});
  // Through the handler too.
  const viaHandle = await M.handle({action: 'match.review', args: {taskId: 1}, me: ME, io: w.io});
  assert.deepEqual(viaHandle.missed, []);
});

test('a supervoxel id gives a point near it: the soma of Sandbox task 16753', () => {
  // Its claim point is 79379, 40919, 1662 in 4 x 4 x 40 nm voxels.
  const [x, y, z] = M.svPointNm('75013769294282897');
  assert.ok(Math.abs(x / 4 - 79379) < 600 && Math.abs(y / 4 - 40919) < 600 && Math.abs(z / 40 - 1662) < 70, [x / 4, y / 4, z / 40].join(','));
});

test('the same cell checked twice reads its supervoxels once', async () => {
  M._reset();
  const w = world();
  await M.check(w.io, {taskId: 1, me: ME});
  const before = w.calls.leaves;
  await M.check(w.io, {taskId: 1, me: ME});
  assert.equal(w.calls.leaves, before);
});

test('a key from older truth is rebuilt', async () => {
  M._reset();
  const w = world();
  w.db.keys[1] = {task_id: 1, version: 'old', scorable: false};
  const r = await M.check(w.io, {taskId: 1, me: ME});
  assert.equal(r.scorable, true);
  assert.equal(w.db.keys[1].version, M.KEY_VERSION);
});

test('a cell already identical to the true cell shows no score', async () => {
  M._reset();
  const w = world();
  w.truth.groups = {T: [...range(1, 100), ...range(300, 359)], N: range(101, 200)};
  const r = await M.check(w.io, {taskId: 1, me: ME});
  assert.deepEqual(r, {taskId: 1, scorable: false});
  assert.equal(w.db.records.length, 0);
});

test('only Sandbox cells, only your own claim (admins see any), only signed in', async () => {
  M._reset();
  const w = world();
  await assert.rejects(M.check(w.io, {taskId: 2, me: ME}), {status: 400});
  await assert.rejects(M.check(w.io, {taskId: 3, me: ME}), {status: 403});
  await assert.rejects(M.check(w.io, {taskId: 1, me: null}), {status: 403});
  await assert.rejects(M.check(w.io, {taskId: 99, me: ME}), {status: 404});
  await assert.rejects(M.check(w.io, {taskId: 'x', me: ME}), {status: 400});
  const r = await M.check(w.io, {taskId: 3, me: ME, isAdmin: true});
  assert.equal(r.scorable, true);
  await assert.rejects(M.handle({action: 'match.other', args: {}, me: ME, io: w.io}), {status: 400});
});

test('the start cell is read as of the task, the true cell as of the frozen time', async () => {
  M._reset();
  const w = world();
  const seen = [];
  const inner = w.io.fetch;
  w.io.fetch = (url, init) => { seen.push(url); return inner(url, init); };
  await M.buildKey(w.io, w.db.tasks[0]);
  const rootCalls = seen.filter(u => u.includes('/root?'));
  const sandboxRoot = rootCalls.find(u => u.includes('pinky_nf_v2'));
  const truthRoot = rootCalls.find(u => u.includes('pinky_training'));
  assert.match(sandboxRoot, new RegExp(`timestamp=${Date.parse(w.db.tasks[0].created_at) / 1000}`));
  assert.match(truthRoot, new RegExp(`timestamp=${Date.parse(M.TRUTH.at) / 1000}`));
});

test('without the tables (SQL not run) the player still gets a number', async () => {
  M._reset();
  const w = world();
  const inner = w.io.sb;
  w.io.sb = async (p, init) => {
    if (p.startsWith('sandbox_match_') || p.startsWith('rpc/sandbox_match')) throw new Error('supabase 404');
    return inner(p, init);
  };
  const r = await M.check(w.io, {taskId: 1, me: ME});
  assert.equal(r.match, 0);
  assert.equal(r.scorable, true);
});

// ── The SQL ────────────────────────────────────────────────────────────────

test('SQL: runs twice, keeps last and best, closed to the public', async () => {
  const {PGlite} = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE proofreading_tasks(id serial PRIMARY KEY, dataset text);
    INSERT INTO users VALUES ('${ME.id}'); INSERT INTO proofreading_tasks(dataset) VALUES ('pinky_nf_v2');`);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase-sandbox-match.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const rec = (m) => db.query('SELECT sandbox_match_record($1,1,$2,$3,1,2,0,1)', [ME.id, m, 'r' + m]);
  await rec(40); await rec(70); await rec(55);
  const row = (await db.query('SELECT match, best_match, checks, root FROM sandbox_match_scores')).rows[0];
  assert.deepEqual(row, {match: 55, best_match: 70, checks: 3, root: 'r55'});
  for (const t of ['sandbox_match_keys', 'sandbox_match_scores']) {
    const g = (await db.query(`SELECT has_table_privilege('anon', '${t}', 'SELECT') a, has_table_privilege('authenticated', '${t}', 'SELECT') b`)).rows[0];
    assert.deepEqual(g, {a: false, b: false}, t);
  }
  const f = (await db.query(`SELECT has_function_privilege('anon', 'sandbox_match_record(uuid,integer,integer,text,integer,integer,integer,integer)', 'EXECUTE') a`)).rows[0];
  assert.equal(f.a, false);
});
