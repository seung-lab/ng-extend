-- Datasets Unlocked: a player's own order of their emblems (Ames 2026-11-20:
-- "Let players drag to reorder"). Run this BEFORE deploying the
-- ewCommunityData function that reads it: every profile read lists it.
-- A list of dataset ids, the player's own to set (checked by the server),
-- public to read like trophy_order.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dataset_order JSONB NOT NULL DEFAULT '[]'::jsonb;
