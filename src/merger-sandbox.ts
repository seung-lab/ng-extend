/**
 * merger-sandbox.ts: Tutorial 9, the Merger Sandbox (Ames, 2026-10-06).
 *
 * A set of standalone cut exercises from Celia's list, opened one at a time
 * from the burger menu. Each starts on its merged view (two neurons fused
 * into one segment) and is done when its two registered points sit on
 * different segments, which is what a `cut` practice cell already checks.
 * The cells are listed in practice_pools.ts; each is its own pool of one, so
 * a learner here does not hold the Cut tutorial and never gets its cells.
 */
import { ref } from 'vue';
import { Step, useTutorialStore } from './store-pyr';
import imgBravoNurro from './images/bravo-nurro.png';
import imgPyrGem from './images/pyr-icon.png';
import imgSandboxComplete from './images/sandbox-complete.jpg';
import { beginPractice, cellIsCut, endPractice, ensureTool } from './practice';
import { SANDBOX_CELLS } from './practice_pools';
import { supabase } from './supabase';
import { awardSpecialOnce } from './util/special_award';
import { useProofreadingBackendStore } from './store';
import { BLACK_BOX_NOTE, OVER_3D, celebrateStep, closeSidePanel, creditPractice, getViewer, movingToSandbox, practiceEarned, recordTutorialDone, practiceStatus, resetPracticeLog, stopWatching, watchPractice } from './tutorial-3';

export const SANDBOX_TUTORIAL = 9;

/** Which example is open (index into SANDBOX_CELLS). */
let current = 0;
const cell = () => SANDBOX_CELLS[current] ?? SANDBOX_CELLS[0];

