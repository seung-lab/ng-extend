/**
 * Edit credit waiting for our server (save failures audit, 2026-10-23,
 * docs/SAVE-FAILURES-AUDIT.md).
 *
 * Every split, merge, completion and cell type is reported to the server
 * (activity.log), which records it and moves the player's counters. When the
 * server answered with an error or did not answer, the report was dropped
 * with a console line: the edit was in CAVE but never counted. Now it waits
 * here, in this browser (it survives a reload), and is sent again later, a
 * little later each time.
 *
 * Sending again is safe because the server records a row once per key
 * (edit_log.op_key, unique): a split or merge is keyed by the graph server's
 * operation id, anything else by a key made when the row was first sent. A
 * row without a key is never kept, so nothing is counted twice.
 */
import { noteSaveWaiting } from './save_status';

export interface WaitingActivity {
  /** The player who made it; only ever sent under their sign in. */
  uid: string;
  row: Record<string, any>;
  at: number;
}
export interface ActivityOutboxHooks {
  currentUser: () => string | null;
  send: (row: Record<string, any>) => Promise<any>;
  onRecorded: (result: any, row: Record<string, any>) => void;
}

const STORE_KEY = 'nge_activity_outbox_v1';
const FIRST_WAIT = 5_000;
const LONGEST_WAIT = 5 * 60_000;
const MOST_KEPT = 300;

/** A key for one row, made once, kept across retries. */
export function newOpKey(): string {
  try { return crypto.randomUUID().replace(/-/g, ''); }
  catch { return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 32); }
}

/** Can this row be sent again without being counted twice? */
export function canResend(row: Record<string, any>): boolean {
  if (row.operation === 'split' || row.operation === 'merge') {
    const m = row.metadata || {};
    return m.operation_id != null && /^[1-9]\d{0,18}$/.test(String(m.operation_id)) && typeof m.graph === 'string' && !!m.graph;
  }
  return typeof row.op_key === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(row.op_key);
}

/** Worth waiting out: no answer, a server error, too busy, or not signed in yet. */
export function serverMayRecover(e: any): boolean {
  const status = Number(e?.status);
  if (!status) return true; // no answer at all, or no sign in on this page yet
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

function readLocal(): WaitingActivity[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => x && typeof x.uid === 'string' && x.row && canResend(x.row)) : [];
  } catch { return []; }
}
function writeLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch { /* kept in memory for this page */ }
}

let items: WaitingActivity[] = readLocal();
let hooks: ActivityOutboxHooks | null = null;
let wait = FIRST_WAIT;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextAt = 0;
let running = false;

function mine(): WaitingActivity[] {
  const uid = hooks?.currentUser();
  return uid ? items.filter(x => x.uid === uid) : [];
}

function changed() {
  writeLocal();
  noteSaveWaiting('activity', mine().length, nextAt);
}

/** Keep a row the server did not take. False when it cannot be sent again safely. */
export function queueActivity(uid: string, row: Record<string, any>): boolean {
  if (!canResend(row)) return false;
  items.push({ uid, row, at: Date.now() });
  if (items.length > MOST_KEPT) items = items.slice(-MOST_KEPT);
  schedule(wait);
  changed();
  return true;
}

export function activityWaitingCount(): number { return mine().length; }

async function run() {
  if (running || !hooks) return;
  running = true;
  timer = null;
  nextAt = 0;
  try {
    for (;;) {
      const it = mine()[0];
      if (!it) { wait = FIRST_WAIT; break; }
      try {
        const result = await hooks.send(it.row);
        items = items.filter(x => x !== it);
        try { hooks.onRecorded(result, it.row); } catch (e) { console.warn('[activityOutbox] after a save:', e); }
        changed();
      } catch (e: any) {
        if (serverMayRecover(e)) {
          wait = Math.min(wait * 2, LONGEST_WAIT);
          schedule(wait);
          break;
        }
        // Refused for good (a 4xx, e.g. a split older than the server
        // accepts). Retrying would never help.
        console.warn('[activityOutbox] the server refused a waiting save:', e?.message || e, it.row.operation);
        items = items.filter(x => x !== it);
        changed();
      }
    }
  } finally {
    running = false;
    changed();
  }
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  nextAt = Date.now() + ms;
  timer = setTimeout(() => { void run(); }, ms);
}

/** Try the waiting saves now (the chip's click, back online, back to the tab). */
export function retryActivityNow() {
  if (!mine().length || running) return;
  wait = FIRST_WAIT;
  schedule(500);
  changed();
}

/** Called once, by the store, with how to send a row and what to do after. */
export function startActivityOutbox(h: ActivityOutboxHooks) {
  if (hooks) return;
  hooks = h;
  let lastUser: string | null = null;
  const check = () => {
    const uid = h.currentUser();
    if (uid && uid !== lastUser) { lastUser = uid; if (mine().length) schedule(3_000); changed(); }
  };
  // Cheap: compares one id. Often enough that saves left waiting before a
  // reload show in the chip soon after the sign in comes back.
  setInterval(check, 2_000);
  window.addEventListener('online', retryActivityNow);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryActivityNow(); });
  window.addEventListener('nge:save-retry-now', retryActivityNow);
}

// Headless tests (set window.ngeOutboxTest before load).
if (typeof window !== 'undefined' && (window as any).ngeOutboxTest) {
  (window as any).__ngeActivityOutbox = { items: () => items, count: activityWaitingCount, run: () => run() };
}
