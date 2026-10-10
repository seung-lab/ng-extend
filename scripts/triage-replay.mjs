// Replays an approved triage commit onto a live branch that moved after its
// preview was built, without a model run (Ames 2026-10-04: the branch moves
// most days, and a rebuild costs a Claude run, a second preview and a second
// test). Only Git objects are created here; the caller moves the branch.
//
// What it will do:
//  - a file only the approved change touched goes onto the new branch with
//    the same contents;
//  - a file both sides edited is merged line by line, as git would, and only
//    when they changed different lines that do not touch (store.ts changes
//    most days: without this nearly every approval was rebuilt and tested
//    twice, 2026-10-06);
//  - the robot's own notes, where every build appends a line, have the
//    approved lines appended;
//  - the players' changelog, where every deploy adds an entry at the top,
//    has the approved entries put on top of the current list.
// Both sides changing the same lines, a rename, a deletion on one side, or
// anything else returns null, and the caller asks for a rebuild.
import {permittedPath} from './triage-policy.mjs';

export const KNOWLEDGE='docs/TRIAGE-KNOWLEDGE.md';
const BLOB=/^[0-9a-f]{40}$/;

/**
 * Where two versions of a text differ, as runs of lines: [aStart, aEnd) in a
 * became [bStart, bEnd) in b. Myers' shortest-edit algorithm, whose cost
 * grows with how MUCH differs, not with how far apart the differences are
 * (the first version here compared everything between the first and last
 * change, and gave up on store.ts when one edit was at line 19 and another
 * at line 6,175: 2026-10-06). Null when more than 3,000 lines differ.
 */
export function lineHunks(a,b) {
 let s=0;while(s<a.length&&s<b.length&&a[s]===b[s])s++;
 let ea=a.length,eb=b.length;while(ea>s&&eb>s&&a[ea-1]===b[eb-1]){ea--;eb--;}
 const n=ea-s,m=eb-s;
 if(n===0&&m===0)return [];
 const cap=Math.min(n+m,3000),off=cap+1,v=new Int32Array(2*cap+3),trace=[];
 let D=-1;
 search:for(let d=0;d<=cap;d++) {
  trace.push(v.slice());
  for(let k=-d;k<=d;k+=2) {
   let x=(k===-d||(k!==d&&v[off+k-1]<v[off+k+1]))?v[off+k+1]:v[off+k-1]+1,y=x-k;
   while(x<n&&y<m&&a[s+x]===b[s+y]){x++;y++;}
   v[off+k]=x;
   if(x>=n&&y>=m){D=d;break search;}
  }
 }
 if(D<0)return null;
 // Walk back through the saved rounds to mark which lines were removed from
 // a and which were added in b.
 const gone=new Uint8Array(n),added=new Uint8Array(m);
 for(let d=D,x=n,y=m;d>0;d--) {
  const prev=trace[d],k=x-y;
  const pk=(k===-d||(k!==d&&prev[off+k-1]<prev[off+k+1]))?k+1:k-1;
  const px=prev[off+pk],py=px-pk;
  if(pk===k+1)added[py]=1;else gone[px]=1;
  x=px;y=py;
 }
 const out=[];let open=null;
 for(let i=0,j=0;i<n||j<m;) {
  if(i<n&&gone[i]){open??={aStart:s+i,aEnd:s+i,bStart:s+j,bEnd:s+j};i++;open.aEnd=s+i;}
  else if(j<m&&added[j]){open??={aStart:s+i,aEnd:s+i,bStart:s+j,bEnd:s+j};j++;open.bEnd=s+j;}
  else{if(open){out.push(open);open=null;}i++;j++;}
 }
 if(open)out.push(open);
 return out;
}

/**
 * Three-way merge of one text file, the way git does it and no bolder:
 * `ours` and `theirs` both started from `base`; the result is `theirs` with
 * ours' changes applied. Null (no merge) when the two sides changed the same
 * lines or lines that touch, or when the comparison is too big. Lines keep
 * their own endings, so nothing but the changed lines differs.
 */
export function merge3(base,ours,theirs) {
 if(typeof base!=='string'||typeof ours!=='string'||typeof theirs!=='string')return null;
 if(ours===base)return theirs;
 if(theirs===base||ours===theirs)return ours;
 const B=base.split('\n'),O=ours.split('\n'),T=theirs.split('\n');
 const ho=lineHunks(B,O),ht=lineHunks(B,T);
 if(!ho||!ht)return null;
 for(const o of ho)for(const t of ht)if(!(o.aEnd<t.aStart||t.aEnd<o.aStart))return null;
 const all=[...ho.map(h=>({...h,from:O})),...ht.map(h=>({...h,from:T}))].sort((x,y)=>x.aStart-y.aStart||x.aEnd-y.aEnd);
 const out=[];let at=0;
 for(const h of all){out.push(...B.slice(at,h.aStart),...h.from.slice(h.bStart,h.bEnd));at=h.aEnd;}
 out.push(...B.slice(at));
 return out.join('\n');
}

/**
 * The players' changelog (static/changelog.json). Every deploy adds an entry
 * at the top, so the approved change and the live branch nearly always both
 * touched its first lines, which a line merge calls a conflict. It is a list,
 * so it is merged as one: the entries the approved change ADDED go on top of
 * the current list, dated when they actually go live. Null when the approved
 * change did anything to the file other than add entries.
 */
