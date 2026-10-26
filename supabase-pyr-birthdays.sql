-- Pyr birthdays, kept by the database itself (Ames 2026-10-26: "table in
-- sql is fine"). On the anniversary of the day a player joined (US Eastern
-- time), they get "One Year in Pyr", then "Two Years in Pyr", and so on: a
-- Special Award with Ames's cake, and a New Achievement note in My Pyr that
-- opens with one of Ames's birthday lines.
--
-- 1. pyr_birthdays: each player's join date and birthday (MM-DD, ET), filled
--    from users now and kept up to date by a trigger on new players.
-- 2. ew_give_pyr_birthdays(): celebrates today's birthdays. It reads only the
--    players whose birthday is today (or the two days before, so a missed run
--    is caught up), through an index. A year is never given twice.
-- 3. pg_cron runs it every day at 14:00 UTC (10 am EDT, 9 am EST).
--
-- This replaces the GitHub job scripts/anniversary-awards.mjs.
-- Run in the Supabase SQL editor. Safe to re-run.
-- To try it without giving anything:  SELECT * FROM public.ew_give_pyr_birthdays('2027-10-26', true);

-- ── 1. The birthdays ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pyr_birthdays (
  user_id   UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  joined_on DATE NOT NULL,      -- the ET date they joined
  birthday  CHAR(5) NOT NULL    -- 'MM-DD' of joined_on; Feb 29 is kept on Feb 28
);
CREATE INDEX IF NOT EXISTS pyr_birthdays_day ON public.pyr_birthdays (birthday);
-- Read and written only by the functions below (no policies: closed to the app).
ALTER TABLE public.pyr_birthdays ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ew_birthday_of(p_at TIMESTAMPTZ)
RETURNS CHAR(5) LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN to_char(p_at AT TIME ZONE 'America/New_York', 'MM-DD') = '02-29' THEN '02-28'
              ELSE to_char(p_at AT TIME ZONE 'America/New_York', 'MM-DD') END
$$;

INSERT INTO public.pyr_birthdays (user_id, joined_on, birthday)
SELECT id, (created_at AT TIME ZONE 'America/New_York')::DATE, public.ew_birthday_of(created_at)
FROM public.users WHERE created_at IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ew_note_birthday()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.created_at IS NOT NULL THEN
    INSERT INTO public.pyr_birthdays (user_id, joined_on, birthday)
    VALUES (NEW.id, (NEW.created_at AT TIME ZONE 'America/New_York')::DATE, public.ew_birthday_of(NEW.created_at))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ew_note_birthday ON public.users;
CREATE TRIGGER ew_note_birthday AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.ew_note_birthday();

-- ── 2. Celebrate today's birthdays ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ew_give_pyr_birthdays(p_today DATE DEFAULT NULL, p_dry BOOLEAN DEFAULT false)
RETURNS TABLE (user_id UUID, display_name TEXT, years INTEGER, award TEXT, cheer TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  today  DATE := COALESCE(p_today, (now() AT TIME ZONE 'America/New_York')::DATE);
  art    TEXT := 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/champions/pyr-birthday.png';
  words  TEXT[] := ARRAY['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  -- Ames's birthday lines (2026-10-26). {span} is "a whole year", "two whole years", ...
  cheers TEXT[] := ARRAY[
    'Blow out the virtual candles on your virtual cake on your virtual birthday!',
    '{Span} of Pyr is worth cell-ebrating!',
    'Cheers to {span} of Pyr!',
    'You take the cake!',
    'Hip hip Pyrray! It''s your in-game birthday!',
    'Mmmm cake.'];
  r RECORD; n INTEGER; word TEXT; nm TEXT; span TEXT; line TEXT; bid INTEGER;
BEGIN
  FOR r IN
    SELECT b.user_id AS uid, b.joined_on, b.birthday, u.display_name AS dname
    FROM public.pyr_birthdays b JOIN public.users u ON u.id = b.user_id
    WHERE b.birthday IN (to_char(today, 'MM-DD'), to_char(today - 1, 'MM-DD'), to_char(today - 2, 'MM-DD'))
  LOOP
    -- Whole years as of today (a Dec 31 birthday caught up on Jan 1 is last year's).
    n := EXTRACT(YEAR FROM today)::INT - EXTRACT(YEAR FROM r.joined_on)::INT
         - CASE WHEN to_char(today, 'MM-DD') < r.birthday THEN 1 ELSE 0 END;
    CONTINUE WHEN n < 1;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.special_badge_awards a JOIN public.special_badges s ON s.id = a.badge_id
      WHERE s.slug = 'anniversary-' || n AND a.user_id = r.uid);
    word := COALESCE(words[n], n::TEXT);
    nm := word || CASE WHEN n = 1 THEN ' Year' ELSE ' Years' END || ' in Pyr';
    span := CASE WHEN n = 1 THEN 'a whole year' ELSE lower(word) || ' whole years' END;
    line := replace(replace(cheers[1 + (hashtext(r.uid::TEXT || ':' || n) & 2147483647) % array_length(cheers, 1)],
              '{span}', span), '{Span}', upper(left(span, 1)) || substr(span, 2));
    user_id := r.uid; display_name := r.dname; years := n; award := nm; cheer := line;
    RETURN NEXT;
    CONTINUE WHEN p_dry;

    INSERT INTO public.special_badges (slug, name, description, image_url, thumbnail_url)
    VALUES ('anniversary-' || n, nm,
            'Happy Pyr birthday! ' || CASE WHEN n = 1 THEN 'A whole year' ELSE word || ' years' END
              || ' since you joined Pyr. Thank you for mapping the brain with us.',
            art, art)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO bid;
    INSERT INTO public.special_badge_awards (badge_id, user_id, awarded_by, reason)
    VALUES (bid, r.uid, NULL, 'Joined Pyr on ' || to_char(r.joined_on, 'YYYY-MM-DD'))
    ON CONFLICT (badge_id, user_id) DO NOTHING;
    INSERT INTO public.notifications (title, body, image_url, thumbnail_url, target_type, target_id, send_at, post_to_chat)
    VALUES ('🎂 New Achievement: ' || nm,
            line || ' Happy Pyr birthday' || CASE WHEN COALESCE(r.dname, '') <> '' THEN ', ' || r.dname ELSE '' END || '! '
              || CASE WHEN n = 1 THEN 'One year' ELSE word || ' years' END
              || ' ago today you joined Pyr. Thank you for mapping the brain with us. 🧬',
            art, art, 'user', r.uid::TEXT, now(), false);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ew_give_pyr_birthdays(DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── 3. Every day at 14:00 UTC ────────────────────────────────────────────────
-- Needs pg_cron (Database > Extensions), which Pyr already uses.
SELECT cron.unschedule('pyr-birthdays') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pyr-birthdays');
SELECT cron.schedule('pyr-birthdays', '0 14 * * *', $$ SELECT public.ew_give_pyr_birthdays(); $$);

-- Check: the table is filled, and what a day would do.
-- SELECT count(*) FROM public.pyr_birthdays;
-- SELECT * FROM public.ew_give_pyr_birthdays('2027-03-06', true);
