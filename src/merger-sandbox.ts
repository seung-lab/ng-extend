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
import imgWheresNurro from './images/wheres-nurro.png';
import imgSandboxComplete from './images/sandbox-complete.jpg';
import { beginPractice, cellIsCut, endPractice, ensureTool } from './practice';
import { SANDBOX_CELLS } from './practice_pools';
import { supabase } from './supabase';
import { awardSpecialOnce } from './util/special_award';
import { useProofreadingBackendStore } from './store';
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
    cutNow.value = false;
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
/**
 * Slim box (Ames, 2026-10-12): the working box folded down to the chain, the
 * hint line and its buttons. The fold button sits at the end of the chain on
 * the working box only; the choice is kept in this browser. It is a class on
 * the body, because the box itself is redrawn by the app.
 */
const SLIM_KEY = 'nge-merger-sandbox-slim';
function applySlim(on: boolean) {
  document.body.classList.toggle('nge-sbx-slim', on);
  document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
}
try { if (localStorage.getItem(SLIM_KEY) === '1') applySlim(true); } catch { /* private mode */ }
document.addEventListener('nge:sandbox-slim', () => {
  const on = !document.body.classList.contains('nge-sbx-slim');
  applySlim(on);
  try { localStorage.setItem(SLIM_KEY, on ? '1' : '0'); } catch { /* private mode */ }
});
/** Whether there is another unsolved merger to skip to. */
const canSkip = () => { const other = nextUndone(); return other >= 0 && other !== current; };
// In the working box, Skip is a button to the left of Help me (Ames,
// 2026-10-12). Only when there is another merger to go to.
document.addEventListener('nge:practice-helprow', ((e: CustomEvent) => {
  const { row, help } = e.detail || {};
  if (!row || useTutorialStore().activeTutorial !== SANDBOX_TUTORIAL || !canSkip() || row.querySelector('.nge-sbx-skipbtn')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nge-hud-btn nge-hud-btn--sm nge-sbx-skipbtn';
  b.textContent = 'Skip';
  b.title = 'Leave this merger for later and go to another';
  b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('nge:sandbox-skip')));
  row.insertBefore(b, help ?? null);
}) as EventListener);
const SKIP = `<button type="button" class="nge-sbx-skip" onclick="document.dispatchEvent(new CustomEvent('nge:sandbox-skip'))">Skip this one</button>`;
const FOLD = `<button type="button" class="nge-sbx-fold" title="Smaller or larger box" aria-label="Make this box smaller or larger" onclick="document.dispatchEvent(new CustomEvent('nge:sandbox-slim'))"></button>`;

function progressBar(fold = false): string {
  const done = SANDBOX_CELLS.map(c => sandboxDone.value.includes(c.id));
  let chain = '';
  done.forEach((d, i) => {
    const state = d ? 'done' : i === current ? 'now' : 'todo';
    chain += `<span class="nge-sbx-node nge-sbx-node--${state}" title="Merger ${i + 1}${d ? ', solved' : state === 'now' ? ', this one' : ''}"></span>`;
    // The line between two solved mergers lights up.
    if (i < TOTAL - 1) chain += `<span class="nge-sbx-link${d && done[i + 1] ? ' nge-sbx-link--lit' : ''}"></span>`;
  });
  const n = doneCount();
  return `<div class="nge-sbx-progress${n >= TOTAL ? ' nge-sbx-progress--all' : ''}" role="img" aria-label="${n} of ${TOTAL} mergers solved"><span class="nge-sbx-track">${chain}</span><span class="nge-sbx-count"><b>${n}</b><i>/ ${TOTAL}</i><em>solved</em></span>${fold ? FOLD : ''}</div>`;
}

/** The done box asks the cell itself whether it was cut; until that answer
 *  is in, it says so instead of guessing. */
const checking = ref(false);
/** The last cut being written to the account. */
let recorded: Promise<unknown> = Promise.resolve();
/** Whether this attempt cut the merger. Not "was it ever cut": on a second
 *  go at a solved merger, a miss used to read as a success. */
const cutNow = ref(false);
const thisOneCut = () => cutNow.value;

/**
 * Skip (Ames, 2026-10-12): the first box's button moves on to another merger
 * that is not solved yet. If this one turns out to be cut after all (the
 * watch can miss it), it goes to the success box instead. With no other
 * merger left to try, it goes to the check box as before.
 */
