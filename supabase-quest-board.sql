-- ============================================================================
-- The leaderboard's Quests tab, quickly (Ames 2026-11-06: "cilia quests
-- leaderboard takes a long time to load").
--
-- The tab used to wait for the server to read the lab's Google Sheet. It now
-- shows these counts first, from the copy of the sheet the server keeps
-- (ew_quest_sheet_rows, supabase-quest-sheet-mirror.sql), and then refreshes
-- from the sheet as before.
--
-- Same rule as the tab and the profile: a quest counts when its status starts
-- "Cilium annotated" or "No cilium"; by annotator name; on the sheet's Date
-- (a US Eastern day): today, the last 7 days, all time. Only names and counts,
-- which the leaderboard already shows to every player.
--
-- Run in the Supabase SQL editor. Safe to re-run. Reads only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ew_quest_board(p_quest text)
RETURNS TABLE (name text, today integer, week integer, alltime integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH t AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today),
  r AS (
    SELECT lower(regexp_replace(s.annotator, '[^[:alnum:]]', '', 'g')) AS k, btrim(s.annotator) AS n,
           CASE WHEN s.quest_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(s.quest_date, 'MM/DD/YYYY') END AS d
    FROM public.ew_quest_sheet_rows s
    WHERE s.quest = p_quest AND s.annotator <> '' AND s.status ~* '^\s*(cilium annotated|no cilium)'
  )
  SELECT min(r.n),
         (count(*) FILTER (WHERE r.d = t.today))::int,
         (count(*) FILTER (WHERE r.d > t.today - 7 AND r.d <= t.today))::int,
         count(*)::int
  FROM r, t WHERE r.k <> '' GROUP BY r.k;
$fn$;
-- Pyr reads Supabase as anon (it never signs in there; players sign in through
-- CAVE), so anon must run it: without this the Quests tab said "The quest
-- sheet could not be read just now" for everyone (Ames 2026-11-12).
REVOKE ALL ON FUNCTION public.ew_quest_board(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ew_quest_board(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Undo:
-- DROP FUNCTION public.ew_quest_board(text);
