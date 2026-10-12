-- The lab's retina sheet, mirrored for the Delta menu.
--
-- The sheet where the retina proofreadings and annotations live
-- (1o4i53h92oyzsBc8jEWKmF8ZnfyXKXtFCTaYSecs8tBk, gid 1690313708) is 13 MB and
-- 28,000 rows, so browsers never download it. scripts/sync-retina-lab-sheet.mjs
-- copies the columns below into this table once an hour, and the Delta menu
-- asks for the one row of the cell it is open on (src/util/lab_sheet.ts).
--
-- READ ONLY, both ways: the game never writes to that sheet, and players can
-- only read this table. Only the sync (service role) writes it.
--
-- Information only. Nothing here feeds a player's stats, the leaderboard,
-- Achievements or a cell's completion in the game. Do not join this table
-- into ew_cell_completions or any view a player number is read from.
--
-- No names and no free text notes are mirrored: this table is readable by
-- anyone with the public key, so a column is added here only once Ames has
-- said players may see it.
--
-- Safe to re-run. Changes no existing table.

CREATE TABLE IF NOT EXISTS public.ew_retina_lab_sheet (
  sheet_index          text PRIMARY KEY,   -- the sheet's Index, e.g. "A4"
  soma_supervoxel_id   text,               -- stable through edits
  latest_seg_id        text,               -- the cell's ID on the sheet's last ID refresh
  proofread_seg_id     text,               -- the cell's ID when it was proofread
  status               text,
  cell_class           text,
  cell_type            text,
  cell_type_machine    text,
  cell_type_confidence text,
  ew2_type             text,
  type_guess           text,               -- Proofreader Cell Type Guess
  synced_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ew_retina_lab_sheet_latest_idx ON public.ew_retina_lab_sheet (latest_seg_id);
CREATE INDEX IF NOT EXISTS ew_retina_lab_sheet_proofread_idx ON public.ew_retina_lab_sheet (proofread_seg_id);

ALTER TABLE public.ew_retina_lab_sheet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ew_retina_lab_sheet_read ON public.ew_retina_lab_sheet;
CREATE POLICY ew_retina_lab_sheet_read ON public.ew_retina_lab_sheet FOR SELECT USING (true);
REVOKE ALL ON public.ew_retina_lab_sheet FROM anon, authenticated;
GRANT SELECT ON public.ew_retina_lab_sheet TO anon, authenticated;
GRANT ALL ON public.ew_retina_lab_sheet TO service_role;

-- The rows whose cell ID is one of `ids`: the cell on screen and every ID it
-- has had (its lineage can run to thousands of IDs, too many for a URL, so
-- they arrive in the request body). Reads only; runs with the caller's rights.
CREATE OR REPLACE FUNCTION public.ew_retina_lab_sheet_match(ids text[])
RETURNS SETOF public.ew_retina_lab_sheet
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM public.ew_retina_lab_sheet WHERE latest_seg_id = ANY (ids)
  UNION
  SELECT * FROM public.ew_retina_lab_sheet WHERE proofread_seg_id = ANY (ids)
  LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.ew_retina_lab_sheet_match(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ew_retina_lab_sheet_match(text[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
