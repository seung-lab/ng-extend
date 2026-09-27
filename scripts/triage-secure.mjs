// Trusted coordinator. Never imports, executes or checks out model-produced code.
import fs from 'node:fs';
import {SHA,UUID,validateResult,approvedRelease,permittedPath} from './triage-policy.mjs';
const env=process.env,repo='seung-lab/ng-extend',base='eyewire-ii-community';
const id=env.ROW_ID;
if(!UUID.test(id||''))throw Error('Invalid triage row UUID');
const branch='triage/'+id.slice(0,8),mode=env.TRIAGE_MODE||'build';
const out=(k,v)=>{if(env.GITHUB_OUTPUT)fs.appendFileSync(env.GITHUB_OUTPUT,k+'='+v+'\n');};
async function gh(path,body,method=body?'POST':'GET') {
 const r=await fetch('https://api.github.com/repos/'+repo+'/'+path,{method,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('GitHub '+path+' failed ('+r.status+')');return r.status===204?null:r.json();
}
async function sb(path,body) {
 const key=env.SUPABASE_SERVICE_ROLE_KEY;
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method:body?'PATCH':'GET',headers:{apikey:key,...(key.startsWith('sb_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Triage database request failed ('+r.status+')');return r.json();
}
async function row(){const r=(await sb('feedback_triage?id=eq.'+id+'&select=*'))[0];if(!r||r.status!=='approved')throw Error('Triage item is not approved');return r;}
async function head(ref){return (await gh('git/ref/heads/'+ref)).object.sha;}
async function deploy(sha,version) {
 if(!SHA.test(sha)||! /^(eyewire-ii-community|triage-[0-9a-f]{8})$/.test(version))throw Error('Invalid deployment target');
 const deploymentId='triage-'+env.GITHUB_RUN_ID+'-'+mode;
 await gh('actions/workflows/on_dev_branch_push.yml/dispatches',{ref:base,inputs:{source_ref:sha,version,deployment_id:deploymentId}});
 // A GITHUB_TOKEN push does not trigger another workflow. Dispatch trusted YAML explicitly.
 for(let i=0;i<150;i++) {
  await new Promise(r=>setTimeout(r,10000));
  const runs=await gh('actions/workflows/on_dev_branch_push.yml/runs?event=workflow_dispatch&branch='+base+'&per_page=30');
  const run=runs.workflow_runs.find(r=>r.display_title==='Deploy '+deploymentId);
  if(!run||run.status!=='completed')continue;
  if(run.conclusion!=='success')throw Error('Build/deploy failed: '+run.html_url);
  const url=version===base?'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/':`https://${version}-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/`;
  const response=await fetch(url+'build-commit.txt?run='+env.GITHUB_RUN_ID,{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok||(await response.text()).trim()!==sha)throw Error('Deployed build does not match the expected commit');
  return;
 }
 throw Error('Build/deploy timed out');
}
async function plan() {
 const current=await row();
 if(!['build','answer'].includes(mode))throw Error('Invalid implementation mode');
 const baseSha=await head(base);
 const preview=[...(current.feedback_log||[])].reverse().find(e=>e.role==='preview'&&SHA.test(e.sha));
 const sourceSha=mode==='answer'&&preview?preview.sha:baseSha;
 fs.mkdirSync('.triage',{recursive:true});
 fs.writeFileSync('.triage/plan.json',JSON.stringify({rowId:id,baseSha,sourceSha,branch,mode}));
 out('source_sha',sourceSha);out('base_sha',baseSha);
}
async function publish() {
 const plan=JSON.parse(fs.readFileSync('.triage/plan.json','utf8'));
 if(plan.rowId!==id||plan.branch!==branch||plan.mode!==mode||!SHA.test(plan.baseSha))throw Error('Invalid trusted build plan');
 const result=validateResult(JSON.parse(fs.readFileSync('model-output/result.json','utf8')));
 fs.writeFileSync('.triage/triage-summary.md',result.summary);
 if(mode==='answer'){if(result.files.length)throw Error('Answer changed source files');out('next','answered');return;}
 if(/^\s*(?:#+\s*)?(QUESTION|BLOCKED):/i.test(result.summary)){if(result.files.length)throw Error('Blocked run changed source files');out('next','blocked');return;}
 if(!result.files.length)throw Error('Model produced no changes');
 await row();
 const commit=await gh('git/commits/'+plan.baseSha),tree=[];
 for(const file of result.files) {
  const sha=file.content===null?null:(await gh('git/blobs',{content:file.content,encoding:'base64'})).sha;
  tree.push({path:file.path,mode:'100644',type:'blob',sha});
 }
 const treeSha=(await gh('git/trees',{base_tree:commit.tree.sha,tree})).sha;
 const candidate=await gh('git/commits',{message:'Triage '+id.slice(0,8)+': '+result.summary.split('\n')[0].slice(0,160),tree:treeSha,parents:[plan.baseSha]});
 let exists=true;try{await head(branch);}catch(e){if(!e.message.includes('(404)'))throw e;exists=false;}
 if(exists)await gh('git/refs/heads/'+branch,{sha:candidate.sha,force:true},'PATCH');
 else await gh('git/refs',{ref:'refs/heads/'+branch,sha:candidate.sha});
 await deploy(candidate.sha,'triage-'+id.slice(0,8));
 out('commit_sha',candidate.sha);out('base_sha',plan.baseSha);out('next','ready');
}
async function release() {
 if(!['final','live_test','revert'].includes(mode))throw Error('Invalid release mode');
 const current=await row(),log=current.feedback_log||[];
 const preview=[...log].reverse().find(e=>e.role==='preview');
 const approval=[...log].reverse().find(e=>e.role==='release_approval'&&e.mode===mode);
 if(!approval)throw Error('No commit-bound tester approval');
 const params=new URLSearchParams({channel:env.SLACK_CHANNEL_ID,ts:current.slack_ts,oldest:preview?.ts||'0',inclusive:'true',limit:'200'});
 const response=await fetch('https://slack.com/api/conversations.replies?'+params,{headers:{Authorization:'Bearer '+env.SLACK_BOT_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)});
 const thread=await response.json();if(!thread.ok)throw Error('Cannot independently verify Slack approval');
 const message=thread.messages.find(m=>m.ts===approval.ts),posted=thread.messages.find(m=>m.ts===preview?.ts);
 const sha=approvedRelease(current,message,preview,mode,(env.APPROVER_SLACK_IDS||'').split(','));
 if(!posted?.bot_id||!posted.text.includes('Build: `'+sha+'`'))throw Error('Preview announcement does not match the build');
 const baseNow=await head(base);
 if(mode==='revert') {
  // Do not undo unrelated releases made after this live test.
  if(baseNow!==sha)throw Error('Live site changed after this test; a reviewed revert is required');
  const old=await gh('git/commits/'+preview.base_sha);
  const reverted=await gh('git/commits',{message:'Revert triage '+id.slice(0,8)+' after tester request',tree:old.tree.sha,parents:[sha]});
  await gh('git/refs/heads/'+base,{sha:reverted.sha,force:false},'PATCH');
  await deploy(reverted.sha,base);out('merge_sha',reverted.sha);out('next','reverted');return;
 }
 if(await head(branch)!==sha)throw Error('Preview branch changed after approval');
 if(baseNow!==preview.base_sha) {
  await sb('feedback_triage?id=eq.'+id,{impl_state:'changes_requested',tested_by:null,tested_at:null});
  out('next','stale');console.log('Base changed; rebuilding a new preview for approval.');return;
 }
 const comparison=await gh('compare/'+preview.base_sha+'...'+sha);
 if(comparison.total_commits!==1||comparison.files.some(f=>!permittedPath(f.filename)))throw Error('Candidate changes exceed automatic triage scope');
 await gh('git/refs/heads/'+base,{sha,force:false},'PATCH');
 await deploy(sha,base);out('merge_sha',sha);out('next',mode==='live_test'?'live':'deployed');
}
const command=process.argv[2];
try {if(command==='plan')await plan();else if(command==='publish')await publish();else if(command==='release')await release();else throw Error('Unknown command');}
catch(e){console.error('[triage] '+e.message);process.exitCode=1;}
