// The leaderboard's counting rule (supabase-leaderboard-accuracy.sql), run on
// an in-memory PostgreSQL. Synthetic rows only; no connection to production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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
  const sql=fs.readFileSync(path.join(__dirname,'../supabase-leaderboard-accuracy.sql'),'utf8');
  // The completed-cell rule as it is now: a cell completed again after an edit is the same cell.
  const same=fs.readFileSync(path.join(__dirname,'../supabase-completions-same-cell.sql'),'utf8');
  await db.exec(sql);
  await db.exec(same);
  await db.exec(sql);            // safe to re-run, in either order
  await db.exec(same);
  await db.exec(same);
  return db;
}
/** Log a row `ago` (a PostgreSQL interval) before now. */
const log=(db,user,operation,ago,{root,final,task,same,dataset='stroeh_mouse_retina',success=true}={})=>db.query(
  `INSERT INTO edit_log(user_id,operation,timestamp,task_id,metadata,dataset,success)
   VALUES($1,$2,now()-$3::interval,$4,$5::jsonb,$6,$7)`,
  [uid(user),operation,ago,task??null,JSON.stringify({...(root?{root_id:root}:{}),...(final?{final_segment_id:final}:{}),...(same?{same_cell_as:same}:{})}),dataset,success]);
const board=async(db,user)=>(await db.query('SELECT * FROM user_edit_counts WHERE id=$1',[uid(user)])).rows[0];
const cells=async(db,user)=>(await db.query('SELECT dataset,cell,done_at FROM ew_cell_completions WHERE user_id=$1 ORDER BY done_at',[uid(user)])).rows;

test('one completed-cell rule: duplicates, un-marks, ids, datasets, history',async()=>{
  const db=await fresh();
  try {
    // 1 same root twice inside the week: one cell, dated at the first mark
    await log(db,1,'mark_complete','2 days',{root:'1'});
    await log(db,1,'complete_task','2 hours',{root:'1'});
    assert.equal((await board(db,1)).completions_week,1);
    assert.equal((await board(db,1)).completions_24h,0);
    // 2 mark, un-mark, mark: one cell, dated at the re-mark
    await log(db,2,'mark_complete','3 days',{root:'1'});
    await log(db,2,'unmark_complete','2 days',{root:'1'});
    await log(db,2,'mark_complete','2 hours',{root:'1'});
    assert.equal((await board(db,2)).completions_24h,1);
    // 3 mark then un-mark: nothing
    await log(db,3,'mark_complete','2 days',{root:'1'});
    await log(db,3,'unmark_complete','2 hours',{root:'1'});
    assert.equal((await board(db,3)).completions_week,0);
    // 4 a row with no id next to its completion is that completion's echo
    await log(db,4,'mark_complete','2 hours');
    await log(db,4,'complete_task','2 hours 1 minute',{root:'1'});
    assert.equal((await board(db,4)).completions_week,1);
    // 5 a row with no id on its own is one cell
    await log(db,5,'mark_complete','2 hours');
    assert.equal((await board(db,5)).completions_week,1);
    // 6 free marks the server could not tie together: a changed root id is two roots
    await log(db,6,'mark_complete','2 days',{root:'old'});
    await log(db,6,'mark_complete','2 hours',{root:'new'});
    assert.equal((await board(db,6)).completions_week,2);
    // 7 Cell Library: the task is the cell, so a changed root is still one cell
    await log(db,7,'mark_complete','2 days',{root:'old'});
    await log(db,7,'complete_task','2 days',{final:'old',task:1});
    await log(db,7,'complete_task','2 hours',{final:'new',task:1});
    await log(db,7,'mark_complete','2 hours',{root:'new'});
    assert.deepEqual((await cells(db,7)).map(c=>c.cell),['task:1']);
    assert.equal((await board(db,7)).completions_24h,0);
    // 8 MEC counts; 9 a failed completion does not
    await log(db,8,'mark_complete','2 hours',{root:'1',dataset:'pni_mec'});
    assert.equal((await board(db,8)).completions_week,1);
    await log(db,9,'mark_complete','2 hours',{root:'1',success:false});
    assert.equal((await board(db,9)).completions_week,0);
    // 10 completed 9 days ago, marked again today: NOT a new cell this week
    await log(db,10,'mark_complete','9 days',{root:'1'});
    await log(db,10,'mark_complete','2 hours',{root:'1'});
    assert.equal((await board(db,10)).completions_week,0);
    assert.equal((await board(db,10)).completions_logged,1);
    // 11 the same root id on two datasets is two cells
    await log(db,11,'mark_complete','5 hours',{root:'1'});
    await log(db,11,'mark_complete','2 hours',{root:'1',dataset:'pni_mec'});
    assert.equal((await board(db,11)).completions_week,2);
    // 12 an un-mark on another dataset cancels nothing
    await log(db,12,'mark_complete','5 hours',{root:'1'});
    await log(db,12,'unmark_complete','2 hours',{root:'1',dataset:'pni_mec'});
    assert.equal((await board(db,12)).completions_week,1);
    // 13 a completion on another dataset is not an echo's partner
    await log(db,13,'mark_complete','2 hours',{dataset:'pni_mec'});
    await log(db,13,'mark_complete','2 hours',{root:'unrelated'});
    assert.equal((await board(db,13)).completions_week,2);
    // 14, 15 two players, same root: one each
    await log(db,14,'mark_complete','2 hours',{root:'shared'});
    await log(db,15,'mark_complete','2 hours',{root:'shared'});
    assert.equal((await board(db,14)).completions_week,1);
    assert.equal((await board(db,15)).completions_week,1);
    // 16 the retina's old alias is the retina
    await log(db,16,'mark_complete','5 hours',{root:'1',dataset:'eyewire_ii'});
    await log(db,16,'mark_complete','2 hours',{root:'1'});
    assert.equal((await board(db,16)).completions_week,1);
    // 17 failed edits are not recent edits; successful ones are
    await log(db,17,'merge','2 hours',{success:false});
    await log(db,17,'split','2 hours');
    await log(db,17,'merge','3 days');
    const b=await board(db,17);
    assert.deepEqual([b.edits_24h,b.edits_week,b.edits_logged],[1,2,2]);
    // a player with no activity is still on the board, with zeros
    assert.deepEqual((({edits_24h,completions_week})=>[edits_24h,completions_week])(await board(db,30)),[0,0]);
  } finally { await db.close(); }
});

