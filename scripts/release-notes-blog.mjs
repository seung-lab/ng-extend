#!/usr/bin/env node
/**
 * release-notes-blog.mjs
 * "What's new in Pyr", one blog post a week on connectome.quest (triage #463:
 * a player pressed Later on the update notice and then had nowhere to read
 * what changed). Ames 2026-11-10 chose: a page per week, Monday to Sunday
 * Eastern; every update with its own sentences, not just its name; listed on
 * the blog like any post, but never announced in the bell, in chat or by email.
 *
 * Each page is rebuilt whole from two sources every time, so a rerun repairs
 * it and an old week can be filled in by hand:
 *   - the week's Today in Pyr notes (notifications titled "Today in Pyr: ..."
 *     sent to everyone), which give each day its short summary and highlights;
 *   - the live changelog, which gives every update of that day in full. A
 *     day's updates are the ones between the note before it and its own.
 * Newest day first. The daily digest (daily-deploy-digest.mjs) calls
 * publishWeek after it sends the day's note.
 *
 * The post is written with the service key straight into blog_posts. Before
 * writing, it checks that supabase-release-notes-blog.sql has been run (the
 * function ew_is_release_notes exists): without it, publishing the post would
 * send "New on the blog" to every player. The blog site rebuilds its pages
 * from the posts every 15 minutes, and /blog/whats-new/ always points at the
 * newest week (seunglabdata tools/build-blog.mjs).
 *
 * By hand, to fill in or redo a week (the Monday it starts, Eastern):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/release-notes-blog.mjs --week 2026-11-02 [--dry-run]
 */

export const SLUG_PREFIX = 'whats-new-in-pyr-';
export const LATEST_URL = 'https://connectome.quest/blog/whats-new/';
export const AUTHOR = 'Nurro';
// The feature image every week shares (Ames 2026-11-12), on connectome.quest.
export const COVER_URL = 'https://connectome.quest/assets/images/blog/whats-new-in-pyr.jpg';
const DIGEST_TAG = 'Today in Pyr';
const DAY_MS = 24 * 60 * 60 * 1000;
// blog_posts.body holds at most 100,000 characters (supabase-blog.sql).
const BODY_MAX = 95000;
const TZ = 'America/New_York';

// Player text is American (Ames). The changelog has some British spellings.
const AMERICAN = [
  [/\bcolour/g, 'color'], [/\bColour/g, 'Color'], [/\bfavourite/g, 'favorite'], [/\bFavourite/g, 'Favorite'],
  [/\bneighbour/g, 'neighbor'], [/\bNeighbour/g, 'Neighbor'], [/\bbehaviour/g, 'behavior'], [/\bBehaviour/g, 'Behavior'],
  [/\bcentre/g, 'center'], [/\bCentre/g, 'Center'], [/\bgrey/g, 'gray'], [/\bGrey/g, 'Gray'],
  [/\b(recogni|organi|reali|customi|personali|summari|visuali|optimi|minimi|maximi|prioriti|categori|synchroni|apologi)s(e|es|ed|ing|ation|ations)\b/gi, '$1z$2'],
  [/\banalys(e|es|ed|ing)\b/g, 'analyz$1'],
  [/\bcancell(ed|ing)\b/g, 'cancel$1'], [/\blabell(ed|ing)\b/g, 'label$1'], [/\btravell(ed|ing|er)\b/g, 'travel$1'],
];
export const american = (s) => AMERICAN.reduce((t, [re, to]) => t.replace(re, to), String(s ?? ''));

// ── Eastern calendar ────────────────────────────────────────────────────
function easternParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** The instant a calendar day starts in Eastern time. */
function easternMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d, 5);   // 00:00 EST
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(guess)).find(x => x.type === 'timeZoneName')?.value || 'GMT-5';
  const offH = Number((name.match(/GMT([+-]\d+)/) || [, '-5'])[1]);
  return Date.UTC(y, m - 1, d) - offH * 60 * 60 * 1000;
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const longDay = (ms, opts = {}) => new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', ...opts });

