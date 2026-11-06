-- Blog galleries and the drafts backup (Ames 2026-11-05). Run in the
-- Supabase SQL editor. Safe to re-run.

-- 1. A post's notification leaves out the lines only the blog page uses:
--    galleries (@[gallery]), picture links (@[link](...)), phone pictures
--    (@[phone](...)), sized pictures (![...](...){small}) and longer
--    descriptions (^^ ...), as it already left out pictures and captions.
CREATE OR REPLACE FUNCTION public.ew_blog_note_text(p_slug TEXT, p_summary TEXT, p_body TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  post TEXT := COALESCE(p_body, '');
BEGIN
  post := regexp_replace(post, '^@\[youtube\]\(([A-Za-z0-9_-]+)\)\s*$', '[Watch the video](https://www.youtube.com/watch?v=\1)', 'gn');
  post := regexp_replace(post, '^!> ?', '> ', 'gn');
  post := regexp_replace(post, '^\^.*$', '', 'gn');
  post := regexp_replace(post, '^!\[[^\]]*\]\([^)]*\)(\{[a-z]+\})?\s*$', '', 'gn');
  post := regexp_replace(post, '^@\[gallery\]\s*$', '', 'gn');
  post := regexp_replace(post, '^@\[(link|phone)\]\([^)]*\)\s*$', '', 'gn');
  post := regexp_replace(post, '\n{3,}', E'\n\n', 'g');
  RETURN COALESCE(NULLIF(btrim(p_summary), '') || E'\n\n', '')
      || '[Read it on the blog](' || public.ew_blog_link(p_slug) || ')'
      || CASE WHEN btrim(post) <> '' THEN E'\n\n---\n\n' || btrim(post) ELSE '' END;
END
$fn$;

-- 2. The blog backup (github.com/amyleesterling/pyr-blog-backup, private)
--    copies every post, drafts included, once an hour. Drafts are private,
--    so this hands them only to the backup's own key, which lives in that
--    repository's secrets. Only the key's fingerprint is here. Read only.
CREATE OR REPLACE FUNCTION public.blog_backup(p_key TEXT) RETURNS SETOF public.blog_posts
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF p_key IS NULL OR encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> 'c1e63f427a7813ea4864185777155ea7434caffc0cc8b1629238ead07fd50b23' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.blog_posts ORDER BY created_at;
END
$fn$;
REVOKE ALL ON FUNCTION public.blog_backup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_backup(TEXT) TO anon, authenticated;