/** Examples this browser has finished, for the tick in the menu. */
const DONE_KEY = 'nge-merger-sandbox-done';
function readDone(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export const sandboxDone = ref<string[]>(readDone());
function markDone(id: string) {
  if (sandboxDone.value.includes(id)) return;
  sandboxDone.value = [...sandboxDone.value, id];
  try { localStorage.setItem(DONE_KEY, JSON.stringify(sandboxDone.value)); } catch { /* private mode */ }
}

/**
 * Starting over (Ames, 2026-10-11). The account's record of cut mergers is
 * kept for good (it is what the Achievement and any later scoring read), so
 * a new run is a line drawn in time: only cuts made after it count toward
 * the chain on screen. The line is kept in this browser.
 */
const RUN_KEY = 'nge-merger-sandbox-run-from';
function runFrom(): string | null { try { return localStorage.getItem(RUN_KEY); } catch { return null; } }
/** True while the first box is asking a player who has solved them all
 *  whether to go again. */
const askAgain = ref(false);
/** For Tutorial.vue: the main button on that box starts a new run. */
export function sandboxRestart(): boolean {
  if (!askAgain.value) return false;
  askAgain.value = false;
  sandboxDone.value = [];
  try { localStorage.setItem(DONE_KEY, '[]'); localStorage.setItem(RUN_KEY, new Date().toISOString()); } catch { /* private mode */ }
  startSandbox(0);
  return true;
}

/**
 * Every merger in the sandbox cut: a special Achievement (Ames 2026-10-10).
 * An admin makes it in the Admin Hub with the code name below, under any
 * name and art; until then this does nothing, and it is checked again on
 * every sign in, so players who finished earlier still get it. The server
 * checks the player's own record of cut mergers before it lets the award
 * through (functions/index.js), so this browser's memory alone is not enough.
 */
export const SANDBOX_AWARD_SLUG = 'merger-sandbox';
function awardIfAllCut() {
  if (!SANDBOX_CELLS.every(c => sandboxDone.value.includes(c.id))) return;
  void awardSpecialOnce({
    slug: SANDBOX_AWARD_SLUG,
    reason: `Cut all ${SANDBOX_CELLS.length} mergers in the Merger Sandbox`,
    earnedBy: `cut all ${SANDBOX_CELLS.length} mergers in the Merger Sandbox`,
  });
}

/**
 * The mergers this player has cut, from their account (tutorial_completions),
 * so the count follows them to another computer. Added to what this browser
 * remembers; looked up once the player is known, and again on each start.
 */
async function loadDoneFromAccount() {
  try {
    const uid = useProofreadingBackendStore().userId;
    if (!uid) return;
    let q = supabase.from('tutorial_completions')
      .select('item').eq('user_id', uid).eq('tutorial', SANDBOX_TUTORIAL).gt('practice_made', 0);
    const from = runFrom();
    if (from) q = q.gt('completed_at', from);
    const { data, error } = await q.limit(500);
    if (error || !data) return;
    for (const row of data as Array<{ item: string | null }>) if (row.item && SANDBOX_CELLS.some(c => c.id === row.item)) markDone(row.item);
    // Asked from the account's record, so it also reaches players who cut
    // the last merger before the Achievement existed.
    awardIfAllCut();
  } catch { /* the browser's own record still counts */ }
}
setTimeout(loadDoneFromAccount, 6000);

/** Open one example from the menu, or from another example's last box. */
export function startSandbox(index: number) {
  if (!SANDBOX_CELLS[index]) return;
  const store = useTutorialStore();
  loadDoneFromAccount();
  stopWatching();
  // Hand back whatever is held (another example, or a tutorial's cells).
  const from = store.activeTutorial, fromStep = store.getTutorialStep();
  endPractice().finally(() => {
    // Handing cells back can take seconds. If the player closed the box or
    // went elsewhere meanwhile, do not pop a sandbox box up over them.
    if (store.activeTutorial !== from || store.getTutorialStep() !== fromStep) return;
    resetPracticeLog();
    current = index;
    store.activeTutorial = SANDBOX_TUTORIAL;
    // Past the end, then to the start: the step is keyed by its index, so
    // going from box 1 of one example to box 1 of another would not reload.
    store.setTutorialStep(steps.length);
    setTimeout(() => store.setTutorialStep(0), 60);
  });
}
document.addEventListener('nge:sandbox-start', ((e: CustomEvent) => {
  const i = Number(e.detail?.index);
  if (Number.isInteger(i)) startSandbox(i);
}) as EventListener);

/** For Tutorial.vue: on the sandbox's last box the main button moves on to
 *  the next merger while any are left. True when it did. */
export function sandboxContinue(): boolean {
  if (checking.value) return true;
  // Not cut: the same merger again.
  if (!thisOneCut()) { startSandbox(current); return true; }
  const i = nextUndone();
  if (i < 0 || doneCount() >= TOTAL) {
    // "Complete the Sandbox": the box closes and the Achievement is given,
    // once the last cut is on the account.
    void recorded.then(() => awardIfAllCut());
    return false;
  }
  startSandbox(i);
  return true;
}

/** How many of the mergers this browser has cut, and which comes next. */
const TOTAL = SANDBOX_CELLS.length;
const doneCount = () => SANDBOX_CELLS.filter(c => sandboxDone.value.includes(c.id)).length;
function nextUndone(after = current): number {
  for (let k = 1; k <= TOTAL; k++) {
    const i = (after + k) % TOTAL;
    if (!sandboxDone.value.includes(SANDBOX_CELLS[i].id)) return i;
  }
  return -1;
}
// From the Cut tutorial's last box: start with the first merger not cut yet.
document.addEventListener('nge:sandbox-next', () => {
  const i = nextUndone(-1);
  // All solved already: ask before handing out a cell again.
  askAgain.value = i < 0;
  startSandbox(i < 0 ? 0 : i);
});

/** The run of mergers as a row of cells: lit for each one cut, a pulse on
 *  the one in hand, dim for the rest, with the count beside it. */
function progressBar(): string {
  const done = SANDBOX_CELLS.map(c => sandboxDone.value.includes(c.id));
  let chain = '';
  done.forEach((d, i) => {
    const state = d ? 'done' : i === current ? 'now' : 'todo';
    chain += `<span class="nge-sbx-node nge-sbx-node--${state}" title="Merger ${i + 1}${d ? ', solved' : state === 'now' ? ', this one' : ''}"><img src="${imgPyrGem}" alt=""></span>`;
    // The line between two solved mergers lights up.
    if (i < TOTAL - 1) chain += `<span class="nge-sbx-link${d && done[i + 1] ? ' nge-sbx-link--lit' : ''}"></span>`;
  });
  const n = doneCount();
  return `<div class="nge-sbx-progress${n >= TOTAL ? ' nge-sbx-progress--all' : ''}" role="img" aria-label="${n} of ${TOTAL} mergers solved"><span class="nge-sbx-track">${chain}</span><span class="nge-sbx-count"><b>${n}</b><i>/ ${TOTAL}</i><em>solved</em></span></div>`;
}

/** The done box asks the cell itself whether it was cut; until that answer
 *  is in, it says so instead of guessing. */
const checking = ref(false);
/** The last cut being written to the account. */
let recorded: Promise<unknown> = Promise.resolve();
const thisOneCut = () => sandboxDone.value.includes(cell().id);

/**
 * The sandbox reads as one challenge, "cut all 5 mergers" (Nseraf,
 * 2026-10-08: five separate entries left him unsure what was being asked).
 * Each box says which merger this is and how many are left, and the last
 * one congratulates on the set.
 */
export const steps: Step[] = [
  // 1: The exercise
  {
    get title() { return askAgain.value ? `All ${TOTAL} merger mysteries solved` : `Can you solve all ${TOTAL} merger mysteries?`; },
    get nextLabel() { return askAgain.value ? 'Start again' : undefined; },
    get text() {
      if (askAgain.value) {
        return `
${progressBar()}

You have solved every one. Want to go again from the start? Your Achievement stays yours.`;
      }
      return `
${progressBar()}

Two neurons are fused into one segment here. Find where they touch and cut them apart.`;
    },
    position: OVER_3D,
    width: "440px",
    onEnter: async () => {
      closeSidePanel();
      stopWatching();
      // Asking whether to go again: no cell is taken until they say yes.
      if (askAgain.value) return;
      // One merger is assigned at a time, and players work in parallel
      // (Ames, 2026-10-08): if this one is taken, the next free one this
      // player has not cut is given instead, then any free one.
      const order = [current, ...SANDBOX_CELLS.map((_, i) => i).filter(i => i !== current)]
        .sort((a, b) => Number(sandboxDone.value.includes(SANDBOX_CELLS[a].id)) - Number(sandboxDone.value.includes(SANDBOX_CELLS[b].id)));
      const got = await movingToSandbox('Merger Sandbox', async () => {
        for (const i of order) {
          const cellRow = await beginPractice('cut', 'start', { only: SANDBOX_CELLS[i].id });
          if (cellRow) { current = i; return cellRow; }
        }
        return null;
      });
      if (!got) {
        practiceStatus(`Every merger is being worked on by someone else right now, or is being reset. Try again in a few minutes.`);
        return;
      }
      // Watch only once the cell is held: with nothing held, the watch
      // would queue for the Cut tutorial's cells.
      watchPractice(false, 'Ctrl+click to add points. Remember to press G to switch the cut colour group.', '', { advance: true });
      // 3D only to start (Ames, 2026-10-11, reversing the split view of
      // 2026-10-08): the whole cell is easier to read, and Space brings the
      // 2D images back when the join needs a closer look.
      setTimeout(() => { try { getViewer()?.layout?.restoreState('3d'); } catch { /* no viewer */ } }, 500);
      setTimeout(() => ensureTool('multicut'), 1100);
    },
  } as Step,

  // 2: Done
  {
    get title() {
      if (checking.value) return `Checking merger ${current + 1}`;
      if (!thisOneCut()) return `Merger ${current + 1} is still fused`;
      return doneCount() >= TOTAL ? `All ${TOTAL} mergers cut!` : `Merger ${current + 1} cut!`;
    },
    get text() {
      const done = doneCount(), left = TOTAL - done;
      if (checking.value) return `Checking your cut.`;
      if (!thisOneCut()) {
        return `
The two neurons are still one segment, so this one is not cut yet. Place <strong style="color:#ff5c5c">red</strong> points on one neuron, press **G**, place <strong style="color:#5c8cff">blue</strong> points on the other, then **Submit cut**.

Press **Try again** to have another go, or **Help me** there to see where the points go.`;
      }
      if (left <= 0) {
        return `
<span class="nge-sbx-figure" tabindex="0"><img src="${imgSandboxComplete}" alt="Pyramidal neurons from the hippocampus"><span class="nge-sbx-figcap">Pyramidal neurons from the hippocampus, with mossy fiber axons (yellow), traced by citizen scientists. Up close: a synapse.</span></span>

<span class="nge-done-lead">Congratulations, you found and cut all ${TOTAL} mergers. That is real proofreading.</span>

To go again, open the Merger Sandbox from the burger menu.`;
      }
      return `
<span class="nge-done-lead">Congratulations, that is ${done} of ${TOTAL}. ${left} ${left === 1 ? 'remains' : 'remain'}!</span>

${progressBar()}

` + BLACK_BOX_NOTE;
    },
    // One way forward (Ames: "Next merger" and "Done" side by side left it
    // unclear which to press). The main button goes to the next merger; the
    // x leaves.
    get nextLabel() {
      if (checking.value) return 'one moment';
      if (!thisOneCut()) return 'Try again';
      return nextUndone() >= 0 && doneCount() < TOTAL ? 'Next merger' : 'Finish';
    },
    position: OVER_3D,
    width: "440px",
    // The last box of the set shows what all this is for (Ames's picture).
    // The last box of the set carries its own picture in the text, with its
    // caption on hover; the others have Nurro.
    get image() { return !checking.value && thisOneCut() && doneCount() >= TOTAL ? undefined : imgBravoNurro; },
    onEnter: async () => {
      // Done means the cut was made, not that Next was pressed. Asked of the
      // cell itself too, so a cut the watch missed still counts.
      const id = cell().id;
      checking.value = true;
      try { if (await cellIsCut(id)) creditPractice(id); } finally { checking.value = false; }
      if (practiceEarned()) {
        markDone(id); celebrateStep();
        // Recorded on the account first: the server looks there before it
        // lets the Achievement through.
        // The Achievement itself waits for "Complete the Sandbox" on the
        // last box (Ames, 2026-10-11: it popped up before that box did).
        recorded = Promise.resolve(recordTutorialDone(SANDBOX_TUTORIAL, id)).catch(() => {});
      }
      stopWatching();
      endPractice();
    },
  } as Step,
];
