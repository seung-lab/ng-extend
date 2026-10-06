-- Dataset progress: how far along each dataset is, as a whole.
--
-- Read by the Dataset Progress panel (src/components/DatasetStatsPanel.vue,
-- through src/util/dataset_stats.ts). Every number on that panel comes from
-- one of the views below, so a figure and its bar can never disagree.
--
-- Safe to re-run. Changes no existing row: it adds one table (the sheet
-- mirror, filled by scripts/sync-sheet-cells.mjs --mirror) and five views.
-- Needs supabase-leaderboard-accuracy.sql (for ew_dataset_key).
--
-- These are counts of cells and edits. Not a scoring system.

-- ── The Cell Library sheet's own record of each cell ──────────────────────
-- proofreading_tasks keeps what the game needs to hand a cell out. The sheet
-- the community works in also says when each cell was finished, by whom, and
-- which type the classifier predicted. Those three are mirrored here, one row
-- per sheet row, keyed the way tasks are (dataset and starting segment id).
CREATE TABLE IF NOT EXISTS public.ew_sheet_cells (
  dataset       text NOT NULL,
  segment_id    text NOT NULL,
  status        text,
  proofreader   text,
  date_complete date,
  cell_type     text,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset, segment_id)
);
ALTER TABLE public.ew_sheet_cells ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ew_sheet_cells_read ON public.ew_sheet_cells;
CREATE POLICY ew_sheet_cells_read ON public.ew_sheet_cells FOR SELECT USING (true);
GRANT SELECT ON public.ew_sheet_cells TO anon, authenticated;
GRANT ALL ON public.ew_sheet_cells TO service_role;

-- ── One row per cell in a dataset's list ──────────────────────────────────
-- state:
--   done       completed in the game, or marked Complete in the sheet
--   set_aside  skipped in the game, or "Can't Complete" / "Not BC" in the
--              sheet. Not part of the total: nobody is going to finish it.
--   claimed    someone has it
--   waiting    nobody has it yet
-- done_on: the sheet's Date Complete; else the day the game logged the
--   task's completion; else NULL. Never the task's updated_at, which for
--   cells imported as already complete is the day of the import.
CREATE OR REPLACE VIEW public.ew_dataset_cells WITH (security_invoker = true) AS
WITH logged AS (
  SELECT task_id, min(timestamp) AS at
  FROM public.edit_log
  WHERE operation = 'complete_task' AND task_id IS NOT NULL AND success IS NOT FALSE
  GROUP BY task_id
)
SELECT
  public.ew_dataset_key(t.dataset) AS dataset,
  t.id AS task_id,
  CASE
    WHEN t.status = 'completed' OR s.status ILIKE 'complete%' THEN 'done'
    WHEN t.status = 'skipped' OR s.status ~* '(can.?t complete|not bc|not a bc|skip)' THEN 'set_aside'
    WHEN t.status IN ('assigned', 'in_progress') THEN 'claimed'
    ELSE 'waiting'
  END AS state,
  COALESCE(s.date_complete, (l.at AT TIME ZONE 'UTC')::date) AS done_on,
  NULLIF(btrim(s.cell_type), '') AS cell_type,
  NULLIF(btrim(s.proofreader), '') AS proofreader
FROM public.proofreading_tasks t
LEFT JOIN public.ew_sheet_cells s
  ON s.dataset = public.ew_dataset_key(t.dataset) AND s.segment_id = t.segment_id
LEFT JOIN logged l ON l.task_id = t.id;

-- ── How far along each dataset is ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.ew_dataset_progress WITH (security_invoker = true) AS
SELECT
  dataset,
  count(*) FILTER (WHERE state = 'done')::int      AS cells_done,
  count(*) FILTER (WHERE state = 'claimed')::int   AS cells_claimed,
  count(*) FILTER (WHERE state = 'waiting')::int   AS cells_waiting,
  count(*) FILTER (WHERE state = 'set_aside')::int AS cells_set_aside,
  -- Done, but nothing says on which day: left out of the weekly chart.
  count(*) FILTER (WHERE state = 'done' AND done_on IS NULL)::int AS cells_done_undated
FROM public.ew_dataset_cells
GROUP BY dataset;

-- ── Cells finished and edits made, week by week (Monday to Monday) ────────
-- Cells go by the calendar day they were finished. Edits go by UTC.
CREATE OR REPLACE VIEW public.ew_dataset_weekly WITH (security_invoker = true) AS
WITH c AS (
  SELECT dataset, date_trunc('week', done_on::timestamp)::date AS week_start, count(*)::int AS cells_done
  FROM public.ew_dataset_cells
  WHERE state = 'done' AND done_on IS NOT NULL
  GROUP BY 1, 2
), e AS (
  SELECT public.ew_dataset_key(dataset) AS dataset,
         date_trunc('week', timestamp AT TIME ZONE 'UTC')::date AS week_start,
         count(*)::int AS edits
  FROM public.edit_log
  WHERE operation IN ('split', 'merge') AND success IS NOT FALSE
  GROUP BY 1, 2
)
SELECT COALESCE(c.dataset, e.dataset) AS dataset,
       COALESCE(c.week_start, e.week_start) AS week_start,
       COALESCE(c.cells_done, 0) AS cells_done,
       COALESCE(e.edits, 0) AS edits
FROM c FULL JOIN e ON e.dataset = c.dataset AND e.week_start = c.week_start;

-- ── Finished against left, by predicted cell type ─────────────────────────
-- cell_type is NULL for cells the sheet gives no type.
CREATE OR REPLACE VIEW public.ew_dataset_types WITH (security_invoker = true) AS
SELECT
  dataset,
  cell_type,
  count(*) FILTER (WHERE state = 'done')::int AS cells_done,
  count(*) FILTER (WHERE state IN ('claimed', 'waiting'))::int AS cells_left
FROM public.ew_dataset_cells
WHERE state <> 'set_aside'
GROUP BY dataset, cell_type;

-- ── Cells finished under each name in the list ────────────────────────────
-- The name is the sheet's Proofreader, which is the name the game writes
-- when a cell is completed in it.
CREATE OR REPLACE VIEW public.ew_dataset_people WITH (security_invoker = true) AS
SELECT dataset, proofreader, count(*)::int AS cells_done
FROM public.ew_dataset_cells
WHERE state = 'done' AND proofreader IS NOT NULL
GROUP BY dataset, proofreader;

-- ── Work logged in the game, per dataset and player ───────────────────────
-- One edit is one split or merge that went through (the board's rule).
-- Annotations are the tallies the game logs (metadata.count per row).
CREATE OR REPLACE VIEW public.ew_dataset_work WITH (security_invoker = true) AS
SELECT
  public.ew_dataset_key(dataset) AS dataset,
  user_id,
  count(*) FILTER (WHERE operation = 'split')::int AS splits,
  count(*) FILTER (WHERE operation = 'merge')::int AS merges,
  COALESCE(sum(CASE WHEN operation = 'annotate' AND metadata->>'count' ~ '^[0-9]{1,6}$'
                    THEN (metadata->>'count')::int ELSE 0 END), 0)::int AS annotations
FROM public.edit_log
WHERE operation IN ('split', 'merge', 'annotate') AND success IS NOT FALSE AND user_id IS NOT NULL
GROUP BY 1, 2;

GRANT SELECT ON public.ew_dataset_cells, public.ew_dataset_progress, public.ew_dataset_weekly,
  public.ew_dataset_types, public.ew_dataset_people, public.ew_dataset_work TO anon, authenticated;
