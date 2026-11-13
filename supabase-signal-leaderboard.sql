-- Signal Controller leaderboard (2026-11-13).
-- Every level's best times and how far each player has got, for players
-- with no account: the game makes up a callsign for each browser.
--
-- A round is timed here as well as in the game: signal_run_begin as the
-- countdown ends, signal_run_finish as the level is won. Rounds no hand
-- played are flagged and left off the board; they stay in the table for
-- review. Nothing reads or writes the tables directly: row level security
-- is on with no policies, and the three functions are the only way in.
--
-- Safe to run more than once.

create table if not exists public.signal_levels (
  level  int primary key,
  min_ms int not null          -- faster than this the circuit cannot be won: spikes take this long to travel
);
insert into public.signal_levels (level, min_ms) values
  (1, 3000), (2, 3000), (3, 3000), (4, 3000), (5, 3000), (6, 3000), (7, 2500), (8, 3500), (9, 5000)
on conflict (level) do nothing;

create table if not exists public.signal_run_starts (
  id         uuid primary key default gen_random_uuid(),
  level      int not null,
  client     text not null,
  ip_hash    text,
  started_at timestamptz not null default now(),
  used       boolean not null default false
);
create index if not exists signal_run_starts_client_idx on public.signal_run_starts (client, started_at desc);
create index if not exists signal_run_starts_ip_idx     on public.signal_run_starts (ip_hash, started_at desc);
create index if not exists signal_run_starts_time_idx   on public.signal_run_starts (started_at);

create table if not exists public.signal_runs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  level       int not null,
  client      text not null,
  player      text not null,
  time_ms     int not null,       -- the game's clock, countdown's end to the winning spike
  wall_ms     int not null,       -- this server's clock over the same round
  charges     int not null,
  stars       int not null,
  score       int not null,
  features    jsonb not null default '{}'::jsonb,
  flagged     boolean not null default false,
  flag_reason text,
  ip_hash     text,
  build       text
);
create index if not exists signal_runs_board_idx  on public.signal_runs (level, time_ms) where not flagged;
create index if not exists signal_runs_client_idx on public.signal_runs (client, level);

alter table public.signal_levels     enable row level security;
alter table public.signal_run_starts enable row level security;
alter table public.signal_runs       enable row level security;

-- A round begins: the server notes the time and hands back the round's id.
create or replace function public.signal_run_begin(p_level int, p_client text)
returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ip text;
  v_id uuid;
  v_recent int;
begin
  if p_level is null or p_level < 1 or p_level > 50
     or p_client is null or char_length(p_client) < 8 or char_length(p_client) > 64 then
    return null;
  end if;
  begin
    v_ip := md5(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''));
  exception when others then
    v_ip := null;
  end;
  -- twenty starts a minute from one browser or one address is not a person playing
  select count(*) into v_recent
    from public.signal_run_starts
   where started_at > now() - interval '1 minute'
     and (client = p_client or (v_ip is not null and ip_hash = v_ip));
  if v_recent >= 20 then
    return null;
  end if;
  insert into public.signal_run_starts (level, client, ip_hash)
  values (p_level, p_client, v_ip)
  returning id into v_id;
  if random() < 0.02 then      -- now and then, yesterday's starts go
    delete from public.signal_run_starts where started_at < now() - interval '1 day';
  end if;
  return v_id;
end
$fn$;

