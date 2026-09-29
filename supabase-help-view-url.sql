-- EyeWire II: a help request carries a link to the requester's view (Amy 2026-09-29).
-- One https link, at most 2000 characters. Safe to run more than once.
ALTER TABLE public.help_requests ADD COLUMN IF NOT EXISTS view_url text;
ALTER TABLE public.help_requests DROP CONSTRAINT IF EXISTS help_requests_view_url_https;
ALTER TABLE public.help_requests ADD CONSTRAINT help_requests_view_url_https
  CHECK (view_url IS NULL OR (view_url ~ '^https://[^[:space:]"''<>]+$' AND length(view_url) <= 2000));
