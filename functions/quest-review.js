'use strict';

// Quest reviews (Celia and Ames 2026-11-05): a reviewer's feedback on a
// submitted Cilia Quest cell reaches the player in Pyr, and the player's fix
// comes back to the sheet, with nobody copying by hand.
//
// The quest sheet is the whole record; nothing is kept in the database
// except the bell notification itself. Its columns, read from the sheet
// (row 1 of "All Cells", 2026-11-05):
//   R  Review Notes & Feedback   the reviewer's notes       (reviewer writes)
//   S  Annotations reviewed by   the reviewer's name        (reviewer writes)
//   T  Updated link              the reviewer's link        (reviewer writes)
//   U  Review status             Send Review, Review Sent, Reviewed, Complete
//   V  Player Link               the player's updated link  (Pyr writes)
//   W  Player Notes              the player's notes         (Pyr writes)
//   X  Review accepted           Yes or No                  (reviewer writes)
// Columns are found by their header, so moving one does not break anything.
//
// The loop:
//   check   twice a day (ewQuestReviewCheck) and on an admin's ask: every row
//           whose Review status is "Send Review" sends its annotator a bell
//           notification, then the status becomes "Review Sent".
//   get     the player: where their review of one cell stands.
//   reply   the player: their updated link and notes go to Player Link and
//           Player Notes, and the status becomes "Reviewed". Only on their
//           own row, and only while it says "Review Sent".
// The reviewer then sets Review accepted and Complete, or writes new notes
// and sets "Send Review" again, which starts the loop over.
//
// Every value is written RAW. Review status is a strict dropdown, so only its
// own options are ever written, character for character.
const {QUESTS, QUEST_COLUMNS, nameKey} = require('./sheet-policy');

