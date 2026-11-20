// Email over a sending limit waits and goes out by itself (Ames 2026-11-19:
// "make every email queue up and send itself the next day when it hits a
// limit, so nothing gets lost").
//
// Resend answers 429 when we are over its daily or monthly quota, or sending
// too fast. Any other answer is final. On a 429 the whole message is kept in
// Firestore (email_queue) and the caller is told it is queued, which counts as
// sent: the person is marked emailed, so nobody presses the button twice.
// ewEmailQueue (index.js) runs every hour: it sends the oldest first and stops
// at the first 429, so the queue drains as soon as the limit lifts. Each
// queued email carries its own Idempotency-Key, so a run that dies between
// sending and marking cannot send it twice.
//
// Nothing here talks to the network itself: index.js passes in post() and the
// store, so the tests can too.
//   post(msg, key?)  -> {ok, status, id?, error?}
//   store.add(row) -> id   store.waiting() -> [{id, ...row}]   store.update(id, v)

const MAX_TRIES = 5;          // a message Resend keeps refusing (not 429) stops here
const PER_RUN = 90;           // the free plan's day is 100; a run never needs more
const GAP_MS = 600;           // Resend takes 2 a second

async function sendOrQueue(msg, io) {
  const r = await io.post(msg);
  if (r.status !== 429) return r;
  const id = await io.store.add({ msg, state: 'queued', at: new Date().toISOString(), tries: 0, error: r.error || 'over the sending limit' });
  console.log('[email queue] queued', id);
  return { ok: true, id: '', queued: true };
}

async function drain(io) {
  const rows = (await io.store.waiting()).sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(0, PER_RUN);
  const out = { sent: 0, failed: 0, waiting: rows.length, stopped: false };
  for (const row of rows) {
    const r = await io.post(row.msg, `pyr-queue-${row.id}`);
    if (r.status === 429) { out.stopped = true; break; }
    out.waiting--;
    if (r.ok) {
      await io.store.update(row.id, { state: 'sent', sentAt: new Date().toISOString(), resendId: r.id || '' });
      out.sent++;
    } else {
      const tries = (row.tries || 0) + 1;
      await io.store.update(row.id, { tries, error: String(r.error || r.status).slice(0, 300), ...(tries >= MAX_TRIES ? { state: 'failed' } : {}) });
      if (tries >= MAX_TRIES) out.failed++;
    }
    if (io.wait) await io.wait(GAP_MS);
  }
  return out;
}

module.exports = { sendOrQueue, drain, MAX_TRIES, PER_RUN };
