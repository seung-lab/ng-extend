/**
 * proofreading-test.ts: Tutorial 11, the Proofreading Test (Ames, 2026-10-10).
 *
 * One Sandbox cell with several mistakes on it: a neighbour fused on, pieces
 * missing, branch ends to mark. A player fixes everything they can find and
 * submits. The server scores the cell from the chunkedgraph itself
 * (functions/proofreading-test.js, rules in supabase-proofreading-test.sql),
 * records the attempt, puts the cell back for the next player and, on a
 * pass, opens production access. Nothing in the browser knows where the
 * mistakes are.
 *
 * The cell is held by one player at a time. The hold renews while they work
 * and runs out after the test's quiet time, like a practice cell.
 */
import { reactive, ref } from 'vue';
import { Step, useTutorialStore } from './store-pyr';
import imgBravoNurro from './images/bravo-nurro.png';
import { secureWrite } from './secure_write';
import imgProfessorNurro from './images/professor-nurro.png';
import imgInspectorNurro from './images/inspector-nurro.png';
import { setStateRewriter, useLayersStore, useProofreadingBackendStore } from './store';
import { refreshDatasetPermissions } from './util/dataset_access';
import { startDatasetTransition, releaseDatasetTransition } from './util/dataset_transition';
import { endPractice } from './practice';
import { makeLayer } from 'neuroglancer/layer';
import { Uint64 } from 'neuroglancer/util/uint64';
import { MIDDLE, OVER_3D, celebrateStep, closeSidePanel, getViewer, stopWatching } from './tutorial-3';
import { hidePyrMarkers, showPyrMarkers } from './markers';

export const TEST_TUTORIAL = 11;

/** The test as the server shows it to a player: no answers. */
export interface TestInfo {
  id: string; title: string; dataset: string; state_url: string; status: string; claimed_by: string | null;
  expires_at: string | null; hold_minutes: number; pass_mark: number; damage_fails: boolean;
  attempts_allowed: number | null; retry_hours: number; feedback: 'none' | 'summary' | 'detail';
  /** Whether a pass opens anything (the pilot list, CAVE groups). A trial
   *  run records the pass and grants nothing. */
  grants?: boolean;
  /** Minutes allowed for the whole test, from getting the cell. Null: none. */
  time_limit_minutes?: number | null;
}
export interface TestStatus {
  test: TestInfo | null; free?: boolean; mine?: boolean; attempts?: number; passed?: boolean; admin?: boolean;
  last?: { outcome: string; found: number; errors: number; damaged: number; percent: number; submitted_at: string } | null;
  wait_until?: string | null; can_start?: boolean;
  /** The line for the cell (Ames, 2026-10-21). */
  queue?: TestQueue;
}
export interface TestQueue {
  length: number;
  /** This player's place in line (1 = next), or null when not in it. */
  position: number | null;
  /** Their turn: the cell is held for them until then. */
  called_until: string | null;
  /** The cell is held for someone else's turn. */
  other_turn: boolean;
  /** When the player on the cell runs out of time, for the wait. */
  holder_until: string | null;
  turn_minutes: number;
  /** Quiet minutes before the cell goes: shorter while anyone waits. */
  quiet_minutes: number;
}
interface StartResult { test: TestInfo; session: string; attempt: number; resumed: boolean; checks: number; endpoints: number; root: string | null; deadline?: string | null;
  /** The cell is still being put back (a long history): call again. */
  resetting?: boolean; left?: number; }
export interface TestResult {
  passed: boolean; feedback: string;
  /** Scored because the time limit ran out. */
  timedOut?: boolean;
  granted?: { pilot: boolean; groups: { id: number; ok: boolean }[] };
  found?: number; errors?: number; damaged?: number; percent?: number; endpoints?: number; endpointsFound?: number; stray?: number;
  checks?: { kind: string; label: string; ok: boolean; point: number[] | null; weight?: number }[];
}

/** What the server last said about the test and this player. null until
 *  asked, or while not signed in. */
export const testStatus = ref<TestStatus | null>(null);
let asking: Promise<TestStatus | null> | null = null;
export function refreshTestStatus(): Promise<TestStatus | null> {
  if (asking) return asking;
  asking = (async () => {
    try { testStatus.value = await secureWrite<TestStatus>('test.status'); }
    catch (e: any) {
      const why = String(e?.message || e);
      // Not signed in, or no profile yet: no test for them, and nothing to log.
      if (!/sign in|profile/i.test(why)) console.warn('[test] status:', why);
    } finally { asking = null; }
    return testStatus.value;
  })();
  return asking;
}
function userId(): string | null {
  try { return useProofreadingBackendStore().userId; } catch { return null; }
}
// Once the login has settled, so the burger menu knows whether to list it.
// The sign in can take a while: keep looking for a minute.
function refreshWhenSignedIn(tries = 0) {
  if (userId()) { refreshTestStatus(); return; }
  if (tries < 30) setTimeout(() => refreshWhenSignedIn(tries + 1), 2000);
}
setTimeout(refreshWhenSignedIn, 3000);
document.addEventListener('nge:test-refresh', () => { refreshTestStatus(); });

