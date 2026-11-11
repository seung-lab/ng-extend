'use strict';
// One person, two emails, joined by hand on the Access page (Ames 2026-11-10).
// Run: cd functions && node --test access-links.test.js
const test = require('node:test');
const assert = require('node:assert');
const {handle} = require('./access-request');

function io(isAdmin) {
  const calls = [];
  const sb = async (p, init = {}) => { calls.push({p, init}); return []; };
  return {calls, io: {sb, isAdmin, who: {email: 'amy@example.org'}}};
}

test('admins link an email into another, lowercased, as an upsert', async () => {
  const w = io(true);
  assert.deepStrictEqual(await handle('access.linkEmails', {email: 'Dom@Hotmail.co.uk', to: 'dom358@gmail.com'}, w.io), {linked: true});
  assert.strictEqual(w.calls.length, 1);
  assert.strictEqual(w.calls[0].p, 'access_email_links?on_conflict=email');
  assert.strictEqual(w.calls[0].init.method, 'POST');
  assert.match(w.calls[0].init.headers.Prefer, /merge-duplicates/);
  const row = JSON.parse(w.calls[0].init.body);
  assert.strictEqual(row.email, 'dom@hotmail.co.uk');
  assert.strictEqual(row.linked_to, 'dom358@gmail.com');
  assert.match(row.note, /amy@example\.org/);
});

test('players cannot link, and bad or equal emails are refused', async () => {
  const w = io(false);
  await assert.rejects(handle('access.linkEmails', {email: 'a@b.org', to: 'c@d.org'}, w.io), /Admins only/);
  const a = io(true);
  await assert.rejects(handle('access.linkEmails', {email: 'a@b.org', to: 'A@B.org'}, a.io), /same email/);
  await assert.rejects(handle('access.linkEmails', {email: 'not an email', to: 'c@d.org'}, a.io), /does not look right/);
  await assert.rejects(handle('access.linkEmails', {email: 'a@b.org', to: "c@d.org'),x"}, a.io));
  assert.strictEqual(a.calls.length, 0);
});