/** The Monday to Sunday (Eastern) week holding this instant. */
export function weekOf(ms) {
  const { y, m, d, weekday } = easternParts(ms);
  const back = (weekday + 6) % 7;   // days since Monday
  const mon = new Date(Date.UTC(y, m - 1, d - back));
  const start = easternMidnight(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate());
  const sun = new Date(Date.UTC(y, m - 1, d - back + 6));
  const end = easternMidnight(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate() + 1);
  const slug = SLUG_PREFIX + iso(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate());
  return { slug, startMs: start, endMs: end };
}
export const weekFromSlugDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return weekOf(easternMidnight(y, m, d) + 12 * 60 * 60 * 1000);
};

export function weekTitle(week) {
  return `What's new in Pyr: week of ${longDay(week.startMs)}`;
}
export function weekSummary(week) {
  const first = longDay(week.startMs);
  const lastMs = week.endMs - 12 * 60 * 60 * 1000;
  const sameMonth = easternParts(week.startMs).m === easternParts(lastMs).m;
  const last = sameMonth ? longDay(lastMs, { month: undefined }) : longDay(lastMs);
  return `Every update to Pyr from ${first} to ${last}, ${easternParts(lastMs).y}, newest first.`;
}

// ── One day ─────────────────────────────────────────────────────────────
/** What a Today in Pyr note says, for the page: its summary and highlights,
 *  without the list of names (the page lists them in full), the link here,
 *  or the players line (kept apart, shown last). */
