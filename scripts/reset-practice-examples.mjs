#!/usr/bin/env node
// Resets only reviewed Pinky practice fixtures after the learner releases them.
import fs from 'node:fs';
import {validateResetExample,validateIntroFixture,resetDue,operationsAfter,overlapsActive,remainingOperations} from './practice-reset-policy.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../config/practice-reset-manifest.json',import.meta.url),'utf8'));
const args=process.argv.slice(2),dryRun=args.includes('--dry-run');
const onlyId=args.includes('--id') ? args[args.indexOf('--id')+1] : null;
if(args.includes('--id') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(onlyId||'')) throw Error('Invalid example UUID');
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,token=process.env.CAVE_SERVICE_TOKEN;
if(!url||!key||!token) throw Error('Missing configured Supabase or CAVE credentials');
if(new URL(url).origin!=='https://javthknksdcrlhiaaptj.supabase.co') throw Error('Unapproved database');
const headers={apikey:key,...(key.startsWith('sb_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json',Prefer:'return=representation'};
async function sb(path,body,method=body?'PATCH':'GET') {
 const r=await fetch(url+'/rest/v1/'+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Practice database request failed ('+r.status+')');return r.json();
}
async function cave(ex,path,body) {
 const base=validateResetExample(ex,manifest);
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Practice CAVE request failed ('+r.status+') for '+path);return r.json();
}
async function roots(ex) {
 const result=[];
 for(const sv of [ex.supervoxel_a,ex.supervoxel_b]) {
  const d=await cave(ex,`/node/${sv}/root?int64_as_str=1`);
  const root=String(d.root_id);if(!/^\d{1,20}$/.test(root))throw Error('Invalid CAVE root response');result.push(root);
 }
 return result;
}
function checkBaseline(ex,[a,b]) {
 if((a===b)!==(ex.kind==='cut'))throw Error('Practice pieces do not match their registered starting state');
}
async function reset(ex,assertLease=async()=>{}) {
 const ops=new Map();
 for(const root of new Set(await roots(ex))) {
  // The filtered view can omit recent merges and splits from a root's lineage.
  const data=await cave(ex,`/root/${root}/tabular_change_log?filtered=false`);
  for(const op of operationsAfter(data,root,ex.baseline_at))ops.set(op.operationId,op);
 }
 if(ops.size>10000)throw Error('Unexpectedly large practice history; manual review required');
 const ids=[...ops.keys()],details={};
 for(let i=0;i<ids.length;i+=100)Object.assign(details,await cave(ex,'/operation_details?int64_as_str=1&operation_ids='+encodeURIComponent(JSON.stringify(ids.slice(i,i+100)))));
 const active=remainingOperations([...ops.values()],details);
 console.log(`[reset] ${ex.id}: ${active.length} active operation(s) after the reviewed baseline (${ops.size-active.length} cancelled history entries)`);
 for(const op of active) {
  if(dryRun)console.log('[reset] would undo '+op.operationId);
  else { await assertLease(); await cave(ex,'/undo?int64_as_str=1',{operation_id:op.operationId}); }
 }
 if(dryRun)return null;
 const result=await roots(ex);checkBaseline(ex,result);return result;
}
async function main() {
 const path='tutorial_practice_examples?enabled=eq.true';
 const rows=await sb(path+'&select=*');let failed=0;
 for(const ex of rows) {
  if(onlyId&&ex.id!==onlyId)continue;
  let lockQuery;
  try {
   // A cell nobody has reviewed into the manifest is not this job's to touch.
   // Skipping it is not a failure: a failure here emails the repo owner every run.
   if(!manifest[ex.id]){console.log('[reset] '+ex.id+': not in the reviewed manifest, skipped');continue;}
   validateResetExample(ex,manifest);
   if(overlapsActive(ex,rows,Date.now())){console.log('[reset] '+ex.id+': shares a piece with an active learner, skipped');continue;}
   if(!resetDue(ex,Date.now(),Boolean(onlyId))) {
    if(ex.status==='ready'){checkBaseline(ex,await roots(ex));console.log('[practice test] '+ex.id+': ready state verified');}
    else if(ex.status==='broken')throw Error('Practice fixture is marked broken');
    else console.log('[reset] '+ex.id+': active session, skipped');
    continue;
   }
   if(!dryRun) {
    const locked=await sb('rpc/pilot_worker_reset_lease',{p_id:ex.id,p_expected:ex.updated_at},'POST');
    if(!locked){console.log('[reset] '+ex.id+': session changed, skipped');continue;}
    lockQuery='tutorial_practice_examples?id=eq.'+ex.id+'&status=eq.resetting&reset_nonce=eq.'+locked.reset_nonce;

   }
   const result=await reset(ex,async()=>{
    const lease=await sb(lockQuery+'&select=id');
    if(!lease.length)throw Error('Reset lease changed; stopped before undo');
   });
   if(result) {
    const updated=await sb(lockQuery,{status:'ready',reset_nonce:null,...(ex.kind==='cut'?{}:{root_a:result[0],root_b:result[1]}),reset_failures:0,last_error:null,last_reset_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    if(!updated.length)throw Error('Reset lease changed; row was not overwritten');
    console.log('[practice test] '+ex.id+': reset and starting state verified');
   }
  }catch(e){
   failed++;console.error('[reset] '+ex.id+': '+e.message);
   if(lockQuery){const failures=(ex.reset_failures||0)+1;await sb(lockQuery,{status:failures>=3?'broken':'needs_reset',reset_nonce:null,reset_failures:failures,last_error:e.message.slice(0,500),updated_at:new Date().toISOString()});}
  }
 }
 if(failed)process.exitCode=2;
}
// Tutorial 1's sandbox neuron: undo any edit made on it after its baseline,
// so a learner who already knows how to merge cannot break the lesson.
// The tutorial follows the neuron's new root id itself (src/intro_roots.ts).
async function resetIntroFixtures() {
 const fixtures=JSON.parse(fs.readFileSync(new URL('../config/intro-reset-fixtures.json',import.meta.url),'utf8'));
 let failed=0;
 for(const [name,fx] of Object.entries(fixtures)) {
  if(onlyId)continue;
  try {
   const base=validateIntroFixture(fx);
   const get=async p=>{const r=await fetch(base+p,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Intro CAVE request failed ('+r.status+') for '+p.split('?')[0]);return r.json();};
   const ops=new Map();
   for(const pinned of fx.roots) {
    // Down to a supervoxel (old roots keep their children), then up to today's root.
    let id=pinned;
    for(let i=0;i<12&&Math.floor(Number(id)/2**56)>1;i++){const d=await get(`/node/${id}/children?int64_as_str=1`);const kids=(d.children_ids??d.children??[]).map(String);if(!kids.length)throw Error('No children for '+id);id=kids[0];}
    const now=String((await get(`/node/${id}/root?int64_as_str=1`)).root_id);
    if(!/^\d{1,20}$/.test(now))throw Error('Invalid CAVE root response');
    const data=await get(`/root/${now}/tabular_change_log?filtered=false`);
    for(const op of operationsAfter(data,now,fx.baseline_at))ops.set(op.operationId,op);
   }
   const ids=[...ops.keys()],details={};
   for(let i=0;i<ids.length;i+=100)Object.assign(details,await get('/operation_details?int64_as_str=1&operation_ids='+encodeURIComponent(JSON.stringify(ids.slice(i,i+100)))));
   const active=remainingOperations([...ops.values()],details);
   console.log(`[intro] ${name}: ${active.length} edit(s) after the baseline`);
   for(const op of active) {
    if(dryRun){console.log('[intro] would undo '+op.operationId);continue;}
    const r=await fetch(base+'/undo?int64_as_str=1',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({operation_id:op.operationId}),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error('Intro undo failed ('+r.status+') for operation '+op.operationId);
    console.log('[intro] undid '+op.operationId);
   }
  } catch(e){failed++;console.error('[intro] '+name+': '+e.message);}
 }
 if(failed)process.exitCode=2;
}

main().then(resetIntroFixtures).catch(e=>{console.error(e.message);process.exitCode=1;});
