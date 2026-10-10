-- A published blog post announces itself (Ames 2026-10-10).
--
-- When a post becomes published, a notification goes to every player:
--   title  "New on the blog: <the post's title>"
--   body   the post's summary, then a link to the post
--   image  the post's feature image, if it has one
-- and it is flagged to be posted in chat as well. The game already posts a
-- flagged notification to chat, once, from an admin's open game (the same
-- path "Also post to chat" in the Admin Hub uses), so nothing else changes.
--
-- It is a database trigger, so it does not matter how the post was published:
-- the Blog Editor, or SQL. Each post is announced once: editing a published
-- post, or unpublishing and publishing it again, does not announce it twice.
-- A feature image added or changed after publishing is carried over to the
-- notification already sent.
--
-- Run in the Supabase SQL editor. Safe to re-run. It announces posts published
-- from now on; nothing already published is announced.

CREATE OR REPLACE FUNCTION public.ew_announce_blog_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  link  TEXT;
  cover TEXT := NULLIF(btrim(COALESCE(NEW.cover_url, '')), '');
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' OR NEW.title IS NULL THEN RETURN NEW; END IF;
  link := 'https://connectome.quest/blog/post.html?p=' || NEW.slug;

  -- Already announced: only keep its picture in step with the post's.
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE position(link IN n.body) > 0) THEN
    UPDATE public.notifications n
       SET image_url = cover, thumbnail_url = cover
     WHERE position(link IN n.body) > 0
       AND n.image_url IS DISTINCT FROM cover;
    RETURN NEW;
  END IF;
  -- An edit to a post that was already out before this trigger existed.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'published' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications
    (title, body, image_url, thumbnail_url, target_type, send_at, post_to_chat, created_by)
  VALUES (
    'New on the blog: ' || NEW.title,
    COALESCE(NULLIF(btrim(NEW.summary), '') || E'\n\n', '') || '[Read the post](' || link || ')',
    cover, cover, 'all',
    -- a post dated ahead is announced when its date arrives
    GREATEST(NOW(), COALESCE(NEW.published_at, NOW())),
    TRUE, NEW.author_id);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
CREATE TRIGGER blog_post_announce
  AFTER INSERT OR UPDATE OF status, cover_url ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.ew_announce_blog_post();

-- To switch it off:
--   DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