/** Which attempt to take a cell is the current one. */
let taking = 0;
let skipping = false;
// Skip is its own small button, in the full box and on the "still fused"
// box. The main button is Next (Ames, 2026-10-12): it checks the cut.
document.addEventListener('nge:sandbox-skip', () => {
  const store = useTutorialStore();
  if (store.activeTutorial !== SANDBOX_TUTORIAL) return;
  // From the "still fused" box: straight on to another merger.
  if (store.getTutorialStep() === 1) { const other = nextUndone(); if (other >= 0 && other !== current) startSandbox(other); return; }
  sandboxSkip();
});
function sandboxSkip(): boolean {
  if (askAgain.value) return false;
  if (skipping) return true;
  skipping = true;
  const store = useTutorialStore();
  const id = cell().id, at = current;
  void cellIsCut(id).catch(() => null).then((cut) => {
    skipping = false;
    if (store.activeTutorial !== SANDBOX_TUTORIAL || current !== at || store.getTutorialStep() !== 0) return;
    const other = nextUndone();
    if (cut) { store.setTutorialStep(1); return; }
    // Nothing else to go to: stay put and say so. This used to drop the
    // player on the "still fused" box (Ames, 2026-10-12).
    if (other < 0 || other === at) { practiceStatus('This is the only merger you have left, so there is nothing to skip to.'); return; }
    startSandbox(other);
  });
  return true;
}

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
${progressBar(true)}

Two neurons are fused into one segment here. Find where they touch and cut them apart.`;
    },
    position: OVER_3D,
    width: "440px",
    // The tools a merger is found and cut with (util/toolbar_staging.ts).
    reveals: ['split', 'findPath', 'highlight'],
    onEnter: async () => {
      closeSidePanel();
      stopWatching();
      // Asking whether to go again: no cell is taken until they say yes.
      if (askAgain.value) return;
      // One merger is assigned at a time, and players work in parallel
      // (Ames, 2026-10-08): if this one is taken, another this player has
      // NOT solved is given instead. Never a solved one while unsolved ones
      // remain: a player whose last merger was being reset was handed the
      // one before it, solved it again, and was sent round in a loop
      // (AzureJay, 2026-10-12). With none free, the box says so and keeps
      // trying by itself.
      const solved = (i: number) => sandboxDone.value.includes(SANDBOX_CELLS[i].id);
      const everyone = [current, ...SANDBOX_CELLS.map((_, i) => i).filter(i => i !== current)];
      const unsolved = everyone.filter(i => !solved(i));
      const order = unsolved.length ? unsolved : everyone;
      const mine = ++taking;
      const store = useTutorialStore();
      const take = async () => {
        for (const i of order) {
          const cellRow = await beginPractice('cut', 'start', { only: SANDBOX_CELLS[i].id });
          if (cellRow) { current = i; return cellRow; }
        }
        return null;
      };
      let got = await movingToSandbox('Merger Sandbox', take);
      for (let tries = 0; !got && tries < 40; tries++) {
        practiceStatus(order.length === 1
          ? 'This merger is being put back to its starting state. It will open by itself in a moment.'
          : 'The mergers you have left are in use or being put back to their starting state. One will open by itself in a moment.');
        await new Promise(r => setTimeout(r, 15000));
        // The player closed the box or moved on meanwhile.
        if (mine !== taking || store.activeTutorial !== SANDBOX_TUTORIAL || store.getTutorialStep() !== 0) return;
        got = await take();
      }
      if (!got) {
        practiceStatus('No merger came free. Try again in a few minutes.');
        return;
      }
      if (mine !== taking) return;
      // Watch only once the cell is held: with nothing held, the watch
      // would queue for the Cut tutorial's cells.
      watchPractice(false, 'Ctrl+click to add points. Remember to press G to switch the cut color group.', '', { advance: true });
      // The cell loads in 3D (practice.ts sets the layout in the view
      // itself); Space brings the 2D images back.
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
<img class="nge-sbx-nurro" src="${imgWheresNurro}" alt="">

The two neurons are still one segment, so this one is not cut yet. Press **Try again** to have another go. **Help me** there shows where the points go. ${canSkip() ? SKIP : ''}`;
      }
      if (left <= 0) {
        return `
<span class="nge-sbx-figure" tabindex="0"><img src="${imgSandboxComplete}" alt="Pyramidal neurons from the hippocampus"><span class="nge-sbx-figcap">Pyramidal neurons from the hippocampus, with mossy fiber axons (yellow), traced by citizen scientists. Up close: a synapse.</span></span>

<span class="nge-done-lead">Congratulations, you found and cut all ${TOTAL} mergers. That is real proofreading.</span>

To go again, open the Merger Sandbox from the burger menu.`;
      }
      return `
<img class="nge-sbx-nurro" src="${imgBravoNurro}" alt="">

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
    // Pictures sit in the text, small, so the box fits a laptop screen.
    // Confetti is thrown once, by celebrateStep, when the cut is confirmed:
    // the button itself throws none (it used to, even on Try again).
    noConfetti: true,
    onEnter: async () => {
      // Done means the cut was made, not that Next was pressed. Asked of the
      // cell itself too, so a cut the watch missed still counts.
      const id = cell().id;
      checking.value = true;
      let earned = false;
      try { if (await cellIsCut(id)) creditPractice(id); earned = practiceEarned(); } finally { cutNow.value = earned; checking.value = false; }
      if (earned) {
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
