'use strict';
// Beta access (Ames 2026-10-24): status and the one request per account,
// against a fake database. Run: cd functions && node --test beta-access.test.js
const test = require('node:test');
const assert = require('node:assert');
const {handle, BETA_CATEGORY, BETA_BELL} = require('./access-request');

function world() {
  const issues = [];
  const told = [], posted = [];
  const sb = async (path, init = {}) => {
    if (path.startsWith('site_issues?')) {
      const q = new URLSearchParams(path.split('?')[1]);
      const cat = (q.get('category') || '').replace(/^eq\./, '');
      const uid = (q.get('user_id') || '').replace(/^eq\./, '');
      return issues.filter(i => i.category === cat && i.user_id === uid).map(i => ({id: i.id}));
    }
    if (path === 'site_issues' && init.method === 'POST') {
      for (const r of JSON.parse(init.body)) issues.push({id: 'i' + (issues.length + 1), ...r});
      return [];
    }
    throw new Error('unexpected ' + path);
  };
  const me = {id: 'u-new', display_name: 'New Player', username: 'newbie'};
  const io = (over = {}) => ({sb, me, who: {email: 'new@example.org'}, isAdmin: false, isPilot: false,
    notifyReviewers: async n => { told.push(n); }, postIssue: async p => { posted.push(p); }, ...over});
  return {issues, told, posted, io, me};
}

test('a tester or an admin is invited, and nothing is read', async () => {
  const w = world();
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io({isPilot: true})), {invited: true, requested: false});
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io({isAdmin: true})), {invited: true, requested: false});
  assert.deepStrictEqual(await handle('access.beta', {}, w.io({isPilot: true})), {invited: true, requested: false});
  assert.strictEqual(w.issues.length, 0);
});

test('a player not on the list: not invited, not yet requested', async () => {
  const w = world();
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io()), {invited: false, requested: false});
});

test('the request: one report, one bell in the Admin tab, one Slack post', async () => {
  const w = world();
  const out = await handle('access.beta', {note: 'I proofread on EyeWire for years.'}, w.io());
  assert.deepStrictEqual(out, {invited: false, requested: true});
  assert.strictEqual(w.issues.length, 1);
  const r = w.issues[0];
  assert.strictEqual(r.category, BETA_CATEGORY);
  assert.strictEqual(r.user_id, 'u-new');
  assert.match(r.title, /^Beta access request from New Player$/);
  assert.match(r.message, /New Player \(new@example\.org\) asks to join the Pyr beta\. Their note: I proofread on EyeWire for years\./);
  assert.match(r.message, /Pilot testers/);
  assert.strictEqual(w.told.length, 1);
  assert.ok(w.told[0].title.startsWith(BETA_BELL), w.told[0].title);
  assert.strictEqual(w.posted.length, 1);
  assert.strictEqual(w.posted[0].category, BETA_CATEGORY);
  // No dashes in anything a person reads.
  for (const t of [r.title, r.message, w.told[0].title, w.told[0].body]) assert.doesNotMatch(t, /[–—]/);
});

test('once only: a second request files nothing, and status says requested', async () => {
  const w = world();
  await handle('access.beta', {}, w.io());
  const again = await handle('access.beta', {note: 'again'}, w.io());
  assert.deepStrictEqual(again, {invited: false, requested: true, already: true});
  assert.strictEqual(w.issues.length, 1);
  assert.strictEqual(w.told.length, 1);
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io()), {invited: false, requested: true});
});

test('a failed bell or Slack post still keeps the request', async () => {
  const w = world();
  const out = await handle('access.beta', {}, w.io({notifyReviewers: async () => { throw new Error('down'); }, postIssue: async () => { throw new Error('down'); }}));
  assert.strictEqual(out.requested, true);
  assert.strictEqual(w.issues.length, 1);
});

test('a note that is too long is refused; no profile yet is refused', async () => {
  const w = world();
  await assert.rejects(handle('access.beta', {note: 'x'.repeat(1001)}, w.io()), /too long/);
  await assert.rejects(handle('access.beta', {}, w.io({me: null})), /profile is not ready/);
  assert.strictEqual(w.issues.length, 0);
});
