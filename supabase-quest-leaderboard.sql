-- ============================================================================
-- Quests on the leaderboard (Ames 2026-11-05: "We could build a leaderboard
-- tab for Quests maybe?").
--
-- What is counted: active time on Super Quests (proofreading_tasks.kind =
-- 'interneuron'), the seconds pilot_claim_time adds to claim_active_days
-- (supabase-super-quest-weekly.sql). A quest takes weeks, so finished quests
-- alone would leave almost everyone at 0 (AzureJay, report #384); the time is
-- what ranks. Finished Super Quests ride along as a second number.
-- Annotation Quests (Cilia Quest) are not counted: their record is the lab's
-- sheet, matched by name, not a table here.
--
-- Windows, in US Eastern days (the days claim_active_days keeps):
--   today       the current ET day
--   week        the last 7 ET days, today included
--   alltime     every day
--
-- Load: one small materialized view, refreshed every 5 minutes by pg_cron.
-- It reads only claim_active_days rows of quest claims and the completed
-- quests, never edit_log. The board reads the whole view in one select
-- (one row per player with any quest time).
--
-- Run after supabase-super-quest-weekly.sql. Needs pg_cron (already on).
-- Safe to re-run. Undo is at the bottom.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP MATERIALIZED VIEW IF EXISTS public.quest_leaderboard_cache CASCADE;

CREATE MATERIALIZED VIEW public.quest_leaderboard_cache AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'America/New_York')::date AS d
),
secs AS (
  SELECT a.user_id,
    SUM(a.seconds) FILTER (WHERE a.day = (SELECT d FROM today))     AS s_today,
    SUM(a.seconds) FILTER (WHERE a.day > (SELECT d FROM today) - 7) AS s_week,
    SUM(a.seconds)                                                  AS s_all
  FROM public.claim_active_days a
  JOIN public.proofreading_tasks t ON t.id = a.task_id AND t.kind = 'interneuron'
  GROUP BY a.user_id
),
done AS (
  SELECT assigned_to AS user_id, count(*) AS n
  FROM public.proofreading_tasks
  WHERE kind = 'interneuron' AND status = 'completed' AND assigned_to IS NOT NULL
  GROUP BY assigned_to
)
SELECT u.id, u.display_name, u.flag, u.current_streak,
       COALESCE(s.s_today, 0)::integer AS quest_seconds_today,
       COALESCE(s.s_week, 0)::integer  AS quest_seconds_week,
       COALESCE(s.s_all, 0)::integer   AS quest_seconds_alltime,
       COALESCE(d.n, 0)::integer       AS quests_finished
FROM public.users u
LEFT JOIN secs s ON s.user_id = u.id
LEFT JOIN done d ON d.user_id = u.id
WHERE s.user_id IS NOT NULL OR d.user_id IS NOT NULL
WITH DATA;

-- Required by REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX quest_leaderboard_cache_id_uidx ON public.quest_leaderboard_cache (id);

-- Only columns that are already public (name, flag, streak) plus quest totals.
-- The advisor will WARN "materialized view in API"; expected, as for
-- leaderboard_cache.
REVOKE ALL ON public.quest_leaderboard_cache FROM PUBLIC;
GRANT SELECT ON public.quest_leaderboard_cache TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_quest_leaderboard_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(98127, 61761) THEN RETURN; END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.quest_leaderboard_cache;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refresh_quest_leaderboard_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_quest_leaderboard_cache() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Every 5 minutes (and so "today" turns over within 5 minutes of midnight ET).
SELECT cron.unschedule('pyr-quest-leaderboard-refresh')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pyr-quest-leaderboard-refresh');
SELECT cron.schedule(
  'pyr-quest-leaderboard-refresh',
  '*/5 * * * *',
  $cmd$SET statement_timeout = '30s'; SET lock_timeout = '5s'; SELECT public.refresh_quest_leaderboard_cache();$cmd$
);

-- Check (read only): the board as players will see it.
-- SELECT display_name, quest_seconds_today/60 AS min_today, quest_seconds_week/60 AS min_week,
--        quest_seconds_alltime/3600.0 AS hours_all, quests_finished
-- FROM public.quest_leaderboard_cache ORDER BY quest_seconds_alltime DESC;

-- Undo:
-- SELECT cron.unschedule('pyr-quest-leaderboard-refresh');
-- DROP FUNCTION public.refresh_quest_leaderboard_cache();
-- DROP MATERIALIZED VIEW public.quest_leaderboard_cache;
