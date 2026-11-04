# Mentor program, proof of concept

Ames said go on 2026-11-04 and renamed Redo to **Suggestions** ("Send suggestions" for the mentor,
"Your mentor has suggestions" for the apprentice). Built on this branch; the five open questions below
were built with the recommended answers until Ames picks otherwise. Art is a stand in (Nurro pictures).

Source: Nseraf, triage report #317 (2026-10-30). Ames asked for a POC 2026-11-04.
Branch `claude/mentor-poc`, worktree `C:\Users\amyle\ng-extend-mentor`, kanban t_64c7514a.
Ames's worry: "might have some overhead as far as guiding mentors to new players."

## The flow in one paragraph
A new player who has edit access is an **apprentice** for their first 5 cells. When they
press Complete, the cell goes to a **second look** instead of counting. A **mentor**
claims it from a small queue, opens it, drops notes as points in the view ("cut here",
"missed an extension", "annotate this end"), and presses **Send suggestions** (back to the apprentice
with the notes) or **Complete** (the cell counts for the apprentice now). After 5 cells
are completed this way, the apprenticeship ends and cell 6 counts like anyone's.
The notes stay readable in the apprentice's My Cells.

## What the apprentice sees
- A line in the cell panel: "Cell 2 of 5 with a mentor. A mentor takes a second look before it counts."
- Complete reads **Send for a second look**. The claim stays theirs and does not expire while it waits.
- Bells: "Your mentor has suggestions", "Your cell ...1234 is complete. It counts for you" (Complete).
- Suggestions: the cell opens with the mentor's notes as a layer of points; fix, then Send again.
- My Cells (Cell Library): a **Mentor notes** button on each mentored cell, open or done.
- After cell 5: the **Apprentice** Achievement, and normal play from then on.

