// Read-only fixture discovery. All CAVE destinations and roots come from reviewed Git.
import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync(new URL('../config/practice-reset-manifest.json',import.meta.url),'utf8'));
// Cells under investigation, read only (never reset from here): the same
// reviewed-Git rule, kept apart so the reset job does not pick them up.
const inspectOnly=JSON.parse(fs.readFileSync(new URL('../config/practice-inspect-only.json',import.meta.url),'utf8'));
const token=process.env.CAVE_SERVICE_TOKEN;
if(!token) throw Error('CAVE_SERVICE_TOKEN is missing');
const get=async(base,path)=>{const r=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`CAVE read failed (${r.status})`);return r.json();};
for(const [id,fixture] of Object.entries({...manifest,...inspectOnly})) {
 if(fixture.pcg_server!=='https://minnie.microns-daf.com'||fixture.pcg_table!=='pinky_nf_v2')throw Error('Unapproved sandbox');
 const base=fixture.pcg_server+'/segmentation/api/v1/table/'+fixture.pcg_table;
 const descend=async(root)=>{let node=String(root);for(let i=0;i<12;i++){if(!/^\d{1,20}$/.test(node))throw Error('Invalid node');if(BigInt(node)>>56n===1n)return node;const data=await get(base,`/node/${node}/children?int64_as_str=1`);node=String((data.children_ids??data.children??[])[0]);}throw Error('No supervoxel found');};
 const a=fixture.supervoxel_a||await descend(fixture.root_a);
 const b=fixture.supervoxel_b||await descend(fixture.root_b);
 const rootA=await get(base,`/node/${a}/root?int64_as_str=1`),rootB=await get(base,`/node/${b}/root?int64_as_str=1`);
 console.log(JSON.stringify({id,...fixture,supervoxel_a:a,supervoxel_b:b,current_root_a:rootA.root_id,current_root_b:rootB.root_id}));
 const baselineRoots=[];
 for(const sv of [a,b])baselineRoots.push(await get(base,`/node/${sv}/root?int64_as_str=1&timestamp=${Date.parse(fixture.baseline_at)/1000}`));
 console.log(JSON.stringify({id,baselineRoots}));
 for(const root of new Set([rootA.root_id,rootB.root_id])) {
  console.log(JSON.stringify({root,changeLog:await get(base,`/root/${root}/change_log?filtered=false&int64_as_str=1`)}));
  const log=await get(base,`/root/${root}/tabular_change_log?filtered=false&int64_as_str=1`);
  const describe=value=>({type:Array.isArray(value)?'array':typeof value,keys:value&&typeof value==='object'?Object.keys(value).slice(0,12):[],length:Array.isArray(value)?value.length:undefined});
  console.log(JSON.stringify({root,history:describe(log),children:Object.fromEntries(Object.entries(log).slice(0,6).map(([k,v])=>[k,describe(v)]))}));
  if(log.operation_id && log.timestamp) console.log(JSON.stringify({root,operations:Object.keys(log.operation_id).slice(-30).map(i=>({id:log.operation_id[i],timestamp:log.timestamp[i],is_merge:log.is_merge?.[i],before:log.before_root_ids?.[i],after:log.after_root_ids?.[i]}))}));
  // How each recent operation is recorded, undo links included.
  const t=log.operation_id?log:(log[root]??log);
  if(t.operation_id){const ids=Object.keys(t.operation_id).slice(-30).map(i=>Number(t.operation_id[i]));
   const details=await get(base,'/operation_details?int64_as_str=1&operation_ids='+encodeURIComponent(JSON.stringify(ids)));
   console.log(JSON.stringify({root,details:Object.fromEntries(Object.entries(details).map(([k,v])=>[k,{status:v.operation_status,undo_of:v.undo_operation_id,redo_of:v.redo_operation_id,added:v.added_edges?.length,removed:v.removed_edges?.length,sources:v.source_ids??v.source_coords?.length,user:v.user}]))}));}
 }
}

// Tutorial 1's neuron (config/intro-reset-fixtures.json): its pinned ids,
// their roots today, and the recent history, read only.
const intro=JSON.parse(fs.readFileSync(new URL('../config/intro-reset-fixtures.json',import.meta.url),'utf8'));
for(const [name,fx] of Object.entries(intro)) {
 if(fx.pcg_server!=='https://minnie.microns-daf.com'||fx.pcg_table!=='pinky_training6')throw Error('Unapproved intro sandbox');
 const base=fx.pcg_server+'/segmentation/api/v1/table/'+fx.pcg_table;
 const roots=[];
 for(const pinned of fx.roots){let node=pinned;for(let i=0;i<12&&BigInt(node)>>56n!==1n;i++){const d=await get(base,`/node/${node}/children?int64_as_str=1`);node=String((d.children_ids??d.children??[])[0]);}
  const now=String((await get(base,`/node/${node}/root?int64_as_str=1`)).root_id);roots.push({pinned,supervoxel:node,now});}
 console.log(JSON.stringify({intro:name,roots}));
 for(const root of new Set(roots.map(r=>r.now))){
  const log=await get(base,`/root/${root}/tabular_change_log?filtered=false&int64_as_str=1`);const t=log.operation_id?log:(log[root]??log);
  if(t.operation_id)console.log(JSON.stringify({intro:name,root,operations:Object.keys(t.operation_id).slice(-15).map(i=>({id:t.operation_id[i],timestamp:t.timestamp[i],is_merge:t.is_merge?.[i],user:t.user_id?.[i],before:t.before_root_ids?.[i],after:t.after_root_ids?.[i]}))}));
 }
}

// The points people placed for a reviewed cut (red sources, blue sinks), read
// only: config/practice-inspect-ops.json lists operation ids per table.
const ops=JSON.parse(fs.readFileSync(new URL('../config/practice-inspect-ops.json',import.meta.url),'utf8'));
for(const [table,ids] of Object.entries(ops)){
 if(table!=='pinky_nf_v2')throw Error('Unapproved sandbox');
 const base='https://minnie.microns-daf.com/segmentation/api/v1/table/'+table;
 const d=await get(base,'/operation_details?int64_as_str=1&operation_ids='+encodeURIComponent(JSON.stringify(ids)));
 for(const [id,v] of Object.entries(d)){
  console.log(JSON.stringify({op:id,source_coords:v.source_coords,sink_coords:v.sink_coords,source_ids:v.source_ids,sink_ids:v.sink_ids}));
  // Which piece each side ended up on, a second after the cut.
  const at=v.timestamp?Date.parse(String(v.timestamp).replace(' ','T')+(/[zZ]|[+-]\d\d:?\d\d$/.test(String(v.timestamp))?'':'Z'))/1000+1:null;
  if(at&&v.source_ids?.length&&v.sink_ids?.length){
   const r=async sv=>String((await get(base,`/node/${sv}/root?int64_as_str=1&timestamp=${at}`)).root_id);
   console.log(JSON.stringify({op:id,source_root_after:await r(String(v.source_ids[0])),sink_root_after:await r(String(v.sink_ids[0]))}));
  } else console.log(JSON.stringify({op:id,note:'no timestamp in details',keys:Object.keys(v)}));
 }
}
