/**
 * practice_pools.ts: which practice cells belong to the Merger Sandbox.
 *
 * The Merge and Cut tutorials are staged tracks, one learner at a time, and
 * draw on every other cell of their kind. The sandbox examples are also
 * `cut` cells in the database (they start fused and are done when the two
 * registered points are on different segments), but each is its own
 * standalone exercise: they must not be handed out as stand-ins by the Cut
 * tutorial, and someone on one of them does not hold the Cut tutorial.
 */
export interface SandboxCell { id: string; title: string; hintState: string; }

export const SANDBOX_CELLS: SandboxCell[] = [
  { id: 'da3819dc-84b0-43df-a77c-55e46049a124', title: 'Merger 1', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5758135507615744' },
  { id: '0816c738-189d-4a7c-8fd7-1a6f2ae02c3e', title: 'Merger 2', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5438278790545408' },
  { id: '66069c79-0014-438a-a52a-484d6ece8ecb', title: 'Merger 3', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6015779153641472' },
  { id: '844165a8-5b97-40b0-afba-42125d343dcf', title: 'Merger 4', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5102292558675968' },
  { id: 'f11ad22b-8043-4223-9b7e-264eb5d6d0a3', title: 'Merger 5', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5666160561356800' },
];

export const SANDBOX_IDS: string[] = SANDBOX_CELLS.map(c => c.id);
