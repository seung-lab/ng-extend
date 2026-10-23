/**
 * Saves waiting for CAVE (Ames 2026-10-14).
 *
 * When CAVE does not answer, or answers with a server error, a completion or
 * a cell type is not refused any more. It waits in our own table
 * (supabase-cave-outbox.sql, rules in functions/cave-outbox.js) and in this
 * browser, counts in the game at once, and this module sends it to CAVE once
 * CAVE is back. It is sent from the player's own browser with their own sign
 * in, so CAVE records them as the one who made it; the server never holds a
 * CAVE sign in.
 *
 * Retrying is safe because a save is a POINT: CAVE files it under whatever
 * cell is at that point when it arrives, so a cell edited in the meantime
 * still gets it. Before sending, CAVE is asked whether the save that "failed"
 * got through after all, so nothing is saved twice.
 *
 * One save is tried per round, the oldest. If CAVE refuses it, CAVE is still
 * down and the rest wait too; the next round comes later each time, from one
 * minute up to fifteen.
 */
import { StatusMessage } from 'neuroglancer/status';
import { secureWrite, type SecureAction } from './secure_write';
import { useProofreadingBackendStore } from './store';

export type OutboxKind = 'complete' | 'cell_type';
export interface OutboxItem {
  /** The row in our table, once the server has it. */
  id?: number;
  kind: OutboxKind;
  dataset: string;
  caveServer: string;
  alignedVolume: string;
  datastack: string;
  table: string;
  rootId: string;
  pt: [number, number, number];
  annotation: Record<string, any>;
  /** A cell type: the old CAVE row to remove once this one is in. */
  replacesId?: number | null;
  createdAt?: string;
}

// The only hosts a waiting save may be sent to, with the player's sign in.
// Keep in step with CAVE_HOSTS in functions/cave-outbox.js.
const CAVE_HOSTS = ['minnie.microns-daf.com', 'hc.himc-cave.com', 'cave.fanc-fly.com', 'prod.flywire-daf.com', 'global.daf-apis.com'];
const STORE_KEY = 'nge_cave_outbox_v1';
const STICKY_AUTH = 'https://global.daf-apis.com/sticky_auth';
const FIRST_WAIT = 60_000;
const LONGEST_WAIT = 15 * 60_000;

