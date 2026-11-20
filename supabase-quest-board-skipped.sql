-- ============================================================================
-- Cilia Quests: a cell marked "Skipped (low quality)" counts as a quest on the
-- leaderboard and the profile, as it already did in the Cell Library
-- (Krzysztof, report 598: 148 on the board, 151 in the Cell Library; Ames
-- 2026-11-20: "skipped low quality can still count").
-- The live function, with only the status rule changed. Safe to re-run.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ew_quest_board(p_quest text)
 RETURNS TABLE(name text, today integer, week integer, alltime integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH t AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today),
  r AS (
    SELECT lower(regexp_replace(s.annotator, '[^[:alnum:]]', '', 'g')) AS k, btrim(s.annotator) AS n,
           CASE WHEN s.quest_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(s.quest_date, 'MM/DD/YYYY') END AS d
    FROM public.ew_quest_sheet_rows s
    WHERE p_quest IN ('retina_cilia', 'all') AND s.quest = 'retina_cilia' AND s.annotator <> '' AND s.status ~* '^\s*(cilium annotated|no cilium|skipped)'
    UNION ALL
    SELECT lower(regexp_replace(coalesce(nullif(btrim(u.display_name), ''), u.username, ''), '[^[:alnum:]]', '', 'g')),
           coalesce(nullif(btrim(u.display_name), ''), u.username),
           (a.answered_at AT TIME ZONE 'America/New_York')::date
    FROM public.muller_glia_answers a JOIN public.users u ON u.id = a.user_id
    WHERE p_quest IN ('retina_muller_glia', 'all')
  )
  SELECT min(r.n),
         (count(*) FILTER (WHERE r.d = t.today))::int,
         (count(*) FILTER (WHERE r.d > t.today - 7 AND r.d <= t.today))::int,
         count(*)::int
  FROM r, t WHERE r.k <> '' GROUP BY r.k;
$function$;
