// Read-only fixture discovery. All CAVE destinations and roots come from reviewed Git.
import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync(new URL('../config/practice-reset-manifest.json',import.meta.url),'utf8'));
const token=process.env.CAVE_SERVICE_TOKEN;
if(!token) throw Error('CAVE_SERVICE_TOKEN is missing');
const get=async(base,path)=>{const r=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`CAVE read failed (${r.status})`);return r.json();};
for(const [id,fixture] of Object.entries(manifest)) {
 if(fixture.pcg_server!=='https://minnie.microns-daf.com'||fixture.pcg_table!=='pinky_nf_v2')throw Error('Unapproved sandbox');
 const base=fixture.pcg_server+'/segmentation/api/v1/table/'+fixture.pcg_table;
 const descend=async(root)=>{let node=String(root);for(let i=0;i<12;i++){if(!/^\d{1,20}$/.test(node))throw Error('Invalid node');if(BigInt(node)>>56n===1n)return node;const data=await get(base,`/node/${node}/children?int64_as_str=1`);node=String((data.children_ids??data.children??[])[0]);}throw Error('No supervoxel found');};
 const a=fixture.supervoxel_a||await descend(fixture.root_a);
 const b=fixture.supervoxel_b||await descend(fixture.root_b);
 const rootA=await get(base,`/node/${a}/root?int64_as_str=1`),rootB=await get(base,`/node/${b}/root?int64_as_str=1`);
 console.log(JSON.stringify({id,...fixture,supervoxel_a:a,supervoxel_b:b,current_root_a:rootA.root_id,current_root_b:rootB.root_id}));
 for(const root of new Set([rootA.root_id,rootB.root_id])) {
  const log=await get(base,`/root/${root}/tabular_change_log`);
  const describe=value=>({type:Array.isArray(value)?'array':typeof value,keys:value&&typeof value==='object'?Object.keys(value).slice(0,12):[],length:Array.isArray(value)?value.length:undefined});
  console.log(JSON.stringify({root,history:describe(log),children:Object.fromEntries(Object.entries(log).slice(0,6).map(([k,v])=>[k,describe(v)]))}));
  if(log.operation_id && log.timestamp) console.log(JSON.stringify({root,operations:Object.keys(log.operation_id).slice(-10).map(i=>({id:log.operation_id[i],timestamp:log.timestamp[i],is_merge:log.is_merge?.[i],before:log.before_root_ids?.[i],after:log.after_root_ids?.[i]}))}));
 }
}
