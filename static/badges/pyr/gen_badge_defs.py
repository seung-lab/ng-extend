"""Generate badge_definitions.ts for ng-extend from pyr manifest."""
import json

MANIFEST = "C:/Users/amyle/Documents/New project/static/badges/pyr/manifest.json"
OUTPUT = "C:/Users/amyle/ng-extend/src/widgets/badge_definitions.ts"

with open(MANIFEST, "r", encoding="utf-8") as f:
    data = json.load(f)

building = [e for e in data["manifest"] if e["theme"] == "building"]
exploration = [e for e in data["manifest"] if e["theme"] == "exploration"]

def fmt_threshold(n):
    """Format number with underscore separators for TypeScript."""
    s = f"{n:_}"
    return s.replace("_", "_")

def escape(s):
    return s.replace("'", "\\'").replace('"', '\\"')

lines = []
lines.append("""/**
 * badge_definitions.ts
 * Eyewire II \u2014 Badge catalogue for the community branch.
 *
 * Two tracks:
 *   - Building (100 badges) \u2014 earned via edits, cubic curve 1 \u2192 1,000,000
 *   - Exploration (100 badges) \u2014 earned via cells completed, cubic curve 1 \u2192 50,000
 *
 * Auto-generated from pyr manifest. Do not edit manually.
 */

export type BadgeTrack = 'building' | 'exploration';

export interface BadgeDefinition {
  /** Unique badge ID: building badges 1\u2013100, exploration badges 101\u2013200. */
  id: number;
  /** Which track this badge belongs to. */
  track: BadgeTrack;
  /** Sequence within the track (1\u2013100). */
  sequence: number;
  /** URL-friendly slug (used as image key). */
  slug: string;
  /** Short code (2\u20133 letters). */
  code: string;
  name: string;
  description: string;
  /**
   * Key used to look up the image in BADGE_IMAGE_MAP.
   * Format: 'building/<slug>' or 'exploration/<slug>'.
   */
  imageKey: string;
  /**
   * Number of all-time edits (building) or cells completed (exploration)
   * required to earn this badge.
   */
  threshold: number;
  /**
   * @deprecated Alias for threshold. Kept for backward compatibility.
   */
  editThreshold: number;
}
""")

# Building badges
lines.append("export const BUILDING_BADGES: BadgeDefinition[] = [")
for entry in building:
    seq = entry["sequence"]
    bid = seq
    slug = entry["slug"]
    code = entry["code"]
    title = escape(entry["title"])
    desc = escape(entry["description"])
    threshold = entry["threshold"]
    image_key = f"building/{slug}"
    lines.append(
        f"  {{ id: {bid}, track: 'building', sequence: {seq}, slug: '{slug}', "
        f"code: '{code}', name: '{title}', description: '{desc}', "
        f"imageKey: '{image_key}', threshold: {fmt_threshold(threshold)}, "
        f"editThreshold: {fmt_threshold(threshold)} }},"
    )
lines.append("];")
lines.append("")

# Exploration badges
lines.append("export const EXPLORATION_BADGES: BadgeDefinition[] = [")
for entry in exploration:
    seq = entry["sequence"]
    bid = 100 + seq
    slug = entry["slug"]
    code = entry["code"]
    title = escape(entry["title"])
    desc = escape(entry["description"])
    threshold = entry["threshold"]
    image_key = f"exploration/{slug}"
    lines.append(
        f"  {{ id: {bid}, track: 'exploration', sequence: {seq}, slug: '{slug}', "
        f"code: '{code}', name: '{title}', description: '{desc}', "
        f"imageKey: '{image_key}', threshold: {fmt_threshold(threshold)}, "
        f"editThreshold: {fmt_threshold(threshold)} }},"
    )
lines.append("];")
lines.append("")

# Combined + helpers
lines.append("""/** All 200 badges, building first then exploration. */
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  ...BUILDING_BADGES,
  ...EXPLORATION_BADGES,
];

/** Helper: get badges for a specific track. */
export function badgesForTrack(track: BadgeTrack): BadgeDefinition[] {
  return track === 'building' ? BUILDING_BADGES : EXPLORATION_BADGES;
}

/** Helper: get the stat key to check for a given track. */
export function statKeyForTrack(track: BadgeTrack): 'editsAllTime' | 'cellsSubmitted' {
  return track === 'building' ? 'editsAllTime' : 'cellsSubmitted';
}
""")

content = "\n".join(lines)
with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Wrote {len(building)} building + {len(exploration)} exploration badges to {OUTPUT}")
