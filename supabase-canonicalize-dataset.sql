-- ============================================================================
-- Canonicalize the 'eyewire_ii' dataset alias → 'stroeh_mouse_retina'
-- ----------------------------------------------------------------------------
-- WHY
-- The app used to stamp the literal string 'eyewire_ii' as `dataset` on most
-- Supabase rows regardless of which dataset was actually on screen. The code now
-- stamps the real dataset (canonicalDataset(currentSegLayerName())), whose
-- canonical value for the stroeh retina is 'stroeh_mouse_retina' — the same
-- value cave_completions_mirror already uses. This migration rewrites the
-- historical 'eyewire_ii' rows to that canonical value so reads (loadTasks
-- filters proofreading_tasks by dataset) still find them.
--
-- Existing 'eyewire_ii' rows can't be re-attributed to their true dataset (the
-- info was never recorded), so they all fold into the production dataset, which
-- is the correct default for the overwhelming majority of them.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================================

update proofreading_tasks set dataset = 'stroeh_mouse_retina' where dataset = 'eyewire_ii';
update edit_log            set dataset = 'stroeh_mouse_retina' where dataset = 'eyewire_ii';
update help_requests       set dataset = 'stroeh_mouse_retina' where dataset = 'eyewire_ii';
update segment_tags        set dataset = 'stroeh_mouse_retina' where dataset = 'eyewire_ii';

-- activity_feed only has a dataset column in some deployments; guard it.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'activity_feed' and column_name = 'dataset') then
    update activity_feed set dataset = 'stroeh_mouse_retina' where dataset = 'eyewire_ii';
  end if;
end $$;
