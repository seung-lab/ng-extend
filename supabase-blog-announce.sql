-- A published blog post announces itself (Ames 2026-10-10).
--
-- When a post becomes published, a notification goes to every player:
--   title  "New on the blog: <the post's title>"
--   body   the post's summary, then a link to the post
--   image  the post's cover, if it has one
-- and it is flagged to be posted in chat as well. The game already posts a
-- flagged notification to chat, once, from an admin's open game (the same
-- path "Also post to chat" in the Admin Hub uses), so nothing else changes.
--
-- It is a database trigger, so it does not matter how the post was published:
-- the Blog Editor, or SQL. Each post is announced once: editing a published
-- post, or unpublishing and publishing it again, does not announce it twice.
--
-- Run in the Supabase SQL editor. Safe to re-run. It announces posts published
-- from now on; nothing already published is announced.

CREATE OR REPLACE FUNCTION public.ew_announce_blog_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  link TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  -- an edit to a post that was already out
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' OR NEW.title IS NULL THEN RETURN NEW; END IF;

  link := 'https://connectome.quest/blog/post.html?p=' || NEW.slug;
  -- once per post
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE position(link IN n.body) > 0) THEN RETURN NEW; END IF;

  INSERT INTO public.notifications
    (title, body, image_url, thumbnail_url, target_type, send_at, post_to_chat, created_by)
  VALUES (
    'New on the blog: ' || NEW.title,
    COALESCE(NULLIF(btrim(NEW.summary), '') || E'\n\n', '') || '[Read the post](' || link || ')',
    NEW.cover_url, NEW.cover_url, 'all',
    -- a post dated ahead is announced when its date arrives
    GREATEST(NOW(), COALESCE(NEW.published_at, NOW())),
    TRUE, NEW.author_id);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
CREATE TRIGGER blog_post_announce
  AFTER INSERT OR UPDATE OF status ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.ew_announce_blog_post();

-- To switch it off:
--   DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