type Phase = 'none' | 'claiming' | 'working' | 'scoring' | 'done' | 'busy';
const session = reactive({
  phase: 'none' as Phase,
  test: null as TestInfo | null,
  /** The hold's secret, from the claim. */
  nonce: '',
  attempt: 0,
  checks: 0,
  endpoints: 0,
  resumed: false,
  /** When this try's time limit runs out (ms), or null with no limit. */
  deadline: null as number | null,
  /** Quiet minutes before the cell goes to the next person: the test's hold,
   *  or 15 while anyone is waiting in line (the server says, each heartbeat). */
  quietMinutes: 60,
  result: null as TestResult | null,
  error: '',
});
export function currentTest() { return session; }

// ─── The hold ───────────────────────────────────────────────────────────────
// Renewed once a minute while the player is active; after the test's quiet
// time with no activity the cell goes to the next person.
let lastActivity = Date.now();
let lastHeartbeat = 0;
let holdTimer: ReturnType<typeof setInterval> | null = null;
let listening = false;
function noteActivity() { lastActivity = Date.now(); }

function startHold() {
  lastActivity = Date.now();
  lastHeartbeat = Date.now();
  if (!listening) {
    listening = true;
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(ev, noteActivity, { passive: true, capture: true });
  }
  if (holdTimer) return;
  holdTimer = setInterval(() => {
    if (session.phase !== 'working' || !session.nonce || !session.test) { stopHold(); return; }
    const idle = Date.now() - lastActivity;
    const quiet = Math.max(5, session.quietMinutes || session.test.hold_minutes || 60) * 60 * 1000;
    // The time limit (Ames, 2026-10-13): at zero the cell is scored as it
    // stands. The server holds the same clock and refuses anything later.
    if (session.deadline !== null) {
      const timeLeft = session.deadline - Date.now();
      updateTestHud(timeLeft);
      if (timeLeft <= 0) { submitFromHud(); return; }
    }
    if (idle < 60 * 1000 && Date.now() - lastHeartbeat > 60 * 1000) {
      lastHeartbeat = Date.now();
      secureWrite<{ quiet_minutes?: number }>('test.heartbeat', { id: session.test.id, session: session.nonce }).then(r => {
        if (r && typeof r.quiet_minutes === 'number') session.quietMinutes = r.quiet_minutes;
      }).catch((e: any) => {
        const why = String(e?.message || e);
        console.warn('[test] the hold could not be renewed:', why);
        // Only a hold the server says is over ends the test here; a busy
        // server gets another try in a minute.
        if (/has ended|not found|Unknown test/i.test(why)) holdLost('The server ended your session, so this try is over.');
      });
    }
    const left = quiet - idle;
    if (session.deadline === null) updateTestHud(left);
    if (left > 0 && left <= 5 * 60 * 1000) {
      const m = Math.ceil(left / 60000);
      statusLine(`Still there? The cell goes to the next person after ${m} more quiet minute${m === 1 ? '' : 's'}. Any move keeps it.`);
    }
    if (idle >= quiet) holdLost('The cell went to the next person after the quiet time ran out. Start again when you are ready.');
  }, 1000);
}
function stopHold() {
  if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
}
function holdLost(why: string) {
  stopHold();
  hideTestHud();
  session.phase = 'none';
  session.nonce = '';
  session.error = why;
  statusLine(why);
  document.dispatchEvent(new CustomEvent('nge:test-ended'));
}

/** A line under the box's text, like a practice cell's status. */
function statusLine(text: string) {
  const chip = document.querySelector('.introductionStepAnchor .chip .html');
  if (!chip) return;
  let el = chip.querySelector('.nge-test-status') as HTMLElement | null;
  if (!el) {
    el = document.createElement('p');
    el.className = 'nge-hud-note nge-test-status';
    chip.appendChild(el);
  }
  if (el.textContent !== text) {
    el.textContent = text;
    document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
  }
}

// ─── The bar at the top left (Ames, 2026-10-11) ───────────────────────────
// Stays up while the cell is held, in place of a tutorial box: an "i" for
// the instructions, how many things there are to fix, how long the cell
// stays yours (the quiet time left; any move resets it), and Submit.
function helpHtml(): string {
  const n = session.checks, e = session.endpoints;
  const what = n ? `There are <strong>${n} things to fix</strong>` : 'Fix everything you find';
  const ends = e ? ` and <strong>${e} branch end${e === 1 ? '' : 's'}</strong> to mark` : '';
  return `
<p>${what}${ends}. Nothing is marked for you.</p>
<p><strong>Follow every branch to its end.</strong> Use <strong>Highlight</strong> to paint each stretch you have checked, so you can see where you have been: press the highlighter in the top bar, or hold <strong>H</strong> and click two points on a branch.</p>
<p><strong>At the end of every branch, place an annotation point.</strong> The <strong>End</strong> layer is ready for it: pick it in the layer tabs and click the last bit of the cell.</p>
<p><strong>Cut off anything that does not belong, and merge any missing pieces.</strong></p>
<p>When the cell is right, press <strong>Submit for scoring</strong> up here.${session.deadline !== null ? ' The clock beside it is the time you have left: at zero your cell is scored as it stands.' : ''}</p>`;
}
const HUD_ID = 'nge-test-hud', HELP_ID = 'nge-test-help', LEAVE_ID = 'nge-test-leave';
/** The app's own font. The bar and its cards hang off <body>, outside the
 *  styled app, and fell back to a serif without it (Ames, 2026-10-21). */
