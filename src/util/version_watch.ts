/**
 * Notices when the game has been updated since this page loaded
 * (Ames 2026-10-07: several reports in one day were fixed by a refresh).
 *
 * Every deploy writes its commit to /build-commit.txt. The first read is the
 * version this page is running; a later read that differs means a newer one
 * is out. Nothing is ever reloaded for the player: VersionNotice.vue offers
 * it, and the report form mentions it.
 */
import { reactive } from 'vue';

export const version = reactive({
  /** The commit this page loaded with, or '' before the first read. */
  loaded: '',
  /** A newer commit that is live, or ''. */
  newer: '',
});

export interface ChangeEntry { at: string; title: string; items: string[]; }

async function fetchEntries(): Promise<ChangeEntry[] | null> {
  try {
    const res = await fetch(`/changelog.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw = await res.json();
    const now = Date.now();
    return (Array.isArray(raw?.entries) ? raw.entries : [])
      .filter((e: any) => e && typeof e.title === 'string' && Array.isArray(e.items) && !Number.isNaN(Date.parse(e.at)))
      // An entry dated ahead of the clock is a mistake in the file, not news.
      .filter((e: any) => Date.parse(e.at) <= now + 20 * 60_000)
      .map((e: any) => ({ at: String(e.at), title: String(e.title).slice(0, 80), items: e.items.filter((i: any) => typeof i === 'string').map((i: string) => i.slice(0, 240)).slice(0, 8) }));
  } catch { return null; }
}
const keyOf = (e: ChangeEntry) => `${e.at}|${e.title}`;

/**
 * The entries that were already in the list when this page loaded. What is
 * new is whatever is NOT among them, whatever its date says. (The first
 * version compared dates with the time the page loaded, so an entry dated a
 * few hours ahead showed as "new" on every load, and one dated a little early
 * never showed at all: Ames 2026-10-10.) Null until read, or if it could not
 * be: then the newest few are shown instead.
 */
let knownAtLoad: Set<string> | null = null;
async function rememberLoadedChanges() {
  const entries = await fetchEntries();
  if (entries) knownAtLoad = new Set(entries.map(keyOf));
}

/**
 * What changed, for players: static/changelog.json. `since` are the entries
 * added since this page loaded, newest first. When there are none (a deploy
 * nobody wrote up), `latest` are the newest few, so the box is never empty.
 */
export async function readChanges(): Promise<{ since: ChangeEntry[]; latest: ChangeEntry[] }> {
  const entries = await fetchEntries();
  if (!entries) return { since: [], latest: [] };
  const byNewest = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const known = knownAtLoad;
  return { since: known ? byNewest.filter(e => !known.has(keyOf(e))).slice(0, 12) : [], latest: byNewest.slice(0, 3) };
}

const EVERY_MS = 4 * 60_000;
let started = false;

async function read(): Promise<string> {
  try {
    const res = await fetch(`/build-commit.txt?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const text = (await res.text()).trim();
    return /^[0-9a-f]{7,40}$/.test(text) ? text : '';
  } catch { return ''; }
}

async function check() {
  const now = await read();
  if (!now) return;
  if (!version.loaded) { version.loaded = now; return; }
  if (now !== version.loaded) version.newer = now;
}

export function startVersionWatch() {
  if (started) return;
  started = true;
  void check();
  void rememberLoadedChanges();
  setInterval(() => { if (!document.hidden) void check(); }, EVERY_MS);
  // Coming back to the tab after a while is when a player is most likely behind.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
}

/** A plain reload fetches the new page; the bundles carry their own version. */
export function reloadForUpdate() {
  window.location.reload();
}
