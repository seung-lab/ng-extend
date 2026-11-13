-- Signal Controller leaderboard, second version (2026-11-13).
-- Every level's best times and how far each player has got, for players
-- with no account: the game makes up a callsign for each browser.
--
-- Safe to run more than once, and over the first version: it upgrades the
-- tables in place and keeps the rounds already played.
--
-- What it lets through, and what it does not:
--   * Nothing reads or writes the tables directly. Row level security is on
--     with no policies, the web roles hold no rights on the tables, and the
--     four functions at the foot are the only way in.
--   * A name on the board is always one of the game's own callsigns (two
--     words from its lists and a number). Nothing a visitor types is ever
--     stored as a name or shown.
--   * A round is timed here as well as in the game (signal_run_begin as the
--     countdown ends, signal_run_finish as the level is won), and checked
--     against what the circuit allows: no faster than its spikes can travel,
--     no longer than the level's clock, no more charges than the round could
--     have had, no fewer than the level needs.
--   * Rounds no hand played (a script's clicks, the test hook, a pointer
--     that pressed in two places with no move between) are flagged and left
--     off the board. They stay in the table for 30 days, for review.
--   * Starts are rationed: 20 a minute for one browser, 120 for one address
--     (a classroom shares one), 600 for everybody, 30,000 a day, and none
--     once the table holds 200,000 rounds. Past a limit the game still
--     plays; its rounds are not ranked.
--   * An address is kept only as a hash salted with a secret that changes
--     every day, and wiped after two days.
-- What it cannot do: tell a real round from one a programmer made up with
-- care and sent straight to these functions. Such a round can claim no time
-- the circuit does not allow, and the rounds worth a look are listed by the
-- first query at the foot of this file.

/* ── tables ── */
create table if not exists public.signal_levels (
  level  int primary key,
  min_ms int not null          -- faster than this the circuit cannot be won
);
alter table public.signal_levels
  add column if not exists max_ms      int,   -- the level's clock
  add column if not exists par         int,   -- three stars at this many charges or fewer
  add column if not exists min_charges int;   -- fewer than this cannot win it
-- min_ms and min_charges are proved from the game's rules, with a margin
-- (six charges to start and one more every 1.5 s; a beam lands after 0.3 s;
-- a cell rests 0.4 s between spikes; E1's spike takes 1.50 s to reach the
-- gold cell, the others longer). A round under them is not a fast player.
insert into public.signal_levels (level, min_ms, max_ms, par, min_charges) values
  (1, 2900, 60000,  6, 6),
  (2, 2900, 60000,  6, 6),
  (3, 2900, 60000, 12, 6),
  (4, 3200, 75000, 13, 7),
  (5, 6000, 90000, 18, 9),
  (6, 2900, 75000,  8, 6),
  (7, 6500, 75000,  9, 9),
  (8, 2900, 75000,  6, 6),
  (9, 6000, 90000, 14, 9)
on conflict (level) do update
  set min_ms = excluded.min_ms, max_ms = excluded.max_ms, par = excluded.par, min_charges = excluded.min_charges;

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
alter table public.signal_runs add column if not exists note text;   -- ranked, but worth a look
create index if not exists signal_runs_board_idx   on public.signal_runs (level, time_ms) where not flagged;
create index if not exists signal_runs_client_idx  on public.signal_runs (client, level);
create index if not exists signal_runs_flagged_idx on public.signal_runs (created_at) where flagged;
create index if not exists signal_runs_ip_idx      on public.signal_runs (created_at) where ip_hash is not null;

-- each browser's callsign, as the board shows it
create table if not exists public.signal_players (
  client     text primary key,
  player     text not null,
  changed_at timestamptz not null default now()
);
-- the day's secret, for hashing addresses
create table if not exists public.signal_salts (
  day  date primary key,
  salt text not null
);
-- the day's count of starts, and how many rounds the table held as the day began
create table if not exists public.signal_days (
  day    date primary key,
  starts int not null default 0,
  total  bigint not null default 0
);
-- the board as last worked out (level 0 holds the all-levels table), kept ten seconds
create table if not exists public.signal_board_cache (
  level   int primary key,
  body    jsonb not null,
  made_at timestamptz not null default now()
);

alter table public.signal_levels      enable row level security;
alter table public.signal_run_starts  enable row level security;
alter table public.signal_runs        enable row level security;
alter table public.signal_players     enable row level security;
alter table public.signal_salts       enable row level security;
alter table public.signal_days        enable row level security;
alter table public.signal_board_cache enable row level security;
revoke all on table public.signal_levels, public.signal_run_starts, public.signal_runs, public.signal_players,
                    public.signal_salts, public.signal_days, public.signal_board_cache
  from anon, authenticated;

