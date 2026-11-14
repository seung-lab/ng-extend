-- ============================================================================
-- Live events: joins, leaves and completions, without sending every heartbeat
-- and every edit through Realtime (perf audit 2026-11-14, docs/perf-audit-2026-11.md
-- S1 and S2).
--
-- Before: every open tab subscribed to all changes on chat_presence (each
-- player's heartbeat, once a minute, went to every tab: players x tabs x
-- players) and to edit_log inserts (every edit decoded for every tab, for the
-- completion line in chat). At 150 players that is about 1,000 Realtime
-- messages a second, twice the Pro plan's quota.
--
-- After: the database itself writes one small row to pyr_live_events when
-- someone joins (the same rule as before: chat_presence_stamp_join moves
-- joined_at), leaves (their presence row is deleted) or completes a cell. The
-- site listens to that table only. Heartbeats and edits no longer go out.
-- The rows are written by triggers, never by a browser, so a join line still
-- cannot be forged.
--
-- ORDER
--   STEP 1  run now, before deploying the site. Safe to re-run. The live site
--           keeps working as before (it does not read the new table yet).
--   deploy  the site (it uses the new table when it is there, the old way when not).
--   STEP 2  a day after the deploy, once open tabs have reloaded: stop
--           publishing chat_presence and edit_log. Before running it, check
--           that nothing else (connectome.quest admin pages, scripts) listens
--           to those two tables over Realtime.
--   UNDO    at the bottom.
-- ============================================================================

-- ── STEP 1 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pyr_live_events (
  id        bigserial PRIMARY KEY,
  kind      text NOT NULL CHECK (kind IN ('join', 'leave', 'complete')),
  user_id   uuid,
  name      text,
  dataset   text,
  operation text,
  cell      text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pyr_live_events_at ON public.pyr_live_events (at);

ALTER TABLE public.pyr_live_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "live events are readable" ON public.pyr_live_events;
CREATE POLICY "live events are readable" ON public.pyr_live_events FOR SELECT USING (true);
GRANT SELECT ON public.pyr_live_events TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pyr_live_events FROM anon, authenticated;

-- Old rows are cleared now and then, by the triggers themselves (about one
-- write in fifty). Nobody reads further back than a page load.
CREATE OR REPLACE FUNCTION public.pyr_live_events_trim() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.pyr_live_events WHERE at < now() - interval '1 hour';
$$;
REVOKE ALL ON FUNCTION public.pyr_live_events_trim() FROM PUBLIC, anon, authenticated;

-- Joins and leaves. Runs AFTER chat_presence_stamp_join, so joined_at is final.
CREATE OR REPLACE FUNCTION public.pyr_live_presence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    INSERT INTO public.pyr_live_events (kind, user_id, name, dataset)
    VALUES ('leave', old.user_id, old.name, old.dataset);
  ELSIF tg_op = 'INSERT' OR new.joined_at IS DISTINCT FROM old.joined_at THEN
    INSERT INTO public.pyr_live_events (kind, user_id, name, dataset, at)
    VALUES ('join', new.user_id, new.name, new.dataset, new.joined_at);
  ELSE
    RETURN NULL;                       -- a routine heartbeat: nothing to tell
  END IF;
  IF random() < 0.02 THEN PERFORM public.pyr_live_events_trim(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.pyr_live_presence() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pyr_live_presence ON public.chat_presence;
CREATE TRIGGER pyr_live_presence
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_presence
  FOR EACH ROW EXECUTE FUNCTION public.pyr_live_presence();

-- Completions: the two operations the chat line has always listened for.
CREATE OR REPLACE FUNCTION public.pyr_live_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.user_id IS NULL OR new.success IS FALSE THEN RETURN NULL; END IF;
  INSERT INTO public.pyr_live_events (kind, user_id, dataset, operation, cell, at)
  VALUES ('complete', new.user_id, new.dataset, new.operation,
          COALESCE(new.metadata->>'final_segment_id', new.metadata->>'root_id', new.metadata->>'segment_id'),
          COALESCE(new.timestamp, now()));
  IF random() < 0.02 THEN PERFORM public.pyr_live_events_trim(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.pyr_live_completion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pyr_live_completion ON public.edit_log;
CREATE TRIGGER pyr_live_completion
  AFTER INSERT ON public.edit_log
  FOR EACH ROW WHEN (new.operation IN ('mark_complete', 'complete_task'))
  EXECUTE FUNCTION public.pyr_live_completion();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pyr_live_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pyr_live_events;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── STEP 2 (a day after the deploy) ─────────────────────────────────────────
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_presence') THEN
--     ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_presence;
--   END IF;
--   IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'edit_log') THEN
--     ALTER PUBLICATION supabase_realtime DROP TABLE public.edit_log;
--   END IF;
-- END $$;

-- ── UNDO (step 2 first, if it was run; then step 1) ─────────────────────────
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_presence;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.edit_log;
--
-- DROP TRIGGER IF EXISTS pyr_live_presence ON public.chat_presence;
-- DROP TRIGGER IF EXISTS pyr_live_completion ON public.edit_log;
-- DROP FUNCTION IF EXISTS public.pyr_live_presence();
-- DROP FUNCTION IF EXISTS public.pyr_live_completion();
-- DROP FUNCTION IF EXISTS public.pyr_live_events_trim();
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.pyr_live_events;
-- DROP TABLE IF EXISTS public.pyr_live_events;
