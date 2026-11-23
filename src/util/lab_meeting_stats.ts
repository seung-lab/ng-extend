/**
 * Numbers for the lab meeting preview (Ames 2026-11-22: a 3 minute teaser at
 * the open lab meeting on Nov 23, ending with "join lab meeting on December 7
 * for the full tour"). Admins only, from the menu.
 *
 * A snapshot read from the database on 2026-11-22 carries the monthly
 * history; the totals are read again when the show opens, so it is current
 * on the day. Edits and cells count the way the community milestones do
 * (successful merges and cuts; ew_cell_completions).
 */
export interface Month { m: string; label: string; edits: number; cells: number; joined: number; }
export interface TutorialRow { name: string; players: number; }
export interface StreakRow { name: string; days: number; live: boolean; }
export interface LabStats {
  signedIn: number;
  editors: number;
  edits: number;
  cells: number;
  tags: number;
  chats: number;
  achievements: number;
  reports: number;
  topStreak: number;
  playerDays: number;
  tutorialsDone: number;
  tutorialPlayers: number;
  tutorials: TutorialRow[];
  months: Month[];
  byDataset: { retina: number; mec: number; sandbox: number };
  commits: number | null;
  deploys: number | null;
  /** Longest daily streaks of the alpha testers, staff left out. */
  streaks: StreakRow[];
}

/** The last lab meeting was in May, so "then" is everything up to the end of May. */
export const THEN_MONTH = '2026-05';

const MONTHS: Month[] = [
  { m: '2026-03', label: 'Mar', edits: 728, cells: 63, joined: 11 },
  { m: '2026-04', label: 'Apr', edits: 224, cells: 20, joined: 7 },
  { m: '2026-05', label: 'May', edits: 53, cells: 5, joined: 0 },
  { m: '2026-06', label: 'Jun', edits: 0, cells: 0, joined: 0 },
  { m: '2026-07', label: 'Jul', edits: 135, cells: 6, joined: 5 },
  { m: '2026-08', label: 'Aug', edits: 7, cells: 0, joined: 0 },
  { m: '2026-09', label: 'Sep', edits: 59, cells: 16, joined: 8 },
  { m: '2026-10', label: 'Oct', edits: 30625, cells: 2978, joined: 24 },
  { m: '2026-11', label: 'Nov', edits: 29138, cells: 1113, joined: 61 },
];

const NAMES: Record<number, string> = {
  1: 'Get Started', 2: 'Advanced Interface', 3: 'Merge', 4: 'Site Tour', 5: 'Cut',
  6: 'Meet the cells of MEC', 7: 'Meet the cells of the retina', 8: 'Meet the cells of the fly brain',
  9: 'Merger Sandbox', 10: 'Meet the cells of CA3', 11: 'Proofreading Test', 13: 'Extension Sandbox',
  14: 'Cilia Quest Training', 15: 'Annotations',
};

const SNAPSHOT_TUTORIALS: Record<number, number> = {
  1: 51, 2: 17, 3: 23, 4: 5, 5: 21, 6: 5, 7: 11, 8: 6, 9: 19, 10: 4, 13: 13, 14: 11, 15: 6,
};

function tutorialRows(counts: Record<number, number>): TutorialRow[] {
  return Object.entries(counts)
    .map(([t, n]) => ({ name: NAMES[Number(t)] ?? `Tutorial ${t}`, players: n }))
    .sort((a, b) => b.players - a.players);
}

export const SNAPSHOT: LabStats = {
  signedIn: 116,
  editors: 56,
  edits: 60952,
  cells: 4201,
  tags: 22686,
  chats: 8580,
  achievements: 800,
  reports: 677,
  topStreak: 46,
  playerDays: 636,
  tutorialsDone: 444,
  tutorialPlayers: 57,
  tutorials: tutorialRows(SNAPSHOT_TUTORIALS),
  months: MONTHS,
  byDataset: { retina: 50683, mec: 7374, sandbox: 2909 },
  commits: null,
  deploys: null,
  streaks: [
    { name: 'Krzysztof Kruk', days: 46, live: true },
    { name: 'Nseraf', days: 39, live: true },
    { name: 'AzureJay', days: 30, live: true },
    { name: 'toknow', days: 30, live: false },
    { name: 'Giedrius Trakimas', days: 25, live: true },
    { name: 'st0ck53y', days: 21, live: true },
    { name: 'hi529', days: 19, live: true },
    { name: 'Kim Fenley', days: 13, live: false },
    { name: 'annkri', days: 13, live: false },
  ],
};
/** Staff, left off the streak board. */
const STAFF = new Set(['Amy R. Sterling']);

