// MEC Axon complete vs Cell complete (supabase-mec-axon-complete.sql), run on
// an in-memory PostgreSQL over the live completed-cell rule. Synthetic rows
// only; no connection to production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const REPO=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(REPO,f),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
/** Step 4 of supabase-db-load.sql: the live text of the two views. */
const liveStep4=()=>{
  const all=read('supabase-db-load.sql');
  const from=all.indexOf('-- @@STEP 4'), to=all.indexOf('-- @@STEP 5');
  return all.slice(from,to);
};

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
    INSERT INTO proofreading_tasks SELECT FROM generate_series(1,9);
    INSERT INTO users(id,display_name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p'||n FROM generate_series(1,30) n;`);
  await db.exec(read('supabase-leaderboard-accuracy.sql'));
  await db.exec(read('supabase-completions-same-cell.sql'));
  await db.exec(liveStep4());
  return db;
}
const log=(db,user,operation,at,{root,task,axon,same,dataset='pni_mec'}={})=>{
  const metadata={};
  if (root) operation==='complete_task'?metadata.final_segment_id=root:metadata.root_id=root;
  if (axon) metadata.completion='axon';
  if (same) metadata.same_cell_as=same;
  return db.query(`INSERT INTO edit_log(user_id,operation,timestamp,task_id,metadata,dataset) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
    [user,operation,at,task??null,JSON.stringify(metadata),dataset]);
};
const cells=async(db,user)=>(await db.query(`SELECT dataset,cell,done_at,kind FROM ew_cell_completions WHERE user_id=$1 ORDER BY cell`,[user])).rows;

test('Axon complete and Cell complete are told apart, and each counts once',async()=>{
  const db=await fresh();
  try {
    const p=uid(1);
    // Cell Library: task 1 as Axon complete, task 2 as Complete (with its CAVE mark echo).
    await log(db,p,'complete_task','2026-11-01T10:00:00Z',{root:'101',task:1,axon:true});
    await log(db,p,'complete_task','2026-11-01T11:00:00Z',{root:'102',task:2});
    await log(db,p,'mark_complete','2026-11-01T11:00:01Z',{root:'102'});
    // Task 3 as Axon complete, later upgraded with Mark as Proofread on the same root.
    await log(db,p,'complete_task','2026-11-02T10:00:00Z',{root:'103',task:3,axon:true});
    await log(db,p,'mark_complete','2026-11-05T10:00:00Z',{root:'103'});
    // An old completion from before the marker: a whole cell.
    await log(db,p,'complete_task','2026-10-20T10:00:00Z',{root:'104',task:4});
    const before=(await db.query('SELECT count(*)::int n FROM ew_cell_completions')).rows[0].n;

    const sql=read('supabase-mec-axon-complete.sql');
    await db.exec(sql);
    await db.exec(sql);   // safe to run twice

    const rows=await cells(db,p);
    assert.equal(rows.length,4,'four cells, each once');
    assert.equal(rows.length,before,'the same number of cells as before');
    const kind=Object.fromEntries(rows.map(r=>[r.cell,r.kind]));
    assert.deepEqual(kind,{'task:1':'axon','task:2':'cell','task:3':'cell','task:4':'cell'});
    // The upgrade keeps the first completion time.
    assert.equal(new Date(rows.find(r=>r.cell==='task:3').done_at).toISOString(),'2026-11-02T10:00:00.000Z');
    // Columns: the old ones in the old order, then kind.
    const cols=(await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ew_cell_completions' ORDER BY ordinal_position`)).rows.map(r=>r.column_name);
    assert.deepEqual(cols,['user_id','dataset','cell','done_at','kind']);
    const markCols=(await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ew_cell_marks' ORDER BY ordinal_position`)).rows.map(r=>r.column_name);
    assert.deepEqual(markCols,['user_id','dataset','ts','operation','rid','cell','axon']);
    // The views that read ew_cell_marks still work (the server's same-cell check).
    const known=(await db.query(`SELECT * FROM ew_completion_roots($1,'pni_mec')`,[p])).rows;
    assert.ok(known.some(r=>r.cell==='task:1'));

    // Un-marked, then completed again as Axon complete: an axon again.
    await log(db,p,'unmark_complete','2026-11-06T10:00:00Z',{root:'103'});
    await log(db,p,'mark_complete','2026-11-06T10:05:00Z',{root:'103',axon:true});
    assert.equal((await cells(db,p)).find(r=>r.cell==='task:3').kind,'axon');

    // A visitor still reads the view as before (security_invoker, own grants).
    await db.exec('SET ROLE anon');
    await db.query('SELECT kind FROM ew_cell_completions LIMIT 1').catch(e=>{ if (!/permission denied/.test(e.message)) throw e; });
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('the app\'s copy of the rule (completion_rule.ts) gives the same kinds as the SQL',async t=>{
  const strip=require('node:module').stripTypeScriptTypes;
  if (typeof strip!=='function') return t.skip('this Node cannot load TypeScript');
  const js=strip(read('src/util/completion_rule.ts')).replace(/^export /gm,'');
  const {completedCells}=new Function(js+';return {completedCells};')();
  const db=await fresh();
  try {
    await db.exec(read('supabase-mec-axon-complete.sql'));
    let seed=20261114; const rnd=n=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
    const pick=a=>a[rnd(a.length)];
    const rows=[]; let t=Date.parse('2026-10-20T00:00:00Z');
    for (let i=0;i<500;i++) {
      t+=pick([1000,2000,30000,90000,150000,3600000,86400000]);
      const operation=pick(['mark_complete','mark_complete','complete_task','complete_task','unmark_complete']);
      const root=pick([null,'r1','r2','r3','r4','r5']), task=pick([null,null,1,2,3]);
      const metadata=root==null?{}:operation==='complete_task'?{final_segment_id:root}:{root_id:root};
      if (operation!=='unmark_complete'&&rnd(2)===0) metadata.completion='axon';
      if (root!=null&&operation!=='complete_task'&&rnd(3)===0) metadata.same_cell_as=pick(['r1','r2','task:1','gone']);
      rows.push({id:i+1,user_id:uid(1),operation,timestamp:new Date(t).toISOString(),task_id:task,metadata,
        dataset:pick(['pni_mec','pni_mec','stroeh_mouse_retina']),success:rnd(12)!==0});
    }
    for (const r of rows) await db.query(`INSERT INTO edit_log(id,user_id,operation,timestamp,task_id,metadata,dataset,success) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [r.id,r.user_id,r.operation,r.timestamp,r.task_id,JSON.stringify(r.metadata),r.dataset,r.success]);
    const fromSql=(await db.query('SELECT dataset,cell,done_at,kind FROM ew_cell_completions WHERE user_id=$1',[uid(1)])).rows
      .map(c=>`${c.dataset}|${c.cell}|${new Date(c.done_at).getTime()}|${c.kind}`).sort();
    const fromApp=completedCells(rows).map(c=>`${c.dataset}|${c.cell}|${c.doneAt}|${c.kind}`).sort();
    assert.ok(fromSql.some(s=>s.endsWith('|axon'))&&fromSql.some(s=>s.endsWith('|cell')),'the fixture should have both kinds');
    assert.deepEqual(fromApp,fromSql);
  } finally { await db.close(); }
});
