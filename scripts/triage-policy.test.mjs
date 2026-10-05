import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseCommand,permittedPath,validateResult,approvedRelease} from './triage-policy.mjs';
test('only an exact command bound to a commit can release',()=>{
 for(const text of ['good','good, but it is broken','looks good','ship to test','good abcdef123456 then change something'])assert.equal(releaseCommand(text),null);
 assert.deepEqual(releaseCommand('good abcdef123456'),{mode:'final',shortSha:'abcdef123456'});
 const preview={sha:'a'.repeat(40),base_sha:'b'.repeat(40),ts:'100'};
 const row={approver_slack_id:'AMY'},message={text:'good aaaaaaaaaaaa',user:'AMY',ts:'101'};
 assert.equal(approvedRelease(row,message,preview,'final',['AMY']),preview.sha);
 for(const edit of [{user:'OTHER'},{ts:'99'},{bot_id:'BOT'},{text:'good bbbbbbbbbbbb'}])assert.throws(()=>approvedRelease(row,{...message,...edit},preview,'final',['AMY']));
});
test('model artifacts cannot alter trusted workflow, server or authentication code',()=>{
 for(const path of ['.github/workflows/x.yml','scripts/build-prod.js','package.json','src/../scripts/x.ts','src/.git/x.ts','src/supabase.ts','src/community_fetch.ts','docs/AGENTS.md'])assert.equal(permittedPath(path),false,path);
 assert.equal(permittedPath('src/components/CellLibraryPanel.vue'),true);
 assert.throws(()=>validateResult({summary:'test',files:[{path:'src/x.ts',content:Buffer.from('sb_secret_FAKE_TEST').toString('base64')}]}));
});

test('pilot gateway and backend stay outside automated model publishing',()=>{
 for(const path of ['src/pilot_actions.ts','src/functions_base.ts','functions/index.js','supabase-pilot-access.sql']) assert.equal(permittedPath(path),false);
});
test('release commands survive Slack formatting',()=>{
 for (const txt of ['*good b1f94285ae47*','`good b1f94285ae47`','_good b1f94285ae47_','good  b1f94285ae47','*good* b1f94285ae47']) assert.deepEqual(releaseCommand(txt),{mode:'final',shortSha:'b1f94285ae47'});
 assert.equal(releaseCommand('*good*'),null);
 assert.equal(releaseCommand('good b1f94285ae47 and also fix the color'),null);
});

import {createHmac} from 'node:crypto';
import {approvedHubRelease,hubApprovalSignature,hubKeyCheck} from './triage-policy.mjs';
test('an Admin Hub approval releases only when signed for this row, commit, mode and time',()=>{
 const key='xoxb-test-key',row={id:'97a2076a-1fae-41fe-a1f5-ac93b620e6d1'};
 const preview={sha:'a'.repeat(40),base_sha:'b'.repeat(40),ts:'1791100100.000100'};
 // Exactly what functions/index.js (triage.release) writes.
 const sign=(o)=>createHmac('sha256',key).update([row.id,o.sha,o.mode,o.ts,o.by].join('|')).digest('hex');
 const base={role:'release_approval',via:'admin_hub',sha:preview.sha,mode:'final',ts:'1791100200.000000',by:'amy@example.org'};
 const good={...base,sig:sign(base),keycheck:createHmac('sha256',key).update('eyewire-hub-key-check').digest('hex').slice(0,8)};
 assert.equal(hubApprovalSignature(key,{rowId:row.id,...base}),good.sig);
 assert.equal(good.keycheck,hubKeyCheck(key));
 assert.equal(approvedHubRelease(row,good,preview,'final',key),preview.sha);
 assert.equal(approvedHubRelease(row,good,preview,'final',key+'\n'),preview.sha);
 const bad=(change,mode='final',k=key,r=row,p=preview)=>assert.throws(()=>approvedHubRelease(r,{...good,...change},p,mode,k));
 bad({sig:undefined});                      // unsigned (a row anyone wrote)
 bad({sig:'0'.repeat(64)});                 // forged
 bad({by:'someone@else.org'});              // signed for another person
 bad({ts:'1791100300.000000'});             // time changed
 bad({},'live_test');                       // signed for final, asked for a live test
 bad({mode:'live_test'},'live_test');       // mode swapped without re-signing
 bad({},'final',key,{id:'00000000-0000-4000-8000-000000000000'}); // another report
 bad({},'final',key,row,{...preview,sha:'c'.repeat(40)});         // a newer preview
 bad({},'final','another-key');             // different key: caught by the key check
 bad({keycheck:undefined},'final','another-key');
 const early={...base,ts:'1791100000.000000'};bad({...early,sig:sign(early)}); // before the preview existed
 assert.throws(()=>approvedHubRelease(row,{...good,mode:'revert'},preview,'revert',key));
});