test('a cell completed again after an edit is the same cell',async()=>{
  const db=await fresh();
  try {
    const rec=async(user,row)=>(await db.query('SELECT public.ew_log_activity($1,$2::jsonb) AS r',[uid(user),JSON.stringify(row)])).rows[0].r;
    const ds='stroeh_mouse_retina';
    // 1 The reported case: complete, edit (new root id), complete again, over and over. One cell.
    let r=await rec(1,{operation:'mark_complete',dataset:ds,metadata:{root_id:'100'}});
    assert.equal(r.cells_completed,1);
    r=await rec(1,{operation:'mark_complete',dataset:ds,metadata:{root_id:'101',same_cell_as:'100'}});
    assert.equal(r.cells_completed,1);
    r=await rec(1,{operation:'mark_complete',dataset:ds,metadata:{root_id:'102',same_cell_as:'100'}});
    assert.equal(r.cells_completed,1);
    assert.deepEqual((await cells(db,1)).map(c=>c.cell),['100']);
    // ... and it is dated at the first completion, so it is not a new cell this week either.
    await log(db,2,'mark_complete','9 days',{root:'200'});
    await log(db,2,'mark_complete','2 hours',{root:'201',same:'200'});
    assert.deepEqual([(await board(db,2)).completions_week,(await board(db,2)).completions_logged],[0,1]);
    // 2 Un-marking the newest version un-marks the cell; marking it again brings it back.
    r=await rec(1,{operation:'unmark_complete',dataset:ds,metadata:{root_id:'102'}});
    assert.equal(r.cells_completed,0);
    r=await rec(1,{operation:'mark_complete',dataset:ds,metadata:{root_id:'102'}});
    assert.equal(r.cells_completed,1);
    // 3 Un-marked, edited, marked again: still that one cell.
    r=await rec(1,{operation:'unmark_complete',dataset:ds,metadata:{root_id:'102'}});
    r=await rec(1,{operation:'mark_complete',dataset:ds,metadata:{root_id:'103',same_cell_as:'100'}});
    assert.equal(r.cells_completed,1);
    // 4 A cell the server did not tie to anything is its own cell.
    r=await rec(1,{operation:'mark_complete',dataset:ds,metadata:{root_id:'900'}});
    assert.equal(r.cells_completed,2);
    // 5 Identity is per player: another player completing the edited cell has one cell of their own.
    r=await rec(3,{operation:'mark_complete',dataset:ds,metadata:{root_id:'101'}});
    assert.equal(r.cells_completed,1);
    // 6 ... and per dataset.
    r=await rec(1,{operation:'mark_complete',dataset:'pinky_nf_v2',metadata:{root_id:'101'}});
    assert.equal(r.cells_completed,3);
    // 7 A later version of a Cell Library cell is that task, whichever was logged first.
    await log(db,4,'complete_task','3 days',{final:'300',task:1});
    await log(db,4,'mark_complete','2 hours',{root:'301',same:'task:1'});
    assert.deepEqual((await cells(db,4)).map(c=>c.cell),['task:1']);
    await log(db,5,'mark_complete','3 days',{root:'400'});
    await log(db,5,'mark_complete','2 days',{root:'401',same:'400'});
    await log(db,5,'complete_task','2 hours',{final:'400',task:2});
    assert.deepEqual((await cells(db,5)).map(c=>c.cell),['task:2']);
    // 8 Only a mark carries it: on any other row the field means nothing.
    await log(db,6,'mark_complete','3 days',{root:'500'});
    await log(db,6,'unmark_complete','2 hours',{root:'501',same:'500'});
    assert.equal((await board(db,6)).completions_logged,1);
    // The server reads a player's roots with their cells; browsers can not.
    const roots=(await db.query('SELECT cell,rid FROM public.ew_completion_roots($1,$2) ORDER BY rid',[uid(1),'eyewire_ii'])).rows.map(x=>x.rid+'>'+x.cell);
    assert.deepEqual(roots,['100>100','101>100','102>100','103>100','900>900']);
    const grants=(await db.query(`SELECT has_function_privilege('anon','public.ew_completion_roots(uuid,text)','EXECUTE') a,
      has_function_privilege('authenticated','public.ew_completion_roots(uuid,text)','EXECUTE') b,
      has_function_privilege('service_role','public.ew_completion_roots(uuid,text)','EXECUTE') c`)).rows[0];
    assert.deepEqual([grants.a,grants.b,grants.c],[false,false,true]);
  } finally { await db.close(); }
});

