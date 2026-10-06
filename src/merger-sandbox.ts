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
import { beginPractice, endPractice, ensureTool } from './practice';
import { SANDBOX_CELLS } from './practice_pools';
import { show2D, showSections } from './tutorial-cut';
import { BLACK_BOX_NOTE, OVER_3D, celebrateStep, closeSidePanel, finishPracticeTutorial, movingToSandbox, practiceStatus, resetPracticeLog, stopWatching, watchPractice } from './tutorial-3';

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

/** Open one example from the menu, or from another example's last box. */
export function startSandbox(index: number) {
  if (!SANDBOX_CELLS[index]) return;
  const store = useTutorialStore();
  stopWatching();
  // Hand back whatever is held (another example, or a tutorial's cells).
  endPractice().finally(() => {
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

function nextButtons(): string {
  const style = 'margin:4px 6px 0 0;padding:6px 12px;border-radius:3px;font:inherit;font-size:0.85em;font-weight:600;cursor:pointer;'
    + 'background:rgba(126,224,255,0.10);border:1px solid rgba(126,224,255,0.45);color:#d8ecff';
  return SANDBOX_CELLS.map((c, i) => i === current ? '' :
    `<button onclick="document.dispatchEvent(new CustomEvent('nge:sandbox-start',{detail:{index:${i}}}))" style="${style}">`
    + `${sandboxDone.value.includes(c.id) ? '✓ ' : ''}${c.title}</button>`).join('');
}

export const steps: Step[] = [
  // 1: The exercise
  {
    get title() { return `Merger Sandbox: ${cell().title}`; },
    text: `
Two neurons were fused into one segment here. Find where they touch and cut them apart.

1. Press **C** if the cut tool is off.
2. **Ctrl+Click** a few <strong style="color:#ff5c5c">red</strong> points on one neuron, near the join.
3. Press **G**, then **Ctrl+Click** a few <strong style="color:#5c8cff">blue</strong> points on the other.
4. Press **Submit cut**, or **Enter**.

This cell is yours until you finish, and goes back to its merged state afterwards. Stuck? The **?** button shows where the points go.`,
    position: OVER_3D,
    width: "440px",
    onEnter: async () => {
      closeSidePanel();
      const mine = cell();
      stopWatching();
      const got = await movingToSandbox('Merger Sandbox', () => beginPractice('cut', 'start', { only: mine.id }));
      if (!got) {
        practiceStatus(`Someone else is working on ${mine.title} right now, or it is being reset. Pick another example from the menu, or try this one again in a few minutes.`);
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
    title: "Separated!",
    get text() {
      return `
<span class="nge-done-lead">The two neurons are separate segments again. Nice work.</span>

` + BLACK_BOX_NOTE + `

The cell is going back to its merged state for the next person. Try another:

` + nextButtons();
    },
    position: OVER_3D,
    width: "440px",
    image: imgBravoNurro,
    onEnter: () => {
      // Done means the cut was made, not that Next was pressed.
      if (finishPracticeTutorial('cut')) { markDone(cell().id); celebrateStep(); } else stopWatching();
      endPractice();
    },
  } as Step,
];
