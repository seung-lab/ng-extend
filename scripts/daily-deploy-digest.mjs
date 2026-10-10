#!/usr/bin/env node
/**
 * daily-deploy-digest.mjs
 * Once a day, tell players what changed in Pyr that day: one notification to
 * everyone, listing the changelog entries that went live since the last digest.
 * On a day with no deploy it sends nothing.
 *
 * Source of truth is the LIVE site's changelog (static/changelog.json as
 * served), so an entry counts only once it is actually deployed; the CHANGELOG
 * RULE in README.md keeps those entries in player words. The body is a short
 * summary of those entries written by Claude (ANTHROPIC_API_KEY), checked
 * against the house rules, followed by the entry titles; without a key, or if
 * the model's text breaks a rule twice, a plain list of titles goes out instead.
 *
 * Runs from .github/workflows/daily-deploy-digest.yml every day at 4:30 pm
 * Eastern (Ames, 2026-10-10): the workflow fires at both UTC times that can be
 * 4:30 pm Eastern and DIGEST_LOCAL_TIME=16:30 makes the wrong one exit quietly.
 * By hand:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/daily-deploy-digest.mjs [--dry-run]
 * --dry-run prints the notification instead of sending it (no Supabase needed).
 * --preview sends it only to the admins (one copy each, titled "(preview)", no
 * chat line) so the look can be checked without telling every player; a
 * preview never counts as a digest for the daily window.
 * POST_TO_CHAT=false keeps it out of chat (the chat-announcements job posts
 * one line when a notification has post_to_chat set).
 */

const LIVE_URL = process.env.PYR_LIVE_URL ||
    'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const preview = process.argv.includes('--preview');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// HH:MM in US Eastern that a scheduled run must be within 20 minutes of, or unset to run any time.
const LOCAL_TIME = process.env.DIGEST_LOCAL_TIME || '';
const SUMMARY_MODEL = process.env.DIGEST_MODEL || 'claude-opus-5-5';
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
      `select=send_at&title=like.${encodeURIComponent(DIGEST_TAG + '*')}` +
      `&target_type=eq.all&order=send_at.desc&limit=1`);
  return rows[0]?.send_at ? Date.parse(rows[0].send_at) : null;
}

// House rules for anything a player reads (README: CHANGELOG-RULE, and the
// game's own copy rules): the game is Pyr, no dashes, "Achievement", plain
// words, nothing invented.
const SUMMARY_SYSTEM = [
  'You write a two or three sentence note for players of Pyr, a citizen science game where people trace',
  'neurons in electron microscope images. You are given the entries of today\'s changelog as JSON. Write',
  'what changed today in plain words a player understands, naming the changes that matter most, at most',
  '60 words. Rules: call the game Pyr, never EyeWire; say Achievement, never badge; use no dashes of any',
  'kind (no hyphens between words, no en or em dashes), write commas and periods instead; no emoji, no',
  'exclamation marks, no headings, no bullet points, no file names or code words; do not mention the date;',
  'do not invent anything that is not in the entries; do not list every item. Reply with the note only.',
].join(' ');

