'use strict';
// Beta access (Ames 2026-10-24): status, the one request per account, and
// that nothing a player types can inject anything, against a fake database.
// Run: cd functions && node --test beta-access.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {handle, BETA_CATEGORY, BETA_BELL} = require('./access-request');
// The game draws a bell's body with marked (src/util/safe_markdown.ts).
let marked = null;
try { ({marked} = require(path.join(__dirname, '..', 'node_modules', 'marked'))); } catch (e) { /* checked below */ }

const GOOD = {name: 'New Player', email: 'New.Player@Example.org'};

function world() {
  const issues = [];
  const told = [], posted = [];
  const sb = async (p, init = {}) => {
    if (p.startsWith('site_issues?')) {
      const q = new URLSearchParams(p.split('?')[1]);
      const cat = (q.get('category') || '').replace(/^eq\./, '');
      const uid = (q.get('user_id') || '').replace(/^eq\./, '');
      return issues.filter(i => i.category === cat && i.user_id === uid).map(i => ({id: i.id}));
    }
    if (p === 'site_issues' && init.method === 'POST') {
      for (const r of JSON.parse(init.body)) issues.push({id: 'i' + (issues.length + 1), ...r});
      return [];
    }
    throw new Error('unexpected ' + p);
  };
  const me = {id: 'u-new', display_name: 'Profile Name', username: 'newbie'};
  const io = (over = {}) => ({sb, me, who: {email: 'signin@example.org'}, isAdmin: false, isPilot: false,
    notifyAdmins: async n => { told.push(n); }, notifyReviewers: async () => { throw new Error('beta goes to every admin'); },
    postIssue: async p => { posted.push(p); }, ...over});
  return {issues, told, posted, io};
}

test('a tester or an admin is invited, and nothing is filed', async () => {
  const w = world();
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io({isPilot: true})), {invited: true, requested: false});
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io({isAdmin: true})), {invited: true, requested: false});
  assert.deepStrictEqual(await handle('access.beta', GOOD, w.io({isPilot: true})), {invited: true, requested: false});
  assert.strictEqual(w.issues.length, 0);
});

test('a player not on the list: not invited, not yet requested', async () => {
  const w = world();
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io()), {invited: false, requested: false});
});

test('the request: one triage report, one bell to every admin, one Slack post', async () => {
  const w = world();
  const out = await handle('access.beta', {...GOOD, note: 'I proofread on EyeWire for years.'}, w.io());
  assert.deepStrictEqual(out, {invited: false, requested: true});
  assert.strictEqual(w.issues.length, 1);
  const r = w.issues[0];
  assert.strictEqual(r.category, BETA_CATEGORY);
  assert.strictEqual(r.user_id, 'u-new');
  assert.strictEqual(r.title, 'Beta access request from New Player');
  assert.match(r.message, /^New Player asks to join the Pyr beta\./);
  assert.match(r.message, /Email they gave: new\.player@example\.org/);
  // The email for Pilot testers is the server's own, not the form's.
  assert.match(r.message, /Sign in email: signin@example\.org\. To let them in, add this one under Admin Hub, Pilot testers\./);
  assert.match(r.message, /Their note: I proofread on EyeWire for years\./);
  assert.strictEqual(w.told.length, 1);
  assert.ok(w.told[0].title.startsWith(BETA_BELL + ' from New Player'), w.told[0].title);
  // The note is in the bell too (Ames 2026-10-26: "Note from beta request should appear here").
  assert.match(w.told[0].body, /Their note:\n\nI proofread on EyeWire for years/);
  assert.strictEqual(w.posted.length, 1);
  for (const t of [r.title, r.message, w.told[0].title, w.told[0].body]) assert.doesNotMatch(t, /[–—]/);
});

test('once only: a second request files nothing, and status says requested', async () => {
  const w = world();
  await handle('access.beta', GOOD, w.io());
  const again = await handle('access.beta', {...GOOD, note: 'again'}, w.io());
  assert.deepStrictEqual(again, {invited: false, requested: true, already: true});
  assert.strictEqual(w.issues.length, 1);
  assert.strictEqual(w.told.length, 1);
  assert.deepStrictEqual(await handle('access.betaStatus', {}, w.io()), {invited: false, requested: true});
});

