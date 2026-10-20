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
  {widthPx: 1.5, alpha: 0.85}, {widthPx: 3, alpha: 0.62}, {widthPx: 5, alpha: 0.44},
  {widthPx: 7.5, alpha: 0.29}, {widthPx: 10.5, alpha: 0.17}, {widthPx: 14, alpha: 0.08},
];
