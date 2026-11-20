const test = require('node:test');
const assert = require('node:assert');
const eq = require('./email-queue');

/** A pretend Resend that says 429 while `full` is true, and a pretend store. */
function io() {
  const rows = {}, sent = [];
  let n = 0;
  const x = {
    full: false, rows, sent, keys: [],
    post: async (msg, key) => {
      x.keys.push(key);
      if (x.full) return { ok: false, status: 429, error: 'daily_quota_exceeded' };
      if (msg.bad) return { ok: false, status: 422, error: 'invalid' };
      sent.push(msg.to[0]);
      return { ok: true, status: 200, id: `r${sent.length}` };
    },
    store: {
      add: async (row) => { const id = `q${++n}`; rows[id] = { ...row }; return id; },
      waiting: async () => Object.entries(rows).filter(([, r]) => r.state === 'queued').map(([id, r]) => ({ id, ...r })),
      update: async (id, v) => { rows[id] = { ...rows[id], ...v }; },
    },
  };
  return x;
}
const msg = (to, at) => ({ from: 'Pyr <welcome@connectome.quest>', to: [to], subject: 'Hi', text: 'Hi', ...(at ? {} : {}) });

test('under the limit: sent at once, nothing queued', async () => {
  const x = io();
  const r = await eq.sendOrQueue(msg('a@x.org'), x);
  assert.strictEqual(r.ok, true);
  assert.ok(!r.queued);
  assert.deepStrictEqual(x.sent, ['a@x.org']);
  assert.strictEqual(Object.keys(x.rows).length, 0);
});

test('over the limit: queued, told ok, and nothing lost', async () => {
  const x = io();
  x.full = true;
  const r = await eq.sendOrQueue(msg('a@x.org'), x);
  assert.deepStrictEqual(r, { ok: true, id: '', queued: true });
  assert.strictEqual(Object.values(x.rows)[0].state, 'queued');
  assert.deepStrictEqual(Object.values(x.rows)[0].msg.to, ['a@x.org']);
});

test('a real refusal (not 429) is not queued: the caller sees it', async () => {
  const x = io();
  const r = await eq.sendOrQueue({ ...msg('a@x.org'), bad: true }, x);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(Object.keys(x.rows).length, 0);
});

test('drain: waits while still full, then sends oldest first once the limit lifts, each once', async () => {
  const x = io();
  x.full = true;
  await eq.sendOrQueue(msg('first@x.org'), x);
  await eq.sendOrQueue(msg('second@x.org'), x);
  let out = await eq.drain(x);
  assert.strictEqual(out.stopped, true);
  assert.strictEqual(out.sent, 0);
  assert.strictEqual(Object.values(x.rows).filter((r) => r.state === 'queued').length, 2);
  x.full = false;
  x.keys.length = 0;
  out = await eq.drain(x);
  assert.deepStrictEqual(x.sent, ['first@x.org', 'second@x.org']);
  assert.strictEqual(out.sent, 2);
  assert.ok(x.keys.every((k) => /^pyr-queue-q\d+$/.test(k)), 'each send carries its own idempotency key');
  out = await eq.drain(x);
  assert.strictEqual(out.sent, 0, 'never twice');
  assert.deepStrictEqual(x.sent, ['first@x.org', 'second@x.org']);
});

test('drain: the limit hit part way stops the run and keeps the rest for later', async () => {
  const x = io();
  x.full = true;
  for (const e of ['a@x.org', 'b@x.org', 'c@x.org']) await eq.sendOrQueue(msg(e), x);
  x.full = false;
  const post = x.post;
  let left = 1;
  x.post = async (m, k) => (left-- > 0 ? post(m, k) : { ok: false, status: 429 });
  const out = await eq.drain(x);
  assert.deepStrictEqual(out, { sent: 1, failed: 0, waiting: 2, stopped: true });
  assert.strictEqual(Object.values(x.rows).filter((r) => r.state === 'queued').length, 2);
});

test('drain: a message Resend keeps refusing stops after MAX_TRIES', async () => {
  const x = io();
  x.full = true;
  await eq.sendOrQueue({ ...msg('a@x.org'), bad: true }, x);
  x.full = false;
  for (let i = 0; i < eq.MAX_TRIES + 2; i++) await eq.drain(x);
  const row = Object.values(x.rows)[0];
  assert.strictEqual(row.state, 'failed');
  assert.strictEqual(row.tries, eq.MAX_TRIES);
});
