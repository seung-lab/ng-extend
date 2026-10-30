#!/usr/bin/env node
/**
 * daily-deploy-digest.mjs
 * Once a day, tell players what changed in Pyr that day: one notification to
 * everyone, listing the changelog entries that went live since the last digest.
 * On a day with no deploy it sends nothing.
 *
 * Source of truth is the LIVE site's changelog (static/changelog.json as
 * served), so an entry counts only once it is actually deployed; the CHANGELOG
 * RULE in README.md keeps those entries in player words. The notification is
 * SHORT whatever the day was like (Ames, 2026-10-11, of a day with 23 entries
 * that listed all 23 in full: "outrageously long, even the TLDR is too long
 * for me to read"). It is a TLDR of one or two sentences, then at most five
 * highlights of one sentence each, written by Claude (ANTHROPIC_API_KEY) and
 * checked against the house rules. Without a key, or if the model's text
 * breaks a rule twice, it is one line: how many updates went live and the
 * names of three of them. It never writes out every entry; on a day of at
 * most LIST_ALL_MAX updates the last line names them all, titles only, one
 * line (Ames 2026-10-16: "why not list them when there is such a small list
 * here?"). A bigger day keeps the count alone.
 *
 * An entry can say how it should be treated here, with an optional "digest"
 * field (Ames, 2026-10-11): "headline" is always in the note, "minor" is never
 * in it (it still counts in the day's total). Unmarked entries are left to the
 * model's judgment.
 *
 * Runs from .github/workflows/daily-deploy-digest.yml every day at 4:30 pm
 * Eastern (Ames, 2026-10-10): the workflow fires at both UTC times that can be
 * 4:30 pm Eastern and DIGEST_LOCAL_TIME=16:30 makes the wrong one exit quietly.
 * By hand:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/daily-deploy-digest.mjs [--dry-run]
 * --dry-run prints the notification instead of sending it (no Supabase needed),
 * and looks at the last 24 hours whatever was already sent, so it has something
 * to show on a day whose digest has gone out.
 * --preview sends it only to the admins (one copy each, titled "(preview)", no
 * chat line) so the look can be checked without telling every player; a
 * preview never counts as a digest for the daily window.
 * POST_TO_CHAT=false keeps it out of chat (the chat-announcements job posts
 * one line when a notification has post_to_chat set).
 */

import { countCompletions } from './weekly-completions.mjs';

import { sendAccessUpdate } from './access-update.mjs';

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

