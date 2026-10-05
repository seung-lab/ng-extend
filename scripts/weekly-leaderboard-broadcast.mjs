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
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
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
    // "Sep 21 to Sep 27, 2026". No en dash: Amy's copy rules forbid em and en
    // dashes anywhere user facing, and the detail view parses this label.
    label: `${fmt(lastMonday)} to ${fmt(lastSunday)}, ${lastSunday.getUTCFullYear()}`,
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

/** Top N completers, counted from the app's own log (edit_log) exactly as
 *  the leaderboard view does (supabase-leaderboard-completions-from-log.sql):
 *  the CAVE mirror lagged up to two days and never saw MEC. One cell = one
 *  distinct root id per player; a row with no id counts only when no
 *  id-carrying completion by that player sits within two minutes of it. */
async function topCompleters(startISO, endISO, n = 10) {
  const rows = await supabaseGet(
    `edit_log?select=user_id,operation,timestamp,metadata,success` +
    `&timestamp=gte.${encodeURIComponent(startISO)}` +
    `&timestamp=lt.${encodeURIComponent(endISO)}` +
    `&operation=in.(complete_task,mark_complete,unmark_complete)` +
    `&limit=200000`,
  );
  const idOf = r => r.metadata?.final_segment_id ?? r.metadata?.root_id ?? r.metadata?.segment_id ?? null;
  const good = rows.filter(r => r.user_id && r.success !== false);
  // A cell marked and then un-marked does not count; marked again after, it does.
  const lastUnmark = new Map();                  // user_id|cell -> newest un-mark time
  for (const r of good) {
    if (r.operation !== 'unmark_complete' || r.metadata?.root_id == null) continue;
    const k = r.user_id + '|' + r.metadata.root_id, t = Date.parse(r.timestamp);
    if (!(lastUnmark.get(k) >= t)) lastUnmark.set(k, t);
  }
  const ok = good.filter(r => r.operation !== 'unmark_complete');
  const cells = new Map();                       // user_id -> Set of cell keys
  for (const r of ok) {
    let cell = idOf(r);
    if (cell == null) {
      const t = Date.parse(r.timestamp);
      const paired = ok.some(d => d.user_id === r.user_id && idOf(d) != null &&
        Math.abs(Date.parse(d.timestamp) - t) <= 120_000);
      if (paired) continue;
      cell = 'at:' + new Date(t).toISOString().slice(0, 16);
    }
    if (lastUnmark.get(r.user_id + '|' + cell) >= Date.parse(r.timestamp)) continue;
    if (!cells.has(r.user_id)) cells.set(r.user_id, new Set());
    cells.get(r.user_id).add(String(cell));
  }
  return [...cells.entries()]
    .map(([user_id, set]) => ({ user_id, count: set.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
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
    // "🥇  **Name**, 19 edits". NotificationFeedPanel.vue parses this line
    // shape into the champions podium, so keep it in step with that parser.
    return `${rankLabel(i)}  **${name}**, ${r.count.toLocaleString()} ${unit}`;
  }).join('\n');
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const week = lastCompletedWeek();
  console.log(`[broadcast] Computing leaderboard for ${week.label} (${week.startISO} → ${week.endISO})`);

  const [editorsRaw, completersRaw] = await Promise.all([
    // The top twenty of each: the podium takes three, the rest scroll.
    topEditors(week.startISO, week.endISO, 20),
    topCompleters(week.startISO, week.endISO, 20),
  ]);

  if (editorsRaw.length === 0 && completersRaw.length === 0) {
    console.log('[broadcast] No activity this week, skipping notification.');
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
    `Across all datasets, every edit and every completion brings the connectome a little closer to done. Keep going! 🧬`,
  ].join('\n');

  const notification = {
    title: `🏆 Weekly Champions, ${week.label}`,
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