/* ── a callsign: the one asked for if it is one of the game's own, else the one this browser's id gives ──
   The two lists are the game's (LB_ADJ and LB_NOUN in src/util/signal_controller.ts): change them together. */
create or replace function public.signal_callsign(p_client text, p_want text)
returns text
language plpgsql immutable set search_path = '' as $fn$
declare
  v_adj  constant text[] := array['Swift','Golden','Bright','Cosmic','Lucky','Quiet','Bold','Nimble','Electric','Radiant','Clever','Stellar','Sparkling','Daring','Gentle','Curious'];
  v_noun constant text[] := array['Axon','Dendrite','Synapse','Neuron','Spike','Soma','Spark','Signal','Cortex','Photon','Comet','Nebula','Pilot','Starling','Otter','Fox'];
  m text[];
  h text;
begin
  m := regexp_match(left(coalesce(p_want, ''), 40), '^([A-Z][a-z]+) ([A-Z][a-z]+) ([1-9][0-9])$');
  if m is not null and m[1] = any (v_adj) and m[2] = any (v_noun) then
    return m[1] || ' ' || m[2] || ' ' || m[3];
  end if;
  h := md5(coalesce(p_client, ''));
  return v_adj[1 + (('x' || substr(h, 1, 7))::bit(28)::int % 16)] || ' '
      || v_noun[1 + (('x' || substr(h, 8, 7))::bit(28)::int % 16)] || ' '
      || (10 + (('x' || substr(h, 15, 7))::bit(28)::int % 90))::text;
end
$fn$;

/* ── a round begins: the server notes the time and hands back the round's id ── */
create or replace function public.signal_run_begin(p_level int, p_client text)
returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_addr text;
  v_salt text;
  v_ip   text;
  v_id   uuid;
  v_n    int;
  v_day  public.signal_days%rowtype;
begin
  if p_client is null or p_client !~ '^[A-Za-z0-9-]{8,64}$'
     or p_level is null or not exists (select 1 from public.signal_levels where level = p_level) then
    return null;
  end if;
  -- the caller's address, as the edge reports it (a visitor can forge x-forwarded-for, so it comes last)
  begin
    v_addr := coalesce(
      nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
      nullif(current_setting('request.headers', true)::json ->> 'x-real-ip', ''),
      nullif(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''));
  exception when others then
    v_addr := null;
  end;
  if v_addr is not null then
    insert into public.signal_salts (day, salt) values (current_date, gen_random_uuid()::text)
    on conflict (day) do nothing;
    select salt into v_salt from public.signal_salts where day = current_date;
    v_ip := left(encode(sha256(convert_to(coalesce(v_salt, '') || v_addr, 'UTF8')), 'hex'), 40);
  end if;

  -- the ration: one browser, one address (a classroom shares one), everybody
  select count(*) into v_n from public.signal_run_starts
   where client = p_client and started_at > now() - interval '1 minute';
  if v_n >= 20 then return null; end if;
  if v_ip is not null then
    select count(*) into v_n from public.signal_run_starts
     where ip_hash = v_ip and started_at > now() - interval '1 minute';
    if v_n >= 120 then return null; end if;
  end if;
  select count(*) into v_n from public.signal_run_starts
   where started_at > now() - interval '1 minute';
  if v_n >= 600 then return null; end if;
  -- the day's budget, and the table's size as the day began
  if not exists (select 1 from public.signal_days where day = current_date) then
    insert into public.signal_days (day, starts, total)
    values (current_date, 0, (select count(*) from public.signal_runs))
    on conflict (day) do nothing;
  end if;
  update public.signal_days set starts = starts + 1 where day = current_date returning * into v_day;
  if v_day.starts > 30000 or v_day.total > 200000 then return null; end if;

  insert into public.signal_run_starts (level, client, ip_hash)
  values (p_level, p_client, v_ip)
  returning id into v_id;

  if random() < 0.02 then      -- now and then, the housekeeping
    delete from public.signal_run_starts where started_at < now() - interval '1 day';
    delete from public.signal_salts where day < current_date - 1;
    delete from public.signal_days  where day < current_date - 60;
    delete from public.signal_runs  where flagged and created_at < now() - interval '30 days';
    update public.signal_runs set ip_hash = null
     where ip_hash is not null and created_at < now() - interval '2 days';
  end if;
  return v_id;
