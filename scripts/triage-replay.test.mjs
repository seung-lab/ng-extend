import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replayOnto,appendedNotes,KNOWLEDGE} from './triage-replay.mjs';

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),N='d'.repeat(40);
const b64=s=>Buffer.from(s).toString('base64');

test('notes: approved lines are appended to the current notes',()=>{
 assert.equal(appendedNotes('x\ny\n','x\ny\n- mine\n','x\ny\n- theirs\n'),'x\ny\n- theirs\n- mine\n');
 assert.equal(appendedNotes('x\ny\n','x\nCHANGED\n','x\ny\n'),null);
 assert.equal(appendedNotes('x\n','x\n','x\n- theirs\n'),'x\n- theirs\n');
});

/** A fake GitHub: answers the reads replayOnto makes and records the writes. */
function fake({moved,approvedFiles,replayedFiles}) {
 const writes=[];
 const gh=async(path,body)=>{
  if(body){writes.push({path,body});
   if(path==='git/blobs')return {sha:'e'.repeat(40)};
   if(path==='git/trees')return {sha:'f'.repeat(40)};
   if(path==='git/commits')return {sha:N};}
  if(path===`compare/${A}...${C}`)return moved;
  if(path===`compare/${C}...${N}`)return {total_commits:1,files:(replayedFiles||approvedFiles).map(filename=>({filename}))};
  if(path.startsWith('git/commits/'))return {message:'Triage 12345678: a fix',tree:{sha:'9'.repeat(40)}};
  if(path.startsWith('contents/'))return {content:b64(path.endsWith(A)?'n\n':path.endsWith(B)?'n\n- mine\n':'n\n- theirs\n')};
  throw Error('unexpected '+path);
 };
 return {gh,writes};
}
const comparison=files=>({total_commits:1,files});
const src={filename:'src/a.ts',status:'modified',sha:'1'.repeat(40)};
const notes={filename:KNOWLEDGE,status:'modified',sha:'2'.repeat(40)};

test('no shared files: the same blobs go onto the new branch',async()=>{
 const {gh,writes}=fake({moved:{status:'ahead',files:[{filename:'src/other.ts'}]},approvedFiles:['src/a.ts']});
 const r=await replayOnto(gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison([src])});
 assert.equal(r.sha,N);
 assert.deepEqual(writes.find(w=>w.path==='git/trees').body.tree,[{path:'src/a.ts',mode:'100644',type:'blob',sha:src.sha}]);
 assert.deepEqual(writes.find(w=>w.path==='git/commits').body.parents,[C]);
});

test('a shared source file is never replayed',async()=>{
 const {gh,writes}=fake({moved:{status:'ahead',files:[{filename:'src/a.ts'}]},approvedFiles:['src/a.ts']});
 assert.equal(await replayOnto(gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison([src])}),null);
 assert.equal(writes.length,0);
});

test('shared notes file: merged by appending, other files replayed',async()=>{
 const {gh,writes}=fake({moved:{status:'ahead',files:[{filename:KNOWLEDGE}]},approvedFiles:['src/a.ts',KNOWLEDGE]});
 const r=await replayOnto(gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison([src,notes])});
 assert.equal(r.sha,N);
 assert.equal(Buffer.from(writes.find(w=>w.path==='git/blobs').body.content,'base64').toString(),'n\n- theirs\n- mine\n');
});

test('refuses a rewritten branch, a rename, a forbidden path, or a result that changed other files',async()=>{
 const run=(opts,files)=>replayOnto(fake(opts).gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison(files)});
 assert.equal(await run({moved:{status:'diverged',files:[]},approvedFiles:['src/a.ts']},[src]),null);
 assert.equal(await run({moved:{status:'ahead',files:[]},approvedFiles:['src/a.ts']},[{...src,previous_filename:'src/old.ts'}]),null);
 assert.equal(await run({moved:{status:'ahead',files:[]},approvedFiles:['scripts/x.mjs']},[{...src,filename:'scripts/x.mjs'}]),null);
 assert.equal(await run({moved:{status:'ahead',files:[]},approvedFiles:['src/a.ts'],replayedFiles:['src/a.ts','src/extra.ts']},[src]),null);
});
