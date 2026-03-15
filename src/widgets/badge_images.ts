/**
 * badge_images.ts
 * Badge image URL map for the pyr badge set.
 *
 * Images are transparent PNGs served from /center-art/{track}/{slug}.png.
 * Auto-generated — do not edit manually.
 */

import { BADGE_DEFINITIONS } from './badge_definitions';

/**
 * Base path for badge center-art PNGs.
 * In production this resolves to the static assets directory.
 * Adjust if your deployment serves from a different root.
 */
const BASE = 'center-art';

/**
 * Maps imageKey ('building/charcoal', 'exploration/compass', etc.)
 * to its PNG URL.
 */
export const BADGE_IMAGE_MAP: Record<string, string> = Object.fromEntries(
  BADGE_DEFINITIONS.map(b => [b.imageKey, `${BASE}/${b.imageKey}.png`])
);