function houseStyleProblems(text) {
  const problems = [];
  if (!text || text.length < 20) problems.push('it is empty or too short');
  if (text.length > 600) problems.push('it is too long');
  if (/[\u2013\u2014]/.test(text) || /\s-\s/.test(text) || /\w-\w/.test(text)) problems.push('it contains a dash');
  if (/badge/i.test(text)) problems.push('it says badge instead of Achievement');
  if (/eyewire/i.test(text)) problems.push('it says EyeWire instead of Pyr');
  if (/[!]/.test(text)) problems.push('it contains an exclamation mark');
  if (/^\s*[#*\u2022-]/m.test(text)) problems.push('it contains a heading or bullet');
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push('it contains an emoji');
  return problems;
}

async function askClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      output_config: { effort: 'low' },
      fallbacks: 'default',
      system: SUMMARY_SYSTEM,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('claude declined');
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

/** A short summary of the entries in player words, or null when it cannot be had. */
async function writeSummary(entries) {
  if (!ANTHROPIC_API_KEY) { console.log('[digest] no ANTHROPIC_API_KEY; using the plain list'); return null; }
  const input = JSON.stringify(entries.map(e => ({ title: e.title, items: e.items })), null, 1);
  const messages = [{ role: 'user', content: `Today's changelog entries:\n${input}` }];
  try {
    let text = await askClaude(messages);
    let problems = houseStyleProblems(text);
    if (problems.length) {
      console.log(`[digest] summary broke a rule (${problems.join('; ')}); asking once more`);
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `Rewrite it: ${problems.join('; ')}. Reply with the note only.` });
      text = await askClaude(messages);
      problems = houseStyleProblems(text);
      if (problems.length) { console.log(`[digest] still ${problems.join('; ')}; using the plain list`); return null; }
    }
    return text;
  } catch (err) {
    console.log(`[digest] summary unavailable (${err.message}); using the plain list`);
    return null;
  }
}

function joinNaturally(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function buildBody(entries, sinceMs, nowMs, summary) {
  const parts = [];
  if (nowMs - sinceMs > 30 * 60 * 60 * 1000) {
    parts.push(`Since the last update on ${easternDay(new Date(sinceMs))}:`);
  }
  const titles = entries.map(e => e.title);
  if (summary) {
    parts.push(summary);
    parts.push(`**What changed:** ${titles.join('. ')}.`);
  } else {
    parts.push(`Changed today: ${joinNaturally(titles)}.`);
  }
  parts.push('The full list is behind the i button at the top of the game.');
  return parts.join('\n\n');
}

function easternMinutes(d) {
  const [h, m] = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
      .split(':').map(Number);
  return (h % 24) * 60 + m;
}

(async () => {
  const now = new Date();
  const nowMs = now.getTime();
  if (LOCAL_TIME) {
    const [h, m] = LOCAL_TIME.split(':').map(Number);
    const diff = Math.abs(easternMinutes(now) - (h * 60 + m));
    if (diff > 20) {
      console.log(`[digest] it is not ${LOCAL_TIME} Eastern yet (${diff} minutes off); the other scheduled run sends it.`);
      return;
    }
  }
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
  const summary = await writeSummary(entries);
  const body = buildBody(entries, sinceMs, nowMs, summary);
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

  if (preview) {
    // The admins table names people by user_id or by email; resolve both to users rows.
    const admins = await supabaseGet('admins', 'select=user_id,email');
    const byId = admins.map(a => a.user_id).filter(Boolean);
    const emails = admins.map(a => a.email).filter(Boolean);
    const users = [];
    if (byId.length) {
      users.push(...await supabaseGet('users',
          `select=id,display_name&id=in.(${byId.join(',')})`));
    }
    if (emails.length) {
      users.push(...await supabaseGet('users',
          `select=id,display_name&middleauth_email=in.(${emails.map(e => `"${e}"`).join(',')})`));
    }
    const ids = [...new Set(users.map(u => u.id))];
    if (ids.length === 0) throw new Error(`no admins to preview to (${admins.length} admin rows)`);
    const names = users;
    const previewTitle = `${title} (preview)`;
    const sent = [];
    for (const id of ids) {
      await supabasePost('notifications', [{
        ...row, title: previewTitle, target_type: 'user', target_id: id, post_to_chat: false,
      }]);
      sent.push(names.find(n => n.id === id)?.display_name || id.slice(0, 8));
    }
    console.log(`[digest] PREVIEW sent to ${sent.length} admin${sent.length === 1 ? '' : 's'}` +
        (sent.length ? `: ${sent.join(', ')}` : ''));
    return;
  }

  // Idempotent per day: a second run on the same day sends nothing; whatever
  // went live after this digest is picked up tomorrow (the window starts at
  // the last digest's send_at).
  const existing = await supabaseGet('notifications',
      `select=id&title=eq.${encodeURIComponent(title)}&target_type=eq.all&limit=1`);
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