/** A CAVE answer worth waiting out: a server error, too busy, or no answer (0). */
export function caveMayRecover(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function caveHostOk(server: string): boolean {
  try {
    const u = new URL(server);
    return u.protocol === 'https:' && CAVE_HOSTS.includes(u.host) && (u.pathname === '/' || u.pathname === '');
  } catch { return false; }
}

const same = (a: OutboxItem, b: { kind: string; dataset: string; rootId: string }) =>
  a.kind === b.kind && a.dataset === b.dataset && a.rootId === b.rootId;

function readLocal(): OutboxItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => x && caveHostOk(x.caveServer)) : [];
  } catch { return []; }
}
function writeLocal(items: OutboxItem[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch { /* the server copy still holds them */ }
}

let items: OutboxItem[] = readLocal();
let wait = FIRST_WAIT;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let started = false;
let paused = false; // CAVE said the sign in is not valid: wait for a new one
let nextAt = 0; // when the next round is, for the save status chip

function changed() {
  writeLocal(items);
  document.dispatchEvent(new CustomEvent('nge:cave-outbox', { detail: { waiting: items.length, nextAt: timer ? nextAt : 0 } }));
}

/** How many saves wait for CAVE in this browser. */
export function waitingCount(): number { return items.length; }

/** Is a save of this kind waiting for this cell? */
export function isWaiting(kind: OutboxKind, dataset: string, rootId: string): boolean {
  return items.some(x => same(x, { kind, dataset, rootId }));
}

async function serverCall<T = any>(action: SecureAction, args: Record<string, any>): Promise<T | null> {
  try {
    const out = await secureWrite<any>(action, args);
    // Until the SQL is run the table is missing; this browser's copy is kept.
    if (out && out.installed === false) return null;
    return out as T;
  } catch (e) {
    console.warn('[caveOutbox]', action, (e as any)?.message || e);
    return null;
  }
}

/**
 * Keep a save CAVE did not take. Returns false only when it could not even
 * be kept in this browser. A newer save of the same kind on the same cell
 * replaces one still waiting.
 */
export async function queueCaveWrite(item: OutboxItem): Promise<boolean> {
  if (!caveHostOk(item.caveServer)) return false;
  const fresh: OutboxItem = { ...item, createdAt: new Date().toISOString() };
  const old = items.find(x => same(x, fresh));
  items = items.filter(x => !same(x, fresh));
  if (old?.id) fresh.id = old.id;
  items.push(fresh);
  changed();
  try { if (localStorage.getItem(STORE_KEY) === null) return false; } catch { return false; }
  StatusMessage.showTemporaryMessage(fresh.kind === 'complete'
    ? 'Saved. CAVE is not answering right now, so your completion will be sent to it as soon as it is back.'
    : 'Saved. CAVE is not answering right now, so this cell type will be sent to it as soon as it is back.', 8000);
  const row = await serverCall<{ id: number }>('outbox.add', { item: fresh });
  if (row?.id) { fresh.id = row.id; changed(); }
  schedule(FIRST_WAIT);
  return true;
}

/** Take back a save still waiting (an un-mark, or a newer save CAVE took). */
export async function cancelWaiting(kind: OutboxKind, dataset: string, rootId: string): Promise<boolean> {
  const had = items.some(x => same(x, { kind, dataset, rootId }));
  if (!had) return false;
  items = items.filter(x => !same(x, { kind, dataset, rootId }));
  changed();
  await serverCall('outbox.cancel', { kind, dataset, rootId });
  return true;
}

function token(): string | null {
  try { return JSON.parse(localStorage.getItem(`auth_token_v2_${STICKY_AUTH}`) || 'null')?.accessToken ?? null; } catch { return null; }
}

/** Did a save that "failed" reach CAVE after all? null when CAVE could not say. */
async function alreadyThere(it: OutboxItem): Promise<boolean | null> {
  if (!it.datastack) return null;
  try {
    const res = await fetch(`${it.caveServer}/materialize/api/v3/datastack/${it.datastack}/query?return_pyarrow=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      // The cell ID is written into the JSON as a number by hand: it is larger
      // than a JavaScript number holds exactly.
      body: `{"table":"${it.table}","timestamp":"${new Date().toISOString()}","filter_in_dict":{"${it.table}":{"pt_root_id":[${it.rootId}]}}}`,
    });
    if (!res.ok) return null;
    const rows = JSON.parse((await res.text()).replace(/("pt_root_id"\s*:\s*)(\d+)/g, '$1"$2"'));
    if (!Array.isArray(rows)) return null;
    const near = (r: any) => {
      const p = Array.isArray(r.pt_position) ? r.pt_position : [r.pt_position_x, r.pt_position_y, r.pt_position_z];
      return p.length === 3 && p.every((n: any, i: number) => Math.abs(Number(n) - it.pt[i]) < 1);
    };
    const tag = String(it.annotation.tag ?? it.annotation.cell_type ?? '');
    return rows.some(r => near(r) && String(r.tag ?? r.cell_type ?? '') === tag);
  } catch { return null; }
}

/** One round: the oldest save, sent or found already there. */
async function round(): Promise<'sent' | 'dropped' | 'down' | 'stop' | 'none'> {
  const it = items[0];
  if (!it) return 'none';
  if (!token()) return 'stop';
  const there = await alreadyThere(it);
  let annotationId: number | null = null;
  if (!there) {
    let res: Response;
    try {
      res = await fetch(`${it.caveServer}/annotation/api/v2/aligned_volume/${it.alignedVolume}/table/${it.table}/annotations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ annotations: [it.annotation] }),
      });
    } catch (e) {
      if (it.id) void serverCall('outbox.fail', { id: it.id, error: 'CAVE could not be reached' });
      return 'down';
    }
    if (res.status === 401 || res.status === 403) {
      // Not CAVE being down: the sign in. Wait for the player to sign in again.
      return 'stop';
    }
    if (!res.ok) {
      const failed = it.id ? serverCall('outbox.fail', { id: it.id, error: `CAVE ${res.status}` }) : Promise.resolve(null);
      if (caveMayRecover(res.status)) return 'down';
      // CAVE will never take this one (a 400): stop trying it. The row keeps
      // the error, so an admin can see what it was.
      console.warn('[caveOutbox] CAVE refused a waiting save for good:', res.status, it);
      items = items.filter(x => x !== it); changed();
      if (it.id) void failed.then(() => serverCall('outbox.cancel', { id: it.id }));
      return 'dropped';
    }
    try { const ids = await res.json(); if (Array.isArray(ids) && Number.isFinite(Number(ids[0]))) annotationId = Number(ids[0]); } catch { /* the id is a nicety */ }
    // A new cell type is in, so the one it replaces comes out.
    if (it.kind === 'cell_type' && it.replacesId) {
      await fetch(`${it.caveServer}/annotation/api/v2/aligned_volume/${it.alignedVolume}/table/${it.table}/annotations`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ annotation_ids: [it.replacesId] }),
      }).catch(() => {});
    }
  }
  items = items.filter(x => x !== it);
  changed();
  if (it.id) void serverCall('outbox.sent', { id: it.id, annotationId });
  return 'sent';
}

