-- The Hunt Builder (Ames 2026-10-27): players help build a Hunt on the Sandbox.
-- Candidate cells (proofread through ordinary proofreading tasks), helpers' suggested merges and cuts
-- (kept exactly as the graph would have been sent them), and the admins' plantings.
-- Server only: RLS on, no policies. Read and written by the ewHunt function (functions/hunt_build.js).
-- Safe to run twice.

create table if not exists hunt_candidates (
  id              bigserial primary key,
  dataset         text not null default 'pinky_nf_v2',
  root            text not null,                            -- the cell's ID now
  task_id         bigint references proofreading_tasks(id) on delete set null,
  status          text not null default 'proofreading'
                  check (status in ('proofreading','proofread','suggesting','planting',
                                    'building','in_hunt','put_back','dropped')),
  merges_each     int  not null default 2 check (merges_each between 0 and 10),
  cuts_each       int  not null default 2 check (cuts_each between 0 and 10),
  helpers         jsonb not null default '[]'::jsonb,       -- invited player ids
  proofread_by    uuid,
  proofread_root  text,
  proofread_at    timestamptz,
  anchor_sv       text,                                     -- the soma's supervoxel (the claim's anchor)
  start_vox       jsonb,                                    -- the claim point, in the view's voxels
  protected_roots jsonb not null default '[]'::jsonb,       -- the cell, its old IDs, neighbors, pieces cut off
  hunt_id         bigint references hunts(id) on delete set null,
  admin_note      text not null default '',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists hunt_candidates_status on hunt_candidates (status);
create index if not exists hunt_candidates_hunt on hunt_candidates (hunt_id);

create table if not exists hunt_suggestions (
  id            bigserial primary key,
  candidate_id  bigint not null references hunt_candidates(id) on delete cascade,
  user_id       uuid not null,
  kind          text not null check (kind in ('merge','cut')),
  edit          jsonb not null,   -- merge [[sv, x, y, z], [sv, x, y, z]]; cut {"sources": [...], "sinks": [...]}; nm
  at_nm         jsonb not null,   -- the middle of its points, for Go there and the Hunt place
  note          text not null default '',
  status        text not null default 'open'
                check (status in ('open','taken_back','planted','skipped','undone','put_back')),
  operation_id  bigint,           -- the graph's operation when planted
  new_roots     jsonb,
  admin_note    text not null default '',
  done_by       uuid,
  done_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists hunt_suggestions_queue on hunt_suggestions (candidate_id, status, created_at);
create index if not exists hunt_suggestions_user on hunt_suggestions (user_id, candidate_id);

alter table hunt_candidates  enable row level security;
alter table hunt_suggestions enable row level security;
-- No policies: only the server (service role) reads and writes them.

-- Added 2026-10-27: a closing time for suggestions, and the cell players hunt (the cell after planting, or the
-- cell before proofreading when the Hunt comes from the proofreaders' own edits).
alter table hunt_candidates add column if not exists suggest_until timestamptz;
alter table hunt_candidates add column if not exists hunt_root text;
