const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceFor,sheetValues,sheetSpelling,planSheetUpdate}=require('./sheet-policy');
const input={dataset:'pinky_nf_v2',segmentId:'123',action:'complete'};
const me={id:'mine',display_name:'=IMPORTXML("https://attacker", "x")'};
const task={assigned_to:'mine',dataset:input.dataset,segment_id:'123',status:'completed',final_segment_id:'456',soma_coords:'1, 2, 3'};
test('reject arbitrary destinations, actions and other users',()=>{
 assert.throws(()=>sourceFor({...input,dataset:'https://evil'}));
 assert.throws(()=>sourceFor({...input,action:'write'}));
 assert.throws(()=>sheetValues(input,me,{...task,assigned_to:'someone-else'},'now'));
 assert.throws(()=>sheetValues(input,me,{...task,status:'assigned'},'now'));
});
test('matches exact source IDs, quotes titles, preserves existing values and writes formulas as RAW text',()=>{
 const grid=[['Final SegID','Start SegID','Proofreader','Status','Soma coords'],['','123','','','existing'],['','1234','','','']];
 const plan=planSheetUpdate(grid,"Amy's cells",'123',sheetValues(input,me,task,'now'));
 assert.equal(plan.valueInputOption,'RAW');
 assert.deepEqual(plan.data.map(x=>x.range),["'Amy''s cells'!C2","'Amy''s cells'!D2","'Amy''s cells'!A2"]);
 assert.equal(plan.data[0].values[0][0],me.display_name);
 assert.throws(()=>planSheetUpdate([...grid,grid[1]],'cells','123',[]));
});
test('complete writes the Final Link column, https only, never Start link',()=>{
 const link='https://spelunker.cave-explorer.org/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/123';
 const grid=[['Start SegID','Start link','Status','Final SegID','Final Link'],['123','https://old','','','']];
 const plan=planSheetUpdate(grid,'cells','123',sheetValues({...input,link},me,task,'now'));
 const byCol=Object.fromEntries(plan.data.map(x=>[x.range.split('!')[1][0],x.values[0][0]]));
 assert.equal(byCol.E,link);
 assert.equal(byCol.B,undefined);
 for(const bad of ['http://x.test','javascript:alert(1)','=IMPORTXML("https://a","b")','https://a b']) assert.throws(()=>sheetValues({...input,link:bad},me,task,'now'),/https link/);
 assert.doesNotThrow(()=>sheetValues({...input,link:''},me,task,'now'));
});
test('complete on the 2026-09-28 retina sheet writes exactly Proofreader, Status, Date Complete, Final SegID, Final Link, Notes',()=>{
 const header=['Priority (0=highest)','box_name','Index BC Sheet','Index Master','New Index','Soma or stem Coords','Start SegID','Start link','Proofreader','Status','Date Complete','Final SegID','Final Link','Notes','AI-predicted BC type'];
 const row=['12517','Topleft 500x500','BC16931','','','','123','https://start','','','','','','','t3a'];
 const link='https://spelunker.cave-explorer.org/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/9';
 const plan=planSheetUpdate([header,row],'Focused BCs','123',sheetValues({...input,dataset:'stroeh_mouse_retina',link,notes:'  axon  cut\noff '},me,{...task,dataset:'stroeh_mouse_retina'},'9/28/2026'));
 const byHeader=Object.fromEntries([...plan.data,...plan.userEnteredData].map(x=>{const c=x.range.split('!')[1].replace(/\d+$/,'');return [header[c.charCodeAt(0)-65],x.values[0][0]];}));
 assert.deepEqual(Object.keys(byHeader).sort(),['Date Complete','Final Link','Final SegID','Notes','Proofreader','Status']);
 assert.equal(byHeader.Notes,'axon cut off');
 assert.equal(byHeader['Final SegID'],'456');
});
test('completion replaces a Proofreader left by an earlier claim, but never on a completed row',()=>{
 const header=['Start SegID','Proofreader','Status','Final SegID'];
 const celia={id:'mine',display_name:'Celia D'};
 const t={...task,dataset:'stroeh_mouse_retina'};
 const open=planSheetUpdate([header,['123','Amy R. Sterling','','']],'s','123',sheetValues({...input,dataset:'stroeh_mouse_retina'},celia,t,'now'));
 assert.equal(open.data.find(x=>x.range.endsWith('!B2')).values[0][0],'Celia D');
 const done=planSheetUpdate([header,['123','Amy R. Sterling','Complete','']],'s','123',sheetValues({...input,dataset:'stroeh_mouse_retina'},celia,t,'now'));
 assert.equal(done.data.find(x=>x.range.endsWith('!B2')),undefined);
 const claim=planSheetUpdate([header,['123','Amy R. Sterling','','']],'s','123',sheetValues({...input,dataset:'stroeh_mouse_retina',action:'claim'},celia,{...t,status:'assigned'},'now'));
 assert.equal(claim.data.find(x=>x.range.endsWith('!B2')),undefined);
});
test('the completion date is entered as a real date only when it is a plain M/D/YYYY value',()=>{
 const header=['Start SegID','Status','Date Complete'];
 const ok=planSheetUpdate([header,['123','','']],'s','123',sheetValues(input,me,task,'9/28/2026'));
 assert.deepEqual(ok.userEnteredData.map(x=>x.values[0][0]),['9/28/2026']);
 assert.equal(ok.data.some(x=>x.values[0][0]==='9/28/2026'),false);
 const odd=planSheetUpdate([header,['123','','']],'s','123',sheetValues(input,me,task,'=NOW()'));
 assert.equal(odd.userEnteredData.length,0);
 assert.equal(odd.valueInputOption,'RAW');
});
test('MEC rows are found by Starting XYZ Coords; claim fills Date Started, complete fills Date Ended and Final NG Link',()=>{
 const header=['Index','Starting XYZ Coords','Cell Type (EWH)','Cell Type (NN)','AIS Coords','Status','Proofreader','Date Started','Date Ended','AIS annotated?','Final NG Link','Notes/Temp Links'];
 const grid=[['','Princeton Server START LINK: https://x'],header,
   ['1280','129296, 128864, 6565','Pyramidal','excitatory','128388, 128062, 6576','','','','','','',''],
   ['1281','156624, 133344, 4436','Pyramidal','excitatory','','','','','','','','']];
 const mec={dataset:'pni_mec',segmentId:'720575947373272744'};
 const t={assigned_to:'mine',dataset:'pni_mec',segment_id:mec.segmentId,claim_point_x:129296,claim_point_y:128864,claim_point_z:6565};
 const claim=planSheetUpdate(grid,'Cells',{segmentId:mec.segmentId,point:[129296,128864,6565]},sheetValues({...mec,action:'claim'},{id:'mine',username:'celiad'},{...t,status:'assigned'},'9/28/2026'));
 assert.deepEqual(claim.data.map(d=>[d.range,d.values[0][0]]),[["'Cells'!G3",'celiad']]);
 assert.deepEqual(claim.userEnteredData.map(d=>[d.range,d.values[0][0]]),[["'Cells'!H3",'9/28/2026']]);
 const link='https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/1';
 const done=planSheetUpdate(grid,'Cells',{segmentId:mec.segmentId,point:[129296,128864,6565]},sheetValues({...mec,action:'complete',link},{id:'mine',username:'celiad'},{...t,status:'completed'},'9/29/2026'));
 const all=[...done.data,...done.userEnteredData].map(d=>[d.range,d.values[0][0]]).sort();
 assert.deepEqual(all,[["'Cells'!F3",'Complete'],["'Cells'!G3",'celiad'],["'Cells'!I3",'9/29/2026'],["'Cells'!K3",link]]);
 // A point that is not in the sheet, or appears twice, is refused.
 assert.throws(()=>planSheetUpdate(grid,'Cells',{segmentId:'1',point:[1,2,3]},[]),/missing/);
 assert.throws(()=>planSheetUpdate([...grid,grid[2]],'Cells',{segmentId:'1',point:[129296,128864,6565]},[]),/more than once/);
 assert.throws(()=>planSheetUpdate(grid,'Cells',{segmentId:'1',point:[null,null,null]},[]),/starting point/);
 // Retina's segment matching is unchanged.
 assert.equal(sourceFor({...mec,action:'claim'}).matchBy,'startcoords');
});
test('complete writes the chosen status, only from the sheet\'s own options',()=>{
 const header=['Start SegID','Proofreader','Status','Date Complete','Final SegID','Final Link','Notes'];
 const retina={...input,dataset:'stroeh_mouse_retina'}, rtask={...task,dataset:'stroeh_mouse_retina'};
 const statusOf=(inp,row=['123','','','','','',''])=>{
  const plan=planSheetUpdate([header,row],'Focused BCs','123',sheetValues(inp,me,rtask,'10/3/2026'));
  return plan.data.find(x=>x.range.endsWith('!C2'))?.values[0][0];
 };
 // Exactly the four endings in the sheet's dropdown, spelled as it spells them.
 for(const ok of ['Complete','Complete (cut off)','Not BC',"Can't Complete"]) assert.equal(statusOf({...retina,status:ok}),ok);
 // No status sent (an older client, the menu's Mark as Proofread): plain Complete, as before.
 assert.equal(statusOf(retina),'Complete');
 assert.equal(statusOf({...retina,status:''}),'Complete');
 // In-progress options, near misses, formulas and junk never reach the sheet.
 for(const bad of ['WIP','Need Help','complete','Complete (cut-off)','Complete (cut off) ','Can\u2019t Complete','=HYPERLINK("https://x","y")','Done',' ',123,{},['Complete']])
  assert.throws(()=>sheetValues({...retina,status:bad},me,rtask,'now'),/not one of this sheet/);
 // A sheet with no list of its own takes plain Complete only.
 assert.equal(sheetValues({...input,status:'Complete'},me,task,'now').find(f=>f[0][0]==='status')[1],'Complete');
 assert.throws(()=>sheetValues({...input,status:'Complete (cut off)'},me,task,'now'),/not one of this sheet/);
 assert.throws(()=>sheetValues({...input,dataset:'pni_mec',status:'Not BC'},me,{...task,dataset:'pni_mec'},'now'),/not one of this sheet/);
});
test('completing replaces an in-progress Status (WIP, Need Help), never a final one',()=>{
 const header=['Start SegID','Proofreader','Status','Date Complete'];
 const retina={...input,dataset:'stroeh_mouse_retina',status:'Complete (cut off)'}, rtask={...task,dataset:'stroeh_mouse_retina'};
 const run=row=>{
  const plan=planSheetUpdate([header,row],'Focused BCs','123',sheetValues(retina,me,rtask,'10/3/2026'));
  return Object.fromEntries([...plan.data,...plan.userEnteredData].map(x=>[x.range.split('!')[1],x.values[0][0]]));
 };
 for(const wip of ['WIP','Need Help']) {
  const out=run(['123','Someone Else',wip,'']);
  assert.equal(out.C2,'Complete (cut off)');
  // The row was not finished, so the completer becomes the Proofreader too.
  assert.equal(out.B2,me.display_name||me.username);
 }
 // A row the lab already gave a final status keeps it, and keeps its Proofreader.
 for(const final of ['Complete','Not BC',"Can't Complete",'Complete (cut off)']) {
  const out=run(['123','Someone Else',final,'9/1/2026']);
  assert.equal(out.C2,undefined);
  assert.equal(out.B2,undefined);
 }
});

