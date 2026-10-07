// Streaks on the player's own calendar, with a visit counting as a day
// (supabase-streak-local-days.sql), run on an in-memory PostgreSQL.
// Synthetic rows only; no connection to production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NY='America/New_York';
async function fresh() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE users(id uuid PRIMARY KEY,display_name text DEFAULT '',flag text,bio text,
      total_edits integer DEFAULT 0,total_merges integer DEFAULT 0,total_splits integer DEFAULT 0,
      cells_completed integer DEFAULT 0,current_streak integer DEFAULT 0,longest_streak integer DEFAULT 0,
      last_edit_date date,total_annotations integer NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE proofreading_tasks(id serial PRIMARY KEY);
    CREATE TABLE edit_log(id bigserial PRIMARY KEY,task_id integer REFERENCES proofreading_tasks(id),
      user_id uuid REFERENCES users(id),operation text NOT NULL,timestamp timestamptz DEFAULT now(),
      segment_before text,segment_after text,coordinates text,metadata jsonb,
      dataset text DEFAULT 'eyewire_ii',success boolean DEFAULT true);
    CREATE TABLE weekly_winners(id serial PRIMARY KEY,week_start date NOT NULL,rank integer NOT NULL,
      user_id uuid NOT NULL,edits integer NOT NULL,metric text NOT NULL DEFAULT 'edits',
      recorded_at timestamptz DEFAULT now(),UNIQUE(week_start,rank,metric));
    INSERT INTO users(id,display_name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p'||n FROM generate_series(1,30) n;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase-leaderboard-accuracy.sql'),'utf8'));
  const sql=fs.readFileSync(path.join(__dirname,'../supabase-streak-local-days.sql'),'utf8');
  await db.exec(sql);
  await db.exec(sql);            // safe to re-run
  return db;
}
const touch=async(db,user,tz)=>(await db.query('SELECT public.ew_touch_streak($1,$2) AS r',[uid(user),tz])).rows[0].r;
const rec=async(db,user,row)=>(await db.query('SELECT public.ew_log_activity($1,$2::jsonb) AS r',[uid(user),JSON.stringify(row)])).rows[0].r;
const row=async(db,user)=>(await db.query(`SELECT current_streak,longest_streak,last_edit_date::text AS last,tz FROM users WHERE id=$1`,[uid(user)])).rows[0];
/** Log an activity at a wall-clock time `daysAgo` local days ago in `tz`. */
const at=(db,user,tz,daysAgo,clock,operation='merge',success=true)=>db.query(
  `INSERT INTO edit_log(user_id,operation,timestamp,success)
   VALUES($1,$4,(((now() AT TIME ZONE $2)::date - $3::int) + $5::time) AT TIME ZONE $2,$6)`,
  [uid(user),tz,daysAgo,operation,clock,success]);
const localToday=async(db,tz)=>(await db.query(`SELECT (now() AT TIME ZONE $1)::date::text AS d`,[tz])).rows[0].d;
const set=(db,user,streak,longest,lastOffsetDays,tz)=>db.query(
  `UPDATE users SET current_streak=$2,longest_streak=$3,tz=$5,streak_recounted_at=now(),
     last_edit_date=(now() AT TIME ZONE $5)::date + $4::int WHERE id=$1`,[uid(user),streak,longest,lastOffsetDays,tz]);