export const CHANGELOG='static/changelog.json';
export function mergedChangelog(before,approved,current,now=new Date()) {
 let b,a,c;
 try{b=JSON.parse(before);a=JSON.parse(approved);c=JSON.parse(current);}catch{return null;}
 if(![b,a,c].every(x=>x&&Array.isArray(x.entries)))return null;
 const key=e=>`${e?.at}|${e?.title}`;
 const had=new Set(b.entries.map(key));
 const added=a.entries.filter(e=>!had.has(key(e)));
 const kept=a.entries.filter(e=>had.has(key(e)));
 if(JSON.stringify(kept)!==JSON.stringify(b.entries))return null;                       // an older entry was edited or removed
 if(JSON.stringify({...a,entries:0})!==JSON.stringify({...b,entries:0}))return null;    // something besides entries changed
 if(!added.length)return current;
 if(added.some(e=>!e||typeof e.title!=='string'||!e.title.trim()||!Array.isArray(e.items)||!e.items.length||e.items.some(i=>typeof i!=='string')))return null;
 const at=now.toISOString().slice(0,16)+':00Z';
 const text=JSON.stringify({...c,entries:[...added.map(e=>({...e,at})),...c.entries]},null,2)+'\n';
 return current.includes('\r\n')?text.replace(/\n/g,'\r\n'):text;
}

/** The approved text appended to the notes, or null when the approved edit
 *  was anything other than adding lines at the end. */
export function appendedNotes(before,approved,current) {
 if(typeof before!=='string'||typeof approved!=='string'||typeof current!=='string')return null;
 const base=before.replace(/\s+$/,'');
 if(!approved.startsWith(base))return null;
 const added=approved.slice(base.length).replace(/^\s+/,'').replace(/\s+$/,'');
 if(!added)return current;
 return current.replace(/\s+$/,'')+'\n'+added+'\n';
}

/**
 * gh(path, body?, method?) is the caller's GitHub API helper for the repo.
 * comparison is compare(baseOld...sha), already checked to be one commit of
 * permitted paths. Returns {sha, files} for the replayed commit, or null.
 */
export async function replayOnto(gh,{sha,baseOld,baseNow,comparison,note=''}) {
 const moved=await gh('compare/'+baseOld+'...'+baseNow);
 if(moved.status!=='ahead'||!Array.isArray(moved.files)||moved.files.length>=300)return null;
 const files=comparison.files;
 if(files.some(f=>f.previous_filename))return null;           // renames: not replayed
 const touched=new Set(files.map(f=>f.filename));
 const overlap=new Set(moved.files.flatMap(f=>[f.filename,f.previous_filename]).filter(p=>p&&touched.has(p)));
 // A shared file is merged only when both sides merely edited it.
 if(moved.files.some(f=>(overlap.has(f.filename)||overlap.has(f.previous_filename))&&f.status!=='modified'))return null;
 // One file as text at a commit (the contents API leaves large files empty).
 const text=async(path,ref)=>{
  const c=await gh('contents/'+path+'?ref='+ref);
  const b64=c.content||(await gh('git/blobs/'+c.sha)).content;
  return Buffer.from(b64,'base64').toString('utf8');
 };
 const tree=[];
 for(const f of files) {
  if(!permittedPath(f.filename))return null;
  if(overlap.has(f.filename)) {
   if(f.status!=='modified'||! /\.(?:ts|vue|css|scss|html|json|md|svg)$/.test(f.filename))return null;   // text only
   const [before,approved,current]=[await text(f.filename,baseOld),await text(f.filename,sha),await text(f.filename,baseNow)];
   // The notes file: every build appends at the end, which a line merge
   // calls a conflict, so its lines are appended instead. Any other file:
   // a plain three-way merge, refused if both sides touched the same lines.
   const merged=f.filename===KNOWLEDGE?appendedNotes(before,approved,current)
    :f.filename===CHANGELOG?mergedChangelog(before,approved,current)
    :merge3(before,approved,current);
   if(merged===null||merged.includes('\u0000'))return null;
   const blob=await gh('git/blobs',{content:Buffer.from(merged,'utf8').toString('base64'),encoding:'base64'});
   tree.push({path:f.filename,mode:'100644',type:'blob',sha:blob.sha});
   continue;
  }
  if(f.status!=='removed'&&!BLOB.test(f.sha||''))return null;
  tree.push({path:f.filename,mode:'100644',type:'blob',sha:f.status==='removed'?null:f.sha});
 }
 const approved=await gh('git/commits/'+sha),onto=await gh('git/commits/'+baseNow);
 const treeSha=(await gh('git/trees',{base_tree:onto.tree.sha,tree})).sha;
 const replayed=await gh('git/commits',{
  message:approved.message+'\n\nApproved as '+sha.slice(0,12)+'; replayed onto '+baseNow.slice(0,12)+' at release'+(note?' ('+note+')':'')+'.',
  tree:treeSha,parents:[baseNow]});
 // Proof, not trust: the replayed commit changes exactly the approved files.
 const check=await gh('compare/'+baseNow+'...'+replayed.sha);
 const got=check.files.map(f=>f.filename).sort().join('\n'),want=[...touched].sort().join('\n');
 if(check.total_commits!==1||got!==want)return null;
 return {sha:replayed.sha,files:[...touched]};
}
