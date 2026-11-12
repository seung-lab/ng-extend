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
export interface SandboxCell { id: string; title: string; hintState: string; /** Extension Sandbox: how many pieces are missing. */ pieces?: number; /** A line added to its first box. */ note?: string;
  /** Where the cell is (viewer voxels), for a cell registered without its
   *  A and B points: the hint points are checked against these. */
  spots?: number[][]; }

export const SANDBOX_CELLS: SandboxCell[] = [
  { id: 'da3819dc-84b0-43df-a77c-55e46049a124', title: 'Merger 1', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5758135507615744' },
  { id: '0816c738-189d-4a7c-8fd7-1a6f2ae02c3e', title: 'Merger 2', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5438278790545408' },
  { id: '66069c79-0014-438a-a52a-484d6ece8ecb', title: 'Merger 3', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6015779153641472' },
  // Celia's Admin Hub cells, added 2026-10-10. The hint views were saved
  // after the cut, with the points as Keep and Remove annotation layers.
  { id: 'c04eed2c-4204-4b3d-a25d-2f7aa880c1aa', title: 'Merger 4', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4904321879638016' },
  { id: '0482d846-0c16-4393-ab8a-0d1212b9520f', title: 'Merger 5', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5905993078669312' },
  { id: '814be870-9149-4474-876f-195e0af0bd08', title: 'Merger 6', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5747243973869568' },
  // Ames, 2026-10-24: the cell at (61906, 44918, 1492), the piece fused to it
  // at (61795, 44659, 1506). Her own cut, operation 2499, is the reference.
  { id: '2f8c4066-202e-44f7-88b1-5dbd0335adde', title: 'Merger 7', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6209159015956480',
    spots: [[61906, 44918, 1492], [61795, 44659, 1506]] },
  // Ames, 2026-10-24, harder: two branches crossing in an X with no clear
  // border (Andrearwen's example). Spots either side at (61010, 43273, 1557)
  // and (60986, 43313, 1566). A player cut it on 2026-10-13 (operation 2018,
  // which parts the two spots); Ames merged it again (operation 2502), and
  // the baseline is just after.
  { id: 'b5656b45-bd19-4b39-ac9d-65902b1a1b94', title: 'Merger 8', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4924675628990464',
    spots: [[61010, 43273, 1557], [60986, 43313, 1566]] },
  // Ames, 2026-11-12: five mergers made in 2022 and cut apart on 2026-11-11
  // (the reference cuts). Each starts fused again at a baseline just before
  // its cut. The hints are that cut's own red and blue points (CUT_HINTS in
  // tutorial-3.ts); spots are the checked supervoxels, good cell then merger.
  { id: '2152de4d-25c9-4c61-b0e3-33b69c38ba08', title: 'Merger 9', hintState: '',
    spots: [[115096, 57560, 1344], [115162, 57470, 1361]] },
  { id: 'ecfb5c70-5791-4c4f-a806-113b60d5c352', title: 'Merger 10', hintState: '',
    spots: [[81854, 51294, 396], [81904, 51638, 387]] },
  { id: 'cf702af3-b811-4020-b51f-96a0ce08f1ee', title: 'Merger 11', hintState: '',
    spots: [[81772, 47716, 446], [82088, 47746, 444]] },
  { id: '818b1d1b-a243-4711-a2a6-444a84dca010', title: 'Merger 12', hintState: '',
    spots: [[65766, 44394, 170], [65818, 44534, 168]] },
  { id: '0e9ca4e1-e3c1-44db-8d95-61f6cd6df4c0', title: 'Merger 13', hintState: '',
    spots: [[104094, 73648, 1991], [104062, 73636, 1991]] },
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
const RETIRED_SANDBOX_IDS = [
  '844165a8-5b97-40b0-afba-42125d343dcf',
  // f11ad22b (Celia's "Merger sandbox 5"), retired 2026-10-28: two joins (a
  // thin axon and the join the check spots measure), and one check spot on
  // the join line itself, so a correct cut counted or not by chance
  // (Andrearwen: one of seven cuts at the join accepted). Hint view
  // nglstate 5666160561356800, start view 5699422331600896.
  'f11ad22b-8043-4223-9b7e-264eb5d6d0a3',
];

/**
 * The Extension Sandbox (extension-sandbox.ts): cells that stop too soon,
 * each done when every missing piece is merged back on (CHECK_GROUPS in
 * practice.ts holds the pieces).
 */
export const EXTENSION_CELLS: SandboxCell[] = [
  // Ames, 2026-10-24, easy, first (one merge): an axon to extend by one piece. The axon at
  // (82238, 60100, 708), the piece at (82269, 59986, 690). A player merged it
  // on 2026-10-13; Ames cut it apart again (operation 2501), and the
  // baseline is just after that cut.
  { id: '141062c3-e988-452f-84ed-fecc92652b87', title: 'Cell 1', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4744042558521344', pieces: 1 },
  // Ames, 2026-10-24: a cell with two branches left behind, at
  // (77321, 49937, 213) and (87334, 52032, 994); the cell at (58256, 36905, 1161).
  { id: '63a057ed-ce08-4a6f-915d-eca29214e48c', title: 'Cell 2', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5697630592040960', pieces: 2 },
  // Ames, 2026-11-12: six cells each missing one branch. Click spots are
  // MERGE_HINT_POINTS in tutorial-3.ts (and point_a / point_b on the rows).
  { id: 'e00d8987-7a7d-47cc-b100-392d9f88e85c', title: 'Cell 3', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6369809629446144', pieces: 1 },
  { id: '72a8858a-756b-4a62-8b81-5857359960ef', title: 'Cell 4', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5515217693835264', pieces: 1 },
  { id: 'aca4c7fa-33d4-48ac-8b6d-f6a20dbdab3e', title: 'Cell 5', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5813860661460992', pieces: 1 },
  { id: '5f88242a-ca3f-450d-9208-61c6a0ed713d', title: 'Cell 6', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6027189204025344', pieces: 1 },
  { id: '0e67d1ab-0f11-40c9-8898-bc89e38f3560', title: 'Cell 7', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4676782632468480', pieces: 1 },
  { id: 'c8bf3478-c45b-49e4-9fb1-3dd6f02f1fc3', title: 'Cell 8', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5024496754884608', pieces: 1 },
  // Ames, 2026-10-24, medium, kept last: extending through a black spill. The cell at
  // (62612, 39202, 558); pieces at (62448, 39130, 537) and (61025, 38968, 394).
  // Two more small ones further on, (59871, 38215, 136) and (59810, 38060,
  // 129), are a bonus and not checked.
  { id: 'f3dfed18-9592-46ed-8ca7-90310aea0d60', title: 'Cell 9', hintState: 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6290470967705600', pieces: 2,
    note: 'There are a few more small pieces at the very end of this branch. Add them if you like, but they are not needed to finish. The blue box is where this dataset\'s cells end: past it, the 2D images go on, but there is nothing to add.' },
];

/** Every sandbox cell, kept out of the Merge and Cut tutorials' pools. */
export const SANDBOX_IDS: string[] = [...SANDBOX_CELLS.map(c => c.id), ...RETIRED_SANDBOX_IDS, ...EXTENSION_CELLS.map(c => c.id)];
