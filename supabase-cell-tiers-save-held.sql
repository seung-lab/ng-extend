-- ============================================================================
-- Cell Completion Achievements: save what every player holds today
-- ----------------------------------------------------------------------------
-- Ames 2026-10-11. The cell tiers are moving to round numbers (1, 5, 10, 15,
-- 20, 30 ... see src/widgets/badge_definitions.ts), and several tiers get a
-- higher number than they have now. Nobody may lose an Achievement, so this
-- saves, for every player, every Cell Completion Achievement their count
-- reaches under the numbers that were live until now. The game shows a saved
-- Achievement as earned whatever its number becomes later.
--
-- RUN THIS BEFORE the new numbers go live. Safe to run again: it only adds
-- rows that are missing. The numbers below are the old ones, on purpose.
-- ============================================================================
insert into badge_awards (user_id, track, badge_id)
select c.id, 'exploration', t.badge_id
from (
  select u.id, greatest(coalesce(u.cells_completed, 0), coalesce(v.cells_completed, 0)) as cells
  from users u left join user_edit_counts v on v.id = u.id
) c
join (values
  (101, 1), (102, 2), (103, 3), (104, 4), (105, 5), (106, 10),
  (107, 15), (108, 25), (109, 35), (110, 50), (111, 75), (112, 100),
  (113, 125), (114, 150), (115, 175), (116, 200), (117, 250), (118, 300),
  (119, 350), (120, 400), (121, 463), (122, 532), (123, 608), (124, 691),
  (125, 781), (126, 879), (127, 984), (128, 1098), (129, 1219), (130, 1350),
  (131, 1490), (132, 1638), (133, 1797), (134, 1965), (135, 2144), (136, 2333),
  (137, 2533), (138, 2744), (139, 2966), (140, 3200), (141, 3446), (142, 3704),
  (143, 3975), (144, 4259), (145, 4556), (146, 4867), (147, 5191), (148, 5530),
  (149, 5882), (150, 6250), (151, 6633), (152, 7030), (153, 7444), (154, 7873),
  (155, 8319), (156, 8781), (157, 9260), (158, 9756), (159, 10269), (160, 10800),
  (161, 11349), (162, 11916), (163, 12502), (164, 13107), (165, 13731), (166, 14375),
  (167, 15038), (168, 15722), (169, 16425), (170, 17150), (171, 17896), (172, 18662),
  (173, 19451), (174, 20261), (175, 21094), (176, 21949), (177, 22827), (178, 23728),
  (179, 24652), (180, 25600), (181, 26572), (182, 27568), (183, 28589), (184, 29635),
  (185, 30706), (186, 31803), (187, 32925), (188, 34074), (189, 35248), (190, 36450),
  (191, 37679), (192, 38934), (193, 40218), (194, 41529), (195, 42869), (196, 44237),
  (197, 45634), (198, 47060), (199, 48515), (200, 50000)
) as t(badge_id, threshold) on c.cells >= t.threshold
on conflict (user_id, track, badge_id) do nothing;

-- What is saved now, per player (to check by eye).
select coalesce(v.display_name, a.user_id::text) as player, max(v.cells_completed) as cells, count(*) as saved_cell_achievements
from badge_awards a left join user_edit_counts v on v.id = a.user_id
where a.track = 'exploration'
group by 1 order by 2 desc nulls last;