test('the sheet keeps the spelling it already has for a player, and never swaps in another name',()=>{
 // Krzysztof: Pyr has the name from his sign in, the sheet has it without the space
 assert.equal(sheetSpelling('Krzysztof Kruk',['KrzysztofKruk','KrzysztofKruk','Nseraf','Krzysztof Kruk']),'KrzysztofKruk');
 // capitals: the sheet's usual spelling wins
 assert.equal(sheetSpelling('annkri',['Annkri','Annkri','annkri']),'Annkri');
 // a tie goes to the player's own spelling
 assert.equal(sheetSpelling('Celia D',['CeliaD','Celia D']),'Celia D');
 // a username or nickname in the sheet is a different name and is not used
 assert.equal(sheetSpelling('Jaime Skelton',['AzureJay','azurejay']),'');
 assert.equal(sheetSpelling('Amy R. Sterling',['amy','Nseraf']),'');
 // nothing to go on
 assert.equal(sheetSpelling('',['x']),'');
 assert.equal(sheetSpelling('New Player',[]),'');
 assert.equal(sheetSpelling('New Player',null),'');

 const input={dataset:'stroeh_mouse_retina',segmentId:'123',action:'claim'};
 const task={assigned_to:'kk',dataset:'stroeh_mouse_retina',segment_id:'123',status:'assigned'};
 const nameOf=me=>sheetValues(input,me,task,'10/8/2026')[0][1];
 assert.equal(nameOf({id:'kk',display_name:'Krzysztof Kruk',sheet_name:'KrzysztofKruk'}),'KrzysztofKruk');
 // no spelling found: the display name, as it always was, even with a username set
 assert.equal(nameOf({id:'kk',username:'celiad',display_name:'Celia D',sheet_name:''}),'Celia D');
 assert.equal(nameOf({id:'kk',username:'celiad',display_name:''}),'celiad');
});
test('releasing a claim takes the player\'s own name off the row, and nothing else',()=>{
 const rel={dataset:'stroeh_mouse_retina',segmentId:'123',action:'release'};
 const annkri={id:'mine',display_name:'annkri',username:'Annkri'};
 const held={assigned_to:'mine',dataset:rel.dataset,segment_id:'123',status:'in_progress'};
 const head=['Start SegID','Proofreader','Status','Date Started','Notes'];
 const plan=(row,who=annkri,t=held)=>planSheetUpdate([head,row],'cells','123',sheetValues(rel,who,t,'now'));
 // Her name, in either spelling, on an open claim: cleared, with the start date.
 assert.deepEqual(plan(['123','Annkri','','10/8/2026','keep me']).data,[{range:"'cells'!B2",values:[['']]},{range:"'cells'!D2",values:[['']]}]);
 assert.deepEqual(plan(['123','annkri','WIP','','']).data,[{range:"'cells'!B2",values:[['']]}]);
 // Someone else's name stays, and so does its start date.
 assert.deepEqual(plan(['123','Nseraf','','10/8/2026','']).data,[]);
 // A row waiting on a gamemaster or already finished keeps its name.
 assert.deepEqual(plan(['123','Annkri','Need Help','','']).data,[]);
 assert.deepEqual(plan(['123','Annkri','Complete (cut off)','','']).data,[]);
 assert.deepEqual(plan(['123','Annkri',"Can't Complete",'','']).data,[]);
 // Nothing to clear: nothing written.
 assert.deepEqual(plan(['123','','','','']).data,[]);
 // Only the player who holds the claim, and never a completed cell.
 assert.throws(()=>sheetValues(rel,annkri,{...held,assigned_to:'someone-else'},'now'));
 assert.throws(()=>sheetValues(rel,annkri,{...held,status:'completed'},'now'));
 assert.throws(()=>sheetValues(rel,annkri,{...held,status:'pending'},'now'));
 // The name as the sheet spells it (spaces and capitals aside) counts as hers.
 assert.deepEqual(plan(['123','KrzysztofKruk','','',''],{id:'mine',display_name:'Krzysztof Kruk'}).data,[{range:"'cells'!B2",values:[['']]}]);
});
test('reopening a completed cell puts its row back to WIP, and the next completion replaces what the first one wrote',()=>{
 const base={dataset:'stroeh_mouse_retina',segmentId:'123'};
 const kk={id:'mine',display_name:'Krzysztof Kruk',username:'KrzysztofKruk'};
 const open={assigned_to:'mine',dataset:base.dataset,segment_id:'123',status:'in_progress',final_segment_id:'456'};
 const head=['Start SegID','Proofreader','Status','Date Complete','Final SegID','Final Link','Notes'];
 const reopen=row=>planSheetUpdate([head,row],'cells','123',sheetValues({...base,action:'reopen'},kk,open,'10/10/2026'));
 // His own finished row: Status becomes WIP and nothing else is touched.
 assert.deepEqual(reopen(['123','KrzysztofKruk','Complete (cut off)','10/9/2026','456','https://old.example/link','note']).data,[{range:"'cells'!C2",values:[['WIP']]}]);
 assert.deepEqual(reopen(['123','KrzysztofKruk','Complete','10/9/2026','456','','']).data,[{range:"'cells'!C2",values:[['WIP']]}]);
 // Someone else's row, or a row that is not finished: left alone.
 assert.deepEqual(reopen(['123','Nseraf','Complete (cut off)','10/9/2026','456','','']).data,[]);
 assert.deepEqual(reopen(['123','KrzysztofKruk','Need Help','','','','']).data,[]);
 assert.deepEqual(reopen(['123','KrzysztofKruk','','','','','']).data,[]);
 // The claim must be open again first.
 assert.throws(()=>sheetValues({...base,action:'reopen'},kk,{...open,status:'completed'},'now'));
 assert.throws(()=>sheetValues({...base,action:'reopen'},kk,{...open,assigned_to:'someone-else'},'now'));
 // Completing it again: the WIP row takes the new status, date, final ID and link.
 const done={...open,status:'completed',final_segment_id:'789'};
 const again=row=>planSheetUpdate([head,row],'cells','123',sheetValues({...base,action:'complete',status:'Complete',link:'https://new.example/link'},kk,done,'10/10/2026'));
 const p=again(['123','KrzysztofKruk','WIP','10/9/2026','456','https://old.example/link','note']);
 const wrote=Object.fromEntries([...p.data,...p.userEnteredData].map(d=>[d.range.slice(-2),d.values[0][0]]));
 assert.deepEqual(wrote,{C2:'Complete',D2:'10/10/2026',E2:'789',F2:'https://new.example/link'});
 // A row that was never reopened keeps a filled date, final ID and link, as before.
 const q=again(['123','KrzysztofKruk','','10/1/2026','111','https://kept.example/link','']);
 assert.deepEqual(Object.fromEntries([...q.data,...q.userEnteredData].map(d=>[d.range.slice(-2),d.values[0][0]])),{C2:'Complete'});
 // WIP under another player's name: their date, ID and link are not replaced.
 const r=again(['123','Nseraf','WIP','10/1/2026','111','https://kept.example/link','']);
 assert.equal([...r.data,...r.userEnteredData].some(d=>/[DEF]2$/.test(d.range)),false);
});
