'use strict';

// Report replies (Ames 2026-10-13): an approver asks the person who filed a
// report for a reply, and that person answers once, in the notification.
// Every rule is here, with the database passed in, so it is tested without
// credentials (report-reply.test.js). Served by ewReportReply in index.js.
//
//   reply.ask   admins. Sends "An update on your report" to the report's
//               submitter with a reply box, tied to the triage card.
//   reply.send  the submitter. One reply per request; to hear more, the
//               approver asks again. A reply carries what a report carries:
//               text, and optionally a screenshot, the player's view and
//               their recent console messages (supabase-report-reply-parts.sql).
//               It is appended to feedback_triage.feedback_log (role
//               'reporter_reply'), which the triage board and the Slack
//               bridge read.
//   reply.console  admins. The console messages a reply came with. They are
//               kept out of every table the public key can read.
//
// A reply never changes the card's status, impl_state or approver_note, so it
// can not queue a build or undo a decision. The board shows a card with an
// unread reply under "Needs your decision" from the log alone.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASK_TITLE = '💬 An update on your report';
/** The admin's bell when the player answers; the bell's Admin tab finds it by this start. */
const REPLIED_TITLE = '💬 Reply to your question from';
// The picture of a note that asks for a reply (Ames 2026-10-13): science
// Nurro at the microscope, notebook in paw. It is set here, never taken from
// the browser. Catalog: static/nurro/README.md.
const ASK_IMAGE = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/nurro-experiment-recap.png';
const ASK_MAX = 5000;
const REPLY_MAX = 1000;
const CONSOLE_MAX = 20000;
// Screenshots only ever point at our own public storage (ewSecureUpload output).
const OWN_STORAGE = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/';
const PARTS = ['reply_screenshot_url', 'reply_view_url', 'reply_dataset', 'reply_build'];
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

