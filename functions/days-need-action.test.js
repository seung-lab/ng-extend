// A day needs real work (supabase-days-need-action.sql): a visit, a claim or
// annotating is not a day; a checked edit or a completed cell is. Run on an
// in-memory PostgreSQL. Synthetic rows only; no connection to production.
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
  for (const f of ['supabase-leaderboard-accuracy.sql','supabase-streak-local-days.sql','supabase-days-track.sql'])
    await db.exec(fs.readFileSync(path.join(__dirname,'..',f),'utf8'));
  const sql=fs.readFileSync(path.join(__dirname,'../supabase-days-need-action.sql'),'utf8');
  await db.exec(sql);
  await db.exec(sql);            // safe to re-run
  return db;
}
const touch=async(db,user,tz)=>(await db.query('SELECT public.ew_touch_streak($1,$2) AS r',[uid(user),tz])).rows[0].r;
const rec=async(db,user,row)=>(await db.query('SELECT public.ew_log_activity($1,$2::jsonb) AS r',[uid(user),JSON.stringify(row)])).rows[0].r;
const state=async(db,user)=>{const r=(await db.query('SELECT total_days,current_streak,longest_streak FROM users WHERE id=$1',[uid(user)])).rows[0];return [r.total_days,r.current_streak,r.longest_streak];};
const back=(db,user,n)=>db.query(`UPDATE users SET last_edit_date=last_edit_date-$2::int WHERE id=$1`,[uid(user),n]);
const at=(db,user,tz,daysAgo,clock,operation='merge')=>db.query(
  `INSERT INTO edit_log(user_id,operation,timestamp,success)
   VALUES($1,$4,(((now() AT TIME ZONE $2)::date - $3::int) + $5::time) AT TIME ZONE $2,true)`,
  [uid(user),tz,daysAgo,operation,clock]);
let key=0; const op=(operation,extra={})=>({operation,dataset:'stroeh_mouse_retina',op_key:`pcg:t${++key}`,...extra});

test('a visit is not a day',async()=>{
  const db=await fresh();
  try {
    // A bot that only signs in, every day: nothing, ever.
    let r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.current_streak,r.days_before],[0,0,0]);
    for (let i=0;i<5;i++) { await db.query(`UPDATE users SET updated_at=now() WHERE id=$1`,[uid(1)]); r=await touch(db,1,NY); }
    assert.deepEqual(await state(db,1),[0,0,0]);
  } finally { await db.close(); }
});

test('an edit or a completed cell is a day; a claim, a release and annotating are not',async()=>{
  const db=await fresh();
  try {
    await touch(db,1,NY);
    for (const o of ['claim_task','release_task']) await rec(db,1,op(o));
    await rec(db,1,op('annotate',{metadata:{count:40}}));
    assert.deepEqual(await state(db,1),[0,0,0]);
    // The first edit of the day counts, the second adds nothing.
    let r=await rec(db,1,op('merge'));
    assert.deepEqual([r.total_days,r.days_before,r.current_streak],[1,0,1]);
    await rec(db,1,op('split'));
    assert.deepEqual(await state(db,1),[1,1,1]);
    // Next day: the visit leaves the streak alive but does not extend it...
    await back(db,1,1);
    r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.current_streak],[1,1]);
    await rec(db,1,op('claim_task'));
    assert.deepEqual(await state(db,1),[1,1,1]);
    // ...an edit does.
    r=await rec(db,1,op('split'));
    assert.deepEqual([r.total_days,r.days_before,r.current_streak],[2,1,2]);
    // A failed edit is not a day.
    await back(db,1,1);
    await rec(db,1,op('merge',{success:false}));
    assert.deepEqual(await state(db,1),[2,2,2]);
  } finally { await db.close(); }
});

test('a missed day ends the streak on the next visit, never the total',async()=>{
  const db=await fresh();
  try {
    await touch(db,1,NY);
    await rec(db,1,op('merge')); await back(db,1,1); await rec(db,1,op('merge'));
    assert.deepEqual(await state(db,1),[2,2,2]);
    await back(db,1,3);
    const r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.current_streak,r.longest_streak],[2,0,2]);
    const e=await rec(db,1,op('merge'));
    assert.deepEqual([e.total_days,e.current_streak,e.longest_streak],[3,1,2]);
  } finally { await db.close(); }
});

test('the first count from the log does not add today',async()=>{
  const db=await fresh();
  try {
    // Work three days ago and yesterday, none today.
    await at(db,2,NY,3,'10:00'); await at(db,2,NY,1,'21:30'); await at(db,2,NY,2,'12:00','annotate');
    let r=await touch(db,2,NY);
    assert.deepEqual([r.total_days,r.days_recounted,r.current_streak,r.longest_streak],[2,true,1,1]);
    // History that ended a week ago: no live streak.
    await at(db,3,NY,8,'10:00'); await at(db,3,NY,7,'10:00');
    r=await touch(db,3,NY);
    assert.deepEqual([r.total_days,r.current_streak,r.longest_streak],[2,0,2]);
  } finally { await db.close(); }
});

test('the functions stay closed to the public',async()=>{
  const db=await fresh();
  try {
    const p=(await db.query(`SELECT bool_or(has_function_privilege('anon',p.oid,'EXECUTE')) a
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('ew_touch_streak','ew_log_activity')`)).rows[0];
    assert.equal(p.a,false);
  } finally { await db.close(); }
});
