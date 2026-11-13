/** True for a click on the bug report button or the report itself (its form,
 *  and its "set up the screen first" bar). The side panels that close on a
 *  click elsewhere stay open for these, so a player can report a problem with
 *  the panel they are looking at (#512, Ames 2026-11-13). */
export function isBugReportClick(e: Event): boolean {
  const t = e.target as Element | null;
  return !!t?.closest?.('.nge-feedback-btn, #nge-feedback-modal, .nge-fb-setup-bar');
}
