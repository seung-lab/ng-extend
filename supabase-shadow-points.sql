-- Shadow points for all of Pyr (Ames 2026-11-20: "Go").
-- A hidden tally, reviewed Monday 2026-11-30, to see how well points track
-- what players did. Players see nothing: not in stats, the leaderboard, the
-- sheet or the UI. Every table here has RLS on with no policies, and anon and
-- authenticated have no grants, so only the service role (the nightly job and
-- the dashboard) can read or write.
--
-- Rules (shown to Ames on claude.ai/artifact/UNFAu4W3w6itFPGQ7deLHE):
--   Merge that stayed 10, cut that stayed 5. "Stayed" is checked in CAVE by
--     scripts/shadow-points.mjs: a merge's supervoxels still share a root, a
--     cut's removed edges still sit on different roots. Undone edits pay 0.
--   At most 50 paid edits per player, per cell (the root the edit ended in), per week.
--   Completed cell (ew_cell_completions): 2 x um3^0.75, um3 up to 3,000,
--     sized from the L2 cache at completion time.
--   Sandbox (pinky_nf_v2): every edit counts (resets undo them), at most 50
--     edits a day, 25 a completed cell. Counts in the total (Ames 2026-11-20).
--   Annotation save 2, cell type set 2, at most 50 of each a day.
--   Lost Fragments: ew_lost_fragments.points as stored; those cells and the
--     edits on them are not paid twice.
--   Weeks are Monday to Sunday, UTC.

create table if not exists public.ew_shadow_ops (
  dataset      text        not null,
  operation_id bigint      not null,
  user_id      uuid        not null,
  kind         text        not null check (kind in ('merge','split')),
  ts           timestamptz not null,
  stayed       boolean,
  cell_root    text,
  error        text,
  checked_at   timestamptz not null default now(),
  primary key (dataset, operation_id)
);

create table if not exists public.ew_shadow_cell_sizes (
  dataset    text        not null,
  root_id    text        not null,
  done_at    timestamptz not null,
  um3        double precision,
  l2_count   integer,
  error      text,
  checked_at timestamptz not null default now(),
  primary key (dataset, root_id)
);

-- Paid tracers, if any are named; kept in their own group, never mixed with volunteers.
create table if not exists public.ew_shadow_paid (
  user_id  uuid primary key,
  note     text,
  added_at timestamptz not null default now()
);

create table if not exists public.ew_shadow_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ops_checked  integer,
  ops_stayed   integer,
  cells_sized  integer,
  errors       integer,
  note         text
);

alter table public.ew_shadow_ops        enable row level security;
alter table public.ew_shadow_cell_sizes enable row level security;
alter table public.ew_shadow_paid       enable row level security;
alter table public.ew_shadow_runs       enable row level security;
revoke all on public.ew_shadow_ops, public.ew_shadow_cell_sizes, public.ew_shadow_paid, public.ew_shadow_runs from anon, authenticated;
revoke all on sequence public.ew_shadow_runs_id_seq from anon, authenticated;

