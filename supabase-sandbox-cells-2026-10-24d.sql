-- Merger Sandbox, Merger 9 (Ames, 2026-10-24): a harder cut, two branches
-- crossing in an X. Run AFTER the app deploy that lists it. Starts fused
-- (Ames merged it at 17:01:55 UTC, operation 2502; the baseline is just
-- after), done when the two spots are on different segments.
INSERT INTO public.tutorial_practice_examples
  (id, title, kind, dataset, pcg_server, pcg_table, state_url,
   supervoxel_a, supervoxel_b, root_a, root_b, baseline_at, status, enabled)
VALUES
  ('b5656b45-bd19-4b39-ac9d-65902b1a1b94', 'Merger sandbox 9, X crossing (Ames, 2026-10-24)', 'cut',
   'pinky_nf_v2', 'https://minnie.microns-daf.com', 'pinky_nf_v2',
   'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/4924675628990464',
   '73747269337282876', '73747269337466483', '648518346352077426', '648518346352077426',
   '2026-10-24T17:02:00+00:00', 'ready', true);
