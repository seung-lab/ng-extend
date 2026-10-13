/**
 * Annotation Quests (Ames 2026-10-12): annotating a cell as a quest, apart
 * from completing it. Retina first: find and mark every cilium on a
 * starburst amacrine cell.
 *
 * The quest's record is a tab of the lab's Cilia sheet. Only the server
 * reads or writes it (ewSheetSync, functions/sheet-policy.js): the Start
 * Link and the cell's names are read for the list; the player's name is
 * written when they take a cell; their chosen status, split or merged, share
 * link, date and notes are written when they submit. Nothing here touches
 * the game's tables, stats or Achievements.
 */
import { reactive } from 'vue';
import { functionUrl } from './functions_base';
import { makeLayer } from 'neuroglancer/layer';
import { parseRGBColorSpecification } from 'neuroglancer/util/color';

export const QUEST_KEY = 'retina_cilia';
export const QUEST_DATASET = 'stroeh_mouse_retina';
export const QUEST_TITLE = 'Cilia Quest';
/** The lab's own words for the quest (Celia, 2026-10-13), shown under its name. */
export const QUEST_LEAD = 'We\'re on the hunt for primary cilia, important cellular appendages that receive and process environmental signals. Cilia serve as “antennas” that cells use to sense the chemistry of their environment. Each cell only has one primary cilium, will you be the one to find it?';
/** The lab's guide to locating and annotating cilia (opens without a sign in). */
export const QUEST_GUIDE_URL = 'https://unitc-my.sharepoint.com/:p:/g/personal/ojxjl01_cloud_uni-tuebingen_de/IQDBsH6sbIjZRY5Gc3Flt5iaAUvXSDf4QLsyamGQ72f8rOo';
/** The training video, on YouTube, starting where the cilia part begins
 *  (Ames 2026-10-13). Left empty, the instructions do not mention a video. */
export const QUEST_VIDEO_URL = 'https://www.youtube.com/watch?v=-l2-R-9vX6o&t=1525s';
/** The sheet says "ON SAC" and "OFF SAC"; players read "Starburst" (Ames 2026-10-13). */
export const cellTypeForPlayers = (t: string) => String(t || '').replace(/\bSACs?\b/g, 'Starburst');

/** The sheet's own dropdown options, character for character (read
 *  2026-10-12). The server keeps the same list and refuses anything else. */
export const QUEST_STATUSES = [
  'Cilium annotated',
  'Cilium annotated (fixation artifact)',
  'Need help',
  'Need help: One centriole missing',
  'No cilium',
  'No cilium (BB & DC clear)',
  'No cilium (BB & DC unclear; internal centriole pair)',
  'No cilium (one centriole)',
  'Skipped (low quality)',
];
export const QUEST_SPLIT_MERGED = ['Split', 'Merged'];
/** How many cells a player may hold at once, claimed and not completed
 *  (Ames 2026-10-13). The server keeps the same number and refuses the next. */
export const QUEST_CLAIM_LIMIT = 3;

export interface QuestRow {
  index: string;
  segmentId: string;
  soma: string;
  cellClass: string;
  cellType: string;
  startLink: string;
  status: string;
  splitMerged: string;
  link: string;
  annotator: string;
  date: string;
  notes: string;
}

/** Letters and digits only, lower case: the server matches names the same way. */
export const nameKey = (v: string | null | undefined) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