end
$fn$;

/* ── a round is won: checked, kept, and ranked if a hand played it ── */
create or replace function public.signal_run_finish(
  p_run uuid, p_player text, p_time_ms int, p_charges int, p_stars int, p_score int,
  p_features jsonb default '{}'::jsonb, p_build text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  s           public.signal_run_starts%rowtype;
  l           public.signal_levels%rowtype;
  f           jsonb := coalesce(p_features, '{}'::jsonb);
  v_wall      bigint;
  v_player    text;
  v_why       text := '';      -- reasons it is left off the board
  v_note      text := '';      -- reasons it is worth a look, though it is on the board
  v_charges   int := least(greatest(coalesce(p_charges, 0), 0), 100000);
  v_stars     int;
  v_shots     numeric := 0;
  v_untrusted numeric := 0;
  v_teleports numeric := 0;
  v_hidden    numeric := 0;
  v_repeat    numeric;
  v_tampered  boolean := false;
  v_log       text;
  v_part      text;
  v_n         int := 0;
  v_prev      int := -1;
  v_t         int;
  v_bad       boolean := false;
  v_best      int;
  v_rank      int;
  v_of        int;
begin
  select * into s from public.signal_run_starts where id = p_run and not used for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.signal_run_starts set used = true where id = p_run;
  if s.started_at < now() - interval '15 minutes'
     or p_time_ms is null or p_time_ms < 200 or p_time_ms > 600000 then
    return jsonb_build_object('ok', false);
  end if;
  select * into l from public.signal_levels where level = s.level;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  v_wall := (extract(epoch from (now() - s.started_at)) * 1000)::bigint;

  -- what the round's input looked like, as the game reports it
  if jsonb_typeof(f) <> 'object' or octet_length(f::text) > 4000 then
    f := jsonb_build_object('unread', true);
    v_why := v_why || 'the round''s record could not be read; ';
  else
    begin
      v_shots     := coalesce((f ->> 'shots')::numeric, 0);
      v_untrusted := coalesce((f ->> 'untrusted')::numeric, 0);
      v_teleports := coalesce((f ->> 'teleports')::numeric, 0);
      v_hidden    := coalesce((f ->> 'hidden_ms')::numeric, 0);
      v_repeat    := (f ->> 'repeat_ms')::numeric;
      v_tampered  := coalesce((f ->> 'tampered')::boolean, false);
      v_log       := f ->> 'log';
    exception when others then
      v_why := v_why || 'the round''s record could not be read; ';
    end;
  end if;

  -- What the circuit allows. No hand, however fast, gets past these.
  if p_time_ms < l.min_ms then
    v_why := v_why || 'faster than the circuit allows; ';
  end if;
  if p_time_ms > l.max_ms + 500 then
    v_why := v_why || 'longer than the level''s clock; ';
  end if;
  if v_charges < l.min_charges then
    v_why := v_why || 'fewer charges than the circuit needs; ';
  end if;
  if v_charges > 7 + p_time_ms / 1500 then
    v_why := v_why || 'more charges than the round could have had; ';
  end if;
  if v_charges > 2 * v_shots then
    v_why := v_why || 'more charges than its shots could spend; ';
  end if;
  -- The two clocks. The server's cannot be far behind the game's (a made-up
  -- round sent at once), nor far ahead (the game slowed down, or put down).
  if v_wall < p_time_ms - 3000 then
    v_why := v_why || 'the game clock ran ahead of the real one; ';
  end if;
  if v_wall > p_time_ms::bigint * 2 + 20000 then
    v_why := v_why || 'the round took far longer than its clock says; ';
  end if;
  -- Rounds no hand played.
  if v_untrusted > 0 then
    v_why := v_why || 'shots made by a script, not a press; ';
  end if;
  if v_tampered then
    v_why := v_why || 'the test hook was used; ';
  end if;
  if v_teleports >= 2 then
    v_why := v_why || 'the pointer pressed in two places with no move between; ';
  end if;
  -- The shot record, when the game sends one: "E1:m:312 E1:m:702", each a
  -- cell, how it was shot (mouse, touch, key, script) and when.
  if v_log is not null and v_why = '' then
    foreach v_part in array string_to_array(v_log, ' ') loop
      v_n := v_n + 1;
      if v_n > 60 or v_part !~ '^[A-Z][0-9]?~?:[mtks]:[0-9]{1,7}$' then
        v_bad := true;
        exit;
      end if;
      v_t := split_part(v_part, ':', 3)::int;
      if v_t < v_prev then
        v_bad := true;
        exit;
      end if;
      v_prev := v_t;
    end loop;
    if v_bad or v_n <> least(v_shots, 60) or v_prev > v_wall + 5000 then
      v_why := v_why || 'the shot record does not add up; ';
    end if;
  end if;

  -- Worth a look, though ranked.
  if p_time_ms < l.min_ms * 1.05 then
    v_note := v_note || 'within 5% of the fastest the circuit allows; ';
  end if;
  if v_wall > p_time_ms::bigint * 5 / 4 + 6000 then
    v_note := v_note || 'took longer than its clock says (slowed, or put down); ';
  end if;
  if v_hidden > 2000 then
    v_note := v_note || 'the tab was hidden for a while; ';
  end if;
  if v_shots >= 8 and v_repeat is not null and v_repeat < 4 then
    v_note := v_note || 'the gaps between shots repeat closely; ';
  end if;
  if v_teleports = 1 then
    v_note := v_note || 'the pointer pressed once in a new place with no move; ';
  end if;

  v_player := public.signal_callsign(s.client, p_player);
  v_stars  := case when v_charges <= l.par then 3 when v_charges <= l.par * 1.6 then 2 else 1 end;

  insert into public.signal_runs (level, client, player, time_ms, wall_ms, charges, stars, score, features, flagged, flag_reason, note, ip_hash, build)
  values (s.level, s.client, v_player, p_time_ms, least(v_wall, 2000000000)::int, v_charges, v_stars,
          least(greatest(coalesce(p_score, 0), 0), 1000000), f, v_why <> '', nullif(v_why, ''),
          case when v_why = '' then nullif(v_note, '') end, s.ip_hash,
          left(regexp_replace(left(coalesce(p_build, ''), 80), '[^A-Za-z0-9._ -]', '', 'g'), 40));

  if v_why <> '' then
    return jsonb_build_object('ok', true, 'ranked', false);   -- says nothing of why
  end if;

  insert into public.signal_players (client, player) values (s.client, v_player)
  on conflict (client) do update set player = excluded.player, changed_at = now()
   where public.signal_players.player is distinct from excluded.player;

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

/* ── a browser changes its callsign: one of the game's own, or it is not changed ── */
create or replace function public.signal_name(p_client text, p_player text)
returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v text;
begin
  if p_client is null or p_client !~ '^[A-Za-z0-9-]{8,64}$' then
    return null;
  end if;
  v := public.signal_callsign(p_client, p_player);
  -- only a browser with a round on the board has a row to change: this makes none
  update public.signal_players set player = v, changed_at = now()
   where client = p_client and player is distinct from v;
  return v;
end
$fn$;

/* ── the board: a level's best times (each player's best), and how far each player has got ── */
create or replace function public.signal_board(p_level int default null, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_ro  boolean := coalesce(current_setting('transaction_read_only', true), 'off') = 'on';   -- a request that may not write: it is served what is kept, however old, and works nothing out
  v_lvl jsonb;
  v_all jsonb;
begin
  if p_level is not null and exists (select 1 from public.signal_levels where level = p_level) then
    select body into v_lvl from public.signal_board_cache
     where level = p_level and (v_ro or made_at > now() - interval '10 seconds');
    if not found and not v_ro then
      select coalesce(jsonb_agg(jsonb_build_object('player', x.player, 'time_ms', x.time_ms, 'charges', x.charges, 'stars', x.stars)
                                order by x.time_ms asc, x.created_at asc), '[]'::jsonb)
        into v_lvl
        from (select p.player, b.time_ms, b.charges, b.stars, b.created_at
                from (select distinct on (r.client) r.client, r.time_ms, r.charges, r.stars, r.created_at
                        from public.signal_runs r
                       where r.level = p_level and not r.flagged
                       order by r.client, r.time_ms asc, r.created_at asc) b
                join public.signal_players p on p.client = b.client
               order by b.time_ms asc, b.created_at asc
               limit 100) x;
      insert into public.signal_board_cache (level, body, made_at) values (p_level, v_lvl, now())
      on conflict (level) do update set body = excluded.body, made_at = excluded.made_at;
    end if;
  end if;

  select body into v_all from public.signal_board_cache
   where level = 0 and (v_ro or made_at > now() - interval '10 seconds');
  if not found and not v_ro then
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object('player', y.player, 'levels', y.levels, 'total_ms', y.total_ms)
                         order by y.levels desc, y.total_ms asc)
          from (select p.player, o.levels, o.total_ms
                  from (select b.client, count(*)::int as levels, sum(b.time_ms)::bigint as total_ms
                          from (select distinct on (r.client, r.level) r.client, r.level, r.time_ms
                                  from public.signal_runs r
                                 where not r.flagged
                                 order by r.client, r.level, r.time_ms asc) b
                         group by b.client) o
                  join public.signal_players p on p.client = o.client
                 order by o.levels desc, o.total_ms asc
                 limit 100) y), '[]'::jsonb),
      'players', (select count(*) from public.signal_players p
                   where exists (select 1 from public.signal_runs r where r.client = p.client and not r.flagged)))
      into v_all;
    insert into public.signal_board_cache (level, body, made_at) values (0, v_all, now())
    on conflict (level) do update set body = excluded.body, made_at = excluded.made_at;
  end if;

  return jsonb_build_object(
    'level', case when p_level is null then null else (
      select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
        from jsonb_array_elements(coalesce(v_lvl, '[]'::jsonb)) with ordinality as t(e, i)
       where t.i <= v_lim) end,
    'overall', (
      select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
        from jsonb_array_elements(coalesce(v_all -> 'rows', '[]'::jsonb)) with ordinality as t(e, i)
       where t.i <= v_lim),
    'players', coalesce(v_all -> 'players', '0'::jsonb));
