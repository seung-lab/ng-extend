-- Remove the edits the old on-screen watcher counted by mistake
-- (Ames 2026-10-10).
--
-- From 2026-10-05 17:28 UTC the game counts a split or merge when the graph
-- server confirms it, and stores the server's operation id (op_key). An older
-- watcher, which guessed at an edit from the number of cells on screen, was
-- meant to stand down and did not always: it logged second copies of real
-- edits, and "edits" that were only a cell added to or taken out of the view
-- while a tool was open. The app stopped it on 2026-10-10 (commit cd987b4).
-- This removes what it had already logged.
--
-- A row is removed only when ALL of these hold:
--   * it is a split or merge with no operation id, written by the watcher
--     (its metadata carries net_segment_change);
--   * it is from after the first confirmed edit ever logged;
--   * the same player has a CONFIRMED edit within 30 minutes of it, which
--     shows their game was already using the new counting, so the watcher's
--     row is extra. (A watcher row with no confirmed edit near it may be from
--     a browser tab still on the old version, where the watcher was the only
--     counter. Those are kept: 5 rows on 2026-10-10.)
--
-- Checked against the live log on 2026-10-10: 333 rows, 323 of them one
-- player's; no player drops back below an achievement.
--
-- Nothing is destroyed: the rows are moved to edit_log_removed_20261010.
-- To undo, see the end of this file.

-- ── 1. LOOK FIRST (changes nothing) ─────────────────────────────────────────
WITH first_ack AS (
  SELECT min("timestamp") AS t FROM public.edit_log WHERE op_key IS NOT NULL
), bad AS (
  SELECT e.id, e.user_id, e.operation
  FROM public.edit_log e, first_ack f
  WHERE e.operation IN ('split', 'merge')
    AND e.op_key IS NULL
    AND e.metadata ? 'net_segment_change'
    AND e."timestamp" >= f.t
    AND EXISTS (
      SELECT 1 FROM public.edit_log k
      WHERE k.user_id = e.user_id AND k.op_key IS NOT NULL
        AND k.operation IN ('split', 'merge')
        AND k."timestamp" BETWEEN e."timestamp" - INTERVAL '30 minutes'
                              AND e."timestamp" + INTERVAL '30 minutes')
)
SELECT u.display_name,
       count(*)                                        AS rows_to_remove,
       count(*) FILTER (WHERE b.operation = 'merge')   AS merges,
       count(*) FILTER (WHERE b.operation = 'split')   AS splits,
       u.total_edits                                   AS total_edits_now,
       u.total_edits - count(*)                        AS total_edits_after
FROM bad b JOIN public.users u ON u.id = b.user_id
GROUP BY u.id, u.display_name, u.total_edits
ORDER BY rows_to_remove DESC;

-- ── 2. REMOVE THEM (run after the numbers above look right) ─────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS public.edit_log_removed_20261010 (LIKE public.edit_log);
-- Kept private: row level security on, and no policy, so only the service
-- role and the SQL editor can read it.
ALTER TABLE public.edit_log_removed_20261010 ENABLE ROW LEVEL SECURITY;

WITH first_ack AS (
  SELECT min("timestamp") AS t FROM public.edit_log WHERE op_key IS NOT NULL
), bad AS (
  SELECT e.id
  FROM public.edit_log e, first_ack f
  WHERE e.operation IN ('split', 'merge')
    AND e.op_key IS NULL
    AND e.metadata ? 'net_segment_change'
    AND e."timestamp" >= f.t
    AND EXISTS (
      SELECT 1 FROM public.edit_log k
      WHERE k.user_id = e.user_id AND k.op_key IS NOT NULL
        AND k.operation IN ('split', 'merge')
        AND k."timestamp" BETWEEN e."timestamp" - INTERVAL '30 minutes'
                              AND e."timestamp" + INTERVAL '30 minutes')
), moved AS (
  DELETE FROM public.edit_log e USING bad b WHERE e.id = b.id RETURNING e.*
), saved AS (
  INSERT INTO public.edit_log_removed_20261010 SELECT * FROM moved
  RETURNING user_id, operation, success
), per AS (
  -- only rows that had been counted (a failed edit never moved a total)
  SELECT user_id,
         count(*) FILTER (WHERE success IS NOT FALSE)                         AS n,
         count(*) FILTER (WHERE success IS NOT FALSE AND operation = 'merge') AS merges,
         count(*) FILTER (WHERE success IS NOT FALSE AND operation = 'split') AS splits
  FROM saved GROUP BY user_id
)
UPDATE public.users u SET
  total_edits  = GREATEST(0, COALESCE(u.total_edits, 0)  - per.n),
  total_merges = GREATEST(0, COALESCE(u.total_merges, 0) - per.merges),
  total_splits = GREATEST(0, COALESCE(u.total_splits, 0) - per.splits),
  updated_at   = NOW()
FROM per WHERE u.id = per.user_id;

-- What was moved, per player. Compare with step 1 before committing.
SELECT u.display_name, count(*) AS rows_removed, u.total_edits AS total_edits_now
FROM public.edit_log_removed_20261010 r JOIN public.users u ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.total_edits ORDER BY rows_removed DESC;

COMMIT;

-- ── TO UNDO ─────────────────────────────────────────────────────────────────
-- BEGIN;
-- WITH back AS (
--   INSERT INTO public.edit_log SELECT * FROM public.edit_log_removed_20261010
--   RETURNING user_id, operation, success
-- ), per AS (
--   SELECT user_id,
--          count(*) FILTER (WHERE success IS NOT FALSE) AS n,
--          count(*) FILTER (WHERE success IS NOT FALSE AND operation = 'merge') AS merges,
--          count(*) FILTER (WHERE success IS NOT FALSE AND operation = 'split') AS splits
--   FROM back GROUP BY user_id
-- )
-- UPDATE public.users u SET
--   total_edits  = COALESCE(u.total_edits, 0)  + per.n,
--   total_merges = COALESCE(u.total_merges, 0) + per.merges,
--   total_splits = COALESCE(u.total_splits, 0) + per.splits
-- FROM per WHERE u.id = per.user_id;
-- DELETE FROM public.edit_log_removed_20261010;
-- COMMIT;
