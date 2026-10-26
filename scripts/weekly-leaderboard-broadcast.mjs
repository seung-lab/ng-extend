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
 * Runs via GitHub Actions cron (Monday just after midnight US Eastern,
 * after the weekly-winners snapshot) or manually:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/weekly-leaderboard-broadcast.mjs
 */

import { weekRange, topCompleters, topEditors } from './weekly-completions.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY = process.env.DRY_RUN === '1';

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
/** The most recently completed Monday to Sunday week on US Eastern time
 *  (weekly-completions.mjs weekRange), with its label. It was UTC. */
function lastCompletedWeek() {
  const w = weekRange();
  const [y, m, d] = w.weekStart.split('-').map(Number);
  const fmt = (dd) => new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sunYear = new Date(Date.UTC(y, m - 1, d + 6)).getUTCFullYear();
  // "Sep 21 to Sep 27, 2026". No en dash: Amy's copy rules forbid em and en
  // dashes anywhere user facing, and the detail view parses this label.
  return { ...w, label: `${fmt(d)} to ${fmt(d + 6)}, ${sunYear}` };
}

// ── Aggregations ────────────────────────────────────────────────────
// Top editors and completers: scripts/weekly-completions.mjs, shared with
// the saved podium.

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
    topEditors(supabaseGet, week.startISO, week.endISO, 20),
    topCompleters(supabaseGet, week.startISO, week.endISO, 20),
  ]);

  if (editorsRaw.length === 0 && completersRaw.length === 0) {
    console.log('[broadcast] No activity this week, skipping notification.');
    return;
  }

  const allIds = [...new Set([...editorsRaw, ...completersRaw].map(r => r.user_id))];
  const names = await resolveNames(allIds);

  const body = [
    `🎉 **Big Congratulations! Thanks for contributing to neuroscience!**`,
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

  // One broadcast per week. A second run never pings everyone again: it
  // leaves the saved one alone, or with UPDATE_BROADCAST=1 corrects its text
  // in place (same notification, no new bell).
  // Found by when it was sent, not by its exact title: the wording of the
  // title has changed before (an older copy used dashes).
  const sentBefore = new Date(Date.parse(week.endISO) + 7 * 86400000).toISOString();
  const existing = await supabaseGet(`notifications?select=id,title,body&target_type=eq.all&title=ilike.*Weekly%20Champions*` +
    `&send_at=gte.${encodeURIComponent(week.endISO)}&send_at=lt.${encodeURIComponent(sentBefore)}&order=send_at.desc&limit=1`);
  if (existing.length) {
    if (process.env.UPDATE_BROADCAST !== '1') { console.log(`[broadcast] ${notification.title} is already posted, leaving it.`); return; }
    if (existing[0].body === body && existing[0].title === notification.title) { console.log('[broadcast] Saved broadcast already matches, nothing to correct.'); return; }
    if (DRY) { console.log(`[broadcast] DRY RUN, would correct the saved broadcast "${existing[0].title}" (${existing[0].id}) to "${notification.title}":\n` + body); return; }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${existing[0].id}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ body, title: notification.title }),
    });
    if (!res.ok) throw new Error(`PATCH notifications: ${res.status} ${await res.text()}`);
    console.log(`[broadcast] Corrected the saved broadcast for ${week.label}`);
    return;
  }
  if (DRY) { console.log('[broadcast] DRY RUN, would post:\n' + body); return; }
  await supabasePost('notifications', notification);
  console.log(`[broadcast] Posted weekly champions notification for ${week.label}`);
  console.log(`  ${editorsRaw.length} top editors, ${completersRaw.length} top completers`);
}

main().catch(err => {
  console.error('[broadcast] Fatal:', err.message);
  process.exit(1);
});
