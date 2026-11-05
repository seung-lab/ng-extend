-- A published blog post announces itself (Ames 2026-10-10).
--
-- When a post becomes published, a notification goes to every player:
--   title  "New on the blog: <the post's title>"
--   body   the post's summary, a link to the post on the blog, a rule, and
--          then the whole post, so it can be read without leaving the game
--   image  the post's feature image, if it has one
-- and it is flagged to be posted in chat as well. The game posts a flagged
-- notification to chat, once, from an admin's open game, within a minute.
--
-- Each post is announced once. An edit to a published post's title,
-- summary, text or feature image is carried over to its notification.
--
-- WHICH NOTIFICATION BELONGS TO WHICH POST (fixed 2026-10-28). It used to be
-- "the notification whose text contains a link to the post". Posts link to
-- each other: Super Quests links to Mapping MEC and back. So publishing
-- Mapping MEC, then editing Super Quests, rewrote Mapping MEC's notification
-- into a second copy of Super Quests. A post's notification is now found by
-- its own line only, "[Read it on the blog](<its address>)", which no other
-- notification has.
--
-- Run in the Supabase SQL editor. Safe to re-run.

-- The post's address: its own page, built by the site (connectome.quest).
CREATE OR REPLACE FUNCTION public.ew_blog_link(p_slug TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT 'https://connectome.quest/blog/' || p_slug || '/' $$;

-- Is this notification the one announcing that post? Its own line, in the
-- current form or the two earlier ones.
CREATE OR REPLACE FUNCTION public.ew_blog_note_is(p_body TEXT, p_slug TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT position('[Read it on the blog](' || public.ew_blog_link(p_slug) || ')' IN p_body) > 0
      OR position('[Read it on the blog](https://connectome.quest/blog/post.html?p=' || p_slug || ')' IN p_body) > 0
      OR position('[Read the post](https://connectome.quest/blog/post.html?p=' || p_slug || ')' IN p_body) > 0
$$;

-- The notification's text for a post.
CREATE OR REPLACE FUNCTION public.ew_blog_note_text(p_slug TEXT, p_summary TEXT, p_body TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  post TEXT := COALESCE(p_body, '');
BEGIN
  -- The three things only the blog page understands, put into words a
  -- notification can show: a video becomes a link, a callout becomes a
  -- quote, and pictures in the text and their captions are left out (the
  -- notification shows the feature image).
  post := regexp_replace(post, '^@\[youtube\]\(([A-Za-z0-9_-]+)\)\s*$', '[Watch the video](https://www.youtube.com/watch?v=\1)', 'gn');
  post := regexp_replace(post, '^!> ?', '> ', 'gn');
  post := regexp_replace(post, '^\^ ?.*$', '', 'gn');
  post := regexp_replace(post, '^!\[[^\]]*\]\([^)]*\)\s*$', '', 'gn');
  RETURN COALESCE(NULLIF(btrim(p_summary), '') || E'\n\n', '')
      || '[Read it on the blog](' || public.ew_blog_link(p_slug) || ')'
      || CASE WHEN btrim(post) <> '' THEN E'\n\n---\n\n' || btrim(post) ELSE '' END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ew_announce_blog_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cover   TEXT := NULLIF(btrim(COALESCE(NEW.cover_url, '')), '');
  heading TEXT;
  words   TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' OR NEW.title IS NULL THEN RETURN NEW; END IF;
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

DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
CREATE TRIGGER blog_post_announce
  AFTER INSERT OR UPDATE OF status, cover_url, title, summary, body ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.ew_announce_blog_post();

-- ── Repair, 2026-10-28 ─────────────────────────────────────────────────────
-- Notification 2097 announced Mapping MEC (its chat line says so) and was
-- rewritten into a copy of Super Quests by the old rule. Put it back. Only
-- that one row is touched, and only while it is still the copy.
UPDATE public.notifications n
   SET title         = 'New on the blog: ' || p.title,
       body          = public.ew_blog_note_text(p.slug, p.summary, p.body),
       image_url     = NULLIF(btrim(COALESCE(p.cover_url, '')), ''),
       thumbnail_url = NULLIF(btrim(COALESCE(p.cover_url, '')), '')
  FROM public.blog_posts p
 WHERE n.id = 2097 AND p.slug = 'mapping-mec'
   AND n.title = 'New on the blog: Super Quests: MEC Inhibitory Interneurons';

-- To switch announcements off:
--   DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
