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
import { beginPractice, cellIsCut, endPractice, ensureTool } from './practice';
import { SANDBOX_CELLS } from './practice_pools';
import { supabase } from './supabase';
import { useProofreadingBackendStore } from './store';
import { show2D, showSections } from './tutorial-cut';
import { BLACK_BOX_NOTE, OVER_3D, celebrateStep, closeSidePanel, creditPractice, movingToSandbox, practiceEarned, recordTutorialDone, practiceStatus, resetPracticeLog, stopWatching, watchPractice } from './tutorial-3';

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
 * The mergers this player has cut, from their account (tutorial_completions),
 * so the count follows them to another computer. Added to what this browser
 * remembers; looked up once the player is known, and again on each start.
 */
async function loadDoneFromAccount() {
  try {
    const uid = useProofreadingBackendStore().userId;
    if (!uid) return;
    const { data, error } = await supabase.from('tutorial_completions')
      .select('item').eq('user_id', uid).eq('tutorial', SANDBOX_TUTORIAL).gt('practice_made', 0).limit(500);
    if (error || !data) return;
    for (const row of data as Array<{ item: string | null }>) if (row.item && SANDBOX_CELLS.some(c => c.id === row.item)) markDone(row.item);
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
  if (i < 0 || doneCount() >= TOTAL) return false;
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
  startSandbox(i < 0 ? 0 : i);
});

/** The done box asks the cell itself whether it was cut; until that answer
 *  is in, it says so instead of guessing. */
const checking = ref(false);
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
    get title() { return `Merger ${current + 1} of ${TOTAL}`; },
    get text() {
      const done = doneCount();
      return `
**Can you find and cut all ${TOTAL} mergers?** ${done === 0 ? 'This is the first.' : `You have cut ${done} so far.`}

Two neurons are fused into one segment here. Find where they touch and cut them apart, the way you did in the Cut tutorial: <strong style="color:#ff5c5c">red</strong> points on one neuron, **G**, <strong style="color:#5c8cff">blue</strong> points on the other, then **Submit cut**.

No preset points this time. Stuck? Press **Help me**.`;
    },
    position: OVER_3D,
    width: "440px",
    onEnter: async () => {
      closeSidePanel();
      stopWatching();
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
      watchPractice(false, 'Waiting for your cut: red on one neuron, G, blue on the other, Submit cut.', '', { advance: true });
      // Split view with Sections on: the merged views were saved 3D only,
      // and finding where two neurons touch needs the 2D images (Ames).
      setTimeout(() => { show2D(); showSections(); }, 500);
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
<span class="nge-done-lead">Congratulations, you found and cut all ${TOTAL} mergers. That is real proofreading: nobody marked the spots for you.</span>

` + BLACK_BOX_NOTE + `

The cells go back to their merged state for the next person. You can cut any of them again from the burger menu.`;
      }
      return `
<span class="nge-done-lead">Congratulations, that is ${done} of ${TOTAL}. ${left} ${left === 1 ? 'remains' : 'remain'}!</span>

` + BLACK_BOX_NOTE;
    },
    // One way forward (Ames: "Next merger" and "Done" side by side left it
    // unclear which to press). The main button goes to the next merger; the
    // x leaves.
    get nextLabel() {
      if (checking.value) return 'one moment';
      if (!thisOneCut()) return 'Try again';
      return nextUndone() >= 0 && doneCount() < TOTAL ? 'Next merger' : 'done';
    },
    position: OVER_3D,
    width: "440px",
    image: imgBravoNurro,
    onEnter: async () => {
      // Done means the cut was made, not that Next was pressed. Asked of the
      // cell itself too, so a cut the watch missed still counts.
      const id = cell().id;
      checking.value = true;
      try { if (await cellIsCut(id)) creditPractice(id); } finally { checking.value = false; }
      if (practiceEarned()) { markDone(id); celebrateStep(); recordTutorialDone(SANDBOX_TUTORIAL, id); }
      stopWatching();
      endPractice();
    },
  } as Step,
];
