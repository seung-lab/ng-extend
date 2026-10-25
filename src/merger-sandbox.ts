/**
 * merger-sandbox.ts: Tutorial 9, the Merger Sandbox (Ames, 2026-10-06).
 *
 * A set of standalone cut exercises from Celia's list, opened one at a time
 * from the burger menu. Each starts on its merged view (two neurons fused
 * into one segment) and is done when its two registered points sit on
 * different segments, which is what a `cut` practice cell already checks.
 * The cells are listed in practice_pools.ts; each is its own pool of one, so
 * a learner here does not hold the Cut tutorial and never gets its cells.
 * The game itself is in sandbox.ts, shared with the Extension Sandbox.
 */
import imgSandboxComplete from './images/sandbox-complete.jpg';
import { SANDBOX_CELLS } from './practice_pools';
import { makeSandbox } from './sandbox';

export const SANDBOX_TUTORIAL = 9;

/**
 * Every merger in the sandbox cut: a special Achievement (Ames 2026-10-10),
 * made by an admin in the Admin Hub under this code name.
 */
export const SANDBOX_AWARD_SLUG = 'merger-sandbox';

const sandbox = makeSandbox({
  tutorial: SANDBOX_TUTORIAL,
  kind: 'cut',
  cells: SANDBOX_CELLS,
  ev: 'sandbox',
  key: 'nge-merger-sandbox',
  tool: 'multicut',
  // The tools a merger is found and cut with (util/toolbar_staging.ts).
  reveals: ['split', 'findPath', 'highlight'],
  awardSlug: SANDBOX_AWARD_SLUG,
  words: {
    name: 'Merger Sandbox',
    one: 'merger',
    title: (total) => `Can you solve all ${total} merger mysteries?`,
    allSolvedTitle: (total) => `All ${total} merger mysteries solved`,
    intro: () => 'Two neurons are fused into one segment here. Find where they touch and cut them apart.',
    hint: 'Ctrl+click to add points. Remember to press G to switch the cut color group.',
    checking: 'Checking your cut.',
    notDoneTitle: (n) => `Merger ${n} is still fused`,
    notDone: 'The two neurons are still one segment, so this one is not cut yet. Press **Try again** to have another go. **Help me** there shows where the points go.',
    doneTitle: (n) => `Merger ${n} cut!`,
    allDoneTitle: (total) => `All ${total} mergers cut!`,
    allDone: (total) => `
<span class="nge-sbx-figure" tabindex="0"><img src="${imgSandboxComplete}" alt="Pyramidal neurons from the hippocampus"><span class="nge-sbx-figcap">Pyramidal neurons from the hippocampus, with mossy fiber axons (yellow), traced by citizen scientists. Up close: a synapse.</span></span>

<span class="nge-done-lead">Congratulations, you found and cut all ${total} mergers. That is real proofreading.</span>

To go again, open the Merger Sandbox from the burger menu.`,
    nextLabel: 'Next merger',
    notYet: 'Not cut yet: the two neurons are still one segment. Keep going, or press Help me to see where the points go.',
    skipTip: 'Leave this merger for later and go to another',
    awardReason: (total) => `Cut all ${total} mergers in the Merger Sandbox`,
  },
});

export const steps = sandbox.steps;
export const sandboxDone = sandbox.done;
export const startSandbox = sandbox.start;
export const sandboxRestart = sandbox.restart;
export const sandboxContinue = sandbox.continueOn;
export const sandboxNext = sandbox.next;
