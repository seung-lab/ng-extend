// More actions make a day (supabase-days-more-actions.sql, Ames 2026-10-08):
// claiming, typing a cell, annotating, asking for help and answering help now
// count, from now on only. A visit and a release still do not. Run on an
// in-memory PostgreSQL. Synthetic rows only; no connection to production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NY='America/New_York';
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
async function base() {
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
    CREATE TABLE help_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES users(id),
      segment_id text NOT NULL,position text NOT NULL,issue_type text NOT NULL,created_at timestamptz DEFAULT now());
    CREATE TABLE help_responses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid REFERENCES help_requests(id),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,note text,created_at timestamptz DEFAULT now());
    INSERT INTO users(id,display_name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p'||n FROM generate_series(1,30) n;`);
  for (const f of ['supabase-leaderboard-accuracy.sql','supabase-streak-local-days.sql','supabase-days-track.sql','supabase-days-need-action.sql'])
    await db.exec(read(f));
  return db;
}
async function fresh() {
  const db=await base();
  const sql=read('supabase-days-more-actions.sql');
  await db.exec(sql);
  await db.exec(sql);            // safe to re-run
  return db;
}
const touch=async(db,user,tz)=>(await db.query('SELECT public.ew_touch_streak($1,$2) AS r',[uid(user),tz])).rows[0].r;
const rec=async(db,user,row)=>(await db.query('SELECT public.ew_log_activity($1,$2::jsonb) AS r',[uid(user),JSON.stringify(row)])).rows[0].r;
const state=async(db,user)=>{const r=(await db.query('SELECT total_days,current_streak,longest_streak FROM users WHERE id=$1',[uid(user)])).rows[0];return [r.total_days,r.current_streak,r.longest_streak];};
const back=(db,user,n)=>db.query(`UPDATE users SET last_edit_date=last_edit_date-$2::int WHERE id=$1`,[uid(user),n]);
let key=0; const op=(operation,extra={})=>({operation,dataset:'stroeh_mouse_retina',op_key:`pcg:m${++key}`,...extra});
const ask=(db,user)=>db.query(`INSERT INTO help_requests(user_id,segment_id,position,issue_type) VALUES($1,'1','[0,0,0]','Other') RETURNING id`,[user==null?null:uid(user)]);
const answer=(db,user,request)=>db.query(`INSERT INTO help_responses(request_id,user_id,note) VALUES($1,$2,'here')`,[request,user==null?null:uid(user)]);

test('claiming, typing a cell and annotating are each a day; a visit and a release are not',async()=>{
  const db=await fresh();
  try {
    // Still nothing for a visit or a release.
    await touch(db,1,NY);
    await rec(db,1,op('release_task'));
    assert.deepEqual(await state(db,1),[0,0,0]);
    // Each of the new actions, alone, on a player's first day.
    let u=2;
    for (const row of [op('claim_task'),op('set_cell_type',{metadata:{root_id:'1',cell_type:'Bipolar Cell'}}),op('annotate',{metadata:{count:40}})]) {
      await touch(db,u,NY);
      const r=await rec(db,u,row);
      assert.deepEqual([r.total_days,r.days_before,r.current_streak],[1,0,1],row.operation);
      u++;
    }
    // The annotation tally itself still counts as before.
    assert.equal((await db.query('SELECT total_annotations n FROM users WHERE id=$1',[uid(4)])).rows[0].n,40);
    // The old ones still do.
    await touch(db,5,NY);
    const r=await rec(db,5,op('merge'));
    assert.deepEqual([r.total_days,r.total_edits,r.current_streak],[1,1,1]);
  } finally { await db.close(); }
});

test('one day however many actions; the next day extends the streak',async()=>{
  const db=await fresh();
  try {
    await touch(db,1,NY);
    await rec(db,1,op('claim_task'));
    await rec(db,1,op('annotate',{metadata:{count:3}}));
    await rec(db,1,op('set_cell_type'));
    await rec(db,1,op('split'));
    assert.deepEqual(await state(db,1),[1,1,1]);
    await back(db,1,1);
    const r=await rec(db,1,op('claim_task'));
    assert.deepEqual([r.total_days,r.days_before,r.current_streak],[2,1,2]);
    // A gap: the day still counts, the streak starts again.
    await back(db,1,3);
    await rec(db,1,op('annotate',{metadata:{count:1}}));
    assert.deepEqual(await state(db,1),[3,1,2]);
  } finally { await db.close(); }
});

test('asking for help and answering help are each a day',async()=>{
  const db=await fresh();
  try {
    await touch(db,1,NY); await touch(db,2,NY);
    const request=(await ask(db,1)).rows[0].id;
    assert.deepEqual(await state(db,1),[1,1,1]);
    await answer(db,2,request);
    assert.deepEqual(await state(db,2),[1,1,1]);
    // More of the same that day adds nothing, and an edit after it adds nothing either.
    await ask(db,1); await answer(db,1,request);
    await rec(db,1,op('merge'));
    assert.deepEqual(await state(db,1),[1,1,1]);
    // The next day an answer extends the streak.
    await back(db,2,1);
    await answer(db,2,request);
    assert.deepEqual(await state(db,2),[2,2,2]);
    // A row with no player (older rows, the system) saves and counts for nobody.
    await ask(db,null); await answer(db,null,request);
    assert.equal((await db.query('SELECT count(*)::int n FROM help_requests')).rows[0].n,3);
    assert.equal((await db.query('SELECT coalesce(sum(total_days),0)::int n FROM users')).rows[0].n,3);
  } finally { await db.close(); }
});

test('from now on only: running the change moves nobody, and old claims are not counted afterwards',async()=>{
  const db=await base();
  try {
    // Before the change: a player with five counted days, and claims, a typed
    // cell and a help request on other, older days that counted for nothing.
    await touch(db,1,NY);
    await db.query(`UPDATE users SET total_days=5,current_streak=1,longest_streak=3,last_edit_date=(now() AT TIME ZONE $2)::date-1 WHERE id=$1`,[uid(1),NY]);
    for (const [ago,o] of [[10,'claim_task'],[11,'set_cell_type'],[12,'claim_task']])
      await db.query(`INSERT INTO edit_log(user_id,operation,timestamp,success) VALUES($1,$2,now()-($3||' days')::interval,true)`,[uid(1),o,ago]);
    await db.query(`INSERT INTO help_requests(user_id,segment_id,position,issue_type,created_at) VALUES($1,'1','[0,0,0]','Other',now()-interval '20 days')`,[uid(1)]);
    const before=await state(db,1);
    const sql=read('supabase-days-more-actions.sql');
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual(await state(db,1),before);
    // Opening the game afterwards does not count them either.
    const r=await touch(db,1,NY);
    assert.deepEqual([r.total_days,r.days_recounted],[5,false]);
    // Today's claim is the sixth day.
    const c=await rec(db,1,op('claim_task'));
    assert.deepEqual([c.total_days,c.days_before,c.current_streak],[6,5,2]);
  } finally { await db.close(); }
});

test('only the server may call the new functions',async()=>{
  const db=await fresh();
  try {
    const rows=(await db.query(`SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') a,has_function_privilege('authenticated',p.oid,'EXECUTE') b
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('ew_log_activity','ew_count_day','ew_help_counts_a_day')`)).rows;
    assert.equal(rows.length,3);
    for (const r of rows) assert.deepEqual([r.a,r.b],[false,false],r.proname);
  } finally { await db.close(); }
});
