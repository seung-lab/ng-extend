-- Extension Sandbox, the easy axon (Ames, 2026-10-24). Run AFTER the app
-- deploy that lists it. Starts apart (Ames cut it at 15:59:23 UTC, operation
-- 2501, and the baseline is just after), done when the piece is merged on.
INSERT INTO public.tutorial_practice_examples
  (id, title, kind, dataset, pcg_server, pcg_table, state_url,
   supervoxel_a, supervoxel_b, root_a, root_b, baseline_at, status, enabled)
VALUES
  ('141062c3-e988-452f-84ed-fecc92652b87', 'Extension Sandbox, easy axon (Ames, 2026-10-24)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4744042558521344',
   '75155743262966707', '75155743262905793', '648518346353339873', '648518346356596015',
   '2026-10-24T16:00:00+00:00', 'ready', true);