const APP_FONT = "font-family:Inter,system-ui,'Segoe UI',sans-serif;";

function showTestHud() {
  if (document.getElementById(HUD_ID)) return;
  const hud = document.createElement('div');
  hud.id = HUD_ID;
  hud.className = 'ng-extend';
  hud.setAttribute('role', 'status');
  hud.style.cssText = 'position:fixed;top:64px;left:12px;z-index:60;display:flex;align-items:center;gap:10px;padding:4px 6px 4px 4px;'
    + 'border:1px solid rgba(126,224,255,.45);border-radius:999px;background:rgba(8,16,28,.9);color:#d8f3ff;'
    + APP_FONT + 'font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:.04em;backdrop-filter:blur(4px);';
  const info = document.createElement('button');
  info.type = 'button';
  info.textContent = 'i';
  info.title = 'How to work the cell';
  info.setAttribute('aria-label', 'How to work the cell');
  info.style.cssText = 'width:24px;height:24px;border-radius:50%;border:1px solid #7ee0ff;background:rgba(126,224,255,.14);color:#fff;'
    + 'font:700 14px/1 Georgia,serif;cursor:pointer;';
  info.addEventListener('click', openTestHelp);
  const count = document.createElement('span');
  count.textContent = session.checks ? `${session.checks} to fix` : 'Proofreading Test';
  const time = document.createElement('span');
  time.className = 'nge-test-hud-time';
  time.title = session.deadline !== null ? 'Time left. At zero your cell is scored as it stands.' : 'How long the cell stays yours if you stop moving. Any move resets it.';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'nge-hud-btn nge-hud-btn--sm nge-hud-btn--arrow';
  submit.textContent = 'Submit for scoring';
  submit.style.cssText = 'margin:0;border-radius:999px;';
  submit.addEventListener('click', submitFromHud);
  // A way out without a score (Ames, 2026-10-21: "we need a way to cancel").
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'nge-hud-btn nge-hud-btn--sm nge-hud-btn--quiet';
  leave.textContent = 'Leave';
  leave.title = 'Leave the test without a score';
  leave.style.cssText = 'margin:0;border-radius:999px;';
  leave.addEventListener('click', askLeave);
  hud.append(info, count, time, submit, leave);
  document.body.appendChild(hud);
}
function updateTestHud(msLeft: number) {
  const el = document.querySelector('#' + HUD_ID + ' .nge-test-hud-time') as HTMLElement | null;
  if (!el) return;
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  el.textContent = `${m}:${r < 10 ? '0' : ''}${r}`;
  el.style.color = session.deadline === null || s > 300 ? '' : s > 60 ? '#ffc857' : '#ff6b6b';
  el.style.fontWeight = session.deadline !== null && s <= 300 ? '700' : '';
}
function hideTestHud() {
  document.getElementById(HUD_ID)?.remove();
  document.getElementById(HELP_ID)?.remove();
  document.getElementById(LEAVE_ID)?.remove();
}
/** Leave without a score: asked once, since the edits come off. */
function askLeave() {
  if (document.getElementById(LEAVE_ID) || session.phase !== 'working') return;
  document.getElementById(HELP_ID)?.remove();
  const card = document.createElement('div');
  card.id = LEAVE_ID;
  card.className = 'ng-extend';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-label', 'Leave the test?');
  card.style.cssText = 'position:fixed;top:104px;left:12px;z-index:61;max-width:420px;padding:16px 18px;'
    + 'border:1px solid rgba(126,224,255,.45);border-radius:10px;background:rgba(8,16,28,.96);color:#e8f6ff;'
    + APP_FONT + 'font-size:14px;line-height:1.5;box-shadow:0 12px 40px rgba(0,0,0,.5);';
  card.innerHTML = '<div style="font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#7ee0ff;margin-bottom:6px">Leave the test?</div>'
    + '<p style="margin:0 0 10px">Your cell is handed back without a score, and your edits on it are undone for the next person. You can start again from the menu.</p>';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const stay = document.createElement('button');
  stay.type = 'button';
  stay.className = 'nge-hud-btn';
  stay.textContent = 'Keep working';
  stay.addEventListener('click', () => card.remove());
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'nge-hud-btn nge-hud-btn--quiet';
  go.textContent = 'Leave the test';
  go.addEventListener('click', () => { card.remove(); void leaveTest(); });
  row.append(stay, go);
  card.appendChild(row);
  document.body.appendChild(card);
  stay.focus();
}
/** Hand the cell back and close the test. */
async function leaveTest() {
  const store = useTutorialStore();
  await abandonTest();
  session.error = '';
  session.result = null;
  if (store.activeTutorial === TEST_TUTORIAL) store.setTutorialStep(steps.length);
}
function openTestHelp() {
  if (document.getElementById(HELP_ID)) return;
  document.getElementById(LEAVE_ID)?.remove();
  const card = document.createElement('div');
  card.id = HELP_ID;
  card.className = 'ng-extend';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'How to work the cell');
  card.style.cssText = 'position:fixed;top:104px;left:12px;z-index:61;max-width:520px;padding:16px 18px;'
    + 'border:1px solid rgba(126,224,255,.45);border-radius:10px;background:rgba(8,16,28,.96);color:#e8f6ff;'
    + APP_FONT + 'font-size:14px;line-height:1.5;box-shadow:0 12px 40px rgba(0,0,0,.5);';
  card.innerHTML = '<div style="font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#7ee0ff;margin-bottom:6px">How to work the cell</div>' + helpHtml();
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'nge-hud-btn';
  ok.textContent = 'OK';
  ok.style.marginTop = '8px';
  ok.addEventListener('click', () => card.remove());
  card.appendChild(ok);
  document.body.appendChild(card);
}
/** Submit from the bar: the result box scores the cell on entry. */
function submitFromHud() {
  if (session.phase !== 'working') return;
  const store = useTutorialStore();
  if (store.activeTutorial !== TEST_TUTORIAL) store.activeTutorial = TEST_TUTORIAL;
  store.setTutorialStep(RESULT_STEP);
}

