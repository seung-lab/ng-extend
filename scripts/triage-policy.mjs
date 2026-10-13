import {createHmac,timingSafeEqual} from 'node:crypto';
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
// An approval given in the Admin Hub (Ames 2026-10-05). There is no Slack
// message behind it, so it is proven another way: the server function that
// recorded it checked the admin's sign-in, then signed the row, the exact
// commit, the mode, the time and who it was with a key only it and this
// workflow hold. Anything that merely wrote the row cannot produce that.
export function hubApprovalSignature(key,{rowId,sha,mode,ts,by}) {
 return createHmac('sha256',String(key).trim()).update([rowId,sha,mode,ts,by].join('|')).digest('hex');
}
export const hubKeyCheck=key=>createHmac('sha256',String(key).trim()).update('eyewire-hub-key-check').digest('hex').slice(0,8);
export function approvedHubRelease(row,approval,preview,mode,key) {
 if(!preview||!SHA.test(preview.sha)||!SHA.test(preview.base_sha))throw Error('No verified preview commit');
 if(!key)throw Error('Cannot verify the Admin Hub approval');
 if(!['final','live_test'].includes(mode)||approval.mode!==mode||approval.sha!==preview.sha)throw Error('Approval must name the exact preview commit');
 if(typeof approval.by!=='string'||!approval.by||! /^[0-9a-f]{64}$/.test(approval.sig||''))throw Error('Admin Hub approval is not signed');
 if(approval.keycheck&&approval.keycheck!==hubKeyCheck(key))throw Error('The Admin Hub and GitHub hold different Slack bot tokens, so the approval cannot be checked. Use the Slack command instead');
 const want=Buffer.from(hubApprovalSignature(key,{rowId:row.id,sha:approval.sha,mode,ts:String(approval.ts),by:approval.by}),'hex');
 if(!timingSafeEqual(want,Buffer.from(approval.sig,'hex')))throw Error('Admin Hub approval signature does not match');
 if(!(Number(approval.ts)>Number(preview.ts)))throw Error('Approval predates the preview');
 return preview.sha;
}
export function approvedRelease(row,message,preview,mode,approvers) {
 const command=releaseCommand(message?.text);
 if(!preview||!SHA.test(preview.sha)||!SHA.test(preview.base_sha))throw Error('No verified preview commit');
 if(!command||command.mode!==mode||command.shortSha!==preview.sha.slice(0,12))throw Error('Approval must name the exact preview commit');
 if(message.bot_id||message.subtype||!approvers.includes(message.user)||message.user!==row.approver_slack_id)throw Error('Approval must come from the assigned human tester');
 if(!(Number(message.ts)>Number(preview.ts)))throw Error('Approval predates the preview');
 return preview.sha;
}

// ── A submitter's reply (Ames 2026-10-13) ────────────────────────────────
// An approver can ask the person who filed a report for a reply; they answer
// in the game (functions/report-reply.js) and it lands in feedback_log with
// role 'reporter_reply'. It is words from the public: shown to people, never
// handed to the robot as something to act on.
/** The Slack thread message for one reply. Slack control characters are
 *  escaped, so a reply can not tag anyone or pose as a link. */
export function reporterReplyNote(entry) {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const quoted = esc(entry?.text).trim().split(/\n/).map(line => `> ${line}`).join('\n');
  // What came with it (supabase-report-reply-parts.sql). Links only when they
  // are plain https with nothing Slack would read as markup.
  const link = (url, label) => (typeof url === 'string' && /^https:\/\/[^\s<>|]+$/.test(url) ? `<${url}|${label}>` : '');
  const parts = [link(entry?.screenshot_url, 'Screenshot'), link(entry?.view_url, 'Their view'),
    entry?.dataset ? `dataset ${esc(entry.dataset).slice(0, 80)}` : '',
    Number(entry?.console_lines) > 0 ? `${Number(entry.console_lines)} console lines (Admin Hub, Triage)` : ''].filter(Boolean);
  const withIt = parts.length ? `\nWith it: ${parts.join(' · ')}` : '';
  return `💬 The reporter replied in the game${entry?.by ? ` (${esc(entry.by).slice(0, 80)})` : ''}:\n${quoted}${withIt}\n_A reply to a question an approver asked. For reading only: nothing is built or decided from it._`;
}
/** The log entries the build robot is shown: everything but submitter replies. */
export const robotLog = log => (Array.isArray(log) ? log : []).filter(e => e?.role !== 'reporter_reply');
