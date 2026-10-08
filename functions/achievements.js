'use strict';
// Announcing an earned achievement in chat (Ames 2026-10-08): the grey line
// "Nseraf earned Altimeter" that anyone can click to see that player's
// Trophy Case. A browser asks; the server decides. It checks the achievement
// exists and that the player's own counters (which only the server moves,
// from the game's log) have really reached it, then writes the chat row
// itself with a rank no browser can set.
//
// achievement-thresholds.json is made from src/widgets/badge_definitions.ts by
// scripts/build-achievement-thresholds.js; a test keeps the two in step.
const TABLE = require('./achievement-thresholds.json');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

/** Which counter a track is earned on. Only the two tracks that are live. */
const COUNTER = {building: 'total_edits', exploration: 'cells_completed'};
/** Cell achievements 2, 3 and 4 are earned but not announced (Ames). */
const QUIET = new Set(['exploration:2', 'exploration:3', 'exploration:4']);

/**
 * The chat row for an achievement, or a refusal.
 *   track, id   what the browser says was earned
 *   totals      the player's counters, read from the database by the server
 * Returns {text, dataset, name, slug} for the row, or {quiet:true} for an
 * achievement that is real but not announced.
 */
function achievementRow(track, id, totals) {
  const def = TABLE.find(a => a.track === track && a.id === Number(id));
  if (!def || !COUNTER[track]) fail(400, 'Unknown achievement.');
  const have = Number(totals && totals[COUNTER[track]]) || 0;
  if (have < def.threshold) fail(400, 'Not earned yet.');
  if (QUIET.has(`${track}:${def.threshold}`)) return {quiet: true};
  return {
    // Readable on its own, so a browser tab still running an older build
    // shows a sensible message instead of a code.
    text: `earned the ${def.name} achievement`,
    // What the app reads to draw the line and open the right Trophy Case.
    dataset: `achievement:${def.track}:${def.id}`,
    name: def.name,
    slug: def.slug,
  };
}

/**
 * The chat row for a special award (the ones an admin gives, and the ones a
 * tutorial gives). The server has already confirmed the award exists for
 * that player; this only shapes the row.
 */
function specialAwardRow(badge) {
  const id = Number(badge && badge.id);
  const name = String((badge && badge.name) || '').trim().slice(0, 80);
  if (!Number.isInteger(id) || id <= 0 || !name) fail(400, 'Unknown award.');
  return {text: `earned the ${name} award`, dataset: `achievement:special:${id}`, name};
}

module.exports = {achievementRow, specialAwardRow, COUNTER, QUIET, TABLE};
