/**
 * recap-month.mjs
 * What the monthly recap and the Monthly Champions share: the month, on US
 * Eastern time like the weekly recap (1st 00:00 ET up to the next 1st), and
 * reads that never stop at the server's 1,000-row cap (Nseraf, report 250).
 */

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const TZ = 'America/New_York';

/** The instant ET midnight starts on a calendar date (handles daylight saving).
 *  Same as etMidnight in src/util/recap_week.ts. */
export function etMidnight(y, m, d) {
  let t = Date.UTC(y, m, d, 5);   // 05:00 UTC is midnight EST; then correct by the real offset
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    t += Date.UTC(y, m, d) - shown;
  }
  return new Date(t);
}

/** The ET calendar date of an instant, as "YYYY-MM-DD". */
const DAY_FMT = new Map();
/** The calendar date of an instant in a time zone (ET by default), "YYYY-MM-DD". */
export function etDay(t, tz = TZ) {
  if (!DAY_FMT.has(tz)) {
    let f;
    try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { f = etDay.fallback ??= new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    DAY_FMT.set(tz, f);
  }
  return DAY_FMT.get(tz).format(new Date(t));
}

/** The month to report: "YYYY-MM" when given (RECAP_MONTH), otherwise the
 *  month that ended most recently in ET. m is 0 for January. */
export function monthRange(ym) {
  let y, m;
  if (ym) {
    const hit = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!hit || +hit[2] < 1 || +hit[2] > 12) throw new Error(`month must be YYYY-MM, got ${ym}`);
    y = +hit[1]; m = +hit[2] - 1;
  } else {
    const [ty, tm] = etDay(Date.now()).split('-').map(Number);
    y = tm === 1 ? ty - 1 : ty; m = tm === 1 ? 11 : tm - 2;
  }
  const start = etMidnight(y, m, 1);
  const end = etMidnight(m === 11 ? y + 1 : y, (m + 1) % 12, 1);
  return { y, m, label: `${MONTH_NAMES[m]} ${y}`, startISO: start.toISOString(), endISO: end.toISOString() };
}

/** Reads the Supabase REST API with the service key. */
export function supabaseClient() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const headers = {
    apikey: key,
    ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
    'Content-Type': 'application/json',
  };
  const get = async (path) => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  /** Every row, 1,000 at a time, in the order given (it must be total, so
   *  no row is skipped or read twice between pages). */
  const getAll = async (path, order) => {
    const rows = [];
    for (let from = 0; from < 5000000; from += 1000) {
      const page = await get(`${path}&order=${order}&offset=${from}&limit=1000`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  };
  /** An exact count with no rows read. */
  const count = async (path) => {
    const res = await fetch(`${url}/rest/v1/${path}`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } });
    if (!res.ok) throw new Error(`HEAD ${path}: ${res.status}`);
    return Number((res.headers.get('content-range') || '').split('/')[1]);
  };
  const send = async (method, path, body) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method, headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  };
  return { get, getAll, count, send };
}

const range = (col, r) => `&${col}=gte.${encodeURIComponent(r.startISO)}&${col}=lt.${encodeURIComponent(r.endISO)}`;

/** The month's log per player: merges and cuts, and when each logged action
 *  happened (for the best streak). Map(user_id -> { merges, splits, total,
 *  reachedAt, times: [ms] }). */
export async function monthActivity(db, r) {
  const rows = await db.getAll(`edit_log?select=user_id,operation,timestamp&success=not.is.false${range('timestamp', r)}`, 'id.asc');
  const stats = new Map();
  for (const row of rows) {
    if (!row.user_id) continue;
    const s = stats.get(row.user_id) ?? { merges: 0, splits: 0, total: 0, reachedAt: 0, times: [] };
    s.times.push(Date.parse(row.timestamp));
    if (row.operation === 'merge' || row.operation === 'split') {
      if (row.operation === 'merge') s.merges++; else s.splits++;
      s.total++;
      s.reachedAt = Math.max(s.reachedAt, Date.parse(row.timestamp));
    }
    stats.set(row.user_id, s);
  }
  return stats;
}

/** The longest run of days in a row with a logged action, counted in the
 *  player's own time zone like the streak counter (users.tz, ET if unknown). */
export function bestRun(times, tz) {
  const days = new Set(times.map(t => etDay(t, tz || TZ)));
  const t = [...days].map(d => Date.parse(`${d}T00:00:00Z`) / 86400000).sort((a, b) => a - b);
  let best = 0, run = 0;
  for (let i = 0; i < t.length; i++) {
    run = i > 0 && t[i] === t[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Cells completed per player over the month, the leaderboard's rule
 *  (ew_cell_completions): Map(user_id -> { count, reachedAt }). */
export async function monthCells(db, r) {
  const rows = await db.getAll(`ew_cell_completions?select=user_id,dataset,cell,done_at${range('done_at', r)}`, 'user_id.asc,dataset.asc,cell.asc');
  const cells = new Map();
  for (const row of rows) {
    const c = cells.get(row.user_id) ?? { count: 0, reachedAt: 0 };
    c.count++;
    c.reachedAt = Math.max(c.reachedAt, Date.parse(row.done_at));
    cells.set(row.user_id, c);
  }
  return cells;
}

/** Ranked, most first; ties go to whoever reached the count first, then the
 *  lower id (ew_weekly_ranking's order). entries: [user_id, { count|total, reachedAt? }]. */
export function ranked(map, key) {
  return [...map.entries()]
    .map(([user_id, s]) => ({ user_id, count: s[key], reachedAt: s.reachedAt ?? 0 }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count || a.reachedAt - b.reachedAt || (a.user_id < b.user_id ? -1 : 1));
}
