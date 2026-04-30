#!/usr/bin/env node
/**
 * weekly-recap.mjs
 * "Your Week in Science" — sends a personalized notification to every user
 * who had activity in the past 7 days.
 *
 * Runs via GitHub Actions cron (Saturday 11pm UTC) or manually:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/weekly-recap.mjs
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function supabaseGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
}

// ── Week range label ──────────────────────────────────────────────────────────
function weekRangeLabel() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7)); // Monday
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(mon)} – ${fmt(sun)}, ${sun.getFullYear()}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Get active users from edit_log in the past 7 days
  //    Aggregate: count by operation per user
  const editLogs = await supabaseGet(
    'edit_log',
    `select=user_id,operation&timestamp=gte.${sevenDaysAgo}`
  );

  if (!editLogs.length) {
    console.log('No activity this week — no notifications to send.');
    return;
  }

  // Aggregate per user
  const userStats = {};
  for (const log of editLogs) {
    const uid = log.user_id;
    if (!uid) continue;
    if (!userStats[uid]) userStats[uid] = { merges: 0, splits: 0, total: 0 };
    userStats[uid].total++;
    if (log.operation === 'merge') userStats[uid].merges++;
    if (log.operation === 'split') userStats[uid].splits++;
  }

  const userIds = Object.keys(userStats);
  console.log(`Found ${userIds.length} active user(s) this week.`);

  // 2. Get user info (streak, display_name)
  const users = await supabaseGet(
    'users',
    `select=id,display_name,current_streak&id=in.(${userIds.join(',')})`
  );
  const userMap = {};
  for (const u of users) userMap[u.id] = u;

  // 3. Community total
  const communityTotal = editLogs.length;

  // 4. Build and insert notifications
  const weekLabel = weekRangeLabel();
  const notifications = [];

  for (const [userId, s] of Object.entries(userStats)) {
    const user = userMap[userId];
    const name = user?.display_name || 'Scientist';
    const streak = user?.current_streak || 0;
    const pct = ((s.total / communityTotal) * 100).toFixed(1);

    const parts = [];
    if (s.merges > 0) parts.push(`${s.merges} merge${s.merges > 1 ? 's' : ''}`);
    if (s.splits > 0) parts.push(`${s.splits} cut${s.splits > 1 ? 's' : ''}`);
    const breakdown = parts.length ? ` (${parts.join(', ')})` : '';

    let body = `You made **${s.total} edit${s.total > 1 ? 's' : ''}** this week${breakdown}!`;
    if (streak > 0) body += ` Current streak: **${streak} day${streak > 1 ? 's' : ''}** 🔥`;
    if (communityTotal > s.total) body += `\nYou contributed ${pct}% of community edits this week.`;
    body += `\nKeep mapping the brain — every edit counts! 🧬`;

    notifications.push({
      title: `✨ Your Week in Science — ${weekLabel}`,
      body,
      target_type: 'user',
      target_id: userId,
      send_at: new Date().toISOString(),
      post_to_chat: false,
    });
  }

  // Insert in batches of 50
  for (let i = 0; i < notifications.length; i += 50) {
    const batch = notifications.slice(i, i + 50);
    await supabasePost('notifications', batch);
    console.log(`Inserted notifications ${i + 1}–${i + batch.length}`);
  }

  console.log(`Done! Sent ${notifications.length} weekly recap notification(s).`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
