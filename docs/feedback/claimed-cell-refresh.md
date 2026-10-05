# Keep claimed cell IDs current after edits

Feedback: `5a2f4016-39ee-45dd-84b0-6796b0aabbb0`.
Triage: `770520a5-7e36-4bc9-b3f4-fb9fe665edb9`.

Decision: implement. A claimed cell's root ID changes after a merge or split.
The immutable supervoxel at its claim point remains the correct anchor.
Previously `CellLibraryPanel.vue` refreshed these IDs on mount, while the
segment edit watcher in `store.ts` never refreshed them. An already open
library could therefore display and copy an obsolete ID.

## Behavior and acceptance

- After the existing three-second edit debounce, root replacement while a
  merge/split tool is engaged refreshes active claims, including replacements
  with no net visible-segment count change.
- Ordinary selections and edits reverted to their original IDs do not refresh.
- Resolve each distinct supervoxel once, only for the current dataset. No
  active claims with supervoxels means no post-edit lookup or database write.
- Update the reactive task's cached root and persist only that field. Ownership,
  claim point, status, notes, and other task fields remain intact.
- Serialize refreshes and persistence. Edits during a lookup trigger a coalesced
  follow-up lookup; discard the superseded result. Do not overwrite a newer
  local root or apply responses after switching datasets.
- Failed/missing lookups retain existing IDs. Database persistence is best effort
  and uses the previous root and supervoxel as conditional update guards. A
  rejected write or zero matching updated rows restores the previous cached root
  rather than treating an optimistic local change as successfully persisted.
- Opening the library retains its existing refresh of all loaded tasks.

## Verification

Run `node --experimental-strip-types --test scripts/test-claim-root-refresh.mjs`
with Node 22. Tests cover deduplication, claim filtering, unchanged metadata,
empty claim lists, concurrency, dataset changes, task replacement, recovery,
zero-row write conflicts, and edit-trigger selection/revert filtering.

Manual follow-up requires an authenticated viewer: keep the library open, merge
a claimed cell, wait three seconds and compare its displayed/copied root with
the viewer. Split it and confirm the claim follows the claim-point supervoxel.
Attempt a failed edit and an ordinary selection and confirm no refresh requests.
The edit trigger uses the existing visible-segment/tool heuristic, so edits
outside this viewer and legacy claims without a supervoxel are not covered.
