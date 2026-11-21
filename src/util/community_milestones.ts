/**
 * Community milestones (Ames 2026-11-20: "one time confetti and banner that
 * goes away when you click but can be brought back via a notif. But not every
 * day! It should be rarer milestones.").
 *
 * The server counts and decides (supabase-community-milestones.sql, hourly):
 * community_progress holds the count per track, community_milestones one row
 * per milestone reached, with banner false when another banner went out in the
 * week before. Lost Fragments counts on Firebase and comes in through
 * util/fragment_milestones.ts, into the same banner.
 *
 * Each celebration shows once per browser, then a click closes it; its
 * notification brings it back (#nge-milestone=cells:5000), with no confetti.
 */
import { ref } from 'vue';
import { takeTurn } from './popup_queue';

export type Track = 'cells' | 'edits' | 'players' | 'fragments' | 'summary';
/** 'summary' is a one-off: everything Pyr has done so far, sent once as a
 *  test of the celebration (Ames 2026-11-20). Its value is just an id. */

/** The highest milestone at or below n, or 0 for none yet. Matches
 *  ew_community_milestone_at in the SQL. */
export function milestoneAt(track: Track, n: number): number {
  if (track === 'cells') return Math.floor(n / 5000) * 5000;
  if (track === 'edits') return Math.floor(n / 100000) * 100000;
  if (track === 'players') return n < 100 ? 0 : n < 250 ? 100 : n < 500 ? 250 : Math.floor(n / 500) * 500;
  return n < 500 ? 0 : n < 1000 ? 500 : Math.floor(n / 1000) * 1000;
}
/** The next milestone above n. */
export function nextMilestoneAfter(track: Track, n: number): number {
  if (track === 'cells') return (Math.floor(n / 5000) + 1) * 5000;
  if (track === 'edits') return (Math.floor(n / 100000) + 1) * 100000;
  if (track === 'players') return n < 100 ? 100 : n < 250 ? 250 : n < 500 ? 500 : (Math.floor(n / 500) + 1) * 500;
  return n < 500 ? 500 : (Math.floor(n / 1000) + 1) * 1000;
}

const fmt = (n: number) => n.toLocaleString('en-US');
/** The Pyr so far summary: the three community counts, as read. */
export function summaryStats(): { n: number; label: string }[] {
  const c = communityCounts.value, out: { n: number; label: string }[] = [];
  if (c.cells != null) out.push({ n: c.cells, label: 'cells completed' });
  if (c.edits != null) out.push({ n: c.edits, label: 'edits' });
  if (c.players != null) out.push({ n: c.players, label: 'players' });
  return out;
}
/** The line under CONGRATS! The server's notification uses the same words. */
export function milestoneLine(track: Track, m: number): string {
  if (track === 'cells') return `Together we just completed ${fmt(m)} cells.`;
  if (track === 'edits') return `Together we just made ${fmt(m)} edits.`;
  if (track === 'players') return `Together we are now ${fmt(m)} players strong.`;
  if (track === 'summary') return 'Everything Pyr has done so far, together.';
  return `Together we just completed ${fmt(m)} Lost Fragments.`;
}
/** The line split around the number, for the banner to light it up. */
export function milestoneParts(track: Track, m: number): [string, string, string] {
  const line = milestoneLine(track, m), num = fmt(m), at = line.indexOf(num);
  if (track === 'summary' || at < 0) return [line, '', ''];
  return [line.slice(0, at), num, line.slice(at + num.length)];
}
export const TRACK_NAME: Record<Track, string> = { cells: 'cells', edits: 'edits', players: 'players', fragments: 'Lost Fragments', summary: 'Pyr so far' };

/** Counts per track, once read. */
export const communityCounts = ref<Partial<Record<Track, number>>>({});

export interface Celebration { track: Track; value: number; confetti: boolean; }
/** What the banner shows now, or null. */
export const celebration = ref<Celebration | null>(null);

// ── Once per browser ────────────────────────────────────────────────────────
const SEEN_KEY = 'nge_community_milestones_seen_v1';
function seenMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
export function seenUpTo(track: Track): number {
  // Lost Fragments kept its own key before this; honor it.
  if (track === 'fragments') {
    let old = 0;
    try { old = Number(localStorage.getItem('nge_lf_milestone_seen_v1')) || 0; } catch { /* private mode */ }
    return Math.max(old, seenMap().fragments || 0);
  }
  return seenMap()[track] || 0;
}
export function markSeen(track: Track, value: number) {
  try {
    const m = seenMap();
    if (value > (m[track] || 0)) { m[track] = value; localStorage.setItem(SEEN_KEY, JSON.stringify(m)); }
  } catch { /* private mode */ }
}