export function readDigestBody(body) {
  const paras = String(body || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const activity = paras.find(p => /^Players made /.test(p)) || '';
  const note = paras
      .filter(p => p !== activity)
      .filter(p => !/^\*\*All \d+ updates:?\*\*/.test(p))
      .filter(p => !/^Since the last update on /.test(p))
      .filter(p => !p.includes(LATEST_URL))
      .map(p => p.replace(/^\*\*TLDR:\*\*\s*/, ''));
  return { note, activity };
}

/** A day of the page: its date, the note, every update in full, what players did. */
export function daySection(digest, entries, { full = true } = {}) {
  const { note, activity } = readDigestBody(digest.body);
  const out = [`## ${longDay(Date.parse(digest.send_at), { weekday: 'long' })}`, ...note];
  if (entries.length) {
    out.push(`### ${entries.length === 1 ? 'The update' : `All ${entries.length} updates`}`);
    out.push(entries.map(e => {
      const title = String(e.title || '').trim().replace(/[.:]+$/, '');
      const items = (e.items || []).map(i => String(i).trim()).filter(Boolean).join(' ');
      return full && items ? `- **${title}.** ${items}` : `- ${title}`;
    }).join('\n'));
  }
  if (activity) out.push(`*${activity}*`);
  return out.join('\n\n');
}

/** Which changelog entries each digest told: those after the one before it. */
export function splitDays(digests, changelog) {
  const sorted = [...digests].sort((a, b) => Date.parse(a.send_at) - Date.parse(b.send_at));
  const entries = changelog.map(e => ({ ...e, atMs: Date.parse(e.at) })).filter(e => Number.isFinite(e.atMs));
  return sorted.map((d, i) => {
    const to = Date.parse(d.send_at);
    // The first digest ever had no note before it: the day before it.
    const from = i > 0 ? Date.parse(sorted[i - 1].send_at) : to - DAY_MS;
    return { digest: d, entries: entries.filter(e => e.atMs > from && e.atMs <= to).sort((a, b) => a.atMs - b.atMs) };
  });
}

/** The week's whole post, or null when the week has no Today in Pyr yet. */
export function buildWeekPost(week, digests, changelog, { previousSlug = '' } = {}) {
  const days = splitDays(digests, changelog)
      .filter(({ digest }) => { const t = Date.parse(digest.send_at); return t >= week.startMs && t < week.endMs; })
      .reverse();
  if (!days.length) return null;
  const compose = (full) => american([
    'Everything that changed in Pyr this week, newest day first. A new day is added each afternoon, with the Today in Pyr note in your bell.',
    ...days.map(({ digest, entries }) => daySection(digest, entries, { full })),
    ...(previousSlug ? ['---', `[The week before](/blog/${previousSlug}/)`] : []),
  ].join('\n\n'));
  let body = compose(true);
  if (body.length > BODY_MAX) body = compose(false);   // a runaway week: names only
  return {
    slug: week.slug,
    title: weekTitle(week),
    summary: weekSummary(week),
    body,
    status: 'published',
    author_name: AUTHOR,
    cover_url: COVER_URL,
    // Stable, so the post keeps its place in the blog list: its first day.
    published_at: new Date(Date.parse(days[days.length - 1].digest.send_at)).toISOString(),
  };
}

// ── Writing it ──────────────────────────────────────────────────────────
/**
 * Rebuild the week holding `now` (or `week`) and write it if it changed.
 * get(table, query) and rpc(name, args) and upsert(table, row, onConflict)
 * are the caller's Supabase helpers. Returns what happened, in words.
 */
export async function publishWeek({ get, rpc, upsert, changelog, now = new Date(), week = weekOf(now.getTime()), dryRun = false, log = console.log }) {
  // The bell must not announce these posts: supabase-release-notes-blog.sql.
  let guarded = false;
  try { guarded = (await rpc('ew_is_release_notes', { p_slug: week.slug })) === true; } catch { guarded = false; }
  if (!guarded && !dryRun) {
    return `skipped: run supabase-release-notes-blog.sql first, or "${week.slug}" would be announced to every player`;
  }
  const since = new Date(week.startMs - 8 * DAY_MS).toISOString();
  const until = new Date(Math.min(week.endMs, now.getTime() + 60000)).toISOString();
  const digests = await get('notifications',
      `select=send_at,body&title=like.${encodeURIComponent(DIGEST_TAG + ':*')}&target_type=eq.all` +
      `&send_at=gte.${encodeURIComponent(since)}&send_at=lt.${encodeURIComponent(until)}&order=send_at.asc&limit=40`);
  const previous = weekOf(week.startMs - DAY_MS).slug;
  const had = await get('blog_posts', `select=slug,body,title,summary,status,published_at&slug=in.(${week.slug},${previous})`);
  const post = buildWeekPost(week, digests, changelog, { previousSlug: had.some(p => p.slug === previous) ? previous : '' });
  if (!post) return `nothing yet for ${week.slug}`;
  const mine = had.find(p => p.slug === week.slug);
  if (mine && ['body', 'title', 'summary', 'status'].every(k => mine[k] === post[k])) return `${week.slug} is up to date`;
  if (dryRun) { log(`[release notes] DRY RUN, ${post.slug}:\n# ${post.title}\n${post.summary}\n\n${post.body}`); return `dry run: ${post.slug}`; }
  await upsert('blog_posts', { ...post, updated_at: now.toISOString() }, 'slug');
  return `${mine ? 'updated' : 'started'} ${week.slug} (${post.body.length} characters)`;
}

// ── By hand ─────────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const live = process.env.PYR_LIVE_URL || 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com';
  const dryRun = process.argv.includes('--dry-run');
  const at = process.argv.indexOf('--week');
  if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
  const helpers = supabaseHelpers(url, key);
  const week = at > 0 ? weekFromSlugDate(process.argv[at + 1]) : weekOf(Date.now());
  const res = await fetch(`${live}/changelog.json?t=${Date.now()}`, { cache: 'no-store' });
  const { entries } = await res.json();
  console.log('[release notes]', await publishWeek({ ...helpers, changelog: entries, week, dryRun }));
}

/** Supabase REST helpers with the service key, for publishWeek. */
export function supabaseHelpers(url, key) {
  const headers = {
    apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json',
  };
  return {
    async get(table, query) {
      const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!r.ok) throw new Error(`GET ${table}: ${r.status} ${await r.text()}`);
      return r.json();
    },
    async rpc(name, args) {
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(`rpc ${name}: ${r.status}`);
      return r.json();
    },
    async upsert(table, row, onConflict) {
      const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]),
      });
      if (!r.ok) throw new Error(`UPSERT ${table}: ${r.status} ${await r.text()}`);
    },
  };
}
