import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replayOnto,appendedNotes,merge3,lineHunks,KNOWLEDGE} from './triage-replay.mjs';

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),N='d'.repeat(40);
const b64=s=>Buffer.from(s).toString('base64');

test('notes: approved lines are appended to the current notes',()=>{
 assert.equal(appendedNotes('x\ny\n','x\ny\n- mine\n','x\ny\n- theirs\n'),'x\ny\n- theirs\n- mine\n');
 assert.equal(appendedNotes('x\ny\n','x\nCHANGED\n','x\ny\n'),null);
 assert.equal(appendedNotes('x\n','x\n','x\n- theirs\n'),'x\n- theirs\n');
});

/** A fake GitHub: answers the reads replayOnto makes and records the writes. */
function fake({moved,approvedFiles,replayedFiles,texts={}}) {
 const writes=[];
 const gh=async(path,body)=>{
  if(body){writes.push({path,body});
   if(path==='git/blobs')return {sha:'e'.repeat(40)};
   if(path==='git/trees')return {sha:'f'.repeat(40)};
   if(path==='git/commits')return {sha:N};}
  if(path===`compare/${A}...${C}`)return moved;
  if(path===`compare/${C}...${N}`)return {total_commits:1,files:(replayedFiles||approvedFiles).map(filename=>({filename}))};
  if(path.startsWith('git/commits/'))return {message:'Triage 12345678: a fix',tree:{sha:'9'.repeat(40)}};
  const known=Object.keys(texts).find(k=>path==='contents/'+k);
  if(known)return {content:b64(texts[known])};
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

test('line merge: separate edits combine, the same or touching lines do not',()=>{
 const base='a\nb\nc\nd\ne\nf\ng\n';
 assert.equal(merge3(base,'a\nB\nc\nd\ne\nf\ng\n','a\nb\nc\nd\ne\nF\ng\n'),'a\nB\nc\nd\ne\nF\ng\n');
 assert.equal(merge3(base,'a\nb\nc\nd\ne\nf\ng\nnew\n','top\na\nb\nc\nd\ne\nf\ng\n'),'top\na\nb\nc\nd\ne\nf\ng\nnew\n');
 assert.equal(merge3(base,'a\nc\nd\ne\nf\ng\n','a\nb\nc\nd\ne\nx\ny\nf\ng\n'),'a\nc\nd\ne\nx\ny\nf\ng\n');   // a delete and an insert
 assert.equal(merge3(base,'a\nB\nc\nd\ne\nf\ng\n','a\nX\nc\nd\ne\nf\ng\n'),null);     // same line
 assert.equal(merge3(base,'a\nB\nc\nd\ne\nf\ng\n','a\nb\nC\nd\ne\nf\ng\n'),null);     // touching lines
 assert.equal(merge3(base,base,'changed\n'),'changed\n');
 assert.equal(merge3(base,'changed\n',base),'changed\n');
 // Line endings are kept exactly: only the changed line differs.
 assert.equal(merge3('a\r\nb\r\nc\r\nd\r\n','a\r\nB\r\nc\r\nd\r\n','a\r\nb\r\nc\r\nD\r\n'),'a\r\nB\r\nc\r\nD\r\n');
 assert.deepEqual(lineHunks(['a','b','c'],['a','x','c']),[{aStart:1,aEnd:2,bStart:1,bEnd:2}]);
});

test('a shared source file: merged when the edits are apart, rebuilt when they collide',async()=>{
 const before='one\ntwo\nthree\nfour\nfive\nsix\n';
 const mine=before.replace('two','TWO'),apart=before.replace('six','SIX'),collide=before.replace('two','2');
 const run=async theirs=>{
  const f=fake({moved:{status:'ahead',files:[{filename:'src/a.ts',status:'modified'}]},approvedFiles:['src/a.ts'],
   texts:{['src/a.ts?ref='+A]:before,['src/a.ts?ref='+B]:mine,['src/a.ts?ref='+C]:theirs}});
  return {r:await replayOnto(f.gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison([src])}),writes:f.writes};
 };
 const ok=await run(apart);
 assert.equal(ok.r.sha,N);
 assert.equal(Buffer.from(ok.writes.find(w=>w.path==='git/blobs').body.content,'base64').toString(),'one\nTWO\nthree\nfour\nfive\nSIX\n');
 const no=await run(collide);
 assert.equal(no.r,null);
 assert.equal(no.writes.length,0);
 // Deleted or renamed on the live branch: never merged.
 const gone=fake({moved:{status:'ahead',files:[{filename:'src/a.ts',status:'removed'}]},approvedFiles:['src/a.ts']});
 assert.equal(await replayOnto(gone.gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison([src])}),null);
 // A shared image is not text: never merged.
 const png={filename:'static/x.png',status:'modified',sha:'3'.repeat(40)};
 const img=fake({moved:{status:'ahead',files:[{filename:'static/x.png',status:'modified'}]},approvedFiles:['static/x.png']});
 assert.equal(await replayOnto(img.gh,{sha:B,baseOld:A,baseNow:C,comparison:comparison([png])}),null);
});

test('shared notes file: merged by appending, other files replayed',async()=>{
 const {gh,writes}=fake({moved:{status:'ahead',files:[{filename:KNOWLEDGE,status:'modified'}]},approvedFiles:['src/a.ts',KNOWLEDGE]});
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
