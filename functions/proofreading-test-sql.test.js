const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', ADMIN = '33333333-3333-4333-8333-333333333333';

test('pilot_test_action: one player at a time, holds, tries, the pass opens the pilot list', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE users(id uuid PRIMARY KEY, middleauth_email text);
      CREATE TABLE admins(email text);
      CREATE TABLE pilot_members(email text PRIMARY KEY CHECK (email = lower(trim(email)) AND email LIKE '%@%'), enabled boolean NOT NULL DEFAULT true, added_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO users VALUES('${A}','A@Example.invalid'),('${B}','b@example.invalid'),('${ADMIN}','admin@example.invalid');
      INSERT INTO admins VALUES('admin@example.invalid');`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase-proofreading-test.sql'), 'utf8'));
    const call = async (user, action, args) => (await db.query('SELECT public.pilot_test_action($1,$2,$3::jsonb) AS r', [user, action, JSON.stringify(args || {})])).rows[0].r;
    const one = async sql => (await db.query(sql)).rows[0];

    // No test yet.
    assert.deepEqual(await call(A, 'status'), {test: null});
    await assert.rejects(() => call(A, 'claim'), /no test/);
    const {id} = await one(`INSERT INTO proofreading_tests(title,dataset,pcg_server,pcg_table,state_url,anchor_supervoxel,hold_minutes,attempts_allowed,retry_hours,enabled)
      VALUES('Test','pinky_nf_v2','https://minnie.microns-daf.com','pinky_nf_v2','middleauth+https://x/1','100',30,2,1,true) RETURNING id`);
    await db.exec(`INSERT INTO proofreading_test_checks(test_id,ordinal,kind,label,supervoxel_a,supervoxel_b,point_a,point_b) VALUES('${id}',1,'cut','n','101','201','[1,1,1]','[2,2,2]')`);
    await assert.rejects(() => db.exec(`INSERT INTO proofreading_test_checks(test_id,kind,supervoxel_a,supervoxel_b) VALUES('${id}','cut','101','101')`), /check constraint/i);
    await assert.rejects(() => db.exec(`INSERT INTO proofreading_test_checks(test_id,kind) VALUES('${id}','endpoint')`), /check constraint/i);
    // Nobody outside: a profile is needed.
    await assert.rejects(() => call('44444444-4444-4444-8444-444444444444', 'status'), /profile/);

    let s = await call(A, 'status');
    assert.equal(s.test.id, id); assert.equal(s.free, true); assert.equal(s.can_start, true); assert.equal(s.attempts, 0);
    assert.ok(!('anchor_supervoxel' in s.test) && !('baseline_at' in s.test), 'the public shape carries no answers');
    assert.equal(s.test.grants, true, 'a pass grants by default');
    await db.exec(`UPDATE proofreading_tests SET grant_pilot = false, cave_groups = '{}' WHERE id = '${id}'`);
    assert.equal((await call(A, 'status')).test.grants, false, 'a trial run grants nothing');
    await db.exec(`UPDATE proofreading_tests SET grant_pilot = true, cave_groups = '{203}' WHERE id = '${id}'`);
    // The public view shows only the enabled test, with no answers.
    const view = await db.query('SELECT * FROM proofreading_tests_public');
    assert.equal(view.rows.length, 1); assert.deepEqual(Object.keys(view.rows[0]).sort(), ['claimed_by', 'expires_at', 'hold_minutes', 'id', 'status', 'title']);

    // A claims; B is turned away; A's reload resumes the same session.
    const c1 = await call(A, 'claim');
    assert.equal(c1.resumed, false); assert.equal(c1.was, 'ready'); assert.match(c1.session, /^[0-9a-f-]{36}$/);
    await assert.rejects(() => call(B, 'claim'), /Someone else/);
    assert.equal((await call(B, 'status')).free, false);
    const again = await call(A, 'claim');
    assert.equal(again.resumed, true); assert.equal(again.session, c1.session); assert.equal(again.attempt, c1.attempt);
    // The hold needs the right session.
    await assert.rejects(() => call(A, 'heartbeat', {id, session: B}), /has ended/);
    await assert.rejects(() => call(B, 'heartbeat', {id, session: c1.session}), /has ended/);
    assert.ok((await call(A, 'heartbeat', {id, session: c1.session})).expires_at);
    await call(A, 'cleaned', {id, session: c1.session});
    assert.equal((await one(`SELECT reset_failures FROM proofreading_tests WHERE id='${id}'`)).reset_failures, 0);

    // A fails: counted, the cell goes back, the retry wait starts.
    const r1 = await call(A, 'record', {id, session: c1.session, outcome: 'fail', found: 0, errors: 1, damaged: 0, percent: 0, checks: [{kind: 'cut', ok: false}], clean: true});
    assert.equal(r1.outcome, 'fail'); assert.equal(r1.status, 'ready');
    s = await call(A, 'status');
    assert.equal(s.attempts, 1); assert.equal(s.last.outcome, 'fail'); assert.ok(s.wait_until); assert.equal(s.can_start, false);
    await assert.rejects(() => call(A, 'claim'), /Try again after/);
    assert.equal((await one('SELECT count(*)::int AS n FROM pilot_members')).n, 0);
    // An admin may take it any time.
    const ca = await call(ADMIN, 'claim');
    await call(ADMIN, 'record', {id, session: ca.session, outcome: 'abandoned', clean: true});
    assert.equal((await call(ADMIN, 'status')).attempts, 0, 'abandoned tries do not count');

    // The wait over, A passes: the pilot list gets A's email, lower case.
    await db.exec(`UPDATE proofreading_test_attempts SET submitted_at = now() - interval '2 hours' WHERE user_id='${A}'`);
    const c2 = await call(A, 'claim');
    const r2 = await call(A, 'record', {id, session: c2.session, outcome: 'pass', found: 1, errors: 1, damaged: 0, percent: 100, checks: [], granted: {groups: [{id: 203, ok: true}]}, clean: true});
    assert.equal(r2.outcome, 'pass');
    assert.deepEqual(await one('SELECT email, enabled, added_by FROM pilot_members'), {email: 'a@example.invalid', enabled: true, added_by: null});
    s = await call(A, 'status');
    assert.equal(s.passed, true); assert.equal(s.can_start, false); assert.equal(s.attempts, 2);
    await assert.rejects(() => call(A, 'claim'), /already passed/);
    assert.equal((await one(`SELECT granted->'groups'->0->>'id' AS g FROM proofreading_test_attempts WHERE outcome='pass'`)).g, '203');

    // B uses both tries.
    const b1 = await call(B, 'claim');
    await call(B, 'record', {id, session: b1.session, outcome: 'fail', found: 0, errors: 1, damaged: 1, percent: 0, clean: true});
    await db.exec(`UPDATE proofreading_test_attempts SET submitted_at = now() - interval '2 hours' WHERE user_id='${B}'`);
    const b2 = await call(B, 'claim');
    await call(B, 'record', {id, session: b2.session, outcome: 'fail', found: 0, errors: 1, damaged: 0, percent: 0, clean: true});
    await db.exec(`UPDATE proofreading_test_attempts SET submitted_at = now() - interval '2 hours' WHERE user_id='${B}'`);
    await assert.rejects(() => call(B, 'claim'), /No tries left/);

    // A hold that ran out: the attempt expires, the cell waits for a reset,
    // and the next claim gets it (the server puts it back before showing it).
    await db.exec(`UPDATE proofreading_test_attempts SET outcome=NULL, submitted_at=NULL WHERE user_id='${B}' AND id=(SELECT max(id) FROM proofreading_test_attempts WHERE user_id='${B}')`);
    await db.exec(`UPDATE proofreading_tests SET status='in_use', claimed_by='${B}', claim_nonce=(SELECT claim_nonce FROM proofreading_test_attempts WHERE user_id='${B}' ORDER BY id DESC LIMIT 1), expires_at=now()-interval '1 minute' WHERE id='${id}'`);
    s = await call(ADMIN, 'status');
    assert.equal(s.test.status, 'needs_reset');
    assert.equal((await one(`SELECT outcome FROM proofreading_test_attempts WHERE user_id='${B}' ORDER BY id DESC LIMIT 1`)).outcome, 'expired');
    const c3 = await call(ADMIN, 'claim');
    assert.equal(c3.was, 'needs_reset');
    // Three failed resets in a row: broken, nobody is handed it.
    for (let i = 0; i < 3; i++) {
      const c = i === 0 ? c3 : await call(ADMIN, 'claim');
      await call(ADMIN, 'record', {id, session: c.session, outcome: 'error', clean: false, error: 'undo failed'});
    }
    assert.equal((await one(`SELECT status, reset_failures FROM proofreading_tests WHERE id='${id}'`)).status, 'broken');
    await assert.rejects(() => call(ADMIN, 'claim'), /needs an admin/);
    // The public roles cannot read the answers.
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(() => db.query('SELECT * FROM proofreading_test_checks'), /permission denied/);
      await assert.rejects(() => db.query('SELECT * FROM proofreading_test_attempts'), /permission denied/);
      await assert.rejects(() => db.query(`SELECT public.pilot_test_action('${A}','status','{}')`), /permission denied/);
      await db.exec('RESET ROLE');
    }
  } finally { await db.close(); }
});
