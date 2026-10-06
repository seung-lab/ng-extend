// Dataset progress (supabase-dataset-stats.sql), run on an in-memory
// PostgreSQL. Synthetic rows only; no connection to production.
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
    CREATE TABLE proofreading_tasks(id serial PRIMARY KEY,segment_id text NOT NULL,
      dataset text NOT NULL DEFAULT 'eyewire_ii',status text NOT NULL DEFAULT 'pending',
      assigned_to uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE edit_log(id bigserial PRIMARY KEY,task_id integer REFERENCES proofreading_tasks(id),
      user_id uuid REFERENCES users(id),operation text NOT NULL,timestamp timestamptz DEFAULT now(),
      segment_before text,segment_after text,coordinates text,metadata jsonb,
      dataset text DEFAULT 'eyewire_ii',success boolean DEFAULT true);
    CREATE TABLE weekly_winners(id serial PRIMARY KEY,week_start date NOT NULL,rank integer NOT NULL,
      user_id uuid NOT NULL,edits integer NOT NULL,metric text NOT NULL DEFAULT 'edits',
      recorded_at timestamptz DEFAULT now(),UNIQUE(week_start,rank,metric));
    INSERT INTO users(id,display_name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p'||n FROM generate_series(1,5) n;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase-leaderboard-accuracy.sql'),'utf8'));
  const sql=fs.readFileSync(path.join(__dirname,'../supabase-dataset-stats.sql'),'utf8');
  await db.exec(sql);
  await db.exec(sql);            // safe to re-run
  return db;
}
const task=async(db,seg,status,dataset='stroeh_mouse_retina')=>(await db.query(
  'INSERT INTO proofreading_tasks(segment_id,status,dataset) VALUES($1,$2,$3) RETURNING id',[seg,status,dataset])).rows[0].id;
const sheet=(db,seg,{status=null,who=null,date=null,type=null,dataset='stroeh_mouse_retina'}={})=>db.query(
  'INSERT INTO ew_sheet_cells(dataset,segment_id,status,proofreader,date_complete,cell_type) VALUES($1,$2,$3,$4,$5,$6)',
  [dataset,seg,status,who,date,type]);
const log=(db,user,operation,at,{task=null,dataset='stroeh_mouse_retina',success=true,metadata={}}={})=>db.query(
  'INSERT INTO edit_log(user_id,operation,timestamp,task_id,metadata,dataset,success) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
  [uid(user),operation,at,task,JSON.stringify(metadata),dataset,success]);
const one=async(db,q,p=[])=>(await db.query(q,p)).rows[0];
const all=async(db,q,p=[])=>(await db.query(q,p)).rows;

test('progress: states, the total, and what is left out of it',async()=>{
  const db=await fresh();
  try {
    await task(db,'1','completed');  await sheet(db,'1',{status:'Complete (cut off)',who:'Ann',date:'2026-05-04',type:'RBC'});
    await task(db,'2','in_progress');await sheet(db,'2',{status:'Complete',who:'Bo',date:'2026-05-12',type:'RBC'});
    await task(db,'3','pending');    await sheet(db,'3',{type:'t6'});
    await task(db,'4','assigned');   await sheet(db,'4',{type:'t6'});
    await task(db,'5','pending');    await sheet(db,'5',{status:"Can't Complete",who:'Ann',type:'t6'});
    await task(db,'6','skipped');                       // retired, not in the sheet
    await task(db,'7','pending');    await sheet(db,'7',{status:'Not BC',type:''});
    await task(db,'8','completed');                     // done in the game, sheet never heard
    await task(db,'9','pending','eyewire_ii');          // the retina's old name
    await task(db,'10','pending','pni_mec');
    const r=await one(db,`SELECT * FROM ew_dataset_progress WHERE dataset='stroeh_mouse_retina'`);
    assert.deepEqual([r.cells_done,r.cells_claimed,r.cells_waiting,r.cells_set_aside],[3,1,2,3]);
    assert.equal(r.cells_done_undated,1);               // task 8: no date anywhere
    const m=await one(db,`SELECT * FROM ew_dataset_progress WHERE dataset='pni_mec'`);
    assert.deepEqual([m.cells_done,m.cells_claimed,m.cells_waiting,m.cells_set_aside,m.cells_done_undated],[0,0,1,0,0]);
    // every task is in exactly one state
    const n=await one(db,'SELECT count(*)::int n FROM ew_dataset_cells');
    assert.equal(n.n,10);
  } finally { await db.close(); }
});