## What the mentor sees
- Cell Library gets a **Mentoring** tab, shown only to mentors. Two lists: **Waiting** (cells nobody
  has claimed, oldest first, with the apprentice's name and how long it has waited) and **Yours**.
- **Take a look** claims the cell and opens it. The first mentor to claim an apprentice's cell
  becomes that apprentice's mentor for the rest, so one person follows their progress.
  At most **2 apprentices** per mentor at a time; Take a look is greyed out past that.
- The review box is the access review box (`AccessReviewBar.vue`) reshaped: a list of notes,
  each a point in the view with a short text, fly to it; a note to the whole cell; **Send suggestions** and **Complete**.
- **Mentor** Achievement when their first apprentice finishes.
- "Hand back" lets a mentor return an apprentice to the queue.

## Keeping the overhead low (Ames's worry)
- **Nobody assigns anyone.** Mentors pull from the queue; no admin matching.
- **Few bells.** A mentor with a free slot gets one bell when a NEW apprentice sends their first
  cell, never one per cell. A paired mentor gets one bell per cell from their own apprentice.
- **Fallback.** Any cell waiting 48 hours (unclaimed, or claimed and untouched) shows in
  Admin Hub > Access with "Waiting 2 days", and an admin can review it in the same box.
  A cell claimed and untouched for 48 hours goes back to Waiting.
- **Short.** 5 cells, not 10.
- **No AI.** Nothing here calls Claude. Zero robot spend.

## Data model (new, server only, RLS on with no policy, like supabase-teams.sql)
- `ew_apprentices`: user_id, mentor_id (null until a first claim), status (active, finished, left),
  cells_needed (5), cells_done, started_at, finished_at, added_by.
- `ew_mentors`: user_id, added_by, active. Admin picked for the POC, seeded with
  Nseraf, annkri, kk, azurejay. A rule (cells or days) can replace this later.
- `ew_mentor_reviews`: id, apprentice_id, mentor_id, dataset, task_id, segment_id, root_id,
  position, state (waiting, looking, redo, complete), rounds, notes jsonb (same shape as
  `ew_team_marks.doc`: one layer of points with text), cell_note, sent_at, claimed_at, decided_at.
- Every read and write goes through one server module, `functions/mentors.js`, with a
  `mentorAction(action, args, {db, me, credit})` surface and `restDb`/`memDb`, the same shape as
  `functions/teams.js`, so it gets the same in-memory tests.

## Credit (counts at approval, never retroactive)
- During an apprenticeship the apprentice's Send writes **no** `complete_task` or `mark_complete`
  row, so nothing counts and nothing has to be taken away on suggestions.
- Mentor Complete: the server writes the apprentice's `complete_task` row through `recordActivity`
  (exactly how saved teams credit a member, `functions/index.js` team.* block), with
  `metadata.mentor_id`. `ew_cell_completions` picks it up; done_at is the approval time.
  The mentor gets no cell credit for it.
- Nobody's existing totals change. Only players enrolled from now on are apprentices.
- Both completion paths are routed: a claimed cell (`completeTask` in `src/store.ts`) and a cell
  marked complete with the lightbulb (`setCellComplete` in `src/widgets/lightbulb_service.ts`).

## Reused
- `functions/teams.js` pattern: server rules module, restDb/memDb, notify, credit through recordActivity.
- Saved team marks format and loader (`src/util/teams.ts`) for the mentor's note points.
- `AccessReviewBar.vue` (drag box, fly to point, good/redo, note) for the mentor's box.
- `src/util/drag_box.ts`, the notifications table, special_badges / special_badge_awards for the two
  Achievements (as Hunt Maker does in `functions/hunts.js`).
- Cell Library tabs (`CellLibraryPanel.vue`, `MyCellsTab.vue`, `TeamsTab.vue` as the template).

## Test site safety (test sites share LIVE data)
- POC enrollment is by hand: an admin adds an apprentice in Admin Hub > Access. No real new player is
  swept in automatically. Hooking it into Grant edit access is one line, later.
- No chat posts and no "everyone" bells: every bell goes to one named person.
- The server runs in its OWN function, `ewMentor` (like `ewAccessRequest`), so deploying it never
  replaces `ewSecureWrite`, and its `functions/` change goes to live as a `[no player change]` commit
  at the same time, so a later live deploy does not wipe it.
- Until Ames runs the SQL and deploys `ewMentor`, the test site shows nothing new (the client reads
  `installed: false` and hides the tab). I test end to end locally against a stand-in server that
  loads the real `functions/mentors.js` with memDb, as the saved teams tests do.

## Open questions for Ames
1. **CAVE completion mark.** Recommended: the mentor's browser writes the CAVE "complete" mark when
   they press Complete (they are the one verifying it). Alternative: it waits and the apprentice's
   browser writes it on their next visit, like `cave_outbox`.
2. **Mentor list.** Admin picked (recommended for the POC) or an automatic rule (for example 100 cells
   and 30 days active)?
3. **5 or 10 cells?** Proposed 5.
4. **Achievement art** for Apprentice and Mentor: pick existing art, or new pieces?
5. **Which datasets?** Proposed: every dataset the player has edit access in, counted together.

## How it was tested (2026-11-04)
- `node --test functions/mentors.test.js`: 10 rule tests (credit to the apprentice only, once; cap of 2;
  48 hour return; Achievements at 5; who may see what; copy has no dashes or "badge"). A control that
  credits the mentor instead fails test 5.
- A three player browser run of the built game against a stand in server running the real mentors.js
  (scratchpad `mentortest.cjs`): admin adds both, apprentice sends, mentor takes it and leaves 2 notes and
  suggestions, apprentice sees them in the view and sends again, mentor completes. The CAVE mark came
  from the mentor's browser with no completion logged for the mentor; the apprentice's claim completed
  as theirs and credited once; 5 cells gave both Achievements; no live write was attempted.

## Not done in the POC
- Enrolling automatically on Grant edit access (apprentices are added by hand in Admin Hub, Access).
- Marking an unclaimed cell complete (lightbulb, menu, batch) is refused with a message while a player
  is an apprentice, instead of being routed to a mentor.
- The 48 hour fallback shows in Admin Hub; it rings no bell.
