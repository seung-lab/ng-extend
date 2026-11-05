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

import { etMidnight, etDay } from './recap-month.mjs';

/** [startISO, endISO) of the Monday to Sunday week on US Eastern time that
 *  starts on weekStart ("YYYY-MM-DD", a Monday), or the most recently
 *  completed one. ET like every other week and month in Pyr (Ames
 *  2026-10-26: "fix it all to ET"); it was UTC, which ended the champions'
 *  week at 7 or 8 pm Sunday in New York. */
export function weekRange(weekStart) {
  let y, m, d;
  if (weekStart) {
    const t = new Date(`${weekStart}T00:00:00Z`);
    if (Number.isNaN(t.getTime()) || t.getUTCDay() !== 1) throw new Error(`week_start must be a Monday (YYYY-MM-DD), got ${weekStart}`);
    [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()];
  } else {
    const [ty, tm, td] = etDay(Date.now()).split('-').map(Number);
    const today = new Date(Date.UTC(ty, tm - 1, td));
    const dow = today.getUTCDay() || 7;            // Sun -> 7
    const mon = new Date(Date.UTC(ty, tm - 1, td - (dow - 1) - 7));
    [y, m, d] = [mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate()];
  }
  const start = etMidnight(y, m, d), end = etMidnight(y, m, d + 7);
  const ymd = new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  return { weekStart: ymd, startISO: start.toISOString(), endISO: end.toISOString() };
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

/** Top N completers of [startISO, endISO). get(path) reads the Supabase REST API.
 *  The leaderboard's rule (ew_cell_completions), read a page at a time. The
 *  database's ew_weekly_ranking counts UTC weeks, so it is no longer used here.
 *  Ties: whoever reached the count first, then the lower id. */
export async function topCompleters(get, startISO, endISO, n = 10) {
  const rows = [];
  for (let from = 0; from < 1000000; from += 1000) {
    const page = await get(`ew_cell_completions?select=user_id,done_at` +
      `&done_at=gte.${encodeURIComponent(startISO)}&done_at=lt.${encodeURIComponent(endISO)}` +
      `&order=user_id.asc,dataset.asc,cell.asc&offset=${from}&limit=1000`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const by = new Map();
  for (const r of rows) {
    const c = by.get(r.user_id) ?? { count: 0, at: 0 };
    c.count++; c.at = Math.max(c.at, Date.parse(r.done_at));
    by.set(r.user_id, c);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1))
    .slice(0, n).map(([user_id, c]) => ({ user_id, count: c.count }));
}

/** Top N editors (merges and cuts) of [startISO, endISO), a page at a time.
 *  Ties as above. */
export async function topEditors(get, startISO, endISO, n = 10) {
  const by = new Map();
  for (let from = 0; from < 5000000; from += 1000) {
    const page = await get(`edit_log?select=id,user_id,timestamp` +
      `&timestamp=gte.${encodeURIComponent(startISO)}&timestamp=lt.${encodeURIComponent(endISO)}` +
      `&operation=in.(split,merge)&success=not.is.false&order=id.asc&offset=${from}&limit=1000`);
    for (const r of page) {
      if (!r.user_id) continue;
      const c = by.get(r.user_id) ?? { count: 0, at: 0 };
      c.count++; c.at = Math.max(c.at, Date.parse(r.timestamp));
      by.set(r.user_id, c);
    }
    if (page.length < 1000) break;
  }
  return [...by.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1))
    .slice(0, n).map(([user_id, c]) => ({ user_id, count: c.count }));
}
