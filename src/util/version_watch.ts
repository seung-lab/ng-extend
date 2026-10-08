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
/** When this page loaded: changes that went live after it are the news. */
const PAGE_LOADED = Date.now();

/**
 * What changed, for players: static/changelog.json, newest first. `since`
 * are the entries that went live after this page loaded. When none carries a
 * later time (a deploy nobody wrote up), `latest` are the newest few instead,
 * so the box is never empty.
 */
export async function readChanges(): Promise<{ since: ChangeEntry[]; latest: ChangeEntry[] }> {
  try {
    const res = await fetch(`/changelog.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { since: [], latest: [] };
    const raw = await res.json();
    const entries: ChangeEntry[] = (Array.isArray(raw?.entries) ? raw.entries : [])
      .filter((e: any) => e && typeof e.title === 'string' && Array.isArray(e.items) && !Number.isNaN(Date.parse(e.at)))
      .map((e: any) => ({ at: String(e.at), title: String(e.title).slice(0, 80), items: e.items.filter((i: any) => typeof i === 'string').map((i: string) => i.slice(0, 240)).slice(0, 8) }))
      .sort((a: ChangeEntry, b: ChangeEntry) => Date.parse(b.at) - Date.parse(a.at));
    // A minute of slack: an entry is written just before its deploy finishes.
    return { since: entries.filter(e => Date.parse(e.at) > PAGE_LOADED - 60_000).slice(0, 12), latest: entries.slice(0, 3) };
  } catch { return { since: [], latest: [] }; }
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
  setInterval(() => { if (!document.hidden) void check(); }, EVERY_MS);
  // Coming back to the tab after a while is when a player is most likely behind.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
}

/** A plain reload fetches the new page; the bundles carry their own version. */
export function reloadForUpdate() {
  window.location.reload();
}
