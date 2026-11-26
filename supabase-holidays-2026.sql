-- ============================================================================
-- Thanksgiving and Black Friday 2026 (Ames 2026-11-24).
--
-- 1. "Thanksgiving 2026": a Special Award for every player who opens Pyr on
--    Thanksgiving, Thursday November 26, by their own calendar day (the day
--    their streak counts), or who edits or chats that day in Eastern time.
--    A job checks every 15 minutes from Nov 26 to Nov 28 and gives it once,
--    with the usual Achievement popup through a notification. After Nov 28
--    it does nothing, so it can never fire in a later year.
--    The art is static/images/champions/thanksgiving-2026.png.
--
-- 2. Black Friday, November 27 (Eastern time): every quest counts twice on
--    the Quests leaderboard and the profile's Quests card. Only the counting
--    changes: the lab's quest sheet and its mirror keep one row per quest.
--    ew_quest_board is the live function with only the count weighted.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ── 1. Thanksgiving 2026 ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ew_give_thanksgiving_2026(p_dry BOOLEAN DEFAULT false)
RETURNS TABLE (user_id UUID, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  day  CONSTANT DATE := DATE '2026-11-26';
  art  CONSTANT TEXT := 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/champions/thanksgiving-2026.png';
  nm   CONSTANT TEXT := 'Thanksgiving 2026';
  bid  INTEGER;
  r    RECORD;
BEGIN
  -- Only from Thanksgiving to the end of Nov 28, Eastern time.
  IF (now() AT TIME ZONE 'America/New_York')::date NOT BETWEEN day AND day + 2 AND NOT p_dry THEN
    RETURN;
  END IF;

  IF NOT p_dry THEN
    INSERT INTO public.special_badges (slug, name, description, image_url, thumbnail_url)
    VALUES ('thanksgiving-2026', nm,
            'Pyr is Thankful for YOU! Citizen science wouldn''t be possible without you :)', art, art)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
      image_url = EXCLUDED.image_url, thumbnail_url = EXCLUDED.thumbnail_url
    RETURNING id INTO bid;
  ELSE
    SELECT id INTO bid FROM public.special_badges WHERE slug = 'thanksgiving-2026';
  END IF;

  FOR r IN
    SELECT u.id AS uid, u.display_name AS dname
    FROM public.users u
    WHERE (u.last_edit_date = day                                  -- opened Pyr that day (their own calendar)
           OR EXISTS (SELECT 1 FROM public.edit_log e
                      WHERE e.user_id = u.id AND e.success IS NOT FALSE
                        AND e."timestamp" >= (day::timestamp AT TIME ZONE 'America/New_York')
                        AND e."timestamp" <  ((day + 1)::timestamp AT TIME ZONE 'America/New_York'))
           OR EXISTS (SELECT 1 FROM public.chat_presence c
                      WHERE c.user_id = u.id
                        AND (c.last_seen_at AT TIME ZONE 'America/New_York')::date = day))
      AND NOT EXISTS (SELECT 1 FROM public.special_badge_awards a
                      WHERE a.badge_id = bid AND a.user_id = u.id)
    ORDER BY u.created_at
  LOOP
    user_id := r.uid; display_name := r.dname;
    RETURN NEXT;
    CONTINUE WHEN p_dry;
    INSERT INTO public.special_badge_awards (badge_id, user_id, awarded_by, reason)
    VALUES (bid, r.uid, NULL, 'Played Pyr on Thanksgiving 2026')
    ON CONFLICT (badge_id, user_id) DO NOTHING;
    INSERT INTO public.notifications (title, body, image_url, thumbnail_url, target_type, target_id, send_at, post_to_chat)
    -- The Achievement card shows the quoted name and the words after "award!" (Ames 2026-11-24).
    VALUES ('New Achievement: ' || nm,
            'You earned the "' || nm || '" award! Pyr is Thankful for YOU! Citizen science wouldn''t be possible without you :)',
            art, art, 'user', r.uid::TEXT, now(), false);
    -- The "earned" line in chat, like an award an admin gives (report 641,
    -- 2026-11-26). Once per player, the same row chat.achievement writes.
    INSERT INTO public.chat_messages (user_id, name, rank, text, dataset)
    SELECT u.id, COALESCE(NULLIF(u.username, ''), NULLIF(u.display_name, ''), 'Player'),
           'achievement', 'earned the ' || nm || ' award', 'achievement:special:' || bid
    FROM public.users u
    WHERE u.id = r.uid
      AND NOT EXISTS (SELECT 1 FROM public.chat_messages c
                      WHERE c.user_id = r.uid AND c.dataset = 'achievement:special:' || bid);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ew_give_thanksgiving_2026(BOOLEAN) FROM PUBLIC, anon, authenticated;
-- The players awarded before the chat line was added get theirs now (report 641).
INSERT INTO public.chat_messages (user_id, name, rank, text, dataset)
SELECT u.id, COALESCE(NULLIF(u.username, ''), NULLIF(u.display_name, ''), 'Player'),
       'achievement', 'earned the ' || b.name || ' award', 'achievement:special:' || b.id
FROM public.special_badge_awards a
JOIN public.special_badges b ON b.id = a.badge_id AND b.slug = 'thanksgiving-2026'
JOIN public.users u ON u.id = a.user_id
WHERE NOT EXISTS (SELECT 1 FROM public.chat_messages c
                  WHERE c.user_id = a.user_id AND c.dataset = 'achievement:special:' || b.id)
ORDER BY u.created_at;

-- Every 15 minutes on Nov 26, 27 and 28 (UTC days; the function itself keeps
-- to Thanksgiving through Nov 28 Eastern). Needs pg_cron, which Pyr already uses.
SELECT cron.unschedule('pyr-thanksgiving-2026') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pyr-thanksgiving-2026');
SELECT cron.schedule('pyr-thanksgiving-2026', '*/15 * 26-29 11 *', $$ SELECT public.ew_give_thanksgiving_2026(); $$);

-- ── 2. Black Friday: every quest counts twice ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ew_quest_board(p_quest text)
 RETURNS TABLE(name text, today integer, week integer, alltime integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH t AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today),
  r AS (
    SELECT lower(regexp_replace(s.annotator, '[^[:alnum:]]', '', 'g')) AS k, btrim(s.annotator) AS n,
           CASE WHEN s.quest_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(s.quest_date, 'MM/DD/YYYY') END AS d
    FROM public.ew_quest_sheet_rows s
    WHERE p_quest IN ('retina_cilia', 'all') AND s.quest = 'retina_cilia' AND s.annotator <> '' AND s.status ~* '^\s*(cilium annotated|no cilium|skipped)'
    UNION ALL
    SELECT lower(regexp_replace(coalesce(nullif(btrim(u.display_name), ''), u.username, ''), '[^[:alnum:]]', '', 'g')),
           coalesce(nullif(btrim(u.display_name), ''), u.username),
           (a.answered_at AT TIME ZONE 'America/New_York')::date
    FROM public.muller_glia_answers a JOIN public.users u ON u.id = a.user_id
    WHERE p_quest IN ('retina_muller_glia', 'all')
  ),
  -- Black Friday 2026: a quest done that day counts twice (Ames 2026-11-24).
  w AS (SELECT r.*, CASE WHEN r.d = DATE '2026-11-27' THEN 2 ELSE 1 END AS w FROM r)
  SELECT min(w.n),
         (coalesce(sum(w.w) FILTER (WHERE w.d = t.today), 0))::int,
         (coalesce(sum(w.w) FILTER (WHERE w.d > t.today - 7 AND w.d <= t.today), 0))::int,
         sum(w.w)::int
  FROM w, t WHERE w.k <> '' GROUP BY w.k;
$function$;

-- Check what the job would do right now (gives nothing):
-- SELECT * FROM public.ew_give_thanksgiving_2026(true);
-- SELECT * FROM public.ew_quest_board('retina_cilia') ORDER BY alltime DESC LIMIT 5;