async function call(action: string, body: Record<string, unknown> = {}): Promise<any> {
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch { /* signed out */ }
  if (!token) throw new Error('Sign in to take a quest.');
  const response = await fetch(functionUrl('ewSheetSync'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ quest: QUEST_KEY, action, token, ...body }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The quest sheet could not be reached.');
  return result;
}

/** The last list read, shared by the Quests tab, the Cell Library's tab
 *  count and the profile, so one read serves all three. */
export const questState = reactive({ rows: [] as QuestRow[], you: '', loaded: false });
/** The rows, and `you`: the name the sheet carries for this player (the
 *  server writes it, so it is the one to match rows against).
 *
 *  Callers that ask while a read is under way share it. The library's tab
 *  count and the Quests tab both ask as the library opens, and the server
 *  allows each player a limited number of reads a day (the anonymous tier,
 *  60), so one request must serve them all. For the same reason a read
 *  that finished within the last three seconds answers the next caller (the
 *  tab mounting just after the library's own read). A write starts the next
 *  read afresh, and only the newest read sets the shared state. */
type QuestList = { rows: QuestRow[]; you: string };
let listing: Promise<QuestList> | null = null;
let listSeq = 0;
let lastList: { at: number; value: QuestList } | null = null;
const LIST_REUSE_MS = 3000;
export function listQuests(): Promise<QuestList> {
  if (listing) return listing;
  if (lastList && Date.now() - lastList.at < LIST_REUSE_MS) return Promise.resolve(lastList.value);
  const seq = ++listSeq;
  const mine: Promise<QuestList> = (async () => {
    const r = await call('quest_list');
    const out = { rows: Array.isArray(r.rows) ? r.rows : [], you: typeof r.you === 'string' ? r.you : '' };
    if (seq === listSeq) {
      questState.rows = out.rows;
      questState.you = out.you;
      questState.loaded = true;
      lastList = { at: Date.now(), value: out };
    }
    return out;
  })();
  listing = mine;
  const clear = () => { if (listing === mine) listing = null; };
  mine.then(clear, clear);
  return mine;
}
/** A read under way was started before this write: the next one starts afresh. */
async function writing<T>(write: Promise<T>): Promise<T> {
  listing = null; lastList = null; listSeq++;
  try { return await write; } finally { listing = null; lastList = null; listSeq++; }
}
/** Cells nobody holds and nobody has completed: what there is to claim. */
export function questOpenCount(): number {
  return questState.rows.filter(r => !r.annotator && !r.status).length;
}
export async function claimQuest(segmentId: string) { return writing(call('quest_claim', { segmentId })); }
export async function releaseQuest(segmentId: string) { return writing(call('quest_release', { segmentId })); }
export async function submitQuest(segmentId: string, done: { status: string; splitMerged: string; link: string; notes: string }) {
  return writing(call('quest_submit', { segmentId, ...done }));
}

/**
 * The lab's Start Link opens with its own annotation layers (Basal body,
 * Daugther centriole, the lab's spelling). Once the state is in, the layers
 * get the game's colours, and a line layer for the cilium's centerline is
 * added when the view has none (Ames 2026-10-13: "we need the cilium
 * centerline annotation layer added as well, and nicer colours"). Nothing of
 * the lab's is removed or renamed; a share link carries the colours along.
 */
/** The colour key the top bar uses (src/data/toolbar-icons.ts): Highlight's
 *  green, the cut tool's red, the trophy gold (Ames 2026-10-13). In the order
 *  the layers are put in: centerline, daughter centriole, basal body. */
export const QUEST_LAYER_COLORS: { match: RegExp; color: string }[] = [
  { match: /cent(er|re)line|cilium/i, color: '#7CFFB2' }, // green
  { match: /centriole/i, color: '#e06060' },             // red
  { match: /basal/i, color: '#f5d142' },                 // gold
];
/** Spelled as the lab's own views spell it ("Cilium centerline", read from
 *  its example views 2026-10-13), so whatever of the lab's reads a share link
 *  by layer name finds the centerline where it expects it. */
export const CENTERLINE_LAYER = 'Cilium centerline';
/** The layers in the view right now, to tell the Start Link's fresh ones
 *  from what was there before it loaded (see dressQuestLayers). */
export function layerSnapshot(): Set<any> {
  try { return new Set((window as any)['viewer']?.layerManager?.managedLayers ?? []); } catch { return new Set(); }
}
export async function dressQuestLayers(before?: Set<any>): Promise<{ colored: string[]; added: boolean }> {
  const out = { colored: [] as string[], added: false };
  const viewer: any = (window as any)['viewer'];
  if (!viewer?.layerManager) return out;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const layers = (): any[] => viewer.layerManager.managedLayers ?? [];
  const isAnnotation = (ml: any) => ml?.layer?.type === 'annotation' || ml?.layer?.constructor?.type === 'annotation';
  const lab = () => layers().filter(ml => isAnnotation(ml) && /basal|centriole/i.test(ml.name));
  // The Start Link's state loads in the background and REPLACES every layer
  // with a fresh one, so colouring what is on screen at the moment of the
  // click is undone a moment later. Wait for lab layers that were not there
  // before the link was opened (or, when the view already had this very
  // state, give up waiting after six seconds and dress what is there).
  const fresh = () => { const f = lab(); return f.length > 0 && (!before || f.some(ml => !before.has(ml))); };
  for (let i = 0; i < 60 && !fresh(); i++) await sleep(100);
  await sleep(300);  // the restore makes its layers in one go; let it finish
  console.info('[quests] dressing layers:', layers().map(ml => `${ml.name}:${ml.layer?.type ?? ml.layer?.constructor?.type ?? '?'}`).join(', '), lab().length ? '' : '(no lab layers found)');
  // The lab's saved states open the Selection panel on the right (Ames
  // 2026-10-13: "it's opening a selection side panel when I claim"). Close
  // it; the layer's own panel, with the annotation list, stays as saved.
  try { const vis = viewer.selectionDetailsState?.location?.watchableVisible; if (vis && vis.value) vis.value = false; } catch { /* no such panel */ }
  if (!lab().length) return out;
  for (const ml of layers()) {
    if (!isAnnotation(ml)) continue;
    const rule = QUEST_LAYER_COLORS.find(q => q.match.test(ml.name));
    if (!rule) continue;
    try { ml.layer.annotationDisplayState.color.value = parseRGBColorSpecification(rule.color); out.colored.push(ml.name); }
    catch (e) { console.warn('[quests] could not colour layer', ml.name, e); }
  }
  if (!layers().some(ml => isAnnotation(ml) && /cent(er|re)line/i.test(ml.name))) {
    try {
      const managed = makeLayer(viewer.layerSpecification, CENTERLINE_LAYER, {
        type: 'annotation', source: 'local://annotations', annotations: [],
        // The centerline is a polyline, the lab's own annotation for it.
        annotationColor: QUEST_LAYER_COLORS[0].color, tool: 'annotatePolyline',
      });
      viewer.layerSpecification.add(managed);
      out.added = true;
    } catch (e) { console.warn('[quests] could not add the centerline layer:', e); }
  }
  // The order of the tabs: centerline, daughter centriole, basal body, from
  // the first of them onward; every other layer keeps its place.
  try {
    const all = layers();
    const quest = QUEST_LAYER_COLORS.map(q => all.find(ml => isAnnotation(ml) && q.match.test(ml.name))).filter(Boolean);
    if (quest.length > 1) {
      const base = Math.min(...quest.map(ml => all.indexOf(ml)));
      quest.forEach((ml, i) => {
        const now = viewer.layerManager.managedLayers.indexOf(ml);
        if (now >= 0 && now !== base + i) viewer.layerManager.reorderManagedLayer(now, base + i);
      });
    }
  } catch (e) { console.warn('[quests] could not order the layers:', e); }
  return out;
}

/** Annotation points in the view right now: the local annotation layers'
 *  points, lines and the rest, counted. A share link carries exactly these. */
export function annotationCountInView(): number {
  try {
    const viewer: any = (window as any)['viewer'];
    let n = 0;
    // The layers as they are, from the viewer itself.
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const layer = ml?.layer;
      if (!layer || layer.type !== 'annotation') continue;
      const local = layer.localAnnotations?.toJSON?.();
      const pending = Array.isArray(layer.localAnnotationsJson) ? layer.localAnnotationsJson.length : 0;
      n += Array.isArray(local) && local.length ? local.length : pending;
    }
    if (n > 0) return n;
    // Otherwise what a share link would carry: the saved state.
    const layers: any[] = viewer?.state?.toJSON?.()?.layers ?? [];
    return layers.filter(l => l && l.type === 'annotation' && Array.isArray(l.annotations))
      .reduce((m, l) => m + l.annotations.length, 0);
  } catch { return 0; }
}
