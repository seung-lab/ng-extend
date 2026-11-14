-- ============================================================================
-- MEC: Axon complete and Cell complete, told apart (Ames 2026-11-14)
--
-- A Cell Library completion chosen as "Axon complete" now carries
-- metadata.completion = 'axon' on its complete_task row (src/store.ts
-- completeTask). Both kinds still count as one completed cell (Ames: "Both
-- count"); this only adds a column saying which kind each cell is.
--
--   ew_cell_marks         + axon  (boolean, last column)
--   ew_cell_completions   + kind  ('axon' or 'cell', last column)
--
-- kind is 'axon' when every completion of the cell that counts (after its
-- last un-mark) was an Axon complete. Any whole-cell completion of the same
-- cell later (Mark as Proofread on it) makes it 'cell': upgraded, still one
-- cell. Completions from before this change have no marker and read 'cell'.
--
-- Everything else is the live text of supabase-db-load.sql Step 4 (NOT
-- MATERIALIZED CTEs), unchanged: same columns in the same order, then the new
-- one. CREATE OR REPLACE VIEW may only add columns at the end, which is all
-- this does, so the leaderboard cache and every reader keep working.
-- The same rule in the app: src/util/completion_rule.ts (kind). Tested in
-- functions/mec-axon-complete.test.js. Safe to run more than once.
-- ============================================================================
BEGIN;
CREATE OR REPLACE VIEW public.ew_cell_marks WITH (security_invoker = true) AS
WITH ev AS NOT MATERIALIZED (
  SELECT l.id, l.user_id, public.ew_dataset_key(l.dataset) AS dataset,
         l.timestamp AS ts, l.operation, l.task_id,
         NULLIF(COALESCE(l.metadata->>'final_segment_id', l.metadata->>'root_id', l.metadata->>'segment_id'), '') AS rid,
         CASE WHEN l.operation = 'mark_complete' THEN NULLIF(l.metadata->>'same_cell_as', '') END AS same,
         COALESCE(l.metadata->>'completion', '') = 'axon' AS axon
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
  END AS cell,
  e.axon
FROM ev e
LEFT JOIN task_roots t  ON t.user_id = e.user_id AND t.dataset = e.dataset AND t.rid = e.rid
LEFT JOIN same_roots s  ON s.user_id = e.user_id AND s.dataset = e.dataset AND s.rid = e.rid
LEFT JOIN task_roots st ON st.user_id = e.user_id AND st.dataset = e.dataset AND st.rid = s.cell;

CREATE OR REPLACE VIEW public.ew_cell_completions WITH (security_invoker = true) AS
WITH keyed AS NOT MATERIALIZED (
  SELECT user_id, dataset, ts, operation, cell, axon FROM public.ew_cell_marks
),
last_unmark AS NOT MATERIALIZED (
  SELECT user_id, dataset, cell, MAX(ts) AS at
  FROM keyed WHERE operation = 'unmark_complete' AND cell IS NOT NULL
  GROUP BY user_id, dataset, cell
)
SELECT k.user_id, k.dataset, k.cell,
       MIN(k.ts) FILTER (WHERE u.at IS NULL OR k.ts > u.at) AS done_at,
       CASE WHEN bool_and(k.axon) FILTER (WHERE u.at IS NULL OR k.ts > u.at) THEN 'axon' ELSE 'cell' END AS kind
FROM keyed k
LEFT JOIN last_unmark u ON u.user_id = k.user_id AND u.dataset = k.dataset AND u.cell = k.cell
WHERE k.operation <> 'unmark_complete' AND k.cell IS NOT NULL
GROUP BY k.user_id, k.dataset, k.cell
HAVING MIN(k.ts) FILTER (WHERE u.at IS NULL OR k.ts > u.at) IS NOT NULL;
COMMIT;

-- Check: every cell still counted once, and how many are axons.
SELECT count(*) AS cells_counted,
       count(*) FILTER (WHERE kind = 'axon') AS axon_complete
FROM public.ew_cell_completions;
