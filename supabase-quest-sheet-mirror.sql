-- ============================================================================
-- A copy of the Cilia Quest sheet tab, for the weekly champions broadcast
-- (Ames 2026-11-05: "let's do the quest champions stat in the weekly
-- notification").
--
-- The quest's record is the lab's sheet, which only the server can read
-- (ewSheetSync, functions/sheet-sync.js). Whenever the server reads the tab
-- for the game anyway (the quest list, at most every 10 minutes per server
-- instance, and right after a claim or a submit), it hands the rows to
-- ew_quest_mirror below. scripts/weekly-quests.mjs counts the week's quests
-- from this copy, with the same rule and dates as the leaderboard.
--
-- Only rows that changed are written; rows that left the sheet are removed.
-- Nothing here is readable with the public key (RLS on, no policy).
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ew_quest_sheet_rows (
  quest       text NOT NULL,          -- 'retina_cilia'
  segment_id  text NOT NULL,
  annotator   text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT '',
  quest_date  text NOT NULL DEFAULT '', -- the sheet's Date, M/D/YYYY (US Eastern day)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quest, segment_id)
);
ALTER TABLE public.ew_quest_sheet_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ew_quest_sheet_rows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ew_quest_sheet_rows TO service_role;

-- p_rows: [{segment_id, annotator, status, date}, ...], the whole tab.
CREATE OR REPLACE FUNCTION public.ew_quest_mirror(p_quest text, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE n integer := 0; d integer := 0;
BEGIN
  IF p_quest IS NULL OR p_quest !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'Bad quest'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'Bad rows'; END IF;
  -- An empty or broken read never wipes the copy.
  IF jsonb_array_length(p_rows) = 0 THEN RETURN 0; END IF;

  WITH src AS (
    SELECT DISTINCT ON (r->>'segment_id') r->>'segment_id' AS segment_id, left(coalesce(r->>'annotator', ''), 120) AS annotator,
           left(coalesce(r->>'status', ''), 120) AS status, left(coalesce(r->>'date', ''), 20) AS quest_date
    FROM jsonb_array_elements(p_rows) r
    WHERE coalesce(r->>'segment_id', '') ~ '^[0-9]{1,20}$'
  ), up AS (
    INSERT INTO public.ew_quest_sheet_rows AS t (quest, segment_id, annotator, status, quest_date)
    SELECT p_quest, segment_id, annotator, status, quest_date FROM src
    ON CONFLICT (quest, segment_id) DO UPDATE
      SET annotator = EXCLUDED.annotator, status = EXCLUDED.status, quest_date = EXCLUDED.quest_date, updated_at = now()
      WHERE (t.annotator, t.status, t.quest_date) IS DISTINCT FROM (EXCLUDED.annotator, EXCLUDED.status, EXCLUDED.quest_date)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM up;

  DELETE FROM public.ew_quest_sheet_rows t
  WHERE t.quest = p_quest
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>'segment_id' = t.segment_id);
  GET DIAGNOSTICS d = ROW_COUNT;
  RETURN n + d;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ew_quest_mirror(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_quest_mirror(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check (read only), after someone opens the Quests tab on the Retina:
-- SELECT count(*), count(*) FILTER (WHERE status <> '') AS with_status, max(updated_at) FROM public.ew_quest_sheet_rows;

-- Undo:
-- DROP FUNCTION public.ew_quest_mirror(text, jsonb);
-- DROP TABLE public.ew_quest_sheet_rows;
