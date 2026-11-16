// supabase-live-events.sql (perf audit 2026-11-14) on an in-memory
// PostgreSQL, set up the way Supabase is: anon and authenticated roles with
// default grants, the presence table and its join trigger as live. Step 1 is
// run twice. Synthetic rows only; no connection to production.
const {test} = require('node:test');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const { PGlite } = require('@electric-sql/pglite');
async function pglite() { return new PGlite(); }

test('supabase-live-events.sql tells joins, leaves and completions, and nothing else', async () => {
  const db = await pglite();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    CREATE TABLE users(id uuid PRIMARY KEY, display_name text);
    CREATE TABLE edit_log(id bigserial PRIMARY KEY, user_id uuid, operation text NOT NULL,
      timestamp timestamptz DEFAULT now(), metadata jsonb, dataset text, success boolean DEFAULT true, op_key text);
    CREATE UNIQUE INDEX idx_editlog_op_key ON edit_log(dataset, op_key) WHERE op_key IS NOT NULL;
    CREATE PUBLICATION supabase_realtime;
    INSERT INTO users VALUES ('${uid(1)}', 'amy'), ('${uid(2)}', 'nseraf');`);
  // The live presence table and its join stamp, as supabase-chat-presence-*.sql made them.
  const presence = read('supabase-chat-presence-and-link-screenshots.sql')
    .replace(/alter table working_links[^;]*;/i, '').replace(/notify pgrst[^;]*;/i, '');
  await db.exec(presence);
  await db.exec(read('supabase-chat-presence-dataset.sql').replace(/notify pgrst[^;]*;/ig, ''));
  await db.exec(`ALTER PUBLICATION supabase_realtime ADD TABLE edit_log;`);

  const sql = read('supabase-live-events.sql').replace(/NOTIFY pgrst[^;]*;/g, '');
  await db.exec(sql);
  await db.exec(sql);   // she may run it twice

  const events = async () => (await db.query(`SELECT kind, user_id, name, dataset, operation, cell FROM pyr_live_events ORDER BY id`)).rows;
  const clear = () => db.exec(`DELETE FROM pyr_live_events`);

  // A first heartbeat is a join; routine ones say nothing.
  await db.exec(`INSERT INTO chat_presence(user_id, name, dataset) VALUES ('${uid(1)}', 'amy', 'pni_mec')`);
  await db.exec(`INSERT INTO chat_presence(user_id, name) VALUES ('${uid(1)}', 'amy')
                 ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now(), name = excluded.name`);
  await db.exec(`UPDATE chat_presence SET last_seen_at = now(), dataset = 'stroeh_mouse_retina' WHERE user_id = '${uid(1)}'`);
  let ev = await events();
  assert.equal(ev.length, 1, 'one join, no heartbeats: ' + JSON.stringify(ev));
  assert.deepEqual(ev[0], { kind: 'join', user_id: uid(1), name: 'amy', dataset: 'pni_mec', operation: null, cell: null });

  // Back after more than two minutes away: a join again.
  await clear();
  await db.exec(`UPDATE chat_presence SET last_seen_at = now() - interval '5 minutes' WHERE user_id = '${uid(1)}'`);
  await clear();
  await db.exec(`UPDATE chat_presence SET last_seen_at = now() WHERE user_id = '${uid(1)}'`);
  ev = await events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'join');

  // Leaving carries the name.
  await clear();
  await db.exec(`DELETE FROM chat_presence WHERE user_id = '${uid(1)}'`);
  ev = await events();
  assert.deepEqual(ev.map(e => [e.kind, e.name]), [['leave', 'amy']]);

  // Completions only; failed ones and other edits say nothing; a repeat
  // swallowed by the op_key unique index says nothing either.
  await clear();
  await db.exec(`INSERT INTO edit_log(user_id, operation, dataset, metadata) VALUES
      ('${uid(2)}', 'merge', 'pni_mec', '{}'),
      ('${uid(2)}', 'split', 'pni_mec', '{}'),
      ('${uid(2)}', 'mark_complete', 'pni_mec', '{"final_segment_id":"864691135"}'),
      ('${uid(2)}', 'complete_task', 'stroeh_mouse_retina', '{"root_id":"720575940"}')`);
  await db.exec(`INSERT INTO edit_log(user_id, operation, dataset, metadata, success) VALUES ('${uid(2)}', 'mark_complete', 'pni_mec', '{}', false)`);
  await db.exec(`INSERT INTO edit_log(user_id, operation, dataset, op_key) VALUES ('${uid(2)}', 'mark_complete', 'pni_mec', 'k1')`);
  await db.exec(`INSERT INTO edit_log(user_id, operation, dataset, op_key) VALUES ('${uid(2)}', 'mark_complete', 'pni_mec', 'k1') ON CONFLICT DO NOTHING`);
  ev = await events();
  assert.deepEqual(ev.map(e => [e.kind, e.operation, e.dataset, e.cell]), [
    ['complete', 'mark_complete', 'pni_mec', '864691135'],
    ['complete', 'complete_task', 'stroeh_mouse_retina', '720575940'],
    ['complete', 'mark_complete', 'pni_mec', null],
  ]);

  // Published for Realtime; the busy tables are still published until step 2.
  const pub = (await db.query(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`)).rows.map(r => r.tablename);
  assert.deepEqual(pub, ['chat_presence', 'edit_log', 'pyr_live_events']);

  // A visitor can read the events, and cannot write them or call the trim.
  await db.exec(`SET ROLE anon`);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pyr_live_events`)).rows[0].n, 3);
  await assert.rejects(db.exec(`INSERT INTO pyr_live_events(kind, name) VALUES ('join', 'forged')`));
  await assert.rejects(db.exec(`DELETE FROM pyr_live_events`));
  await assert.rejects(db.exec(`SELECT pyr_live_events_trim()`));
  await db.exec(`RESET ROLE`);

  // The trim keeps the last hour.
  await db.exec(`INSERT INTO pyr_live_events(kind, at) VALUES ('join', now() - interval '2 hours')`);
  await db.exec(`SELECT pyr_live_events_trim()`);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pyr_live_events WHERE at < now() - interval '1 hour'`)).rows[0].n, 0);

  // Step 2, then the undo, both run as written.
  const step2 = sql.split('-- ── STEP 2')[1].split('-- ── UNDO')[0].split('\n').filter(l => l.startsWith('-- ')).map(l => l.slice(3)).join('\n');
  await db.exec(step2);
  await db.exec(step2);
  const pub2 = (await db.query(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`)).rows.map(r => r.tablename);
  assert.deepEqual(pub2, ['pyr_live_events']);
  const undo = sql.split('-- ── UNDO')[1].split('\n').filter(l => l.startsWith('-- ')).map(l => l.slice(3)).join('\n');
  await db.exec(undo);
  const pub3 = (await db.query(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`)).rows.map(r => r.tablename);
  assert.deepEqual(pub3, ['chat_presence', 'edit_log']);
  assert.equal((await db.query(`SELECT to_regclass('public.pyr_live_events') AS t`)).rows[0].t, null);
  // Heartbeats and edits still work with it all taken back out.
  await db.exec(`INSERT INTO chat_presence(user_id, name) VALUES ('${uid(2)}', 'nseraf')`);
  await db.exec(`INSERT INTO edit_log(user_id, operation, dataset) VALUES ('${uid(2)}', 'mark_complete', 'pni_mec')`);
});
