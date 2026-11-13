// Asking a Beta requester for their EyeWire name (Ames 2026-11-12).
const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('./access-request');

function io(extra = {}) {
  const sent = [], store = {};
  return {
    sent, store,
    io: { isAdmin: true, who: { email: 'admin@x.org' }, sb: async () => [],
      sendEmail: async (m) => { sent.push(m); return { ok: true, id: 'r1' }; },
      askSent: { get: async e => store[e] || null, set: async (e, v) => { store[e] = v; }, all: async () => store },
      ...extra },
  };
}

test('the draft greets them by first name and is signed by the team', async () => {
  const { io: o } = io();
  const d = await handle('access.askDraft', { email: 'a@x.org', name: 'Robert Nieves' }, o);
  assert.match(d.text, /^Hi Robert,/);
  assert.match(d.text, /existing EyeWire players first/);
  assert.match(d.text, /EyeWire username/);
  assert.match(d.text, /Amy Sterling and the Pyr Team at Princeton$/);
  assert.doesNotMatch(d.text, /Ames|—|–/);
});

test('a username with no play asks them to check it', async () => {
  const { io: o } = io();
  const d = await handle('access.askDraft', { email: 'n@x.org', name: 'nakul', ewName: 'nakul' }, o);
  assert.match(d.text, /couldn't find any EyeWire play under the username "nakul"/);
  assert.match(d.text, /how you found Pyr/);
});

test('sends the edited email once, from Amy at Pyr, replies to support', async () => {
  const t = io();
  const r = await handle('access.askEmail', { email: 'A@X.org', name: 'Rob', subject: 'Hello', text: 'Edited.' }, t.io);
  assert.strictEqual(r.sent, true);
  assert.strictEqual(t.sent.length, 1);
  assert.deepStrictEqual(t.sent[0].to, ['a@x.org']);
  assert.strictEqual(t.sent[0].from, 'Amy at Pyr <welcome@connectome.quest>');
  assert.strictEqual(t.sent[0].reply_to, 'support@eyewire.org');
  assert.strictEqual(t.sent[0].subject, 'Hello');
  assert.strictEqual(t.sent[0].text, 'Edited.');
  assert.ok(t.store['a@x.org'].at);
  const again = await handle('access.askEmail', { email: 'a@x.org', name: 'Rob' }, t.io);
  assert.strictEqual(again.sent, false);
  assert.strictEqual(t.sent.length, 1);
  const forced = await handle('access.askEmail', { email: 'a@x.org', name: 'Rob', again: true }, t.io);
  assert.strictEqual(forced.sent, true);
  assert.match(t.sent[1].text, /^Hi Rob,/);
  assert.deepStrictEqual(Object.keys(await handle('access.askSent', {}, t.io)), ['a@x.org']);
});

test('counts each email we invited once', async () => {
  const t = io({ sb: async (q) => (q.startsWith('access_invites') ? [{ email: 'a@x.org' }, { email: 'b@x.org' }, { email: 'a@x.org' }]
    : q.startsWith('users') ? [{ id: 'u1', middleauth_email: 'a@x.org' }, { id: 'u2', middleauth_email: 'Boss@X.org' }, { id: 'u3', middleauth_email: 'c@x.org' }]
    : q.startsWith('admins') ? [{ user_id: null, email: 'boss@x.org' }, { user_id: 'u3', email: null }] : []) });
  assert.deepStrictEqual(await handle('access.inviteCount', {}, t.io), { invited: 2, signedIn: 1 });
  await assert.rejects(handle('access.inviteCount', {}, io({ isAdmin: false }).io));
});

test('admins only, and no empty email', async () => {
  const t = io({ isAdmin: false });
  await assert.rejects(handle('access.askEmail', { email: 'a@x.org' }, t.io));
  await assert.rejects(handle('access.askDraft', { email: 'a@x.org' }, t.io));
  const u = io();
  await assert.rejects(handle('access.askEmail', { email: 'a@x.org', text: '  ' }, u.io), /empty/);
  assert.strictEqual(u.sent.length, 0);
});

test('access.setEwName: admins save a typed EyeWire username, lowercased, for that email', async () => {
  const seen = [];
  const t = io({ sb: async (q, init) => { seen.push({ q, body: init && init.body }); return []; } });
  assert.deepStrictEqual(await handle('access.setEwName', { email: 'Ann@X.org', ewName: ' KMierow ' }, t.io), { ewName: 'kmierow' });
  const row = JSON.parse(seen[0].body);
  assert.ok(seen[0].q.startsWith('access_ew_names?on_conflict=email'));
  assert.strictEqual(row.email, 'ann@x.org'); assert.strictEqual(row.ew_name, 'kmierow');
  await assert.rejects(handle('access.setEwName', { email: 'ann@x.org', ewName: 'bad<name>' }, t.io));
  await assert.rejects(handle('access.setEwName', { email: 'ann@x.org', ewName: 'k' }, io({ isAdmin: false }).io));
});

test('access.readHandledBetaBells: a Beta request bell is read for every admin once the request is dealt with', async () => {
  const A1 = '11111111-1111-1111-1111-111111111111', A2 = '22222222-2222-2222-2222-222222222222';
  const esc = s => s.replace(/[\\`*_{}\[\]()#+\-.!|<>~&:@]/g, c => '\\' + c);
  const bell = (id, target, email) => ({ id, target_id: target, body: `X asks to join the Pyr beta.\n\nEmail they gave: ${esc(email)}\n\nClick this note.` });
  const bells = [bell(1, A1, 'in@x.org'), bell(2, A2, 'in@x.org'), bell(3, A1, 'later@x.org'), bell(4, A1, 'asked@x.org'),
    bell(5, A1, 'waiting@x.org'), bell(6, A1, 'old@x.org'), bell(7, A1, 'Linked@x.org')];
  const posted = [];
  const t = io({
    me: { id: A1 },
    marks: { all: async () => ({ 'later@x.org': { mark: 'listed', at: 'x' }, 'waiting@x.org': null }) },
    sb: async (q, init) => {
      if (q.startsWith('notifications?')) return bells;
      if (q.startsWith('notification_reads?notification_id')) return [{ notification_id: 6, user_id: A1 }];
      if (q.startsWith('pilot_members')) return [{ email: 'in@x.org' }, { email: 'main@x.org' }];
      if (q.startsWith('access_email_links')) return [{ email: 'linked@x.org', linked_to: 'main@x.org' }];
      if (q.startsWith('notification_reads?on_conflict')) { posted.push(...JSON.parse(init.body)); return []; }
      return [];
    },
  });
  t.store['asked@x.org'] = { at: 'x' };
  const r = await handle('access.readHandledBetaBells', {}, t.io);
  assert.deepStrictEqual(posted.map(p => p.notification_id).sort(), [1, 2, 3, 4, 7]);
  assert.strictEqual(posted.find(p => p.notification_id === 2).user_id, A2);
  assert.deepStrictEqual(r, { marked: 5, ids: [1, 3, 4, 7] });
  await assert.rejects(handle('access.readHandledBetaBells', {}, io({ isAdmin: false }).io));
});
