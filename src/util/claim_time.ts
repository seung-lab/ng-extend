/**
 * Active time per claim (Ames 2026-10-28). MEC's giant interneurons take a
 * player weeks of short visits, and the lab wants to know how long a cell
 * really takes. A second counts for a claim only while all of these hold:
 *   - the claimed cell is on screen (shown in the segmentation layer, under
 *     its listed ID or its ID after edits),
 *   - the Pyr tab is visible and in front,
 *   - the player used the mouse, keys or wheel in the last 5 minutes.
 * Only one claim counts at a time: the claim being worked on when it is on
 * screen, else the first claim on screen. About once a minute the seconds go
 * to the server (supabase-interneuron-quests.sql, pilot_claim_time), which
 * caps each beat and adds them up across visits and devices.
 *
 * Achievements come later (Ames is making the art): onClaimMilestone hears
 * each hour milestone a claim passes (10, 25, 50, 100 hours, as the server
 * records them) and each finished interneuron quest.
 */
import { reactive } from 'vue';
import { taskAction } from '../pilot_actions';
import { canonicalDataset, currentDatasetTag, currentSegLayer } from '../datasets';
import { Uint64 } from 'neuroglancer/util/uint64';

/** A claim the timer can count: the player's own, open. */
export interface TimedClaim { id: number; dataset: string; kind?: string | null; roots: string[] }

/** Which claims count time: every MEC claim, and every interneuron quest. */
export function countsTime(t: { dataset?: string | null; kind?: string | null }): boolean {
  return t.kind === 'interneuron' || canonicalDataset(t.dataset || '') === 'pni_mec';
}

export type ClaimMilestone =
  | { event: 'hours'; taskId: number; kind: string; hours: number; activeSeconds: number }
  | { event: 'complete'; taskId: number; kind: string; activeSeconds: number };
const milestoneFns = new Set<(m: ClaimMilestone) => void>();
/** The hook for Achievements: called on each milestone. Returns an unsubscribe. */
export function onClaimMilestone(fn: (m: ClaimMilestone) => void): () => void {
  milestoneFns.add(fn);
  return () => milestoneFns.delete(fn);
}
function emitMilestone(m: ClaimMilestone) {
  for (const fn of milestoneFns) { try { fn(m); } catch (e) { console.warn('[claim time] a milestone handler failed:', e); } }
  try { window.dispatchEvent(new CustomEvent('pyr:claim-milestone', { detail: m })); } catch { /* no window */ }
}

const IDLE_MS = 5 * 60 * 1000;
const BEAT_MS = 60 * 1000;
const BEAT_MAX = 90;          // the server takes at most this many seconds a beat
const PENDING_MAX = 900;      // a long outage keeps at most 15 minutes to send
const RELOAD_MS = 15 * 60 * 1000;

/** What the Cell Library shows: seconds per claim (the server's, plus the unsent). */
export const claimTime = reactive({
  seconds: {} as Record<number, number>,
  /** The claim counting right now, or null when paused. */
  running: null as number | null,
});

interface Deps { claims: () => TimedClaim[]; signedIn: () => boolean }
let deps: Deps | null = null;
let workingId: number | null = null;
let lastInput = 0;
const serverSecs: Record<number, number> = {};
const pending: Record<number, { secs: number; edits: number; saves: number }> = {};
/** IDs an edit just gave a claim's cell, until the claim's own ID catches up. */
const aliases: Record<number, { roots: string[]; until: number }> = {};
let loadedFor = '';
let loadedAt = 0;
let sending = false;
/** The server has no time counting yet (the SQL is not run): stop for this visit. */
let stopped = false;

/** The Cell Library says which claim is being worked on. */
export function setTimerWorkingClaim(id: number | null) { workingId = id; }
/** A Save view on a claim (one of the lab's extra signals). */
export function noteClaimSave(taskId: number) { bucket(taskId).saves++; }
/** A finished claim: the hook for "finished an interneuron" Achievements. */
export function noteClaimFinished(taskId: number, kind?: string | null) {
  void flush().finally(() => {
    emitMilestone({ event: 'complete', taskId, kind: kind || 'cell', activeSeconds: claimTime.seconds[taskId] ?? 0 });
  });
}

/** "14 h 20 min so far"; '' under a minute. */
export function claimTimeLabel(taskId: number | null | undefined): string {
  const s = taskId ? claimTime.seconds[taskId] ?? 0 : 0;
  if (s < 60) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h} h ` : ''}${m} min so far`;
}

function bucket(id: number) { return (pending[id] ??= { secs: 0, edits: 0, saves: 0 }); }
function show(id: number) { claimTime.seconds[id] = (serverSecs[id] ?? 0) + (pending[id]?.secs ?? 0); }

