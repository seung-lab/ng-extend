/**
 * Is this notification an Achievement award? Awards have exact titles:
 * "New Achievement!" (an admin's special award, with or without a leading
 * emoji) and "🏆 New Achievement: <name>" (tutorial, edit, cell and Loyalty
 * Achievements). A title that only contains the words, such as Ames's
 * announcement "New Achievements for Edits and Cell Completion!" (2026-11-04),
 * is an ordinary notification and must not open the unlock card.
 */
const AWARD_TITLE = /^(?:\p{Extended_Pictographic}️?\s*)*New Achievement(?:!|:)/u;

export function isAwardTitle(title: unknown): boolean {
  return typeof title === 'string' && AWARD_TITLE.test(title.trim());
}