test('a completed week is Monday to Monday in UTC, with ties decided the same way every time',async()=>{
  const db=await fresh();
  try {
    const at=(user,operation,ts,root)=>db.query(`INSERT INTO edit_log(user_id,operation,timestamp,metadata,dataset) VALUES($1,$2,$3,$4::jsonb,'stroeh_mouse_retina')`,
      [uid(user),operation,ts,JSON.stringify(root?{root_id:root}:{})]);
    // Week of Monday 2026-09-28. Player 1: 3 cells. Players 2 and 3: 2 each, 3 reached it first.
    for (const [u,ts,r] of [[1,'2026-09-28T00:00:00Z','a'],[1,'2026-09-30T10:00:00Z','b'],[1,'2026-10-04T23:59:59Z','c'],
      [2,'2026-09-29T10:00:00Z','a'],[2,'2026-10-03T10:00:00Z','b'],[3,'2026-09-29T11:00:00Z','a'],[3,'2026-10-01T10:00:00Z','b'],
      [4,'2026-09-27T23:59:59Z','before'],[4,'2026-10-05T00:00:00Z','after']]) await at(u,'mark_complete',ts,r);
    const rank=async()=>(await db.query(`SELECT rank,user_id,count FROM ew_weekly_ranking('2026-09-28','completions',20)`)).rows.map(r=>[r.rank,r.user_id,r.count]);
    const want=[[1,uid(1),3],[2,uid(3),2],[3,uid(2),2]];
    assert.deepEqual(await rank(),want);
    // The answer does not depend on the session's time zone.
    await db.exec(`SET TIME ZONE 'America/New_York'`);
    assert.deepEqual(await rank(),want);
    await db.exec(`SET TIME ZONE 'Pacific/Auckland'`);
    assert.deepEqual(await rank(),want);
    await db.exec(`SET TIME ZONE 'UTC'`);
    await assert.rejects(()=>db.query(`SELECT * FROM ew_weekly_ranking('2026-09-29','completions',3)`),/Monday/);
    await assert.rejects(()=>db.query(`SELECT * FROM ew_weekly_ranking('2026-09-28','score',3)`),/edits or completions/);
    // The saved podium is that ranking's top three ...
    const saved=(await db.query(`SELECT rank,user_id,edits FROM snapshot_weekly_winners('2026-09-28','completions') ORDER BY rank`)).rows.map(r=>[r.rank,r.user_id,r.edits]);
    assert.deepEqual(saved,want);
    // ... and a podium that is already saved is never overwritten.
    await at(2,'mark_complete','2026-10-02T10:00:00Z','z');
    assert.equal((await db.query(`SELECT * FROM snapshot_weekly_winners('2026-09-28','completions')`)).rows.length,0);
    assert.equal((await db.query(`SELECT user_id FROM weekly_winners WHERE week_start='2026-09-28' AND rank=2 AND metric='completions'`)).rows[0].user_id,uid(3));
    // Edits: failed ones do not count, ties go to who got there first.
    for (const [u,ts] of [[5,'2026-09-29T10:00:00Z'],[5,'2026-09-29T12:00:00Z'],[6,'2026-09-29T09:00:00Z'],[6,'2026-09-29T11:00:00Z']]) await at(u,'merge',ts);
    await db.query(`INSERT INTO edit_log(user_id,operation,timestamp,success,dataset) VALUES($1,'split','2026-09-30T10:00:00Z',false,'stroeh_mouse_retina')`,[uid(5)]);
    assert.deepEqual((await db.query(`SELECT rank,user_id,count FROM ew_weekly_ranking('2026-09-28','edits',20)`)).rows.map(r=>[r.rank,r.user_id,r.count]),[[1,uid(6),2],[2,uid(5),2]]);
  } finally { await db.close(); }
});