-- A round is won: checked, kept, and ranked if a hand played it.
create or replace function public.signal_run_finish(
  p_run uuid, p_player text, p_time_ms int, p_charges int, p_stars int, p_score int,
  p_features jsonb default '{}'::jsonb, p_build text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  s        public.signal_run_starts%rowtype;
  f        jsonb := coalesce(p_features, '{}'::jsonb);
  v_wall   int;
  v_min    int;
  v_player text;
  v_why    text := '';
  v_best   int;
  v_rank   int;
  v_of     int;
  v_shots  int;
begin
  select * into s from public.signal_run_starts where id = p_run and not used for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.signal_run_starts set used = true where id = p_run;
  if p_time_ms is null or p_time_ms < 200 or p_time_ms > 300000 then
    return jsonb_build_object('ok', false);
  end if;

  v_wall   := (extract(epoch from (now() - s.started_at)) * 1000)::int;
  v_player := btrim(left(regexp_replace(coalesce(p_player, ''), '[^A-Za-z0-9 _-]', '', 'g'), 24));
  if char_length(v_player) < 2 then v_player := 'Guest'; end if;
  select min_ms into v_min from public.signal_levels where level = s.level;
  v_min   := coalesce(v_min, 2000);
  v_shots := coalesce((f ->> 'shots')::int, 0);

  -- Bot rounds. Each test is one no hand fails; a round that fails any is flagged.
  if p_time_ms < v_min then
    v_why := v_why || 'faster than the circuit allows; ';
  end if;
  if v_wall < p_time_ms - 1500 then
    v_why := v_why || 'the game clock ran ahead of the real one; ';
  end if;
  if coalesce((f ->> 'untrusted')::int, 0) > 0 then
    v_why := v_why || 'shots made by a script, not a press; ';
  end if;
  if coalesce((f ->> 'tampered')::boolean, false) then
    v_why := v_why || 'the test hook was used; ';
  end if;
  if v_shots < 2 or coalesce(p_charges, 0) < 2 then
    v_why := v_why || 'too few shots to win; ';
  end if;
  if v_shots >= 6 and coalesce((f ->> 'repeat_ms')::int, 999) < 6 then
    v_why := v_why || 'the gaps between shots repeat to the millisecond; ';
  end if;
  if v_shots >= 4
     and coalesce((f ->> 'moves')::int, 0) = 0
     and coalesce((f ->> 'keys')::int, 0) = 0
     and coalesce((f ->> 'touches')::int, 0) = 0 then
    v_why := v_why || 'no pointer moved, no key or finger pressed; ';
  end if;

  insert into public.signal_runs (level, client, player, time_ms, wall_ms, charges, stars, score, features, flagged, flag_reason, ip_hash, build)
  values (s.level, s.client, v_player, p_time_ms, v_wall, coalesce(p_charges, 0), coalesce(p_stars, 0), coalesce(p_score, 0),
          f, v_why <> '', nullif(v_why, ''), s.ip_hash, left(coalesce(p_build, ''), 40));

  if v_why <> '' then
    return jsonb_build_object('ok', true, 'ranked', false);   -- says nothing of why
  end if;

  select min(time_ms) into v_best
    from public.signal_runs where level = s.level and client = s.client and not flagged;
  select count(*) + 1 into v_rank
    from (select client, min(time_ms) as best
            from public.signal_runs
           where level = s.level and not flagged and client <> s.client
           group by client) b
   where b.best < v_best;
  select count(distinct client) into v_of
    from public.signal_runs where level = s.level and not flagged;
  return jsonb_build_object('ok', true, 'ranked', true, 'rank', v_rank, 'of', v_of,
                            'best_ms', v_best, 'new_best', v_best = p_time_ms);
end
$fn$;

-- The board: a level's best times (each player's best), and how far each player has got.
create or replace function public.signal_board(p_level int default null, p_limit int default 20)
returns jsonb
language sql stable security definer set search_path = '' as $fn$
  with best as (
    select distinct on (client, level) client, level, player, time_ms, charges, stars, created_at
      from public.signal_runs
     where not flagged
     order by client, level, time_ms asc, created_at asc
  ), overall as (
    select client,
           (array_agg(player order by created_at desc))[1] as player,
           count(*)::int        as levels,
           sum(time_ms)::bigint as total_ms
      from best
     group by client
  )
  select jsonb_build_object(
    'level', case when p_level is null then null else (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
        from (select player, time_ms, charges, stars
                from best where level = p_level
               order by time_ms asc, created_at asc
               limit least(greatest(coalesce(p_limit, 20), 1), 100)) x) end,
    'overall', (
      select coalesce(jsonb_agg(y), '[]'::jsonb)
        from (select player, levels, total_ms
                from overall
               order by levels desc, total_ms asc
               limit least(greatest(coalesce(p_limit, 20), 1), 100)) y),
    'players', (select count(*) from overall)
  );
$fn$;

revoke all on function public.signal_run_begin(int, text) from public;
revoke all on function public.signal_run_finish(uuid, text, int, int, int, int, jsonb, text) from public;
revoke all on function public.signal_board(int, int) from public;
grant execute on function public.signal_run_begin(int, text) to anon, authenticated;
grant execute on function public.signal_run_finish(uuid, text, int, int, int, int, jsonb, text) to anon, authenticated;
grant execute on function public.signal_board(int, int) to anon, authenticated;

-- To look over the flagged rounds:
--   select id, created_at, level, player, time_ms, wall_ms, flag_reason, features
--     from public.signal_runs where flagged order by created_at desc limit 50;
-- To take a round off the board by hand, or put one back:
--   update public.signal_runs set flagged = true,  flag_reason = 'removed by hand' where id = 123;
--   update public.signal_runs set flagged = false, flag_reason = null              where id = 123;
