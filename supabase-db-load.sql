-- ============================================================================
-- Pyr: cut the database's CPU load (2026-10-25)
-- Why: on 25 Oct the Supabase compute ran at 87 to 100% CPU and Pyr went down
-- twice. Audit: https://claude.ai/artifact/1Asx9Tjm3pa2SYYMzPX66C
--
-- Run the steps IN ORDER in the Supabase SQL editor, one "@@STEP" block per
-- run. Steps 3 and 8 are CREATE INDEX CONCURRENTLY: paste and run those ONE
-- STATEMENT AT A TIME (the editor sends a pasted script as one transaction,
-- and CONCURRENTLY refuses to run inside one). Every step has its undo in
-- the ROLLBACK section at the end. Nothing here deletes app data.
--
-- Do not re-run these older files afterwards; they would put the old, slow
-- definitions back: supabase-leaderboard-accuracy.sql,
-- supabase-completions-same-cell.sql, supabase-leaderboard-board.sql,
-- supabase-days-more-actions.sql, supabase-days-need-action.sql,
-- supabase-dataset-stats.sql. Change the counting rules in the *_live views.
-- ============================================================================

-- @@STEP 1: Baseline, and turn on the scheduler. Save the output before changing anything.
SELECT version();                                            -- need PG >= 12 for NOT MATERIALIZED
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_stat_statements');
-- Who depends on user_edit_counts (expect leaderboard_board only). Anything
-- else listed here follows the rename in Step 5 to user_edit_counts_live.
SELECT DISTINCT dv.relname AS dependent_view
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class dv ON dv.oid = r.ev_class
WHERE d.refobjid = 'public.user_edit_counts'::regclass AND dv.oid <> d.refobjid;
-- Existing cron jobs (is expire_stale_assignments scheduled, and how often?)
-- SELECT jobid, jobname, schedule, command FROM cron.job;
-- Top CPU statements right now (pg_stat_statements is on by default on Supabase):
SELECT calls, round(total_exec_time)::bigint AS total_ms, round(mean_exec_time::numeric, 1) AS mean_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 25;
-- Table sizes the estimates depend on
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE relname IN ('edit_log', 'users', 'proofreading_tasks', 'task_assignments', 'notifications',
                  'chat_messages', 'chat_presence', 'help_requests', 'issue_tags', 'working_links')
ORDER BY n_live_tup DESC;

-- The scheduler that refreshes the stored totals (steps 5 and 7). Turned on
-- first, so that if it is not available nothing else has changed yet. If this
-- line fails: Dashboard > Database > Extensions > pg_cron, then run it again.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';   -- expect one row

-- @@STEP 2: Time zones from a stored list (every logged action)
-- ============================================================================
-- Step 2. Time zones without pg_timezone_names (may run in a transaction)
-- pg_timezone_names is a set-returning function that reads every zone file
-- from disk on each call (~600 files). It runs on every ew_log_activity (every
-- edit, claim, cell, annotation tally; supabase-days-more-actions.sql:59),
-- every help request/answer trigger (ew_count_day, :148), and twice per game
-- open (ew_touch_streak, supabase-days-need-action.sql:45,47). Same check
-- against a cached list. The three functions below are the live text with
-- only "pg_catalog.pg_timezone_names z" replaced by "public.ew_tz_names z".
-- CREATE OR REPLACE keeps their existing grants and revokes.
-- ============================================================================
BEGIN;
CREATE TABLE IF NOT EXISTS public.ew_tz_names (name text PRIMARY KEY);
INSERT INTO public.ew_tz_names (name) SELECT name FROM pg_catalog.pg_timezone_names ON CONFLICT DO NOTHING;
ALTER TABLE public.ew_tz_names ENABLE ROW LEVEL SECURITY;      -- no policy: API roles get nothing
REVOKE ALL ON public.ew_tz_names FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ew_tz_names TO service_role;