test('the first visit recounts the streak on the player\'s own calendar',async()=>{
  const db=await fresh();
  try {
    // Three evenings running in New York, then today. An evening at 21:30 is
    // already the next day in UTC, the case that used to break streaks.
    await at(db,1,NY,3,'10:00');
    await at(db,1,NY,2,'21:30');
    await at(db,1,NY,1,'21:30');
    // What the old UTC rule had saved for this player.
    await db.query(`UPDATE users SET current_streak=2,longest_streak=2,last_edit_date=(now() AT TIME ZONE 'UTC')::date WHERE id=$1`,[uid(1)]);
    const r=await touch(db,1,NY);
    assert.deepEqual([r.current_streak,r.recounted,r.tz,r.streak_before],[4,true,NY,2]);
    assert.equal(r.longest_streak,4);
    // The saved day only ever moves forwards. Between 8 pm and midnight in New
    // York the old UTC rule's day (set above) is already tomorrow, so that is
    // the day kept; the rest of the day it is the player's own today. Without
    // this the test failed every evening and blocked the deploy.
    const utcToday=(await db.query(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS d`)).rows[0].d;
    const localDay=await localToday(db,NY);
    assert.equal((await row(db,1)).last, utcToday>localDay?utcToday:localDay);

    // The same day again: nothing moves, and it is not a recount.
    const again=await touch(db,1,NY);
    assert.deepEqual([again.current_streak,again.recounted,again.streak_before],[4,false,4]);

    // A gap on the local calendar really is a gap: 5 and 4 days ago, then today.
    await at(db,2,NY,5,'12:00');
    await at(db,2,NY,4,'12:00');
    const gap=await touch(db,2,NY);
    assert.equal(gap.current_streak,1);
    assert.equal(gap.longest_streak,2);

    // Failed operations and annotations are not days. A best streak never goes down.
    await at(db,3,NY,1,'12:00','merge',false);
    await at(db,3,NY,1,'12:00','annotate');
    await db.query(`UPDATE users SET longest_streak=13 WHERE id=$1`,[uid(3)]);
    const none=await touch(db,3,NY);
    assert.deepEqual([none.current_streak,none.longest_streak],[1,13]);

    // A brand new player with no history starts at one.
    assert.equal((await touch(db,4,'Europe/Warsaw')).current_streak,1);
  } finally { await db.close(); }
});

test('a visit moves the streak forward a day at a time, and only forward',async()=>{
  const db=await fresh();
  try {
    await set(db,1,5,9,-1,NY);                       // here yesterday
    let r=await touch(db,1,NY);
    assert.deepEqual([r.current_streak,r.longest_streak,r.streak_before],[6,9,5]);
    await set(db,2,5,9,-3,NY);                       // away for two days
    r=await touch(db,2,NY);
    assert.deepEqual([r.current_streak,r.longest_streak],[1,9]);
    await set(db,3,9,9,-1,NY);                       // beats their best
    assert.deepEqual([(r=await touch(db,3,NY)).current_streak,r.longest_streak],[10,10]);
    // The saved day is ahead of today (a move to a zone further west): the
    // streak is kept, not reset, and the saved day does not go backwards.
    await set(db,4,7,7,1,NY);
    const before=(await row(db,4)).last;
    r=await touch(db,4,NY);
    assert.equal(r.current_streak,7);
    assert.equal((await row(db,4)).last,before);
    // A zone PostgreSQL does not know is ignored: the saved one is used.
    r=await touch(db,5,NY);
    r=await touch(db,5,'Not/AZone; DROP TABLE users');
    assert.equal(r.tz,NY);
    assert.equal((await touch(db,6,null)).tz,'UTC');
  } finally { await db.close(); }
});

test('edits use the same local day as visits',async()=>{
  const db=await fresh();
  try {
    const ds='stroeh_mouse_retina';
    await set(db,1,3,3,-1,NY);                       // here yesterday, New York time
    let r=await rec(db,1,{operation:'merge',dataset:ds,op_key:'pcg:1'});
    assert.deepEqual([r.current_streak,r.longest_streak],[4,4]);
    assert.equal((await row(db,1)).last, await localToday(db,NY));
    // A second edit, and then a visit, on the same day change nothing.
    r=await rec(db,1,{operation:'split',dataset:ds,op_key:'pcg:2'});
    assert.equal(r.current_streak,4);
    assert.equal((await touch(db,1,NY)).current_streak,4);
    // A visit first, then an edit the same day: still one day.
    await set(db,2,3,3,-1,NY);
    assert.equal((await touch(db,2,NY)).current_streak,4);
    assert.equal((await rec(db,2,{operation:'merge',dataset:ds,op_key:'pcg:3'})).current_streak,4);
    // An edit never resets a streak whose saved day is ahead of today.
    await set(db,3,7,7,1,NY);
    assert.equal((await rec(db,3,{operation:'merge',dataset:ds,op_key:'pcg:4'})).current_streak,7);
    // Annotating still does not move the streak.
    await set(db,4,3,3,-1,NY);
    assert.equal((await rec(db,4,{operation:'annotate',dataset:ds,metadata:{count:5}})).current_streak,3);
    // A player with no zone yet is counted in UTC, as before.
    r=await rec(db,5,{operation:'merge',dataset:ds,op_key:'pcg:5'});
    assert.equal(r.current_streak,1);
    assert.equal((await row(db,5)).last, await localToday(db,'UTC'));
  } finally { await db.close(); }
});

test('only the server can call them',async()=>{
  const db=await fresh();
  try {
    const p=(await db.query(`SELECT
      has_function_privilege('anon','public.ew_touch_streak(uuid,text)','EXECUTE') a,
      has_function_privilege('authenticated','public.ew_touch_streak(uuid,text)','EXECUTE') b,
      has_function_privilege('service_role','public.ew_touch_streak(uuid,text)','EXECUTE') c,
      has_function_privilege('anon','public.ew_log_activity(uuid,jsonb)','EXECUTE') d`)).rows[0];
    assert.deepEqual([p.a,p.b,p.c,p.d],[false,false,true,false]);
  } finally { await db.close(); }
});

// ── The Days track: total days shown up (supabase-days-track.sql) ───────────
async function freshDays() {
  const db=await fresh();
  const sql=fs.readFileSync(path.join(__dirname,'../supabase-days-track.sql'),'utf8');
  await db.exec(sql);
  await db.exec(sql);            // safe to re-run
  return db;
}
const days=async(db,user)=>(await db.query('SELECT total_days FROM users WHERE id=$1',[uid(user)])).rows[0].total_days;

test('total days: counted once from the log, then one more for each new day',async()=>{
  const db=await freshDays();
  try {
    // Five separate days of history (two of them evenings), a failed edit and
    // an annotation that are not days, and today's visit: six.
    await at(db,1,NY,9,'10:00'); await at(db,1,NY,7,'21:30'); await at(db,1,NY,6,'21:30');
    await at(db,1,NY,3,'12:00'); await at(db,1,NY,3,'15:00'); await at(db,1,NY,1,'09:00');
    await at(db,1,NY,5,'12:00','merge',false); await at(db,1,NY,4,'12:00','annotate');
    let r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.days_before,r.days_recounted],[6,0,true]);
    assert.equal(r.current_streak,2);                // yesterday and today
    // The same day again: nothing moves.
    r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.days_before,r.days_recounted],[6,6,false]);
    // A new day by a visit, then nothing more for an edit that same day.
    await db.query(`UPDATE users SET last_edit_date=last_edit_date-1 WHERE id=$1`,[uid(1)]);
    r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.days_before],[7,6]);
    assert.equal((await rec(db,1,{operation:'merge',dataset:'stroeh_mouse_retina',op_key:'pcg:d1'})).total_days,7);
    // A new day by an edit: one more, and the visit after it adds nothing.
    await db.query(`UPDATE users SET last_edit_date=last_edit_date-1 WHERE id=$1`,[uid(1)]);
    r=await rec(db,1,{operation:'merge',dataset:'stroeh_mouse_retina',op_key:'pcg:d2'});
    assert.deepEqual([r.total_days,r.days_before],[8,7]);
    assert.equal((await touch(db,1,NY)).total_days,8);
    // Annotating is not a day. A missed week resets the streak, never the total.
    await db.query(`UPDATE users SET last_edit_date=last_edit_date-7 WHERE id=$1`,[uid(1)]);
    assert.equal((await rec(db,1,{operation:'annotate',dataset:'stroeh_mouse_retina',metadata:{count:3}})).total_days,8);
    r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.current_streak],[9,1]);
    assert.equal(await days(db,1),9);
    // A brand new player: day one.
    assert.equal((await touch(db,2,'Europe/Warsaw')).total_days,1);
    // A player who already visited before this track existed keeps the day already saved.
    await db.query(`UPDATE users SET tz=$2,streak_recounted_at=now(),current_streak=1,last_edit_date=(now() AT TIME ZONE $2)::date-1 WHERE id=$1`,[uid(3),NY]);
    r=await touch(db,3,NY);
    assert.deepEqual([r.total_days,r.days_recounted,r.current_streak],[2,true,2]);
  } finally { await db.close(); }
});

test('total days can be read by anyone; a time zone can not',async()=>{
  const db=await freshDays();
  try {
    const p=(await db.query(`SELECT has_column_privilege('anon','public.users','total_days','SELECT') a,
      has_function_privilege('anon','public.ew_touch_streak(uuid,text)','EXECUTE') b`)).rows[0];
    assert.deepEqual([p.a,p.b],[true,false]);
  } finally { await db.close(); }
});