/** An annotation layer named End, ready for the branch end points. */
function ensureEndLayer() {
  try {
    const v = getViewer();
    if (!v?.layerSpecification) return;
    const have = (v.layerManager?.managedLayers ?? []).some((l: any) => l.name === 'End');
    if (have) return;
    const managed = makeLayer(v.layerSpecification, 'End', endLayerSpec());
    v.layerSpecification.add(managed);
  } catch (e) { console.warn('[test] could not add the End layer:', e); }
}
/** The End layer as a view holds it: Pyr gems (Ames, 2026-10-13), pink so
 *  they show on a cell of any colour. */
export function endLayerSpec(): Record<string, any> {
  return { type: 'annotation', source: { url: 'local://annotations' }, annotationColor: '#ff4fd8', pointMarker: 'pyr', pointSize: 1.5, annotations: [] };
}

/**
 * The cell, and nothing else, in the segment list. The saved start view
 * names the id the cell had when it was saved; every edit and every undo
 * since has given the cell a new one. An out of date id left in the list
 * (even hidden) shows as a second copy of the cell and the cut tool will
 * not work on it (Ames, 2026-10-13), so the list is emptied first.
 */
export function showExactly(dataset: string, root: string, onlyLayer?: string) {
  try {
    for (const ml of getViewer()?.layerManager?.managedLayers ?? []) {
      const url: string = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (!(ml.name === dataset || url.includes(`/table/${dataset}`))) continue;
      // The admins' heat map has a second layer on the same table (its pieces).
      if (onlyLayer && ml.name !== onlyLayer) continue;
      const g = ml.layer?.displayState?.segmentationGroupState?.value;
      if (!g?.visibleSegments) continue;
      const ids: string[] = [];
      for (const s of (g.selectedSegments ?? g.visibleSegments)) ids.push(s.toString());
      for (const s of g.visibleSegments) { const t = s.toString(); if (!ids.includes(t)) ids.push(t); }
      for (const id of ids) {
        if (id === root) continue;
        const u = Uint64.parseString(id);
        g.visibleSegments.delete(u);
        g.selectedSegments?.delete(u);
      }
      const want = Uint64.parseString(root);
      if (!g.visibleSegments.has(want)) g.visibleSegments.add(want);
    }
  } catch (e) { console.warn('[test] could not set the cell in the list:', e); }
}

/** Every point annotation in the viewer, as [x, y, z] viewer voxels. The
 *  server scores the branch ends from these. */
function collectPointAnnotations(): number[][] {
  const pts: number[][] = [];
  try {
    const state = getViewer()?.state?.toJSON?.();
    for (const layer of state?.layers ?? []) {
      if (layer?.type !== 'annotation' || layer.archived) continue;
      for (const a of layer.annotations ?? []) {
        if (a?.type === 'point' && Array.isArray(a.point) && a.point.length >= 3) pts.push(a.point.slice(0, 3).map(Number));
      }
    }
  } catch (e) { console.warn('[test] could not read the annotations:', e); }
  return pts.slice(0, 500);
}

// ─── Starting, submitting, leaving ──────────────────────────────────────────

/** Open the test from the menu (or again after a fail). From the line's
 *  card, at the second box: the player has read the first. */
export async function startTest(atStep = 0) {
  const store = useTutorialStore();
  stopWatching();
  hidePyrMarkers();
  hideTestHud();
  // Any practice cells go back first, as the Merger Sandbox does.
  try { await endPractice(); } catch { /* the practice reset job covers it */ }
  session.result = null;
  session.error = '';
  session.phase = 'none';
  store.activeTutorial = TEST_TUTORIAL;
  // Past the end, then to the start: a step is keyed by its index, so going
  // from box 1 to box 1 would not reload it.
  store.setTutorialStep(steps.length);
  setTimeout(() => store.setTutorialStep(atStep), 60);
}
document.addEventListener('nge:test-start', () => { startTest(); });

