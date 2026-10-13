'use strict';

// Report replies (Ames 2026-10-13): an approver asks the person who filed a
// report for a reply, and that person answers once, in the notification.
// Every rule is here, with the database passed in, so it is tested without
// credentials (report-reply.test.js). Served by ewReportReply in index.js.
//
//   reply.ask   admins. Sends "An update on your report" to the report's
//               submitter with a reply box, tied to the triage card.
//   reply.send  the submitter. One reply per request, text only. It is
//               appended to feedback_triage.feedback_log (role
//               'reporter_reply'), which the triage board and the Slack
//               bridge read.
//
// A reply never changes the card's status, impl_state or approver_note, so it
// can not queue a build or undo a decision. The board shows a card with an
// unread reply under "Needs your decision" from the log alone.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASK_TITLE = '💬 An update on your report';
// The picture of a note that asks for a reply (Ames 2026-10-13): science
// Nurro at the microscope, notebook in paw. It is set here, never taken from
// the browser. Catalog: static/nurro/README.md.
const ASK_IMAGE = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/nurro-experiment-recap.png';
const ASK_MAX = 5000;
const REPLY_MAX = 1000;
const NOT_INSTALLED = 'Replies are not switched on yet: run supabase-report-replies.sql in the Supabase SQL editor.';
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
// The database helper throws a bare "supabase 400" for a column that is not
// there yet (the SQL has not been run).
const missingColumn = e => !e.status && /supabase 400/.test(String(e && e.message));

/** Plain text, trimmed: no control characters, no runs of blank lines. */
function cleanText(value, max, what) {
  if (typeof value !== 'string') fail(400, `${what} must be text.`);
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) fail(400, `${what} is empty.`);
  if (text.length > max) fail(400, `${what} is too long: ${max} characters at most.`);
  return text;
}

/** The signed-in player who filed the report behind a triage card, or null. */
async function submitterOf(sb, triageId) {
  const row = (await sb(`feedback_triage?id=eq.${triageId}&select=id,source,source_id&limit=1`))[0];
  if (!row) fail(404, 'That report is no longer on the board.');
  if (row.source !== 'site_issue') return null;
  const issue = (await sb(`site_issues?id=eq.${encodeURIComponent(row.source_id)}&select=user_id&limit=1`))[0];
  return (issue && issue.user_id) || null;
}

async function ask(args, {sb, me, isAdmin}) {
  if (!isAdmin) fail(403, 'Admins only');
  const triageId = String(args.triageId || '');
  if (!UUID.test(triageId)) fail(400, 'bad id');
  const body = cleanText(args.text, ASK_MAX, 'The message');
  const userId = await submitterOf(sb, triageId);
  // Only ever targeted: an anonymous report gets nothing, never a broadcast.
  if (!userId) fail(409, 'This report has no signed-in submitter, so there is nobody to notify. Nothing was sent.');
  const row = { title: ASK_TITLE, body, thumbnail_url: ASK_IMAGE, image_url: ASK_IMAGE,
    target_type: 'user', target_id: userId, send_at: new Date().toISOString(), created_by: (me && me.id) || null,
    reply_triage_id: triageId };
  try { return (await sb('notifications', {method: 'POST', body: JSON.stringify(row)}))[0]; }
  catch (e) { if (missingColumn(e)) fail(409, `${NOT_INSTALLED} Nothing was sent.`); throw e; }
}

async function send(args, {sb, me, wake}) {
  if (!me || !UUID.test(String(me.id))) fail(403, 'Sign in and create your profile first.');
  const id = Number(args.notificationId);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Unknown notification.');
  const text = cleanText(args.text, REPLY_MAX, 'Your reply');
  let note;
  try { note = (await sb(`notifications?id=eq.${id}&select=id,target_type,target_id,reply_triage_id,replied_at&limit=1`))[0]; }
  catch (e) { if (missingColumn(e)) fail(409, 'Replies are not switched on yet.'); throw e; }
  // The same answer whether it is missing or someone else's.
  if (!note || note.target_type !== 'user' || String(note.target_id) !== me.id) fail(403, 'This is not your notification.');
  if (!note.reply_triage_id) fail(409, 'No reply was asked for here.');
  if (note.replied_at) fail(409, 'You already replied to this one.');
  // And the report behind it must be theirs: being sent the note is not enough.
  if ((await submitterOf(sb, note.reply_triage_id)) !== me.id) fail(403, 'You can only reply about your own report.');

  // Claim the one reply: only while replied_at is still empty, so two sends
  // at the same moment store one.
  const at = new Date().toISOString();
  const claimed = await sb(`notifications?id=eq.${id}&replied_at=is.null&reply_triage_id=eq.${note.reply_triage_id}`,
    {method: 'PATCH', body: JSON.stringify({replied_at: at, reply_text: text})});
  if (!claimed.length) fail(409, 'You already replied to this one.');
  try {
    // Re-read the log right before appending, so a write in between (the
    // bridge, the board) is not overwritten.
    const fresh = (await sb(`feedback_triage?id=eq.${note.reply_triage_id}&select=feedback_log&limit=1`))[0];
    if (!fresh) fail(404, 'That report is no longer on the board.');
    const log = Array.isArray(fresh.feedback_log) ? [...fresh.feedback_log] : [];
    log.push({role: 'reporter_reply', via: 'game', by: me.display_name || me.username || 'Player', user_id: me.id,
      notification_id: id, text, ts: at, at, echoed: false, seen: false});
    await sb(`feedback_triage?id=eq.${note.reply_triage_id}`, {method: 'PATCH', body: JSON.stringify({feedback_log: log})});
  } catch (e) {
    // Not recorded on the card: give the reply back so the player can retry.
    await sb(`notifications?id=eq.${id}`, {method: 'PATCH', body: JSON.stringify({replied_at: null, reply_text: null})}).catch(() => {});
    throw e;
  }
  // The bridge posts it into the report's Slack thread now, not on its timer.
  if (wake) await Promise.resolve(wake()).catch(() => {});
  return {id, replied_at: at, reply_text: text};
}

async function handle(action, args, io) {
  if (action === 'reply.ask') return ask(args || {}, io);
  if (action === 'reply.send') return send(args || {}, io);
  fail(400, `unknown action ${action}`);
}

module.exports = {handle, cleanText, ASK_TITLE, ASK_IMAGE, REPLY_MAX};
