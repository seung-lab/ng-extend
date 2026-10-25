-- Two new practice cells (Ames, 2026-10-24). Run AFTER the app deploy that
-- lists them (src/practice_pools.ts): before it, the live app does not know
-- they are sandbox cells and the Merge and Cut tutorials could hand them out.
--
-- 1. Extension Sandbox, Cell 1: a cell with two branches left behind.
--    Starts apart; done when both pieces are merged on (CHECK_GROUPS in
--    src/practice.ts). No edits on any of the three segments, so it is ready.
-- 2. Merger Sandbox, Merger 8: a piece fused to a cell. Ames cut it at
--    15:39:26 UTC (operation 2499), so it starts as needs_reset and the reset
--    job undoes that cut, back to the fused state at the baseline.
INSERT INTO public.tutorial_practice_examples
  (id, title, kind, dataset, pcg_server, pcg_table, state_url,
   supervoxel_a, supervoxel_b, root_a, root_b, baseline_at, status, enabled)
VALUES
  ('63a057ed-ce08-4a6f-915d-eca29214e48c', 'Extension Sandbox, cell 1 (Ames, 2026-10-24)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5697630592040960',
   '73535750519863797', '74873580823075327', '648518346353836607', '648518346351941295',
   '2026-10-24T00:00:00+00:00', 'ready', true),
  ('2f8c4066-202e-44f7-88b1-5dbd0335adde', 'Merger sandbox 8 (Ames, 2026-10-24)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6209159015956480',
   '73817775453600544', '73817706734177384', '648518346353830447', '648518346353830447',
   '2026-10-24T15:39:00+00:00', 'needs_reset', true);
