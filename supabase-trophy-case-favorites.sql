-- Trophy Case: bronze favorites and a player's own order of sections
-- (Ames 2026-10-09). Run this BEFORE deploying the ewCommunityData function
-- that reads these columns: every profile read lists them.
--
-- favorite_badges_bronze  up to ten achievement slugs, shown as a strip
--                         under the silver favorites
-- trophy_order            the order of the Trophy Case sections, a list of
--                         'cells', 'editor', 'loyalty', 'special'
-- Both are a player's own to set (checked by the server), and public to read,
-- like the gold and silver favorites.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS favorite_badges_bronze JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS trophy_order JSONB NOT NULL DEFAULT '[]'::jsonb;
