-- "What's new in Pyr" on the blog: never announced (Ames 2026-11-10, triage #463).
--
-- The daily digest (scripts/release-notes-blog.mjs) keeps one blog post a
-- week, slug whats-new-in-pyr-YYYY-MM-DD (the Monday it starts), rewritten
-- every afternoon. Players already hear about the day in Today in Pyr, so
-- these posts must not send "New on the blog" to everyone and a chat line
-- (supabase-blog-announce.sql) each time they are written.
--
-- ew_is_release_notes is also how the script knows this has been run: it
-- writes nothing until the function exists.
--
-- Run in the Supabase SQL editor. Safe to re-run. Run it BEFORE the digest
-- with the release notes is deployed.

CREATE OR REPLACE FUNCTION public.ew_is_release_notes(p_slug TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(p_slug, '') LIKE 'whats-new-in-pyr-%' $$;

-- The announcement trigger, as in supabase-blog-announce.sql, with the one
-- new line marked below.
CREATE OR REPLACE FUNCTION public.ew_announce_blog_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cover   TEXT := NULLIF(btrim(COALESCE(NEW.cover_url, '')), '');
  heading TEXT;
  words   TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' OR NEW.title IS NULL THEN RETURN NEW; END IF;
  -- New: the weekly release notes are never announced.
  IF public.ew_is_release_notes(NEW.slug) THEN RETURN NEW; END IF;
  heading := 'New on the blog: ' || NEW.title;
  words := public.ew_blog_note_text(NEW.slug, NEW.summary, NEW.body);

  -- Already announced: keep its own notification in step with the post.
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE public.ew_blog_note_is(n.body, NEW.slug)) THEN
    UPDATE public.notifications n
       SET title = heading, body = words, image_url = cover, thumbnail_url = cover
     WHERE public.ew_blog_note_is(n.body, NEW.slug)
       AND (n.title IS DISTINCT FROM heading OR n.body IS DISTINCT FROM words OR n.image_url IS DISTINCT FROM cover);
    RETURN NEW;
  END IF;
  -- An edit to a post that was out before announcements existed.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'published' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications
    (title, body, image_url, thumbnail_url, target_type, send_at, post_to_chat, created_by)
  VALUES (heading, words, cover, cover, 'all',
    -- a post dated ahead is announced when its date arrives
    GREATEST(NOW(), COALESCE(NEW.published_at, NOW())),
    TRUE, NEW.author_id);
  RETURN NEW;
END
$fn$;