create or replace view public.ew_shadow_points_week with (security_invoker = true) as
with
lf as (
  select user_id, date_trunc('week', submitted_at) wk, sum(points) pts,
         array_agg(root_id) filter (where root_id is not null) || array_agg(fragment_id) roots
  from ew_lost_fragments group by 1, 2
),
lf_roots as (select distinct user_id, unnest(roots) r from lf),
real_ops as (
  select e.user_id, e.dataset, e.operation, e.timestamp ts, o.stayed, o.cell_root,
         (o.operation_id is null) pending
  from edit_log e
  left join ew_shadow_ops o on o.dataset = e.dataset and o.operation_id = (e.metadata->>'operation_id')::bigint
  where e.operation in ('merge','split') and e.dataset <> 'pinky_nf_v2' and e.timestamp >= '2026-11-09'
    and e.metadata ? 'operation_id'
),
paid_ops as (
  select r.*, row_number() over (partition by r.user_id, date_trunc('week', r.ts), r.cell_root order by r.ts) rn
  from real_ops r
  where r.stayed and not exists (select 1 from lf_roots l where l.user_id = r.user_id and l.r = r.cell_root)
),
edits as (
  select user_id, date_trunc('week', ts) wk,
         sum(case when operation = 'merge' then 10 else 5 end) filter (where rn <= 50) pts,
         count(*) filter (where rn <= 50) paid
  from paid_ops group by 1, 2
),
edit_counts as (
  select user_id, date_trunc('week', ts) wk, count(*) logged,
         count(*) filter (where stayed) stayed, count(*) filter (where stayed is false) undone,
         count(*) filter (where pending) pending
  from real_ops group by 1, 2
),
sandbox as (
  select user_id, date_trunc('week', ts) wk, sum(case when operation = 'merge' then 10 else 5 end) filter (where rn <= 50) pts, count(*) logged
  from (select user_id, operation, timestamp ts,
               row_number() over (partition by user_id, date_trunc('day', timestamp) order by timestamp) rn
        from edit_log where dataset = 'pinky_nf_v2' and operation in ('merge','split') and timestamp >= '2026-11-09') s
  group by 1, 2
),
small as (
  select user_id, date_trunc('week', dy) wk,
         2 * sum(least(n, 50)) filter (where operation = 'annotate') ann_pts,
         2 * sum(least(n, 50)) filter (where operation = 'set_cell_type') type_pts
  from (select user_id, operation, date_trunc('day', timestamp) dy, count(*) n
        from edit_log where operation in ('annotate','set_cell_type') and timestamp >= '2026-11-09' group by 1, 2, 3) d
  group by 1, 2
),
done as (
  select c.user_id, c.dataset, c.done_at, m.rid
  from ew_cell_completions c
  join lateral (select rid from ew_cell_marks m where m.user_id = c.user_id and m.dataset = c.dataset and m.cell = c.cell and m.ts = c.done_at limit 1) m on true
  where c.done_at >= '2026-11-09'
    and not exists (select 1 from lf_roots l where l.user_id = c.user_id and l.r = m.rid)
),
cells as (
  select d.user_id, date_trunc('week', d.done_at) wk,
         count(*) filter (where d.dataset <> 'pinky_nf_v2') cells,
         count(*) filter (where d.dataset = 'pinky_nf_v2') sandbox_cells,
         count(*) filter (where d.dataset <> 'pinky_nf_v2' and z.root_id is null) cells_pending,
         sum(case when d.dataset = 'pinky_nf_v2' then 0
                  when z.um3 is not null then round(2 * power(least(z.um3, 3000), 0.75))
                  when z.root_id is not null then 50   -- could not be sized: a typical cell
                  else 0 end) cell_pts,
         25 * count(*) filter (where d.dataset = 'pinky_nf_v2') sandbox_cell_pts
  from done d left join ew_shadow_cell_sizes z on z.dataset = d.dataset and z.root_id = d.rid
  group by 1, 2
),
keys as (
  select user_id, wk from edit_counts union select user_id, wk from sandbox union select user_id, wk from small
  union select user_id, wk from cells union select user_id, wk from lf
)
select k.wk::date as week_of, k.user_id, u.display_name,
       case when p.user_id is not null then 'paid'
            when exists (select 1 from admins a where a.user_id = k.user_id or lower(a.email) = lower(u.middleauth_email)) then 'staff'
            else 'volunteer' end as player_group,
       coalesce(ec.logged, 0) edits_logged, coalesce(ec.stayed, 0) edits_stayed, coalesce(ec.undone, 0) edits_undone,
       coalesce(ec.pending, 0) edits_pending, coalesce(ed.paid, 0) edits_paid,
       coalesce(ed.pts, 0) edit_pts,
       coalesce(c.cells, 0) cells, coalesce(c.cells_pending, 0) cells_pending, coalesce(c.cell_pts, 0) cell_pts,
       coalesce(sm.ann_pts, 0) annotation_pts, coalesce(sm.type_pts, 0) cell_type_pts,
       coalesce(l.pts, 0) lost_fragment_pts,
       coalesce(sb.logged, 0) sandbox_edits, coalesce(c.sandbox_cells, 0) sandbox_cells,
       coalesce(sb.pts, 0) + coalesce(c.sandbox_cell_pts, 0) sandbox_pts,
       coalesce(ed.pts, 0) + coalesce(c.cell_pts, 0) + coalesce(sm.ann_pts, 0) + coalesce(sm.type_pts, 0)
         + coalesce(l.pts, 0) + coalesce(sb.pts, 0) + coalesce(c.sandbox_cell_pts, 0) as total
from keys k
join users u on u.id = k.user_id
left join ew_shadow_paid p on p.user_id = k.user_id
left join edit_counts ec on ec.user_id = k.user_id and ec.wk = k.wk
left join edits ed on ed.user_id = k.user_id and ed.wk = k.wk
left join sandbox sb on sb.user_id = k.user_id and sb.wk = k.wk
left join small sm on sm.user_id = k.user_id and sm.wk = k.wk
left join cells c on c.user_id = k.user_id and c.wk = k.wk
left join lf l on l.user_id = k.user_id and l.wk = k.wk;

revoke all on public.ew_shadow_points_week from anon, authenticated;

comment on view public.ew_shadow_points_week is
  'Hidden shadow points per player per week (Mon to Sun UTC). Review with Ames 2026-11-30, next to ew_lost_fragment_points. Never shown to players.';
