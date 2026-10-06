-- ============================================================================
-- Leaderboard accuracy (audit of 2026-10-05). ONE counting rule, used by the
-- board, the weekly podium, the weekly announcement and the server's counters.
--
-- These are counts of edits and completed cells. Not a scoring system.
--
-- What this file does NOT do: it changes no existing row. No total is reset,
-- no saved podium is rewritten, no log row is edited. It only (re)defines
-- functions and views, adds one nullable column, and adds one index.
-- Compare before and after with scripts/leaderboard-compare.mjs (read only).
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Contents
--   1. ew_dataset_key            one name per dataset
--   2. ew_cell_completions       THE completed-cell rule (view)
--   3. user_edit_counts          the board's view, on top of 2
--   4. ew_weekly_ranking         a completed UTC week, ranked, ties decided
--   5. snapshot_weekly_winners   the saved podium, on top of 4
--   6. edit_log.op_key           one row per real operation
--   7. ew_log_activity           the server records an event and moves the
--                                counters in one transaction
-- ============================================================================

-- ── 1. One name per dataset ─────────────────────────────────────────────────
-- Rows written before the app stamped the real dataset carry the retina's old
-- alias. Same mapping as supabase-canonicalize-dataset.sql.
CREATE OR REPLACE FUNCTION public.ew_dataset_key(d text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d IS NULL OR d IN ('eyewire_ii', 'eyewire_ii_retina') THEN 'stroeh_mouse_retina' ELSE d END
$$;

-- ── 2. The completed-cell rule ──────────────────────────────────────────────
-- One row per cell a player has completed and not un-marked, with the moment
-- it was completed. Every reader windows THIS, so a rule can never differ
-- between the board, the podium and the announcement again.
--
-- What is one cell (identity is per player AND per dataset):
--   a. A Cell Library completion ('complete_task' with its final root id) is
--      its task. The task is the cell: it stays the same cell when an edit
--      changes the root id.
--   b. A root id that a task was completed with belongs to that task, so the
--      'mark_complete' logged a second before or after is the same cell.
--   c. Any other mark is its root id. This is "distinct roots": outside the
--      Cell Library, a cell whose root id changed between two marks is two
--      roots, and the log cannot tell they are one biological cell.
--   d. A row with no root id is the echo of a completion that has one, when
--      the same player logged one on the same dataset within two minutes,
--      and is not counted again. Otherwise it is its task, and with no task
--      either it is its own cell, keyed by the minute. Approximate by
--      nature: these are older rows, new ones always carry an id.
--
-- When it was completed: the first mark, or, if it was ever un-marked, the
-- first mark after the last un-mark. Decided over the WHOLE log, before any
-- time window, so a cell first completed a month ago and marked again today
-- is not a new cell today. Failed operations never count.
CREATE OR REPLACE VIEW public.ew_cell_completions WITH (security_invoker = true) AS
WITH ev AS (
  SELECT l.id, l.user_id, public.ew_dataset_key(l.dataset) AS dataset,
         l.timestamp AS ts, l.operation, l.task_id,
         NULLIF(COALESCE(l.metadata->>'final_segment_id', l.metadata->>'root_id', l.metadata->>'segment_id'), '') AS rid
  FROM public.edit_log l
  WHERE l.user_id IS NOT NULL
    AND l.success IS NOT FALSE
    AND l.operation IN ('complete_task', 'mark_complete', 'unmark_complete')
),
task_roots AS (
  SELECT user_id, dataset, rid, MIN(task_id) AS task_id
  FROM ev
  WHERE operation = 'complete_task' AND task_id IS NOT NULL AND rid IS NOT NULL
  GROUP BY user_id, dataset, rid
),
keyed AS (
  SELECT e.user_id, e.dataset, e.ts, e.operation,
    CASE
      WHEN e.operation = 'complete_task' AND e.task_id IS NOT NULL AND e.rid IS NOT NULL THEN 'task:' || e.task_id
      WHEN e.rid IS NOT NULL THEN COALESCE('task:' || t.task_id, e.rid)
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
  LEFT JOIN task_roots t ON t.user_id = e.user_id AND t.dataset = e.dataset AND t.rid = e.rid
),
last_unmark AS (
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

-- ── 3. The board's view ─────────────────────────────────────────────────────
-- Same columns, same order as the live view, so the app needs no change.
-- Changed: the two recent Cells columns read the rule above, and the two
-- recent Edits columns leave out failed operations (the all-time counter
-- never counted them). All-time stays on the saved counters: nothing is
-- recomputed or reset. Two columns are ADDED at the end so the log's own
-- all-time numbers can be read beside the saved ones.
CREATE OR REPLACE VIEW public.user_edit_counts WITH (security_invoker = true) AS
SELECT
  u.id              AS id,
  u.display_name    AS display_name,
  u.flag            AS flag,
  u.bio             AS bio,
  u.total_edits     AS total_edits,
  u.total_merges    AS total_merges,
  u.total_splits    AS total_splits,
  u.cells_completed AS cells_completed,
  u.current_streak  AS current_streak,
  u.longest_streak  AS longest_streak,
  COALESCE(e.e24, 0)::INTEGER AS edits_24h,
  COALESCE(e.e7d, 0)::INTEGER AS edits_week,
  COALESCE(u.total_edits, 0)::INTEGER AS edits_alltime,
  COALESCE(c.c24, 0)::INTEGER AS completions_24h,
  COALESCE(c.c7d, 0)::INTEGER AS completions_week,
  COALESCE(u.cells_completed, 0)::INTEGER AS completions_alltime,
  COALESCE(e.eall, 0)::INTEGER AS edits_logged,
  COALESCE(c.call, 0)::INTEGER AS completions_logged
FROM public.users u
LEFT JOIN (
  SELECT user_id,
    COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS e24,
    COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days')   AS e7d,
    COUNT(*) AS eall
  FROM public.edit_log
  WHERE operation IN ('split', 'merge') AND success IS NOT FALSE
  GROUP BY user_id
) e ON e.user_id = u.id
LEFT JOIN (
  SELECT user_id,
    COUNT(*) FILTER (WHERE done_at >= NOW() - INTERVAL '24 hours') AS c24,
    COUNT(*) FILTER (WHERE done_at >= NOW() - INTERVAL '7 days')   AS c7d,
    COUNT(*) AS call
  FROM public.ew_cell_completions
  GROUP BY user_id
) c ON c.user_id = u.id;

-- ── 4. A completed week, ranked ─────────────────────────────────────────────
-- The week is Monday 00:00 UTC to the next Monday 00:00 UTC, whatever time
-- zone the caller's session is in. Default: the last completed week.
-- Ties: the player who reached the count FIRST ranks higher (their last
-- counted event is the earlier one); if that is equal too, the lower user id.
-- The same answer every time it is asked.
CREATE OR REPLACE FUNCTION public.ew_weekly_ranking(
    p_week_start DATE DEFAULT NULL,
    p_metric     TEXT DEFAULT 'edits',
    p_limit      INTEGER DEFAULT 20)
RETURNS TABLE (rank INTEGER, user_id UUID, count INTEGER, reached_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
  ws DATE := COALESCE(p_week_start, (date_trunc('week', (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'))::DATE);
  t0 TIMESTAMPTZ := (ws::TIMESTAMP) AT TIME ZONE 'UTC';
  t1 TIMESTAMPTZ := ((ws + 7)::TIMESTAMP) AT TIME ZONE 'UTC';
BEGIN
  IF p_metric NOT IN ('edits', 'completions') THEN
    RAISE EXCEPTION 'p_metric must be edits or completions, got %', p_metric;
  END IF;
  IF EXTRACT(ISODOW FROM ws) <> 1 THEN
    RAISE EXCEPTION 'p_week_start must be a Monday, got %', ws;
  END IF;
  RETURN QUERY
  WITH counted AS (
    SELECT el.user_id AS uid, COUNT(*)::INTEGER AS n, MAX(el.timestamp) AS reached
    FROM public.edit_log el
    WHERE p_metric = 'edits'
      AND el.timestamp >= t0 AND el.timestamp < t1
      AND el.operation IN ('split', 'merge') AND el.success IS NOT FALSE
      AND el.user_id IS NOT NULL
    GROUP BY el.user_id
    UNION ALL
    SELECT cc.user_id, COUNT(*)::INTEGER, MAX(cc.done_at)
    FROM public.ew_cell_completions cc
    WHERE p_metric = 'completions'
      AND cc.done_at >= t0 AND cc.done_at < t1
    GROUP BY cc.user_id
  )
  SELECT (ROW_NUMBER() OVER (ORDER BY c.n DESC, c.reached ASC, c.uid ASC))::INTEGER, c.uid, c.n, c.reached
  FROM counted c
  ORDER BY c.n DESC, c.reached ASC, c.uid ASC
  LIMIT GREATEST(COALESCE(p_limit, 20), 0);
END;
$$;

-- ── 5. The saved podium ─────────────────────────────────────────────────────
-- Same name, arguments and result as before, so the Monday job needs no
-- change. It now saves the top three of the ranking above, for both metrics.
-- ON CONFLICT DO NOTHING is kept on purpose: a podium that is already saved
-- is never overwritten by this function. Correcting a past week is a separate,
-- reviewed step (docs/LEADERBOARD-ACCURACY.md).
CREATE OR REPLACE FUNCTION public.snapshot_weekly_winners(
    target_week_start DATE DEFAULT NULL,
    target_metric     TEXT DEFAULT 'edits')
RETURNS TABLE (rank INTEGER, user_id UUID, edits INTEGER, metric TEXT)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  ws DATE := COALESCE(target_week_start, (date_trunc('week', (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'))::DATE);
  m  TEXT := COALESCE(target_metric, 'edits');
BEGIN
  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.weekly_winners (week_start, rank, user_id, edits, metric)
    SELECT ws, r.rank, r.user_id, r.count, m
    FROM public.ew_weekly_ranking(ws, m, 3) r
    ON CONFLICT (week_start, rank, metric) DO NOTHING
    RETURNING weekly_winners.rank, weekly_winners.user_id, weekly_winners.edits, weekly_winners.metric
  )
  SELECT inserted.rank, inserted.user_id, inserted.edits, inserted.metric FROM inserted;
END;
$$;

-- ── 6. One log row per real operation ───────────────────────────────────────
-- A split or merge is keyed by the operation id the graph server gave it; a
-- completion by an id made when the button was pressed. The same operation
-- reported twice (a retry, a second tab) is then one row and one count.
-- Old rows have no key and are left exactly as they are.
ALTER TABLE public.edit_log ADD COLUMN IF NOT EXISTS op_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_editlog_op_key
  ON public.edit_log (dataset, op_key) WHERE op_key IS NOT NULL;

-- ── 7. The server records an event and moves the counters together ─────────
-- Called only by the EyeWire II server function (service role), never by a
-- browser. One transaction: the log row and the counters either both change
-- or neither does. The player's row is locked first, so two tabs can not
-- read the same total and both write total + 1.
--
-- Counters move by what the log says, never by a number the browser sends:
--   split / merge     total_edits + 1 (and the matching subtotal), per row
--   completions       cells_completed moves by the change in the player's
--                     completed cells under rule 2 (so mark + complete_task of
--                     one cell is +1, a repeat mark is 0, an un-mark is -1)
--   annotate          total_annotations + metadata.count (1 to 500 per row)
--   streak            consecutive days with any logged activity, in the
--                     player's own time zone once it is known (users.tz,
--                     supabase-streak-local-days.sql); UTC until then
-- A duplicate op_key changes nothing and says so.
-- The player's time zone, for the streak's day (supabase-streak-local-days.sql).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tz TEXT;
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
    END IF;

    UPDATE public.users SET
      total_edits       = COALESCE(total_edits, 0) + d_edits,
      total_merges      = COALESCE(total_merges, 0) + CASE WHEN op = 'merge' THEN d_edits ELSE 0 END,
      total_splits      = COALESCE(total_splits, 0) + CASE WHEN op = 'split' THEN d_edits ELSE 0 END,
      cells_completed   = GREATEST(0, COALESCE(cells_completed, 0) + d_cells),
      total_annotations = COALESCE(total_annotations, 0) + d_ann,
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
      'streak_before', COALESCE(u.current_streak, 0), 'edits_before', COALESCE(u.total_edits, 0))
    FROM public.users n WHERE n.id = p_user);
END;
$$;

REVOKE ALL ON FUNCTION public.ew_log_activity(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_log_activity(UUID, JSONB) TO service_role;
