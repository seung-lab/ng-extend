-- ============================================================================
-- Lost Fragments answers (Ames 2026-11-19: "a special lost fragment tag in
-- our cave table, and backup in supabase", "go for the new tables").
--
-- One row per player and fragment; Submit again updates it. The record in
-- CAVE is a point in eyewire_ii_cell_status_v2 tagged 'lost_fragment' at the
-- player's point (cave_annotation_id below). The server also copies each row
-- to the researchers' sheet, "Pyr Lost Fragments results" (sheet_row).
-- Each fragment counts as a completed cell (Ames 2026-11-19).
--
-- Written and read only by the EyeWire II server (service role): RLS on,
-- no policy, nothing for the public key.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ew_lost_fragments (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL,
  fragment_id        text NOT NULL,          -- the ID in the lab's list
  group_key          text NOT NULL CHECK (group_key IN ('large', 'smaller', 'glia', 'soma')),
  root_id            text,                   -- the segment after the player's edits
  lab_flag           text NOT NULL DEFAULT '',
  lab_um3            numeric,
  fixed              boolean NOT NULL DEFAULT false,
  ends               boolean NOT NULL DEFAULT false,
  point_in           text NOT NULL CHECK (point_in IN ('dendrite', 'soma')),
  pt                 integer[] NOT NULL CHECK (array_length(pt, 1) = 3),  -- voxels, 16 x 16 x 40 nm
  nucleus_id         text NOT NULL DEFAULT '',
  no_nucleus         boolean NOT NULL DEFAULT false,
  merges             integer,
  cuts               integer,
  um3_added          numeric,
  um3_removed        numeric,
  note               text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  cave_annotation_id bigint,
  sheet_row          integer,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fragment_id)
);
CREATE INDEX IF NOT EXISTS ew_lost_fragments_fragment ON public.ew_lost_fragments (fragment_id);
ALTER TABLE public.ew_lost_fragments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ew_lost_fragments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ew_lost_fragments_id_seq FROM PUBLIC, anon, authenticated;

COMMIT;