end
$fn$;

/* ── who may call what: the four functions the game uses, and nothing else ── */
revoke all on function public.signal_callsign(text, text) from public, anon, authenticated;
revoke all on function public.signal_run_begin(int, text) from public;
revoke all on function public.signal_run_finish(uuid, text, int, int, int, int, jsonb, text) from public;
revoke all on function public.signal_name(text, text) from public;
revoke all on function public.signal_board(int, int) from public;
grant execute on function public.signal_run_begin(int, text) to anon, authenticated;
grant execute on function public.signal_run_finish(uuid, text, int, int, int, int, jsonb, text) to anon, authenticated;
grant execute on function public.signal_name(text, text) to anon, authenticated;
grant execute on function public.signal_board(int, int) to anon, authenticated;

/* ── carried over from the first version ── */
-- the rounds made while testing the first version (13 Nov)
delete from public.signal_runs
 where player in ('Test Pilot 00', 'bAny Name I Typeb') or client like 'forgery-test-%';
delete from public.signal_run_starts where client like 'forgery-test-%';
-- a real round the first version left off the board for a pointer that did
-- not move: a hand that parks the pointer on one cell and clicks does that
update public.signal_runs set flagged = false, flag_reason = null
 where flagged and flag_reason = 'no pointer moved, no key or finger pressed; ';
