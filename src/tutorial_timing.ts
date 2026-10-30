/**
 * tutorial_timing.ts: how long players spend on each tutorial box (Ames,
 * 2026-10-29: "know how long players spend on them and even how long on each
 * card"). One row each time a player leaves a box (table
 * tutorial_step_events, supabase-tutorial-step-events.sql): the tutorial and
 * box, its title, the seconds spent (capped at 10 minutes, so a player who
 * walked away does not skew it), how they left (next, back, close, auto when
 * the box moved on by itself, other), how often they pressed Help me there,
 * the practice cell if any, and the app build. `run` groups one go at a
 * tutorial.
 *
 * Rows are held in this browser and sent in one batch when the tutorial
 * closes, the tab is hidden, or 20 are waiting, so a tutorial run is a few
 * writes. The server (ewCommunityData) stamps the player. Admins read the
 * results in Admin Hub > Tutorial times.
 */
import { watch } from 'vue';
import { useTutorialStore } from './store-pyr';
import { useProofreadingBackendStore } from './store';
import { supabase } from './supabase';
import { currentPractice } from './practice';

const CAP_SECONDS = 600;
const QUEUE_KEY = 'nge-tutorial-timing-queue';

interface Row {
  tutorial: number; step: number; box: string | null; item: string | null;
  seconds: number; left_by: string; help: number; build: string | null; run: string;
}
interface Open { tutorial: number; step: number; start: number; box: string | null; help: number; item: string | null; run: string; seen: boolean }

let open: Open | null = null;
let run = '';
let runTutorial = -1;
/** When the last box closed with no box after it. */
let goneAt = 0;
/** How the player is leaving the box, set by the click or key just before
 *  the step changes. Stale after a few seconds. */
let reason: { why: string; at: number } | null = null;

function readQueue(): Row[] {
  try { const v = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeQueue(rows: Row[]) {
  // Never more than a few hundred waiting, if sending keeps failing.
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-300))); } catch { /* private mode */ }
}
let sending = false;
async function flush() {
  if (sending) return;
  const rows = readQueue();
  if (!rows.length || !useProofreadingBackendStore().userId) return;
  sending = true;
  const batch = rows.slice(0, 100);
  try {
    const { error } = await supabase.from('tutorial_step_events').insert(batch);
    if (error) { console.warn('[tutorial timing] not sent, kept for later:', error.message); return; }
    writeQueue(readQueue().slice(batch.length));
  } catch (e) {
    console.warn('[tutorial timing] not sent, kept for later:', e);
  } finally { sending = false; }
}

function onABox(tutorial: number, step: number): boolean {
  const len = Number((window as any).__ngeTutorialLengths?.[tutorial]) || 0;
  return tutorial > 0 && step >= 0 && (!len || step < len);
}
function boxTitle(): string | null {
  const chip = document.querySelector('.introductionStepAnchor .chip');
  const t = chip?.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 120);
  const words = chip?.querySelector('.html')?.textContent?.replace(/\s+/g, ' ').trim();
  return words ? words.slice(0, 80) : null;
}
const newRun = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function close(leaving: 'gone' | 'moved') {
  if (!open) return;
  // A step the store passed through without a box ever showing (the
  // starting value before the account loads, say) is not a visit.
  // The box leaving is still drawn when this runs (the watch fires before
  // the next box renders), so a title not read yet is read now.
  if (document.querySelector('.introductionStepAnchor .chip')) { open.seen = true; if (!open.box) open.box = boxTitle(); }
  if (!open.seen) { open = null; reason = null; return; }
  const fresh = reason && Date.now() - reason.at < 4000 ? reason.why : null;
  const row: Row = {
    tutorial: open.tutorial, step: open.step, box: open.box,
    item: open.item ?? currentPractice().example?.id ?? null,
    seconds: Math.min(CAP_SECONDS, Math.max(0, Math.round((Date.now() - open.start) / 1000))),
    left_by: fresh ?? (leaving === 'gone' ? 'close' : 'other'),
    help: open.help, build: (window as any).__ngeBuild || null, run: open.run,
  };
  open = null; reason = null;
  if (leaving === 'gone') goneAt = Date.now();
  const q = readQueue(); q.push(row); writeQueue(q);
  if (leaving === 'gone' || q.length >= 20) void flush();
}

/** Start timing. Called once, from the tutorial component. */
let started = false;
export function startTutorialTiming() {
  if (started) return;
  started = true;
  const store = useTutorialStore();
  watch(() => [store.activeTutorial, store.getTutorialStep()] as const, ([tutorial, step]) => {
    const here = onABox(tutorial, step);
    if (open && (open.tutorial !== tutorial || open.step !== step)) close(here ? 'moved' : 'gone');
    if (!here || open) return;
    // A new go at a tutorial: a fresh run, unless it is the same tutorial
    // still under way (a sandbox moving to its next cell goes off the end
    // and back to its first box for a moment).
    if (tutorial !== runTutorial || !run || (goneAt && Date.now() - goneAt > 5000)) { run = newRun(); runTutorial = tutorial; }
    open = { tutorial, step, start: Date.now(), box: null, help: 0, item: null, run, seen: false };
    const mine = open;
    // The title, once the box has drawn (a sandbox box can wait behind its
    // loading card for a while, so look again until it is there).
    let looks = 0;
    const look = setInterval(() => {
      if (open !== mine || ++looks > 40) { clearInterval(look); return; }
      if (document.querySelector('.introductionStepAnchor .chip')) mine.seen = true;
      if (!mine.box) mine.box = boxTitle();
      if (mine.box) clearInterval(look);
    }, 1500);
  }, { immediate: true });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.('.introductionStepAnchor')) return;
    // Before a click changes the box (the close button swaps in a confirm).
    if (open) { open.seen = true; if (!open.box) open.box = boxTitle(); }
    if (t.closest('.nge-practice-help')) { if (open) open.help++; return; }
    const btn = t.closest('button');
    if (!btn) return;
    if (btn.classList.contains('next')) reason = { why: 'next', at: Date.now() };
    else if (btn.classList.contains('back')) reason = { why: 'back', at: Date.now() };
    else if (btn.classList.contains('exit') || /exit|leave|quit/i.test(btn.className)) reason = { why: 'close', at: Date.now() };
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && open) reason = { why: 'next', at: Date.now() }; }, true);
  // A box that moved on by itself (the practice watch saw the edit land).
  document.addEventListener('nge:tutorial-next', () => { if (open) reason = { why: 'auto', at: Date.now() }; }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
  // Anything left from an earlier visit.
  setTimeout(() => { void flush(); }, 15000);
}
