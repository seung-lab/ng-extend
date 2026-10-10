// Trusted coordinator. Never imports, executes or checks out model-produced code.
import fs from 'node:fs';
import {SHA,UUID,validateResult,approvedRelease,approvedHubRelease,permittedPath} from './triage-policy.mjs';
import {replayOnto} from './triage-replay.mjs';
import {readEntries} from './check-changelog.mjs';
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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Another deploy of the live site in progress (a push, or another release).
// Preview builds go to their own versions and do not count.
async function liveDeployBusy() {
 const runs=await gh('actions/workflows/on_dev_branch_push.yml/runs?branch='+base+'&per_page=30');
 return runs.workflow_runs.some(r=>r.status!=='completed'&&!/^Deploy triage-\d+-(build|answer)/.test(r.display_title||''));
}
async function deploy(sha,version) {
 if(!SHA.test(sha)||! /^(eyewire-ii-community|triage-[0-9a-f]{8})$/.test(version))throw Error('Invalid deployment target');
 // Wait for a deploy of the live site that is already running, so this one
 // goes next instead of colliding with it (up to 30 minutes).
 if(version===base)for(let i=0;i<90&&await liveDeployBusy();i++){if(!i)console.log('Another live deploy is running; waiting for it to finish.');await sleep(20000);}
 // Sent again, up to 3 retries, in two cases:
 //  - cancelled: GitHub keeps one waiting run per deploy group and cancels the
 //    older one when another arrives;
 //  - the hosting step failed after the build and its tests passed. That is
 //    the host having a bad moment, not the change: App Engine has answered
 //    "internal error" and "Project is not valid" to builds that went through
 //    on a second try (2026-10-05, 2026-10-07), and each one was reported to
 //    the tester as a failed deploy until someone re-ran it by hand.
 // A failed build or failed tests are never sent again.
 // Three retries after the first try, four tries in all, before the tester is
 // told (Ames 2026-10-07: "retry 3x before bugging me again").
 const TRIES=4;
 let last='';
 for(let attempt=1;attempt<=TRIES;attempt++) {
  const deploymentId='triage-'+env.GITHUB_RUN_ID+'-'+mode+(attempt>1?'-'+attempt:'');
  await gh('actions/workflows/on_dev_branch_push.yml/dispatches',{ref:base,inputs:{source_ref:sha,version,deployment_id:deploymentId}});
  const result=await waitForDeploy(sha,version,deploymentId);
  if(result==='ok')return;
  if(result==='cancelled') {
   last='cancelled by other deploys';
   console.log('Deploy '+deploymentId+' was cancelled by a newer deploy; sending it again.');
  } else {
   last='the hosting step failed: '+result.hostingFailed;
   console.log('Deploy '+deploymentId+' built and passed its tests, but the hosting step failed ('+result.hostingFailed+'). Try '+attempt+' of '+TRIES+'.');
   if(attempt<TRIES)await sleep(30000*attempt);
  }
  if(version===base)for(let i=0;i<90&&await liveDeployBusy();i++)await sleep(20000);
 }
 throw Error('Deploy did not go through after 3 retries ('+last+')');
}
// True when the run's build job (the build and every test) succeeded and only
// its deploy job, the upload to the host, failed.
async function onlyHostingFailed(run) {
 try {
  const jobs=(await gh('actions/runs/'+run.id+'/jobs?per_page=30')).jobs||[];
  const build=jobs.find(j=>j.name==='build'),host=jobs.find(j=>j.name==='deploy');
  return !!build&&!!host&&build.conclusion==='success'&&host.conclusion==='failure';
 } catch {return false;}
}
async function waitForDeploy(sha,version,deploymentId) {
 // A GITHUB_TOKEN push does not trigger another workflow. Dispatch trusted YAML explicitly.
 for(let i=0;i<150;i++) {
  await sleep(10000);
  const runs=await gh('actions/workflows/on_dev_branch_push.yml/runs?event=workflow_dispatch&branch='+base+'&per_page=30');
  const run=runs.workflow_runs.find(r=>r.display_title==='Deploy '+deploymentId);
  if(!run||run.status!=='completed')continue;
  if(run.conclusion==='cancelled')return 'cancelled';
  if(run.conclusion!=='success') {
   if(await onlyHostingFailed(run))return {hostingFailed:run.html_url};
   throw Error('Build/deploy failed: '+run.html_url);
  }
  const url=version===base?'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/':`https://${version}-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/`;
  const response=await fetch(url+'build-commit.txt?run='+env.GITHUB_RUN_ID,{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok||(await response.text()).trim()!==sha)throw Error('Deployed build does not match the expected commit');
  return 'ok';
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
 // What players are told changed must still be a valid list after the model's
 // edit: a broken file would leave the game's update notice with nothing to say.
 const log=result.files.find(f=>f.path==='static/changelog.json'&&f.content!==null);
 if(log){try{readEntries(Buffer.from(log.content,'base64').toString('utf8'));}catch(e){throw Error('The changelog entry is not valid: '+e.message);}}
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
 // Two proofs are accepted: the tester's own Slack reply, re-read here, or a
 // signed approval from the Admin Hub.
 const sha=approval.via==='admin_hub'
  ?approvedHubRelease(current,approval,preview,mode,env.SLACK_BOT_TOKEN)
  :approvedRelease(current,message,preview,mode,(env.APPROVER_SLACK_IDS||'').split(','));
 if(!posted?.bot_id||!posted.text.includes('Build: `'+sha+'`'))throw Error('Preview announcement does not match the build');
 const baseNow=await head(base);
 // When the approved commit was replayed onto a newer live branch (below),
 // that replayed commit is what is live.
 const replay=[...log].reverse().find(e=>e.role==='replayed'&&e.of===sha&&SHA.test(e.sha)&&SHA.test(e.base_sha));
 if(mode==='revert') {
  // Do not undo unrelated releases made after this live test.
  const liveSha=replay?replay.sha:sha;
  if(baseNow!==liveSha)throw Error('Live site changed after this test; a reviewed revert is required');
  const old=await gh('git/commits/'+(replay?replay.base_sha:preview.base_sha));
  const reverted=await gh('git/commits',{message:'Revert triage '+id.slice(0,8)+' after tester request',tree:old.tree.sha,parents:[liveSha]});
  await gh('git/refs/heads/'+base,{sha:reverted.sha,force:false},'PATCH');
  await deploy(reverted.sha,base);out('merge_sha',reverted.sha);out('next','reverted');return;
 }
 if(await head(branch)!==sha)throw Error('Preview branch changed after approval');
 // Merged on an earlier try whose deploy then failed: deploy, do not rebuild.
 if(mode==='final'&&(baseNow===sha||(replay&&baseNow===replay.sha))) {
  await deploy(baseNow,base);out('merge_sha',baseNow);out('next','deployed');return;
 }
 const comparison=await gh('compare/'+preview.base_sha+'...'+sha);
 if(comparison.total_commits!==1||comparison.files.some(f=>!permittedPath(f.filename)||(f.previous_filename&&!permittedPath(f.previous_filename))))throw Error('Candidate changes exceed automatic triage scope');
 if(baseNow!==preview.base_sha) {
  // The live branch moved after the preview was built. Replay the approved
  // change onto it when that is safe (triage-replay.mjs): no model run, no
  // second preview, no second test. A real overlap goes back for a rebuild
  // and a fresh approval.
  const replayed=await replayOnto(gh,{sha,baseOld:preview.base_sha,baseNow,comparison});
  if(!replayed) {
   await sb('feedback_triage?id=eq.'+id,{impl_state:'changes_requested',tested_by:null,tested_at:null});
   out('next','stale');console.log('The live branch changed the same files; rebuilding a new preview for approval.');return;
  }
  await sb('feedback_triage?id=eq.'+id,{feedback_log:[...log,{role:'replayed',of:sha,sha:replayed.sha,base_sha:baseNow,ts:String(Date.now()/1000)}]});
  await gh('git/refs/heads/'+base,{sha:replayed.sha,force:false},'PATCH');
  console.log('The live branch had moved; replayed the approved change onto it without a rebuild.');
  await deploy(replayed.sha,base);out('merge_sha',replayed.sha);out('next',mode==='live_test'?'live':'deployed');return;
 }
 await gh('git/refs/heads/'+base,{sha,force:false},'PATCH');
 await deploy(sha,base);out('merge_sha',sha);out('next',mode==='live_test'?'live':'deployed');
}
const command=process.argv[2];
// GitHub refuses to move the live branch (422) when someone pushed to it
// between this run reading its head and moving it. On 2026-10-06 a push
// landed four seconds before the move and an approved fix was reported as a
// failed deploy. Nothing has been changed at that point, so start the release
// again: it re-reads the head, re-checks the approval and replays onto the new
// head, exactly as if it had started a moment later.
const raced=e=>/^GitHub git\/refs\/heads\/\S+ failed \(422\)$/.test(String(e?.message));
async function releaseWithRetry() {
 for(let attempt=1;;attempt++) {
  try {return await release();}
  catch(e) {
   if(attempt>=3||!raced(e))throw e;
   console.log('The live branch moved while releasing (try '+attempt+' of 3); starting again on its new head.');
   await new Promise(r=>setTimeout(r,4000*attempt));
  }
 }
}
try {if(command==='plan')await plan();else if(command==='publish')await publish();else if(command==='release')await releaseWithRetry();else throw Error('Unknown command');}
catch(e){console.error('[triage] '+e.message);process.exitCode=1;}
