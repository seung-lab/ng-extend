/**
 * weekly-completions.mjs
 * The one count of "cells completed in a week", shared by the weekly
 * champions broadcast and the saved podium (weekly_winners), so the two can
 * never disagree. On 2026-10-05 they both credited Annkri with 5 cells
 * instead of 9, and the podium left her out: the podium counted from the
 * CAVE mirror (which lags by up to two days and never sees MEC), and the
 * weekly job ran an old copy of the broadcast script from the default branch.
 *
 * Counting rule, the same as the leaderboard view
 * (supabase-leaderboard-completions-from-log.sql): the app's own log,
 * edit_log. One cell = one distinct root id per player; a row with no id
 * counts only when no id-carrying completion by that player sits within two
 * minutes of it. A cell marked and then un-marked does not count; marked
 * again after, it does. Failed operations never count.
 */

/** [startISO, endISO) of the Monday to Sunday week (UTC) that starts on
 *  weekStart ("YYYY-MM-DD", a Monday), or the most recently completed one. */
export function weekRange(weekStart) {
  let monday;
  if (weekStart) {
    monday = new Date(`${weekStart}T00:00:00Z`);
    if (Number.isNaN(monday.getTime()) || monday.getUTCDay() !== 1) throw new Error(`week_start must be a Monday (YYYY-MM-DD), got ${weekStart}`);
  } else {
    const now = new Date();
    const dow = now.getUTCDay() || 7; // Sun -> 7
    monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1) - 7));
  }
  const end = new Date(monday); end.setUTCDate(monday.getUTCDate() + 7);
  return { weekStart: monday.toISOString().slice(0, 10), startISO: monday.toISOString(), endISO: end.toISOString() };
}

/** Cells per player from edit_log rows, most first. Ties go to whoever
 *  reached the count first. */
export function countCompletions(rows) {
  const idOf = r => r.metadata?.final_segment_id ?? r.metadata?.root_id ?? r.metadata?.segment_id ?? null;
  const good = rows.filter(r => r.user_id && r.success !== false);
  const lastUnmark = new Map();                  // user_id|cell -> newest un-mark time
  for (const r of good) {
    if (r.operation !== 'unmark_complete' || r.metadata?.root_id == null) continue;
    const k = r.user_id + '|' + r.metadata.root_id, t = Date.parse(r.timestamp);
    if (!(lastUnmark.get(k) >= t)) lastUnmark.set(k, t);
  }
  const ok = good.filter(r => r.operation !== 'unmark_complete');
  const cells = new Map();                       // user_id -> Map(cell -> first time)
  for (const r of ok) {
    let cell = idOf(r);
    const t = Date.parse(r.timestamp);
    if (cell == null) {
      const paired = ok.some(d => d.user_id === r.user_id && idOf(d) != null &&
        Math.abs(Date.parse(d.timestamp) - t) <= 120_000);
      if (paired) continue;
      cell = 'at:' + new Date(t).toISOString().slice(0, 16);
    }
    if (lastUnmark.get(r.user_id + '|' + cell) >= t) continue;
    if (!cells.has(r.user_id)) cells.set(r.user_id, new Map());
    const mine = cells.get(r.user_id), key = String(cell);
    if (!(mine.get(key) <= t)) mine.set(key, t);
  }
  return [...cells.entries()]
    .map(([user_id, mine]) => ({ user_id, count: mine.size, reachedAt: Math.max(...mine.values()) }))
    .sort((a, b) => b.count - a.count || a.reachedAt - b.reachedAt);
}

/** Top N completers of [startISO, endISO). get(path) reads the Supabase REST API. */
export async function topCompleters(get, startISO, endISO, n = 10) {
  // The database's own rule, when it is installed (ew_weekly_ranking in
  // supabase-leaderboard-accuracy.sql): the rule the board's view reads, so
  // the week's count is decided in one place. It also looks at a player's
  // whole history, which the rows of one week can not: a cell first completed
  // last month and marked again this week is not a new cell. Until that SQL
  // is run, the count below is used, as before.
  try {
    const ranked = await get(`rpc/ew_weekly_ranking?p_week_start=${startISO.slice(0, 10)}&p_metric=completions&p_limit=${n}`);
    if (Array.isArray(ranked)) return ranked.map(r => ({ user_id: r.user_id, count: r.count }));
  } catch (e) {
    if (!/\b404\b/.test(String(e?.message))) throw e;
  }
  const rows = await get(
    `edit_log?select=user_id,operation,timestamp,metadata,success` +
    `&timestamp=gte.${encodeURIComponent(startISO)}` +
    `&timestamp=lt.${encodeURIComponent(endISO)}` +
    `&operation=in.(complete_task,mark_complete,unmark_complete)` +
    `&limit=200000`,
  );
  return countCompletions(rows).slice(0, n).map(({ user_id, count }) => ({ user_id, count }));
}
