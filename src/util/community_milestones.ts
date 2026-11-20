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

export type Track = 'cells' | 'edits' | 'players' | 'fragments';

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
/** The line under CONGRATS! The server's notification uses the same words. */
export function milestoneLine(track: Track, m: number): string {
  if (track === 'cells') return `Together we just completed ${fmt(m)} cells.`;
  if (track === 'edits') return `Together we just made ${fmt(m)} edits.`;
  if (track === 'players') return `Together we are now ${fmt(m)} players strong.`;
  return `Together we just completed ${fmt(m)} Lost Fragments.`;
}
/** The line split around the number, for the banner to light it up. */
export function milestoneParts(track: Track, m: number): [string, string, string] {
  const line = milestoneLine(track, m), num = fmt(m), at = line.indexOf(num);
  return [line.slice(0, at), num, line.slice(at + num.length)];
}
export const TRACK_NAME: Record<Track, string> = { cells: 'cells', edits: 'edits', players: 'players', fragments: 'Lost Fragments' };

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

/** Ask for a celebration with confetti, unless this browser has had it or
 *  another is up. */
export function celebrate(track: Track, value: number) {
  if (value <= 0 || value <= seenUpTo(track) || celebration.value) return;
  celebration.value = { track, value, confetti: true };
}
/** Bring one back from its notification: no confetti, no Nurro. */
export function reopen(track: Track, value: number) {
  celebration.value = { track, value, confetti: false };
}

// ── Reading the server ──────────────────────────────────────────────────────
/** A milestone older than this is not celebrated on a first visit; its
 *  notification is still there. */
const FRESH_MS = 14 * 24 * 3600 * 1000;
interface MilestoneRow { track: string; value: number; reached_at: string; banner: boolean; }

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
    // The newest one with a banner this browser has not had.
    for (const r of ms.data as MilestoneRow[]) {
      const t = r.track as Track;
      if (!r.banner || !['cells', 'edits', 'players'].includes(t)) continue;
      if (r.value > seenUpTo(t)) { celebrate(t, r.value); break; }
    }
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
