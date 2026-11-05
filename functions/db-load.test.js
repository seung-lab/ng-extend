// supabase-db-load.sql (2026-10-25), run step by step on an in-memory
// PostgreSQL the way the SQL editor runs it. Synthetic rows only; no
// connection to production. Every number the site reads must be the same
// before and after, the hourly edit totals must follow the log, and each
// step's undo must bring the old objects back.
const {test} = require('node:test');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const REPO = path.join(__dirname, '..'), LOAD = path.join(REPO, 'supabase-db-load.sql');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('supabase-db-load.sql keeps every number and undoes cleanly', async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE users(id uuid PRIMARY KEY,display_name text DEFAULT '',username text,flag text,bio text,
      total_edits integer DEFAULT 0,total_merges integer DEFAULT 0,total_splits integer DEFAULT 0,
      cells_completed integer DEFAULT 0,current_streak integer DEFAULT 0,longest_streak integer DEFAULT 0,
      last_edit_date date,total_annotations integer NOT NULL DEFAULT 0,total_days integer DEFAULT 0,
      tz text,streak_recounted_at timestamptz,days_recounted_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE proofreading_tasks(id serial PRIMARY KEY,segment_id text NOT NULL,
      dataset text NOT NULL DEFAULT 'eyewire_ii',status text NOT NULL DEFAULT 'pending',
      assigned_to uuid,priority int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE edit_log(id bigserial PRIMARY KEY,task_id integer REFERENCES proofreading_tasks(id),
      user_id uuid REFERENCES users(id),operation text NOT NULL,timestamp timestamptz DEFAULT now(),
      segment_before text,segment_after text,coordinates text,metadata jsonb,
      dataset text DEFAULT 'eyewire_ii',success boolean DEFAULT true,op_key text);
    CREATE TABLE weekly_winners(id serial PRIMARY KEY,week_start date NOT NULL,rank integer NOT NULL,
      user_id uuid NOT NULL,edits integer NOT NULL,metric text NOT NULL DEFAULT 'edits',
      recorded_at timestamptz DEFAULT now(),UNIQUE(week_start,rank,metric));
    CREATE TABLE task_assignments(id serial PRIMARY KEY,task_id int,user_id uuid,status text);
    CREATE TABLE help_requests(id serial PRIMARY KEY,user_id uuid,dataset text);
    CREATE TABLE issue_tags(id serial PRIMARY KEY,created_at timestamptz DEFAULT now());
    CREATE PUBLICATION supabase_realtime;
    INSERT INTO users(id,display_name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p'||n FROM generate_series(1,6) n;`);
  for (const f of ['supabase-leaderboard-accuracy.sql', 'supabase-completions-same-cell.sql',
                   'supabase-leaderboard-board.sql', 'supabase-dataset-stats.sql']) await db.exec(read(f));
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS edit_log_op_key ON edit_log(dataset, op_key) WHERE op_key IS NOT NULL;`);

  // Synthetic history: 6 players, edits and completions over 20 days, 3 datasets, a few failures and un-marks.
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const ds = ['stroeh_mouse_retina', 'pni_mec', 'eyewire_ii'];
  for (let i = 0; i < 3000; i++) {
    const u = uid(1 + Math.floor(rnd() * 6)), d = ds[Math.floor(rnd() * 3)];
    const at = new Date(Date.now() - rnd() * 20 * 86400000).toISOString();
    const r = rnd();
    const op = r < .7 ? (rnd() < .5 ? 'merge' : 'split') : r < .9 ? 'mark_complete' : r < .95 ? 'unmark_complete' : 'annotate';
    const seg = String(864691000 + Math.floor(rnd() * 120));
    await db.query(`INSERT INTO edit_log(user_id,operation,timestamp,dataset,success,metadata,segment_after) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [u, op, at, d, rnd() > .05, JSON.stringify(op === 'annotate' ? { count: 3 } : { root_id: seg }), seg]);
  }
  for (let i = 0; i < 40; i++) await db.query(`INSERT INTO proofreading_tasks(segment_id,status,dataset) VALUES($1,$2,'stroeh_mouse_retina')`,
    [String(864691000 + i), ['completed', 'pending', 'assigned', 'skipped'][i % 4]]);

  const snap = async () => ({
    uec: (await db.query(`SELECT id,edits_24h,edits_week,edits_alltime,completions_24h,completions_week,completions_alltime,total_edits FROM user_edit_counts ORDER BY id`)).rows,
    board: (await db.query(`SELECT * FROM leaderboard_board ORDER BY id`)).rows,
    cells: (await db.query(`SELECT user_id,dataset,cell,done_at FROM ew_cell_completions ORDER BY 1,2,3`)).rows,
    prog: (await db.query(`SELECT * FROM ew_dataset_progress ORDER BY dataset`)).rows,
    weekly: (await db.query(`SELECT * FROM ew_dataset_weekly ORDER BY dataset,week_start`)).rows,
    types: (await db.query(`SELECT * FROM ew_dataset_types ORDER BY dataset,cell_type`)).rows,
    people: (await db.query(`SELECT * FROM ew_dataset_people ORDER BY dataset,proofreader`)).rows,
    work: (await db.query(`SELECT * FROM ew_dataset_work ORDER BY dataset,user_id`)).rows,
  });
  const before = await snap();
  // Ranks as the client counts them today: 1 + players with more.
  const ranksBefore = {};
  for (const r of before.uec) ranksBefore[r.id] = 1 + before.uec.filter(o => o.edits_week > r.edits_week).length;

  // Run the file step by step, as Ames would in the SQL editor.
  const sql = fs.readFileSync(LOAD, 'utf8');
  const steps = sql.split(/^-- @@/m).slice(1);
  for (const block of steps) {
    const name = block.split('\n')[0];
    if (/^STEP 1:|^STEP 10:|^ROLLBACK/.test(name)) continue;               // pg_stat_statements / checks / undo
    let body = ('-- ' + block).replace(/^SELECT cron\.schedule\([\s\S]*?\);\s*$/gm, '')  // no pg_cron here
                    .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, '');
    if (/^CREATE INDEX CONCURRENTLY/m.test(body)) {
      for (const st of body.match(/CREATE INDEX CONCURRENTLY[\s\S]*?;/g)) await db.query(st);
    } else {
      await db.exec(body);
    }
  }
  await db.exec(`SELECT refresh_leaderboard_cache(); SELECT refresh_dataset_stats_cache();`);

  const after = await snap();
  for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], `${k} changed`);
  const ranks = (await db.query(`SELECT id,rank_edits_week FROM user_edit_counts`)).rows;
  for (const r of ranks) assert.equal(r.rank_edits_week, ranksBefore[r.id], 'rank');

  // Hours table equals the log, then follows new edits, deletes and a flipped success flag.
  const check = async label => {
    const bad = (await db.query(`SELECT l.user_id FROM (SELECT user_id,COALESCE(dataset,'') dataset,count(*) FILTER (WHERE operation='merge') m,count(*) FILTER (WHERE operation='split') s
        FROM edit_log WHERE user_id IS NOT NULL AND operation IN ('merge','split') AND success IS NOT FALSE GROUP BY 1,2) l
      FULL JOIN (SELECT user_id,dataset,sum(merges) m,sum(splits) s FROM ew_user_edit_hours GROUP BY 1,2) h USING (user_id,dataset)
      WHERE l.m IS DISTINCT FROM h.m OR l.s IS DISTINCT FROM h.s`)).rows;
    assert.equal(bad.length, 0, 'hours ' + label);
  };
  await check('after backfill');
  await db.exec(`INSERT INTO edit_log(user_id,operation,dataset) VALUES('${uid(1)}','merge','pni_mec'),('${uid(2)}','split',NULL);`);
  await db.exec(`DELETE FROM edit_log WHERE id IN (SELECT id FROM edit_log WHERE operation='merge' ORDER BY id LIMIT 5);`);
  await db.exec(`UPDATE edit_log SET success=false WHERE id IN (SELECT id FROM edit_log WHERE operation='split' AND success ORDER BY id LIMIT 5);`);
  await db.exec(`UPDATE edit_log SET success=true WHERE id IN (SELECT id FROM edit_log WHERE operation='merge' AND NOT success ORDER BY id LIMIT 3);`);
  await check('after changes');

  // Time zone functions still work through the stored list.
  await db.exec(`UPDATE users SET tz='America/New_York' WHERE id='${uid(3)}';`);
  const r = (await db.query(`SELECT ew_log_activity('${uid(3)}', '{"operation":"merge","dataset":"pni_mec"}'::jsonb) AS j`)).rows[0].j;
  assert.equal(r.recorded, true);
  const t = (await db.query(`SELECT ew_touch_streak('${uid(4)}', 'Europe/Paris') AS j`)).rows[0].j;
  assert.equal(t.tz, 'Europe/Paris');
  const bogus = (await db.query(`SELECT ew_touch_streak('${uid(5)}', 'Not/AZone') AS j`)).rows[0].j;
  assert.equal(bogus.tz, 'UTC');

  // A new completion shows up after the next refresh.
  await db.exec(`INSERT INTO edit_log(user_id,operation,dataset,metadata) VALUES('${uid(6)}','mark_complete','pni_mec','{"root_id":"999"}');
                 SELECT refresh_leaderboard_cache();`);
  const live = (await db.query(`SELECT completions_alltime FROM user_edit_counts_live WHERE id='${uid(6)}'`)).rows[0];
  const cached = (await db.query(`SELECT completions_alltime FROM user_edit_counts WHERE id='${uid(6)}'`)).rows[0];
  assert.deepEqual(cached, live);

  // Rollbacks for steps 5, 6 and 7 bring back the old objects with the same numbers.
  const rb = sql.slice(sql.indexOf('-- @@ROLLBACK'));
  const NL = String.fromCharCode(10);
  const block = (start) => { const i = rb.indexOf(start); const j = rb.indexOf(NL + '-- Step', i + 5); return rb.slice(i, j < 0 ? undefined : j); };
  const uncomment = b => b.split(NL).filter(l => l.startsWith('-- ') && !l.startsWith('-- Step') && !l.startsWith('-- (') && !l.includes('cron.unschedule')).map(l => l.slice(3)).join(NL);
  for (const st of ['-- Step 7: Dataset Stats cache', '-- Step 5: leaderboard cache', "-- Step 6: each player"]) {
    const code = uncomment(block(st));
    await db.exec(code);
  }
  for (const k of ['uec', 'board', 'prog', 'weekly', 'types', 'people', 'work']) {
    const now = (await snap())[k];
    assert.equal(now.length > 0, before[k].length > 0, k + ' after rollback');
  }
  assert.equal((await db.query("SELECT relkind FROM pg_class WHERE relname='user_edit_counts'")).rows[0].relkind, 'v');
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_class WHERE relname IN ('leaderboard_cache','ew_user_edit_hours','ew_dataset_progress_cache')")).rows[0].n, 0);
});