-- every browser with a round on the board gets its callsign (its own if it is one of the game's)
insert into public.signal_players (client, player)
select distinct on (r.client) r.client, public.signal_callsign(r.client, r.player)
  from public.signal_runs r
 where not r.flagged
 order by r.client, r.created_at desc
on conflict (client) do nothing;
-- the first version kept an unsalted hash of each address: gone
update public.signal_runs       set ip_hash = null where length(ip_hash) = 32;
update public.signal_run_starts set ip_hash = null where length(ip_hash) = 32;
delete from public.signal_board_cache;
-- the game's calls find the new function at once
notify pgrst, 'reload schema';

-- Rounds on the board that are worth a look (near the fastest possible, slowed, or oddly regular):
--   select id, created_at, level, player, time_ms, wall_ms, charges, note, features ->> 'log' as shots
--     from public.signal_runs where note is not null and not flagged order by created_at desc limit 50;
-- Rounds left off the board, and why:
--   select id, created_at, level, player, time_ms, wall_ms, flag_reason, features
--     from public.signal_runs where flagged order by created_at desc limit 50;
-- To take a round off the board by hand, or put one back (the board follows within ten seconds):
--   update public.signal_runs set flagged = true,  flag_reason = 'removed by hand' where id = 123;
--   update public.signal_runs set flagged = false, flag_reason = null              where id = 123;
-- To take every round of the browser that made round 123 off the board:
--   update public.signal_runs set flagged = true, flag_reason = 'removed by hand'
--    where client = (select client from public.signal_runs where id = 123);
-- To raise a level's floor once real times show where it is (level 1 to 3.1 s):
--   update public.signal_levels set min_ms = 3100 where level = 1;