// ── What players did (Ames 2026-10-23) ──────────────────────────────
// "Players made 1,234 edits and completed 12 cells.": one line at the end of
// the note, counted over the same window as the updates. The bell lifts it
// out and shows the two numbers under the picture (NotificationFeedPanel.vue,
// digestStats); in chat it reads as a sentence. Edits are splits and merges,
// cells are counted as the weekly champions count them (weekly-completions.mjs).
/** Rows matching a query, without reading them (PostgREST's exact count). */
async function supabaseCount(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}&limit=1`, {
    method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`COUNT ${table}: ${res.status}`);
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`COUNT ${table}: no total`);
  return total;
}
/** Every row of a query, a page of 1000 at a time (the server's most). */
async function supabaseGetAll(table, query) {
  const rows = [];
  for (let from = 0; from < 100000; from += 1000) {
    const page = await supabaseGet(table, `${query}&order=timestamp.asc&offset=${from}&limit=1000`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}
async function playerActivity(sinceMs, nowMs) {
  const span = `timestamp=gte.${encodeURIComponent(new Date(sinceMs).toISOString())}` +
      `&timestamp=lt.${encodeURIComponent(new Date(nowMs).toISOString())}`;
  const edits = await supabaseCount('edit_log', `select=user_id&${span}&operation=in.(split,merge)&success=not.is.false`);
  const marks = await supabaseGetAll('edit_log',
      `select=user_id,operation,timestamp,metadata,success&${span}&operation=in.(complete_task,mark_complete,unmark_complete)`);
  const cells = countCompletions(marks).reduce((sum, p) => sum + p.count, 0);
  return { edits, cells };
}
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
function activityLine({ edits, cells }) {
  return `Players made ${plural(edits, 'edit', 'edits')} and completed ${plural(cells, 'cell', 'cells')}.`;
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
const MAX_HIGHLIGHTS = 5;
const SUMMARY_SYSTEM = [
  'You write a short daily note for players of Pyr, a citizen science game where people trace neurons in',
  'electron microscope images. You are given the entries of today\'s changelog as JSON, in the order they',
  'went live. Players will not read a long note, so it must be short however many entries there are.',
  'Reply with JSON only, in this shape: {"tldr": "...", "highlights": [{"title": "...", "text": "..."}]}.',
  'tldr: one or two sentences, at most 40 words, naming the two or three biggest changes of the day.',
  `highlights: at most ${MAX_HIGHLIGHTS}, the biggest first. Each has a title of at most five words and a text of one`,
  'sentence, at most 25 words, saying what a player can now do. When several entries are about the same',
  'feature, they are ONE highlight. Leave small fixes and polish out, or put them together in one last',
  'highlight. On a day with one or two small entries, the highlights may be an empty list.',
  'A big change is something a player can now do that they could not do before: a new mode, a new tool, a',
  'new button or shortcut, a new Achievement, a new dataset. The order of the entries says nothing about',
  'importance: an entry from the morning matters as much as one from the evening.',
  'An entry marked "headline": true was picked by the game\'s maker as one players must hear about: it',
  'MUST be named in the tldr and have a highlight (headlines about the same feature may share one).',
  // Ames 2026-10-12, of Hemibrain: "in the headline, it just shouldn't be first".
  'An entry marked "not_first": true is still named, but it never opens the tldr and it is never the',
  'first highlight when there is anything else to say that day.',
  'Rules: call the game Pyr, never EyeWire; say Achievement, never badge; use no dashes of any',
  'kind (no hyphens between words, no en or em dashes), write commas and periods instead; no emoji, no',
  'exclamation marks, no file names or code words; do not mention the date; do not invent anything that',
  'is not in the entries. No markdown and no code fence round the JSON.',
].join(' ');

function houseStyleProblems(text) {
  const problems = [];
  if (/[\u2013\u2014]/.test(text) || /\s-\s/.test(text) || /\w-\w/.test(text)) problems.push('it contains a dash');
  if (/badge/i.test(text)) problems.push('it says badge instead of Achievement');
  if (/eyewire/i.test(text)) problems.push('it says EyeWire instead of Pyr');
  if (/[!]/.test(text)) problems.push('it contains an exclamation mark');
  if (/^\s*[#*\u2022-]/m.test(text)) problems.push('it contains a heading or bullet');
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push('it contains an emoji');
  return problems;
}

/**
 * How many of the day's entries the note touches at all. The first digest
 * with a model TLDR (2026-10-10) named only the entry that went live last,
 * Lantern mode, and left out the day's larger change, To soma and Beyond in
 * Highlight (Ames: "the TLDR should highlight the MAJOR changes, not just
 * one"). An entry counts as touched when the note uses one of the telling
 * words of its title, or two of the telling words of its items.
 */
const PLAIN_WORDS = new Set(('about after again along also and are back been before being both button can cell cells click does each every from have here into just know less like longer made make mark marks mode more most much need needs never newest now only other over point points says shows some than that the their them then there these they this those through today under until very view what when where which while with without would your yours pyr').split(' '));
const tellingWords = text => [...new Set(String(text).toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter(w => !PLAIN_WORDS.has(w));
function entriesTouched(text, entries) {
  const said = new Set(tellingWords(text));
  return entries.filter(e => {
    if (tellingWords(e.title).some(w => said.has(w))) return true;
    return tellingWords((e.items || []).join(' ')).filter(w => said.has(w)).length >= 2;
  }).length;
}
/** The note must reach beyond one entry on a day with several. */
function coverageProblems(text, entries) {
  if (entries.length < 2) return [];
  const want = entries.length >= 4 ? 3 : 2;
  const got = entriesTouched(text, entries);
  return got >= want ? [] : [`it covers ${got} of today's ${entries.length} entries; name every major change, including the ones that went live earlier in the day`];
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
      // Room for the thinking as well as the note. At 500 a day with 23
      // entries spent the whole allowance thinking and the note came back
      // EMPTY, twice, which is how every title ended up in the TLDR
      // (2026-10-11).
      max_tokens: 6000,
      // Weighing a day's entries against each other is a judgment: at low effort
      // the note simply echoed the last entry.
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      system: SUMMARY_SYSTEM,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('claude declined');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new Error(`claude returned no text (stop reason ${data.stop_reason})`);
  return text;
}

