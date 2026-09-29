/**
 * intro_roots.ts: keeps Tutorial 1 pointed at its neuron after an edit.
 *
 * The intro tutorial's saved views name the sandbox neuron by root id. A
 * merge on that neuron (someone who already knows how) gives it a new root
 * id, and so does the reset job's undo of that merge
 * (scripts/reset-practice-examples.mjs, config/intro-reset-fixtures.json).
 * The old id still names the old shape, but the 2D view colours the current
 * one, so the lesson breaks. Before a view loads, each pinned id is walked
 * down to a supervoxel (supervoxels never change) and back up to its root
 * today, and the view is rewritten to use it.
 */
import { anySupervoxelOf, rootOfSupervoxel, undoEditsSince } from './practice';

const INTRO = { pcg_server: 'https://minnie.microns-daf.com', pcg_table: 'pinky_training6' };

/** The neuron and the continuation branch the learner finds. */
export const INTRO_ROOTS = ['648518346353862024', '648518346356484078'];

/** Same as config/intro-reset-fixtures.json: edits after this are undone. */
const BASELINE = '2026-09-29T14:03:21Z';

// Re-resolved at most every 5 minutes, so an undo by the job is picked up.
let cached: { at: number; map: Promise<Map<string, string>> } | null = null;
let repairedThisVisit = false;

function introRootMap(): Promise<Map<string, string>> {
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.map;
  const map = (async () => {
    // Once per visit, when the tutorial first loads a view: if anyone has
    // edited the neuron since the baseline, undo it now rather than waiting
    // for the scheduled job (Ames, 2026-09-29). Nothing is changed when the
    // neuron is as it should be. If this learner may not undo, the job
    // (every 10 minutes) still will.
    if (!repairedThisVisit) {
      repairedThisVisit = true;
      try {
        const svs = await Promise.all(INTRO_ROOTS.map(r => anySupervoxelOf(INTRO, r)));
        const undone = await undoEditsSince(INTRO, svs, BASELINE);
        if (undone) console.info(`[tutorial] undid ${undone} edit(s) on the intro neuron`);
      } catch (e) {
        console.warn('[tutorial] could not check the intro neuron for edits:', e);
      }
    }
    const m = new Map<string, string>();
    await Promise.all(INTRO_ROOTS.map(async root => {
      try {
        const sv = await anySupervoxelOf(INTRO, root);
        const now = await rootOfSupervoxel(INTRO, sv);
        if (now && now !== root) {
          m.set(root, now);
          console.info(`[tutorial] intro segment ${root} is now ${now}`);
        }
      } catch (e) {
        console.warn(`[tutorial] could not look up the current id of ${root}:`, e);
      }
    }));
    return m;
  })();
  cached = { at: Date.now(), map };
  return map;
}

async function mapWithin(ms: number): Promise<Map<string, string>> {
  return Promise.race([introRootMap(), new Promise<Map<string, string>>(r => setTimeout(() => r(new Map()), ms))]);
}

/** The id to use today for a pinned intro root. */
export async function currentIntroRoot(id: string): Promise<string> {
  return (await mapWithin(6000)).get(id) ?? id;
}

/** Rewrite a saved view's pinned intro roots to today's ids. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function remapIntroState(state: any): Promise<any> {
  const layers: any[] = Array.isArray(state?.layers) ? state.layers : [];
  const intro = layers.filter(l => typeof l?.source === 'string' && l.source.includes(`/table/${INTRO.pcg_table}`));
  if (!intro.length) return state;
  const m = await mapWithin(6000);
  if (!m.size) return state;
  for (const layer of intro) {
    if (Array.isArray(layer.segments)) {
      layer.segments = layer.segments.map((s: any) => {
        const str = String(s), hidden = str.startsWith('!'), id = hidden ? str.slice(1) : str;
        return m.has(id) ? (hidden ? '!' : '') + m.get(id) : s;
      });
    }
    if (layer.segmentColors && typeof layer.segmentColors === 'object') {
      for (const [from, to] of m) {
        if (from in layer.segmentColors) {
          layer.segmentColors[to] = layer.segmentColors[from];
          delete layer.segmentColors[from];
        }
      }
    }
  }
  return state;
}
