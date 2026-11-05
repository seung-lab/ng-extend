// supabase-quest-leaderboard.sql (2026-11-05), run on an in-memory
// PostgreSQL. Synthetic rows only. Only Super Quest time counts, the windows
// follow US Eastern days, finished quests are counted, a re-run is safe, and
// the refresh picks up new time.
const {test} = require('node:test');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase-quest-leaderboard.sql'), 'utf8');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('supabase-quest-leaderboard.sql ranks Super Quest time by ET day', async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    -- pg_cron, as far as the file uses it
    CREATE SCHEMA cron; CREATE TABLE cron.job(jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
    CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS integer LANGUAGE sql AS
      $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(n,s,c) ON CONFLICT (jobname) DO UPDATE SET schedule=s RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname=n RETURNING true $$;
    CREATE TABLE users(id uuid PRIMARY KEY, display_name text, flag text, current_streak integer DEFAULT 0);
    CREATE TABLE proofreading_tasks(id serial PRIMARY KEY, kind text NOT NULL DEFAULT 'cell',
      status text NOT NULL DEFAULT 'pending', assigned_to uuid);
    CREATE TABLE claim_active_days(task_id integer, user_id uuid, day date, seconds integer, PRIMARY KEY(task_id,user_id,day));
    INSERT INTO users(id,display_name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p'||n FROM generate_series(1,4) n;
    -- 1: quest in progress (p1); 2: quest finished by p2; 3: an ordinary MEC claim (p3)
    INSERT INTO proofreading_tasks(kind,status,assigned_to) VALUES
      ('interneuron','assigned','${uid(1)}'),('interneuron','completed','${uid(2)}'),('cell','assigned','${uid(3)}');`);
  const today = `(now() AT TIME ZONE 'America/New_York')::date`;
  await db.exec(`INSERT INTO claim_active_days VALUES
    (1,'${uid(1)}',${today},600),(1,'${uid(1)}',${today}-3,1200),(1,'${uid(1)}',${today}-30,3600),
    (2,'${uid(2)}',${today}-7,5000),(2,'${uid(1)}',${today}-1,60),
    (3,'${uid(3)}',${today},9999);`);

  await db.exec(SQL);
  await db.exec(SQL); // safe to re-run
  const rows = async () => (await db.query(`SELECT display_name, quest_seconds_today t, quest_seconds_week w,
    quest_seconds_alltime a, quests_finished f FROM quest_leaderboard_cache ORDER BY display_name`)).rows;
  assert.deepEqual(await rows(), [
    { display_name: 'p1', t: 600, w: 1860, a: 5460, f: 0 },
    // 7 ET days ago is outside the week (today and the 6 days before)
    { display_name: 'p2', t: 0, w: 0, a: 5000, f: 1 },
  ]);
  assert.equal((await db.query(`SELECT count(*)::int n FROM cron.job WHERE jobname='pyr-quest-leaderboard-refresh'`)).rows[0].n, 1);

  await db.exec(`UPDATE claim_active_days SET seconds = seconds + 120 WHERE task_id = 1 AND day = ${today};
    SELECT public.refresh_quest_leaderboard_cache();`);
  assert.equal((await rows())[0].t, 720);

  // The API roles can read the cache, and nothing else of the quest tables.
  const priv = (await db.query(`SELECT has_table_privilege('anon','public.quest_leaderboard_cache','SELECT') r,
    has_function_privilege('anon','public.refresh_quest_leaderboard_cache()','EXECUTE') f`)).rows[0];
  assert.deepEqual(priv, { r: true, f: false });
});
