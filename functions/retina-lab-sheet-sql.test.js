// The lab's retina sheet mirror (supabase-retina-lab-sheet.sql), run on an
// in-memory PostgreSQL. Synthetic rows only; no connection to production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const SQL=fs.readFileSync(path.join(__dirname,'../supabase-retina-lab-sheet.sql'),'utf8');
async function fresh() {
  const db=new PGlite();
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  await db.exec(SQL);
  await db.exec(SQL);            // safe to re-run
  await db.exec(`INSERT INTO ew_retina_lab_sheet(sheet_index,soma_supervoxel_id,latest_seg_id,proofread_seg_id,status) VALUES
    ('A1','801','720575940000000011','720575940000000010','Complete'),
    ('A2','802','720575940000000021','720575940000000021','WIP'),
    ('A3',NULL,NULL,'720575940000000031','Info Only');`);
  return db;
}
const match=async(db,ids)=>(await db.query('SELECT sheet_index FROM ew_retina_lab_sheet_match($1::text[]) ORDER BY 1',[ids])).rows.map(r=>r.sheet_index);

test('finds a row by its latest ID or its proofread ID, once',async()=>{
  const db=await fresh();
  assert.deepEqual(await match(db,['720575940000000011']),['A1']);
  assert.deepEqual(await match(db,['720575940000000010']),['A1']);
  assert.deepEqual(await match(db,['720575940000000021']),['A2']);
  assert.deepEqual(await match(db,['720575940000000010','720575940000000011','720575940000000031','5']),['A1','A3']);
  assert.deepEqual(await match(db,['1']),[]);
  assert.deepEqual(await match(db,[]),[]);
});

test('players can read and cannot write',async()=>{
  const db=await fresh();
  for(const role of ['anon','authenticated']){
    await db.exec(`SET ROLE ${role}`);
    assert.equal((await db.query('SELECT count(*)::int n FROM ew_retina_lab_sheet')).rows[0].n,3);
    assert.deepEqual(await match(db,['720575940000000021']),['A2']);
    await assert.rejects(db.query("INSERT INTO ew_retina_lab_sheet(sheet_index) VALUES('X')"),/permission denied/);
    await assert.rejects(db.query("UPDATE ew_retina_lab_sheet SET status='Complete'"),/permission denied/);
    await assert.rejects(db.query('DELETE FROM ew_retina_lab_sheet'),/permission denied/);
    await db.exec('RESET ROLE');
  }
});

test('no names, no notes, and nothing a player number is read from',()=>{
  const cols=SQL.match(/CREATE TABLE[\s\S]*?\n\);/)[0];
  assert.ok(!/proofreader_?\d|notes|typer|updater|user_id/i.test(cols));
  assert.ok(!/ew_cell_completions|cells_completed|badge|leaderboard_/i.test(SQL.replace(/--.*$/gm,'')));
});