const wordCount = text => (String(text).trim().match(/\S+/g) ?? []).length;

/** The model's reply as { tldr, highlights }, or a list of what is wrong with it. */
function readNote(reply, entries) {
  let note;
  try {
    note = JSON.parse(reply.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch { return { problems: ['it is not JSON in the shape asked for'] }; }
  const tldr = typeof note?.tldr === 'string' ? note.tldr.trim() : '';
  const highlights = (Array.isArray(note?.highlights) ? note.highlights : [])
      .map(h => ({ title: String(h?.title ?? '').trim().replace(/[.:]+$/, ''), text: String(h?.text ?? '').trim() }))
      .filter(h => h.title && h.text);
  const problems = [];
  if (tldr.length < 20) problems.push('the tldr is empty or too short');
  if (wordCount(tldr) > 55) problems.push(`the tldr is ${wordCount(tldr)} words; at most 40`);
  if (highlights.length > MAX_HIGHLIGHTS) problems.push(`there are ${highlights.length} highlights; at most ${MAX_HIGHLIGHTS}`);
  for (const h of highlights) {
    if (wordCount(h.title) > 7) problems.push(`the highlight title "${h.title}" is too long; at most five words`);
    if (wordCount(h.text) > 34) problems.push(`the highlight "${h.title}" is ${wordCount(h.text)} words; at most 25`);
  }
  const all = [tldr, ...highlights.flatMap(h => [h.title, h.text])].join('\n');
  problems.push(...houseStyleProblems(all), ...coverageProblems(all, entries));
  // Every headline is in the note.
  for (const e of entries.filter(isHeadline)) {
    if (entriesTouched(all, [e]) === 0) problems.push(`it leaves out the headline "${e.title}", which must be named`);
  }
  return problems.length ? { problems } : { tldr, highlights };
}

const isHeadline = e => e.digest === 'headline';
const isMinor = e => e.digest === 'minor';

/** The day in a few lines, in player words, or null when it cannot be had. */
async function writeSummary(entries) {
  if (!ANTHROPIC_API_KEY) { console.log('[digest] no ANTHROPIC_API_KEY; using the one line fallback'); return null; }
  const input = JSON.stringify(entries.map(e => ({ title: e.title, items: e.items, ...(isHeadline(e) ? { headline: true } : {}), ...(e.lead === false ? { not_first: true } : {}) })), null, 1);
  const messages = [{ role: 'user', content: `Today's changelog entries:\n${input}` }];
  try {
    let reply = await askClaude(messages);
    let note = readNote(reply, entries);
    if (note.problems) {
      console.log(`[digest] summary broke a rule (${note.problems.join('; ')}); asking once more`);
      messages.push({ role: 'assistant', content: reply });
      messages.push({ role: 'user', content: `Rewrite it: ${note.problems.join('; ')}. Reply with the JSON only.` });
      reply = await askClaude(messages);
      note = readNote(reply, entries);
      if (note.problems) { console.log(`[digest] still ${note.problems.join('; ')}; using the one line fallback`); return null; }
    }
    return note;
  } catch (err) {
    console.log(`[digest] summary unavailable (${err.message}); using the one line fallback`);
    return null;
  }
}

// Every update is listed by title, one per line, under the highlights (Ames
// 2026-10-22: "THIS SHOULD LIST THEM ALL I NEED A PLACE WE CAN SEE ALL 17
// UPDATES"). Titles only, so a big day is a list, not an essay; the cap only
// guards against a runaway day.
const LIST_ALL_MAX = 60;
/** The day's updates by name, oldest first, one per line as a list; '' on a
 *  runaway day. Rendered as bullets in the bell (util/safe_markdown.ts). */
function allTitles(entries) {
  if (entries.length > LIST_ALL_MAX) return '';
  return entries.map(e => String(e.title || '').trim()).filter(Boolean).map(t => `- ${t}`).join('\n');
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
  const n = entries.length;
  const told = entries.filter(e => !isMinor(e));
  if (told.length === 0) {
    // Nothing but entries marked minor.
    parts.push(`**TLDR:** ${n === 1 ? 'One small fix' : `${n} small fixes`} went live in Pyr today.`);
    return parts.join('\n\n');
  }
  if (!summary) {
    // No note to be had: one line, never the whole list. Headlines first, then the newest.
    const newestFirst = [...told].reverse();
    const some = [...newestFirst.filter(isHeadline), ...newestFirst.filter(e => !isHeadline(e))].slice(0, 3).map(e => e.title);
    if (n <= 3) {
      parts.push(`**TLDR:** ${joinNaturally(told.map(e => e.title))}.`);
    } else {
      parts.push(`**TLDR:** ${n} updates went live in Pyr today. Among them: ${some.join('; ')}.`);
      const list = allTitles(entries);
      if (list) parts.push(`**All ${n} updates:**\n${list}`);
    }
    return parts.join('\n\n');
  }
  parts.push(`**TLDR:** ${summary.tldr}`);
  for (const h of summary.highlights) parts.push(`**${h.title}:** ${h.text}`);
  if (n > Math.max(3, summary.highlights.length)) {
    const names = allTitles(entries);
    parts.push(names ? `**All ${n} updates:**\n${names}` : `${n} updates went live in all.`);
  }
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
  // A dry run is for looking: it takes the last 24 hours whatever has been sent.
  const last = dryRun ? null : await lastDigestSentAt();
  const sinceMs = Math.max(last ?? (nowMs - DAY_MS), nowMs - MAX_LOOKBACK_MS);
  console.log(`[digest] window ${new Date(sinceMs).toISOString()} to ${now.toISOString()}` +
      (last ? ' (since the last digest)' : ' (no earlier digest found: the last 24 hours)'));

  // The admins' note on access (Ames 2026-10-30), sent even on a day with no deploy.
  if (SUPABASE_URL && SUPABASE_KEY) {
    try { await sendAccessUpdate({ get: supabaseGet, post: supabasePost, now, day: easternDay(now), dryRun, preview }); }
    catch (e) { console.warn('[access update] failed:', e?.message || e); }
  }

  const entries = (await liveChangelog())
      .filter(e => e.atMs > sinceMs && e.atMs <= nowMs)
      .sort((a, b) => a.atMs - b.atMs);
  if (entries.length === 0) {
    console.log('[digest] nothing went live in the window; no notification today.');
    return;
  }

  const title = `${DIGEST_TAG}: ${easternDay(now)}`;
  // Entries marked minor are never in the note; they still count in the total.
  const told = entries.filter(e => !isMinor(e));
  const summary = told.length ? await writeSummary(told) : null;
  let body = buildBody(entries, sinceMs, nowMs, summary);
  // The counts are a bonus: a failed count never holds back the note.
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const activity = await playerActivity(sinceMs, nowMs);
      console.log(`[digest] players: ${activity.edits} edits, ${activity.cells} cells`);
      body += '\n\n' + activityLine(activity);
    } catch (e) { console.warn('[digest] could not count what players did:', e?.message || e); }
  }
  const row = {
    title, body, target_type: 'all', send_at: now.toISOString(), post_to_chat: postToChat,
    thumbnail_url: THUMBNAIL_URL, image_url: IMAGE_URL,
  };
  console.log(`[digest] ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}: ` +
      entries.map(e => `"${e.title}" (${e.at}${e.digest ? `, ${e.digest}` : ''})`).join(', '));

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
