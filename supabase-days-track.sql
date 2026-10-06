-- ============================================================================
-- The Days track: total days a player has shown up (Ames 2026-10-06).
--
-- A streak resets after one missed day. Total days never resets, so it
-- rewards coming back after a holiday or a sick week. The profile shows it
-- beside the current and best streak, with a ladder of milestones:
--   2, 3, 5, 7, 14, 21, 28, 30, 40, 50, 60, 70, 80, 90, 100, then every 25,
--   with a big celebration at each 100 and each full year (365, 730, ...).
--
-- users.total_days moves by one whenever the player's own calendar day
-- advances, by a visit (ew_touch_streak) or by an edit (ew_log_activity): the
-- same test that moves the streak, so the two can not disagree. The first
-- time, it is counted from the player's whole activity log in their time zone.
-- Visits made before this ran were not recorded, so history counts the days
-- with activity only.
--
-- total_days is public, like the streak: it shows on a player's profile.
-- Both functions are the ones in supabase-streak-local-days.sql with the day
-- counter added. Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tz TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS streak_recounted_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS total_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS days_recounted_at TIMESTAMPTZ;
GRANT SELECT (total_days) ON public.users TO anon, authenticated;

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
  new_day        BOOLEAN;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown player'; END IF;

  -- Only a zone PostgreSQL knows; else the one already saved; else UTC.
  SELECT z.name INTO zone FROM pg_catalog.pg_timezone_names z WHERE z.name = p_tz;
  IF zone IS NULL THEN
    SELECT z.name INTO zone FROM pg_catalog.pg_timezone_names z WHERE z.name = u.tz;
  END IF;
  zone  := COALESCE(zone, 'UTC');
  today := (NOW() AT TIME ZONE zone)::DATE;

  before  := COALESCE(u.current_streak, 0);
  streak  := before;
  longest := COALESCE(u.longest_streak, 0);
  days_before := COALESCE(u.total_days, 0);
  total       := days_before;
  new_day     := u.last_edit_date IS NULL OR today > u.last_edit_date;

  -- Total days: every day the player has shown up, ever. It never
  -- resets. Counted once from the log (days with any successful activity
  -- other than annotating, the day already saved, and today), then one
  -- more for each new day.
  IF u.days_recounted_at IS NULL THEN
    SELECT COUNT(*)::INTEGER INTO total FROM (
      SELECT (e."timestamp" AT TIME ZONE zone)::DATE AS day
      FROM public.edit_log e
      WHERE e.user_id = p_user AND e.success IS NOT FALSE AND e.operation <> 'annotate'
      UNION SELECT today
      UNION SELECT u.last_edit_date WHERE u.last_edit_date IS NOT NULL AND u.last_edit_date <= today
    ) d;
    total := GREATEST(total, days_before);
    days_recounted := TRUE;
  ELSIF new_day THEN
    total := total + 1;
  END IF;

  IF u.streak_recounted_at IS NULL THEN
    -- First visit with a known zone: count the days again in that zone.
    -- A day is one with any successful activity other than annotating (the
    -- rule ew_log_activity uses), plus today, since a visit counts.
    WITH days AS (
      SELECT DISTINCT (e."timestamp" AT TIME ZONE zone)::DATE AS day
      FROM public.edit_log e
      WHERE e.user_id = p_user AND e.success IS NOT FALSE AND e.operation <> 'annotate'
      UNION
      SELECT today
    ), runs AS (
      SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::INTEGER AS grp FROM days
    ), sized AS (
      SELECT grp, COUNT(*)::INTEGER AS n, MAX(day) AS last_day FROM runs GROUP BY grp
    )
    SELECT COALESCE(MAX(n) FILTER (WHERE last_day = today), 1), COALESCE(MAX(n), 1)
      INTO run_now, run_max FROM sized;
    streak    := run_now;
    longest   := GREATEST(longest, run_max);
    recounted := TRUE;
  ELSIF u.last_edit_date IS NULL OR today > u.last_edit_date THEN
    streak  := CASE WHEN u.last_edit_date = today - 1 THEN streak + 1 ELSE 1 END;
    longest := GREATEST(longest, streak);
  END IF;

  UPDATE public.users SET
    tz                  = zone,
    current_streak      = streak,
    longest_streak      = longest,
    last_edit_date      = GREATEST(COALESCE(last_edit_date, today), today),
    streak_recounted_at = COALESCE(streak_recounted_at, NOW()),
    total_days          = total,
    days_recounted_at   = COALESCE(days_recounted_at, NOW())
  WHERE id = p_user;

  RETURN jsonb_build_object('current_streak', streak, 'longest_streak', longest,
    'last_edit_date', GREATEST(COALESCE(u.last_edit_date, today), today),
    'streak_before', before, 'recounted', recounted, 'tz', zone,
    'total_days', total, 'days_before', days_before, 'days_recounted', days_recounted);
END;
$$;

REVOKE ALL ON FUNCTION public.ew_touch_streak(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_touch_streak(UUID, TEXT) TO service_role;

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
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown player'; END IF;
  -- The player's own day, not UTC's (which ends at 8 pm in New York).
  today := (NOW() AT TIME ZONE COALESCE(
    (SELECT z.name FROM pg_catalog.pg_timezone_names z WHERE z.name = u.tz), 'UTC'))::DATE;

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

    -- Annotations never moved the streak; everything else a player does, does.
    -- Only ever forwards: a change of time zone can not reset a streak.
    IF op <> 'annotate' AND (u.last_edit_date IS NULL OR today > u.last_edit_date) THEN
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
      last_edit_date    = CASE WHEN op = 'annotate' THEN last_edit_date
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

REVOKE ALL ON FUNCTION public.ew_log_activity(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_log_activity(UUID, JSONB) TO service_role;

-- Check: four rows.
--   the two functions:  public_can false, server_can true
--   users.total_days:   public_can true  (it shows on profiles)
--   users.tz:           public_can false (a time zone stays private)
SELECT p.proname::TEXT AS what,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS public_can,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS server_can
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('ew_touch_streak', 'ew_log_activity')
UNION ALL
SELECT 'users.total_days (shown on profiles)',
       has_column_privilege('anon', 'public.users', 'total_days', 'SELECT'),
       has_column_privilege('service_role', 'public.users', 'total_days', 'SELECT')
UNION ALL
SELECT 'users.tz (a player''s time zone)',
       has_column_privilege('anon', 'public.users', 'tz', 'SELECT'),
       has_column_privilege('service_role', 'public.users', 'tz', 'SELECT')
ORDER BY 1;
