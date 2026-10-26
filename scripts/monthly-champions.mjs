#!/usr/bin/env node
/**
 * monthly-champions.mjs
 * "Monthly Champions": one notification to everyone (target_type 'all', the
 * bell's Pyr Updates tab) on the 1st, with the month's top 20 editors and top
 * 20 cell completers (Ames 2026-10-25). The weekly one is
 * scripts/weekly-leaderboard-broadcast.mjs, and its body shape is kept so
 * the feed draws the same podium (NotificationFeedPanel.vue parseChampions).
 *
 * The month is 1st 00:00 ET up to the next 1st (scripts/recap-month.mjs).
 * Edits: merges and cuts from edit_log, a page at a time. Cells: the
 * leaderboard's rule (ew_cell_completions), the rule ew_weekly_ranking and
 * scripts/weekly-completions.mjs use. Ties: whoever reached the count first.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/monthly-champions.mjs
 * Pyr Year Champions (Ames 2026-10-26): RECAP_PERIOD=year does the same for a
 * Pyr year (Sep 28 to Sep 28 ET, scripts/recap-month.mjs yearRange), with
 * the year's trophies and an anniversary cheer. RECAP_YEAR=n picks one.
 * Env: RECAP_MONTH=YYYY-MM (default: last month), RECAP_DRY=true (print
 * only), RECAP_CORRECT=true (rewrite the month's broadcast in place),
 * RECAP_TEST_TO=<user ids, comma separated> (send it to each of them, titled "(test)").
 */

import { periodFromEnv, supabaseClient, monthActivity, monthCells, ranked } from './recap-month.mjs';

const db = supabaseClient();
const ART = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/champions';
const PLACES = ['gold', 'silver', 'bronze'];
const PLACE_WORD = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const PLACE_NTH = { gold: '1st', silver: '2nd', bronze: '3rd' };

/** The month's top three for edits and for cells become Achievements, the
 *  way a Hunt gives its medals (functions/hunts.js): one Special Award per
 *  month and place, so the profile's Competitions shelf counts them (Ames
 *  2026-10-26: cups for edits, neuron awards for cells). Each new winner gets
 *  a New Achievement card. Safe to run again: an award held is not given or
 *  announced twice. */
/** One award's row in special_badges. */
function awardBadge(month, metric, place, art, what) {
  return {
    slug: `${month.key}-${metric}-${place}`,
    name: `${month.label} ${what}: ${PLACE_WORD[place]}`,
    description: `${PLACE_NTH[place]} for ${metric === 'edits' ? 'edits' : 'cells completed'} in ${month.label}.`,
    image_url: `${ART}/${place}-${art}.png`,
    thumbnail_url: `${ART}/${place}-${art}.png`,
  };
}

async function giveMonthlyAwards(month, lists, names, dry) {
  for (const { metric, rows, art, what, unit } of lists) {
    for (const [i, r] of rows.slice(0, 3).entries()) {
      const place = PLACES[i];
      const badge = awardBadge(month, metric, place, art, what);
      const reason = `${PLACE_NTH[place]} in ${month.label} with ${r.count.toLocaleString('en-US')} ${unit}`;
      console.log(`[awards] ${badge.name}: ${names.get(r.user_id) || r.user_id} (${reason})`);
      if (dry) continue;
      const [saved] = await db.send('POST', 'special_badges?on_conflict=slug', badge, 'resolution=merge-duplicates,return=representation');
      const held = await db.get(`special_badge_awards?select=id&badge_id=eq.${saved.id}&user_id=eq.${r.user_id}&limit=1`);
      if (held.length) continue;
      await db.send('POST', 'special_badge_awards?on_conflict=badge_id,user_id',
        [{ badge_id: saved.id, user_id: r.user_id, awarded_by: null, reason }], 'resolution=ignore-duplicates,return=minimal');
      await db.send('POST', 'notifications', {
        title: `🏅 New Achievement: ${badge.name}`,
        body: `You earned the "${badge.name}" award! ${reason}. Thank you for mapping the brain with us.`,
        image_url: badge.image_url, thumbnail_url: badge.thumbnail_url,
        target_type: 'user', target_id: r.user_id, send_at: new Date().toISOString(), post_to_chat: false,
      });
    }
  }
}
/** The six award rows of a period, given to no one (RECAP_PREPARE). */
async function prepareAwards(month, isYear) {
  for (const [metric, art, what] of [['edits', isYear ? 'year-award' : 'cup', 'Top Editor'], ['cells', isYear ? 'year-trophy' : 'award', 'Top Contributor']]) {
    for (const place of PLACES) {
      const badge = awardBadge(month, metric, place, art, what);
      console.log(`[awards] preparing ${badge.name} (${badge.slug})`);
      if (process.env.RECAP_DRY !== 'true') await db.send('POST', 'special_badges?on_conflict=slug', badge, 'resolution=merge-duplicates,return=minimal');
    }
  }
}
const MEDALS = ['🥇', '🥈', '🥉'];

