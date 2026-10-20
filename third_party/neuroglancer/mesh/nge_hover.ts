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
  // Ames 2026-10-20: the first halo (14 px, 0.85) was too much; reduced.
  {widthPx: 1, alpha: 0.5}, {widthPx: 2.5, alpha: 0.34}, {widthPx: 4, alpha: 0.22},
  {widthPx: 5.5, alpha: 0.12}, {widthPx: 7, alpha: 0.05},
];