const STATUS = Object.freeze({send: 'Send Review', sent: 'Review Sent', reviewed: 'Reviewed', complete: 'Complete'});
const REVIEW_COLUMNS = Object.freeze({
  reviewNotes: ['reviewnotesfeedback', 'reviewnotes'],
  reviewer: ['annotationsreviewedby', 'reviewedby'],
  reviewLink: ['updatedlink'],
  reviewStatus: ['reviewstatus'],
  playerLink: ['playerlink'],
  playerNotes: ['playernotes'],
  accepted: ['reviewaccepted'],
});
const SEGMENT_HEADERS = ['latestsegid', 'startseg', 'segmentid', 'segment', 'segid'];
/** The start of every review notification's title; the bell knows a review by it. */
const TITLE_START = '📝 A review of your Cilia Quest cell';
// Science Nurro at the microscope, notebook in paw: the picture of a note
// that asks for a reply (as report-reply.js). Set here, never by a browser.
const IMAGE = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/nurro-experiment-recap.png';
const NOTES_MAX = 1000;
const LINK_MAX = 2000;
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const letters = n => { let s = ''; do { s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const isLink = v => /^https:\/\/[^\s"'<>]+$/i.test(String(v || '')) && String(v).length <= LINK_MAX;

/** The header row of the quest tab and where each column is, or -1. */
function reviewHeader(grid) {
  const first = (h, patterns) => { for (const p of patterns) { const n = h.findIndex(x => x.includes(p)); if (n >= 0) return n; } return -1; };
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const h = (grid[i] || []).map(norm);
    const segment = first(h, SEGMENT_HEADERS);
    if (segment < 0) continue;
    const cols = {segment};
    for (const [key, patterns] of Object.entries({...QUEST_COLUMNS, ...REVIEW_COLUMNS})) cols[key] = first(h, patterns);
    return {headerRow: i, cols};
  }
  fail(409, 'The quest sheet needs a segment ID column.');
}
const NEEDED = ['index', 'name', 'link', 'notes', 'reviewNotes', 'reviewer', 'reviewLink', 'reviewStatus', 'playerLink', 'playerNotes'];
function needColumns(cols) {
  const missing = NEEDED.filter(k => cols[k] < 0);
  if (missing.length) fail(409, 'The quest sheet is missing review columns: ' + missing.join(', '));
}

/** One sheet row, as the review loop sees it. */
function rowView(line, cols, rowNumber) {
  const at = key => cols[key] >= 0 ? String((line || [])[cols[key]] ?? '').trim() : '';
  return {
    row: rowNumber, index: at('index'), segmentId: at('segment'), annotator: at('name'),
    startLink: at('startLink'), soma: at('soma'),
    link: at('link'), notes: at('notes'),
    reviewNotes: at('reviewNotes'), reviewer: at('reviewer'), reviewLink: at('reviewLink'),
    status: at('reviewStatus'), playerLink: at('playerLink'), playerNotes: at('playerNotes'), accepted: at('accepted'),
  };
}

/** A block quote of text that may run over several lines. */
const quote = text => String(text).replace(/\r\n?/g, '\n').split('\n').map(l => '> ' + l).join('\n');
const cap = (text, n) => { const s = String(text || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** The bell notification for one row. Plain words, no dashes (Ames's house style). */
function reviewNotice(r, questTitle) {
  const cell = r.index || 'your cell';
  const who = r.reviewer || 'A reviewer';
  const lines = [
    `**${who}** looked over your ${questTitle} cell **${cell}** and has feedback for you.`,
    '',
    `**${r.reviewer ? who + "'s" : 'The'} notes**`,
    r.reviewNotes ? quote(cap(r.reviewNotes, 3000)) : '> (no notes, see the link)',
  ];
  if (isLink(r.reviewLink)) lines.push('', `**${r.reviewer ? who + "'s" : 'The reviewer\'s'} link:** [open it](${r.reviewLink})`);
  lines.push('', '**What you sent**');
  if (isLink(r.link)) lines.push(`Your link: [open it](${r.link})`);
  if (r.notes) lines.push('Your notes:', quote(cap(r.notes, 1000)));
  if (r.playerLink || r.playerNotes) {
    lines.push('', '**Your last update**');
    if (isLink(r.playerLink)) lines.push(`Your link: [open it](${r.playerLink})`);
    if (r.playerNotes) lines.push('Your notes:', quote(cap(r.playerNotes, 1000)));
  }
  lines.push('', 'Take a look, make your fixes, then send your updated link and any notes in the boxes below.',
    '', `Cell ${cell}, segment ${r.segmentId}`);
  return {title: cap(`${TITLE_START} ${cell}`, 120), body: lines.join('\n')};
}

/** The segment a review notification is about, from its last line. */
const segmentOfNotice = body => (String(body || '').match(/segment (\d{1,20})\s*$/) || [])[1] || '';

/** Every name the sheet might carry for this player. */
const namesOf = me => [...new Set([me && me.sheet_name, me && me.display_name, me && me.username].map(nameKey).filter(Boolean))];

/**
 * The one Pyr player a sheet name belongs to, or null with the reason.
 * The sheet's Annotator Name is the name Pyr wrote when the player claimed
 * the cell (display name, else username); matched letters and digits only.
 */
async function playerFor(sb, name) {
  const key = nameKey(name);
  if (!key) return {user: null, why: 'no annotator name'};
  const like = [...key].map(c => encodeURIComponent(c)).join('*');
  const rows = await sb(`users?or=(display_name.ilike.*${like}*,username.ilike.*${like}*)&select=id,display_name,username&limit=50`);
  const exact = rows.filter(u => nameKey(u.display_name) === key);
  const pick = exact.length ? exact : rows.filter(u => nameKey(u.username) === key);
  if (pick.length === 1) return {user: pick[0]};
  return {user: null, why: pick.length ? `${pick.length} players are called "${name}"` : `no player is called "${name}"`};
}

/** The quest tab's title, found by its gid. */
async function tabTitle(api, quest) {
  const meta = await api(quest.id + '?fields=sheets.properties');
  const sheet = meta.sheets.find(s => s.properties.sheetId === quest.gid);
  if (!sheet) fail(409, 'The quest sheet tab is missing.');
  return sheet.properties.title;
}
const q = title => "'" + title.replace(/'/g, "''") + "'";
const getRange = (api, quest, range) => api(quest.id + '/values/' + encodeURIComponent(range) + '?valueRenderOption=FORMATTED_VALUE').then(r => r.values || []);

/** The header, plus the rows (1-based numbers) whose column `key` passes `want`. */
async function findRows(api, quest, title, key, want) {
  const head = await getRange(api, quest, q(title) + '!A1:AZ10');
  const {headerRow, cols} = reviewHeader(head);
  needColumns(cols);
  const L = letters(cols[key]), first = headerRow + 2;
  const column = await getRange(api, quest, `${q(title)}!${L}${first}:${L}`);
  const hits = [];
  column.forEach((v, k) => { if (want(String((v || [])[0] ?? '').trim())) hits.push(first + k); });
  let lines = [];
  if (hits.length) {
    const qs = hits.map(n => 'ranges=' + encodeURIComponent(`${q(title)}!A${n}:AZ${n}`)).join('&');
    const got = await api(quest.id + '/values:batchGet?' + qs + '&valueRenderOption=FORMATTED_VALUE');
    lines = (got.valueRanges || []).map(v => (v.values || [])[0] || []);
  }
  return {cols, rows: hits.map((n, i) => rowView(lines[i], cols, n))};
}
const cellRange = (title, cols, key, row) => `${q(title)}!${letters(cols[key])}${row}`;
const write = (api, quest, data) => api(quest.id + '/values:batchUpdate', {method: 'POST', body: JSON.stringify({valueInputOption: 'RAW', data})});

/**
 * Send every waiting review. `only` (a segment ID) limits it to one row, for
 * a test; `dryRun` reads and reports without sending or writing.
 * Returns what happened to each row, for the log and for the admin who asked.
 */
async function check({api, sb, questKey = 'retina_cilia', only = '', dryRun = false, now = () => new Date().toISOString()}) {
  const quest = QUESTS[questKey];
  if (!quest) fail(400, 'There is no such quest.');
  if (only && !/^\d{1,20}$/.test(String(only))) fail(400, 'Invalid segment ID.');
  const title = await tabTitle(api, quest);
  const {cols, rows} = await findRows(api, quest, title, 'reviewStatus', v => v === STATUS.send);
  const out = [];
  for (const r of rows) {
    if (only && r.segmentId !== String(only)) continue;
    const done = {row: r.row, index: r.index, segmentId: r.segmentId, annotator: r.annotator};
    try {
      if (!/^\d{1,20}$/.test(r.segmentId)) { out.push({...done, sent: false, why: 'no segment ID'}); continue; }
      const {user, why} = await playerFor(sb, r.annotator);
      if (!user) { out.push({...done, sent: false, why}); continue; }
      const notice = reviewNotice(r, 'Cilia Quest');
      if (dryRun) { out.push({...done, sent: false, why: 'dry run', to: user.id, notice}); continue; }
      // A run that sent the bell but could not mark the row is not sent twice:
      // the same words to the same player within a week count as sent.
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const dup = await sb(`notifications?target_type=eq.user&target_id=eq.${encodeURIComponent(user.id)}&title=eq.${encodeURIComponent(notice.title)}&created_at=gte.${since}&select=id,body`);
      if (!dup.some(n => n.body === notice.body)) {
        await sb('notifications', {method: 'POST', body: JSON.stringify({
          title: notice.title, body: notice.body, image_url: IMAGE, thumbnail_url: IMAGE,
          target_type: 'user', target_id: user.id, send_at: now(), created_by: null,
        })});
      }
      await write(api, quest, [{range: cellRange(title, cols, 'reviewStatus', r.row), values: [[STATUS.sent]]}]);
      out.push({...done, sent: true, to: user.id});
    } catch (e) {
      out.push({...done, sent: false, why: String(e && e.message || e).slice(0, 200)});
    }
  }
  return {checked: rows.length, results: out};
}

/** The player's own row for a segment, or a refusal. */
async function ownRow(api, quest, title, me, segmentId) {
  if (!/^\d{1,20}$/.test(String(segmentId))) fail(400, 'Invalid segment ID.');
  const {cols, rows} = await findRows(api, quest, title, 'segment', v => v === String(segmentId));
  if (rows.length !== 1) fail(409, rows.length ? 'This cell appears more than once in the quest sheet.' : 'This cell is not in the quest sheet.');
  const r = rows[0];
  if (!namesOf(me).includes(nameKey(r.annotator))) fail(403, 'This review is for another player.');
  return {cols, r};
}

/** Where the player's review of one cell stands. */
async function get(args, {api, me, questKey = 'retina_cilia'}) {
  const quest = QUESTS[questKey];
  const title = await tabTitle(api, quest);
  const {r} = await ownRow(api, quest, title, me, args.segmentId);
  // The Start Link and soma, for the notification's Jump to cell (Celia
  // 2026-11-06: the buttons did nothing; a bare segment ID had no place to go).
  return {status: r.status, accepted: r.accepted, playerLink: r.playerLink, playerNotes: r.playerNotes, reviewer: r.reviewer, index: r.index,
    startLink: isLink(r.startLink) ? r.startLink : '', soma: /^\[?\s*-?\d+(\.\d+)?[\s,]+-?\d+(\.\d+)?[\s,]+-?\d+(\.\d+)?\s*\]?$/.test(r.soma) ? r.soma : ''};
}

/** The player's updated link and notes, checked. */
function replyValues(args) {
  const link = String(args.link ?? '').trim();
  if (link && !isLink(link)) fail(400, 'The link must be a single https link.');
  const notes = String(args.notes ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (notes.length > NOTES_MAX) fail(400, `Keep your notes under ${NOTES_MAX} characters.`);
  if (!link && !notes) fail(400, 'Add your updated link, your notes, or both.');
  return {link, notes};
}

/** The player's fix goes back to the sheet. */
async function reply(args, {api, me, questKey = 'retina_cilia'}) {
  const quest = QUESTS[questKey];
  const {link, notes} = replyValues(args);
  const title = await tabTitle(api, quest);
  const {cols, r} = await ownRow(api, quest, title, me, args.segmentId);
  if (r.status !== STATUS.sent) {
    fail(409, r.status === STATUS.reviewed ? 'Your update is already with the reviewer.'
      : r.status === STATUS.complete ? 'This review is complete.'
      : 'This review is not waiting for an update right now.');
  }
  await write(api, quest, [
    {range: cellRange(title, cols, 'playerLink', r.row), values: [[link]]},
    {range: cellRange(title, cols, 'playerNotes', r.row), values: [[notes]]},
    {range: cellRange(title, cols, 'reviewStatus', r.row), values: [[STATUS.reviewed]]},
  ]);
  return {status: STATUS.reviewed, playerLink: link, playerNotes: notes};
}

// ── The reviewers' morning note (Celia 2026-11-06) ────────────────────────
// "Marissa and Celia [should] get a notification of pending returned reviews
// ... once a day in the morning saying how many are waiting, rather than
// individual notifications every time a review response is submitted."
// One bell note each, only on a morning with something waiting: every row a
// player answered ("Reviewed"), and every new player's quest ("New Player").
const REVIEWERS = Object.freeze([
  {id: '942bda30-fcf0-424c-8785-91db4d62d2aa', name: 'Celia D'},
  {id: '19812b86-6374-48f4-b116-4ec60843c78e', name: 'Marissa Pratt'},
]);
const DIGEST_TITLE = '📝 Cilia Quest reviews waiting';
const NEW_PLAYER = 'New Player';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The note's words for the waiting rows, or null when nothing waits. */
function digestNotice(answered, newcomers, sheetUrl) {
  if (!answered.length && !newcomers.length) return null;
  const line = r => `• **${r.index || 'a cell'}** from ${r.annotator || 'a player'}`;
  const lines = [];
  if (answered.length) {
    lines.push(`**${plural(answered.length, 'player has', 'players have')} sent an update** (Review status "Reviewed"):`);
    lines.push(...answered.slice(0, 15).map(line));
    if (answered.length > 15) lines.push(`and ${answered.length - 15} more`);
  }
  if (newcomers.length) {
    if (lines.length) lines.push('');
    lines.push(`**${plural(newcomers.length, 'quest', 'quests')} from new players** (Review status "New Player"):`);
    lines.push(...newcomers.slice(0, 15).map(line));
    if (newcomers.length > 15) lines.push(`and ${newcomers.length - 15} more`);
  }
  lines.push('', `[Open the quest sheet](${sheetUrl})`);
  const parts = [answered.length && plural(answered.length, 'update', 'updates'), newcomers.length && plural(newcomers.length, 'new player quest', 'new player quests')].filter(Boolean);
  return {title: cap(`${DIGEST_TITLE}: ${parts.join(', ')}`, 120), body: lines.join('\n')};
}

/** Send the morning note to each reviewer. `dryRun` reports it unsent. */
async function digest({api, sb, questKey = 'retina_cilia', to = REVIEWERS, dryRun = false, now = () => new Date().toISOString()}) {
  const quest = QUESTS[questKey];
  if (!quest) fail(400, 'There is no such quest.');
  const title = await tabTitle(api, quest);
  const {rows} = await findRows(api, quest, title, 'reviewStatus', v => v === STATUS.reviewed || v === NEW_PLAYER);
  const answered = rows.filter(r => r.status === STATUS.reviewed), newcomers = rows.filter(r => r.status === NEW_PLAYER);
  const notice = digestNotice(answered, newcomers, `https://docs.google.com/spreadsheets/d/${quest.id}/edit#gid=${quest.gid}`);
  if (!notice || dryRun) return {answered: answered.length, newcomers: newcomers.length, sent: 0, notice};
  let sent = 0;
  for (const r of to) {
    await sb('notifications', {method: 'POST', body: JSON.stringify({
      title: notice.title, body: notice.body, image_url: IMAGE, thumbnail_url: IMAGE,
      target_type: 'user', target_id: r.id, send_at: now(), created_by: null,
    })});
    sent++;
  }
  return {answered: answered.length, newcomers: newcomers.length, sent};
}

module.exports = {STATUS, REVIEW_COLUMNS, TITLE_START, reviewHeader, rowView, reviewNotice, segmentOfNotice, playerFor,
  replyValues, check, get, reply, findRows, REVIEWERS, DIGEST_TITLE, digestNotice, digest};
