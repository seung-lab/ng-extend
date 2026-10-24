/**
 * sandbox.ts: one practice sandbox, built from its settings (Ames,
 * 2026-10-24). The Merger Sandbox (tutorial 9, cuts) and the Extension
 * Sandbox (tutorial 13, merges) are the same game: a set of practice cells,
 * one handed out at a time, players in parallel, a row of dots for progress,
 * Skip, a slim bar, Start again once all are solved. Only the words, the
 * tool and the test for "solved" differ, so they share this code and stay
 * alike as either one changes.
 *
 * Each sandbox listens on its own events (`nge:<ev>-next`, `-start`, `-skip`,
 * `-slim`) and keeps its own records in this browser (`<key>-done`, `-run-from`,
 * `-slim`). The Merger Sandbox's names are the ones it always had.
 */
import { ref } from 'vue';
import { Step, useTutorialStore } from './store-pyr';
import imgBravoNurro from './images/bravo-nurro.png';
import imgWheresNurro from './images/wheres-nurro.png';
import { beginPractice, cellIsCut, cellIsJoined, endPractice, ensureTool, type PracticeKind } from './practice';
import type { SandboxCell } from './practice_pools';
import { supabase } from './supabase';
import { awardSpecialOnce } from './util/special_award';
import { useProofreadingBackendStore } from './store';
import { BLACK_BOX_NOTE, OVER_3D, celebrateStep, closeSidePanel, creditPractice, movingToSandbox, practiceEarned, recordTutorialDone, practiceStatus, resetPracticeLog, stopWatching, watchPractice } from './tutorial-3';

export interface SandboxWords {
  /** The sandbox's name, for the moving card. */
  name: string;
  /** One exercise, as the boxes say it ("merger", "cell"). */
  one: string;
  /** Title of the working box. */
  title(total: number): string;
  /** Title of the "start again" box. */
  allSolvedTitle(total: number): string;
  /** The working box's sentence. */
  intro(cell: SandboxCell): string;
  /** The standing hint while the tool is in use. */
  hint: string;
  /** "Checking your cut." */
  checking: string;
  /** Title and text when the exercise is not solved yet. */
  notDoneTitle(n: number): string;
  notDone: string;
  /** Title when one is solved, and when all are. */
  doneTitle(n: number): string;
  allDoneTitle(total: number): string;
  /** The last box, once every exercise is solved (may carry a picture). */
  allDone(total: number): string;
  /** Main button on a success box with more to go. */
  nextLabel: string;
  /** Skip's tooltip. */
  skipTip: string;
  /** For the Achievement record, if the sandbox has one. */
  awardReason?(total: number): string;
}

export interface SandboxConfig {
  tutorial: number;
  kind: PracticeKind;
  cells: SandboxCell[];
  /** Event name stem: `nge:${ev}-next` and so on. */
  ev: string;
  /** localStorage key stem. */
  key: string;
  /** The tool the exercise uses. */
  tool: 'merge' | 'multicut';
  /** Toolbar icons the working box brings in (util/toolbar_staging.ts). */
  reveals: string[];
  /** Code name of a special Achievement for solving them all, if any. */
  awardSlug?: string;
  words: SandboxWords;
}

