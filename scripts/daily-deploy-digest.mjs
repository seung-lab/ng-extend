#!/usr/bin/env node
/**
 * daily-deploy-digest.mjs
 * Once a day, tell players what changed in Pyr that day: one notification to
 * everyone, listing the changelog entries that went live since the last digest.
 * On a day with no deploy it sends nothing.
 *
 * Source of truth is the LIVE site's changelog (static/changelog.json as
 * served), so an entry counts only once it is actually deployed; the CHANGELOG
 * RULE in README.md keeps those entries in player words.
 *
 * Runs from .github/workflows/daily-deploy-digest.yml every day at 23:00 UTC
 * (7 pm Eastern in summer, 6 pm in winter, like the weekly recap), or by hand:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/daily-deploy-digest.mjs [--dry-run]
 * --dry-run prints the notification instead of sending it (no Supabase needed).
 * POST_TO_CHAT=false keeps it out of chat (the chat-announcements job posts
 * one line when a notification has post_to_chat set).
 */

const LIVE_URL = process.env.PYR_LIVE_URL ||
    'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const postToChat = (process.env.POST_TO_CHAT ?? 'true') !== 'false';

// Every digest title starts with this, which is how the last one is found.
const DIGEST_TAG = 'Today in Pyr';
// Weatherman Nurro (Ames, 2026-10-10), served from the branch like the Week in Science art.
const ART_BASE = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/digest';
const THUMBNAIL_URL = `${ART_BASE}/weatherman-nurro-icon.png`;
const IMAGE_URL = `${ART_BASE}/weatherman-nurro.png`;
const DAY_MS = 24 * 60 * 60 * 1000;
// A digest never reaches back further than this, even if the job missed days.
const MAX_LOOKBACK_MS = 7 * DAY_MS;

if (!dryRun && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = SUPABASE_KEY ? {
  apikey: SUPABASE_KEY,
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
} : null;

async function supabaseGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
}

function easternDay(d) {
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
}

/** The live changelog, newest first, with `at` parsed. */
async function liveChangelog() {
  const res = await fetch(`${LIVE_URL}/changelog.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`changelog ${res.status}`);
  const { entries } = await res.json();
  return entries
      .map(e => ({ ...e, atMs: Date.parse(e.at) }))
      .filter(e => Number.isFinite(e.atMs));
}

/** When the last digest went out, or null if there has never been one. */
async function lastDigestSentAt() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const rows = await supabaseGet('notifications',
      `select=send_at&title=like.${encodeURIComponent(DIGEST_TAG + '*')}&order=send_at.desc&limit=1`);
  return rows[0]?.send_at ? Date.parse(rows[0].send_at) : null;
}

function buildBody(entries, sinceMs, nowMs) {
  const parts = [];
  if (nowMs - sinceMs > 30 * 60 * 60 * 1000) {
    parts.push(`Since the last update on ${easternDay(new Date(sinceMs))}:`);
  }
  for (const e of entries) {
    parts.push(`**${e.title}**\n` + e.items.map(i => `• ${i}`).join('\n'));
  }
  parts.push('The full list is behind the i button at the top of the game.');
  return parts.join('\n\n');
}

(async () => {
  const now = new Date();
  const nowMs = now.getTime();
  const last = await lastDigestSentAt();
  const sinceMs = Math.max(last ?? (nowMs - DAY_MS), nowMs - MAX_LOOKBACK_MS);
  console.log(`[digest] window ${new Date(sinceMs).toISOString()} to ${now.toISOString()}` +
      (last ? ' (since the last digest)' : ' (no earlier digest found: the last 24 hours)'));

  const entries = (await liveChangelog())
      .filter(e => e.atMs > sinceMs && e.atMs <= nowMs)
      .sort((a, b) => a.atMs - b.atMs);
  if (entries.length === 0) {
    console.log('[digest] nothing went live in the window; no notification today.');
    return;
  }

  const title = `${DIGEST_TAG}: ${easternDay(now)}`;
  const body = buildBody(entries, sinceMs, nowMs);
  const row = {
    title, body, target_type: 'all', send_at: now.toISOString(), post_to_chat: postToChat,
    thumbnail_url: THUMBNAIL_URL, image_url: IMAGE_URL,
  };
  console.log(`[digest] ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}: ` +
      entries.map(e => `"${e.title}" (${e.at})`).join(', '));

  if (dryRun) {
    console.log('[digest] DRY RUN, would send:\n' + JSON.stringify(row, null, 2));
    return;
  }

  // Idempotent per day: a second run on the same day sends nothing; whatever
  // went live after this digest is picked up tomorrow (the window starts at
  // the last digest's send_at).
  const existing = await supabaseGet('notifications',
      `select=id&title=eq.${encodeURIComponent(title)}&limit=1`);
  if (existing.length) {
    console.log(`[digest] "${title}" already sent (id ${existing[0].id}); nothing to do.`);
    return;
  }
  await supabasePost('notifications', [row]);
  console.log(`[digest] sent "${title}" to everyone${postToChat ? ' and queued the chat line' : ''}.`);
})().catch(err => {
  console.error('[digest] failed:', err);
  process.exit(1);
});
