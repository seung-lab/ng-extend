// Interneuron quests and active time per claim (supabase-interneuron-quests.sql).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
test('one quest at a time, quests never expire and do not count against claims, time is capped',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE users(id uuid PRIMARY KEY,middleauth_email text,username text,display_name text DEFAULT '');
   CREATE TABLE admins(email text);
   CREATE TABLE proofreading_tasks(id serial PRIMARY KEY,segment_id text,dataset text,status text DEFAULT 'pending',assigned_to uuid,claim_point_x double precision,claim_point_y double precision,claim_point_z double precision,supervoxel_id text,final_segment_id text,soma_coords text,nucleus_coords text,notes text,updated_at timestamptz DEFAULT now());
   CREATE TABLE task_assignments(id serial PRIMARY KEY,task_id integer,user_id uuid,status text DEFAULT 'active',expires_at timestamptz,released_at timestamptz,completed_at timestamptz);
   CREATE TABLE tutorial_practice_examples(id uuid PRIMARY KEY,kind text,status text,enabled boolean,claimed_by uuid,claimed_at timestamptz,expires_at timestamptz,updated_at timestamptz);
   INSERT INTO users VALUES('${A}','a@example.invalid','ames',''),('${B}','b@example.invalid','bee','');
   INSERT INTO admins VALUES('a@example.invalid');`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase-pilot-access.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase-interneuron-quests.sql'),'utf8'));
  await db.exec("INSERT INTO pilot_members(email) VALUES('b@example.invalid')");
  const call=async(fn,user,action,args)=> (await db.query('SELECT public.'+fn+'($1,$2,$3::jsonb) AS result',[user,action,JSON.stringify(args)])).rows[0].result;
  const task=(user,action,args)=>call('pilot_task_action',user,action,args);
  const time=(user,action,args)=>call('pilot_claim_time',user,action,args);
  const quest=(user,action,args)=>call('pilot_quest_admin',user,action,args);

  // Only admins add quests. Root IDs, with or without a point.
  await assert.rejects(()=>quest(B,'add',{dataset:'pni_mec',cells:[{segment_id:'500'}]}),/Admins only/);
  const out=await quest(A,'add',{dataset:'pni_mec',cells:[{segment_id:'500',point:[1,2,3]},{segment_id:'501'},{segment_id:'502',note:'big one'},{segment_id:'x1'}]});
  assert.deepEqual([out.added,out.changed,out.already,out.bad],[3,0,0,['x1']]);
  assert.equal((await quest(A,'add',{dataset:'pni_mec',cells:[{segment_id:'500'}]})).already,1);
  const ids=(await db.query("SELECT id FROM proofreading_tasks WHERE kind='interneuron' ORDER BY id")).rows.map(r=>r.id);
  assert.equal((await db.query(`SELECT nucleus_coords FROM proofreading_tasks WHERE id=${ids[0]}`)).rows[0].nucleus_coords,'1, 2, 3');

  // One quest at a time; it never expires.
  await task(B,'claim',{id:ids[0]});
  await assert.rejects(()=>task(B,'claim',{id:ids[1]}),/already hold an interneuron quest/);
  assert.equal((await db.query(`SELECT expires_at='infinity'::timestamptz AS forever FROM task_assignments WHERE task_id=${ids[0]}`)).rows[0].forever,true);
  await task(B,'heartbeat',{id:ids[0]});
  assert.equal((await db.query(`SELECT expires_at='infinity'::timestamptz AS forever FROM task_assignments WHERE task_id=${ids[0]}`)).rows[0].forever,true);
  await db.exec('SELECT expire_stale_assignments()');
  assert.equal((await db.query(`SELECT status FROM proofreading_tasks WHERE id=${ids[0]}`)).rows[0].status,'assigned');

  // The quest does not count against the 8 ordinary claims.
  for (let i=0;i<8;i++) await task(B,'claim_cell',{dataset:'pni_mec',segment_id:String(700+i),point:[10+i,2,3]});
  await assert.rejects(()=>task(B,'claim_cell',{dataset:'pni_mec',segment_id:'799',point:[90,2,3]}),/Max 8/);

  // Time: owner only, at most 90 s a beat, and never more than the wall time since the last beat.
  await assert.rejects(()=>time(A,'beat',{id:ids[0],seconds:60}),/no longer active/);
  let r=await time(B,'beat',{id:ids[0],seconds:5000,edits:2,saves:1});
  assert.equal(r.active_seconds,90); assert.equal(r.edits,2); assert.equal(r.views_saved,1); assert.equal(r.days,1); assert.equal(r.kind,'interneuron');
  r=await time(B,'beat',{id:ids[0],seconds:60});      // a second tab, at once
  assert.ok(r.active_seconds<=96, 'a beat right after another adds at most a few seconds');
  r=await time(B,'beat',{id:ids[0],seconds:'lots'});
  assert.ok(r.active_seconds<=96);
  // Milestones: 10 hours passed once, and remembered.
  await db.exec(`UPDATE claim_active_time SET active_seconds=35990,last_at=now()-interval '1 minute' WHERE task_id=${ids[0]}`);
  r=await time(B,'beat',{id:ids[0],seconds:60});
  assert.deepEqual(r.passed,[10]); assert.deepEqual(r.milestones,[10]);
  await db.exec(`UPDATE claim_active_time SET last_at=now()-interval '1 minute' WHERE task_id=${ids[0]}`);
  r=await time(B,'beat',{id:ids[0],seconds:60});
  assert.deepEqual(r.passed,[]);
  assert.equal((await time(B,'mine',{})).length,1);

  // Release: another quest may be claimed. A held quest cannot be taken off the list.
  await assert.rejects(()=>quest(A,'remove',{id:ids[1]+100}),/no one holds/);
  await task(B,'release',{id:ids[0]});
  await task(B,'claim',{id:ids[1]});
  await assert.rejects(()=>quest(A,'remove',{id:ids[1]}),/no one holds/);
  assert.equal((await quest(A,'remove',{id:ids[2]})).status,'skipped');
  await assert.rejects(()=>task(B,'claim',{id:ids[2]}),/already completed/);

  const rep=await quest(A,'report',{dataset:'pni_mec'});
  assert.equal(rep.quests.length,3);
  assert.equal(rep.times[0].player,'bee');
  assert.equal(rep.quests.find(q=>q.id===ids[0]).active_seconds>36000,true);

  // Categories (supabase-super-quest-categories.sql): the two lists go in, a demo cell already there is relabelled.
  await db.exec("INSERT INTO proofreading_tasks(segment_id,dataset,kind) VALUES('720575947582584839','pni_mec','interneuron')");
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase-super-quest-categories.sql'),'utf8'));
  const cats=(await db.query("SELECT quest_category AS c,count(*)::integer AS n FROM proofreading_tasks WHERE dataset='pni_mec' AND kind='interneuron' AND quest_category IS NOT NULL GROUP BY 1 ORDER BY 1")).rows;
  assert.deepEqual(cats,[{c:'Non-Pyramidal Target',n:12},{c:'Pyramidal Target',n:17}]);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase-super-quest-categories.sql'),'utf8'));
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM proofreading_tasks WHERE quest_category IS NOT NULL")).rows[0].n,29);
  const more=await quest(A,'add',{dataset:'pni_mec',category:'Pyramidal Target',cells:[{segment_id:'900'},{segment_id:'500'}]});
  assert.deepEqual([more.added,more.changed],[1,1]);
  await assert.rejects(()=>quest(A,'add',{dataset:'pni_mec',category:'x'.repeat(61),cells:[{segment_id:'901'}]}),/Invalid category/);
  assert.equal((await quest(A,'report',{dataset:'pni_mec'})).quests.find(q=>q.segment_id==='900').category,'Pyramidal Target');

  // Two months (supabase-super-quest-two-months.sql; the pg_cron part is not in PGlite).
  await db.exec("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS claimed_at timestamptz DEFAULT now()");
  const twoMonths=fs.readFileSync(path.join(__dirname,'../supabase-super-quest-two-months.sql'),'utf8').split(/^COMMIT;/m)[0]+'COMMIT;';
  await db.exec(twoMonths);
  const held=(await db.query(`SELECT a.task_id,(a.expires_at=a.claimed_at+interval '60 days') AS two,t.quest_ends_at=a.expires_at AS shown FROM task_assignments a JOIN proofreading_tasks t ON t.id=a.task_id WHERE t.kind='interneuron' AND a.status='active'`)).rows;
  assert.equal(held.length,1); assert.equal(held[0].two,true); assert.equal(held[0].shown,true);
  const qid=held[0].task_id;
  await task(B,'heartbeat',{id:qid});
  await task(B,'claim',{id:qid});
  assert.equal((await db.query(`SELECT expires_at=claimed_at+interval '60 days' AS two FROM task_assignments WHERE task_id=${qid} AND status='active'`)).rows[0].two,true);
  // An ordinary claim keeps its 30 minutes.
  assert.equal((await db.query(`SELECT expires_at<now()+interval '1 hour' AS short FROM task_assignments a JOIN proofreading_tasks t ON t.id=a.task_id WHERE t.kind='cell' AND a.status='active' LIMIT 1`)).rows[0].short,true);
  assert.equal((await db.query('SELECT public.ew_release_expired_super_quests() AS n')).rows[0].n,0);
  await db.exec(`UPDATE task_assignments SET claimed_at=now()-interval '61 days',expires_at=now() WHERE task_id=${qid} AND status='active'`);
  assert.equal((await db.query('SELECT public.ew_release_expired_super_quests() AS n')).rows[0].n,1);
  assert.equal((await db.query(`SELECT status FROM proofreading_tasks WHERE id=${qid}`)).rows[0].status,'pending');
  assert.equal((await time(B,'mine',{})).length>=1,true, 'the time on it is kept');
  await task(A,'claim',{id:qid});
 } finally { await db.close(); }
});
