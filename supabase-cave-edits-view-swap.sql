-- ============================================================================
-- user_edit_counts view swap: edits from cave_edits_mirror (LIGHT-UP ONLY)
-- ----------------------------------------------------------------------------
-- ⚠️ DO NOT APPLY until BOTH are true:
--   1. The admin_view grant landed and scripts/sync-cave-edits.mjs has run
--      successfully (cave_edits_mirror has rows).
--   2. The client build that stops writing edit_log stats is deployed.
--
-- This replaces the edit_log-based edit counts with CAVE-sourced counts from
-- cave_edits_mirror, keyed on users.cave_user_id (same join the completions
-- side already uses). Completions half is unchanged from
-- supabase-leaderboard-windows-schema.sql.
--
-- edits_alltime switches from the denormalized users.total_edits to a real
-- COUNT against the mirror: unlike completions (whose mirror is reseeded from
-- a frozen materialization), operations are append-only and the mirror is
-- backfilled from the beginning of time on first sync, so the count is
-- authoritative.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

CREATE OR REPLACE VIEW user_edit_counts AS
SELECT
  u.id              AS id,
  u.display_name    AS display_name,
  u.flag            AS flag,
  u.bio             AS bio,
  u.total_edits     AS total_edits,
  u.total_merges    AS total_merges,
  u.total_splits    AS total_splits,
  u.cells_completed AS cells_completed,
  u.current_streak  AS current_streak,
  u.longest_streak  AS longest_streak,
  -- Edits — CAVE-direct via cave_edits_mirror (real PCG operations),
  -- keyed on users.cave_user_id.
  COALESCE(e24.cnt, 0)::INTEGER AS edits_24h,
  COALESCE(e7d.cnt, 0)::INTEGER AS edits_week,
  COALESCE(eall.cnt, 0)::INTEGER AS edits_alltime,
  -- Completions — unchanged (cave_completions_mirror).
  COALESCE(c24.cnt, 0)::INTEGER AS completions_24h,
  COALESCE(c7d.cnt, 0)::INTEGER AS completions_week,
  COALESCE(u.cells_completed, 0)::INTEGER AS completions_alltime
FROM users u
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM cave_edits_mirror m
  WHERE m.cave_user_id = u.cave_user_id
    AND m.timestamp >= NOW() - INTERVAL '24 hours'
) e24 ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM cave_edits_mirror m
  WHERE m.cave_user_id = u.cave_user_id
    AND m.timestamp >= NOW() - INTERVAL '7 days'
) e7d ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM cave_edits_mirror m
  WHERE m.cave_user_id = u.cave_user_id
) eall ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM cave_completions_mirror m
  WHERE m.cave_user_id = u.cave_user_id
    AND m.completed_at >= NOW() - INTERVAL '24 hours'
) c24 ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM cave_completions_mirror m
  WHERE m.cave_user_id = u.cave_user_id
    AND m.completed_at >= NOW() - INTERVAL '7 days'
) c7d ON true;
