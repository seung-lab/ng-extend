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
  // Celia's Admin Hub cells, added 2026-10-10. The hint views were saved
  // after the cut, with the points as Keep and Remove annotation layers.
  { id: 'c04eed2c-4204-4b3d-a25d-2f7aa880c1aa', title: 'Merger 6', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4904321879638016' },
  { id: '0482d846-0c16-4393-ab8a-0d1212b9520f', title: 'Merger 7', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5905993078669312' },
  { id: '814be870-9149-4474-876f-195e0af0bd08', title: 'Merger 8', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5747243973869568' },
];

/** How many mergers the sandbox holds. Every "all N mergers" a player reads
 *  comes from this, so adding a cell above is the whole change. */
export const SANDBOX_TOTAL = SANDBOX_CELLS.length;

export const SANDBOX_IDS: string[] = SANDBOX_CELLS.map(c => c.id);
