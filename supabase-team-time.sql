-- ============================================================================
-- Time in Pyr for the team (Ames 2026-11-19: "see how much time they're
-- actually spending in Pyr and also maybe what area of the site they're in").
--
-- The presence heartbeat (chat_presence, about once a minute from every
-- signed-in tab) now also says:
--   area    which part of Pyr is on screen: viewer, tutorial, cell_library,
--           quests, profile, leaderboard, settings, admin
--   active  the tab is in front and the mouse or keyboard was used in the
--           last two minutes
-- For admins only (the admins table), a trigger adds each minute to
-- team_time: one row a person, day (Eastern), area and dataset, with
-- open_min (Pyr open, looked at or not) and active_min (really in use).
-- Several tabs count a minute once. Nothing is kept for players.
--
-- Admins read it through the gateway as team_time_days (Access page).
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
BEGIN;

ALTER TABLE public.chat_presence ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE public.chat_presence ADD COLUMN IF NOT EXISTS active boolean;

CREATE TABLE IF NOT EXISTS public.team_time (
  user_id uuid NOT NULL,
  day date NOT NULL,
  area text NOT NULL,
  dataset text NOT NULL DEFAULT '',
  open_min integer NOT NULL DEFAULT 0,
  active_min integer NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, area, dataset)
);
-- The minute last counted for each person, so two tabs count it once.
CREATE TABLE IF NOT EXISTS public.team_time_last (
  user_id uuid PRIMARY KEY,
  counted_at timestamptz NOT NULL,
  was_active boolean NOT NULL DEFAULT false
);
ALTER TABLE public.team_time ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_time_last ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_time, public.team_time_last FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_time, public.team_time_last TO service_role;

CREATE OR REPLACE FUNCTION public.team_time_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d date := (now() AT TIME ZONE 'America/New_York')::date;
  ds text := coalesce(NEW.dataset, '');
  act boolean := coalesce(NEW.active, false);
  fresh boolean;
  last public.team_time_last%ROWTYPE;
BEGIN
  IF NEW.area IS NULL OR NEW.user_id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u JOIN public.admins a ON lower(a.email) = lower(u.middleauth_email)
    WHERE u.id = NEW.user_id
  ) THEN RETURN NULL; END IF;

  SELECT * INTO last FROM public.team_time_last WHERE user_id = NEW.user_id FOR UPDATE;
  fresh := NOT FOUND OR last.counted_at < now() - interval '50 seconds';

  IF fresh THEN
    INSERT INTO public.team_time_last (user_id, counted_at, was_active) VALUES (NEW.user_id, now(), act)
    ON CONFLICT (user_id) DO UPDATE SET counted_at = now(), was_active = act;
    INSERT INTO public.team_time (user_id, day, area, dataset, open_min, active_min, last_at)
    VALUES (NEW.user_id, d, NEW.area, ds, 1, CASE WHEN act THEN 1 ELSE 0 END, now())
    ON CONFLICT (user_id, day, area, dataset) DO UPDATE
      SET open_min = public.team_time.open_min + 1,
          active_min = public.team_time.active_min + CASE WHEN act THEN 1 ELSE 0 END,
          last_at = now();
  ELSIF act AND NOT last.was_active THEN
    -- This minute was counted from a background tab; the tab in use makes it active.
    UPDATE public.team_time_last SET was_active = true WHERE user_id = NEW.user_id;
    INSERT INTO public.team_time (user_id, day, area, dataset, open_min, active_min, last_at)
    VALUES (NEW.user_id, d, NEW.area, ds, 0, 1, now())
    ON CONFLICT (user_id, day, area, dataset) DO UPDATE
      SET active_min = public.team_time.active_min + 1, last_at = now();
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Counting time must never stop the heartbeat (and "who's online") working.
  RAISE WARNING 'team_time_count: %', SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.team_time_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS team_time_count ON public.chat_presence;
CREATE TRIGGER team_time_count AFTER INSERT OR UPDATE ON public.chat_presence
  FOR EACH ROW EXECUTE FUNCTION public.team_time_count();

-- The last 60 days, with names, for the Access page.
CREATE OR REPLACE VIEW public.team_time_days AS
  SELECT t.user_id, coalesce(u.username, u.display_name, 'Player') AS name,
         t.day, t.area, t.dataset, t.active_min, t.open_min, t.last_at
  FROM public.team_time t LEFT JOIN public.users u ON u.id = t.user_id
  WHERE t.day >= (now() AT TIME ZONE 'America/New_York')::date - 60;
REVOKE ALL ON public.team_time_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_time_days TO service_role;

COMMIT;
