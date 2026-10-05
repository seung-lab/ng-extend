// Replays an approved triage commit onto a live branch that moved after its
// preview was built, without a model run (Ames 2026-10-04: the branch moves
// most days, and a rebuild costs a Claude run, a second preview and a second
// test). Only Git objects are created here; the caller moves the branch.
//
// Safe cases only:
//  - nothing that moved touches a file the change touches: the same files
//    with the same contents go onto the new branch;
//  - the one shared file is the robot's own notes (every build appends a
//    line there): the approved lines are appended to the current notes.
// Any other overlap returns null and the caller asks for a rebuild.
import {permittedPath} from './triage-policy.mjs';

export const KNOWLEDGE='docs/TRIAGE-KNOWLEDGE.md';
const BLOB=/^[0-9a-f]{40}$/;

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
 const overlap=[...new Set(moved.files.flatMap(f=>[f.filename,f.previous_filename]).filter(p=>p&&touched.has(p)))];
 if(overlap.some(p=>p!==KNOWLEDGE))return null;
 const tree=[];
 for(const f of files) {
  if(!permittedPath(f.filename))return null;
  if(f.filename===KNOWLEDGE&&overlap.length) {
   if(f.status!=='modified')return null;
   const text=async ref=>Buffer.from((await gh('contents/'+KNOWLEDGE+'?ref='+ref)).content,'base64').toString('utf8');
   const merged=appendedNotes(await text(baseOld),await text(sha),await text(baseNow));
   if(merged===null)return null;
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