async function run() {
  if (running || paused) return;
  running = true;
  timer = null;
  let sent = 0;
  try {
    for (;;) {
      const r = await round();
      if (r === 'sent') { sent++; continue; }
      if (r === 'dropped') continue;
      if (r === 'down') { wait = Math.min(wait * 2, LONGEST_WAIT); schedule(wait); }
      if (r === 'stop') paused = true;
      break;
    }
  } finally {
    running = false;
  }
  if (sent) {
    wait = FIRST_WAIT;
    StatusMessage.showTemporaryMessage(sent === 1 ? 'CAVE is back: your waiting save was sent.' : `CAVE is back: your ${sent} waiting saves were sent.`, 6000);
  }
}

function schedule(ms: number) {
  if (!items.length || paused) return;
  if (timer) clearTimeout(timer);
  nextAt = Date.now() + ms;
  timer = setTimeout(() => { void run(); }, ms);
  changed();
}

/** Bring in the saves this player left waiting on another computer. */
async function pullFromServer() {
  const mine = await serverCall<OutboxItem[]>('outbox.mine', {});
  if (!Array.isArray(mine)) return;
  for (const s of mine) {
    if (!caveHostOk(s.caveServer)) continue;
    const here = items.find(x => same(x, s));
    if (here) { if (!here.id) here.id = s.id; continue; }
    items.push(s);
  }
  // Saves kept here while the server could not be told: tell it now.
  for (const x of items.filter(i => !i.id)) {
    const row = await serverCall<{ id: number }>('outbox.add', { item: x });
    if (row?.id) x.id = row.id;
  }
  items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  changed();
}

/** Called once at start up: begins as soon as the player is signed in. */
export function startCaveOutbox() {
  if (started) return;
  started = true;
  const begin = async () => {
    paused = false;
    await pullFromServer();
    schedule(5_000);
  };
  let lastUser: string | null = null;
  const check = () => {
    let id: string | null = null;
    try { id = useProofreadingBackendStore().userId || null; } catch { /* the store is not up yet */ }
    if (id && id !== lastUser) { lastUser = id; void begin(); }
  };
  setInterval(check, 15_000);
  setTimeout(check, 3_000);
  // Back online, or back to the tab: try now rather than at the next round.
  const soon = () => { if (items.length && !running) { wait = FIRST_WAIT; paused = false; schedule(2_000); } };
  window.addEventListener('online', soon);
  // The save status chip's "try now".
  window.addEventListener('nge:save-retry-now', soon);
  // Saves left waiting before a reload show in the chip at once.
  setTimeout(changed, 0);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
  // A new sign in after CAVE said the old one was not valid.
  window.addEventListener('storage', e => { if (e.key && e.key.startsWith('auth_token_v2_')) soon(); });
}

// Headless tests (set window.ngeOutboxTest before load).
if (typeof window !== 'undefined' && (window as any).ngeOutboxTest) {
  (window as any).__ngeOutbox = { count: waitingCount, items: () => items, run: () => { paused = false; return run(); } };
}