test('weekly: sheet date first, then the game log, never the import day; edits by UTC week',async()=>{
  const db=await fresh();
  try {
    const a=await task(db,'1','completed'); await sheet(db,'1',{status:'Complete',who:'Ann',date:'2026-05-04'}); // Monday
    await task(db,'2','completed'); await sheet(db,'2',{status:'Complete',who:'Ann',date:'2026-05-10'});         // Sunday, same week
    const c=await task(db,'3','completed');             // the game logged it, the sheet has no row
    await log(db,1,'complete_task','2026-05-13T10:00:00Z',{task:c});
    await log(db,1,'complete_task','2026-05-20T10:00:00Z',{task:c});   // logged again later: the first counts
    await task(db,'4','completed');                     // imported as complete: no date, so no week
    await log(db,1,'complete_task','2026-06-01T10:00:00Z',{task:a});   // the sheet's date wins over the log
    await log(db,1,'split','2026-05-10T23:59:00Z');
    await log(db,2,'merge','2026-05-11T00:01:00Z');
    await log(db,2,'merge','2026-05-11T00:02:00Z',{success:false});    // failed: not an edit
    await log(db,2,'merge','2026-05-12T00:00:00Z',{dataset:'pni_mec'});
    const w=await all(db,`SELECT week_start::text,cells_done,edits FROM ew_dataset_weekly WHERE dataset='stroeh_mouse_retina' ORDER BY 1`);
    assert.deepEqual(w,[{week_start:'2026-05-04',cells_done:2,edits:1},{week_start:'2026-05-11',cells_done:1,edits:1}]);
    const done=(await one(db,`SELECT cells_done,cells_done_undated FROM ew_dataset_progress WHERE dataset='stroeh_mouse_retina'`));
    // the weekly chart plus the undated cells is every finished cell
    assert.equal(w.reduce((s,r)=>s+r.cells_done,0)+done.cells_done_undated,done.cells_done);
    const mec=await all(db,`SELECT week_start::text,cells_done,edits FROM ew_dataset_weekly WHERE dataset='pni_mec'`);
    assert.deepEqual(mec,[{week_start:'2026-05-11',cells_done:0,edits:1}]);
  } finally { await db.close(); }
});

test('types and people add up to the progress numbers',async()=>{
  const db=await fresh();
  try {
    await task(db,'1','completed'); await sheet(db,'1',{status:'Complete',who:'Ann',date:'2026-05-04',type:'RBC'});
    await task(db,'2','completed'); await sheet(db,'2',{status:'Complete',who:'Ann',date:'2026-05-04',type:'RBC'});
    await task(db,'3','pending');   await sheet(db,'3',{type:'RBC'});
    await task(db,'4','completed'); await sheet(db,'4',{status:'Complete',who:'ann',date:'2026-05-05',type:'t6'});
    await task(db,'5','assigned');  await sheet(db,'5',{type:' '});
    await task(db,'6','pending');   await sheet(db,'6',{status:'Not BC',type:'t6'});
    await task(db,'7','completed');
    const t=await all(db,`SELECT cell_type,cells_done,cells_left FROM ew_dataset_types WHERE dataset='stroeh_mouse_retina' ORDER BY cell_type NULLS LAST`);
    assert.deepEqual(t,[{cell_type:'RBC',cells_done:2,cells_left:1},{cell_type:'t6',cells_done:1,cells_left:0},{cell_type:null,cells_done:1,cells_left:1}]);
    const p=await one(db,`SELECT * FROM ew_dataset_progress WHERE dataset='stroeh_mouse_retina'`);
    assert.equal(t.reduce((s,r)=>s+r.cells_done,0),p.cells_done);
    assert.equal(t.reduce((s,r)=>s+r.cells_left,0),p.cells_claimed+p.cells_waiting);
    // names are kept as written: Ann and ann are two people in the sheet
    const who=await all(db,`SELECT proofreader,cells_done FROM ew_dataset_people WHERE dataset='stroeh_mouse_retina' ORDER BY 1`);
    assert.deepEqual(who,[{proofreader:'Ann',cells_done:2},{proofreader:'ann',cells_done:1}]);
  } finally { await db.close(); }
});

test('work: edits and annotations per dataset and player',async()=>{
  const db=await fresh();
  try {
    await log(db,1,'split','2026-05-04T10:00:00Z');
    await log(db,1,'merge','2026-05-04T10:01:00Z');
    await log(db,1,'merge','2026-05-04T10:02:00Z',{success:false});
    await log(db,1,'split','2026-05-04T10:03:00Z',{dataset:'eyewire_ii'});     // the retina's old name
    await log(db,1,'annotate','2026-05-04T10:04:00Z',{metadata:{count:7}});
    await log(db,1,'annotate','2026-05-04T10:05:00Z',{metadata:{count:'x'}}); // not a number: nothing
    await log(db,1,'annotate','2026-05-04T10:06:00Z',{metadata:{}});
    await log(db,1,'mark_complete','2026-05-04T10:07:00Z');
    await log(db,2,'merge','2026-05-04T10:00:00Z',{dataset:'pni_mec'});
    const w=await all(db,'SELECT dataset,splits,merges,annotations FROM ew_dataset_work ORDER BY 1');
    assert.deepEqual(w,[{dataset:'pni_mec',splits:0,merges:1,annotations:0},{dataset:'stroeh_mouse_retina',splits:2,merges:1,annotations:7}]);
    // the same edits the board counts
    const board=await one(db,'SELECT edits_logged FROM user_edit_counts WHERE id=$1',[uid(1)]);
    assert.equal(board.edits_logged,3);
  } finally { await db.close(); }
});
