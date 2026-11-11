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
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
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
async function postToChat(title, notificationId) {
  const row = {
    // From Nurro (Ames 2026-11-07): "EyeWire II" read as "EyeWire I." once
    // chat shortened it like a person's name.
    name: 'Nurro',
    rank: 'bot',
    // The title, and the notification it is about: chat shows Nurro's line
    // with an Open button that opens it (Ames 2026-11-08: "this is supposed
    // to be a link to open the Today in Pyr report").
    text: title,
    notification_id: notificationId,
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

/**
 * Monthly Champions get their moment (Ames 2026-11-01): Nurro congratulates the
 * Top Editors, then gold, silver and bronze each get an achievement line (their
 * name and the award's art, as any award does in chat), then the same for the
 * Top Contributors. False when the month has no awards: the plain line goes.
 */
const PLACES = ['gold', 'silver', 'bronze'];
const rest = async (path) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`read ${res.status}: ${await res.text()}`);
  return res.json();
};
const insertChat = async (row) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`chat insert ${res.status}: ${await res.text()}`);
};
async function postMonthlyChampions(n) {
  // Sent on the 1st, about the month before it.
  const m = new Date(Date.parse(n.send_at) - 24 * 3600 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(m).map(p => [p.type, p.value]));
  const key = `month-${parts.year}-${parts.month}`;
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long' }).format(m);
  const badges = await rest(`special_badges?slug=like.${key}-*&select=id,slug,name`);
  if (!badges.length) return false;
  const awards = await rest(`special_badge_awards?badge_id=in.(${badges.map(b => b.id).join(',')})&select=badge_id,user_id`);
  if (!awards.length) return false;
  const ids = [...new Set(awards.map(a => a.user_id))];
  const users = new Map((await rest(`users?id=in.(${ids.join(',')})&select=id,username,display_name`)).map(u => [u.id, u]));
  const sections = [
    { metric: 'edits', intro: `Congratulations to ${monthName}'s Top Editors! 🎉` },
    { metric: 'cells', intro: `And to ${monthName}'s Top Contributors, who completed the most cells! 🧠` },
  ];
  for (const { metric, intro } of sections) {
    const lines = PLACES.flatMap(place => {
      const badge = badges.find(b => b.slug === `${key}-${metric}-${place}`);
      return badge ? awards.filter(a => a.badge_id === badge.id).map(a => ({ badge, user: users.get(a.user_id) })) : [];
    }).filter(l => l.user);
    if (!lines.length) continue;
    if (dryRun) { console.log(`[chat-announce] DRY-RUN Nurro: ${intro}`); }
    else if (!(await rest(`chat_messages?name=eq.Nurro&text=eq.${encodeURIComponent(intro)}&select=id&limit=1`)).length) {
      await insertChat({ name: 'Nurro', rank: 'bot', text: intro });
      await new Promise(r => setTimeout(r, 1500));
    }
    for (const { badge, user } of lines) {
      const text = `earned the ${badge.name} award`, line = `achievement:special:${badge.id}`;
      if (dryRun) { console.log(`[chat-announce] DRY-RUN ${user.username || user.display_name} ${text}`); continue; }
      // Once each, as functions/index.js chat.achievement does.
      if ((await rest(`chat_messages?user_id=eq.${user.id}&dataset=eq.${encodeURIComponent(line)}&select=id&limit=1`)).length) continue;
      await insertChat({ user_id: user.id, name: user.username || user.display_name || 'Player', rank: 'achievement', text, dataset: line });
      // One at a time, so they read in order and land like a roll call.
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return true;
}

(async () => {
  const due = await fetchDue();
  if (!due.length) { console.log('[chat-announce] nothing due'); return; }
  console.log(`[chat-announce] ${due.length} due`);
  let posted = 0, failed = 0;
  for (const n of due) {
    try {
      const champions = /^🏆 Monthly Champions,/.test(n.title) && await postMonthlyChampions(n);
      if (dryRun) {
        if (!champions) console.log(`[chat-announce] DRY-RUN would post: "${n.title}" (sent ${n.send_at})`);
        posted++;
        continue;
      }
      if (!champions) await postToChat(n.title, n.id);
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