/** The claim whose cell is on screen now, or null. */
function claimOnScreen(): number | null {
  const ds = canonicalDataset(currentDatasetTag());
  const mine = deps!.claims().filter(c => countsTime(c) && canonicalDataset(c.dataset) === ds);
  if (!mine.length) return null;
  const ml = currentSegLayer();
  if (!ml || ml.visible === false || ml.archived) return null;
  const vis = ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!vis) return null;
  const now = Date.now();
  const shown = (c: TimedClaim) => {
    const extra = aliases[c.id] && aliases[c.id].until > now ? aliases[c.id].roots : [];
    for (const r of [...c.roots, ...extra]) {
      if (!/^\d+$/.test(r)) continue;
      try { if (vis.has(Uint64.parseString(r))) return true; } catch { /* not an ID */ }
    }
    return false;
  };
  const work = mine.find(c => c.id === workingId);
  if (work && shown(work)) return work.id;
  return mine.find(shown)?.id ?? null;
}

function tick() {
  if (!deps || !deps.signedIn()) { claimTime.running = null; return; }
  const now = Date.now();
  const active = document.visibilityState === 'visible' && document.hasFocus() && now - lastInput < IDLE_MS;
  const id = active ? claimOnScreen() : null;
  claimTime.running = id;
  if (id == null) return;
  const b = bucket(id);
  if (b.secs < PENDING_MAX) b.secs++;
  show(id);
}

/** Send what has been counted. */
async function flush(): Promise<void> {
  if (sending || !deps?.signedIn()) return;
  sending = true;
  try {
    for (const key of Object.keys(pending)) {
      const id = Number(key), b = pending[id];
      if (!b || (!b.secs && !b.edits && !b.saves)) continue;
      const sent = { secs: Math.min(b.secs, BEAT_MAX), edits: b.edits, saves: b.saves };
      try {
        const r: any = await taskAction('time', { step: 'beat', id, seconds: sent.secs, edits: sent.edits, saves: sent.saves });
        b.secs -= sent.secs; b.edits -= sent.edits; b.saves -= sent.saves;
        if (r && typeof r.active_seconds === 'number') serverSecs[id] = r.active_seconds;
        show(id);
        for (const h of Array.isArray(r?.passed) ? r.passed : []) {
          emitMilestone({ event: 'hours', taskId: id, kind: r.kind || 'cell', hours: Number(h), activeSeconds: r.active_seconds });
        }
      } catch (e: any) {
        const why = String(e?.message || e);
        // The claim ended (finished, let go): nothing more to send for it.
        if (/no longer active|no such claim|invalid claim/i.test(why)) delete pending[id];
        // Not installed yet (the SQL or the function): stop trying this visit.
        else if (/pilot_claim_time|unknown pilot action|could not find the function/i.test(why)) { console.info('[claim time] not switched on yet'); stopped = true; return; }
        else console.warn('[claim time] not sent, kept for the next beat:', why);
      }
    }
  } finally { sending = false; }
}

/** The server's totals for the player's claims: on start, on a new claim, and now and then. */
async function loadTotals(force = false): Promise<void> {
  if (!deps?.signedIn() || stopped) return;
  const ids = deps.claims().filter(countsTime).map(c => c.id).sort().join(',');
  if (!force && ids === loadedFor && Date.now() - loadedAt < RELOAD_MS) return;
  loadedFor = ids; loadedAt = Date.now();
  try {
    const rows: any[] = await taskAction('time', { step: 'mine' });
    for (const r of Array.isArray(rows) ? rows : []) {
      serverSecs[Number(r.task_id)] = Number(r.active_seconds) || 0;
      show(Number(r.task_id));
    }
  } catch (e: any) {
    if (/pilot_claim_time|unknown pilot action|could not find the function/i.test(String(e?.message))) stopped = true;
  }
}

/** Start counting, once, for the life of the page. */
export function startClaimTimer(d: Deps) {
  if (deps) { deps = d; return; }
  deps = d;
  const touch = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, touch, { capture: true, passive: true });
  }
  // An edit on the cell being counted: one more edit for the claim, and the
  // cell's new IDs keep counting until the claim's own ID catches up.
  window.addEventListener('nge-graph-edit', ((e: CustomEvent) => {
    const id = claimTime.running;
    if (id == null) return;
    const d = e.detail || {};
    if (d.kind !== 'merge' && d.kind !== 'split') return;
    bucket(id).edits++;
    const roots: string[] = Array.isArray(d.roots) ? d.roots.map(String) : [];
    if (roots.length) aliases[id] = { roots, until: Date.now() + 60_000 };
  }) as EventListener);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
    else void loadTotals();
  });
  setInterval(tick, 1000);
  setInterval(() => { if (!stopped) { void flush(); void loadTotals(); } }, BEAT_MS);
  setTimeout(() => void loadTotals(true), 5000);
}
