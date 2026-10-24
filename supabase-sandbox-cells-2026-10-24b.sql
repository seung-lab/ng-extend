-- Extension Sandbox, cell 2 (Ames, 2026-10-24): extending through a black
-- spill. Run AFTER the app deploy that lists it (src/practice_pools.ts).
-- Starts apart, done when both pieces are merged on (CHECK_GROUPS in
-- src/practice.ts). No edits on any of its segments, so it is ready.
INSERT INTO public.tutorial_practice_examples
  (id, title, kind, dataset, pcg_server, pcg_table, state_url,
   supervoxel_a, supervoxel_b, root_a, root_b, baseline_at, status, enabled)
VALUES
  ('f3dfed18-9592-46ed-8ca7-90310aea0d60', 'Extension Sandbox, cell 2 (Ames, 2026-10-24)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6290470967705600',
   '73817362666812872', '73817362666662242', '648518346353693815', '648518346352189375',
   '2026-10-24T00:00:00+00:00', 'ready', true);
