// Run: node --test scripts/tag-nudge.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { nudgeWaitingTags, isNudgeTime, waitingTags, answered } from './tag-nudge.mjs';

const CARD = '44444444-4444-4444-4444-000000000001';
const CELIA = '22222222-2222-2222-2222-222222222222';
// Thursday 2026-11-05, 11:00 Eastern (tags from 2026-11-04 on are chased).
const WED = Date.parse('2026-11-05T16:00:00Z');
const tagNote = (hoursAgo, now = WED) => ({ title: '📋 Amy R. Sterling tagged you on a To do', target_id: CELIA,
  body: `Update Badge Copy\n\nhttps://pyr.example/?triage=board&todo=${CARD}`, send_at: new Date(now - hoursAgo * 3600e3).toISOString() });

function world({ notes, card, pinged = [] }) {
  const slack = [], bells = [];
  return { slack, bells, io: {
    now: WED, channel: 'C1',
    get: async path => {
      if (path.startsWith('notifications?select=title')) return notes;
      if (path.startsWith('notifications?select=body')) return pinged;
      if (path.startsWith('users?')) return [{ id: CELIA, display_name: 'Celia D' }];
      if (path.startsWith('admin_todos?')) return card ? [card] : [];
      return [];
    },
    post: async (_, rows) => bells.push(...rows),
    slack: async (channel, thread, text) => slack.push({ channel, thread, text }),
  } };
}

test('weekdays, 9 am to 6 pm Eastern only', () => {
  assert.equal(isNudgeTime(new Date(WED)), true);
  assert.equal(isNudgeTime(new Date('2026-11-07T16:00:00Z')), false, 'Saturday');
  assert.equal(isNudgeTime(new Date('2026-11-05T13:00:00Z')), false, '8 am Eastern');
  assert.equal(isNudgeTime(new Date('2026-11-05T14:00:00Z')), true, '9 am Eastern');
  assert.equal(isNudgeTime(new Date('2026-11-05T23:05:00Z')), false, '6:05 pm Eastern');
});
test('under 24 hours is not waiting yet', () => {
  assert.equal(waitingTags([tagNote(20)], WED).length, 0);
  assert.equal(waitingTags([tagNote(30)], WED).length, 1);
});
test('no reply after a day: one Slack ping that tags her, and a bell', async () => {
  const w = world({ notes: [tagNote(30)], card: { id: CARD, title: 'Update Badge Copy', list: 'doing', comments: [] } });
  assert.equal(await nudgeWaitingTags(w.io), 1);
  assert.match(w.slack[0].text, /<@U033NHWDE> Amy R\. Sterling tagged you on a To do/);
  assert.match(w.bells[0].title, /^⏰ Still waiting on you: Update Badge Copy/);
});
test('a comment from her after the tag stops it', async () => {
  const w = world({ notes: [tagNote(30)], card: { id: CARD, title: 'x', list: 'doing', comments: [{ by: 'Celia D', text: 'on it', at: new Date(WED - 2 * 3600e3).toISOString() }] } });
  assert.equal(await nudgeWaitingTags(w.io), 0);
});
test('a finished or deleted card is not chased', async () => {
  assert.equal(await nudgeWaitingTags(world({ notes: [tagNote(30)], card: { id: CARD, title: 'x', list: 'done', comments: [] } }).io), 0);
  assert.equal(await nudgeWaitingTags(world({ notes: [tagNote(30)], card: null }).io), 0);
});
test('once a day: a ping already sent today is not repeated', async () => {
  const pinged = [{ target_id: CELIA, body: `... ${CARD}`, send_at: new Date(WED - 3600e3).toISOString() }];
  const w = world({ notes: [tagNote(30)], card: { id: CARD, title: 'x', list: 'doing', comments: [] }, pinged });
  assert.equal(await nudgeWaitingTags(w.io), 0);
  const yesterday = [{ target_id: CELIA, body: `... ${CARD}`, send_at: new Date(WED - 24 * 3600e3).toISOString() }];
  // (a tag 34 hours before Thursday 11 am is Wednesday morning, after the start)
  assert.equal(await nudgeWaitingTags(world({ notes: [tagNote(34)], card: { id: CARD, title: 'x', list: 'doing', comments: [] }, pinged: yesterday }).io), 1);
});
test('a report: a Slack reply in its thread counts', () => {
  const tag = { kind: 'report', at: WED - 30 * 3600e3 };
  assert.equal(answered(tag, 'Celia D', { status: 'approved', admin_notes: [], feedback_log: [{ user: 'U033NHWDE', ts: String((WED - 3600e3) / 1000) }] }, 'U033NHWDE'), true);
  assert.equal(answered(tag, 'Celia D', { status: 'approved', admin_notes: [], feedback_log: [] }, 'U033NHWDE'), false);
});

test('tags from before the start are never chased', () => {
  assert.equal(waitingTags([tagNote(60)], WED).length, 0);
});

test('due after 6 pm: nothing that evening, the ping comes at 9 am the next weekday', async () => {
  const card = { id: CARD, title: 'x', list: 'doing', comments: [] };
  // Tagged Wednesday 7 pm Eastern: due Thursday 7 pm.
  const tagAt = Date.parse('2026-11-04T19:00:00-05:00');
  const note = { ...tagNote(0, tagAt) };
  const run = async (when) => { const w = world({ notes: [note], card }); w.io.now = Date.parse(when); return nudgeWaitingTags(w.io); };
  assert.equal(await run('2026-11-05T19:30:00-05:00'), 0, 'Thursday 7:30 pm');
  assert.equal(await run('2026-11-06T08:50:00-05:00'), 0, 'Friday 8:50 am');
  assert.equal(await run('2026-11-06T09:05:00-05:00'), 1, 'Friday 9:05 am');
  // Due Friday evening: Monday 9 am.
  const fri = { ...tagNote(0, Date.parse('2026-11-05T19:00:00-05:00')) };
  const runF = async (when) => { const w = world({ notes: [fri], card }); w.io.now = Date.parse(when); return nudgeWaitingTags(w.io); };
  assert.equal(await runF('2026-11-07T10:00:00-05:00'), 0, 'Saturday');
  assert.equal(await runF('2026-11-09T09:05:00-05:00'), 1, 'Monday 9:05 am');
});
