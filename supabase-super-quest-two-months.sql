-- ============================================================================
-- Super Quests last up to 2 months (Ames 2026-10-28: "enforce the 2 month
-- limit").
--
-- A Super Quest claim (proofreading_tasks.kind = 'interneuron') ends 60 days
-- after it was claimed. A trigger on task_assignments sets that end on every
-- write, so neither a heartbeat nor claiming it again can stretch it, and
-- copies it to proofreading_tasks.quest_ends_at for the game to show.
-- Once an hour, ew_release_expired_super_quests lets the ended ones go: the
-- cell is open to claim again, and the player's active time on it is kept.
-- Ordinary claims are not touched.
--
-- Run after supabase-interneuron-quests.sql. Needs pg_cron, which Pyr already
-- uses. Safe to re-run.
-- ============================================================================
BEGIN;

ALTER TABLE public.proofreading_tasks ADD COLUMN IF NOT EXISTS quest_ends_at timestamptz;

CREATE OR REPLACE FUNCTION public.ew_super_quest_two_months() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'active' AND EXISTS (SELECT 1 FROM public.proofreading_tasks t WHERE t.id = NEW.task_id AND t.kind = 'interneuron') THEN
    NEW.expires_at := coalesce(NEW.claimed_at, now()) + interval '60 days';
    UPDATE public.proofreading_tasks SET quest_ends_at = NEW.expires_at
      WHERE id = NEW.task_id AND quest_ends_at IS DISTINCT FROM NEW.expires_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS super_quest_two_months ON public.task_assignments;
CREATE TRIGGER super_quest_two_months BEFORE INSERT OR UPDATE OF expires_at, status ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ew_super_quest_two_months();

-- Super Quests held now: 2 months from when they were claimed.
UPDATE public.task_assignments a SET expires_at = a.expires_at
  FROM public.proofreading_tasks t
  WHERE a.task_id = t.id AND t.kind = 'interneuron' AND a.status = 'active';

CREATE OR REPLACE FUNCTION public.ew_release_expired_super_quests() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  -- The claim lock, as every claim path takes it.
  PERFORM pg_catalog.pg_advisory_xact_lock(98127, 61750);
  WITH gone AS (
    UPDATE public.task_assignments a SET status = 'expired', released_at = now()
      FROM public.proofreading_tasks t
      WHERE a.task_id = t.id AND t.kind = 'interneuron' AND a.status = 'active' AND a.expires_at < now()
      RETURNING a.task_id, a.user_id)
  UPDATE public.proofreading_tasks t SET status = 'pending', assigned_to = NULL, quest_ends_at = NULL, updated_at = now()
    FROM gone WHERE t.id = gone.task_id AND t.assigned_to = gone.user_id AND t.status IN ('assigned', 'in_progress');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.ew_super_quest_two_months(), public.ew_release_expired_super_quests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_release_expired_super_quests() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Once an hour.
SELECT cron.unschedule('super-quest-expiry') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'super-quest-expiry');
SELECT cron.schedule('super-quest-expiry', '17 * * * *', $$ SELECT public.ew_release_expired_super_quests(); $$);

-- Check: each held Super Quest and when it ends.
SELECT t.id, t.segment_id, t.quest_category, a.claimed_at, a.expires_at, t.quest_ends_at
FROM public.task_assignments a JOIN public.proofreading_tasks t ON t.id = a.task_id
WHERE t.kind = 'interneuron' AND a.status = 'active';
