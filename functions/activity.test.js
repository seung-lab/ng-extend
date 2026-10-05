const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cleanActivityRow,verifyGraphEdit,stripCounters,MAX_OPERATION_AGE_MS}=require('./activity-policy');
const {recordActivity,serverCounts,resetServerCounts}=require('./activity');
const who={email:'player@example.invalid',caveId:2455}, me={id:'11111111-1111-4111-8111-111111111111'};
const graph='https://minnie.microns-daf.com/segmentation/api/v1/table/stroeh_mouse_retina';
const now=Date.parse('2026-10-05T12:00:00Z');
const stamp=ms=>new Date(ms).toISOString().replace('T',' ').replace('Z','+00:00');
let caveCalls=[];
const cave=(details,status=200)=>async(url,init)=>{caveCalls.push({url,auth:init.headers.Authorization});return {ok:status===200,status,json:async()=>details};};
const detail=(over={})=>({'77':{user:'2455',operation_status:0,timestamp:stamp(now-5000),removed_edges:[],...over}});

test('a reported row keeps only known fields, and never identity, time or a verified mark',()=>{
 const r=cleanActivityRow({operation:'merge',user_id:'someone-else',timestamp:'2020-01-01',id:5,evil:1,metadata:{diff:1,verified:true,operation_id:'77',graph}});
 assert.deepEqual(Object.keys(r).sort(),['coordinates','dataset','metadata','op_key','operation','segment_after','segment_before','success','task_id']);
 assert.equal(r.metadata.verified,undefined);
 assert.equal(r.op_key,'pcg:stroeh_mouse_retina:77');
 assert.throws(()=>cleanActivityRow({operation:'award_points'}),/Unknown operation/);
 assert.throws(()=>cleanActivityRow({operation:'merge',success:'yes'}),/success/);
 assert.throws(()=>cleanActivityRow({operation:'merge',task_id:'1; drop'}),/task/);
 assert.throws(()=>cleanActivityRow({operation:'merge',dataset:'a b'}),/dataset/);
 assert.throws(()=>cleanActivityRow({operation:'merge',metadata:[1]}),/details/);
 assert.throws(()=>cleanActivityRow({operation:'merge',metadata:{x:'y'.repeat(5000)}}),/too large/);
 assert.throws(()=>cleanActivityRow([{operation:'merge'}]),/Invalid row/);
});
test('a split or merge is keyed by the graph server, anything else by a pressed-button id',()=>{
 // The browser cannot choose the key of an edit.
 assert.equal(cleanActivityRow({operation:'split',op_key:'pcg:stroeh_mouse_retina:1',metadata:{}}).op_key,null);
 assert.equal(cleanActivityRow({operation:'split',metadata:{operation_id:'12',graph:'https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2'},dataset:'stroeh_mouse_retina'}).dataset,'pinky_nf_v2');
 assert.equal(cleanActivityRow({operation:'split',metadata:{operation_id:'-1',graph}}).op_key,null);
 assert.equal(cleanActivityRow({operation:'split',metadata:{operation_id:'12',graph:'http://minnie.microns-daf.com/segmentation/table/x'}}).op_key,null);
 assert.equal(cleanActivityRow({operation:'mark_complete',op_key:'a1b2c3d4-e5f6'}).op_key,'c:a1b2c3d4-e5f6');
 assert.throws(()=>cleanActivityRow({operation:'mark_complete',op_key:'pcg:x:1'}),/operation key/);
});
test('the graph server decides whether an edit happened and whose it is',async()=>{
 const row=cleanActivityRow({operation:'merge',metadata:{operation_id:'77',graph}});
 caveCalls=[];
 // It says what the operation was: a removed edge is a split, whatever was reported.
 assert.deepEqual(await verifyGraphEdit(row,who,'tok',cave(detail()),now),{state:'verified',operation:'split'});
 assert.equal((await verifyGraphEdit(row,who,'tok',cave(detail({removed_edges:undefined,added_edges:[]})),now)).operation,'merge');
 // The token goes to the graph host only, for that one operation.
 assert.match(caveCalls[0].url,/^https:\/\/minnie\.microns-daf\.com\/segmentation\/api\/v1\/table\/stroeh_mouse_retina\/operation_details\?int64_as_str=1&operation_ids=%5B77%5D$/);
 assert.equal(caveCalls[0].auth,'Bearer tok');
 const cases=[[{},/no such operation/],[detail({user:'5044'}),/not yours/],[detail({operation_status:1}),/did not succeed/],
   [detail({timestamp:stamp(now-MAX_OPERATION_AGE_MS-1000)}),/not a current edit/],[detail({timestamp:stamp(now+3600000)}),/not a current edit/],
   [detail({removed_edges:undefined}),/not a split or a merge/]];
 for (const [d,why] of cases) {
   const v=await verifyGraphEdit(row,who,'tok',cave(d),now);
   assert.equal(v.state,'rejected'); assert.match(v.why,why);
 }
 // No answer is not a rejection.
 assert.equal((await verifyGraphEdit(row,who,'tok',cave({},503),now)).state,'unverified');
 assert.equal((await verifyGraphEdit(row,who,'tok',async()=>{throw new Error('down');},now)).state,'unverified');
 // No operation id (an older app version), or a graph server we do not ask: never contacted.
 caveCalls=[];
 assert.equal((await verifyGraphEdit(cleanActivityRow({operation:'merge',metadata:{diff:1}}),who,'tok',cave(detail()),now)).state,'unverified');
 assert.equal((await verifyGraphEdit(cleanActivityRow({operation:'merge',metadata:{operation_id:'77',graph:'https://hc.himc-cave.com/segmentation/api/v1/table/pni_mec'}}),who,'tok',cave(detail()),now)).state,'unverified');
 assert.equal((await verifyGraphEdit(cleanActivityRow({operation:'merge',metadata:{operation_id:'77',graph:'https://evil.example/segmentation/table/stroeh_mouse_retina'}}),who,'tok',cave(detail()),now)).state,'unverified');
 assert.equal(caveCalls.length,0);
 assert.equal((await verifyGraphEdit(cleanActivityRow({operation:'mark_complete'}),who,'tok',cave(detail()),now)).state,'not_applicable');
});
test('before the database function exists nothing changes; after, the server counts',async()=>{
 resetServerCounts();
 const calls=[]; let installed=false;
 const rpc=async(name,args)=>{calls.push(args);
   if(!installed) return {status:404,body:{code:'PGRST202'}};
   if(args.p_user.startsWith('0000')) return {status:400,body:{code:'P0001',message:'unknown player'}};
   return {status:200,body:{recorded:true,duplicate:false,total_edits:3}};};
 const legacy=[]; const insertLegacy=async row=>{legacy.push(row);};
 const value={operation:'merge',metadata:{operation_id:'77',graph}};
 const fresh=over=>cave({'77':{user:'2455',operation_status:0,timestamp:stamp(Date.now()-5000),...over}});
 let out=await recordActivity({rpc,insertLegacy,who,me,token:'tok',value,fetchImpl:fresh({removed_edges:[]})});
 assert.deepEqual(out,{counted:false});
 assert.equal(legacy[0].user_id,me.id); assert.equal('op_key' in legacy[0],false);
 assert.equal(await serverCounts(rpc,Date.now()),false);            // not asked again straight away
 installed=true;
 assert.equal(await serverCounts(rpc,Date.now()+6*60*1000),true);   // noticed by itself
 out=await recordActivity({rpc,insertLegacy,who,me,token:'tok',value,fetchImpl:fresh({added_edges:[]})});
 assert.deepEqual([out.counted,out.verified,out.total_edits],[true,true,3]);
 const sent=calls.at(-1);
 assert.equal(sent.p_user,me.id); assert.equal(sent.p_row.metadata.verified,true); assert.equal(sent.p_row.op_key,'pcg:stroeh_mouse_retina:77');
 assert.equal(legacy.length,1);
 // A rejected edit is not recorded at all.
 const before=calls.length;
 await assert.rejects(()=>recordActivity({rpc,insertLegacy,who,me,token:'tok',value,fetchImpl:fresh({added_edges:[],user:'1'})}),/not yours/);
 assert.equal(calls.length,before);
 // An older app version (no operation id) is recorded, marked unverified.
 out=await recordActivity({rpc,insertLegacy,who,me,token:'tok',value:{operation:'split',metadata:{diff:1}},fetchImpl:fresh({})});
 assert.equal(out.verified,false); assert.equal(calls.at(-1).p_row.metadata.verified,false);
 await assert.rejects(()=>recordActivity({rpc,insertLegacy,who,me:null,token:'tok',value}),/Sign in/);
 resetServerCounts();
});
test('counters are taken out of profile writes',()=>{
 const row={display_name:'A',total_edits:1e9,cells_completed:5,current_streak:400,total_annotations:7,last_edit_date:'2026-10-05',updated_at:'x'};
 assert.equal(stripCounters(row),true);
 assert.deepEqual(row,{display_name:'A',updated_at:'x'});
 assert.equal(stripCounters({flag:'x'}),false);
});
