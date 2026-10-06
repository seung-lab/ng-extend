# User ideas

Ideas from players and from Ames that are not being built yet. One entry
each: what was asked, who asked and when, and anything already known about
how it could work. When one gets built, move it out and say where it went.

(`TODO.md` at the repo root is the other list: things already designed and
parked. This file is the earlier stage, the raw asks.)

## Leaderboard history: a custom date range

Asked by Ames, 2026-10-06.

The leaderboard has three windows today: 24 hours, week, and all time. The
ask is a custom range, "the leaderboard between two dates", picked as
day/month/year to day/month/year.

What is already there to build on:

- `edit_log` keeps every merge, split and completion with its timestamp, so
  any range can be counted after the fact. Nothing new needs recording.
- The current windows come from the `user_edit_counts` view, which only knows
  its three fixed windows. A range needs either a database function that
  takes two dates, or the same counting done in the browser from `edit_log`
  (the weekly broadcast script already counts a week this way).
- The completion rules must match the live board: one per cell, and a cell
  un-marked after its last completion does not count
  (`supabase-leaderboard-completions-from-log.sql`).

Limits to say out loud in the design:

- The log starts when logging started, so a range before that is empty, and
  all-time totals on the board (a separate counter) will not equal the sum of
  any range.
- Annotations are logged as hourly totals, so a range can only be accurate to
  about the hour for them.
