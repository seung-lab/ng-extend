-- Five Merger Sandbox cells (Mergers 9 to 13) and six Extension Sandbox cells
-- (Ames, 2026-11-12). Run AFTER the app deploy that lists them
-- (src/practice_pools.ts): before it, the live app does not know they are
-- sandbox cells and the Merge tutorial could hand them out.
--
-- Mergers: each was cut apart on 2026-11-11 (operations 5006 to 5010 and 5024
-- to 5029). They start as needs_reset, and the reset job undoes those cuts,
-- back to the fused state at each baseline. The two supervoxels are under the
-- reference cut's own red and blue points; replayed against the history, the
-- reference cut parts them and the misplaced cuts (5024, 5027) do not.
--
-- Extensions: the cell and its missing branch are apart today, as the
-- exercise starts, so they are ready with a baseline after the last edit
-- (5031, 21:22 UTC). point_a is on the cell, point_b on the branch.
-- One extension Ames sent is left out: its cell (648518346352484042) is the
-- neuron Merger 10 is made from, and two cells on one neuron reset each other.
INSERT INTO public.tutorial_practice_examples
  (id, title, kind, dataset, pcg_server, pcg_table, state_url,
   supervoxel_a, supervoxel_b, root_a, root_b, point_a, point_b,
   baseline_at, status, enabled)
VALUES
  ('2152de4d-25c9-4c61-b0e3-33b69c38ba08', 'Merger sandbox 9 (Ames, 2026-11-12)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5588245089878016',
   '77477774717430805', '77477774717475143', '648518346352484298', '648518346352484298', NULL, NULL,
   '2026-11-11T20:23:00+00:00', 'needs_reset', true),
  ('ecfb5c70-5791-4c4f-a806-113b60d5c352', 'Merger sandbox 10 (Ames, 2026-11-12)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5391648196395008',
   '75155193306116898', '75155193306011348', '648518346352484042', '648518346352484042', NULL, NULL,
   '2026-11-11T20:26:00+00:00', 'needs_reset', true),
  ('cf702af3-b811-4020-b51f-96a0ce08f1ee', 'Merger sandbox 11 (Ames, 2026-11-12)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4777155011543040',
   '75154918495018909', '75154918495014183', '648518346351955324', '648518346351955324', NULL, NULL,
   '2026-11-11T20:43:00+00:00', 'needs_reset', true),
  ('818b1d1b-a243-4711-a2a6-444a84dca010', 'Merger sandbox 12 (Ames, 2026-11-12)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4526500317495296',
   '74028812295479314', '74028812295457883', '648518346354828966', '648518346354828966', NULL, NULL,
   '2026-11-11T20:56:00+00:00', 'needs_reset', true),
  ('0e9ca4e1-e3c1-44db-8d95-61f6cd6df4c0', 'Merger sandbox 13 (Ames, 2026-11-12)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6609602070183936',
   '76704818378685837', '76704818378695643', '648518346355099322', '648518346355099322', NULL, NULL,
   '2026-11-11T21:03:00+00:00', 'needs_reset', true),
  ('e00d8987-7a7d-47cc-b100-392d9f88e85c', 'Extension Sandbox, cell 4 (Ames, 2026-11-12)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6369809629446144',
   '74945118134016562', '74945118134033577', '648518346351706736', '648518346351955836', '[78316, 66500, 870]', '[78422, 66536, 878]',
   '2026-11-11T21:30:00+00:00', 'ready', true),
  ('72a8858a-756b-4a62-8b81-5857359960ef', 'Extension Sandbox, cell 5 (Ames, 2026-11-12)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5515217693835264',
   '73185281054254175', '73185212334715875', '648518346352330555', '648518346352663457', '[53430, 57240, 900]', '[53592, 57178, 884]',
   '2026-11-11T21:30:00+00:00', 'ready', true),
  ('aca4c7fa-33d4-48ac-8b6d-f6a20dbdab3e', 'Extension Sandbox, cell 6 (Ames, 2026-11-12)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5813860661460992',
   '73467099762184441', '73467099762300937', '648518346352737559', '648518346353670586', '[57402, 62722, 1045]', '[57398, 62752, 1051]',
   '2026-11-11T21:30:00+00:00', 'ready', true),
  ('5f88242a-ca3f-450d-9208-61c6a0ed713d', 'Extension Sandbox, cell 7 (Ames, 2026-11-12)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/6027189204025344',
   '73677106214800543', '73677106214811381', '648518346352528434', '648518346354629030', '[60448, 46050, 542]', '[60504, 45994, 551]',
   '2026-11-11T21:30:00+00:00', 'ready', true),
  ('0e67d1ab-0f11-40c9-8898-bc89e38f3560', 'Extension Sandbox, cell 8 (Ames, 2026-11-12)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4676782632468480',
   '75718693216389714', '75718761935809617', '648518346351593384', '648518346357537190', '[89782, 60232, 699]', '[89856, 60296, 699]',
   '2026-11-11T21:30:00+00:00', 'ready', true),
  ('c8bf3478-c45b-49e4-9fb1-3dd6f02f1fc3', 'Extension Sandbox, cell 9 (Ames, 2026-11-12)', 'merge_then_cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5024496754884608',
   '73818599617469851', '73818599617448314', '648518346352330811', '648518346350685525', '[62432, 57598, 545]', '[62432, 57598, 539]',
   '2026-11-11T21:30:00+00:00', 'ready', true);
