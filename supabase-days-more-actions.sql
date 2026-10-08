-- ============================================================================
-- More actions make a day (Ames 2026-10-08).
--
-- Until now a day, for BOTH the streak and total days (the Loyalty
-- achievements), was counted only for a merge, a split or a completed cell
-- (supabase-days-need-action.sql). Ames: "annotation should count. claiming a
-- cell should count. help should count." and, asked, typing a cell too.
--
-- A day is now counted for:
--     merge, split                  an edit
--     complete_task, mark_complete  a completed cell
--     claim_task                    claiming a cell
--     set_cell_type                 typing a cell
--     annotate                      annotating (the hourly tally row)
--     asking for help               a new row in help_requests
--     answering a help request      a new row in help_responses
-- Still not a day: a visit, a release, a chat message (Ames: "not now").
--
-- FROM NOW ON ONLY (Ames: "only moving forward"). Nothing here looks back:
-- no player's total changes when this is run, and the one time recount in
-- ew_touch_streak is left exactly as it was.
--
-- Known and accepted: a claim, a cell type and an annotation tally are
-- reported by the browser and are not checked against CAVE, so these days
-- are easier to collect than an edit. That is the trade Ames chose.
--
-- Requires supabase-days-need-action.sql (it defines the function replaced
-- here; the only change to it is the list of actions). Run in the Supabase
-- SQL editor. Safe to re-run.
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.ew_log_activity(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_log_activity(UUID, JSONB) TO service_role;

-- Help is not in the activity log, so its day is counted where the row lands.
-- The same rule as ew_log_activity: the first counted action of the player's
-- own calendar day adds one to total_days and moves the streak; later ones
-- that day add nothing. Never backwards.
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
    (SELECT z.name FROM pg_catalog.pg_timezone_names z WHERE z.name = u.tz), 'UTC'))::DATE;
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

REVOKE ALL ON FUNCTION public.ew_count_day(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_count_day(UUID) TO service_role;

-- Counting a day must never stop a help request or an answer from saving.
CREATE OR REPLACE FUNCTION public.ew_help_counts_a_day()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    PERFORM public.ew_count_day(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ew_help_counts_a_day: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ew_help_counts_a_day() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ew_help_request_counts_a_day ON public.help_requests;
CREATE TRIGGER ew_help_request_counts_a_day AFTER INSERT ON public.help_requests
  FOR EACH ROW EXECUTE FUNCTION public.ew_help_counts_a_day();

DROP TRIGGER IF EXISTS ew_help_response_counts_a_day ON public.help_responses;
CREATE TRIGGER ew_help_response_counts_a_day AFTER INSERT ON public.help_responses
  FOR EACH ROW EXECUTE FUNCTION public.ew_help_counts_a_day();

-- Check: five rows.
--   the three functions: public_can false
--   the two triggers:    present true
SELECT p.proname::TEXT AS what,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS public_can,
       NULL::BOOLEAN AS present
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('ew_log_activity', 'ew_count_day', 'ew_help_counts_a_day')
UNION ALL
SELECT t.tgname::TEXT, NULL, TRUE
FROM pg_trigger t WHERE t.tgname IN ('ew_help_request_counts_a_day', 'ew_help_response_counts_a_day')
ORDER BY 1;
