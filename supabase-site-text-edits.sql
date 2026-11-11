-- Every admin edit of an in-game text (site_texts), before and after, kept so
-- the note Ames gets for it can put the old text back (Ames 2026-11-09:
-- "the notif before and after is ok and I can revert or open to edit from
-- there"). Written only by ewCommunityData with the service key
-- (functions/index.js); admins read it through the same gateway
-- (functions/community-data.js). Ames's own edits are not kept: they send no note.
create table if not exists public.site_text_edits (
  id bigserial primary key,
  key text not null,
  old_body text,          -- null: the code's own wording showed
  new_body text,          -- null: put back to the code's wording
  editor_name text,
  editor_email text,
  created_at timestamptz not null default now()
);
create index if not exists site_text_edits_key on public.site_text_edits (key, created_at desc);
alter table public.site_text_edits enable row level security;
-- No policies: the browser's key reads and writes nothing here.
revoke all on public.site_text_edits from anon, authenticated;
