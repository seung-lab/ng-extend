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
