-- The Access page (triage hub, "?triage=access", Ames 2026-11-09): where each
-- person is between asking for the beta and editing, with the time of each
-- step, worked out here so the page reads one small row per person.
-- Read only by admins, through ewCommunityData (functions/community-data.js);
-- no public read.
--
-- One row per email: everyone on Pilot testers and everyone who asked for
-- the beta. A Beta request is a site_issues row (category 'Beta access')
-- whose message holds the fields as lines ("Email: ...", "EyeWire username:
-- ...", functions/access-request.js); the newest request per email counts.
CREATE OR REPLACE VIEW public.access_hub_people AS
WITH req AS (
  SELECT DISTINCT ON (email) * FROM (
    SELECT
      rtrim(lower(coalesce(
        substring(message FROM 'Sign in email: ([^\s]+@[^\s]+)'),
        substring(message FROM '(?:^|\n)Email: ([^\s]+@[^\s]+)'),
        substring(message FROM 'Email they gave: ([^\s]+@[^\s]+)'))), '.') AS email,
      rtrim(lower(substring(message FROM 'Email they gave: ([^\s]+@[^\s]+)')), '.') AS gave_email,
      id AS request_id, user_id AS request_user_id, user_name AS request_name, created_at AS asked_at,
      (coalesce(url, '') || coalesce(title, '')) ~ 'connectome\.quest' AS from_site,
      nullif(trim(substring(message FROM 'EyeWire username: ([^\n]*)')), '') AS ew_name,
      nullif(trim(substring(message FROM 'EyeWire rank: ([^\n]*)')), '') AS ew_rank,
      nullif(trim(substring(message FROM 'How they found us: ([^\n]*)')), '') AS found_us,
      nullif(trim(substring(message FROM 'Their note: (.*)$')), '') AS their_note
    FROM public.site_issues i
    WHERE category = 'Beta access'
  ) r
  WHERE email IS NOT NULL
  ORDER BY email, asked_at DESC
),
pil AS (
  SELECT lower(email) AS email, enabled, created_at AS let_in_at,
    -- Added together with four or more others: one pasted list.
    count(*) OVER (PARTITION BY created_at) >= 5 AS from_list
  FROM public.pilot_members
),
-- Admins are their own step (Ames 2026-11-10: "show admins as Admin"),
-- listed even when they never asked and are not on Pilot testers.
adm AS (
  SELECT DISTINCT lower(coalesce(a.email, us.middleauth_email)) AS email
  FROM public.admins a LEFT JOIN public.users us ON us.id = a.user_id
  WHERE coalesce(a.email, us.middleauth_email) IS NOT NULL
),
who AS (
  SELECT email FROM req UNION SELECT email FROM pil UNION SELECT email FROM adm
),
usr AS (
  SELECT DISTINCT ON (lower(middleauth_email)) lower(middleauth_email) AS email, id, display_name, username, created_at, tutorial_active, last_edit_at
  FROM public.users WHERE middleauth_email IS NOT NULL
  ORDER BY lower(middleauth_email), created_at
),
tut AS (
  SELECT user_id, min(completed_at) AS tutorial_at, count(DISTINCT tutorial)::int AS tutorials FROM public.tutorial_completions GROUP BY user_id
),
ed AS (
  SELECT user_id, min(timestamp) AS first_edit_at, max(timestamp) AS last_edit_at, count(*)::int AS edits,
    (array_agg(dataset ORDER BY timestamp DESC))[1] AS last_dataset,
    count(*) FILTER (WHERE timestamp > now() - interval '30 days')::int AS edits_30d
  -- An edit is a merge or a cut, as the game counts them (total_merges +
  -- total_splits): not a claim, an annotation or marking a cell done.
  FROM public.edit_log WHERE operation IN ('merge', 'split') AND success IS NOT FALSE GROUP BY user_id
),
-- One person's stats, for the panel (Ames 2026-11-09: "shouldn't it show
-- stats for user and recent activity?"): all time and the last 30 days.
-- Cells done come from ew_cell_completions only: work done in the game.
-- Chat is a count only, never what they wrote (Ames: "chat counts are ok
-- just not chat messages"). Help: asked for (and answered), and given.
cc AS (
  SELECT user_id, count(*)::int AS cells, count(*) FILTER (WHERE done_at > now() - interval '30 days')::int AS cells_30d
  FROM public.ew_cell_completions GROUP BY user_id
),
ch AS (
  SELECT user_id, count(*)::int AS chats, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS chats_30d
  FROM public.chat_messages GROUP BY user_id
),
ha AS (
  SELECT user_id, count(*)::int AS help_asked, count(*) FILTER (WHERE resolved)::int AS help_answered_for,
    count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS help_asked_30d
  FROM public.help_requests GROUP BY user_id
),
hg AS (
  SELECT user_id, count(DISTINCT request_id)::int AS help_given,
    count(DISTINCT request_id) FILTER (WHERE created_at > now() - interval '30 days')::int AS help_given_30d
  FROM public.help_responses GROUP BY user_id
)
SELECT
  w.email,
  u.id AS user_id,
  coalesce(r.request_name, u.display_name, u.username) AS name,
  u.username,
  r.request_id, r.asked_at, r.from_site, r.gave_email,
  r.ew_name, r.ew_rank, r.found_us, r.their_note,
  p.enabled AS pilot_enabled, p.let_in_at, coalesce(p.from_list, false) AS from_list,
  u.created_at AS joined_at, u.tutorial_active,
  t.tutorial_at, coalesce(t.tutorials, 0) AS tutorials,
  e.first_edit_at, e.last_edit_at, coalesce(e.edits, 0) AS edits, e.last_dataset,
  coalesce(e.edits_30d, 0) AS edits_30d, coalesce(c.cells, 0) AS cells, coalesce(c.cells_30d, 0) AS cells_30d,
  coalesce(m.chats, 0) AS chats, coalesce(m.chats_30d, 0) AS chats_30d,
  coalesce(ha.help_asked, 0) AS help_asked, coalesce(ha.help_answered_for, 0) AS help_answered_for, coalesce(ha.help_asked_30d, 0) AS help_asked_30d,
  coalesce(hg.help_given, 0) AS help_given, coalesce(hg.help_given_30d, 0) AS help_given_30d,
  (ad.email IS NOT NULL) AS is_admin
FROM who w
LEFT JOIN adm ad ON ad.email = w.email
LEFT JOIN req r ON r.email = w.email
LEFT JOIN pil p ON p.email = w.email
LEFT JOIN usr u ON u.email = w.email
LEFT JOIN tut t ON t.user_id = u.id
LEFT JOIN ed e ON e.user_id = u.id
LEFT JOIN cc c ON c.user_id = u.id
LEFT JOIN ch m ON m.user_id = u.id
LEFT JOIN ha ON ha.user_id = u.id
LEFT JOIN hg ON hg.user_id = u.id;
REVOKE ALL ON public.access_hub_people FROM anon, authenticated;

-- A player's 10 latest actions, for the panel ("10 recent edits"): when,
-- where and which kind (merge, cut, claim, marked done...). Admin only, read
-- one player at a time.
CREATE OR REPLACE VIEW public.access_hub_recent_edits AS
SELECT user_id, at, dataset, operation, success FROM (
  SELECT user_id, timestamp AS at, dataset, operation, success,
    row_number() OVER (PARTITION BY user_id ORDER BY timestamp DESC) AS n
  FROM public.edit_log WHERE user_id IS NOT NULL
) x WHERE n <= 10;
REVOKE ALL ON public.access_hub_recent_edits FROM anon, authenticated;

-- One player's last 30 days on each dataset (Ames 2026-11-09: "player
-- search should show snapshot of their activity across datasets for 30
-- days"): edits (merges and cuts), cells done, chat count (never what they
-- wrote). Admin only, read one player at a time.
CREATE OR REPLACE VIEW public.access_hub_player_datasets AS
WITH e AS (
  SELECT user_id, dataset, count(*)::int AS edits, max(timestamp) AS last_edit_at
  FROM public.edit_log WHERE timestamp > now() - interval '30 days' AND operation IN ('merge', 'split') AND success IS NOT FALSE
    AND user_id IS NOT NULL AND dataset IS NOT NULL GROUP BY 1, 2
), c AS (
  SELECT user_id, dataset, count(*)::int AS cells FROM public.ew_cell_completions
  WHERE done_at > now() - interval '30 days' AND dataset IS NOT NULL GROUP BY 1, 2
), m AS (
  SELECT user_id, dataset, count(*)::int AS chats FROM public.chat_messages
  WHERE created_at > now() - interval '30 days' AND dataset IS NOT NULL AND dataset !~ ':' AND dataset <> 'test' GROUP BY 1, 2
)
SELECT coalesce(e.user_id, c.user_id, m.user_id) AS user_id, coalesce(e.dataset, c.dataset, m.dataset) AS dataset,
  coalesce(e.edits, 0) AS edits, coalesce(c.cells, 0) AS cells, coalesce(m.chats, 0) AS chats, e.last_edit_at
FROM e FULL JOIN c ON c.user_id = e.user_id AND c.dataset = e.dataset
FULL JOIN m ON m.user_id = coalesce(e.user_id, c.user_id) AND m.dataset = coalesce(e.dataset, c.dataset);
REVOKE ALL ON public.access_hub_player_datasets FROM anon, authenticated;

-- Where the community is: the last 30 days per dataset.
CREATE OR REPLACE VIEW public.access_hub_activity AS
WITH e AS (
  SELECT dataset, count(*)::int AS edits, count(DISTINCT user_id)::int AS editors
  FROM public.edit_log WHERE timestamp > now() - interval '30 days' AND dataset IS NOT NULL
    AND operation IN ('merge', 'split') AND success IS NOT FALSE GROUP BY dataset
), c AS (
  SELECT dataset, count(*)::int AS cells, count(DISTINCT user_id)::int AS finishers
  FROM public.ew_cell_completions WHERE done_at > now() - interval '30 days' AND dataset IS NOT NULL GROUP BY dataset
), m AS (
  -- Dataset rooms only: achievement, pin and access threads are not places.
  SELECT dataset, count(*)::int AS chats, count(DISTINCT user_id)::int AS chatters
  FROM public.chat_messages WHERE created_at > now() - interval '30 days' AND dataset IS NOT NULL AND dataset !~ ':' AND dataset <> 'test' GROUP BY dataset
)
SELECT coalesce(e.dataset, c.dataset, m.dataset) AS dataset,
  coalesce(e.edits, 0) AS edits, coalesce(e.editors, 0) AS editors,
  coalesce(c.cells, 0) AS cells, coalesce(c.finishers, 0) AS finishers,
  coalesce(m.chats, 0) AS chats, coalesce(m.chatters, 0) AS chatters
FROM e FULL JOIN c ON c.dataset = e.dataset FULL JOIN m ON m.dataset = coalesce(e.dataset, c.dataset);
REVOKE ALL ON public.access_hub_activity FROM anon, authenticated;