test('the server records an event and moves the counters in one step',async()=>{
  const db=await fresh();
  try {
    const rec=async(user,row)=>(await db.query('SELECT public.ew_log_activity($1,$2::jsonb) AS r',[uid(user),JSON.stringify(row)])).rows[0].r;
    const ds='stroeh_mouse_retina';
    // Edits: one per row, never a number from the browser.
    let r=await rec(1,{operation:'merge',dataset:ds,op_key:'pcg:101',metadata:{diff:1000000}});
    assert.deepEqual([r.recorded,r.total_edits,r.total_merges,r.total_splits,r.current_streak],[true,1,1,0,1]);
    r=await rec(1,{operation:'split',dataset:ds,op_key:'pcg:102'});
    assert.deepEqual([r.total_edits,r.total_merges,r.total_splits,r.edits_before],[2,1,1,1]);
    // The same operation reported again: one row, one count.
    r=await rec(1,{operation:'split',dataset:ds,op_key:'pcg:102'});
    assert.deepEqual([r.recorded,r.duplicate,r.total_edits],[false,true,2]);
    // Another player can not claim it either.
    r=await rec(2,{operation:'split',dataset:ds,op_key:'pcg:102'});
    assert.deepEqual([r.recorded,r.total_edits],[false,0]);
    // The same id on another dataset is another operation.
    r=await rec(2,{operation:'split',dataset:'pni_mec',op_key:'pcg:102'});
    assert.equal(r.total_edits,1);
    // A failed operation is logged and counts for nothing.
    r=await rec(1,{operation:'merge',dataset:ds,success:false,op_key:'pcg:103'});
    assert.deepEqual([r.recorded,r.total_edits],[true,2]);
    assert.equal((await db.query('SELECT count(*)::int n FROM edit_log WHERE user_id=$1',[uid(1)])).rows[0].n,3);
    // Completion: mark and complete_task of one cell is one cell.
    r=await rec(3,{operation:'mark_complete',dataset:ds,metadata:{root_id:'9'}});
    assert.equal(r.cells_completed,1);
    r=await rec(3,{operation:'complete_task',dataset:ds,task_id:2,metadata:{final_segment_id:'9'}});
    assert.equal(r.cells_completed,1);
    r=await rec(3,{operation:'mark_complete',dataset:ds,metadata:{root_id:'9'}});
    assert.equal(r.cells_completed,1);
    r=await rec(3,{operation:'unmark_complete',dataset:ds,metadata:{root_id:'9'}});
    assert.equal(r.cells_completed,0);
    r=await rec(3,{operation:'unmark_complete',dataset:ds,metadata:{root_id:'never-marked'}});
    assert.equal(r.cells_completed,0);
    r=await rec(3,{operation:'mark_complete',dataset:ds,metadata:{root_id:'9'}});
    assert.equal(r.cells_completed,1);
    // Existing totals are kept: the counter moves from where it was.
    await db.query('UPDATE users SET cells_completed=118,total_edits=662 WHERE id=$1',[uid(4)]);
    r=await rec(4,{operation:'mark_complete',dataset:ds,metadata:{root_id:'7'}});
    assert.equal(r.cells_completed,119);
    r=await rec(4,{operation:'merge',dataset:ds,op_key:'pcg:200'});
    assert.equal(r.total_edits,663);
    // Streak: yesterday carries on, a gap restarts, the same day stays.
    await db.query(`UPDATE users SET current_streak=6,longest_streak=6,last_edit_date=(now() AT TIME ZONE 'UTC')::date-1 WHERE id=$1`,[uid(5)]);
    r=await rec(5,{operation:'claim_task',dataset:ds});
    assert.deepEqual([r.current_streak,r.longest_streak,r.streak_before],[7,7,6]);
    r=await rec(5,{operation:'merge',dataset:ds,op_key:'pcg:300'});
    assert.equal(r.current_streak,7);
    await db.query(`UPDATE users SET current_streak=9,longest_streak=9,last_edit_date=(now() AT TIME ZONE 'UTC')::date-3 WHERE id=$1`,[uid(6)]);
    r=await rec(6,{operation:'merge',dataset:ds,op_key:'pcg:301'});
    assert.deepEqual([r.current_streak,r.longest_streak],[1,9]);
    // Annotations: the row's count, within bounds, and no streak.
    r=await rec(7,{operation:'annotate',dataset:ds,metadata:{count:12}});
    assert.deepEqual([r.total_annotations,r.current_streak,r.last_edit_date],[12,0,null]);
    r=await rec(7,{operation:'annotate',dataset:ds,metadata:{count:1000000000}});
    assert.equal(r.total_annotations,512);
    await assert.rejects(()=>rec(99,{operation:'merge',dataset:ds}),/unknown player/);
    // Browsers can not call it.
    const grants=(await db.query(`SELECT has_function_privilege('anon','public.ew_log_activity(uuid,jsonb)','EXECUTE') a,
      has_function_privilege('authenticated','public.ew_log_activity(uuid,jsonb)','EXECUTE') b,
      has_function_privilege('service_role','public.ew_log_activity(uuid,jsonb)','EXECUTE') c`)).rows[0];
    assert.deepEqual([grants.a,grants.b,grants.c],[false,false,true]);
  } finally { await db.close(); }
});

