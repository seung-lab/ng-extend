# Player saves that failed without saying so (audit, 2026-10-23)

Several of Nseraf's reports were server errors Pyr never showed, so the
player thought their work was gone. This is every place Pyr writes a
player's work to CAVE or our own servers, what happened on a 500 or no
answer, and what changed.

| Write | Where | On 500 / no answer, before | Now |
|---|---|---|---|
| Edit credit: every split, merge, completion, un-mark, cell type, claim and release is reported to `activity.log` (ewSecureWrite) | `logEdit` in src/store.ts | **Silent.** One `console.warn`, row dropped. The split or merge was in CAVE, but it never reached the edit log, the leaderboard, streak or achievements. A 500 lasting a few minutes dropped every edit in it. | **Fixed.** Kept in a waiting list in this browser (src/activity_outbox.ts, survives a reload), retried with backoff (5 s doubling to 5 min). The save status chip shows "Couldn't save, retrying" and then "Saved". Safe to resend: every row carries a key the server dedupes on (`op_key`, unique index in supabase-leaderboard-accuracy.sql); a split or merge is keyed by its graph operation id. |
| Release a claim from the Δ menu | button_service.ts, `releaseBySegment` | **Silent.** The button said "✓ Released" even when the server refused or did not answer, and the cell stayed claimed. | **Fixed.** A busy or down server is retried 3 times; a release that still fails says "Couldn't release, try again" and keeps the claim shown. If the answer was lost but the release went through, the reload of tasks finds it released and says so. |
| Old cell type row removed after a new type is saved | lightbulb_service.ts, `saveCellType` | **Silent.** `.catch(() => {})` and no status check. A failed DELETE left both types in CAVE, so the old type could show again later ("my cell type was lost"). | **Fixed.** Retried in the background (3 tries, 5 s, 20 s, 60 s). Removing an id twice is harmless. |
| Completion / proofread mark (CAVE POST) | lightbulb_service.ts `setCellComplete` | Already handled (2026-10-14): src/cave_outbox.ts keeps it and sends it when CAVE is back. But after its 8 s toast nothing on screen said it was still waiting. | The save status chip now shows "N saves waiting for CAVE, retrying" while the CAVE waiting list is not empty, and "Saved" when it empties. |
| Cell type (CAVE POST) | lightbulb_service.ts `saveCellType` | Same as completion: queued in cave_outbox, only an 8 s toast. | Same chip. |
| Un-mark proofread (CAVE DELETE) | `setCellComplete(false)` | Not silent: "CAVE did not remove the mark (error N)... Try again". | Left as is. Not queued on purpose: an un-mark that lands later could undo a re-mark made in between. |
| Mark proofread from the Δ menu, claim, complete_task (pilot.task) | button_service.ts, store.ts | Not silent: "Error, try again", the claim reason, or the sheet error is shown. | Left as is. |
| Cell Library sheet row on release | store.ts `releaseTask` | Silent (warn), but on purpose: the release must go through even if the sheet is down. | Left as is; follow up below. |
| Merge and split commits (graph server) | third_party/neuroglancer/datasource/graphene/frontend.ts | Not silent: merge retries itself and shows its error, split shows "Split failed: ...". | Left as is. Never auto-retried: the graph may have changed, so a resent edit could do something the player did not ask for. |

## Limits

- A split or merge reported more than 15 minutes after the edit used to be
  refused (`MAX_OPERATION_AGE_MS` in functions/activity-policy.js), so an
  outage longer than that lost the credit for its graph edits. Since
  2026-10-24 (Ames: "we should still count edits even if there is an
  outage") the server counts the player's own split or merge up to 3 days
  old (`LATE_OPERATION_AGE_MS`), after the same graph server check (it
  exists, succeeded, is this player's). Such rows carry `metadata.late`,
  set by the server only, so they can be audited. The browser keeps a
  waiting save for 3 days too, then lets it go.
- The trade-off: a player could report their own edits made in another tool
  in the last 3 days. They are still real edits by that player on a Pyr
  dataset, and the late mark shows them.
- A late edit lands in the day and week it was recorded, not the day it
  was made.
- A split or merge without an operation id (the old visible segment fallback)
  is not queued: the server has no key to dedupe it on.
- The waiting list belongs to one player in one browser; rows saved by one
  player are never sent under another's sign in.

## Follow ups

- The Cell Library sheet write on release could join a waiting list too.

## How it was checked

Headless browser test (Playwright, built site served on localhost, script kept
in the session notes folder as save-retry.test.mjs) with ewSecureWrite blocked
(500, then no answer), 14 of 14 checks pass:
the chip shows "Couldn't save, retrying", the row stays after a reload, and
once the block is lifted the row is sent once and the chip says "Saved".
