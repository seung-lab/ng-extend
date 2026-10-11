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
import { useLayersStore, useProofreadingBackendStore } from './store';
import { refreshDatasetPermissions } from './util/dataset_access';
import { endPractice, openSplitView, showOnly } from './practice';
import { showSections } from './tutorial-cut';
import { MIDDLE, OVER_3D, celebrateStep, closeSidePanel, getViewer, movingToSandbox, stopWatching } from './tutorial-3';
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
}
export interface TestStatus {
  test: TestInfo | null; free?: boolean; mine?: boolean; attempts?: number; passed?: boolean; admin?: boolean;
  last?: { outcome: string; found: number; errors: number; damaged: number; percent: number; submitted_at: string } | null;
  wait_until?: string | null; can_start?: boolean;
}
interface StartResult { test: TestInfo; session: string; attempt: number; resumed: boolean; checks: number; endpoints: number; root: string | null; }
export interface TestResult {
  passed: boolean; feedback: string;
  granted?: { pilot: boolean; groups: { id: number; ok: boolean }[] };
  found?: number; errors?: number; damaged?: number; percent?: number; endpoints?: number; endpointsFound?: number; stray?: number;
  checks?: { kind: string; label: string; ok: boolean; point: number[] | null }[];
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
setTimeout(() => { if (userId()) refreshTestStatus(); }, 8000);
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
    const quiet = Math.max(5, session.test.hold_minutes || 60) * 60 * 1000;
    if (idle < 60 * 1000 && Date.now() - lastHeartbeat > 60 * 1000) {
      lastHeartbeat = Date.now();
      secureWrite('test.heartbeat', { id: session.test.id, session: session.nonce }).catch((e: any) => {
        const why = String(e?.message || e);
        console.warn('[test] the hold could not be renewed:', why);
        // Only a hold the server says is over ends the test here; a busy
        // server gets another try in a minute.
        if (/has ended|not found|Unknown test/i.test(why)) holdLost('The server ended your session, so this try is over.');
      });
    }
    const left = quiet - idle;
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

/** Open the test from the menu (or again after a fail). */
export async function startTest() {
  const store = useTutorialStore();
  stopWatching();
  hidePyrMarkers();
  // Any practice cells go back first, as the Merger Sandbox does.
  try { await endPractice(); } catch { /* the practice reset job covers it */ }
  session.result = null;
  session.error = '';
  session.phase = 'none';
  store.activeTutorial = TEST_TUTORIAL;
  // Past the end, then to the start: a step is keyed by its index, so going
  // from box 1 to box 1 would not reload it.
  store.setTutorialStep(steps.length);
  setTimeout(() => store.setTutorialStep(0), 60);
}
document.addEventListener('nge:test-start', () => { startTest(); });

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
  const got = await movingToSandbox('Proofreading Test', async () => {
    try { return await secureWrite<StartResult>('test.start'); }
    catch (e: any) { session.error = String(e?.message || e); return null; }
  });
  if (!got) { session.phase = 'busy'; return; }
  session.test = got.test;
  session.nonce = got.session;
  session.attempt = got.attempt;
  session.resumed = got.resumed;
  // How many things there are to find is itself a hint: only when the test
  // gives feedback at all.
  session.checks = got.test.feedback === 'none' ? 0 : got.checks;
  session.endpoints = got.test.feedback === 'none' ? 0 : got.endpoints;
  try { await useLayersStore().loadState(got.test.state_url); }
  catch (e) { console.warn('[test] the start view did not load:', e); }
  await new Promise(r => setTimeout(r, 800));
  // A reload mid test: the saved view names the cell's old root, so show
  // the root as it is now, with the player's edits.
  if (got.root) { try { showOnly(got.test.dataset, [got.root]); } catch (e) { /* the view still loads */ } }
  session.phase = 'working';
  startHold();
  setTimeout(() => { openSplitView(); showSections(); }, 500);
}

async function submitWork() {
  const store = useTutorialStore();
  // "Try again" from a refused start: back to the cell box, which claims again.
  if (session.phase === 'busy') { store.setTutorialStep(2); return; }
  if (session.phase !== 'working' || !session.nonce || !session.test) { session.result = null; return; }
  session.phase = 'scoring';
  stopHold();
  hidePyrMarkers();
  const id = session.test.id, nonce = session.nonce;
  const annotations = collectPointAnnotations();
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
  session.nonce = '';
  session.phase = 'done';
  refreshTestStatus();
}

/** Detail feedback: a Pyr pin on each miss, for two minutes. */
function showMisses(checks: NonNullable<TestResult['checks']>) {
  const missed = checks.filter(c => !c.ok && Array.isArray(c.point));
  if (!missed.length) return;
  showPyrMarkers(missed.map(c => c.point as number[]), missed.map(c => c.label || c.kind), 120);
}

const percentWord = (r: TestResult) => `${r.percent ?? 0} percent`;

