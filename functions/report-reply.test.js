'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {handle, REPLY_MAX, ASK_IMAGE, OWN_STORAGE} = require('./report-reply');

const U = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const T = n => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const amy = {id: U(1), display_name: 'Ames'}, sam = {id: U(2), display_name: 'Sam'}, eve = {id: U(3), username: 'eve'};

/** A tiny stand-in for the database helper: the few PostgREST shapes used. */
function world({columns = true, parts = true} = {}) {
  const state = {
    notifications: [],
    report_reply_console: [],
    site_issues: [{id: 7, user_id: sam.id}, {id: 8, user_id: null}],
    feedback_triage: [
      {id: T(1), source: 'site_issue', source_id: '7', status: 'done', impl_state: 'deployed', approver_note: null,
        feedback_log: [{role: 'preview', sha: 'x', ts: '1'}]},
      {id: T(2), source: 'site_issue', source_id: '8', status: 'proposed', feedback_log: []},
      {id: T(3), source: 'client_error', source_id: '9', status: 'proposed', feedback_log: []},
    ],
    wakes: 0, failLog: false,
  };
  const REPLY_COLS = ['reply_triage_id', 'reply_text', 'replied_at'];
  const sb = async (path, init = {}) => {
    const [table, qs = ''] = path.split('?');
    const q = new URLSearchParams(qs), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    const usesReply = REPLY_COLS.some(c => qs.includes(c) || (body && c in body));
    if (table === 'notifications' && usesReply && !columns) throw new Error('supabase 400');
    // supabase-report-reply-parts.sql not run yet: its columns and its table are missing.
    const PART_COLS = ['reply_screenshot_url', 'reply_view_url', 'reply_dataset', 'reply_build'];
    if (table === 'notifications' && !parts && PART_COLS.some(c => qs.includes(c) || (body && c in body))) throw new Error('supabase 400');
    if (table === 'report_reply_console' && !parts) throw new Error('supabase 404');
    if (table === 'report_reply_console' && method === 'POST') { state.report_reply_console.push(body); return null; }
    if (table === 'feedback_triage' && method === 'PATCH' && state.failLog) throw new Error('supabase 500');
    const match = r => [...q].every(([k, v]) => ['select', 'limit'].includes(k)
      || (v === 'is.null' ? r[k] == null : String(r[k]) === v.replace(/^eq\./, '')));
    if (method === 'POST') { const row = {id: state.notifications.length + 1, ...body}; state[table].push(row); return [row]; }
    const rows = state[table].filter(match);
    if (method === 'PATCH') { rows.forEach(r => Object.assign(r, body)); return rows.map(r => ({...r})); }
    return rows.map(r => ({...r}));
  };
  const as = (me, isAdmin = false) => (action, args) => handle(action, args, {sb, me, isAdmin, wake: async () => { state.wakes++; }});
  return {state, as};
}
const rejects = (p, status, re) => assert.rejects(p, e => e.status === status && (!re || re.test(e.message)));

test('an admin asks, the submitter replies once, and the card gets the reply', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: '  Which cell was it?  '});
  assert.equal(note.target_type, 'user'); assert.equal(note.target_id, sam.id);
  assert.equal(note.reply_triage_id, T(1)); assert.equal(note.body, 'Which cell was it?');
  assert.equal(note.title, '💬 An update on your report');

  const out = await as(sam)('reply.send', {notificationId: note.id, text: ' The big one\r\n\r\n\r\n\r\nnear the edge \u0007 '});
  assert.equal(out.reply_text, 'The big one\n\nnear the edge');
  assert.equal(state.notifications[0].reply_text, out.reply_text); assert.ok(state.notifications[0].replied_at);
  const card = state.feedback_triage[0], last = card.feedback_log.at(-1);
  assert.equal(card.feedback_log.length, 2, 'appended, the earlier entry kept');
  assert.deepEqual({role: last.role, by: last.by, user_id: last.user_id, notification_id: last.notification_id, text: last.text, echoed: last.echoed, seen: last.seen},
    {role: 'reporter_reply', by: 'Sam', user_id: sam.id, notification_id: note.id, text: out.reply_text, echoed: false, seen: false});
  assert.equal(state.wakes, 1);
  // A reply decides nothing: the card is exactly where it was.
  assert.deepEqual([card.status, card.impl_state, card.approver_note], ['done', 'deployed', null]);

  await rejects(as(sam)('reply.send', {notificationId: note.id, text: 'again'}), 409, /already replied/);
  assert.equal(card.feedback_log.length, 2);
});

test('asking again gives one more reply', async () => {
  const {state, as} = world();
  const a = await as(amy, true)('reply.ask', {triageId: T(1), text: 'First question'});
  await as(sam)('reply.send', {notificationId: a.id, text: 'one'});
  const b = await as(amy, true)('reply.ask', {triageId: T(1), text: 'Second question'});
  await as(sam)('reply.send', {notificationId: b.id, text: 'two'});
  assert.deepEqual(state.feedback_triage[0].feedback_log.filter(e => e.role === 'reporter_reply').map(e => e.text), ['one', 'two']);
});

