#!/usr/bin/env node
/**
 * monthly-recap.mjs
 * "Your Month in Science": a personal notification on the 1st for the month
 * that just ended, to every player who made an edit or completed a cell in
 * it (Ames 2026-10-25). The weekly one is scripts/weekly-recap.mjs.
 *
 * The month runs 1st 00:00 ET up to the next 1st (scripts/recap-month.mjs).
 * RECAP_PERIOD=year makes "Your Year in Science" for a Pyr year instead
 * (Sep 28 to Sep 28 ET, the day the first testers came; RECAP_YEAR=n).
 * Edits are merges and cuts from edit_log, read a page at a time; cells are
 * the leaderboard's rule (ew_cell_completions). Opening the card shows the
 * same month in the profile (src/util/recap_week.ts monthFromRecapTitle).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/monthly-recap.mjs
 * Env: RECAP_MONTH=YYYY-MM (default: last month), RECAP_DRY=true (print
 * only), RECAP_CORRECT=true (rewrite the month's cards already sent),
 * RECAP_TEST_TO=<user ids, comma separated> (send only their cards, titled "(test)",
 * so the month's real card still goes out on the 1st).
 */

import { readFileSync } from 'node:fs';
import { periodFromEnv, supabaseClient, monthActivity, monthCells, ranked, bestRun } from './recap-month.mjs';

