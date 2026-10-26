'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {scheduleReminder, dropReminder, mark, DAY_MS} = require('./help-reminder');

const U = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const asker = U(1), helper = {id: U(2)}, other = {id: U(3)};
const REQ = U(10);
const T0 = Date.parse('2026-10-21T12:00:00Z');

/** A small stand-in for the PostgREST helper: the shapes help-reminder.js uses. */
function world() {
  const db = {
    help_requests: [{id: REQ, user_id: asker, segment_id: '648518346353836607', resolved: false,
      issue_type: 'Merge error', note: 'Is this [branch](https://x.example) a merger?', created_at: '2026-10-24T15:00:00Z'}],
    help_responses: [{id: 's1', request_id: REQ, user_id: helper.id, user_name: 'Celia', note: 'Yes, cut it at the fork.'}],
    notifications: [],
  };
  let nextId = 1;
  const match = (r, q) => [...q].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('gt.')) return String(r[k]) > v.slice(3);
    if (v.startsWith('like.')) {
      const re = new RegExp('^' + v.slice(5).split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's');
      return re.test(String(r[k]));
    }
    throw new Error('filter ' + v);
  });
  const sb = async (path, init = {}) => {
    const [table, qs = ''] = path.split('?');
    const q = new URLSearchParams(qs);
    const method = init.method || 'GET';
    if (method === 'POST') { const row = {id: nextId++, ...JSON.parse(init.body)}; db[table].push(row); return [row]; }
    const hit = db[table].filter(r => match(r, q));
    if (method === 'DELETE') { db[table] = db[table].filter(r => !hit.includes(r)); return hit; }
    return hit;
  };
  return {db, sb};
}

test('a reply schedules one reminder for a day later, with the mark solved link', async () => {
  const {db, sb} = world();
  assert.deepEqual(await scheduleReminder({sb, me: helper, target: asker, requestId: REQ, now: T0}), {scheduled: true});
  assert.equal(db.notifications.length, 1);
  const n = db.notifications[0];
  assert.equal(n.target_id, asker);
  assert.equal(n.send_at, new Date(T0 + DAY_MS).toISOString());
  assert.match(n.body, new RegExp(`\\[mark it solved\\]\\(#${mark(REQ)}\\)`));
  assert.match(n.body, /cell 648518346353836607/);
  // Which request it was (annkri, report 247): the day, the issue, the note, and the reply.
  assert.match(n.body, /from Oct 24/);
  assert.match(n.body, /\*\*Merge error\*\*, cell 648518346353836607: "Is this branch\(https:\/\/x\.example\) a merger\?"/);
  assert.match(n.body, /\*\*Reply from Celia:\*\* "Yes, cut it at the fork\."/);
  // The player's note can not add a link of its own: only the mark solved link remains.
  assert.equal((n.body.match(/\]\(/g) || []).length, 1);
  assert.doesNotMatch(n.title + n.body, /—|–/, 'no dashes in player copy');
});

test('a second reply does not stack a second reminder', async () => {
  const {db, sb} = world();
  db.help_responses.push({id: 's2', request_id: REQ, user_id: other.id});
  await scheduleReminder({sb, me: helper, target: asker, requestId: REQ, now: T0});
  const again = await scheduleReminder({sb, me: other, target: asker, requestId: REQ, now: T0 + 3600e3});
  assert.equal(again.scheduled, false);
  assert.equal(db.notifications.length, 1);
});

test('no reminder for a solved request, someone else\'s request, or without a reply of your own', async () => {
  const {db, sb} = world();
  assert.equal((await scheduleReminder({sb, me: other, target: asker, requestId: REQ, now: T0})).why, 'no reply from you');
  assert.equal((await scheduleReminder({sb, me: helper, target: other.id, requestId: REQ, now: T0})).why, 'not their request');
  assert.equal((await scheduleReminder({sb, me: helper, target: asker, requestId: 'bad id!', now: T0})).why, 'no request');
  db.help_requests[0].resolved = true;
  assert.equal((await scheduleReminder({sb, me: helper, target: asker, requestId: REQ, now: T0})).why, 'already solved');
  assert.equal(db.notifications.length, 0);
});

test('marking solved before it arrives deletes the waiting reminder, and only that one', async () => {
  const {db, sb} = world();
  db.notifications.push({id: 99, target_type: 'user', target_id: asker, body: 'Someone replied', send_at: new Date(T0).toISOString()});
  await scheduleReminder({sb, me: helper, target: asker, requestId: REQ, now: T0});
  // Not solved yet: nothing goes.
  assert.deepEqual(await dropReminder({sb, requestId: REQ, now: T0 + 1000}), {dropped: 0});
  db.help_requests[0].resolved = true;
  assert.deepEqual(await dropReminder({sb, requestId: REQ, now: T0 + 1000}), {dropped: 1});
  assert.deepEqual(db.notifications.map(n => n.id), [99]);
});

test('a reminder that already arrived stays; its link then says the request is solved', async () => {
  const {db, sb} = world();
  await scheduleReminder({sb, me: helper, target: asker, requestId: REQ, now: T0});
  db.help_requests[0].resolved = true;
  assert.deepEqual(await dropReminder({sb, requestId: REQ, now: T0 + DAY_MS + 1}), {dropped: 0});
  assert.equal(db.notifications.length, 1);
});