test('only admins ask, and never an anonymous or non report card', async () => {
  const {state, as} = world();
  await rejects(as(sam)('reply.ask', {triageId: T(1), text: 'hi'}), 403);
  await rejects(as(amy, true)('reply.ask', {triageId: T(2), text: 'hi'}), 409, /no signed-in submitter/);
  await rejects(as(amy, true)('reply.ask', {triageId: T(3), text: 'hi'}), 409, /no signed-in submitter/);
  await rejects(as(amy, true)('reply.ask', {triageId: T(9), text: 'hi'}), 404);
  await rejects(as(amy, true)('reply.ask', {triageId: 'x', text: 'hi'}), 400);
  await rejects(as(amy, true)('reply.ask', {triageId: T(1), text: '   '}), 400);
  assert.equal(state.notifications.length, 0);
});

test('the picture is the server\'s own Nurro, whatever the browser sends', async () => {
  const {as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'hi', thumbnail_url: 'https://evil.example/t.png', image_url: 'https://evil.example/x.png'});
  assert.equal(note.thumbnail_url, ASK_IMAGE); assert.equal(note.image_url, ASK_IMAGE);
  assert.match(ASK_IMAGE, /\/static\/nurro\/nurro-experiment-recap\.png$/);
});

test('a player can only reply to their own report, on a notification that asked', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'Which cell?'});
  // Someone else, even one who knows the id.
  await rejects(as(eve)('reply.send', {notificationId: note.id, text: 'me!'}), 403, /not your notification/);
  await rejects(as(null)('reply.send', {notificationId: note.id, text: 'me!'}), 403);
  await rejects(as(sam)('reply.send', {notificationId: 999, text: 'x'}), 403, /not your notification/);
  await rejects(as(sam)('reply.send', {notificationId: '1 or 1=1', text: 'x'}), 400);
  // An ordinary notification to the same player: no reply was asked for.
  state.notifications.push({id: 50, target_type: 'user', target_id: sam.id, reply_triage_id: null, replied_at: null});
  await rejects(as(sam)('reply.send', {notificationId: 50, text: 'x'}), 409, /No reply was asked/);
  // A broadcast is nobody's to answer.
  state.notifications.push({id: 51, target_type: 'all', target_id: null, reply_triage_id: T(1), replied_at: null});
  await rejects(as(sam)('reply.send', {notificationId: 51, text: 'x'}), 403);
  // Sent the note, but the report behind it is someone else's.
  state.notifications.push({id: 52, target_type: 'user', target_id: eve.id, reply_triage_id: T(1), replied_at: null});
  await rejects(as(eve)('reply.send', {notificationId: 52, text: 'x'}), 403, /your own report/);
  assert.equal(state.feedback_triage[0].feedback_log.length, 1);
  assert.equal(state.wakes, 0);
});

test('the text is trimmed and limited', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'Which cell?'});
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: ' \n '}), 400, /empty/);
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: {a: 1}}), 400);
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: 'x'.repeat(REPLY_MAX + 1)}), 400, /too long/);
  assert.equal(state.notifications[0].replied_at, undefined, 'a refused reply does not use up the one reply');
  await as(sam)('reply.send', {notificationId: note.id, text: 'x'.repeat(REPLY_MAX)});
});

test('two sends at once store one reply', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'Which cell?'});
  const done = await Promise.allSettled([1, 2, 3].map(n => as(sam)('reply.send', {notificationId: note.id, text: 'reply ' + n})));
  assert.equal(done.filter(d => d.status === 'fulfilled').length, 1);
  assert.equal(state.feedback_triage[0].feedback_log.filter(e => e.role === 'reporter_reply').length, 1);
});

test('a reply that could not be put on the card is handed back to retry', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'Which cell?'});
  state.failLog = true;
  await assert.rejects(as(sam)('reply.send', {notificationId: note.id, text: 'lost?'}));
  assert.equal(state.notifications[0].replied_at, null); assert.equal(state.notifications[0].reply_text, null);
  state.failLog = false;
  await as(sam)('reply.send', {notificationId: note.id, text: 'kept'});
  assert.equal(state.feedback_triage[0].feedback_log.at(-1).text, 'kept');
});

test('before the SQL is run: nothing is sent and it says why', async () => {
  const {state, as} = world({columns: false});
  await rejects(as(amy, true)('reply.ask', {triageId: T(1), text: 'Which cell?'}), 409, /supabase-report-replies\.sql.*Nothing was sent/);
  assert.equal(state.notifications.length, 0);
  state.notifications.push({id: 1, target_type: 'user', target_id: sam.id});
  await rejects(as(sam)('reply.send', {notificationId: 1, text: 'x'}), 409, /not switched on/);
});

test('unknown actions are refused', async () => {
  await rejects(world().as(amy, true)('reply.delete', {}), 400);
});

const SHOT = OWN_STORAGE + 'admin-uploads/help-screenshots/abc/1.webp';
const VIEW = 'https://pyr.example/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/123';