const db = supabaseClient();
const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Achievement names by track and id, read from the app's own list. */
function badgeNames() {
  const src = readFileSync(new URL('../src/widgets/badge_definitions.ts', import.meta.url), 'utf8');
  const names = new Map();
  for (const m of src.matchAll(/\{ id: (\d+), track: '(\w+)'.*?name: '([^']+)'/g)) names.set(`${m[2]}|${m[1]}`, m[3]);
  return names;
}

/** Achievements earned in the month, per player: Map(user_id -> [name]). */
async function monthAchievements(r) {
  const span = `&awarded_at=gte.${encodeURIComponent(r.startISO)}&awarded_at=lt.${encodeURIComponent(r.endISO)}`;
  const names = badgeNames();
  const out = new Map();
  const add = (uid, name) => { if (!out.has(uid)) out.set(uid, []); out.get(uid).push(name); };
  // The loyalty track is switched off (badge_definitions.ts LOYALTY_ENABLED).
  for (const a of await db.getAll(`badge_awards?select=user_id,track,badge_id,awarded_at&track=in.(building,exploration)${span}`, 'user_id.asc,track.asc,badge_id.asc')) {
    add(a.user_id, names.get(`${a.track}|${a.badge_id}`) || 'an achievement');
  }
  for (const a of await db.getAll(`special_badge_awards?select=user_id,awarded_at,special_badges(name)${span}`, 'id.asc')) {
    add(a.user_id, a.special_badges?.name || 'a special achievement');
  }
  return out;
}

async function main() {
  const month = periodFromEnv();   // a month, or a Pyr year
  const isYear = month.kind === 'year';
  const span = isYear ? 'year' : 'month';
  const inWhen = isYear ? `in Pyr's ${month.label}` : `in ${month.label}`;
  console.log(`${isYear ? 'Year' : 'Month'} in Science for ${month.label} (${month.startISO} to ${month.endISO})`);

  const [activity, cells, achievements] = await Promise.all([monthActivity(db, month), monthCells(db, month), monthAchievements(month)]);

  // Places: rank among everyone who edited, and everyone who completed a cell.
  const editRank = new Map(ranked(activity, 'total').map((x, i) => [x.user_id, i + 1]));
  const cellRank = new Map(ranked(cells, 'count').map((x, i) => [x.user_id, i + 1]));
  const testTo = (process.env.RECAP_TEST_TO || '').split(',').map(x => x.trim()).filter(Boolean);
  const recipients = [...new Set([...editRank.keys(), ...cellRank.keys()])].filter(uid => !testTo.length || testTo.includes(uid));
  if (!recipients.length) { console.log(`No activity this ${span}, no recaps to send.`); return; }

  const users = new Map();
  for (let i = 0; i < recipients.length; i += 100) {
    const ids = recipients.slice(i, i + 100).join(',');
    // A dry run with a read only key can not see time zones: streaks then use ET.
    const rows = await db.get(`users?select=id,display_name,tz&id=in.(${ids})`)
      .catch(e => { if (process.env.RECAP_DRY !== 'true') throw e; return db.get(`users?select=id,display_name&id=in.(${ids})`); });
    for (const u of rows) users.set(u.id, u);
  }

  const title = `✨ Your ${isYear ? 'Year' : 'Month'} in Science: ${month.label}${testTo.length ? ' (test)' : ''}`;
  const cards = recipients.map(uid => {
    const a = activity.get(uid) ?? { merges: 0, splits: 0, total: 0, times: [] };
    const c = cells.get(uid)?.count ?? 0;
    const got = achievements.get(uid) ?? [];
    const streak = bestRun(a.times, users.get(uid)?.tz);
    const lines = [];
    const parts = [];
    if (a.merges) parts.push(plural(a.merges, 'merge'));
    if (a.splits) parts.push(plural(a.splits, 'cut'));
    lines.push(`You made **${plural(a.total, 'edit')}** ${inWhen}${parts.length ? ` (${parts.join(', ')})` : ''}.`);
    if (c) lines.push(`You completed **${plural(c, 'cell')}**.`);
    const places = [];
    if (editRank.has(uid)) places.push(`**#${editRank.get(uid)}** of ${editRank.size} for edits`);
    if (cellRank.has(uid)) places.push(`**#${cellRank.get(uid)}** of ${cellRank.size} for cells`);
    if (places.length) lines.push(`Your place this ${span}: ${places.join(', ')}.`);
    if (streak > 1) lines.push(`Best streak: **${plural(streak, 'day')}** in a row 🔥`);
    // A long list would bury the card: the first five by name, then a count.
    if (got.length) lines.push(`You earned **${plural(got.length, 'achievement')}**: ${got.slice(0, 5).join(', ')}${got.length > 5 ? ` and ${got.length - 5} more` : ''} 🏅`);
    lines.push(isYear ? 'Happy birthday, Pyr! Thank you for a year of mapping the brain with us. Open this to see your whole year.'
      : 'Thank you for mapping the brain with us. Open this to see your whole month.');
    return {
      uid, name: users.get(uid)?.display_name || uid, total: a.total, cells: c, streak, got: got.length,
      row: {
        title,
        body: lines.join('\n'),
        thumbnail_url: 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/recap/week-in-science-icon.jpg',
        image_url: 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/recap/week-in-science-banner.jpg',
        target_type: 'user',
        target_id: uid,
        send_at: new Date().toISOString(),
        post_to_chat: false,
      },
    };
  });

  // One recap per person per month, found by its title.
  const dry = process.env.RECAP_DRY === 'true';
  const correct = process.env.RECAP_CORRECT === 'true';
  let sent;
  try {
    // A test card is always sent, however many tests came before it.
    sent = testTo.length ? [] : await db.getAll(`notifications?select=id,target_id&target_type=eq.user&title=eq.${encodeURIComponent(title)}`, 'id.asc');
  } catch (e) {
    if (!dry) throw e;
    // A dry run with a read only key can not see notifications.
    console.log(`(could not read the cards already sent: ${String(e.message).slice(0, 80)})`);
    sent = [];
  }
  const already = new Map(sent.map(r => [r.target_id, r.id]));

  if (dry) {
    const edits = [...activity.values()].reduce((n, s) => n + s.total, 0);
    const cellSum = [...cells.values()].reduce((n, s) => n + s.count, 0);
    console.log(`DRY RUN: ${month.label}: ${edits} edits by ${editRank.size} players, ${cellSum} cells by ${cellRank.size} players, ${recipients.length} recaps.`);
    console.log('Biggest months:');
    for (const x of [...cards].sort((p, q) => q.total - p.total || q.cells - p.cells).slice(0, 10)) {
      console.log(`  ${x.name}: ${x.total} edits, ${x.cells} cells, best streak ${x.streak}, ${x.got} achievements`);
    }
    const sample = cards.find(x => x.name === (process.env.RECAP_SHOW || 'Nseraf')) ?? cards[0];
    console.log(`\nCard for ${sample.name}:\n${title}\n${sample.row.body}\n`);
    console.log(`DRY RUN: ${already.size} already sent (would ${correct ? 'be corrected' : 'be left alone'}); ${cards.filter(x => !already.has(x.uid)).length} new would be sent.`);
    return;
  }

  if (correct && already.size) {
    let fixed = 0;
    for (const x of cards) {
      if (!already.has(x.uid)) continue;
      await db.send('PATCH', `notifications?id=eq.${already.get(x.uid)}`, { body: x.row.body });
      fixed++;
    }
    console.log(`Corrected ${fixed} recap(s) already sent for ${month.label}.`);
  }
  const fresh = cards.filter(x => !already.has(x.uid)).map(x => x.row);
  if (already.size) console.log(`${cards.length - fresh.length} already have this ${span}'s recap; not sending a second.`);
  for (let i = 0; i < fresh.length; i += 50) {
    await db.send('POST', 'notifications', fresh.slice(i, i + 50));
    console.log(`Inserted notifications ${i + 1} to ${Math.min(i + 50, fresh.length)}`);
  }
  console.log(`Done! Sent ${fresh.length} monthly recap notification(s).`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