test('the app\'s copy of the rule (completion_rule.ts) gives the same cells as the SQL',async t=>{
  const strip=require('node:module').stripTypeScriptTypes;
  if (typeof strip!=='function') return t.skip('this Node cannot load TypeScript');
  const js=strip(fs.readFileSync(path.join(__dirname,'../src/util/completion_rule.ts'),'utf8')).replace(/^export /gm,'');
  const {completedCells}=new Function(js+';return {completedCells};')();
  const db=await fresh();
  try {
    // A few hundred rows with everything the rule has to decide, from a fixed seed.
    let seed=20261005; const rnd=n=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
    const pick=a=>a[rnd(a.length)];
    const rows=[]; let t=Date.parse('2026-09-20T00:00:00Z');
    for (let i=0;i<400;i++) {
      t+=pick([1000,2000,30000,90000,150000,3600000,86400000]);
      const operation=pick(['mark_complete','mark_complete','complete_task','complete_task','unmark_complete']);
      const root=pick([null,'r1','r2','r3','r4','r5']), task=pick([null,null,1,2,3]);
      const metadata=root==null?{}:operation==='complete_task'?{final_segment_id:root}:{root_id:root};
      // Some marks were tied by the server to an earlier cell (a root id or a task).
      if (root!=null&&operation!=='complete_task'&&rnd(3)===0) metadata.same_cell_as=pick(['r1','r2','r5','task:1','task:3','gone']);
      rows.push({id:i+1,user_id:uid(1),operation,timestamp:new Date(t).toISOString(),task_id:task,metadata,
        dataset:pick(['stroeh_mouse_retina','stroeh_mouse_retina','eyewire_ii','pni_mec']),success:rnd(12)!==0});
    }
    for (const r of rows) await db.query(`INSERT INTO edit_log(id,user_id,operation,timestamp,task_id,metadata,dataset,success) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [r.id,r.user_id,r.operation,r.timestamp,r.task_id,JSON.stringify(r.metadata),r.dataset,r.success]);
    const fromSql=(await db.query('SELECT dataset,cell,done_at FROM ew_cell_completions WHERE user_id=$1',[uid(1)])).rows
      .map(c=>`${c.dataset}|${c.cell}|${new Date(c.done_at).getTime()}`).sort();
    const fromApp=completedCells(rows).map(c=>`${c.dataset}|${c.cell}|${c.doneAt}`).sort();
    assert.ok(fromSql.length>5,'the fixture should complete some cells');
    assert.deepEqual(fromApp,fromSql);
  } finally { await db.close(); }
});