// ─── The line (Ames, 2026-10-21) ────────────────────────────────────────────
// One player at a time. While someone else has the cell, a player can join
// the line; when the cell frees up, the first in line is called (a
// notification, and the cell held for them for 10 minutes). The rules are on
// the server (supabase-proofreading-test.sql); TestQueueCard.vue shows a
// player their place and calls them.

/** Busy for this player: someone else has the cell, or it is someone
 *  else's turn. */
export function cellBusyForMe(st = testStatus.value): boolean {
  return !!st?.test && st.free === false && !st.mine;
}
export const queueBusy = ref(false);
export const queueError = ref('');
export async function joinLine(): Promise<void> {
  if (queueBusy.value) return;
  queueBusy.value = true; queueError.value = '';
  try { await secureWrite('test.queueJoin', {}); }
  catch (e: any) { queueError.value = String(e?.message || e); }
  finally { queueBusy.value = false; }
  await refreshTestStatus();
}
export async function leaveLine(): Promise<void> {
  if (queueBusy.value) return;
  queueBusy.value = true; queueError.value = '';
  try { await secureWrite('test.queueLeave', {}); }
  catch (e: any) { queueError.value = String(e?.message || e); }
  finally { queueBusy.value = false; }
  await refreshTestStatus();
}
/** For Tutorial.vue, on the first box: while the cell is someone else's,
 *  the button joins the line (and the box says where they are), or, once
 *  they are in it, closes the box. True when it did. */
export function testQueueNext(): boolean {
  const store = useTutorialStore();
  if (store.getTutorialStep() !== 0) return false;
  const st = testStatus.value;
  // No line on the server yet (before its SQL): the box works as before.
  if (!cellBusyForMe(st) || !st?.queue) return false;
  if (st?.queue?.position) { store.setTutorialStep(steps.length); return true; }
  if (!st?.can_start) { store.setTutorialStep(steps.length); return true; }
  // Joined: the box closes and the card at the top left takes over (it
  // shows their place and calls them). Refused: said under the box.
  void joinLine().then(() => {
    if (testStatus.value?.queue?.position) store.setTutorialStep(steps.length);
    else if (queueError.value) statusLine(queueError.value);
  });
  return true;
}

/** For Tutorial.vue: on the last box, "Try again" starts over instead of
 *  closing. True when it did. */
export function testContinue(): boolean {
  if (session.phase === 'scoring') return true;
  if (session.result?.passed) return false;
  const st = testStatus.value;
  if (!st?.can_start && !st?.admin) return false;
  startTest();
  return true;
}

/** Hand the cell back without a score: leaving the tutorial, or the quiet
 *  time ran out. Safe to call when nothing is held. */
export async function abandonTest(): Promise<void> {
  const id = session.test?.id, nonce = session.nonce;
  stopHold();
  hideTestHud();
  hidePyrMarkers();
  if (session.phase === 'scoring') return;
  session.phase = 'none';
  session.nonce = '';
  if (!id || !nonce) return;
  try { await secureWrite('test.abandon', { id, session: nonce }); }
  catch (e: any) { console.warn('[test] the cell could not be handed back:', e?.message || e); }
  refreshTestStatus();
}

async function startWork() {
  closeSidePanel();
  stopWatching();
  hidePyrMarkers();
  if (session.phase === 'working' && session.nonce) return;
  session.phase = 'claiming';
  session.error = '';
  session.result = null;
  // The loading card (Ames, 2026-10-13): up until the cell is on screen.
  startDatasetTransition({
    id: 'proofreading-test', label: 'Your cell', eyebrow: 'Proofreading Test · Getting', thumbnail: imgProfessorNurro, contain: true, hold: true,
    steps: ['Holding the cell for you', 'Putting it back to its start', 'Loading the cell', 'Almost there'],
  });
  let got: StartResult | null = null;
  // A long history is put back over several calls (2026-10-19): each call
  // works for at most about a minute and the claim is kept in between.
  for (let round = 0; round < 12; round++) {
    try { got = await secureWrite<StartResult>('test.start'); }
    catch (e: any) { session.error = String(e?.message || e); got = null; break; }
    if (!got?.resetting) break;
    startDatasetTransition({
      id: 'proofreading-test', label: 'Your cell', eyebrow: 'Proofreading Test · Getting', thumbnail: imgProfessorNurro, contain: true, hold: true,
      steps: [`Putting the cell back: ${got.left ?? 'a few'} edits to go`, 'Still putting it back', 'Almost there'],
    });
  }
  if (got?.resetting) { session.error = 'The test cell is taking a while to put back. Try again in a few minutes.'; got = null; }
  if (!got) {
    session.phase = 'busy';
    releaseDatasetTransition();
    // Someone else has the cell, or it is someone's turn: the first box
    // shows the line and lets them join it.
    const st = await refreshTestStatus();
    if (cellBusyForMe(st) && st?.queue) { session.phase = 'none'; useTutorialStore().setTutorialStep(0); }
    return;
  }
  session.test = got.test;
  session.nonce = got.session;
  session.attempt = got.attempt;
  session.resumed = got.resumed;
  // How many things there are to find is itself a hint: only when the test
  // gives feedback at all.
  session.checks = got.test.feedback === 'none' ? 0 : got.checks;
  session.endpoints = got.test.feedback === 'none' ? 0 : got.endpoints;
  const until = got.deadline ? Date.parse(got.deadline) : NaN;
  session.deadline = Number.isFinite(until) ? until : null;
  session.quietMinutes = testStatus.value?.queue?.quiet_minutes ?? got.test.hold_minutes ?? 60;
  // The saved view names the id the cell had when it was saved. It is
  // rewritten on the way in to the id the cell has now, and given the End
  // layer, so nothing out of date ever reaches the segment list.
  const root = got.root, dataset = got.test.dataset;
  setStateRewriter(async (state: any) => {
    const layers: any[] = Array.isArray(state?.layers) ? state.layers : [];
    for (const l of layers) {
      if (l?.type !== 'segmentation') continue;
      const src = JSON.stringify(l.source ?? '');
      if (root && (l.name === dataset || src.includes(`/table/${dataset}`))) { l.segments = [root]; delete l.equivalences; }
    }
    if (!layers.some(l => l?.type === 'annotation' && l.name === 'End')) layers.push({ name: 'End', ...endLayerSpec() });
    return state;
  });
  try { await useLayersStore().loadState(got.test.state_url); }
  catch (e) { console.warn('[test] the start view did not load:', e); }
  finally { setStateRewriter(null); }
  await new Promise(r => setTimeout(r, 800));
  if (root) showExactly(dataset, root);
  ensureEndLayer();
  releaseDatasetTransition();
  session.phase = 'working';
  startHold();
  showTestHud();
  updateTestHud(session.deadline !== null ? session.deadline - Date.now() : (got.test.hold_minutes || 60) * 60 * 1000);
  // The boxes go; the bar at the top left takes over (Ames, 2026-10-11).
  useTutorialStore().setTutorialStep(steps.length);
}

