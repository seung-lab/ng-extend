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
-- One person, two emails (Ames 2026-11-10: "link their gmail with the email
-- we had on file"): someone asks with one email and signs in with another.
-- Each row folds the asking email into the sign in email, so the request,
-- the Pilot testers rows and the account read as one person. Admin only.
CREATE TABLE IF NOT EXISTS public.access_email_links (
  email text PRIMARY KEY CHECK (email = lower(email)),
  linked_to text NOT NULL CHECK (linked_to = lower(linked_to) AND linked_to <> email),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.access_email_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_email_links FROM anon, authenticated;

-- Who we invited by email (Ames 2026-11-12: "an icon that indicates this is
-- a person we invited via email or not"): one row per email per send, from
-- the send log of each campaign (the first, the MEC talk email to EyeWire
-- Scouts and up, 2026-11-09 to 11). The EyeWire username lets a request made
-- with another email still match. Admin only.
CREATE TABLE IF NOT EXISTS public.access_invites (
  email text NOT NULL CHECK (email = lower(email)),
  campaign text NOT NULL,
  ew_name text CHECK (ew_name = lower(ew_name)),
  ew_role text,
  sent_at timestamptz NOT NULL,
  PRIMARY KEY (email, campaign)
);
CREATE INDEX IF NOT EXISTS access_invites_ew_name ON public.access_invites (ew_name);
ALTER TABLE public.access_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_invites FROM anon, authenticated;

-- An EyeWire username typed in by an admin on the Access page (Ames
-- 2026-11-12: "add eyewire username manually to invite"), often from their
-- reply to the ask email. It wins over the one on their request, matches
-- them to an invite, and marks them invited when no invite matches.
CREATE TABLE IF NOT EXISTS public.access_ew_names (
  email text PRIMARY KEY CHECK (email = lower(email)),
  ew_name text NOT NULL CHECK (ew_name = lower(ew_name)),
  set_by text,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.access_ew_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_ew_names FROM anon, authenticated;

CREATE OR REPLACE VIEW public.access_hub_people AS
-- The links: the ones made by hand above, and every invite used from another
-- Google account (an "Invite used" record holds both emails,
-- functions/access-request.js linkInvite). A hand made link wins.
WITH lnk AS (
  SELECT DISTINCT ON (email) email, linked_to FROM (
    SELECT email, linked_to, 0 AS pri, created_at FROM public.access_email_links
    UNION ALL
    SELECT rtrim(lower(substring(message FROM 'Linked to invite: ([^\s]+@[^\s]+)')), '.'),
      rtrim(lower(substring(message FROM 'Sign in email: ([^\s]+@[^\s]+)')), '.'), 1, created_at
    FROM public.site_issues WHERE category = 'Invite used'
  ) l WHERE email IS NOT NULL AND linked_to IS NOT NULL AND email <> linked_to
  ORDER BY email, pri, created_at DESC
),
req AS (
  SELECT DISTINCT ON (email) * FROM (
    SELECT coalesce(lk.linked_to, r0.email) AS email, r0.gave_email, r0.request_id, r0.request_user_id, r0.request_name, r0.asked_at,
      r0.from_site, r0.ew_name, r0.ew_rank, r0.found_us, r0.their_note
    FROM (SELECT
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
    ) r0 LEFT JOIN lnk lk ON lk.email = r0.email
  ) r
  WHERE email IS NOT NULL
  ORDER BY email, asked_at DESC
),
pil AS (
  -- A linked email's Pilot row folds into the sign in email's: let in if
  -- either is on, at the first time either was added.
  SELECT coalesce(lk.linked_to, p0.email) AS email, bool_or(p0.enabled) AS enabled,
    min(p0.let_in_at) AS let_in_at, bool_and(p0.from_list) AS from_list
  FROM (
    SELECT lower(email) AS email, enabled, created_at AS let_in_at,
      -- Added together with four or more others: one pasted list.
      count(*) OVER (PARTITION BY created_at) >= 5 AS from_list
    FROM public.pilot_members
  ) p0 LEFT JOIN lnk lk ON lk.email = p0.email
  GROUP BY 1
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
  coalesce(xn.ew_name, r.ew_name) AS ew_name, r.ew_rank, r.found_us, r.their_note,
  p.enabled AS pilot_enabled, p.let_in_at, coalesce(p.from_list, false) AS from_list,
  u.created_at AS joined_at, u.tutorial_active,
  t.tutorial_at, coalesce(t.tutorials, 0) AS tutorials,
  e.first_edit_at, e.last_edit_at, coalesce(e.edits, 0) AS edits, e.last_dataset,
  coalesce(e.edits_30d, 0) AS edits_30d, coalesce(c.cells, 0) AS cells, coalesce(c.cells_30d, 0) AS cells_30d,
  coalesce(m.chats, 0) AS chats, coalesce(m.chats_30d, 0) AS chats_30d,
  coalesce(ha.help_asked, 0) AS help_asked, coalesce(ha.help_answered_for, 0) AS help_answered_for, coalesce(ha.help_asked_30d, 0) AS help_asked_30d,
  coalesce(hg.help_given, 0) AS help_given, coalesce(hg.help_given_30d, 0) AS help_given_30d,
  (ad.email IS NOT NULL) AS is_admin,
  coalesce(iv.sent_at, xn.set_at) AS invited_at,
  coalesce(iv.campaign, CASE WHEN xn.email IS NOT NULL THEN 'by_hand' END) AS invited_for,
  iv.ew_role AS invited_role, iv.email AS invited_as,
  xn.set_at AS ew_name_set_at
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
LEFT JOIN hg ON hg.user_id = u.id
LEFT JOIN public.access_ew_names xn ON xn.email = w.email
-- The first invite that reached them: this email, the email they gave on
-- the form, an email folded into this one, or their EyeWire username.
LEFT JOIN LATERAL (
  SELECT i.email, i.campaign, i.ew_role, i.sent_at FROM public.access_invites i
  WHERE i.email = w.email OR i.email = r.gave_email
    OR i.email IN (SELECT l.email FROM lnk l WHERE l.linked_to = w.email)
    OR (coalesce(xn.ew_name, r.ew_name) IS NOT NULL AND i.ew_name = lower(coalesce(xn.ew_name, r.ew_name)))
  ORDER BY i.sent_at LIMIT 1
) iv ON true;
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

-- Where each player is in each tutorial (Ames 2026-11-12: "show which
-- tutorial users are on like a flow chart ... what step users are on and
-- average time spent per step"): one row per player and tutorial, with the
-- last box they left (and how: next, back, close...) and when they finished
-- it, if they did. Admins only, through ewCommunityData.
CREATE OR REPLACE VIEW public.access_hub_tutorials AS
WITH ev AS (
  SELECT DISTINCT ON (user_id, tutorial) user_id, tutorial, step AS last_step, left_by AS last_left, created_at AS last_at
  FROM public.tutorial_step_events
  ORDER BY user_id, tutorial, created_at DESC
),
dn AS (
  SELECT user_id, tutorial, min(completed_at) AS done_at FROM public.tutorial_completions GROUP BY user_id, tutorial
)
SELECT coalesce(ev.user_id, dn.user_id) AS user_id, coalesce(ev.tutorial, dn.tutorial) AS tutorial,
  ev.last_step, ev.last_left, ev.last_at, dn.done_at
FROM ev FULL JOIN dn ON dn.user_id = ev.user_id AND dn.tutorial = ev.tutorial;
REVOKE ALL ON public.access_hub_tutorials FROM anon, authenticated;