/** An admin's reply image: our own reply-images folder only, or nothing. */
function replyImage(url) {
  if (url == null || url === '') return null;
  if (typeof url === 'string' && url.startsWith(OWN_STORAGE + 'admin-uploads/reply-images/') && url.length <= 500 && /^[^\s"'<>]+$/.test(url)) return url;
  fail(400, 'The image must be one added in the reply box.');
}

/** The optional parts of a reply, each checked; anything else is dropped. */
function replyParts(args) {
  const out = {};
  const shot = args.screenshotUrl;
  if (typeof shot === 'string' && shot.startsWith(OWN_STORAGE) && shot.length <= 500 && /^[^\s"'<>]+$/.test(shot)) out.reply_screenshot_url = shot;
  else if (shot != null && shot !== '') fail(400, 'The screenshot must be one taken in the game.');
  const view = args.viewUrl;
  if (typeof view === 'string' && /^https:\/\/[^\s"'<>]+$/.test(view) && view.length <= 2000) out.reply_view_url = view;
  else if (view != null && view !== '') fail(400, 'The view must be a single https link.');
  if (typeof args.dataset === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(args.dataset)) out.reply_dataset = args.dataset;
  if (typeof args.build === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(args.build)) out.reply_build = args.build;
  let consoleLog = '';
  if (typeof args.consoleLog === 'string') consoleLog = args.consoleLog.replace(/\u0000/g, '').slice(-CONSOLE_MAX).trim();
  return {parts: out, consoleLog};
}

async function ask(args, {sb, me, isAdmin}) {
  if (!isAdmin) fail(403, 'Admins only');
  const triageId = String(args.triageId || '');
  if (!UUID.test(triageId)) fail(400, 'bad id');
  const body = cleanText(args.text, ASK_MAX, 'The message');
  const userId = await submitterOf(sb, triageId);
  // Only ever targeted: an anonymous report gets nothing, never a broadcast.
  if (!userId) fail(409, 'This report has no signed-in submitter, so there is nobody to notify. Nothing was sent.');
  // An image the admin added (Ames 2026-10-20): only one of ours, from the
  // reply-images folder that the cleanup empties after 7 days.
  const image = replyImage(args.imageUrl);
  const row = { title: ASK_TITLE, body, thumbnail_url: ASK_IMAGE, image_url: image || ASK_IMAGE,
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
  const {parts, consoleLog} = replyParts(args);
  let note;
  try { note = (await sb(`notifications?id=eq.${id}&select=id,target_type,target_id,reply_triage_id,replied_at,created_by&limit=1`))[0]; }
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
  const claim = body => sb(`notifications?id=eq.${id}&replied_at=is.null&reply_triage_id=eq.${note.reply_triage_id}`,
    {method: 'PATCH', body: JSON.stringify(body)});
  // The parts need supabase-report-reply-parts.sql. Until it is run the
  // reply is kept as text and the player is told the rest was not.
  let kept = parts, partsSaved = true;
  let claimed;
  try { claimed = await claim({replied_at: at, reply_text: text, ...parts}); }
  catch (e) {
    if (!missingColumn(e) || !Object.keys(parts).length) throw e;
    kept = {}; partsSaved = false;
    claimed = await claim({replied_at: at, reply_text: text});
  }
  if (!claimed.length) fail(409, 'You already replied to this one.');
  // Console messages go to a table only the server reads.
  let consoleLines = 0;
  if (consoleLog && partsSaved) {
    try {
      await sb('report_reply_console?on_conflict=notification_id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify({notification_id: id, console_log: consoleLog})});
      consoleLines = consoleLog.split('\n').length;
    } catch (e) { partsSaved = partsSaved && false; }
  }
  try {
    // Re-read the log right before appending, so a write in between (the
    // bridge, the board) is not overwritten.
    const fresh = (await sb(`feedback_triage?id=eq.${note.reply_triage_id}&select=feedback_log&limit=1`))[0];
    if (!fresh) fail(404, 'That report is no longer on the board.');
    const log = Array.isArray(fresh.feedback_log) ? [...fresh.feedback_log] : [];
    log.push({role: 'reporter_reply', via: 'game', by: me.display_name || me.username || 'Player', user_id: me.id,
      notification_id: id, text, ts: at, at, echoed: false, seen: false,
      ...(kept.reply_screenshot_url ? {screenshot_url: kept.reply_screenshot_url} : {}),
      ...(kept.reply_view_url ? {view_url: kept.reply_view_url} : {}),
      ...(kept.reply_dataset ? {dataset: kept.reply_dataset} : {}),
      ...(kept.reply_build ? {build: kept.reply_build} : {}),
      ...(consoleLines ? {console_lines: consoleLines} : {})});
    await sb(`feedback_triage?id=eq.${note.reply_triage_id}`, {method: 'PATCH', body: JSON.stringify({feedback_log: log})});
  } catch (e) {
    // Not recorded on the card: give the reply back so the player can retry.
    const undo = {replied_at: null, reply_text: null, ...Object.fromEntries(Object.keys(kept).map(k => [k, null]))};
    await sb(`notifications?id=eq.${id}`, {method: 'PATCH', body: JSON.stringify(undo)}).catch(() => {});
    throw e;
  }
  // The admin who asked gets a bell (Ames 2026-10-21: in the bell's Admin
  // tab, "if there is a reply that I requested"). Best effort: the reply is
  // already on the card and in Slack either way.
  if (note.created_by && UUID.test(String(note.created_by))) {
    const who = String(me.display_name || me.username || 'A player').slice(0, 60);
    const bell = {title: `${REPLIED_TITLE} ${who}`.slice(0, 120), body: text.slice(0, 500),
      thumbnail_url: ASK_IMAGE, image_url: ASK_IMAGE, target_type: 'user', target_id: String(note.created_by),
      send_at: at, created_by: me.id};
    await sb('notifications', {method: 'POST', body: JSON.stringify(bell)}).catch(() => {});
  }
  // The bridge posts it into the report's Slack thread now, not on its timer.
  if (wake) await Promise.resolve(wake()).catch(() => {});
  return {id, replied_at: at, reply_text: text, ...kept, console_lines: consoleLines,
    // False when something the player attached could not be kept.
    parts_saved: partsSaved};
}

/** The console messages a reply came with. Admins only. */
async function consoleOf(args, {sb, isAdmin}) {
  if (!isAdmin) fail(403, 'Admins only');
  const id = Number(args.notificationId);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Unknown notification.');
  let row;
  try { row = (await sb(`report_reply_console?notification_id=eq.${id}&select=console_log&limit=1`))[0]; }
  catch (e) { if (!e.status) return {console_log: null}; throw e; }
  return {console_log: row ? row.console_log : null};
}

async function handle(action, args, io) {
  if (action === 'reply.ask') return ask(args || {}, io);
  if (action === 'reply.send') return send(args || {}, io);
  if (action === 'reply.console') return consoleOf(args || {}, io);
  fail(400, `unknown action ${action}`);
}

module.exports = { handle, cleanText, replyImage, replyParts, ASK_TITLE, REPLIED_TITLE, ASK_IMAGE, REPLY_MAX, OWN_STORAGE};