async function submitWork() {
  const store = useTutorialStore();
  // "Try again" from a refused start: back to the cell box, which claims again.
  if (session.phase === 'busy') { store.setTutorialStep(CLAIM_STEP); return; }
  if (session.phase !== 'working' || !session.nonce || !session.test) { session.result = null; return; }
  session.phase = 'scoring';
  stopHold();
  hideTestHud();
  hidePyrMarkers();
  const id = session.test.id, nonce = session.nonce;
  const annotations = collectPointAnnotations();
  // The loading card (Ames, 2026-10-13): scoring reads the whole cell and
  // then puts it back, which takes a while.
  startDatasetTransition({
    id: 'proofreading-test-score', label: 'Your cell', eyebrow: 'Proofreading Test · Scoring', thumbnail: imgInspectorNurro, contain: true, hold: true,
    steps: ['Reading the cell from the server', 'Checking every fix', 'Checking the branch ends', 'Putting the cell back for the next person'],
  });
  try {
    const r = await secureWrite<TestResult>('test.submit', { id, session: nonce, annotations });
    session.result = r;
    session.error = '';
    if (r.passed) {
      celebrateStep();
      // The dataset switcher and chat read production access from CAVE: ask again.
      refreshDatasetPermissions();
      document.dispatchEvent(new CustomEvent('nge:production-access-changed'));
    }
    if (r.checks) showMisses(r.checks);
  } catch (e: any) {
    session.result = null;
    session.error = String(e?.message || e);
  }
  releaseDatasetTransition();
  session.nonce = '';
  session.phase = 'done';
  refreshTestStatus();
}

/** The misses, damage first, then the biggest pieces, then the ends. */
function missesInOrder(checks: NonNullable<TestResult['checks']>) {
  const rank = (k: string) => (k === 'keep' || k === 'apart' ? 0 : k === 'endpoint' ? 2 : 1);
  return checks.filter(c => !c.ok).sort((a, b) => rank(a.kind) - rank(b.kind) || (b.weight ?? 1) - (a.weight ?? 1));
}

/** Detail feedback: a Pyr pin on each miss, for two minutes; at most 25,
 *  the most important first (a whole cell can have dozens). */
function showMisses(checks: NonNullable<TestResult['checks']>) {
  const missed = missesInOrder(checks).filter(c => Array.isArray(c.point)).slice(0, 25);
  if (!missed.length) return;
  showPyrMarkers(missed.map(c => c.point as number[]), missed.map(c => c.label || c.kind), 120);
}