function resultText(): string {
  const r = session.result;
  if (session.phase === 'scoring') return 'Reading the cell from the server. This takes a moment: every piece is checked, then the cell is put back for the next person.';
  if (!r) {
    return session.error
      ? `${session.error}\n\nNothing was scored. Press back to return to the cell if it is still yours, or Exit and start again.`
      : 'There was no test in progress to score. Start the test from the menu.';
  }
  const parts: string[] = [];
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
    if (r.stray) bits.push(`${r.stray} point${r.stray === 1 ? '' : 's'} placed where no branch ends`);
    parts.push(`**Score: ${percentWord(r)}.** ${bits.join('; ')}.`);
    if (!r.passed && r.damaged) parts.push('Damage to the real cell fails the test on its own, however many mistakes you found. Cut only where two different cells touch, and look at the 2D images before you place a point.');
    if (r.checks) {
      const missed = r.checks.filter(c => !c.ok);
      if (missed.length) parts.push('Pins mark what was missed for the next two minutes: ' + missed.map(c => c.label || c.kind).join(', ') + '.');
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

export const steps: Step[] = [
  // 1: What the test is
  {
    title: 'Proofreading Test',
    get text() {
      const st = testStatus.value;
      const t = st?.test;
      const hold = t?.hold_minutes ?? 60;
      const grants = t ? t.grants !== false : true;
      const lines = [
        'This is the real thing: one cell from the Sandbox with **several mistakes** on it, and nothing marked. Find and fix every one. Cut off what belongs to another cell, merge on what is missing, and mark the end of every branch with a point annotation.',
        grants
          ? 'Pass, and Pyr opens the production dataset to you: the real retina, where your edits count for science.'
          : 'This is a trial run of the test: a pass is recorded, and access to the real datasets is switched on by hand for now.',
        `**How it works.** One player at a time: the cell is yours alone while you work, and after ${hold} quiet minutes it goes to the next person. Cuts and merges are real edits on the Sandbox and are put back afterwards. When the cell is right, press **Submit for scoring**: the server checks the cell itself.`,
      ];
      if (!st) lines.push('Sign in to take the test.');
      else if (!t) lines.push('There is no test open right now. Check back later.');
      else {
        if (st.passed) lines.push('**You have already passed.** Production is open to you; you can take the test again for practice only if an admin resets your pass.');
        else if (st.wait_until) lines.push(`Your last try scored ${st.last?.percent ?? 0} percent. You can try again after ${new Date(st.wait_until).toLocaleString()}.`);
        else if (st.attempts && t.attempts_allowed) lines.push(`Tries used: ${st.attempts} of ${t.attempts_allowed}. Last score: ${st.last?.percent ?? 0} percent.`);
        else if (st.attempts) lines.push(`Tries so far: ${st.attempts}. Last score: ${st.last?.percent ?? 0} percent.`);
        if (!st.free && !st.mine) lines.push('Someone is taking the test right now, and it is one player at a time. It frees up when they finish or go quiet.');
      }
      return lines.join('\n\n');
    },
    position: MIDDLE,
    width: '620px',
    get nextLabel() {
      const st = testStatus.value;
      return st?.test && (st.can_start || st.admin) ? 'Start the test' : 'next';
    },
    onEnter: () => { closeSidePanel(); stopWatching(); refreshTestStatus(); },
  } as Step,

  // 2: How to work the cell (Ames, 2026-10-11: say to mark ends with
  // annotations and to keep track with Highlight, in a box of its own)
  {
    title: 'How to work the cell',
    text: `
**Follow every branch to its end.** Use **Highlight** to paint each stretch you have checked, so you can see where you have been: press the highlighter in the top bar, or hold **H** and click two points on a branch.

**Where a branch truly ends, mark it.** Click **+** at the end of the layer tabs to make an annotation layer (the point tool is already picked), then click the last bit of the cell. One point per end; a point anywhere on the end is fine.

**Fix what is wrong as you go.** A branch that belongs to another cell: press **C**, red points on one side of the join, **G**, blue on the other, then Submit cut. A piece that is missing: press **M**, Ctrl+click the cell and the piece, then Submit.

Check the 2D images before every cut: that is where a false join shows.`,
    position: MIDDLE,
    width: '620px',
    nextLabel: 'Give me the cell',
    onEnter: () => { closeSidePanel(); stopWatching(); },
  } as Step,

  // 3: The cell
  {
    get title() {
      if (session.phase === 'busy') return 'Not right now';
      if (session.phase === 'claiming') return 'Getting your cell';
      return 'Fix this cell';
    },
    get text() {
      if (session.phase === 'busy') return `${session.error || 'The test is not available right now.'}\n\nPress **Try again** in a moment, or Exit and come back later.`;
      if (session.phase === 'claiming') return 'Holding the cell for you and putting it back to its start. This can take a minute.';
      if (session.phase === 'none' && session.error) return session.error;
      const n = session.checks, e = session.endpoints;
      const what = n ? `There are **${n} things to fix**` : 'Fix everything you find';
      const ends = e ? ` and **${e} branch end${e === 1 ? '' : 's'}** to mark` : '';
      return `
${session.resumed ? 'Welcome back: your edits so far are still on the cell.' : 'The cell is yours.'} ${what}${ends}. Nothing is marked for you.

- <strong style="color:#e06060">Cut</strong> off anything that belongs to another cell: press **C**, red points on one side, **G**, blue on the other, then Submit cut.
- <strong style="color:#60c060">Merge</strong> on any piece that is missing: press **M**, Ctrl+click the cell and the piece, then Submit.
- Mark where each branch ends: with the point tool in an annotation layer, click the last bit of segmentation.

Take your time. When the cell is right, press **Submit for scoring**.`;
    },
    position: OVER_3D,
    width: '460px',
    get nextLabel() {
      if (session.phase === 'working') return 'Submit for scoring';
      if (session.phase === 'busy') return 'Try again';
      return 'one moment';
    },
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
