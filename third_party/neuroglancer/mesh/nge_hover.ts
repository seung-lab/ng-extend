/**
 * EyeWire II hover outline and halo (ngeHoverStyle in
 * segmentation_display_state/frontend.ts): the shells drawn around the cell
 * under the mouse. Drawn by perspective_view/panel.ts through
 * MeshLayer.ngeDrawShells (mesh/frontend.ts). Kept apart so both can import
 * it without importing each other.
 */
export type NgeShell = {widthPx: number, alpha: number};

/** The outline: one crisp line. */
export const NGE_OUTLINE_SHELLS: NgeShell[] = [{widthPx: 2.5, alpha: 1}];

/** The halo: shells fading outward. Each pixel keeps its brightest shell
 *  (MAX blending), so overlapping triangles never pile up to white. */
export const NGE_HALO_SHELLS: NgeShell[] = [
  // Ames 2026-10-20: the first halo (14 px) was too much, the second (7 px,
  // starting at half strength) too dim. Full strength at the edge, 9 px out.
  {widthPx: 1, alpha: 1}, {widthPx: 2, alpha: 0.8}, {widthPx: 3.5, alpha: 0.55},
  {widthPx: 5, alpha: 0.35}, {widthPx: 7, alpha: 0.18}, {widthPx: 9, alpha: 0.08},
];