export function makeSandbox(cfg: SandboxConfig) {
  const { tutorial, cells: CELLS, words: W } = cfg;
  const isSolved = (id: string) => cfg.kind === 'cut' ? cellIsCut(id) : cellIsJoined(id);

  /** Which example is open (index into CELLS). */
  let current = 0;
  const cell = () => CELLS[current] ?? CELLS[0];

  /** Examples this browser has finished, for the tick in the menu. */
  const DONE_KEY = `${cfg.key}-done`;
  function readDone(): string[] {
    try { const v = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  const done = ref<string[]>(readDone());
  function markDone(id: string) {
    if (done.value.includes(id)) return;
    done.value = [...done.value, id];
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done.value)); } catch { /* private mode */ }
  }

  /**
   * Starting over (Ames, 2026-10-11). The account's record is kept for good
   * (it is what the Achievement and any later scoring read), so a new run is
   * a line drawn in time: only exercises solved after it count toward the
   * dots on screen. The line is kept in this browser.
   */
  const RUN_KEY = `${cfg.key}-run-from`;
  function runFrom(): string | null { try { return localStorage.getItem(RUN_KEY); } catch { return null; } }
  /** True while the first box is asking a player who has solved them all
   *  whether to go again. */
  const askAgain = ref(false);
  /** For Tutorial.vue: the main button on that box starts a new run. */
  function restart(): boolean {
    if (!askAgain.value) return false;
    askAgain.value = false;
    done.value = [];
    try { localStorage.setItem(DONE_KEY, '[]'); localStorage.setItem(RUN_KEY, new Date().toISOString()); } catch { /* private mode */ }
    start(0);
    return true;
  }

  /**
   * Every exercise solved: a special Achievement, when the sandbox has one
   * (the Merger Sandbox, Ames 2026-10-10). An admin makes it in the Admin
   * Hub with the code name; until then this does nothing. It is checked again
   * on every sign in, and the server checks the player's own record before
   * it lets the award through (functions/index.js).
   */
  function awardIfAllSolved() {
    if (!cfg.awardSlug || !CELLS.every(c => done.value.includes(c.id))) return;
    const reason = W.awardReason?.(CELLS.length) ?? `Solved all ${CELLS.length} in the ${W.name}`;
    void awardSpecialOnce({ slug: cfg.awardSlug, reason, earnedBy: reason.charAt(0).toLowerCase() + reason.slice(1) });
  }

  /**
   * The exercises this player has solved, from their account
   * (tutorial_completions), so the count follows them to another computer.
   * Added to what this browser remembers; looked up once the player is
   * known, and again on each start.
   */
  async function loadDoneFromAccount() {
    try {
      const uid = useProofreadingBackendStore().userId;
      if (!uid) return;
      let q = supabase.from('tutorial_completions')
        .select('item').eq('user_id', uid).eq('tutorial', tutorial).gt('practice_made', 0);
      const from = runFrom();
      if (from) q = q.gt('completed_at', from);
      const { data, error } = await q.limit(500);
      if (error || !data) return;
      for (const row of data as Array<{ item: string | null }>) if (row.item && CELLS.some(c => c.id === row.item)) markDone(row.item);
      // Asked from the account's record, so it also reaches players who
      // solved the last one before the Achievement existed.
      awardIfAllSolved();
    } catch { /* the browser's own record still counts */ }
  }
  setTimeout(loadDoneFromAccount, 6000);

  /** Open one example from the menu, or from another example's last box. */
  function start(index: number) {
    if (!CELLS[index]) return;
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
      solvedNow.value = false;
      current = index;
      store.activeTutorial = tutorial;
      // Past the end, then to the start: the step is keyed by its index, so
      // going from box 1 of one example to box 1 of another would not reload.
      store.setTutorialStep(steps.length);
      setTimeout(() => store.setTutorialStep(0), 60);
    });
  }
  document.addEventListener(`nge:${cfg.ev}-start`, ((e: CustomEvent) => {
    const i = Number(e.detail?.index);
    if (Number.isInteger(i)) start(i);
  }) as EventListener);

  /** For Tutorial.vue: on the last box the main button moves on to the next
   *  exercise while any are left. True when it did. */
  function continueOn(): boolean {
    if (checking.value) return true;
    // Not solved: the same one again.
    if (!solvedNow.value) { start(current); return true; }
    const i = nextUndone();
    if (i < 0 || doneCount() >= TOTAL) {
      // "Finish": the box closes and the Achievement is given, once the
      // last one is on the account.
      void recorded.then(() => awardIfAllSolved());
      return false;
    }
    start(i);
    return true;
  }

  /** How many this browser has solved, and which comes next. */
  const TOTAL = CELLS.length;
  const doneCount = () => CELLS.filter(c => done.value.includes(c.id)).length;
  function nextUndone(after = current): number {
    for (let k = 1; k <= TOTAL; k++) {
      const i = (after + k) % TOTAL;
      if (!done.value.includes(CELLS[i].id)) return i;
    }
    return -1;
  }
  // From the menu, or a tutorial's last box: the first one not solved yet.
  document.addEventListener(`nge:${cfg.ev}-next`, () => {
    const i = nextUndone(-1);
    // All solved already: ask before handing out a cell again.
    askAgain.value = i < 0;
    start(i < 0 ? 0 : i);
  });

  /**
   * Slim box (Ames, 2026-10-12): the working box folded down to one bar.
   * The fold button sits at the end of the dots on the working box only; the
   * choice is kept in this browser. It is a class on the body, because the
   * box itself is redrawn by the app.
   */
  const SLIM_KEY = `${cfg.key}-slim`;
  function applySlim(on: boolean) {
    document.body.classList.toggle('nge-sbx-slim', on);
    document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
  }
  const inThis = () => useTutorialStore().activeTutorial === tutorial;
  // The class is shared by every sandbox: set it from this one's choice
  // whenever this one is the tutorial on screen.
  try { if (localStorage.getItem(SLIM_KEY) === '1' && cfg.ev === 'sandbox') applySlim(true); } catch { /* private mode */ }
  document.addEventListener(`nge:${cfg.ev}-slim`, () => {
    const on = !document.body.classList.contains('nge-sbx-slim');
    applySlim(on);
    try { localStorage.setItem(SLIM_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  });
  function syncSlim() {
    try { applySlim(localStorage.getItem(SLIM_KEY) === '1'); } catch { /* private mode */ }
  }

  /** Whether there is another unsolved one to skip to. */
  const canSkip = () => { const other = nextUndone(); return other >= 0 && other !== current; };
  // In the working box, Skip is a button to the left of Help me (Ames,
  // 2026-10-12). Only when there is another one to go to.
  document.addEventListener('nge:practice-helprow', ((e: CustomEvent) => {
    const { row, help } = e.detail || {};
    if (!row || !inThis() || !canSkip() || row.querySelector('.nge-sbx-skipbtn')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nge-hud-btn nge-hud-btn--sm nge-sbx-skipbtn';
    b.textContent = 'Skip';
    b.title = W.skipTip;
    b.addEventListener('click', () => document.dispatchEvent(new CustomEvent(`nge:${cfg.ev}-skip`)));
    row.insertBefore(b, help ?? null);
  }) as EventListener);
  const SKIP = `<button type="button" class="nge-sbx-skip" onclick="document.dispatchEvent(new CustomEvent('nge:${cfg.ev}-skip'))">Skip this one</button>`;
  const FOLD = `<button type="button" class="nge-sbx-fold" title="Smaller or larger box" aria-label="Make this box smaller or larger" onclick="document.dispatchEvent(new CustomEvent('nge:${cfg.ev}-slim'))"></button>`;

  function progressBar(fold = false): string {
    const solved = CELLS.map(c => done.value.includes(c.id));
    let chain = '';
    solved.forEach((d, i) => {
      const state = d ? 'done' : i === current ? 'now' : 'todo';
      chain += `<span class="nge-sbx-node nge-sbx-node--${state}" title="${W.one.charAt(0).toUpperCase() + W.one.slice(1)} ${i + 1}${d ? ', solved' : state === 'now' ? ', this one' : ''}"></span>`;
      // The line between two solved ones lights up.
      if (i < TOTAL - 1) chain += `<span class="nge-sbx-link${d && solved[i + 1] ? ' nge-sbx-link--lit' : ''}"></span>`;
    });
    const n = doneCount();
    return `<div class="nge-sbx-progress${n >= TOTAL ? ' nge-sbx-progress--all' : ''}" role="img" aria-label="${n} of ${TOTAL} solved"><span class="nge-sbx-track">${chain}</span><span class="nge-sbx-count"><b>${n}</b><i>/ ${TOTAL}</i><em>solved</em></span>${fold ? FOLD : ''}</div>`;
  }

  /** The done box asks the cell itself whether it is solved; until that
   *  answer is in, it says so instead of guessing. */
  const checking = ref(false);
  /** The last result being written to the account. */
  let recorded: Promise<unknown> = Promise.resolve();
  /** Whether this attempt solved it. Not "was it ever solved": on a second
   *  go at a solved one, a miss used to read as a success. */
  const solvedNow = ref(false);

  /** Which attempt to take a cell is the current one. */
  let taking = 0;
  let skipping = false;
  // Skip is its own small button, in the full box and on the "not yet" box.
  // The main button is Next (Ames, 2026-10-12): it checks the work.
  document.addEventListener(`nge:${cfg.ev}-skip`, () => {
    const store = useTutorialStore();
    if (store.activeTutorial !== tutorial) return;
    // From the "not yet" box: straight on to another one.
    if (store.getTutorialStep() === 1) { const other = nextUndone(); if (other >= 0 && other !== current) start(other); return; }
    skip();
  });
  function skip(): boolean {
    if (askAgain.value) return false;
    if (skipping) return true;
    skipping = true;
    const store = useTutorialStore();
    const id = cell().id, at = current;
    void isSolved(id).catch(() => null).then((solved) => {
      skipping = false;
      if (store.activeTutorial !== tutorial || current !== at || store.getTutorialStep() !== 0) return;
      const other = nextUndone();
      if (solved) { store.setTutorialStep(1); return; }
      // Nothing else to go to: stay put and say so (Ames, 2026-10-12).
      if (other < 0 || other === at) { practiceStatus(`This is the only ${W.one} you have left, so there is nothing to skip to.`); return; }
      start(other);
    });
    return true;
  }

  const steps: Step[] = [
    // 1: The exercise
    {
      get title() { return askAgain.value ? W.allSolvedTitle(TOTAL) : W.title(TOTAL); },
      get nextLabel() { return askAgain.value ? 'Start again' : undefined; },
      get text() {
        if (askAgain.value) {
          return `
${progressBar()}

You have solved every one. Want to go again from the start?${cfg.awardSlug ? ' Your Achievement stays yours.' : ''}`;
        }
        return `
${progressBar(true)}

${W.intro(cell())}`;
      },
      position: OVER_3D,
      width: "440px",
      reveals: cfg.reveals,
      onEnter: async () => {
        closeSidePanel();
        stopWatching();
        syncSlim();
        // Asking whether to go again: no cell is taken until they say yes.
        if (askAgain.value) return;
        // One is assigned at a time, and players work in parallel (Ames,
        // 2026-10-08): if this one is taken, another this player has NOT
        // solved is given instead. Never a solved one while unsolved ones
        // remain (AzureJay, 2026-10-12: a reset left a player going round
        // in a loop). With none free, the box says so and keeps trying.
        const solved = (i: number) => done.value.includes(CELLS[i].id);
        const everyone = [current, ...CELLS.map((_, i) => i).filter(i => i !== current)];
        const unsolved = everyone.filter(i => !solved(i));
        const order = unsolved.length ? unsolved : everyone;
        const mine = ++taking;
        const store = useTutorialStore();
        const take = async () => {
          for (const i of order) {
            const cellRow = await beginPractice(cfg.kind, 'start', { only: CELLS[i].id });
            if (cellRow) { current = i; return cellRow; }
          }
          return null;
        };
        let got = await movingToSandbox(W.name, take);
        for (let tries = 0; !got && tries < 40; tries++) {
          practiceStatus(order.length === 1
            ? `This ${W.one} is being put back to its starting state. It will open by itself in a moment.`
            : `The ones you have left are in use or being put back to their starting state. One will open by itself in a moment.`);
          await new Promise(r => setTimeout(r, 15000));
          // The player closed the box or moved on meanwhile.
          if (mine !== taking || store.activeTutorial !== tutorial || store.getTutorialStep() !== 0) return;
          got = await take();
        }
        if (!got) {
          practiceStatus(`No ${W.one} came free. Try again in a few minutes.`);
          return;
        }
        if (mine !== taking) return;
        // Watch only once the cell is held: with nothing held, the watch
        // would queue for a tutorial's cells.
        watchPractice(cfg.kind !== 'cut', W.hint, '', { advance: true });
        // The cell loads in 3D (practice.ts sets the layout in the view
        // itself); Space brings the 2D images back.
        setTimeout(() => ensureTool(cfg.tool), 1100);
      },
    } as Step,

    // 2: Done
    {
      get title() {
        if (checking.value) return `Checking ${W.one} ${current + 1}`;
        if (!solvedNow.value) return W.notDoneTitle(current + 1);
        return doneCount() >= TOTAL ? W.allDoneTitle(TOTAL) : W.doneTitle(current + 1);
      },
      get text() {
        const n = doneCount(), left = TOTAL - n;
        if (checking.value) return W.checking;
        if (!solvedNow.value) {
          return `
<img class="nge-sbx-nurro" src="${imgWheresNurro}" alt="">

${W.notDone} ${canSkip() ? SKIP : ''}`;
        }
        if (left <= 0) return W.allDone(TOTAL);
        return `
<img class="nge-sbx-nurro" src="${imgBravoNurro}" alt="">

<span class="nge-done-lead">Congratulations, that is ${n} of ${TOTAL}. ${left} ${left === 1 ? 'remains' : 'remain'}!</span>

${progressBar()}

` + BLACK_BOX_NOTE;
      },
      // One way forward (Ames: "Next" and "Done" side by side left it
      // unclear which to press). The x leaves.
      get nextLabel() {
        if (checking.value) return 'one moment';
        if (!solvedNow.value) return 'Try again';
        return nextUndone() >= 0 && doneCount() < TOTAL ? W.nextLabel : 'Finish';
      },
      position: OVER_3D,
      width: "440px",
      // Confetti is thrown once, by celebrateStep, when the work is
      // confirmed: the button itself throws none.
      noConfetti: true,
      onEnter: async () => {
        // Solved means the edit was made, not that Next was pressed. Asked
        // of the cell itself too, so an edit the watch missed still counts.
        const id = cell().id;
        checking.value = true;
        let earned = false;
        try { if (await isSolved(id)) creditPractice(id); earned = practiceEarned(); } finally { solvedNow.value = earned; checking.value = false; }
        if (earned) {
          markDone(id); celebrateStep();
          // Recorded on the account: the server looks there before it lets
          // the Achievement through, which waits for Finish on the last box.
          recorded = Promise.resolve(recordTutorialDone(tutorial, id)).catch(() => {});
        }
        stopWatching();
        endPractice();
      },
    } as Step,
  ];

  return { steps, done, start, restart, continueOn, TOTAL };
}
