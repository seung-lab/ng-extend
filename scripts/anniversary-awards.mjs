#!/usr/bin/env node
/**
 * anniversary-awards.mjs
 * A Pyr birthday for every player (Ames 2026-10-26): on the anniversary of
 * the day they joined (users.created_at, US Eastern time), they get "One Year
 * in Pyr", then "Two Years in Pyr", and so on, each its own Special Award with
 * Ames's cake, and a New Achievement note in My Pyr.
 *
 * Runs every day (.github/workflows/anniversary-awards.yml). It gives every
 * year a player has completed and does not hold yet, so a missed day is
 * caught up the next day, and a year is never given twice.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/anniversary-awards.mjs
 * Env: RECAP_DRY=true (print only), ANNIVERSARY_TODAY=YYYY-MM-DD (pretend
 * today is that ET date, for a dry run).
 */

import { supabaseClient, etDay } from './recap-month.mjs';

const db = supabaseClient();
const dry = process.env.RECAP_DRY === 'true';
const ART = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/champions/pyr-birthday.png';
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const yearsWord = (n) => `${WORDS[n] ?? n} ${n === 1 ? 'Year' : 'Years'}`;

/** Whole years from one ET date ("YYYY-MM-DD") to another. A Feb 29 joiner
 *  has their birthday on Feb 28 in other years. */
function fullYears(joined, today) {
  const [jy, jm, jd] = joined.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const day = jm === 2 && jd === 29 && !leap(ty) ? 28 : jd;
  return ty - jy - ((tm < jm || (tm === jm && td < day)) ? 1 : 0);
}

/** Ames's birthday lines (2026-10-26). One opens each note, picked by the
 *  player and the year, so a rerun says the same thing. {span} is "a whole
 *  year", "two whole years", and so on. */
const CHEERS = [
  'Blow out the virtual candles on your virtual cake on your virtual birthday!',
  '{Span} of Pyr is worth cell-ebrating!',
  'Cheers to {span} of Pyr!',
  'You take the cake!',
  "Hip hip Pyrray! It's your in-game birthday!",
  'Mmmm cake.',
];
function cheerFor(uid, n) {
  let h = n;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const span = n === 1 ? 'a whole year' : `${(WORDS[n] ?? String(n)).toLowerCase()} whole years`;
  return CHEERS[h % CHEERS.length].replace('{span}', span).replace('{Span}', span[0].toUpperCase() + span.slice(1));
}

function badgeFor(n) {
  return {
    slug: `anniversary-${n}`,
    name: `${yearsWord(n)} in Pyr`,
    description: `Happy Pyr birthday! ${n === 1 ? 'A whole year' : `${WORDS[n] ?? n} years`} since you joined Pyr. Thank you for mapping the brain with us.`,
    image_url: ART,
    thumbnail_url: ART,
  };
}

async function main() {
  const today = process.env.ANNIVERSARY_TODAY || etDay(Date.now());
  console.log(`[birthday] Pyr birthdays for ${today} (ET)`);

  const users = await db.getAll('users?select=id,display_name,created_at&created_at=not.is.null', 'id.asc');
  const due = [];
  for (const u of users) {
    const years = fullYears(etDay(u.created_at), today);
    if (years >= 1) due.push({ ...u, years });
  }
  if (!due.length) { console.log('[birthday] Nobody has a Pyr birthday to celebrate yet.'); return; }

  // What is already held, in two reads instead of one per player per year
  // (Ames 2026-10-26: a normal day should cost next to nothing).
  const badges = new Map((await db.getAll('special_badges?select=id,slug&slug=like.anniversary-*', 'id.asc'))
    .map(b => [Number(b.slug.split('-')[1]), b.id]));
  const held = new Set();
  if (badges.size) {
    const nOf = new Map([...badges].map(([n, id]) => [id, n]));
    for (const a of await db.getAll(`special_badge_awards?select=badge_id,user_id&badge_id=in.(${[...badges.values()].join(',')})`, 'id.asc')) {
      held.add(`${a.user_id}|${nOf.get(a.badge_id)}`);
    }
  }
  let given = 0;
  for (const u of due) {
    for (let n = 1; n <= u.years; n++) {
      if (held.has(`${u.id}|${n}`)) continue;
      const badge = badgeFor(n);
      if (dry) { console.log(`[birthday] would give ${badge.name} to ${u.display_name || u.id} (joined ${etDay(u.created_at)}): ${cheerFor(u.id, n)}`); continue; }
      if (!badges.has(n)) {
        const [saved] = await db.send('POST', 'special_badges?on_conflict=slug', badge, 'resolution=merge-duplicates,return=representation');
        badges.set(n, saved.id);
      }
      const id = badges.get(n);
      await db.send('POST', 'special_badge_awards?on_conflict=badge_id,user_id',
        [{ badge_id: id, user_id: u.id, awarded_by: null, reason: `Joined Pyr on ${etDay(u.created_at)}` }], 'resolution=ignore-duplicates,return=minimal');
      await db.send('POST', 'notifications', {
        title: `🎂 New Achievement: ${badge.name}`,
        body: `${cheerFor(u.id, n)} Happy Pyr birthday${u.display_name ? `, ${u.display_name}` : ''}! ${n === 1 ? 'One year' : `${WORDS[n] ?? n} years`} ago today you joined Pyr. Thank you for mapping the brain with us. 🧬`,
        image_url: ART, thumbnail_url: ART,
        target_type: 'user', target_id: u.id, send_at: new Date().toISOString(), post_to_chat: false,
      });
      given++;
      console.log(`[birthday] ${badge.name} to ${u.display_name || u.id}`);
    }
  }
  console.log(`[birthday] Done. ${dry ? 'Dry run, nothing given.' : `${given} given.`}`);
}

main().catch(err => {
  console.error('[birthday] Fatal:', err.message);
  process.exit(1);
});