const percentWord = (r: TestResult) => `${r.percent ?? 0} percent`;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${s}`;
}
/** A rough wait: the time the player on the cell has left, then a whole try
 *  (the time limit) for each player ahead, plus a turn for one being called. */
export function waitWords(q: TestQueue): string {
  const limit = testStatus.value?.test?.time_limit_minutes || 60;
  const ahead = Math.max(0, (q.position ?? 1) - 1);
  let min = q.holder_until ? Math.max(0, (Date.parse(q.holder_until) - Date.now()) / 60000) : 0;
  if (q.other_turn) min += q.turn_minutes + limit;
  min += Math.max(0, ahead - (q.other_turn ? 1 : 0)) * limit;
  if (min < 1) return 'You are next.';
  const m = Math.round(min);
  const words = m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `The wait is at most about ${words}, less when people finish early.`;
}

function resultText(): string {
  const r = session.result;
  if (session.phase === 'scoring') return 'Reading the cell from the server. This takes a moment: every piece is checked, then the cell is put back for the next person.';
  if (!r) {
    return session.error
      ? `${session.error}\n\nNothing was scored. Press back to return to the cell if it is still yours, or Exit and start again.`
      : 'There was no test in progress to score. Start the test from the menu.';
  }
  const parts: string[] = [];
  if (r.timedOut) parts.push('**Time ran out**, so your cell was scored as it stood.');
  if (r.passed) {
    parts.push('<span class="nge-done-lead">You found and fixed what was wrong. That is real proofreading.</span>');
    const groups = r.granted?.groups ?? [];
    const asked = !!r.granted && (r.granted.pilot || groups.length > 0);
    const opened = asked && (r.granted!.pilot || groups.some(g => g.ok));
    if (!asked) parts.push('**Your pass is recorded.** This is a trial run of the test: access to the real datasets is switched on by hand for now.');
    else parts.push(opened
      ? '**Production is open to you.** Open the dataset switcher (Data, at the top) and pick the retina: your edits there count for science. If it still says View only, sign out and back in once.'
      : 'Your pass is recorded. Opening the production dataset did not go through on the server side; an admin will finish it, and the retina will show in the dataset switcher once they have.');
  } else {
    parts.push('<span class="nge-done-lead">Not a pass this time.</span>');
  }
  if (r.feedback !== 'none') {
    const bits: string[] = [];
    if (typeof r.errors === 'number') bits.push(`${r.found} of ${r.errors} mistake${r.errors === 1 ? '' : 's'} fixed`);
    if (r.endpoints) bits.push(`${r.endpointsFound} of ${r.endpoints} branch end${r.endpoints === 1 ? '' : 's'} marked`);
    if (r.damaged) bits.push(`<strong style="color:#e06060">${r.damaged} part${r.damaged === 1 ? '' : 's'} of the real cell cut off or wrongly joined</strong>`);
    if (r.stray && r.endpoints) bits.push(`${r.stray} point${r.stray === 1 ? '' : 's'} placed where no branch ends`);
    if (!r.endpoints) bits.push('branch ends are not scored yet');
    parts.push(`**Score: ${percentWord(r)}.** ${bits.join('; ')}.`);
    if (!r.passed && r.damaged) parts.push('Damage to the real cell fails the test on its own, however many mistakes you found. Cut only where two different cells touch, and look at the 2D images before you place a point.');
    if (r.checks) {
      const missed = missesInOrder(r.checks);
      const broken = missed.filter(c => c.kind === 'keep' || c.kind === 'apart');
      const pieces = missed.filter(c => c.kind === 'merge' || c.kind === 'cut');
      const ends = missed.filter(c => c.kind === 'endpoint');
      const lines: string[] = [];
      if (broken.length) lines.push(`Cut off from the real cell: ${broken.slice(0, 5).map(c => c.label).join(', ')}${broken.length > 5 ? ` and ${broken.length - 5} more` : ''}.`);
      if (pieces.length) lines.push(`Biggest misses: ${pieces.slice(0, 5).map(c => c.label).join('; ')}${pieces.length > 5 ? `; and ${pieces.length - 5} smaller` : ''}.`);
      if (ends.length) lines.push(`${ends.length} branch end${ends.length === 1 ? '' : 's'} not marked.`);
      if (lines.length) parts.push(lines.join(' ') + ' Pins mark them on the cell for two minutes, the most important first.');
    }
  }
  if (!r.passed) {
    const st = testStatus.value;
    if (st?.wait_until) parts.push(`You can try again after ${new Date(st.wait_until).toLocaleString()}.`);
    else if (st?.test?.attempts_allowed && typeof st.attempts === 'number') {
      const left = st.test.attempts_allowed - st.attempts;
      parts.push(left > 0 ? `You have ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That was your last try on this test. Ask in chat if you would like another.');
    } else parts.push('You can try again whenever you like. The cell goes back to its starting state between tries.');
  }
  parts.push('The cell has been put back for the next person.');
  return parts.join('\n\n');
}

/** Box numbers the bar and the retry use: the claim box and the result box. */
const CLAIM_STEP = 2, RESULT_STEP = 3;

