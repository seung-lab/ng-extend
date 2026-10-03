-- ============================================================================
-- Blog (2026-10-02): posts for connectome.quest/blog, written in the game by a
-- short list of authors (Ames: "me, celia, and marissa can post").
--
-- blog_posts   Anyone may read PUBLISHED posts (the public site reads them with
--              the public key). Drafts and every write go through the
--              ewCommunityData Cloud Function, which checks blog_authors
--              (functions/community-data.js).
-- blog_authors Who may write. Private: no access with the public key.
--
-- Safe to re-run. To add an author later:
--   insert into public.blog_authors (user_id)
--   select id from public.users where username = 'their_username'
--   on conflict do nothing;
-- ============================================================================

create table if not exists public.blog_authors (
  user_id  uuid primary key references public.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id           bigint generated always as identity primary key,
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title        text not null check (length(title) between 1 and 160),
  summary      text check (summary is null or length(summary) <= 400),
  body         text not null check (length(body) <= 100000),
  cover_url    text,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  author_id    uuid references public.users(id) on delete set null,
  author_name  text not null default 'EyeWire team',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists blog_posts_published_idx on public.blog_posts (published_at desc) where status = 'published';

alter table public.blog_authors enable row level security;
alter table public.blog_posts   enable row level security;
revoke all on public.blog_authors from anon, authenticated;
revoke all on public.blog_posts   from anon, authenticated;

-- The one thing the public key may do: read published posts.
grant select on public.blog_posts to anon, authenticated;
drop policy if exists blog_posts_public_read on public.blog_posts;
create policy blog_posts_public_read on public.blog_posts
  for select to anon, authenticated using (status = 'published');

-- Authors: Ames, Celia, Marissa.
insert into public.blog_authors (user_id)
select id from public.users where username in ('amy', 'celiad', 'm_sorek')
on conflict do nothing;

-- The first post, moved here from the static page it launched as.
insert into public.blog_posts (slug, title, summary, body, status, author_id, author_name, published_at)
select 'scripts-and-api',
  'Write your own scripts for EyeWire II',
  'EyeWire II now has a small set of tools for player scripts, plus a guide to get you started with Tampermonkey. Also this week: split screen replaces the 4 panel view, your view saves itself, and the fly nerve cord joins the dataset list.',
  $post$Players of the original EyeWire built some of its best features themselves. Bigger annotation dots, extra statistics, faster ways to get around: many of them started as a script one player wrote for their own browser and then shared.

EyeWire II now supports that properly. There is a guide for getting started, and a small set of tools made for scripts to use.

## What a script is

A script is a small piece of code that changes the game on your computer only. It runs through Tampermonkey, a free browser extension. Nobody else sees your script, and you do not need permission to write one.

## What scripts can use

Until now a script had to reach into the inner workings of the game, which change with almost every update. So scripts broke often. The new tools are the parts we promise to keep working:

- **Your cells and your view.** The cells you have selected, the cell under the crosshairs, your claims, and where you are looking.
- **Events.** Run your code when you claim, release or complete a cell, when your selection changes, or when you switch datasets.
- **A button and a panel.** Add your own button to the top bar and your own side panel.
- **Annotation layers.** Make a layer of your own and add points and lines to it.
- **Settings.** Save your script's settings in your browser.

Everything else is still open. Scripts can reach the viewer directly for anything the tools do not cover.

[Open the scripts guide](https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/scripts.html)

The guide has setup steps, the full list of tools, and six example scripts you can copy.

## A word on safety

A script runs as you. It can do anything you can do in the game, including editing cells with your sign in. Scripts you write yourself are fine. Before you install a script from someone else, read it, or ask in chat whether others use it. Scripts are made by players and are not reviewed by the EyeWire team.

## Tell us what is missing

We asked the script writers on the forum what they need, and the answer was that scripts grow out of whatever rough edge someone notices that week. So the list of tools starts small on purpose. If your script needs something that is not there, [ask on the forum](https://connectome.quest/forum.html) and we will add it.

## Also new this week

- **Split screen replaces the 4 panel view.** Press Space to flip between split screen and the single panel under your mouse. Nothing lands you in 4 panel any more.
- **Your view saves itself.** Annotations, layers and position are saved to your account as you work. Open the game on any computer and it offers to pick up where you left off.
- **Save view on a claim.** In the Cell Library, the cell you are working on has a Save view button, so your annotations stay with the cell.
- **The fly brain and nerve cord.** BANC is now in the dataset switcher, and the three MICrONS versions share one card.
- **Claim several cells at once.** The Cell Library can fill your claims from the Available list in one click.
- **A faster Cell Library.** Your own cells load first, and long lists draw 200 rows at a time.$post$,
  'published',
  (select id from public.users where username = 'amy'),
  'Amy and the EyeWire team',
  '2026-10-02T16:00:00Z'
where not exists (select 1 from public.blog_posts where slug = 'scripts-and-api');

-- Check: expect authors = 3, posts = 1, both rls_enabled = true, policies = 1.
select
  (select count(*) from public.blog_authors) as authors,
  (select count(*) from public.blog_posts)   as posts,
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('blog_posts', 'blog_authors')) as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('blog_posts', 'blog_authors')) as policies;