/** Everything up to and including the last lab meeting's month. */
export function thenTotals(s: LabStats) {
  const upTo = s.months.filter(m => m.m <= THEN_MONTH);
  return {
    edits: upTo.reduce((a, m) => a + m.edits, 0),
    cells: upTo.reduce((a, m) => a + m.cells, 0),
    joined: upTo.reduce((a, m) => a + m.joined, 0),
  };
}

/** Fresh totals where the database lets this browser read them; the snapshot
 *  for the rest. Never throws. The newest month absorbs any change, so the
 *  monthly history still adds up to the total. */
export async function loadLabStats(): Promise<LabStats> {
  const s: LabStats = { ...SNAPSHOT, months: SNAPSHOT.months.map(m => ({ ...m })), byDataset: { ...SNAPSHOT.byDataset }, streaks: SNAPSHOT.streaks.map(r => ({ ...r })) };
  const settle = <T,>(p: PromiseLike<T>) => Promise.resolve(p).then(v => v, () => null);
  try {
    const { supabase } = await import('../supabase');
    const [prog, tuts, users, chats, reports, streakRows] = await Promise.all([
      settle(supabase.from('community_progress').select('track,count')),
      settle(supabase.from('tutorial_completions').select('tutorial,user_id').limit(20000)),
      settle(supabase.from('users').select('id', { count: 'exact', head: true })),
      settle(supabase.from('chat_messages').select('id', { count: 'exact', head: true })),
      settle(supabase.from('site_issues').select('id', { count: 'exact', head: true })),
      settle(supabase.from('users').select('display_name,username,longest_streak,current_streak').gte('longest_streak', 7).order('longest_streak', { ascending: false }).limit(20)),
    ]);
    const rows = (prog as any)?.data as { track: string; count: number }[] | undefined;
    for (const r of rows ?? []) {
      if (r.track === 'cells' && r.count > 0) s.cells = r.count;
      if (r.track === 'edits' && r.count > 0) s.edits = r.count;
      if (r.track === 'players' && r.count > 0) s.editors = r.count;
    }
    const last = s.months[s.months.length - 1];
    const sum = (k: 'edits' | 'cells') => s.months.slice(0, -1).reduce((a, m) => a + m[k], 0);
    last.edits = Math.max(0, s.edits - sum('edits'));
    last.cells = Math.max(0, s.cells - sum('cells'));

    const t = (tuts as any)?.data as { tutorial: number; user_id: string }[] | undefined;
    if (t && t.length >= SNAPSHOT.tutorialsDone) {
      const per = new Map<number, Set<string>>(), all = new Set<string>();
      for (const r of t) {
        if (!per.has(r.tutorial)) per.set(r.tutorial, new Set());
        per.get(r.tutorial)!.add(r.user_id); all.add(r.user_id);
      }
      const counts: Record<number, number> = {};
      per.forEach((v, k) => { if (NAMES[k]) counts[k] = v.size; });
      s.tutorials = tutorialRows(counts);
      s.tutorialsDone = t.length;
      s.tutorialPlayers = all.size;
    }
    const n = (x: unknown) => (x as any)?.count as number | null | undefined;
    const u = n(users);
    if (u && u >= SNAPSHOT.signedIn) {
      last.joined += u - SNAPSHOT.signedIn;
      s.signedIn = u;
    }
    const c = n(chats); if (c && c >= SNAPSHOT.chats) s.chats = c;
    const r = n(reports); if (r && r >= SNAPSHOT.reports) s.reports = r;
    const sr = (streakRows as any)?.data as { display_name: string | null; username: string | null; longest_streak: number; current_streak: number }[] | undefined;
    if (sr && sr.length) {
      const rows = sr.map(u => ({ name: u.display_name || u.username || 'A tester', days: u.longest_streak, live: u.current_streak >= u.longest_streak }))
        .filter(u => !STAFF.has(u.name)).slice(0, 9);
      if (rows.length >= 3) { s.streaks = rows; s.topStreak = rows[0].days; }
    }
  } catch { /* the snapshot stands */ }
  try {
    const { loadRepoStats } = await import('./repo_stats');
    const rs = await Promise.race([loadRepoStats(), new Promise<null>(res => setTimeout(() => res(null), 4000))]);
    if (rs) { s.commits = rs.commits; s.deploys = rs.deploys; }
  } catch { /* GitHub unreachable: the tile is left out */ }
  return s;
}
