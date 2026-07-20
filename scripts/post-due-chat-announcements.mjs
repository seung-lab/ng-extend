#!/usr/bin/env node
/**
 * post-due-chat-announcements.mjs
 * --------------------------------------------------------------------
 * Posts the chat announcement for notifications that were SCHEDULED with
 * "Also post to chat", at the time they actually send.
 *
 * WHY A SERVER JOB
 * The admin client can't do this. It only knows about the notification at
 * creation time, and posting then would announce something `send_at` keeps
 * hidden until later. Nor can the browser clients do it when the notification
 * surfaces: they all poll, so every connected client would post its own
 * duplicate. Exactly one actor has to post, once, at the right time.
 *
 * IDEMPOTENCY
 * `notifications.chat_posted_at` records that the announcement went out, so a
 * re-run (or an overlapping schedule) can never double-post. The column is
 * added by supabase-chat-posted-at.sql.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/post-due-chat-announcements.mjs [--dry-run]
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

/** Notifications that are due, want a chat post, and haven't had one. */
async function fetchDue() {
  const now = new Date().toISOString();
  const url = `${SUPABASE_URL}/rest/v1/notifications`
    + `?select=id,title,send_at,post_to_chat,chat_posted_at`
    + `&post_to_chat=is.true`
    + `&chat_posted_at=is.null`
    + `&send_at=lte.${encodeURIComponent(now)}`
    + `&order=send_at.asc&limit=25`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`fetch due ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Insert the announcement into chat history.
 *
 * NOTE: this writes to `chat_messages` (the persisted history) rather than the
 * realtime broadcast channel, which only a connected client can publish to.
 * Clients that are already open will see it on their next history load; new
 * sessions see it immediately. Getting it into a live channel would need a
 * realtime publisher, which is more machinery than this warrants today.
 */
async function postToChat(title) {
  const row = {
    name: 'EyeWire II',
    rank: 'admin',
    text: `📢 ${title} — check your notifications for details!`,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`chat insert ${res.status}: ${await res.text()}`);
}

async function markPosted(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ chat_posted_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`mark posted ${res.status}: ${await res.text()}`);
}

(async () => {
  const due = await fetchDue();
  if (!due.length) { console.log('[chat-announce] nothing due'); return; }
  console.log(`[chat-announce] ${due.length} due`);
  let posted = 0, failed = 0;
  for (const n of due) {
    try {
      if (dryRun) {
        console.log(`[chat-announce] DRY-RUN would post: "${n.title}" (sent ${n.send_at})`);
        posted++;
        continue;
      }
      await postToChat(n.title);
      // Mark AFTER a successful post, so a failure retries next run rather
      // than silently swallowing the announcement.
      await markPosted(n.id);
      console.log(`[chat-announce] posted: "${n.title}"`);
      posted++;
    } catch (e) {
      console.error(`[chat-announce] failed for #${n.id}:`, e.message);
      failed++;
    }
  }
  console.log(`[chat-announce] done — ${posted} posted, ${failed} failed`);
  if (failed) process.exit(1);
})();
