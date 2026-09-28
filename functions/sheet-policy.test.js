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
