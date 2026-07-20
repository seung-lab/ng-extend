-- ============================================================================
-- help_responses — one row per reply to a Second Opinion request
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- `help_requests` originally carried a SINGLE response on the request row
-- (`response_note`, `response_url`, `response_annotation_layer`). Notes were
-- appended into one text blob, but the URL and annotation layer were
-- OVERWRITTEN on every reply — so only the most recent share link survived and
-- earlier ones were silently lost.
--
-- A request is a thread: many people can reply, each with their own share link,
-- annotation layer and screenshot. That's a one-to-many relationship, so it
-- gets its own table.
--
-- Also adds `share_url` / `annotation_layer` to `help_requests` so the ORIGINAL
-- request can carry a share link + annotation layer (previously only responses
-- could).
--
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

-- ── 1. Let the original request carry a share link + annotation layer ───────
alter table if exists help_requests add column if not exists share_url        text;
alter table if exists help_requests add column if not exists annotation_layer text;

-- ── 2. The responses table ──────────────────────────────────────────────────
create table if not exists help_responses (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references help_requests(id) on delete cascade,
  user_id          uuid references users(id) on delete set null,
  user_name        text,
  note             text,
  -- Each response keeps its OWN share link + annotation layer. This is the
  -- whole point of the table: links accumulate instead of overwriting.
  url              text,
  annotation_layer text,
  screenshot_url   text,
  -- True when this particular reply is the one that resolved the request.
  -- `help_requests.resolved` remains the authoritative flag for the thread.
  resolved         boolean default false,
  created_at       timestamptz default now()
);

create index if not exists help_responses_request_idx
  on help_responses (request_id, created_at);
create index if not exists help_responses_user_idx
  on help_responses (user_id);

-- ── 3. Backfill existing single responses into the thread ───────────────────
-- Guarded so re-running never duplicates. NOTE: legacy `response_note` may
-- already contain several appended replies separated by '---'; we cannot split
-- those apart reliably, so the whole blob is preserved as one historical row.
insert into help_responses
  (request_id, user_id, user_name, note, url, annotation_layer, resolved, created_at)
select
  hr.id,
  hr.resolved_by,
  hr.resolved_by_name,
  hr.response_note,
  hr.response_url,
  hr.response_annotation_layer,
  coalesce(hr.resolved, false),
  coalesce(hr.resolved_at, hr.created_at, now())
from help_requests hr
where (hr.response_note is not null
    or hr.response_url is not null
    or hr.response_annotation_layer is not null)
  and not exists (
    select 1 from help_responses r where r.request_id = hr.id
  );

-- The legacy `response_*` columns on help_requests are intentionally LEFT IN
-- PLACE (not dropped) so an older client build keeps working during rollout.
-- Once every client reads from help_responses they can be dropped:
--   alter table help_requests drop column response_note,
--                             drop column response_url,
--                             drop column response_annotation_layer;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- NOTE: this follows the existing project convention of fully-permissive
-- policies, because the client uses the anon key and all gating is currently
-- done in JS. This perpetuates the known RLS debt tracked in HANDOFF.md §15 —
-- when real row-level security is introduced, this table must be tightened
-- along with the rest.
alter table help_responses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'help_responses' and policyname = 'help_responses_all'
  ) then
    create policy help_responses_all on help_responses
      for all using (true) with check (true);
  end if;
end $$;

-- ── 5. Realtime (so replies appear live, like help_requests) ─────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'help_responses'
  ) then
    alter publication supabase_realtime add table help_responses;
  end if;
end $$;
