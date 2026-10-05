# Leaderboard accuracy

How the board, the weekly podium and the weekly announcement count, and how
to switch the new counting on. Written after the read-only audit of
2026-10-05 (`eyewire-leaderboard-audit-2026-10-05/report.html`).

These are counts of edits and completed cells. Not a scoring system.

## What is counted

**An edit** is one split or one merge that the graph server accepted. The app
hears the graph server's answer, which carries an operation id, and reports
that. The EyeWire II server asks the graph server about the id before
counting: it must exist, have succeeded, belong to the player, and be a
current edit (under 15 minutes old). Each operation id is recorded once.
Only edits made in the game are counted, never a player's wider CAVE history.

**A completed cell** is decided by one rule, the SQL view
`ew_cell_completions`. Everything reads that view:

| Reader | How |
|---|---|
| Board, 24 hours and 7 days | `user_edit_counts` view |
| Saved weekly podium, Cells | `weekly-completions.mjs` calls `ew_weekly_ranking` |
| Saved weekly podium, Edits | `snapshot_weekly_winners` calls `ew_weekly_ranking` |
| Weekly announcement, Cells | `weekly-completions.mjs` calls `ew_weekly_ranking` |
| All time counter | `ew_log_activity` moves it by the change in the view |
| Profile, per dataset | `src/util/completion_rule.ts`, the same rule in the app |

The rule, in words (the SQL file has the full text):

1. A Cell Library completion is its task, so it stays one cell when an edit
   changes its root id.
2. A root id a task was completed with belongs to that task.
3. Any other mark is its root id. Outside the Cell Library this is "distinct
   roots": the log can not tell that two root ids are one biological cell.
4. A row with no id is the echo of a completion that has one (same player,
   same dataset, within two minutes). Otherwise it is its task, or its own
   cell keyed by the minute.
5. Identity is per player and per dataset.
6. A cell is completed at its first mark, or its first mark after its last
   un-mark, decided over the whole log before any time window.
7. Failed operations never count.

`functions/leaderboard-accuracy.test.js` runs the SQL on an in-memory
PostgreSQL, and checks that the app's copy gives the same cells on 400 mixed
rows. Change the two together.

**Time windows.** The board's 24 hours and 7 days roll with the clock. The
podium and the announcement cover a completed week, Monday 00:00 UTC to the
next Monday 00:00 UTC, whatever time zone the database session is in. So on a
Monday the board's 7 days and last week's announcement are different spans
and can show different numbers. That is expected.

**Ties.** Higher count first. On a tie, the player who reached the count
first. Then the lower user id. The same answer every time.

## What changed, by audit finding

1. **Weekly awards read an old source.** The Monday job runs from `main`,
   whose script still read the CAVE mirror. Fixed on 2026-10-05 in `c8133dd`
   and `main` `e8b6d47` (another session): the workflow checks out
   `eyewire-ii-community`, and the podium and the announcement share
   `scripts/weekly-completions.mjs`. Added here: that shared count asks the
   database's rule first, so the week is decided by the same rule as the
   board, with the same ties.
2. **Players could write their own totals.** Fix: once the SQL is installed
   the server drops counter fields from profile writes and moves the counters
   itself. New profiles never start with a total.
3. **Racy counters, separate from the log.** Fix: `ew_log_activity` locks the
   player's row, writes the log row and moves the counters in one
   transaction. A repeated operation id changes nothing.
4. **`created_at` does not exist.** Fix: `timestamp`. The per-dataset helper
   now uses the shared rule and a real union with the mirror.
5. **Completion identity and windows.** Fix: the rule above.
6. **Edits inferred from the screen.** Fix: one acknowledged graph operation
   is one edit, checked with the graph server. Recent Edits leave out failed
   operations.
7. **Ranking and fallback.** Fix: ties in a fixed order, no demo players, and
   the board says "not available" instead of showing zeros. It refreshes
   every minute while open and shows when it was read.

## Before and after, without touching anything

```
cd functions && npm ci --legacy-peer-deps && cd ..
node scripts/leaderboard-compare.mjs out.json
```

Read only. It copies the public rows into a database in memory on your
machine, applies the new SQL there, and prints every player whose number
would change and every saved podium that differs from the new rule.

Result on 2026-10-05 15:27 UTC (34 players, 1,749 log rows, 19 saved podiums):

- Board: no player's number changes.
- Saved podiums: three Cells podiums differ. Nothing rewrites them.
  - 2026-09-28: saved Amy 12, Celia D 5, Andrearwen 5. Rule: Amy 12,
    Annkri 9, Celia D 5 (Andrearwen 5, fourth on the tie).
  - 2026-07-13: saved Krzysztof Kruk 1, Nseraf 1. Rule: Krzysztof Kruk 2,
    Nseraf 1, Celia D 1.
  - 2026-04-27: saved Amy 6, Krzysztof Kruk 5, Nseraf 3. Rule: Amy 9,
    Krzysztof Kruk 5, Celia D 4.
- All time Cells: four players have a saved total above what the log alone
  holds (completions from before the log existed). The saved totals stay.

## Switching it on

Each step is safe by itself and can be undone by not doing the next one.

1. **Server functions** (`ewSecureWrite`, `ewCommunityData`, Firebase
   `eyewire-ii-e4d52`). Until the SQL exists they behave exactly as before.
2. **The app** (`eyewire-ii-community`). Works with the old or new server,
   and with or without the SQL.
3. **`supabase-leaderboard-accuracy.sql`** in the Supabase SQL editor. It
   changes no existing row. Within five minutes the server notices the new
   function and starts recording and counting itself. From then on a browser
   can no longer write a total.

After step 3, check: `node scripts/leaderboard-compare.mjs` should print no
board differences, and an edit in the game should add a row to `edit_log`
with `op_key` set and `metadata.verified` true.

## Still open, on purpose

- **Past podiums are corrected only on request.** Nothing in the SQL
  rewrites a saved week. The Weekly Winners Snapshot workflow can: run it
  with `week_start` set (and `dry_run` first to see what would change, and
  `update_broadcast` to correct the posted announcement's text in place).
  The three weeks above are the ones that differ.
- **Unverified edits still count.** An edit is recorded as unverified when it
  can not be checked: an app version from before this change, a graph server
  we do not ask (MEC, whose server is fragile), or no answer. They are marked
  `metadata.verified = false`. When old app versions have aged out, counting
  only verified edits on minnie datasets is a small change in
  `functions/activity.js` (refuse instead of marking).
- **Older totals are as they were.** Edits logged before the tool gate of
  2026-07-20 may include some that were not edits. Nothing here resets or
  recomputes them.
- **The CAVE edits mirror stays empty.** It was meant to count a player's
  whole CAVE history. Only game edits count, so it is not the reference;
  checking each operation with the graph server is.
