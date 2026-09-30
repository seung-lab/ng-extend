export const SHA=/^[0-9a-f]{40}$/;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function releaseCommand(text) {
 // Slack formatting is not part of the command: a copied bold `*good abc...*`
 // (the announcement shows it in bold) or `code` must still count (Ames 2026-09-30).
 const plain=String(text).replace(/[*_~`]/g,'').replace(/\s+/g,' ').trim();
 const m=plain.match(/^(good|ship to test|revert) ([a-f0-9]{12})[.!]?$/i);
 return m ? {mode:{good:'final','ship to test':'live_test',revert:'revert'}[m[1].toLowerCase()],shortSha:m[2].toLowerCase()} : null;
}
export function permittedPath(path) {
 if(typeof path!=='string'||path.length>200||! /^(src|static|docs)\/[a-zA-Z0-9_./-]+$/.test(path)||path.split('/').some(p=>p==='..'||p==='.'||p.startsWith('.')))return false;
 if(/(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/i.test(path))return false;
 if(/(?:^|\/)(?:pilot_actions|functions_base|community_fetch|secure_write|secure_upload|sheet_sync|supabase|practice_destination|practice_history|safe_markdown|google_sheets_auth|practice)\./i.test(path))return false;
 return /\.(?:ts|vue|css|scss|html|json|md|png|jpg|jpeg|gif|webp|svg)$/.test(path);
}
export function validateResult(result) {
 if(!result||typeof result.summary!=='string'||result.summary.length>12000||!Array.isArray(result.files)||result.files.length>40)throw Error('Invalid model result');
 const paths=new Set();let bytes=0;
 for(const file of result.files) {
  if(!permittedPath(file.path)||paths.has(file.path))throw Error('This change needs a reviewed pull request: '+String(file.path));
  paths.add(file.path);
  if(file.content!==null) {
   if(typeof file.content!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))throw Error('Invalid file encoding');
   const content=Buffer.from(file.content,'base64');bytes+=content.length;
   if(/BEGIN (?:RSA |EC )?PRIVATE KEY|sb_secret_|xox[baprs]-[A-Za-z0-9-]{15,}/.test(content.toString('utf8')))throw Error('Credential material in proposed change');
  }
 }
 if(bytes>2*1024*1024)throw Error('Change exceeds automatic triage size limit');
 return result;
}
export function approvedRelease(row,message,preview,mode,approvers) {
 const command=releaseCommand(message?.text);
 if(!preview||!SHA.test(preview.sha)||!SHA.test(preview.base_sha))throw Error('No verified preview commit');
 if(!command||command.mode!==mode||command.shortSha!==preview.sha.slice(0,12))throw Error('Approval must name the exact preview commit');
 if(message.bot_id||message.subtype||!approvers.includes(message.user)||message.user!==row.approver_slack_id)throw Error('Approval must come from the assigned human tester');
 if(!(Number(message.ts)>Number(preview.ts)))throw Error('Approval predates the preview');
 return preview.sha;
}