function formatList(rows, names, one, many, span = 'month') {
  if (rows.length === 0) return `_no activity this ${span}_`;
  // "🥇  **Name**, 19 edits": the line parseChampions reads.
  return rows.map((r, i) => `${i < 3 ? MEDALS[i] : `${i + 1}.`}  **${names.get(r.user_id) || 'Anonymous'}**, ${r.count.toLocaleString('en-US')} ${r.count === 1 ? one : many}`).join('\n');
}

async function main() {
  const month = periodFromEnv();   // a month, or a Pyr year
  const isYear = month.kind === 'year';
  const span = isYear ? 'year' : 'month';
  console.log(`[champions] ${month.label} (${month.startISO} to ${month.endISO})`);

  const [activity, cells] = await Promise.all([monthActivity(db, month), monthCells(db, month)]);
  const editors = ranked(activity, 'total').slice(0, 20);
  const completers = ranked(cells, 'count').slice(0, 20);
  if (!editors.length && !completers.length) { console.log(`[champions] No activity this ${span}, nothing to post.`); return; }

  const ids = [...new Set([...editors, ...completers].map(r => r.user_id))];
  const names = new Map((await db.get(`users?select=id,display_name&id=in.(${ids.join(',')})`)).map(u => [u.id, u.display_name || 'Anonymous']));

  const testTo = (process.env.RECAP_TEST_TO || '').split(',').map(x => x.trim()).filter(Boolean);
  // RECAP_PREPARE=true: make the period's six awards so they can be seen in
  // Admin Hub before anyone wins them (Ames 2026-10-26), and stop there.
  if (process.env.RECAP_PREPARE === 'true') {
    await prepareAwards(month, isYear);
    return;
  }
  // Awards first, and never on a test run (they are real Achievements).
  if (!testTo.length) {
    await giveMonthlyAwards(month, [
      { metric: 'edits', rows: editors, art: isYear ? 'year-award' : 'cup', what: 'Top Editor', unit: 'edits' },
      { metric: 'cells', rows: completers, art: isYear ? 'year-trophy' : 'award', what: 'Top Contributor', unit: 'cells' },
    ], names, process.env.RECAP_DRY === 'true');
  }
  const title = `🏆 ${isYear ? 'Pyr Year Champions' : 'Monthly Champions'}, ${month.label}${testTo.length ? ' (test)' : ''}`;
  const body = [
    isYear ? `🎉 **Happy birthday, Pyr! Thank you for a whole year of neuroscience!**`
      : `🎉 **Big Congratulations! Thanks for contributing to neuroscience!**`,
    ``,
    `**Top Editors**`,
    formatList(editors, names, 'edit', 'edits', span),
    ``,
    `**Top Completers**`,
    formatList(completers, names, 'cell', 'cells', span),
    ``,
    isYear ? `${month.dates}. Every edit and every completion this year brought the connectome closer to done. Here's to the next one! 🧬`
      : `Across all datasets, every edit and every completion brings the connectome a little closer to done. Thank you for a wonderful month! 🧬`,
  ].join('\n');

  // One broadcast per month, found by its title.
  const dry = process.env.RECAP_DRY === 'true';
  let existing;
  try {
    existing = testTo.length ? [] : await db.get(`notifications?select=id,body&target_type=eq.all&title=eq.${encodeURIComponent(title)}&limit=1`);
  } catch (e) {
    if (!dry) throw e;
    console.log(`(could not read the broadcasts already sent: ${String(e.message).slice(0, 80)})`);
    existing = [];
  }
  if (dry) {
    console.log(`[champions] DRY RUN, ${existing.length ? 'already posted, would ' + (process.env.RECAP_CORRECT === 'true' ? 'correct it to' : 'leave it; it would be') : 'would post'}:\n${title}\n${body}`);
    return;
  }
  if (existing.length) {
    if (process.env.RECAP_CORRECT !== 'true') { console.log(`[champions] ${title} is already posted, leaving it.`); return; }
    if (existing[0].body === body) { console.log('[champions] Saved broadcast already matches.'); return; }
    await db.send('PATCH', `notifications?id=eq.${existing[0].id}`, { body });
    console.log(`[champions] Corrected the saved broadcast for ${month.label}.`);
    return;
  }
  const row = { title, body, target_type: 'all', target_id: null, send_at: new Date().toISOString(), post_to_chat: false };
  await db.send('POST', 'notifications', testTo.length ? testTo.map(id => ({ ...row, target_type: 'user', target_id: id })) : row);
  console.log(`[champions] Posted ${title}: ${editors.length} editors, ${completers.length} completers.`);
}

main().catch(err => {
  console.error('[champions] Fatal:', err.message);
  process.exit(1);
});