export const steps: Step[] = [
  // 1: What the test is
  {
    title: 'Proofreading Test (DO NOT TAKE, WIP)',
    get text() {
      const st = testStatus.value;
      const t = st?.test;
      const hold = t?.hold_minutes ?? 60;
      const limit = t?.time_limit_minutes ?? null;
      const grants = t ? t.grants !== false : true;
      const lines = [
        'This is the real thing: one cell from the Sandbox with **several mistakes** on it, and nothing marked. Find and fix every one. Cut off what belongs to another cell, merge on what is missing, and mark the end of every branch with a point annotation.',
        grants
          ? 'Pass, and Pyr opens the production dataset to you: the real retina, where your edits count for science.'
          : 'This is a trial run of the test: a pass is recorded, and access to the real datasets is switched on by hand for now.',
        limit
          ? `**How it works.** One player at a time: the cell is yours alone while you work. **You have ${limit} minutes** from the moment you get the cell. When the cell is right, press **Submit for scoring**; if the time runs out first, the cell is scored as it stands. Cuts and merges are real edits on the Sandbox and are put back afterwards. The server checks the cell itself.`
          : `**How it works.** One player at a time: the cell is yours alone while you work. There is no time limit, but if you stop for ${hold} minutes the cell goes to the next person and that try is not scored. Cuts and merges are real edits on the Sandbox and are put back afterwards. When the cell is right, press **Submit for scoring**: the server checks the cell itself.`,
      ];
      if (!st) lines.push('Sign in to take the test.');
      else if (!t) lines.push('There is no test open right now. Check back later.');
      else {
        if (st.passed) lines.push('**You have already passed.** Production is open to you; you can take the test again for practice only if an admin resets your pass.');
        else if (st.wait_until) lines.push(`Your last try scored ${st.last?.percent ?? 0} percent. You can try again after ${new Date(st.wait_until).toLocaleString()}.`);
        else if (st.attempts && t.attempts_allowed) lines.push(`Tries used: ${st.attempts} of ${t.attempts_allowed}. Last score: ${st.last?.percent ?? 0} percent.`);
        else if (st.attempts) lines.push(`Tries so far: ${st.attempts}. Last score: ${st.last?.percent ?? 0} percent.`);
        const q = st.queue;
        if (q?.called_until) lines.push(`**It is your turn.** The cell is held for you until ${new Date(q.called_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
        else if (q?.position) lines.push(`**You are ${ordinal(q.position)} in line.** ${waitWords(q)} Pyr calls you when it is your turn: a notification, and the card at the top left, with 10 minutes to start.`);
        else if (cellBusyForMe(st)) {
          lines.push(q?.other_turn && !q.holder_until
            ? 'It is the turn of the next player in line right now. It is one player at a time.'
            : 'Someone is taking the test right now, and it is one player at a time.');
          if (st.can_start && q) lines.push(`**Join the line** and Pyr calls you when it is your turn: you get a notification and 10 minutes to start.${q && q.length ? ` ${q.length === 1 ? '1 player is' : `${q.length} players are`} waiting.` : ''}`);
        }
      }
      return lines.join('\n\n');
    },
    position: MIDDLE,
    width: '620px',
    get nextLabel() {
      const st = testStatus.value;
      if (cellBusyForMe(st) && st?.queue) return st.queue.position ? 'OK' : queueBusy.value ? 'one moment' : st?.can_start ? 'Join the line' : 'OK';
      return st?.test && (st.can_start || st.admin) ? 'Start the test' : 'next';
    },
    onEnter: () => { closeSidePanel(); stopWatching(); refreshTestStatus(); },
  } as Step,

  // 2: How to work the cell (Ames, 2026-10-11: say to mark ends with
  // annotations and to keep track with Highlight, in a box of its own)
  {
    title: 'How to work the cell',
    // It names the highlighter in the top bar (util/toolbar_staging.ts).
    reveals: ['highlight'],
    text: `
**Follow every branch to its end.** Use **Highlight** to paint each stretch you have checked, so you can see where you have been: press the highlighter in the top bar, or hold **H** and click two points on a branch.

**At the end of every branch, place an annotation point.** The **End** layer is ready for it: pick it in the layer tabs and click the last bit of the cell.

**Cut off anything that does not belong, and merge any missing pieces.**

Once you have the cell, the bar at the top left has an **i** for these instructions, the time you have left, and **Submit for scoring**.`,
    position: MIDDLE,
    width: '620px',
    nextLabel: 'Give me the cell',
    // The End layer is there as soon as this box says so (Ames, 2026-10-13).
    onEnter: () => { closeSidePanel(); stopWatching(); ensureEndLayer(); },
  } as Step,

  // 3: Getting the cell. It closes itself once the cell is on screen; the
  // bar at the top left takes over. It stays only when the claim is refused.
  {
    get title() { return session.phase === 'busy' ? 'Not right now' : 'Getting your cell'; },
    get text() {
      if (session.phase === 'busy') return `${session.error || 'The test is not available right now.'}\n\nPress **Try again** in a moment, or Exit and come back later.`;
      if (session.phase === 'none' && session.error) return session.error;
      return 'Holding the cell for you and putting it back to its start. This can take a minute.';
    },
    position: OVER_3D,
    width: '460px',
    get nextLabel() { return session.phase === 'busy' ? 'Try again' : 'one moment'; },
    onEnter: startWork,
  } as Step,

  // 4: The result
  {
    get title() {
      if (session.phase === 'scoring') return 'Scoring your cell';
      const r = session.result;
      if (!r) return session.error ? 'Something went wrong' : 'Nothing to score';
      return r.passed ? 'You passed!' : 'Not yet';
    },
    get text() { return resultText(); },
    position: OVER_3D,
    width: '500px',
    get image() { return session.result?.passed ? imgBravoNurro : undefined; },
    get nextLabel() {
      if (session.phase === 'scoring') return 'one moment';
      if (session.result?.passed) return 'done';
      const st = testStatus.value;
      return session.result && (st?.can_start || st?.admin) ? 'Try again' : 'done';
    },
    /** Confetti is for a pass only. */
    get noConfetti() { return !session.result?.passed; },
    onEnter: submitWork,
  } as Step,
];