test('a reply carries a screenshot, the view and console messages, and the console stays off the card', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'Can you show me?'});
  const out = await as(sam)('reply.send', {notificationId: note.id, text: 'Here it is', screenshotUrl: SHOT, viewUrl: VIEW,
    dataset: 'pni_mec', build: 'abc1234', consoleLog: 'warn: one\nerror: two\nerror: three'});
  assert.equal(out.parts_saved, true); assert.equal(out.console_lines, 3);
  const n = state.notifications[0];
  assert.deepEqual([n.reply_screenshot_url, n.reply_view_url, n.reply_dataset, n.reply_build], [SHOT, VIEW, 'pni_mec', 'abc1234']);
  const last = state.feedback_triage[0].feedback_log.at(-1);
  assert.deepEqual([last.screenshot_url, last.view_url, last.dataset, last.build, last.console_lines], [SHOT, VIEW, 'pni_mec', 'abc1234', 3]);
  // The messages themselves are nowhere the public key can read.
  assert.ok(!JSON.stringify(state.feedback_triage).includes('error: two'));
  assert.ok(!JSON.stringify(state.notifications).includes('error: two'));
  assert.equal(state.report_reply_console[0].console_log, 'warn: one\nerror: two\nerror: three');
  // Only an admin reads them.
  assert.equal((await as(amy, true)('reply.console', {notificationId: note.id})).console_log.split('\n').length, 3);
  await rejects(as(sam)('reply.console', {notificationId: note.id}), 403);
  await rejects(as(eve)('reply.console', {notificationId: note.id}), 403);
});

test('a reply with text alone is as before, and each request still takes one reply', async () => {
  const {state, as} = world();
  const a = await as(amy, true)('reply.ask', {triageId: T(1), text: 'first question'});
  const out = await as(sam)('reply.send', {notificationId: a.id, text: 'plain'});
  assert.equal(out.console_lines, 0); assert.equal(out.parts_saved, true);
  const last = state.feedback_triage[0].feedback_log.at(-1);
  assert.ok(!('screenshot_url' in last) && !('view_url' in last) && !('console_lines' in last));
  await rejects(as(sam)('reply.send', {notificationId: a.id, text: 'more', screenshotUrl: SHOT}), 409, /already replied/);
  // Asked again: one more, with its own attachments.
  const b = await as(amy, true)('reply.ask', {triageId: T(1), text: 'and a picture?'});
  await as(sam)('reply.send', {notificationId: b.id, text: 'sure', screenshotUrl: SHOT});
  assert.equal(state.feedback_triage[0].feedback_log.filter(e => e.role === 'reporter_reply').length, 2);
});

test('attachments are checked: only our own screenshots, only one https link', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'q'});
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: 'x', screenshotUrl: 'https://evil.example/a.png'}), 400, /screenshot/);
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: 'x', screenshotUrl: SHOT + ' onerror=1'}), 400, /screenshot/);
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: 'x', viewUrl: 'javascript:alert(1)'}), 400, /view/);
  await rejects(as(sam)('reply.send', {notificationId: note.id, text: 'x', viewUrl: 'https://a.example/ two links'}), 400, /view/);
  // Nothing was claimed by the refused tries: the reply can still be sent.
  assert.equal(state.notifications[0].replied_at, undefined);
  // A dataset or build that is not a plain tag is dropped, not stored.
  const out = await as(sam)('reply.send', {notificationId: note.id, text: 'ok', dataset: '<b>x</b>', build: 'a b'});
  assert.ok(!('reply_dataset' in out) && !('reply_build' in out));
});

test('before the parts SQL is run: the text is kept and the player is told the rest was not', async () => {
  const {state, as} = world({parts: false});
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'q'});
  const out = await as(sam)('reply.send', {notificationId: note.id, text: 'with a picture', screenshotUrl: SHOT, viewUrl: VIEW, consoleLog: 'error: x'});
  assert.equal(out.parts_saved, false); assert.equal(out.reply_text, 'with a picture');
  const last = state.feedback_triage[0].feedback_log.at(-1);
  assert.equal(last.text, 'with a picture'); assert.ok(!('screenshot_url' in last));
  assert.equal(state.report_reply_console.length, 0);
  assert.equal((await as(amy, true)('reply.console', {notificationId: note.id})).console_log, null);
});

test('a reply with attachments that could not be put on the card is handed back whole', async () => {
  const {state, as} = world();
  const note = await as(amy, true)('reply.ask', {triageId: T(1), text: 'q'});
  state.failLog = true;
  await assert.rejects(as(sam)('reply.send', {notificationId: note.id, text: 'x', screenshotUrl: SHOT, viewUrl: VIEW}));
  const n = state.notifications[0];
  assert.deepEqual([n.replied_at, n.reply_text, n.reply_screenshot_url, n.reply_view_url], [null, null, null, null]);
  state.failLog = false;
  await as(sam)('reply.send', {notificationId: note.id, text: 'x again', screenshotUrl: SHOT});
  assert.equal(state.notifications[0].reply_screenshot_url, SHOT);
});
