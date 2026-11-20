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

-- ── Every vote counts as a Quest, and every vote is logged (Ames 2026-11-20:
-- "count each as a quest and also log them in case we want to separate at
-- some point"). Migration muller_glia_votes_count.
-- The log: one row per answer, change and undo, never edited or removed, so
-- the votes can be counted again any other way later.
create table if not exists muller_glia_vote_log (
  id bigserial primary key,
  cell_id bigint not null,
  user_id uuid not null,
  answer text,
  action text not null check (action in ('answer', 'change', 'undo')),
  at timestamptz not null default now()
);
create index if not exists muller_glia_vote_log_user on muller_glia_vote_log (user_id, at);
alter table muller_glia_vote_log enable row level security;
revoke all on muller_glia_vote_log from anon, authenticated;

create or replace function muller_glia_log_vote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into muller_glia_vote_log (cell_id, user_id, answer, action) values (new.cell_id, new.user_id, new.answer, 'answer');
  elsif tg_op = 'UPDATE' then
    if new.answer is distinct from old.answer then
      insert into muller_glia_vote_log (cell_id, user_id, answer, action) values (new.cell_id, new.user_id, new.answer, 'change');
    end if;
  else
    insert into muller_glia_vote_log (cell_id, user_id, answer, action) values (old.cell_id, old.user_id, old.answer, 'undo');
  end if;
  return null;
end;
$$;
revoke all on function muller_glia_log_vote() from public, anon, authenticated;
drop trigger if exists muller_glia_log_vote on muller_glia_answers;
create trigger muller_glia_log_vote after insert or update or delete on muller_glia_answers
  for each row execute function muller_glia_log_vote();

-- The Quests board (Profile and the leaderboard's Quests tab): one Quest per
-- glia a player has an answer on (an undo takes it back, a change does not
-- add one), dated by the answer's day in New York, named by their Pyr name.
-- p_quest 'retina_cilia' is the Cilia Quest exactly as before,
-- 'retina_muller_glia' the glia votes alone, 'all' both together.
create or replace function public.ew_quest_board(p_quest text)
 returns table(name text, today integer, week integer, alltime integer)
 language sql stable security definer set search_path to ''
as $function$
  WITH t AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today),
  r AS (
    SELECT lower(regexp_replace(s.annotator, '[^[:alnum:]]', '', 'g')) AS k, btrim(s.annotator) AS n,
           CASE WHEN s.quest_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(s.quest_date, 'MM/DD/YYYY') END AS d
    FROM public.ew_quest_sheet_rows s
    WHERE p_quest IN ('retina_cilia', 'all') AND s.quest = 'retina_cilia' AND s.annotator <> '' AND s.status ~* '^\s*(cilium annotated|no cilium)'
    UNION ALL
    SELECT lower(regexp_replace(coalesce(nullif(btrim(u.display_name), ''), u.username, ''), '[^[:alnum:]]', '', 'g')),
           coalesce(nullif(btrim(u.display_name), ''), u.username),
           (a.answered_at AT TIME ZONE 'America/New_York')::date
    FROM public.muller_glia_answers a JOIN public.users u ON u.id = a.user_id
    WHERE p_quest IN ('retina_muller_glia', 'all')
  )
  SELECT min(r.n),
         (count(*) FILTER (WHERE r.d = t.today))::int,
         (count(*) FILTER (WHERE r.d > t.today - 7 AND r.d <= t.today))::int,
         count(*)::int
  FROM r, t WHERE r.k <> '' GROUP BY r.k;
$function$;