test('name and email are required and checked; the note is optional and capped', async () => {
  const w = world();
  await assert.rejects(handle('access.beta', {email: GOOD.email}, w.io()), /Your name is empty/);
  await assert.rejects(handle('access.beta', {name: GOOD.name}, w.io()), /Your email is empty/);
  await assert.rejects(handle('access.beta', {...GOOD, name: {toString: () => 'x'}}, w.io()), /must be text/);
  await assert.rejects(handle('access.beta', {...GOOD, note: 'x'.repeat(501)}, w.io()), /too long/);
  await assert.rejects(handle('access.beta', {...GOOD, name: 'x'.repeat(81)}, w.io()), /too long/);
  await assert.rejects(handle('access.beta', GOOD, w.io({me: null})), /profile is not ready/);
  // Accents, apostrophes, periods and hyphens are names.
  await handle('access.beta', {name: "Zoë O'Brien-Núñez Jr.", email: GOOD.email}, w.io());
  assert.strictEqual(w.issues.length, 1);
});

test('injection: markup, links, Slack pings and fake emails are refused', async () => {
  const w = world();
  const names = ['<img src=x onerror=alert(1)>', '[Grant access](https://evil.example)', '<!channel>', 'Amy *admin*',
    'https://evil.example', 'Bob\u202Eevil', '=HYPERLINK("x")', '`code`'];
  for (const name of names) await assert.rejects(handle('access.beta', {...GOOD, name}, w.io()), /name/i, name);
  const emails = ['a@b', 'a b@example.org', '<a@example.org>', 'a@example.org\nBcc: x@example.org', 'a@example.org, b@example.org',
    'javascript:alert(1)@example.org', '[x](https://evil.example)@example.org', 'x@-bad.example', 'a@example..org'];
  for (const email of emails) await assert.rejects(handle('access.beta', {...GOOD, email}, w.io()), /email/i, email);
  assert.strictEqual(w.issues.length, 0);
  // Invisible control characters are taken out, not stored.
  await handle('access.beta', {...GOOD, name: 'Ann\u0000a\u0007'}, w.io());
  assert.strictEqual(w.issues[0].title, 'Beta access request from Anna');
  // A line break in a name becomes a space: one line, always.
  const w2 = world();
  await handle('access.beta', {...GOOD, name: 'Anna\nAdmin'}, w2.io());
  assert.strictEqual(w2.issues[0].title, 'Beta access request from Anna Admin');
});

test('the bell draws no link, tag or emphasis from what a player typed', async () => {
  if (!marked) { assert.fail('marked not found in node_modules: cannot check the bell'); return; }
  const w = world();
  await handle('access.beta', {name: "Mary O'Neil-Smith", email: 'mary_o.neil+pyr@example.co.uk', note: '<script>alert(1)</script> [x](https://evil.example)\nwww.evil.example **loud** <!channel>'}, w.io());
  const html = marked.parse(w.told[0].body, {gfm: true, breaks: true, async: false});
  assert.doesNotMatch(html, /<a |<em>|<strong>|<script|<img|mailto:/i, html);
  assert.match(html, /Mary O&#39;Neil-Smith asks to join/, html);
  assert.match(html, /mary_o\.neil\+pyr@example\.co\.uk/, html);
  // The note shows in the bell as the words typed, never as markup.
  assert.match(html, /Their note:/, html);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, html);
  assert.match(w.issues[0].message, /<script>alert\(1\)<\/script>/);
});

test('a failed bell or Slack post still keeps the request', async () => {
  const w = world();
  const out = await handle('access.beta', GOOD, w.io({notifyAdmins: async () => { throw new Error('down'); }, postIssue: async () => { throw new Error('down'); }}));
  assert.strictEqual(out.requested, true);
  assert.strictEqual(w.issues.length, 1);
});
