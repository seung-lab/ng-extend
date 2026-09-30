const {test}=require('node:test');
const assert=require('node:assert/strict');
const {syncSheet}=require('./sheet-sync');

// A fake Sheets API over an in-memory tab. Records every range it is asked
// for, so the test can prove a write reads a few cells, not the whole tab.
function fakeSheet(title, gid, rows) {
  const reads=[], writes=[];
  const letterIdx=L=>[...L].reduce((n,c)=>n*26+(c.charCodeAt(0)-64),0)-1;
  const parse=a1=>{const m=a1.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);return {c0:letterIdx(m[1]),r0:m[2]?+m[2]-1:0,c1:letterIdx(m[3]||m[1]),r1:m[4]?+m[4]-1:rows.length-1};};
  const api=async(path,init)=>{
    if(path.includes('?fields=sheets.properties')) return {sheets:[{properties:{sheetId:gid,title}}]};
    if(path.includes('values:batchUpdate')){writes.push(...JSON.parse(init.body).data);return {};}
    const range=decodeURIComponent(path.split('/values/')[1].split('?')[0]);
    reads.push(range);
    const {c0,r0,c1,r1}=parse(range.split('!')[1]);
    const values=[];
    for(let r=r0;r<=Math.min(r1,rows.length-1);r++) values.push((rows[r]||[]).slice(c0,c1+1));
    return {values};
  };
  return {api,reads,writes};
}

const header=['Priority (0=highest)','box_name','Index BC Sheet','Index Master','New Index','Soma or stem Coords','Start SegID','Start link','Proofreader','Status','Date Complete','Final SegID','Final Link','Notes','AI-predicted BC type'];
const me={id:'mine',display_name:'Celia D'};

test('a retina completion reads the header, the Start SegID column and one row, never the whole tab',async()=>{
  const rows=[header];
  // Exact 18-digit ids: plain numbers would round them into duplicates.
  for(let i=0;i<14000;i++) rows.push([String(i),'box','BC'+i,'','','1, 2, 3',(720575940500000000n+BigInt(i)).toString(),'https://start','','','','','','','t1']);
  const target=(720575940500000000n+12516n).toString();
  rows[12517][8]='Amy R. Sterling';  // left by an earlier claim
  const {api,reads,writes}=fakeSheet('Focused BCs',37544110,rows);
  const task={assigned_to:'mine',dataset:'stroeh_mouse_retina',segment_id:String(target),status:'completed',final_segment_id:'999',soma_coords:''};
  const input={dataset:'stroeh_mouse_retina',segmentId:String(target),action:'complete',link:'https://spelunker.cave-explorer.org/#!x',notes:'axon cut'};
  const out=await syncSheet(input,me,task,null,api);
  assert.ok(!reads.some(r=>r.includes('AZ20000')),'must not read the whole tab');
  assert.deepEqual(reads.map(r=>r.split('!')[1]),['A1:AZ10','G2:G','A12518:AZ12518']);
  const byCell=Object.fromEntries(writes.map(w=>[w.range.split('!')[1],w.values[0][0]]));
  assert.equal(byCell.I12518,'Celia D');          // Proofreader replaced (Status empty)
  assert.equal(byCell.J12518,'Complete');
  assert.equal(byCell.L12518,'999');
  assert.equal(byCell.M12518,input.link);
  assert.equal(byCell.N12518,'axon cut');
  assert.ok(Object.keys(byCell).every(k=>k.endsWith('12518')),'writes only the matched row');
  assert.equal(out.ok,true);
});

test('a segment missing from the sheet or listed twice still fails clearly',async()=>{
  const rows=[header,['0','b','BC0','','','','111'],['1','b','BC1','','','','222'],['2','b','BC2','','','','222']];
  const {api}=fakeSheet('Focused BCs',37544110,rows);
  const mk=seg=>({assigned_to:'mine',dataset:'stroeh_mouse_retina',segment_id:seg,status:'assigned'});
  await assert.rejects(()=>syncSheet({dataset:'stroeh_mouse_retina',segmentId:'333',action:'claim'},me,mk('333'),null,api),/missing from the source sheet/);
  await assert.rejects(()=>syncSheet({dataset:'stroeh_mouse_retina',segmentId:'222',action:'claim'},me,mk('222'),null,api),/more than once/);
});

test('MEC rows are still found by starting coordinates, reading only that column and the row',async()=>{
  const mecHeader=['Cell','Starting XYZ Coords','Proofreader','Status'];
  const rows=[mecHeader];
  for(let i=0;i<500;i++) rows.push(['c'+i,`${1000+i}, 2000, 30`,'','']);
  const {api,reads,writes}=fakeSheet('Cells',869365415,rows);
  const task={assigned_to:'mine',dataset:'pni_mec',segment_id:'555',status:'assigned',claim_point_x:1300,claim_point_y:2000,claim_point_z:30};
  await syncSheet({dataset:'pni_mec',segmentId:'555',action:'claim'},me,task,null,api);
  assert.deepEqual(reads.map(r=>r.split('!')[1]),['A1:AZ10','B2:B','A302:AZ302']);
  assert.deepEqual(writes.map(w=>[w.range.split('!')[1],w.values[0][0]]),[['C302','Celia D']]);
});
