-- Muller Glia Quest (Ames 2026-11-19: "Go, build it for real").
-- Applied to project eyewire-ii as migration muller_glia_quest.
--
-- The lab's All Glia tab (Proofread Cells Main List, gid 2051269861) is copied
-- into muller_glia_cells by scripts/muller-glia-import.py; the sheet stays the
-- lab's record. Players never touch these tables: every read and write goes
-- through the ewMullerGlia function (functions/muller-glia.js), which knows the
-- player from their token. RLS on, no policies: only the service key reaches them.

create table if not exists muller_glia_cells (
  id            bigserial primary key,
  sheet_index   text not null unique,          -- the sheet's Index, e.g. F1234
  segment_id    text not null,                 -- Latest SegID at copy time
  nucleus_id    text,                          -- Latest NucID (Retina nuclei are their own segments)
  nuc_coords    text,                          -- "x,y,z" viewer voxels
  soma_coords   text,                          -- where Open goes and the split check reads
  guess         text,                          -- Proofreader Cell Type Guess
  stage         smallint not null check (stage in (1, 2)),
  pair_segment  text,                          -- Stage 2: the segment it shares with other glia
  copied_at     timestamptz not null default now()
);
create index if not exists muller_glia_cells_stage on muller_glia_cells (stage, id);
create index if not exists muller_glia_cells_pair on muller_glia_cells (pair_segment) where pair_segment is not null;

-- Stage 1: one answer per player per cell.
create table if not exists muller_glia_answers (
  cell_id     bigint not null references muller_glia_cells (id) on delete cascade,
  user_id     uuid   not null references users (id) on delete cascade,
  answer      text   not null check (answer in ('yes', 'no', 'unsure')),
  answered_at timestamptz not null default now(),
  primary key (cell_id, user_id)
);
create index if not exists muller_glia_answers_user on muller_glia_answers (user_id);

-- Stage 2: a split the server checked (every soma of the group in its own root).
create table if not exists muller_glia_splits (
  pair_segment text primary key,
  user_id      uuid not null references users (id) on delete cascade,
  roots        text[] not null,
  checked_at   timestamptz not null default now()
);

alter table muller_glia_cells   enable row level security;
alter table muller_glia_answers enable row level security;
alter table muller_glia_splits  enable row level security;

-- Each Stage 1 cell with its tally and verdict: confirmed at 3 yes, flagged
-- for the lab at 2 no, open otherwise.
create or replace view muller_glia_tally with (security_invoker = on) as
select c.id, c.sheet_index, c.segment_id, c.soma_coords, c.guess,
       count(a.*) filter (where a.answer = 'yes')    as yes,
       count(a.*) filter (where a.answer = 'no')     as no,
       count(a.*) filter (where a.answer = 'unsure') as unsure,
       count(a.*)                                     as answers,
       case when count(a.*) filter (where a.answer = 'yes') >= 3 then 'confirmed'
            when count(a.*) filter (where a.answer = 'no')  >= 2 then 'flagged'
            else 'open' end as verdict
from muller_glia_cells c
left join muller_glia_answers a on a.cell_id = c.id
where c.stage = 1
group by c.id;

revoke all on muller_glia_cells, muller_glia_answers, muller_glia_splits, muller_glia_tally from anon, authenticated;

-- The next open Stage 1 cells this player has not answered, the ones closest
-- to a verdict first (applied as migration muller_glia_next).
create or replace function muller_glia_next(p_user uuid, p_n int)
returns setof muller_glia_tally
language sql stable security invoker set search_path = public as $$
  select t.* from muller_glia_tally t
  where t.verdict = 'open'
    and not exists (select 1 from muller_glia_answers a where a.cell_id = t.id and a.user_id = p_user)
  order by t.answers desc, t.id
  limit least(greatest(p_n, 1), 20);
$$;
revoke all on function muller_glia_next(uuid, int) from public, anon, authenticated;
grant execute on function muller_glia_next(uuid, int) to service_role;
