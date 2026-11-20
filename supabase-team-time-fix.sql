-- ============================================================================
-- Time in Pyr: a minute counted from a background tab, then made active by the
-- tab in use, now moves to the tab in use's area and dataset (Ames 2026-11-20:
-- rows showed more active minutes than open ones, e.g. 20 active of 13 open).
-- Before, the active minute went to the tab in use's row while its open
-- minute stayed on the background tab's row.
-- Also caps old rows so no row is more active than open.
-- Run after supabase-team-time.sql. Safe to re-run.
-- ============================================================================
BEGIN;

ALTER TABLE public.team_time_last ADD COLUMN IF NOT EXISTS last_day date;
ALTER TABLE public.team_time_last ADD COLUMN IF NOT EXISTS last_area text;
ALTER TABLE public.team_time_last ADD COLUMN IF NOT EXISTS last_dataset text;

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
    INSERT INTO public.team_time_last (user_id, counted_at, was_active, last_day, last_area, last_dataset)
      VALUES (NEW.user_id, now(), act, d, NEW.area, ds)
    ON CONFLICT (user_id) DO UPDATE SET counted_at = now(), was_active = act, last_day = d, last_area = NEW.area, last_dataset = ds;
    INSERT INTO public.team_time (user_id, day, area, dataset, open_min, active_min, last_at)
    VALUES (NEW.user_id, d, NEW.area, ds, 1, CASE WHEN act THEN 1 ELSE 0 END, now())
    ON CONFLICT (user_id, day, area, dataset) DO UPDATE
      SET open_min = public.team_time.open_min + 1,
          active_min = public.team_time.active_min + CASE WHEN act THEN 1 ELSE 0 END,
          last_at = now();
  ELSIF act AND NOT last.was_active THEN
    -- This minute was counted from a background tab: the tab in use makes it
    -- active, and the minute moves to where the player really is.
    UPDATE public.team_time_last SET was_active = true, last_day = d, last_area = NEW.area, last_dataset = ds
      WHERE user_id = NEW.user_id;
    IF last.last_area IS NOT NULL AND (last.last_day, last.last_area, coalesce(last.last_dataset, '')) IS DISTINCT FROM (d, NEW.area, ds) THEN
      UPDATE public.team_time SET open_min = greatest(0, open_min - 1)
        WHERE user_id = NEW.user_id AND day = last.last_day AND area = last.last_area AND dataset = coalesce(last.last_dataset, '');
      INSERT INTO public.team_time (user_id, day, area, dataset, open_min, active_min, last_at)
      VALUES (NEW.user_id, d, NEW.area, ds, 1, 1, now())
      ON CONFLICT (user_id, day, area, dataset) DO UPDATE
        SET open_min = public.team_time.open_min + 1, active_min = public.team_time.active_min + 1, last_at = now();
    ELSE
      INSERT INTO public.team_time (user_id, day, area, dataset, open_min, active_min, last_at)
      VALUES (NEW.user_id, d, NEW.area, ds, 1, 1, now())
      ON CONFLICT (user_id, day, area, dataset) DO UPDATE
        SET active_min = least(public.team_time.open_min, public.team_time.active_min + 1), last_at = now();
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Counting time must never stop the heartbeat (and "who's online") working.
  RAISE WARNING 'team_time_count: %', SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.team_time_count() FROM PUBLIC, anon, authenticated;

-- Rows counted before this fix: never more active than open.
UPDATE public.team_time SET active_min = open_min WHERE active_min > open_min;

COMMIT;