/** Play a celebration on its own, unless this browser has had it. Nothing
 *  queues (Ames 2026-11-20: "we don't want them to queue up"): one that comes
 *  while another is up counts as seen and waits in its notification. */
export function celebrate(track: Track, value: number) {
  if (value <= 0 || value <= seenUpTo(track)) return;
  // Another milestone is up: this one counts as seen and waits in its
  // notification, so milestones never pile up behind each other (Ames:
  // "we don't want them to queue up"). Anything else on screen, it waits
  // for, so nobody misses it (Ames 2026-11-20: "I don't want ppl to miss the
  // banner!"): one popup at a time (popup_queue.ts), on arrival too.
  if (celebration.value || pendingMilestone) { markSeen(track, value); return; }
  pendingMilestone = true;
  void takeTurn('community-milestone', () => !!celebration.value && celebration.value.track === track && celebration.value.value === value, { priority: 4 })
    .then(ok => {
      pendingMilestone = false;
      if (ok && !celebration.value) celebration.value = { track, value, confetti: true };
      else markSeen(track, value);
    });
}
let pendingMilestone = false;
/** Play one from its notification, the whole celebration (Ames 2026-11-20:
 *  "If they click it, then it should play"). */
export function reopen(track: Track, value: number) {
  celebration.value = { track, value, confetti: true };
}

// ── Reading the server ──────────────────────────────────────────────────────
/** A milestone plays by itself only for players here within 7 days of it;
 *  after that it waits in their notifications and plays when clicked (Ames
 *  2026-11-20: "it should not autoplay ... they need to be on the site within
 *  7 days of the most recent notification"). */
const FRESH_MS = 7 * 24 * 3600 * 1000;
interface MilestoneRow { track: string; value: number; reached_at: string; banner: boolean; }

/** Just the counts, signed in or not (community_progress is readable by
 *  anyone), for the Pyr so far summary when it shows before sign-in. */
export async function loadCommunityCounts(): Promise<void> {
  const { supabase } = await import('../supabase');
  const prog = await supabase.from('community_progress').select('track,count');
  if (prog.error || !prog.data) return;
  const next = { ...communityCounts.value };
  for (const r of prog.data as { track: string; count: number }[]) {
    if (r.track === 'cells' || r.track === 'edits' || r.track === 'players') next[r.track] = r.count;
  }
  communityCounts.value = next;
}

export async function loadCommunityMilestones(): Promise<void> {
  const { supabase } = await import('../supabase');
  const since = new Date(Date.now() - FRESH_MS).toISOString();
  const [prog, ms] = await Promise.all([
    supabase.from('community_progress').select('track,count'),
    supabase.from('community_milestones').select('track,value,reached_at,banner').gte('reached_at', since).order('reached_at', { ascending: false }).limit(20),
  ]);
  if (!prog.error && prog.data) {
    const next = { ...communityCounts.value };
    for (const r of prog.data as { track: string; count: number }[]) {
      if (r.track === 'cells' || r.track === 'edits' || r.track === 'players') next[r.track] = r.count;
    }
    communityCounts.value = next;
  }
  if (!ms.error && ms.data) {
    // Only the newest one with a banner plays by itself, and only if this
    // browser has not had it. Every other recent one counts as seen, so none
    // queue up behind it; their notification is still there.
    const rows = (ms.data as MilestoneRow[]).filter(r => ['cells', 'edits', 'players', 'summary'].includes(r.track));
    // The one that plays counts as seen when its X is clicked, so a reload
    // before that shows it again.
    const newest = rows.find(r => r.banner);
    for (const r of rows) if (r !== newest && !(newest && r.track === newest.track && r.value >= newest.value)) markSeen(r.track as Track, r.value);
    if (newest) celebrate(newest.track as Track, newest.value);
  }
}

/** The track nearest its next milestone, for the Dataset Stats line. */
export function nearestMilestone(): { track: Track; next: number; toGo: number } | null {
  let best: { track: Track; next: number; toGo: number; frac: number } | null = null;
  for (const t of ['cells', 'edits', 'players'] as Track[]) {
    const n = communityCounts.value[t];
    if (n == null) continue;
    const next = nextMilestoneAfter(t, n), prev = milestoneAt(t, n);
    const frac = (n - prev) / Math.max(1, next - prev);
    if (!best || frac > best.frac) best = { track: t, next, toGo: next - n, frac };
  }
  return best && { track: best.track, next: best.next, toGo: best.toGo };
}