CREATE OR REPLACE FUNCTION public.ew_log_activity(p_user UUID, p_row JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u        public.users%ROWTYPE;
  v_id     BIGINT;
  op       TEXT := p_row->>'operation';
  ok       BOOLEAN := COALESCE((p_row->>'success')::BOOLEAN, TRUE);
  ds       TEXT := COALESCE(NULLIF(p_row->>'dataset', ''), 'eyewire_ii');
  today    DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  cells0   INTEGER := 0;
  cells1   INTEGER := 0;
  d_edits  INTEGER := 0;
  d_cells  INTEGER := 0;
  d_ann    INTEGER := 0;
  d_days   INTEGER := 0;
  streak   INTEGER;
  longest  INTEGER;
  is_cell  BOOLEAN := op IN ('complete_task', 'mark_complete', 'unmark_complete');
  -- What makes a day (Ames 2026-10-08): an edit, a completed cell, claiming a
  -- cell, typing a cell, or annotating. Not a visit and not a release.
  is_work  BOOLEAN := op IN ('merge', 'split', 'complete_task', 'mark_complete',
                             'claim_task', 'set_cell_type', 'annotate');
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown player'; END IF;
  -- The player's own day, not UTC's (which ends at 8 pm in New York).
  today := (NOW() AT TIME ZONE COALESCE(
    (SELECT z.name FROM public.ew_tz_names z WHERE z.name = u.tz), 'UTC'))::DATE;

  IF ok AND is_cell THEN
    SELECT COUNT(*) INTO cells0 FROM public.ew_cell_completions WHERE user_id = p_user;
  END IF;

  INSERT INTO public.edit_log (task_id, user_id, operation, segment_before, segment_after,
                               coordinates, metadata, dataset, success, op_key)
  VALUES (NULLIF(p_row->>'task_id', '')::INTEGER, p_user, op,
          p_row->>'segment_before', p_row->>'segment_after', p_row->>'coordinates',
          CASE WHEN jsonb_typeof(p_row->'metadata') = 'object' THEN p_row->'metadata' END,
          ds, ok, NULLIF(p_row->>'op_key', ''))
  ON CONFLICT (dataset, op_key) WHERE op_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('recorded', FALSE, 'duplicate', TRUE,
      'total_edits', u.total_edits, 'total_merges', u.total_merges, 'total_splits', u.total_splits,
      'cells_completed', u.cells_completed, 'total_annotations', u.total_annotations,
      'current_streak', u.current_streak, 'longest_streak', u.longest_streak,
      'last_edit_date', u.last_edit_date, 'streak_before', u.current_streak, 'edits_before', u.total_edits);
  END IF;

  streak  := COALESCE(u.current_streak, 0);
  longest := COALESCE(u.longest_streak, 0);

  IF ok THEN
    IF op IN ('split', 'merge') THEN
      d_edits := 1;
    ELSIF is_cell THEN
      SELECT COUNT(*) INTO cells1 FROM public.ew_cell_completions WHERE user_id = p_user;
      d_cells := cells1 - cells0;
    ELSIF op = 'annotate' THEN
      d_ann := LEAST(GREATEST(COALESCE(NULLIF(p_row->'metadata'->>'count', '')::INTEGER, 1), 1), 500);
    END IF;

    -- Only the actions in is_work move the day (see above).
    -- Only ever forwards: a change of time zone can not reset a streak.
    IF is_work AND (u.last_edit_date IS NULL OR today > u.last_edit_date) THEN
      streak := CASE WHEN u.last_edit_date = today - 1 THEN streak + 1 ELSE 1 END;
      longest := GREATEST(longest, streak);
      d_days := 1;               -- a new day on the player's calendar
    END IF;

    UPDATE public.users SET
      total_edits       = COALESCE(total_edits, 0) + d_edits,
      total_merges      = COALESCE(total_merges, 0) + CASE WHEN op = 'merge' THEN d_edits ELSE 0 END,
      total_splits      = COALESCE(total_splits, 0) + CASE WHEN op = 'split' THEN d_edits ELSE 0 END,
      cells_completed   = GREATEST(0, COALESCE(cells_completed, 0) + d_cells),
      total_annotations = COALESCE(total_annotations, 0) + d_ann,
      total_days        = COALESCE(total_days, 0) + d_days,
      current_streak    = streak,
      longest_streak    = longest,
      last_edit_date    = CASE WHEN NOT is_work THEN last_edit_date
                               ELSE GREATEST(COALESCE(last_edit_date, today), today) END,
      updated_at        = NOW()
    WHERE id = p_user;
  END IF;

  RETURN (
    SELECT jsonb_build_object('recorded', TRUE, 'duplicate', FALSE, 'id', v_id,
      'total_edits', n.total_edits, 'total_merges', n.total_merges, 'total_splits', n.total_splits,
      'cells_completed', n.cells_completed, 'total_annotations', n.total_annotations,
      'current_streak', n.current_streak, 'longest_streak', n.longest_streak,
      'last_edit_date', n.last_edit_date,
      'streak_before', COALESCE(u.current_streak, 0), 'edits_before', COALESCE(u.total_edits, 0),
      'total_days', COALESCE(n.total_days, 0), 'days_before', COALESCE(u.total_days, 0))
    FROM public.users n WHERE n.id = p_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.ew_count_day(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u      public.users%ROWTYPE;
  today  DATE;
  streak INTEGER;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  SELECT * INTO u FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  today := (NOW() AT TIME ZONE COALESCE(
    (SELECT z.name FROM public.ew_tz_names z WHERE z.name = u.tz), 'UTC'))::DATE;
  IF u.last_edit_date IS NOT NULL AND today <= u.last_edit_date THEN RETURN; END IF;
  streak := CASE WHEN u.last_edit_date = today - 1 THEN COALESCE(u.current_streak, 0) + 1 ELSE 1 END;
  UPDATE public.users SET
    total_days     = COALESCE(total_days, 0) + 1,
    current_streak = streak,
    longest_streak = GREATEST(COALESCE(longest_streak, 0), streak),
    last_edit_date = today,
    updated_at     = NOW()
  WHERE id = p_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.ew_touch_streak(p_user UUID, p_tz TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u         public.users%ROWTYPE;
  zone      TEXT;
  today     DATE;
  before    INTEGER;
  streak    INTEGER;
  longest   INTEGER;
  run_now   INTEGER;
  run_max   INTEGER;
  recounted BOOLEAN := FALSE;
  days_before    INTEGER;
  total          INTEGER;
  days_recounted BOOLEAN := FALSE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown player'; END IF;

  -- Only a zone PostgreSQL knows; else the one already saved; else UTC.
  SELECT z.name INTO zone FROM public.ew_tz_names z WHERE z.name = p_tz;
  IF zone IS NULL THEN
    SELECT z.name INTO zone FROM public.ew_tz_names z WHERE z.name = u.tz;
  END IF;
  zone  := COALESCE(zone, 'UTC');
  today := (NOW() AT TIME ZONE zone)::DATE;

  before  := COALESCE(u.current_streak, 0);
  streak  := before;
  longest := COALESCE(u.longest_streak, 0);
  days_before := COALESCE(u.total_days, 0);
  total       := days_before;

  -- Total days: every day the player has DONE something, ever. It never
  -- resets. Counted once from the log (days with any successful activity
  -- other than annotating, and the day already saved). A visit adds nothing:
  -- only ew_log_activity moves it now.
  IF u.days_recounted_at IS NULL THEN
    SELECT COUNT(*)::INTEGER INTO total FROM (
      SELECT (e."timestamp" AT TIME ZONE zone)::DATE AS day
      FROM public.edit_log e
      WHERE e.user_id = p_user AND e.success IS NOT FALSE AND e.operation <> 'annotate'
      UNION SELECT u.last_edit_date WHERE u.last_edit_date IS NOT NULL AND u.last_edit_date <= today
    ) d;
    total := GREATEST(total, days_before);
    days_recounted := TRUE;
  END IF;

  IF u.streak_recounted_at IS NULL THEN
    -- First visit with a known zone: count the days again in that zone.
    -- A day is one with any successful activity other than annotating. Today
    -- is not added: a visit is not a day. The streak is the run that ends
    -- today or yesterday (yesterday's run is still alive until today ends).
    WITH days AS (
      SELECT DISTINCT (e."timestamp" AT TIME ZONE zone)::DATE AS day
      FROM public.edit_log e
      WHERE e.user_id = p_user AND e.success IS NOT FALSE AND e.operation <> 'annotate'
    ), runs AS (
      SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::INTEGER AS grp FROM days
    ), sized AS (
      SELECT grp, COUNT(*)::INTEGER AS n, MAX(day) AS last_day FROM runs GROUP BY grp
    )
    SELECT COALESCE(MAX(n) FILTER (WHERE last_day >= today - 1), 0), COALESCE(MAX(n), 0)
      INTO run_now, run_max FROM sized;
    streak    := run_now;
    longest   := GREATEST(longest, run_max);
    recounted := TRUE;
  ELSIF u.last_edit_date IS NULL OR u.last_edit_date < today - 1 THEN
    -- More than a day missed: the streak is over. Say so now, so the profile
    -- does not show a streak that the next action would reset anyway.
    streak := 0;
  END IF;

  UPDATE public.users SET
    tz                  = zone,
    current_streak      = streak,
    longest_streak      = longest,
    streak_recounted_at = COALESCE(streak_recounted_at, NOW()),
    total_days          = total,
    days_recounted_at   = COALESCE(days_recounted_at, NOW())
  WHERE id = p_user;

  RETURN jsonb_build_object('current_streak', streak, 'longest_streak', longest,
    'last_edit_date', u.last_edit_date,
    'streak_before', before, 'recounted', recounted, 'tz', zone,
    'total_days', total, 'days_before', days_before, 'days_recounted', days_recounted);
END;
$$;

COMMIT;
-- After a Postgres/tzdata upgrade the list is refreshed by the weekly job in Step 5.

-- @@STEP 3: Indexes for one player's edit_log rows (one statement per run)
-- 1a. Completion rows per player, in time order.
-- Serves: ew_cell_marks / ew_cell_completions / ew_completion_roots once Step 4
-- lets "user_id = X" through (ew_log_activity cells0/cells1,
-- supabase-days-more-actions.sql:62,89; functions/activity.js:56); the +/-2
-- minute EXISTS in ew_cell_marks (supabase-completions-same-cell.sql:78);
-- src/util/dataset_contribution.ts loggedCells (eq user_id, in operation,
-- order timestamp,id); scripts/weekly-completions.mjs fallback.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_editlog_completions_user_ts
  ON public.edit_log (user_id, "timestamp", id)
  WHERE operation IN ('complete_task', 'mark_complete', 'unmark_complete');

-- 1b. Counted edits per player, in time order (index-only for the counts).
-- Serves: the edits subquery of user_edit_counts (supabase-leaderboard-accuracy.sql:132-140),
-- i.e. the cache refresh in Step 5; dataset_contribution.ts:135-138 edits count
-- (eq user_id, in dataset, in operation split/merge, success not false).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_editlog_edits_user_ts
  ON public.edit_log (user_id, "timestamp")
  WHERE operation IN ('split', 'merge') AND success IS NOT FALSE;

-- @@STEP 4: Count one player's completed cells, not everyone's
-- ============================================================================
-- Step 4. Completed-cell rule, NOT MATERIALIZED (may run in a transaction)
-- Text is supabase-completions-same-cell.sql:49-113 (the live definition; it
-- runs after supabase-leaderboard-accuracy.sql) with only "AS NOT MATERIALIZED"
-- added to each CTE. Same columns, same order, same result.
-- Why: a CTE referenced more than once is materialized, so an outer
-- "WHERE user_id = X" never reaches edit_log: every per-player read computes
-- every player's cells, and the +/-2 min EXISTS scans the whole CTE per row.
-- Re-running supabase-leaderboard-accuracy.sql or supabase-completions-same-cell.sql
-- later would silently undo this part.
-- ============================================================================
BEGIN;
CREATE OR REPLACE VIEW public.ew_cell_marks WITH (security_invoker = true) AS
WITH ev AS NOT MATERIALIZED (
  SELECT l.id, l.user_id, public.ew_dataset_key(l.dataset) AS dataset,
         l.timestamp AS ts, l.operation, l.task_id,
         NULLIF(COALESCE(l.metadata->>'final_segment_id', l.metadata->>'root_id', l.metadata->>'segment_id'), '') AS rid,
         CASE WHEN l.operation = 'mark_complete' THEN NULLIF(l.metadata->>'same_cell_as', '') END AS same
  FROM public.edit_log l
  WHERE l.user_id IS NOT NULL
    AND l.success IS NOT FALSE
    AND l.operation IN ('complete_task', 'mark_complete', 'unmark_complete')
),
task_roots AS NOT MATERIALIZED (
  SELECT user_id, dataset, rid, MIN(task_id) AS task_id
  FROM ev
  WHERE operation = 'complete_task' AND task_id IS NOT NULL AND rid IS NOT NULL
  GROUP BY user_id, dataset, rid
),
same_roots AS NOT MATERIALIZED (
  SELECT user_id, dataset, rid, MIN(same) AS cell
  FROM ev
  WHERE same IS NOT NULL AND rid IS NOT NULL
  GROUP BY user_id, dataset, rid
)
SELECT e.user_id, e.dataset, e.ts, e.operation, e.rid,
  CASE
    WHEN e.operation = 'complete_task' AND e.task_id IS NOT NULL AND e.rid IS NOT NULL THEN 'task:' || e.task_id
    -- The earlier cell may itself have become a Cell Library cell since.
    WHEN e.rid IS NOT NULL THEN COALESCE('task:' || t.task_id, 'task:' || st.task_id, s.cell, e.rid)
    WHEN e.operation = 'unmark_complete' THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM ev d
      WHERE d.user_id = e.user_id AND d.dataset = e.dataset AND d.id <> e.id
        AND d.operation <> 'unmark_complete' AND d.rid IS NOT NULL
        AND d.ts BETWEEN e.ts - INTERVAL '2 minutes' AND e.ts + INTERVAL '2 minutes'
    ) THEN NULL
    WHEN e.task_id IS NOT NULL THEN 'task:' || e.task_id
    ELSE 'at:' || to_char(date_trunc('minute', e.ts AT TIME ZONE 'UTC'), 'YYYYMMDDHH24MI')
  END AS cell
FROM ev e
LEFT JOIN task_roots t  ON t.user_id = e.user_id AND t.dataset = e.dataset AND t.rid = e.rid
LEFT JOIN same_roots s  ON s.user_id = e.user_id AND s.dataset = e.dataset AND s.rid = e.rid
LEFT JOIN task_roots st ON st.user_id = e.user_id AND st.dataset = e.dataset AND st.rid = s.cell;

-- ── 2. The completed-cell rule ──────────────────────────────────────────────
-- One row per cell a player has completed and not un-marked, with the moment
-- it was completed: the first mark, or, if it was ever un-marked, the first
-- mark after the last un-mark. Decided over the WHOLE log, before any time
-- window. Same columns as before, so every reader (the board, the weekly
-- ranking, the saved podium, the server's counter) needs no change.
CREATE OR REPLACE VIEW public.ew_cell_completions WITH (security_invoker = true) AS
WITH keyed AS NOT MATERIALIZED (
  SELECT user_id, dataset, ts, operation, cell FROM public.ew_cell_marks
),
last_unmark AS NOT MATERIALIZED (
  SELECT user_id, dataset, cell, MAX(ts) AS at
  FROM keyed WHERE operation = 'unmark_complete' AND cell IS NOT NULL
  GROUP BY user_id, dataset, cell
)
SELECT k.user_id, k.dataset, k.cell,
       MIN(k.ts) FILTER (WHERE u.at IS NULL OR k.ts > u.at) AS done_at
FROM keyed k
LEFT JOIN last_unmark u ON u.user_id = k.user_id AND u.dataset = k.dataset AND u.cell = k.cell
WHERE k.operation <> 'unmark_complete' AND k.cell IS NOT NULL
GROUP BY k.user_id, k.dataset, k.cell
HAVING MIN(k.ts) FILTER (WHERE u.at IS NULL OR k.ts > u.at) IS NOT NULL;
COMMIT;

-- @@STEP 5: Leaderboard running total, refreshed every minute
-- ============================================================================
-- Step 5. Leaderboard cache (run as ONE transaction; the pg_cron lines after it)
--
-- Shape kept exactly:
--   user_edit_counts   same 18 columns, same order (supabase-leaderboard-accuracy.sql:114-146)
--                      + 6 rank columns appended (rank_<ranking>)
--   leaderboard_board  same 16 columns (supabase-leaderboard-board.sql:14-31),
--                      same top-50-of-each rule, same tie break (id)
--   ew_weekly_ranking  unchanged; only the weekly jobs call it (scripts/weekly-*.mjs)
-- Client change needed: none. Optional: read rank_* from the "mine" row and drop
-- the 6 count queries (src/store.ts:4596-4605).
-- rank_<x> = RANK() OVER (ORDER BY x DESC) = 1 + number of players with a
-- strictly larger value: exactly what the client computes today (count gt + 1).
-- Freshness: up to 60 s plus refresh time. A player created in the last
-- minute has no row until the next refresh.
-- The live counting rule stays in user_edit_counts_live (not readable by the
-- API roles). Future edits of the rule go there, never to user_edit_counts.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER VIEW public.user_edit_counts RENAME TO user_edit_counts_live;
REVOKE ALL ON public.user_edit_counts_live FROM PUBLIC, anon, authenticated;

CREATE MATERIALIZED VIEW public.leaderboard_cache AS
SELECT l.id, l.display_name, l.flag, l.bio,
       l.total_edits, l.total_merges, l.total_splits, l.cells_completed,
       l.current_streak, l.longest_streak,
       l.edits_24h, l.edits_week, l.edits_alltime,
       l.completions_24h, l.completions_week, l.completions_alltime,
       l.edits_logged, l.completions_logged,
       -- the player's place, as the client counts it (src/store.ts:4596-4605)
       (RANK() OVER (ORDER BY l.edits_alltime       DESC))::integer AS rank_edits_alltime,
       (RANK() OVER (ORDER BY l.edits_week          DESC))::integer AS rank_edits_week,
       (RANK() OVER (ORDER BY l.edits_24h           DESC))::integer AS rank_edits_24h,
       (RANK() OVER (ORDER BY l.completions_alltime DESC))::integer AS rank_completions_alltime,
       (RANK() OVER (ORDER BY l.completions_week    DESC))::integer AS rank_completions_week,
       (RANK() OVER (ORDER BY l.completions_24h     DESC))::integer AS rank_completions_24h,
       -- leaderboard_board's top-50 membership (supabase-leaderboard-board.sql:16-21)
       (row_number() OVER (ORDER BY l.edits_alltime       DESC NULLS LAST, l.id))::integer AS rn_edits_alltime,
       (row_number() OVER (ORDER BY l.edits_week          DESC NULLS LAST, l.id))::integer AS rn_edits_week,
       (row_number() OVER (ORDER BY l.edits_24h           DESC NULLS LAST, l.id))::integer AS rn_edits_24h,
       (row_number() OVER (ORDER BY l.completions_alltime DESC NULLS LAST, l.id))::integer AS rn_completions_alltime,
       (row_number() OVER (ORDER BY l.completions_week    DESC NULLS LAST, l.id))::integer AS rn_completions_week,
       (row_number() OVER (ORDER BY l.completions_24h     DESC NULLS LAST, l.id))::integer AS rn_completions_24h
FROM public.user_edit_counts_live l
WITH DATA;

-- Required by REFRESH ... CONCURRENTLY (unique, no WHERE, plain column).
CREATE UNIQUE INDEX leaderboard_cache_id_uidx ON public.leaderboard_cache (id);

-- The name every reader uses. Thin, security_invoker (keeps the advisor clean).
CREATE VIEW public.user_edit_counts WITH (security_invoker = true) AS
SELECT id, display_name, flag, bio,
       total_edits, total_merges, total_splits, cells_completed,
       current_streak, longest_streak,
       edits_24h, edits_week, edits_alltime,
       completions_24h, completions_week, completions_alltime,
       edits_logged, completions_logged,
       rank_edits_alltime, rank_edits_week, rank_edits_24h,
       rank_completions_alltime, rank_completions_week, rank_completions_24h
FROM public.leaderboard_cache;

-- Same 16 columns as today; reads the cache instead of recounting edit_log.
CREATE OR REPLACE VIEW public.leaderboard_board WITH (security_invoker = true) AS
SELECT id, display_name, flag, bio,
       total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak,
       edits_24h, edits_week, edits_alltime, completions_24h, completions_week, completions_alltime
FROM public.leaderboard_cache
WHERE rn_edits_alltime <= 50 OR rn_edits_week <= 50 OR rn_edits_24h <= 50
   OR rn_completions_alltime <= 50 OR rn_completions_week <= 50 OR rn_completions_24h <= 50;

-- Grants. The cache holds only columns that are already public (users' public
-- columns plus counts). The advisor will WARN "materialized view in API" for
-- leaderboard_cache; that is expected and harmless here.
REVOKE ALL ON public.leaderboard_cache FROM PUBLIC;
GRANT SELECT ON public.leaderboard_cache, public.user_edit_counts, public.leaderboard_board
  TO anon, authenticated, service_role;

-- Refresh: one at a time; skips if a refresh is still running.
CREATE OR REPLACE FUNCTION public.refresh_leaderboard_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(98127, 61760) THEN RETURN; END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_cache;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_cache() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- pg_cron was turned on in step 1.

-- Every minute. statement_timeout is set in the command because a SET inside
-- the function does not cover the statement that is already running.
SELECT cron.schedule(
  'pyr-leaderboard-cache-refresh',
  '* * * * *',
  $cmd$SET statement_timeout = '50s'; SET lock_timeout = '5s'; SELECT public.refresh_leaderboard_cache();$cmd$
);
-- pg_cron keeps a row per run (1,440 a day from the job above): trim daily.
SELECT cron.schedule(
  'pyr-cron-history-trim',
  '17 3 * * *',
  $cmd$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'$cmd$
);
-- Keep Step 2's zone list current (weekly, cheap).
SELECT cron.schedule(
  'pyr-tz-names-sync',
  '29 4 * * 1',
  $cmd$INSERT INTO public.ew_tz_names (name) SELECT name FROM pg_catalog.pg_timezone_names ON CONFLICT DO NOTHING$cmd$
);
-- Every 2 minutes instead:
-- SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'pyr-leaderboard-cache-refresh'),
--                       schedule => '*/2 * * * *');

-- @@STEP 6: Each player's edits by hour (profile and Datasets tab)
-- ============================================================================
-- One row per player, dataset and hour with that hour's merges and splits,
-- kept current by a trigger on edit_log. The profile read every edit a player
-- ever made (1,000 rows a request, on every open and every return to
-- Overview); it now reads these rows instead, a few hundred for most players.
-- Same rule as the board: a split or merge that did not fail.
-- The trigger takes a short lock on edit_log while this step runs, so edits
-- wait a few seconds; nothing is lost. May run in one transaction (it does).
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.ew_user_edit_hours (
  user_id UUID NOT NULL,
  dataset TEXT NOT NULL,           -- edit_log.dataset as written ('' when NULL)
  hour    TIMESTAMPTZ NOT NULL,    -- start of the UTC hour
  merges  INTEGER NOT NULL DEFAULT 0,
  splits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dataset, hour)
);

CREATE OR REPLACE FUNCTION public.ew_edit_hours_track()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.user_id IS NOT NULL
     AND OLD.operation IN ('merge', 'split') AND OLD.success IS NOT FALSE THEN
    UPDATE public.ew_user_edit_hours h
    SET merges = h.merges - (OLD.operation = 'merge')::int,
        splits = h.splits - (OLD.operation = 'split')::int
    WHERE h.user_id = OLD.user_id AND h.dataset = COALESCE(OLD.dataset, '')
      AND h.hour = date_trunc('hour', OLD."timestamp", 'UTC');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.user_id IS NOT NULL
     AND NEW.operation IN ('merge', 'split') AND NEW.success IS NOT FALSE THEN
    INSERT INTO public.ew_user_edit_hours AS h (user_id, dataset, hour, merges, splits)
    VALUES (NEW.user_id, COALESCE(NEW.dataset, ''), date_trunc('hour', NEW."timestamp", 'UTC'),
            (NEW.operation = 'merge')::int, (NEW.operation = 'split')::int)
    ON CONFLICT (user_id, dataset, hour) DO UPDATE
      SET merges = h.merges + EXCLUDED.merges, splits = h.splits + EXCLUDED.splits;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ew_edit_hours_track() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ew_edit_hours_track ON public.edit_log;
CREATE TRIGGER ew_edit_hours_track
  AFTER INSERT OR DELETE OR UPDATE OF user_id, operation, success, dataset, "timestamp"
  ON public.edit_log
  FOR EACH ROW EXECUTE FUNCTION public.ew_edit_hours_track();

-- Fill it from the whole log once. The trigger above already holds its lock,
-- so no edit can slip between this count and the trigger.
DELETE FROM public.ew_user_edit_hours;
INSERT INTO public.ew_user_edit_hours (user_id, dataset, hour, merges, splits)
SELECT user_id, COALESCE(dataset, ''), date_trunc('hour', "timestamp", 'UTC'),
       count(*) FILTER (WHERE operation = 'merge')::int,
       count(*) FILTER (WHERE operation = 'split')::int
FROM public.edit_log
WHERE user_id IS NOT NULL AND operation IN ('merge', 'split') AND success IS NOT FALSE
GROUP BY 1, 2, 3;

-- Readable like edit_log itself (editlog_select is USING (true)).
ALTER TABLE public.ew_user_edit_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ew_user_edit_hours_read ON public.ew_user_edit_hours;
CREATE POLICY ew_user_edit_hours_read ON public.ew_user_edit_hours FOR SELECT USING (true);
REVOKE ALL ON public.ew_user_edit_hours FROM anon, authenticated;
GRANT SELECT ON public.ew_user_edit_hours TO anon, authenticated;
GRANT ALL ON public.ew_user_edit_hours TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check (expect 0 rows): the hours add up to each player's edits in the log.
-- SELECT l.user_id FROM (SELECT user_id, count(*) n FROM public.edit_log
--   WHERE user_id IS NOT NULL AND operation IN ('merge','split') AND success IS NOT FALSE GROUP BY 1) l
-- FULL JOIN (SELECT user_id, sum(merges + splits) n FROM public.ew_user_edit_hours GROUP BY 1) h USING (user_id)
-- WHERE l.n IS DISTINCT FROM h.n;



-- @@STEP 7: Dataset Stats from stored tables, refreshed every 10 minutes
-- ============================================================================
-- The five views the Dataset Stats panel reads (supabase-dataset-stats.sql)
-- each recount edit_log and the cell list on every open, filtered on a
-- computed dataset name that no index can serve. Their results now live in
-- tables, refreshed every 10 minutes. The views keep their names and columns,
-- so the panel needs no change. The counting stays in ew_dataset_*_live.
-- Numbers on the panel can be up to 10 minutes old.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER VIEW public.ew_dataset_progress RENAME TO ew_dataset_progress_live;
ALTER VIEW public.ew_dataset_weekly   RENAME TO ew_dataset_weekly_live;
ALTER VIEW public.ew_dataset_types    RENAME TO ew_dataset_types_live;
ALTER VIEW public.ew_dataset_people   RENAME TO ew_dataset_people_live;
ALTER VIEW public.ew_dataset_work     RENAME TO ew_dataset_work_live;
REVOKE ALL ON public.ew_dataset_progress_live, public.ew_dataset_weekly_live, public.ew_dataset_types_live,
  public.ew_dataset_people_live, public.ew_dataset_work_live FROM PUBLIC, anon, authenticated;

CREATE TABLE public.ew_dataset_progress_cache AS SELECT * FROM public.ew_dataset_progress_live;
CREATE TABLE public.ew_dataset_weekly_cache   AS SELECT * FROM public.ew_dataset_weekly_live;
CREATE TABLE public.ew_dataset_types_cache    AS SELECT * FROM public.ew_dataset_types_live;
CREATE TABLE public.ew_dataset_people_cache   AS SELECT * FROM public.ew_dataset_people_live;
CREATE TABLE public.ew_dataset_work_cache     AS SELECT * FROM public.ew_dataset_work_live;
CREATE INDEX ON public.ew_dataset_progress_cache (dataset);
CREATE INDEX ON public.ew_dataset_weekly_cache (dataset, week_start);
CREATE INDEX ON public.ew_dataset_types_cache (dataset);
CREATE INDEX ON public.ew_dataset_people_cache (dataset);
CREATE INDEX ON public.ew_dataset_work_cache (dataset, user_id);

-- The names the panel reads, same columns, from the stored rows.
CREATE VIEW public.ew_dataset_progress WITH (security_invoker = true) AS SELECT * FROM public.ew_dataset_progress_cache;
CREATE VIEW public.ew_dataset_weekly   WITH (security_invoker = true) AS SELECT * FROM public.ew_dataset_weekly_cache;
CREATE VIEW public.ew_dataset_types    WITH (security_invoker = true) AS SELECT * FROM public.ew_dataset_types_cache;
CREATE VIEW public.ew_dataset_people   WITH (security_invoker = true) AS SELECT * FROM public.ew_dataset_people_cache;
CREATE VIEW public.ew_dataset_work     WITH (security_invoker = true) AS SELECT * FROM public.ew_dataset_work_cache;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ew_dataset_progress_cache', 'ew_dataset_weekly_cache', 'ew_dataset_types_cache',
                           'ew_dataset_people_cache', 'ew_dataset_work_cache'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_read', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
  END LOOP;
END $do$;
GRANT SELECT ON public.ew_dataset_progress, public.ew_dataset_weekly, public.ew_dataset_types,
  public.ew_dataset_people, public.ew_dataset_work TO anon, authenticated, service_role;

-- Refresh: DELETE and INSERT in one transaction, so readers see the old rows
-- until the new ones are in (TRUNCATE would block them). Skips if a refresh
-- is still running.
CREATE OR REPLACE FUNCTION public.refresh_dataset_stats_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(98127, 61761) THEN RETURN; END IF;
  DELETE FROM public.ew_dataset_progress_cache; INSERT INTO public.ew_dataset_progress_cache SELECT * FROM public.ew_dataset_progress_live;
  DELETE FROM public.ew_dataset_weekly_cache;   INSERT INTO public.ew_dataset_weekly_cache   SELECT * FROM public.ew_dataset_weekly_live;
  DELETE FROM public.ew_dataset_types_cache;    INSERT INTO public.ew_dataset_types_cache    SELECT * FROM public.ew_dataset_types_live;
  DELETE FROM public.ew_dataset_people_cache;   INSERT INTO public.ew_dataset_people_cache   SELECT * FROM public.ew_dataset_people_live;
  DELETE FROM public.ew_dataset_work_cache;     INSERT INTO public.ew_dataset_work_cache     SELECT * FROM public.ew_dataset_work_live;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refresh_dataset_stats_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_dataset_stats_cache() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT cron.schedule(
  'pyr-dataset-stats-refresh',
  '*/10 * * * *',
  $cmd$SET statement_timeout = '120s'; SET lock_timeout = '5s'; SELECT public.refresh_dataset_stats_cache();$cmd$
);


-- @@STEP 8: Other indexes (one statement per run)
-- 1c. Cell Library full load, paged by OFFSET in this order (src/store.ts:3871-3876):
--   proofreading_tasks?dataset=eq.X&order=priority.desc,created_at.asc,id.asc  (range 1000)
-- Today every page re-sorts the whole dataset (Retina 16k+ rows, 17 pages).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_dataset_order
  ON public.proofreading_tasks (dataset, priority DESC, created_at, id);

-- 1d. Cell Library delta sync (src/store.ts:3818-3822):
--   proofreading_tasks?dataset=eq.X&updated_at=gte.T&order=updated_at.asc&limit=1000
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_dataset_updated
  ON public.proofreading_tasks (dataset, updated_at);

-- 1e. Claim bookkeeping. pilot_task_action (supabase-pilot-access.sql:66-71):
--   task_assignments WHERE task_id = ? AND user_id = ? AND status = 'active'
-- expire_stale_assignments (supabase-pilot-access.sql:105-115): two EXISTS on
--   task_assignments (task_id, user_id, status) per claimed task. Today that
--   scans every assignment row ever written (no index has task_id first).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignments_task_user_status
  ON public.task_assignments (task_id, user_id, status);

-- 1f. Help requests by player (dataset_contribution.ts:145 count by user_id + dataset;
-- functions/index.js:1807 help_requests?user_id=eq.X&limit=1).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_help_user_dataset
  ON public.help_requests (user_id, dataset);

-- 1g. Issue tags list (src/store.ts:2670-2673): order created_at desc limit 1000.
-- The existing (status, created_at) index can not serve an unfiltered order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_tags_created
  ON public.issue_tags (created_at DESC);

-- Deliberately NOT indexed: chat_presence.last_seen_at. The row is updated every
-- 60 s per chatting player; an index on the updated column stops HOT updates.
-- The table has one row per player, a seq scan is cheaper.

-- @@STEP 9: Realtime: stop decoding tables nobody subscribes to
-- ============================================================================
-- Step 9. Realtime publication (may run in a transaction)
-- Every change to a published table is decoded from WAL by Realtime's slot,
-- and for each open subscription on it Realtime runs an RLS check inside
-- Postgres. Live client subscriptions (src/store.ts): help_requests,
-- issue_tags, working_links, activity_feed, chat_messages, chat_reactions,
-- chat_presence, edit_log. Published but never subscribed: proofreading_tasks,
-- task_assignments (supabase-schema.sql:212-213), notifications
-- (supabase-admin-schema.sql:142; the client polls it), help_responses
-- (supabase-help-responses-schema.sql:105). Before running, confirm no other
-- client of this project (Admin Hub, scripts) subscribes to these four.
-- ============================================================================
BEGIN;
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proofreading_tasks', 'task_assignments', 'notifications', 'help_responses'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $do$;
COMMIT;

-- @@STEP 10: Checks
-- ============================================================================
-- Step 10. Verification
-- ============================================================================
-- Cache matches the live rule (expect 0 rows right after a refresh, give or
-- take activity in between):
SELECT c.id FROM public.leaderboard_cache c JOIN public.user_edit_counts_live l USING (id)
WHERE (c.edits_24h, c.edits_week, c.edits_alltime, c.completions_24h, c.completions_week, c.completions_alltime)
  IS DISTINCT FROM (l.edits_24h, l.edits_week, l.edits_alltime, l.completions_24h, l.completions_week, l.completions_alltime);
-- The board still returns the same players (compare with the count before Step 5):
SELECT count(*) FROM public.leaderboard_board;
-- Cron runs and how long they take:
SELECT status, start_time, end_time - start_time AS took, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'pyr-leaderboard-cache-refresh')
ORDER BY start_time DESC LIMIT 10;
-- Step 4 took effect: expect an Index Scan on idx_editlog_completions_user_ts,
-- not a Seq Scan on edit_log (use a real player id):
-- EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM public.ew_cell_completions WHERE user_id = '<uuid>';
-- Step 4 changed no number (run once before Step 4 and once after; same count):
SELECT count(*) AS cells_counted FROM public.ew_cell_completions;
-- API roles can not run the live view; they can read the cached one:
SELECT has_table_privilege('anon', 'public.user_edit_counts_live', 'SELECT') AS anon_live,   -- false
       has_table_privilege('anon', 'public.user_edit_counts', 'SELECT')      AS anon_board;  -- true
-- Step 2: no function still calls pg_timezone_names (expect 0 rows):
SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%pg_timezone_names%';

-- Step 6: hours add up to the log (expect 0 rows)
SELECT l.user_id FROM (SELECT user_id, count(*) n FROM public.edit_log
  WHERE user_id IS NOT NULL AND operation IN ('merge','split') AND success IS NOT FALSE GROUP BY 1) l
FULL JOIN (SELECT user_id, sum(merges + splits) n FROM public.ew_user_edit_hours GROUP BY 1) h USING (user_id)
WHERE l.n IS DISTINCT FROM h.n;
-- Step 7: stored dataset progress equals the live count (expect 0 rows right after a refresh)
(SELECT * FROM public.ew_dataset_progress_live EXCEPT SELECT * FROM public.ew_dataset_progress_cache)
UNION ALL (SELECT * FROM public.ew_dataset_progress_cache EXCEPT SELECT * FROM public.ew_dataset_progress_live);

-- @@ROLLBACK (run only the block for the step you undo)
-- ============================================================================
-- Rollback. ROLLBACK (independent blocks; run only what you undo)
-- ============================================================================

-- Step 5: leaderboard cache -> live views exactly as before
-- SELECT cron.unschedule('pyr-leaderboard-cache-refresh');
-- SELECT cron.unschedule('pyr-cron-history-trim');
-- SELECT cron.unschedule('pyr-tz-names-sync');
-- BEGIN;
-- DROP VIEW public.user_edit_counts;                                   -- the thin view
-- ALTER VIEW public.user_edit_counts_live RENAME TO user_edit_counts;
-- GRANT SELECT ON public.user_edit_counts TO anon, authenticated;
-- CREATE OR REPLACE VIEW public.leaderboard_board WITH (security_invoker = false) AS
-- WITH ranked AS (
--   SELECT u.*,
--          row_number() OVER (ORDER BY u.edits_alltime       DESC NULLS LAST, u.id) AS r_edits_alltime,
--          row_number() OVER (ORDER BY u.edits_week          DESC NULLS LAST, u.id) AS r_edits_week,
--          row_number() OVER (ORDER BY u.edits_24h           DESC NULLS LAST, u.id) AS r_edits_24h,
--          row_number() OVER (ORDER BY u.completions_alltime DESC NULLS LAST, u.id) AS r_completions_alltime,
--          row_number() OVER (ORDER BY u.completions_week    DESC NULLS LAST, u.id) AS r_completions_week,
--          row_number() OVER (ORDER BY u.completions_24h     DESC NULLS LAST, u.id) AS r_completions_24h
--   FROM user_edit_counts u
-- )
-- SELECT id, display_name, flag, bio,
--        total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak,
--        edits_24h, edits_week, edits_alltime, completions_24h, completions_week, completions_alltime
-- FROM ranked
-- WHERE r_edits_alltime <= 50 OR r_edits_week <= 50 OR r_edits_24h <= 50
--    OR r_completions_alltime <= 50 OR r_completions_week <= 50 OR r_completions_24h <= 50;
-- GRANT SELECT ON public.leaderboard_board TO anon, authenticated;
-- DROP FUNCTION public.refresh_leaderboard_cache();
-- DROP MATERIALIZED VIEW public.leaderboard_cache;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;

-- Step 4: completed-cell views: re-run supabase-completions-same-cell.sql lines 49-113
--     unchanged (same columns, so CREATE OR REPLACE works).

-- Step 2: time zones: re-run ew_touch_streak from supabase-days-need-action.sql
--     (lines 25-112), then ew_log_activity / ew_count_day from
--     supabase-days-more-actions.sql (lines 32-159). Then:
-- DROP TABLE public.ew_tz_names;

-- Step 9: Realtime publication:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.proofreading_tasks, public.task_assignments,
--   public.notifications, public.help_responses;

-- Step 6: each player's edits by hour
-- DROP TRIGGER IF EXISTS ew_edit_hours_track ON public.edit_log;
-- DROP FUNCTION IF EXISTS public.ew_edit_hours_track();
-- DROP TABLE IF EXISTS public.ew_user_edit_hours;
-- (The site falls back to reading edit_log when this table is missing.)

-- Step 7: Dataset Stats cache
-- SELECT cron.unschedule('pyr-dataset-stats-refresh');
-- BEGIN;
-- DROP VIEW public.ew_dataset_progress, public.ew_dataset_weekly, public.ew_dataset_types,
--   public.ew_dataset_people, public.ew_dataset_work;
-- ALTER VIEW public.ew_dataset_progress_live RENAME TO ew_dataset_progress;
-- ALTER VIEW public.ew_dataset_weekly_live   RENAME TO ew_dataset_weekly;
-- ALTER VIEW public.ew_dataset_types_live    RENAME TO ew_dataset_types;
-- ALTER VIEW public.ew_dataset_people_live   RENAME TO ew_dataset_people;
-- ALTER VIEW public.ew_dataset_work_live     RENAME TO ew_dataset_work;
-- GRANT SELECT ON public.ew_dataset_progress, public.ew_dataset_weekly, public.ew_dataset_types,
--   public.ew_dataset_people, public.ew_dataset_work TO anon, authenticated;
-- DROP FUNCTION public.refresh_dataset_stats_cache();
-- DROP TABLE public.ew_dataset_progress_cache, public.ew_dataset_weekly_cache, public.ew_dataset_types_cache,
--   public.ew_dataset_people_cache, public.ew_dataset_work_cache;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;

-- Steps 3 and 8: indexes (one at a time, outside a transaction):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_editlog_completions_user_ts;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_editlog_edits_user_ts;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_tasks_dataset_order;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_tasks_dataset_updated;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_assignments_task_user_status;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_help_user_dataset;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_issue_tags_created;