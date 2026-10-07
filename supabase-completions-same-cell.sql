-- ============================================================================
-- A cell completed again after an edit is the same cell (Nseraf, 2026-10-07).
--
-- Outside the Cell Library a completed cell was its root id. Any edit gives a
-- cell a new root id, so completing it again counted as another cell.
--
-- Now, when a player marks a root id they have not marked before, the server
-- asks the graph server where that root came from (functions/activity.js).
-- If it is a later version of a cell the same player already completed, the
-- server writes that cell on the new log row (metadata.same_cell_as), and the
-- rule below counts the two as one cell.
--
-- "A later version" means: every root id the player logged for the earlier
-- cell is an ancestor of the new one. So a cell that was trimmed or added to
-- is the same cell, while the second piece of a cell that was split in two is
-- a cell of its own.
--
-- What this file does NOT do: it changes no existing row and no saved total.
-- Old log rows carry no same_cell_as, so everything counted before today
-- stays exactly as it is. It only takes effect on marks made from now on.
-- Only datasets whose graph server the server may ask are covered (the
-- retina, not MEC yet); the others stay "by root id".
--
-- Needs supabase-leaderboard-accuracy.sql (already run). Run in the Supabase
-- SQL editor. Safe to re-run. Safe to run before or after the server deploy.
--
-- Contents
--   1. ew_cell_marks          every completion row with the cell it belongs to
--   2. ew_cell_completions    the completed-cell rule, same columns as before
--   3. ew_completion_roots    what the server reads before asking the graph
-- ============================================================================

-- ── 1. Every completion row, with its cell ──────────────────────────────────
-- What is one cell (identity is per player AND per dataset):
--   a. A Cell Library completion ('complete_task' with its final root id) is
--      its task. The task is the cell: it stays the same cell when an edit
--      changes the root id.
--   b. A root id that a task was completed with belongs to that task, so the
--      'mark_complete' logged a second before or after is the same cell.
--   c. A root id the server found to be a later version of a cell the player
--      already completed (same_cell_as on a 'mark_complete' row) belongs to
--      that cell, on every row that carries it.
--   d. Any other mark is its root id.
--   e. A row with no root id is the echo of a completion that has one, when
--      the same player logged one on the same dataset within two minutes,
--      and is not counted again. Otherwise it is its task, and with no task
--      either it is its own cell, keyed by the minute. Approximate by
--      nature: these are older rows, new ones always carry an id.
CREATE OR REPLACE VIEW public.ew_cell_marks WITH (security_invoker = true) AS
WITH ev AS (
  SELECT l.id, l.user_id, public.ew_dataset_key(l.dataset) AS dataset,
         l.timestamp AS ts, l.operation, l.task_id,
         NULLIF(COALESCE(l.metadata->>'final_segment_id', l.metadata->>'root_id', l.metadata->>'segment_id'), '') AS rid,
         CASE WHEN l.operation = 'mark_complete' THEN NULLIF(l.metadata->>'same_cell_as', '') END AS same
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
same_roots AS (
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
WITH keyed AS (
  SELECT user_id, dataset, ts, operation, cell FROM public.ew_cell_marks
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

-- ── 3. What the server reads before asking the graph server ─────────────────
-- Every root id one player has completed on one dataset, with the cell it
-- belongs to and when it was first logged. Un-marked cells are included: a
-- cell that was un-marked, edited and marked again is still the same cell.
-- Called only by the EyeWire II server function (service role).
CREATE OR REPLACE FUNCTION public.ew_completion_roots(p_user UUID, p_dataset TEXT)
RETURNS TABLE (cell TEXT, rid TEXT, first_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.cell, m.rid, MIN(m.ts)
  FROM public.ew_cell_marks m
  WHERE m.user_id = p_user AND m.dataset = public.ew_dataset_key(p_dataset)
    AND m.operation <> 'unmark_complete' AND m.cell IS NOT NULL AND m.rid IS NOT NULL
  GROUP BY m.cell, m.rid
$$;

REVOKE ALL ON FUNCTION public.ew_completion_roots(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_completion_roots(UUID, TEXT) TO service_role;

-- Check: one row.
--   cells_counted          the same number as before this file was run
--                          (511 when it was written; it only grows with play)
--   marked_same_cell       0 until the server deploy is live, then it grows
--   public_can_read_roots  false
--   server_can_read_roots  true
SELECT (SELECT COUNT(*) FROM public.ew_cell_completions) AS cells_counted,
       (SELECT COUNT(*) FROM public.edit_log
         WHERE operation = 'mark_complete' AND metadata ? 'same_cell_as') AS marked_same_cell,
       has_function_privilege('anon', 'public.ew_completion_roots(uuid,text)', 'EXECUTE') AS public_can_read_roots,
       has_function_privilege('service_role', 'public.ew_completion_roots(uuid,text)', 'EXECUTE') AS server_can_read_roots;
