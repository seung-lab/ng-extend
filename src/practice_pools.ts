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
export interface SandboxCell { id: string; title: string; hintState: string; /** Extension Sandbox: how many pieces are missing. */ pieces?: number; /** A line added to its first box. */ note?: string; }

export const SANDBOX_CELLS: SandboxCell[] = [
  { id: 'da3819dc-84b0-43df-a77c-55e46049a124', title: 'Merger 1', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5758135507615744' },
  { id: '0816c738-189d-4a7c-8fd7-1a6f2ae02c3e', title: 'Merger 2', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5438278790545408' },
  { id: '66069c79-0014-438a-a52a-484d6ece8ecb', title: 'Merger 3', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6015779153641472' },
  { id: 'f11ad22b-8043-4223-9b7e-264eb5d6d0a3', title: 'Merger 4', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5666160561356800' },
  // Celia's Admin Hub cells, added 2026-10-10. The hint views were saved
  // after the cut, with the points as Keep and Remove annotation layers.
  { id: 'c04eed2c-4204-4b3d-a25d-2f7aa880c1aa', title: 'Merger 5', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4904321879638016' },
  { id: '0482d846-0c16-4393-ab8a-0d1212b9520f', title: 'Merger 6', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5905993078669312' },
  { id: '814be870-9149-4474-876f-195e0af0bd08', title: 'Merger 7', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5747243973869568' },
  // Ames, 2026-10-24: the cell at (61906, 44918, 1492), the piece fused to it
  // at (61795, 44659, 1506). Her own cut, operation 2499, is the reference.
  { id: '2f8c4066-202e-44f7-88b1-5dbd0335adde', title: 'Merger 8', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6209159015956480' },
];

/** How many mergers the sandbox holds. Every "all N mergers" a player reads
 *  comes from this, so adding a cell above is the whole change. */
export const SANDBOX_TOTAL = SANDBOX_CELLS.length;

/**
 * Taken out of the sandbox, but still sandbox cells: they stay out of the
 * Cut tutorial's pool of stand-ins.
 * - 844165a8 (Celia's "Merger sandbox 4"): too many branches fused together
 *   to be a fair exercise (Ames, 2026-10-12). Hint view
 *   nglstate 5102292558675968, should it come back.
 */
const RETIRED_SANDBOX_IDS = ['844165a8-5b97-40b0-afba-42125d343dcf'];

/**
 * The Extension Sandbox (extension-sandbox.ts): cells that stop too soon,
 * each done when every missing piece is merged back on (CHECK_GROUPS in
 * practice.ts holds the pieces).
 */
export const EXTENSION_CELLS: SandboxCell[] = [
  // Ames, 2026-10-24: a cell with two branches left behind, at
  // (77321, 49937, 213) and (87334, 52032, 994); the cell at (58256, 36905, 1161).
  { id: '63a057ed-ce08-4a6f-915d-eca29214e48c', title: 'Cell 1', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5697630592040960', pieces: 2 },
  // Ames, 2026-10-24, easy: an axon to extend by one piece. The axon at
  // (82238, 60100, 708), the piece at (82269, 59986, 690). A player merged it
  // on 2026-10-13; Ames cut it apart again (operation 2501), and the
  // baseline is just after that cut.
  { id: '141062c3-e988-452f-84ed-fecc92652b87', title: 'Cell 2', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4744042558521344', pieces: 1 },
  // Ames, 2026-10-24, medium, kept last: extending through a black spill. The cell at
  // (62612, 39202, 558); pieces at (62448, 39130, 537) and (61025, 38968, 394).
  // Two more small ones further on, (59871, 38215, 136) and (59810, 38060,
  // 129), are a bonus and not checked.
  { id: 'f3dfed18-9592-46ed-8ca7-90310aea0d60', title: 'Cell 3', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6290470967705600', pieces: 2,
    note: 'There are a few more small pieces at the very end of this branch. Add them if you like, but they are not needed to finish.' },
];

/** Every sandbox cell, kept out of the Merge and Cut tutorials' pools. */
export const SANDBOX_IDS: string[] = [...SANDBOX_CELLS.map(c => c.id), ...RETIRED_SANDBOX_IDS, ...EXTENSION_CELLS.map(c => c.id)];
