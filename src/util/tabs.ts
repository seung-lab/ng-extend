/**
 * Which other Pyr tabs are open in this browser. Players often keep several
 * tabs open at once (Ames 2026-10-20), so anything a tab remembers in shared
 * browser storage must know whether another tab may be using it too.
 *
 * Each tab says hello on a BroadcastChannel when it opens, answers a hello,
 * and says goodbye when it closes. Same browser and site only.
 *
 * One leader tab per browser (Ames 2026-10-25: the database ran at full load
 * with every open tab asking the same questions every minute, hidden ones
 * too). The leader holds a Web Lock for as long as it is open; the browser
 * lets it go when the tab closes or crashes, and the next tab waiting gets it
 * at once. Only the leader runs the repeating checks, and it hands what it
 * read to the other tabs, so every tab still shows the same thing. Without
 * Web Locks or BroadcastChannel every tab is its own leader, as before.
 */
import { ref, type Ref } from 'vue';

const CHANNEL = 'pyr-tabs';
/** Other tabs, and whether each is hidden. */
const others = new Map<string, boolean>();
const me = Math.random().toString(36).slice(2) + Date.now().toString(36);
let channel: BroadcastChannel | null = null;

export function startTabs(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL);
  const say = (kind: string) => channel?.postMessage({ kind, id: me, hidden: document.hidden });
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data || {};
    if (typeof m.id !== 'string' || m.id === me) return;
    if (m.kind === 'hello') { others.set(m.id, !!m.hidden); say('here'); }
    else if (m.kind === 'here' || m.kind === 'seen') others.set(m.id, !!m.hidden);
    else if (m.kind === 'bye') others.delete(m.id);
  };
  say('hello');
  document.addEventListener('visibilitychange', () => say('seen'));
  window.addEventListener('pagehide', () => channel?.postMessage({ kind: 'bye', id: me }));
  mainLeader.join();
}

/** How many other Pyr tabs answered. Known a moment after this tab opens. */
export function otherTabCount(): number {
  return others.size;
}

/** Is any Pyr tab in this browser in front? The leader may be a hidden tab
 *  while the player looks at another, so the leader asks this instead of
 *  document.hidden alone. */
export function anyTabVisible(): boolean {
  if (!document.hidden) return true;
  for (const hidden of others.values()) if (!hidden) return true;
  return false;
}

// ── Leader election ─────────────────────────────────────────────────────
const shared = typeof BroadcastChannel !== 'undefined'
  && typeof navigator !== 'undefined' && !!(navigator as any).locks?.request;

/** takeover: this tab waited and got it because the leader went away, so the
 *  checks the old leader was keeping are due now. */
export type LeaderChange = (leader: boolean, takeover: boolean) => void;

export interface Leadership {
  /** True while this tab leads. Reactive. */
  readonly leader: Ref<boolean>;
  isLeader(): boolean;
  /** Stand for leader. Repeat calls do nothing. */
  join(): void;
  /** Step down, or stop waiting. */
  leave(): void;
  /** Returns a function that stops listening. */
  onChange(cb: LeaderChange): () => void;
}

const elections = new Map<string, Leadership>();

/** A leader among the tabs that join under this name. Tabs that only
 *  sometimes run a loop (chat is open in some tabs, not all) use their own
 *  name, so the leader is always a tab that runs it. */
export function leadership(name: string): Leadership {
  const known = elections.get(name);
  if (known) return known;
  const leader = ref(false);
  const listeners = new Set<LeaderChange>();
  let joined = false;
  let release: (() => void) | null = null;
  let abort: AbortController | null = null;
  let asking = false;
  const set = (v: boolean, takeover: boolean) => {
    if (leader.value === v) return;
    leader.value = v;
    for (const cb of [...listeners]) { try { cb(v, takeover); } catch (e) { console.warn('[tabs] leader change:', e); } }
  };
  // Held until released: the promise only settles when this tab steps down.
  const hold = (takeover: boolean) => new Promise<void>(res => {
    release = () => { release = null; res(); };
    set(true, takeover);
  });
  const request = () => {
    const locks = (navigator as any).locks;
    asking = true;
    // First ask without waiting, to tell a fresh start from a takeover.
    locks.request(name, { mode: 'exclusive', ifAvailable: true }, (lock: unknown) => {
      asking = false;
      if (!joined) return undefined;
      if (lock) return hold(false);
      abort = new AbortController();
      locks.request(name, { mode: 'exclusive', signal: abort.signal }, () => { abort = null; return joined ? hold(true) : undefined; })
        .catch(() => { /* stopped waiting */ });
      return undefined;
    }).catch(() => { asking = false; });
  };
  const stepDown = () => {
    if (abort) { abort.abort(); abort = null; }
    if (release) release();
    set(false, false);
  };
  const e: Leadership = {
    leader,
    isLeader: () => leader.value,
    join() {
      if (joined) return;
      joined = true;
      if (!shared) { set(true, false); return; }
      if (!asking) request();   // a first ask still on its way sees joined again
    },
    leave() {
      if (!joined) return;
      joined = false;
      if (!shared) { set(false, false); return; }
      stepDown();
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  if (shared) {
    // A frozen or cached page keeps no lock: it could not run the checks.
    const pause = () => { if (joined) stepDown(); };
    const resume = () => { if (joined && !release && !abort && !asking) request(); };
    document.addEventListener('freeze', pause);
    document.addEventListener('resume', resume);
    window.addEventListener('pagehide', (ev: PageTransitionEvent) => { if (ev.persisted) pause(); });
    window.addEventListener('pageshow', (ev: PageTransitionEvent) => { if (ev.persisted) resume(); });
  }
  elections.set(name, e);
  return e;
}

/** The whole-browser leader: every tab stands. */
const mainLeader = leadership('pyr-leader');

/** Does this tab run the shared repeating checks? */
export function isLeaderTab(): boolean {
  mainLeader.join();
  return mainLeader.isLeader();
}
/** Reactive form of isLeaderTab(). */
export const leaderTab = mainLeader.leader;
export function onLeaderChange(cb: LeaderChange): () => void {
  mainLeader.join();
  return mainLeader.onChange(cb);
}

// ── Results the leader shares ───────────────────────────────────────────
const resultsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pyr-shared') : null;
const topics = new Map<string, Set<(payload: any) => void>>();
if (resultsChannel) resultsChannel.onmessage = (e: MessageEvent) => {
  const m = e.data || {};
  if (typeof m.topic !== 'string' || m.from === me) return;
  for (const cb of [...(topics.get(m.topic) || [])]) { try { cb(m.payload); } catch (err) { console.warn('[tabs] shared result:', err); } }
};

/** Hand a result to the other tabs. Sent as plain JSON data: a Vue reactive
 *  object cannot be posted as it is. */
export function shareResult(topic: string, payload: unknown): void {
  if (!shared || !resultsChannel) return;
  try { resultsChannel.postMessage({ topic, from: me, payload: JSON.parse(JSON.stringify(payload)) }); }
  catch (e) { console.warn('[tabs] could not share', topic, e); }
}
/** Results another tab shared. Returns a function that stops listening. */
export function onSharedResult<T = any>(topic: string, cb: (payload: T) => void): () => void {
  let set = topics.get(topic);
  if (!set) topics.set(topic, set = new Set());
  set.add(cb);
  return () => { set!.delete(cb); };
}
