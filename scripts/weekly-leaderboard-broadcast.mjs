#!/usr/bin/env node
/**
 * weekly-leaderboard-broadcast.mjs
 * Posts a single celebratory notification to the whole community
 * showing the past week's top 10 editors AND top 10 completers
 * (across all datasets).
 *
 * Targets `notifications.target_type = 'all'` — surfaces in every
 * user's notification feed and (optionally) chat.
 *
 * Runs via GitHub Actions cron (Monday 00:10 UTC, 5 min after the
 * weekly-winners snapshot) or manually:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/weekly-leaderboard-broadcast.mjs
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
};

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(path, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
}

// ── Week range ──────────────────────────────────────────────────────
/** Returns [mondayStartISO, mondayStartLabel, sundayEndLabel] for the
 *  most recently completed Monday→Sunday week. */
function lastCompletedWeek() {
  const now = new Date();
  // Most recent Monday at 00:00 UTC
  const dow = now.getUTCDay() || 7; // Sun → 7
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)));
  const lastMonday = new Date(thisMonday); lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setUTCDate(thisMonday.getUTCDate() - 1);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return {
    startISO: lastMonday.toISOString(),
    endISO: thisMonday.toISOString(),
    label: `${fmt(lastMonday)} – ${fmt(lastSunday)}, ${lastSunday.getUTCFullYear()}`,
  };
}

// ── Aggregations ────────────────────────────────────────────────────
/** Top N editors by split+merge count from edit_log. */
async function topEditors(startISO, endISO, n = 10) {
  // edit_log can be large — stream by user, group client-side. For a
  // typical week this is small enough to pull in one or two pages.
  // Filter to split/merge so it matches the leaderboard view.
  const rows = await supabaseGet(
    `edit_log?select=user_id,operation` +
    `&timestamp=gte.${encodeURIComponent(startISO)}` +
    `&timestamp=lt.${encodeURIComponent(endISO)}` +
    `&operation=in.(split,merge)` +
    `&limit=200000`,
  );
  const counts = new Map();
  for (const r of rows) {
    if (!r.user_id) continue;
    counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([user_id, count]) => ({ user_id, count }));
}

/** Top N completers by cave_completions_mirror count, joined to users
 *  on cave_user_id. */
async function topCompleters(startISO, endISO, n = 10) {
  const rows = await supabaseGet(
    `cave_completions_mirror?select=cave_user_id` +
    `&completed_at=gte.${encodeURIComponent(startISO)}` +
    `&completed_at=lt.${encodeURIComponent(endISO)}` +
    `&limit=200000`,
  );
  const caveCounts = new Map();
  for (const r of rows) {
    if (r.cave_user_id == null) continue;
    caveCounts.set(r.cave_user_id, (caveCounts.get(r.cave_user_id) ?? 0) + 1);
  }
  if (caveCounts.size === 0) return [];
  // Resolve cave_user_id → users.id
  const caveIds = [...caveCounts.keys()].join(',');
  const users = await supabaseGet(`users?select=id,cave_user_id&cave_user_id=in.(${caveIds})`);
  const byCave = new Map(users.map(u => [u.cave_user_id, u.id]));
  const out = [];
  for (const [caveId, count] of caveCounts) {
    const userId = byCave.get(caveId);
    if (userId) out.push({ user_id: userId, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, n);
}

/** Resolve user_ids to display names. */
async function resolveNames(userIds) {
  if (userIds.length === 0) return new Map();
  const list = userIds.join(',');
  const users = await supabaseGet(`users?select=id,display_name&id=in.(${list})`);
  return new Map(users.map(u => [u.id, u.display_name || 'Anonymous']));
}

// ── Body composer ───────────────────────────────────────────────────
const MEDALS = ['🥇', '🥈', '🥉'];

function rankLabel(idx) {
  return idx < 3 ? MEDALS[idx] : `${idx + 1}.`;
}

function formatList(rows, names, unitSingular, unitPlural) {
  if (rows.length === 0) return '_no activity this week_';
  return rows.map((r, i) => {
    const name = names.get(r.user_id) || 'Anonymous';
    const unit = r.count === 1 ? unitSingular : unitPlural;
    return `${rankLabel(i)}  **${name}** — ${r.count.toLocaleString()} ${unit}`;
  }).join('\n');
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const week = lastCompletedWeek();
  console.log(`[broadcast] Computing leaderboard for ${week.label} (${week.startISO} → ${week.endISO})`);

  const [editorsRaw, completersRaw] = await Promise.all([
    topEditors(week.startISO, week.endISO, 10),
    topCompleters(week.startISO, week.endISO, 10),
  ]);

  if (editorsRaw.length === 0 && completersRaw.length === 0) {
    console.log('[broadcast] No activity this week — skipping notification.');
    return;
  }

  const allIds = [...new Set([...editorsRaw, ...completersRaw].map(r => r.user_id))];
  const names = await resolveNames(allIds);

  const body = [
    `🎉 **Big congratulations to this week's champions!**`,
    ``,
    `**Top Editors**`,
    formatList(editorsRaw, names, 'edit', 'edits'),
    ``,
    `**Top Completers**`,
    formatList(completersRaw, names, 'cell', 'cells'),
    ``,
    `Across all datasets — every edit and every completion brings the connectome a little closer to done. Keep going! 🧬`,
  ].join('\n');

  const notification = {
    title: `🏆 Weekly Champions — ${week.label}`,
    body,
    target_type: 'all',
    target_id: null,
    send_at: new Date().toISOString(),
    // Intentionally NOT post_to_chat — chat is high-cadence; people
    // can open the bell icon for the full leaderboard breakdown.
    post_to_chat: false,
  };

  await supabasePost('notifications', notification);
  console.log(`[broadcast] Posted weekly champions notification for ${week.label}`);
  console.log(`  ${editorsRaw.length} top editors, ${completersRaw.length} top completers`);
}

main().catch(err => {
  console.error('[broadcast] Fatal:', err.message);
  process.exit(1);
});
