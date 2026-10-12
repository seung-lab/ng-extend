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

## Profile: an Identification row, when the cell typing Achievements arrive

Asked by Ames, 2026-10-12 ("we will eventually have a new tier of
achievements for cell typing, so eventually it will be a new row").

Today the count of cells identified is a tile beside the name on the
profile (`.nge-profile-section--identified` in `UserProfilePanel.vue`),
counted from the game's own `edit_log` rows with `operation =
'set_cell_type'`: the Sandbox does not count, a cell counts once by its
latest type, Unknown or Unsure does not count, open text counts for now.
It is in the plain number colour because the track has no colour yet.

When the Identification track ships (the plan is
amyleesterling.github.io/badges/identification-plan.html, with a handoff
in the badges repo), the tile becomes a fourth row like Cells completed,
Edits and Days: the latest Identification Achievement at the left, Today,
Past 7d and All time with a curve (the same rows carry timestamps, so the
day series the other curves use works unchanged), the track's other
Achievements at the right, and a head with the circuit trace and "n to go"
from the tier thresholds. Needs before building: the track's colour (the
profile's key is cells #90fff2, edits #ffd08a, days #c9a8ff), the
thresholds and art from the plan, and a check that a fourth row still
fits without a scroll on laptops (the compact tiers), since the last row
would get less room.

## Profile: should clicking an Achievement tile open the Trophy Case?

Asked by Ames, 2026-10-12 ("clicking on a badge will take me to trophy
case?"), not decided.

Today a tile click shows that Achievement in the right column (art, name,
text, when it was earned), and the round arrow at the end of each row opens
the Trophy Case. Choices: the click opens the Trophy Case at that
Achievement; or the detail stays and gains a "See in Trophy Case" link;
or both, the click for the detail and the link for the case. Her call.

## Built

- **Undelete** (asked by Nik, 2026-10-07; Krzysztof Kruk's idea and user scripts, discuss.flywire.ai/t/235 and /t/236). Built the same day: `src/util/undelete.ts`, with a top bar icon (`undelete` in `src/data/toolbar-icons.ts`) that is on by default (a counter badge is a Settings choice, off by default). Keeps the last 50 steps per dataset and tab; a "clear" comes back as one step; the icon or Ctrl+Z. It restores the view only and never undoes an edit.
