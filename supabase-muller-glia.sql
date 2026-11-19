-- Muller Glia Quest: PROPOSAL, NOT RUN. Ames runs this in the Supabase SQL
-- editor only after she says go (2026-11-19 mockup, branch claude/muller-glia-quest).
--
-- The lab's All Glia tab (Proofread Cells Main List, gid 2051269861) is copied
-- once into muller_glia_cells by a script; the sheet stays the lab's record.
-- Players never write these tables directly: answers and splits go through the
-- ewCommunityData gateway, which derives the player server side (the same
-- model as the other protected tables). RLS is on with no anon policies.

create table if not exists muller_glia_cells (
  id            bigserial primary key,
  sheet_index   text not null unique,          -- the sheet's Index, e.g. F1234
  segment_id    text not null,                 -- Latest SegID at copy time
  nucleus_id    text,                          -- Latest NucID
  nuc_coords    text,                          -- "x,y,z" voxels, as in the sheet
  soma_coords   text,
  guess         text,                          -- Proofreader Cell Type Guess
  lab_type      text,                          -- Cell Type, when the lab set one
  stage         smallint not null default 1 check (stage in (1, 2)),
  pair_segment  text,                          -- Stage 2: the segment it shares with another nucleus
  copied_at     timestamptz not null default now()
);
create index if not exists muller_glia_cells_stage on muller_glia_cells (stage);
create index if not exists muller_glia_cells_pair on muller_glia_cells (pair_segment) where pair_segment is not null;

-- Stage 1: one answer per player per cell.
create table if not exists muller_glia_answers (
  cell_id     bigint not null references muller_glia_cells (id) on delete cascade,
  user_id     uuid   not null references users (id) on delete cascade,
  answer      text   not null check (answer in ('yes', 'no', 'unsure')),
  answered_at timestamptz not null default now(),
  primary key (cell_id, user_id)
);

-- Stage 2: a split the server checked (each nucleus in its own current root).
create table if not exists muller_glia_splits (
  pair_segment text not null,
  user_id      uuid not null references users (id) on delete cascade,
  root_a       text not null,
  root_b       text not null,
  checked_at   timestamptz not null default now(),
  primary key (pair_segment, user_id)
);

alter table muller_glia_cells   enable row level security;
alter table muller_glia_answers enable row level security;
alter table muller_glia_splits  enable row level security;

-- Proposed rule for a verdict (a view, so it can change without a migration):
-- confirmed Muller at 3 yes, flagged for the lab at 2 no.
create or replace view muller_glia_verdicts as
select c.id, c.sheet_index, c.segment_id,
       count(*) filter (where a.answer = 'yes')    as yes,
       count(*) filter (where a.answer = 'no')     as no,
       count(*) filter (where a.answer = 'unsure') as unsure,
       case when count(*) filter (where a.answer = 'yes') >= 3 then 'confirmed'
            when count(*) filter (where a.answer = 'no')  >= 2 then 'flagged'
            else 'open' end as verdict
from muller_glia_cells c
left join muller_glia_answers a on a.cell_id = c.id
group by c.id;
