/**
 * extension-sandbox.ts: Tutorial 13, the Extension Sandbox (Ames,
 * 2026-10-24). The other half of the Merger Sandbox: each cell stops too
 * soon, with the rest of it left behind as separate pieces, and is done when
 * every piece is merged back on. A cell can be missing more than one piece
 * (CHECK_GROUPS in practice.ts lists them all). Same game as the Merger
 * Sandbox (sandbox.ts): one cell at a time, players in parallel, dots, Skip,
 * the slim bar.
 */
import imgSandboxComplete from './images/sandbox-complete.jpg';
import { EXTENSION_CELLS } from './practice_pools';
import { makeSandbox } from './sandbox';

export const EXTENSION_TUTORIAL = 13;

const pieces = (n: number) => n === 1 ? 'one piece' : `${n} pieces`;

const sandbox = makeSandbox({
  tutorial: EXTENSION_TUTORIAL,
  kind: 'merge_then_cut',
  cells: EXTENSION_CELLS,
  ev: 'extsandbox',
  key: 'nge-extension-sandbox',
  tool: 'merge',
  reveals: ['merge', 'findPath', 'highlight'],
  words: {
    name: 'Extension Sandbox',
    one: 'cell',
    title: (total) => total === 1 ? 'Can you finish this cell?' : `Can you finish all ${total} cells?`,
    allSolvedTitle: (total) => total === 1 ? 'Cell finished' : `All ${total} cells finished`,
    intro: (cell) => `This cell stops too soon. The rest of it was left behind as ${pieces(cell.pieces ?? 1)}. Find where it ends early and merge ${(cell.pieces ?? 1) === 1 ? 'the missing piece' : 'each missing piece'} back on.`,
    hint: 'Press M, Ctrl+click the cell, Ctrl+click the missing piece, then Submit merge.',
    checking: 'Checking your merges.',
    notDoneTitle: (n) => `Cell ${n} is still missing a piece`,
    notDone: 'Not every piece is back on yet. Press **Try again** to have another go. **Help me** there shows where to click.',
    doneTitle: (n) => `Cell ${n} finished!`,
    allDoneTitle: (total) => total === 1 ? 'Cell finished!' : `All ${total} cells finished!`,
    allDone: (total) => `
<span class="nge-sbx-figure" tabindex="0"><img src="${imgSandboxComplete}" alt="Pyramidal neurons from the hippocampus"><span class="nge-sbx-figcap">Pyramidal neurons from the hippocampus, with mossy fiber axons (yellow), traced by citizen scientists. Up close: a synapse.</span></span>

<span class="nge-done-lead">Congratulations, you found every missing piece${total === 1 ? '' : ` on all ${total} cells`}. That is real proofreading.</span>

To go again, open the Extension Sandbox from the burger menu.`,
    nextLabel: 'Next cell',
    skipTip: 'Leave this cell for later and go to another',
  },
});

export const extensionSteps = sandbox.steps;
export const extensionDone = sandbox.done;
export const extensionRestart = sandbox.restart;
export const extensionContinue = sandbox.continueOn;
