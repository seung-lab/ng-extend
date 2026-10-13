-- Which dataset each person in chat has open, shown beside their name in the
-- online list (Krzysztof Kruk 2026-10-11). One text column on the row the
-- heartbeat already writes: no new table, no new request. Safe to re-run.
--
-- Order: run this, then deploy the ewCommunityData function, then the site.
-- The site works in any order: until all three are in place it simply shows
-- the names without a dataset.

alter table chat_presence add column if not exists dataset text;
