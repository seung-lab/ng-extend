const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const esbuild=require('esbuild');
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.invalid/'});
global.window=dom.window; global.document=dom.window.document;
function load(file){const code=esbuild.buildSync({entryPoints:[file],bundle:true,platform:'browser',format:'cjs',write:false}).outputFiles[0].text;const m={exports:{}};new Function('module','exports',code)(m,m.exports);return m.exports;}
const {renderSafeMarkdown}=load('src/util/safe_markdown.ts');
const {practiceBase,practiceToken}=load('src/util/practice_destination.ts');
test('practice history parses the live pandas map and fails closed on malformed operations',async()=>{
 const {practiceOperationsAfter}=load('src/util/practice_history.ts');
 const {operationsAfter}=await import('./practice-reset-policy.mjs');
 const baseline='2026-09-27T01:22:48.880Z';
 const live={operation_id:{0:1665,1:1667},timestamp:{0:1790471778577,1:1790513698899}};
 const expected=[{operationId:1667,at:1790513698899}];
 for(const parse of [practiceOperationsAfter,operationsAfter]) {
   assert.deepEqual(parse(live,'123',baseline),expected);
   assert.deepEqual(parse({'123':JSON.stringify(live)},'123',baseline),expected);
   assert.throws(()=>parse({operation_id:{0:1667},timestamp:{0:'invalid'}},'123',baseline));
   assert.throws(()=>parse({operation_id:{0:1667},timestamp:{0:Date.now()+120000}},'123',baseline));
 }
});
test('model and notification markup cannot retain executable content or tracking images',()=>{
 for(const payload of ['<img src="https://tracker.invalid/pixel" onerror="window.pwned=1">','<svg/onload=alert(1)>','[click](javascript:alert(1))','[click](data:text/html,evil)','<a href="javascript&#58;alert(1)" onclick="alert(1)">click</a>','<iframe srcdoc="<script>alert(1)</script>"></iframe>','<form id="document"><input name="cookie"></form>']) {
   for(const mode of [false,true]) {const html=renderSafeMarkdown(payload,mode);const el=document.createElement('div');el.innerHTML=html;assert.equal(el.querySelectorAll('img,svg,script,iframe,form,input,[onerror],[onload],[onclick]').length,0);for(const a of el.querySelectorAll('a[href]'))assert.match(a.getAttribute('href'),/^(https:\/\/|\/(?!\/)|#)/i);}
 }
});
test('ordinary Markdown works and safe links suppress opener and referrer',()=>{
 const el=document.createElement('div');el.innerHTML=renderSafeMarkdown('**Science**\n\n[Help](https://connectome.quest/help)',true);
 assert.equal(el.querySelector('strong').textContent,'Science');
 assert.equal(el.querySelector('a').rel,'noopener noreferrer');
 assert.equal(el.querySelector('a').className,'nge-notif-link');
});
test('practice destinations reject hostile origins, URL credentials, redirects and non-sandbox tables',()=>{
 for(const origin of ['https://evil.invalid','https://minnie.microns-daf.com.evil.invalid','http://minnie.microns-daf.com','https://minnie.microns-daf.com:8443','https://evil@minnie.microns-daf.com','https://minnie.microns-daf.com/redirect'])assert.throws(()=>practiceBase(origin,'pinky_nf_v2'));
 assert.throws(()=>practiceBase('https://minnie.microns-daf.com','minnie65_public'));
 assert.equal(practiceBase('https://minnie.microns-daf.com','pinky_nf_v2'),'https://minnie.microns-daf.com/segmentation/api/v1/table/pinky_nf_v2');
});
test('no arbitrary CAVE token fallback survives',()=>{
 const storage=window.localStorage;storage.clear();storage.setItem('auth_token_v2_https://unrelated.invalid/sticky_auth',JSON.stringify({accessToken:'DUMMY_UNRELATED'}));
 assert.equal(practiceToken(storage,'https://minnie.microns-daf.com'),null);
 storage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth',JSON.stringify({accessToken:'DUMMY_CAVE'}));
 assert.equal(practiceToken(storage,'https://minnie.microns-daf.com'),'DUMMY_CAVE');
 assert.throws(()=>practiceToken(storage,'https://evil.invalid'));
});
test('reset refuses row tampering even on an allowed host',async()=>{
 const {validateResetExample}=await import('./practice-reset-policy.mjs');
 const row={id:'test',pcg_server:'https://minnie.microns-daf.com',pcg_table:'pinky_nf_v2',supervoxel_a:'123',supervoxel_b:'456',baseline_at:'2026-09-26T00:00:00.000Z'};
 assert.throws(()=>validateResetExample(row,{}),/manifest/);
 for(const field of ['pcg_server','pcg_table','supervoxel_a','supervoxel_b','baseline_at'])assert.throws(()=>validateResetExample({...row,[field]:'tampered'},{test:row}),/changed/);
 assert.match(validateResetExample(row,{test:row}),/pinky_nf_v2$/);
});
