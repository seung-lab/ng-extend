-- Community milestones (Ames 2026-11-20: "one time confetti and banner that
-- goes away when you click but can be brought back via a notif. But not every
-- day! It should be rarer milestones.").
--
-- Counted here, on the server, so every player celebrates the same moment:
--   cells    rows of ew_cell_completions (the only source of completed cells)
--   edits    merges and splits that worked, in edit_log
--   players  players with at least one merge or split
-- Princeton Tracers run on their own backend, so they are in none of these.
--
-- Milestones (Ames "go" 2026-11-20):
--   cells    5,000, then every 5,000
--   edits    100,000, then every 100,000
--   players  100, 250, 500, then every 500
-- Lost Fragments milestones are counted by the Firebase fragments list and
-- celebrated by the same banner in the game (util/fragment_milestones.ts).
--
-- 1. community_progress: the latest count per track, one row each. The game
--    reads this tiny table, never the big ones.
-- 2. community_milestones: one row per milestone reached, with when. banner is
--    false when another milestone had a banner in the 7 days before, so there
--    is at most one banner a week; it still gets its notification.
-- 3. ew_check_community_milestones(): counts, records and notifies. pg_cron
--    runs it at 5 past every hour.
--
-- Safe to run again: every statement replaces or skips what is there.

-- ── 1 and 2. Tables ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_progress (
  track      TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.community_milestones (
  track           TEXT NOT NULL,
  value           INTEGER NOT NULL,
  reached_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  banner          BOOLEAN NOT NULL DEFAULT true,
  notification_id INTEGER,
  PRIMARY KEY (track, value)
);
-- Counts only, nobody's identity: everyone may read, nobody may write (the
-- function below writes as its owner).
ALTER TABLE public.community_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_progress_read ON public.community_progress;
CREATE POLICY community_progress_read ON public.community_progress FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS community_milestones_read ON public.community_milestones;
CREATE POLICY community_milestones_read ON public.community_milestones FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.community_progress, public.community_milestones FROM anon, authenticated;
GRANT SELECT ON public.community_progress, public.community_milestones TO anon, authenticated;

-- ── The ladders ─────────────────────────────────────────────────────────────
-- The highest milestone at or below n, or 0 for none yet.
CREATE OR REPLACE FUNCTION public.ew_community_milestone_at(p_track TEXT, n INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_track
    WHEN 'cells' THEN (n / 5000) * 5000
    WHEN 'edits' THEN (n / 100000) * 100000
    WHEN 'players' THEN CASE WHEN n < 100 THEN 0 WHEN n < 250 THEN 100 WHEN n < 500 THEN 250 ELSE (n / 500) * 500 END
    ELSE 0 END;
$$;

-- ── 3. Count, record, notify ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ew_check_community_milestones(p_dry BOOLEAN DEFAULT false)
RETURNS TABLE (track TEXT, count INTEGER, milestone INTEGER, is_new BOOLEAN, banner BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  art TEXT := 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/champions/pyr-community-milestone.png';
  r RECORD; m INTEGER; best INTEGER; recent BOOLEAN; nid INTEGER; title TEXT; line TEXT; nxt INTEGER;
  fmt TEXT := 'FM999,999,999';
BEGIN
  FOR r IN
    SELECT 'cells'::TEXT AS t, (SELECT count(*) FROM public.ew_cell_completions)::INTEGER AS n
    UNION ALL
    SELECT 'edits', (SELECT count(*) FROM public.edit_log WHERE operation IN ('merge', 'split') AND success)::INTEGER
    UNION ALL
    SELECT 'players', (SELECT count(DISTINCT user_id) FROM public.edit_log WHERE operation IN ('merge', 'split') AND success)::INTEGER
  LOOP
    m := public.ew_community_milestone_at(r.t, r.n);
    SELECT max(cm.value) INTO best FROM public.community_milestones cm WHERE cm.track = r.t;
    track := r.t; count := r.n; milestone := m;
    is_new := m > 0 AND m > COALESCE(best, 0);
    -- At most one banner a week across every track.
    SELECT EXISTS (SELECT 1 FROM public.community_milestones cm WHERE cm.banner AND cm.reached_at > now() - interval '7 days') INTO recent;
    banner := is_new AND NOT recent;
    RETURN NEXT;
    CONTINUE WHEN p_dry;

    INSERT INTO public.community_progress (track, count, updated_at) VALUES (r.t, r.n, now())
    ON CONFLICT ON CONSTRAINT community_progress_pkey DO UPDATE SET count = EXCLUDED.count, updated_at = EXCLUDED.updated_at;
    CONTINUE WHEN NOT is_new;

    -- The words match the banner in the game (components/CommunityMilestone.vue).
    nxt := CASE r.t WHEN 'cells' THEN m + 5000 WHEN 'edits' THEN m + 100000
                    ELSE CASE WHEN m < 250 THEN 250 WHEN m < 500 THEN 500 ELSE m + 500 END END;
    line := CASE r.t
      WHEN 'cells' THEN 'Together we just completed ' || to_char(m, fmt) || ' cells.'
      WHEN 'edits' THEN 'Together we just made ' || to_char(m, fmt) || ' edits.'
      ELSE 'Together we are now ' || to_char(m, fmt) || ' players strong.' END;
    title := '🎊 ' || CASE r.t
      WHEN 'cells' THEN 'Together we completed ' || to_char(m, fmt) || ' cells'
      WHEN 'edits' THEN 'Together we made ' || to_char(m, fmt) || ' edits'
      ELSE 'Together we are ' || to_char(m, fmt) || ' players strong' END;
    INSERT INTO public.notifications (title, body, image_url, thumbnail_url, target_type, target_id, send_at, post_to_chat)
    VALUES (title,
            'Congrats! ' || line || ' A Pyr community milestone. ' || to_char(nxt - r.n, fmt) || ' to go until ' || to_char(nxt, fmt) || '.'
              || E'\n\n[See the celebration again](#nge-milestone=' || r.t || ':' || m || ')',
            art, art, 'all', NULL, now(), false)
    RETURNING id INTO nid;
    INSERT INTO public.community_milestones (track, value, reached_at, banner, notification_id)
    VALUES (r.t, m, now(), banner, nid)
    ON CONFLICT ON CONSTRAINT community_milestones_pkey DO NOTHING;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ew_check_community_milestones(BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── Every hour, at 5 past ───────────────────────────────────────────────────
SELECT cron.unschedule('pyr-community-milestones') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pyr-community-milestones');
SELECT cron.schedule('pyr-community-milestones', '5 * * * *', $$ SELECT public.ew_check_community_milestones(); $$);

-- Fill community_progress now (nothing is near a milestone today, so no
-- notification goes out).
SELECT * FROM public.ew_check_community_milestones();
