/**
 * Cell match (Ames 2026-11-12): while a player works a Sandbox Cell Library
 * cell, a small HUD at the top left says how close the cell is to the
 * finished one, and it updates a few seconds after every merge or cut.
 *
 * Two rows (Ames: "one category for cut and one for merge", by size, each on
 * its own line): Missing, the share of the missing parts merged back in, and
 * Mergers, the share of the wrongly merged parts cut off.
 *
 * After Complete (Ames: "it should say Complete and Review ... instead of
 * taking me immediately to a new cell it should show me what I missed") the
 * HUD turns into a review: the final numbers, the missed pieces drawn in gold,
 * the mergers still attached pinned, and Next cell when the player is ready.
 *
 * The scores come from the server (ewSandboxMatch, functions/sandbox-match.js),
 * which compares the player's cell with the true cell in pinky_training; the
 * answer key never reaches the browser, only what is still wrong after Complete.
 */
import { startLoader, type Live } from './find_path_status';
import { fullViewUrl } from './util/local_view';
import { exitGrapheneTool, activeGrapheneToolKind, activateGrapheneTool } from './widgets/graphene_tool_utils';
import { highlightStyles, saveHighlightStyles, MAX_HIGHLIGHT_STYLES } from './util/highlight';
import { secureWrite } from './secure_write';
import { canonicalDataset, currentDatasetTag, currentSegLayer } from './datasets';
import { Uint64 } from 'neuroglancer/util/uint64';
import { makeLayer } from 'neuroglancer/layer';
import { reactive, createApp, type App as VueApp } from 'vue';
import { setStatedColor } from './widgets/widget_utils';
import { openSplitView } from './practice';
import { getActivePinia } from 'pinia';
import EditableText from './components/EditableText.vue';
import NeuronGlyph from './components/NeuronGlyph.vue';
import { isLatestRoots, getRootFromSupervoxel } from './widgets/pcg_service';
import { currentIdsOf } from './util/outdated_ids';
import { setNgeGlow, type NgeGlow } from 'neuroglancer/perspective_view/nge_props';
import { cameraAxes } from './util/starship';
// The Cell Library's own neuron (Ames 2026-11-14: "use the neuron").
import neuronIcon from '../static/badges/pyr/neuron-icon-white.png';

export interface SandboxClaim { id: number; dataset: string; roots: string[]; /** A supervoxel of the cell (its soma). */ anchor?: string }
export interface SavedLinkInput { title: string; note?: string; url: string; dataset?: string; position?: [number, number, number]; visibleSegments?: string[] }
interface Deps { claims: () => SandboxClaim[]; signedIn: () => boolean; saveLink?: (l: SavedLinkInput) => Promise<string | null>; myLinkTitles?: () => string[] }
export interface MatchResult {
  taskId: number; scorable: boolean; root?: string; match?: number | null;
  /** The match score: how much the player's cell and the true cell match, by
   *  size (shared over the two together), 0 to 100. */
  score?: number | null;
  /** The score the cell started at, and the player's merges and cuts on it. */
  startScore?: number | null; edits?: number | null;
  /** Share of the missing parts merged in, and of the extra parts cut off, by
   *  size; null when there was nothing of that kind to fix. */
  merge?: number | null; cut?: number | null;
  missing?: { left: number; total: number }; extra?: { left: number; total: number };
  /** The cell starts as little more than its nucleus. */
  nucleusOnly?: boolean;
  /** Nothing to fix when this player began: someone finished it already. */
  alreadyDone?: boolean;
  /** Nothing was wrong at the start; the player merged something wrong in and has cut all of it off. */
  cutDone?: boolean;
  /** Wrong parts attached now, wherever they came from. */
  cutParts?: number;
}
/** The player's Sandbox accuracy (match.mine). */
export interface Mine { cells: number; accuracy: number | null; lowRun: number; reviewFirst: boolean; lowScore: number; lowRunNeeded: number }
export interface ReviewResult extends MatchResult {
  missed?: { root: string; size: number; pointNm: number[] }[];
  mergers?: { size: number; pointNm: number[] }[];
}
type Row = 'merge' | 'cut';

const CARD_ID = 'nge-cell-match';
const DONE_MS = 2500;
const STYLE_ID = 'nge-cell-match-style';
const CHIP_ID = 'nge-cell-match-open';
const HINT_ID = 'nge-cell-match-hint';
const SAVED_ID = 'nge-cell-match-saved';
const CLOSED_KEY = 'nge-cell-match-closed';
const HINTED_KEY = 'nge-cell-match-hinted';
const MIN_KEY = 'nge-cell-match-min';
/** Play is on, playing cells, on the Sandbox: the card stays up the whole time
 *  (Ames 2026-11-13: "if I am actively playing on Sandbox have the accuracy box
 *  there"). Read from Play's own session flag (util/play.ts imports the store,
 *  which imports this file, so it is not imported here). */
function isPlaying(): boolean {
  let on: string | null = null;
  try { on = sessionStorage.getItem('nge_play_on'); } catch { /* private window */ }
  return on === 'cells';
}
/** Signed in and playing on the Sandbox: the card is up. */
function onSandbox(): boolean {
  // Only while playing (Ames 2026-11-13: "it should appear after I'm already
  // playing"): before that the Play button is the way in.
  return !!deps && deps.signedIn() && isPlaying() && canonicalDataset(currentDatasetTag()) === 'pinky_nf_v2';
}
/** The Standby line and its button: Play when not playing, else back to the
 *  cell in hand. Both press the game's own Play controls. */
/** Holding a Sandbox cell now. With none (a cell just completed or skipped),
 *  Play opens a new one (Ames 2026-11-16: "shouldn't this be open new cell
 *  ... like after I have finished"). */
function holdsCell(): boolean { try { return (deps?.claims() ?? []).length > 0; } catch { return true; } }
function standbyNote(): string {
  if (!isPlaying()) return 'Press Play for a sim cell';
  return holdsCell() ? 'Your cell is not on screen' : 'Ready for your next sim cell';
}
const BOLT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4.5 13.5h6L9.5 22l10-12.5h-6.2z" fill="currentColor"/></svg>';
/** The click sends lightning from the key across the face until the cell is
 *  up (the card leaves standby), then it strikes; as Play and Jump do. */
function startTeleportBolt(b: HTMLButtonElement, el: HTMLElement) {
  const face = b.querySelector('.nge-cm-tlabel') as HTMLElement | null;
  if (!face || face.querySelector('canvas')) return;
  const cv = document.createElement('canvas');
  cv.className = 'nge-cm-tloader';
  cv.setAttribute('aria-hidden', 'true');
  face.appendChild(cv);
  b.classList.add('nge-cm-teleporting');
  const live: Live = { raf: 0, timer: 0 };
  startLoader(cv, live, face.clientWidth + 9.5, 22, 6);
  const t0 = performance.now();
  const end = () => { cancelAnimationFrame(live.raf); cv.remove(); b.classList.remove('nge-cm-teleporting'); };
  const watch = window.setInterval(() => {
    const up = !b.isConnected || !el.classList.contains('nge-cm-idle');
    const slow = performance.now() - t0 > 20000;
    if (!up && !slow) return;
    clearInterval(watch);
    if (up && live.finish && b.isConnected) live.finish(end); else end();
  }, 120);
}
function standbyAction() {
  const playing = isPlaying();
  const chip = document.querySelector('.nge-play-chip') as HTMLElement | null;
  const btn = document.querySelector('.nge-play-btn') as HTMLElement | null;
  (playing ? (chip ?? btn) : (btn ?? chip))?.click();
}
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const EDIT_WAIT_MS = 2000;
const SANDBOX_SOURCE = 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2';
const MISSED_LAYER = 'Missed pieces';
const MERGERS_LAYER = 'Mergers left';
const GOLD = '#ffd36e';
const RED = '#ff6b8a';

let deps: Deps | null = null;
let onScreen: number | null = null;
let shownFor: number | null = null;
const last = new Map<number, MatchResult>();
/** Roots each claim's cell has had after an edit, until the claim catches up. */
const aliases = new Map<number, Set<string>>();
let editTimer: ReturnType<typeof setTimeout> | null = null;
let asking = 0;
/** While a review is up the HUD belongs to it, whatever is on screen. */
let reviewing = false;
/** "Cut complete" / "Merge complete" for a moment after an edit (Ames 2026-11-13). */
let doneText = '';
let doneUntil = 0;
let doneTone: 'plain' | 'good' | 'bad' = 'plain';
let doneTimer: ReturnType<typeof setTimeout> | null = null;
/** The edit waiting for its reading, to judge it when the reading comes
 *  (Ames 2026-11-13: "I got cut complete ... but it was wrong cut"). */
let editKind: 'merge' | 'split' | null = null;
const VERDICT_MS = 4500;

/** After a good edit Jump glows once, about 2 s, so the next spot is one
 *  click away (kfay, report 564). No lasting beat. */
let glowTimer: ReturnType<typeof setTimeout> | null = null;
function glowJumpOnce(el: HTMLElement) {
  const h = el.querySelector('.nge-cm-hbtn') as HTMLElement | null;
  if (!h) return;
  h.classList.remove('nge-cm-glow1');
  void h.offsetWidth;
  h.classList.add('nge-cm-glow1');
  if (glowTimer) clearTimeout(glowTimer);
  glowTimer = setTimeout(() => { glowTimer = null; h.classList.remove('nge-cm-glow1'); }, 2100);
}

/** Says on the card's top line, for a while, how the last edit went. */
function flash(text: string, tone: 'plain' | 'good' | 'bad', ms: number) {
  doneText = text;
  doneTone = tone;
  doneUntil = Date.now() + ms;
  const el = document.getElementById(CARD_ID);
  if (el && !reviewing) {
    el.classList.toggle('nge-cm-done', tone === 'good');
    el.classList.toggle('nge-cm-bad', tone === 'bad');
    (el.querySelector('.nge-cm-state') as HTMLElement).textContent = text;
    if (tone === 'good') glowJumpOnce(el);
  }
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    doneTimer = null;
    const c = document.getElementById(CARD_ID);
    if (!c || reviewing || Date.now() < doneUntil) return;
    c.classList.remove('nge-cm-done', 'nge-cm-bad');
    if (c.classList.contains('nge-cm-idle')) return;
    (c.querySelector('.nge-cm-state') as HTMLElement).textContent = c.classList.contains('nge-cm-checking') ? 'Checking' : 'Live';
  }, ms + 50);
}

/** Good or wrong: a row that went down, or more pieces left than before, is a
 *  wrong edit; a row that went up, or fewer pieces left, a good one. */
export function judgeEdit(kind: 'merge' | 'split', prev: MatchResult, now: MatchResult): { text: string; tone: 'plain' | 'good' | 'bad' } {
  const word = kind === 'split' ? 'cut' : 'merge';
  const rowMove = (a: number | null | undefined, b: number | null | undefined) =>
    a == null && b != null ? -1 : a != null && b != null ? Math.sign(b - a) : 0;
  const leftMove = (a?: { left: number }, b?: { left: number }) => (a && b ? Math.sign(a.left - b.left) : 0);
  // Judged by what the edit is for (Ames 2026-11-19: merging the nucleus
  // onto the cell said Wrong merge, then right). A merge that brings in
  // missing pieces is good even when a wrong part comes along; that part is
  // for a cut. A cut that takes off part of the cell itself is wrong.
  const mergeMoves = [rowMove(prev.merge, now.merge), leftMove(prev.missing, now.missing)];
  const cutMoves = [rowMove(prev.cut, now.cut), leftMove(prev.extra, now.extra)];
  const [ours, other] = kind === 'merge' ? [mergeMoves, cutMoves] : [cutMoves, mergeMoves];
  if (ours.some(m => m < 0)) return { text: `Wrong ${word}`, tone: 'bad' };
  if (kind === 'split' && other.some(m => m < 0)) return { text: `Wrong ${word}`, tone: 'bad' };
  if (ours.some(m => m > 0)) return { text: `Good ${word}`, tone: 'good' };
  if (other.some(m => m < 0)) return { text: `Wrong ${word}`, tone: 'bad' };
  if (other.some(m => m > 0)) return { text: `Good ${word}`, tone: 'good' };
  return { text: 'No change', tone: 'plain' };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
// Named for what you do (Ames 2026-11-13: "Missing" and "Mergers" were confusing).
const ROW_LABEL: Record<Row, string> = { merge: 'Merge', cut: 'Cut' };
const ROW_SHORT: Record<Row, string> = { merge: 'M', cut: 'C' };
// Ames 2026-11-13: "Playing: Practice Cell" over one Match Score.
const TITLE_HTML = 'Training Sim';
// Merge and Cut together, half each, so it starts at 0 (Ames 2026-11-13:
// "match score should start at 0"). By total size, one big merger cut off read
// 90% with every thin missing piece still missed ("I got 90% and missed everything").
const scoreTip = (pct: number | null | undefined) => `Match score${pct == null ? '' : ` ${pct}%`}: your Merge and Cut together, half each`;
/** The match score: Merge and Cut averaged (only the ones this cell has). */
export function matchScore(r: MatchResult): number | null {
  const parts = [r.merge, r.cut].filter((n): n is number => n != null);
  // To a tenth, as the Merge row (Ames 2026-11-18: a tiny piece still counts).
  return parts.length ? Math.floor(parts.reduce((a, b) => a + b, 0) / parts.length * 10 + 1e-9) / 10 : null;
}

/** Remove a layer of ours. If its panel was open, close the panel first:
 *  with the selected layer gone, Neuroglancer opened the first layer's Source
 *  tab, "2D EM" (Ames 2026-11-14: "why does this Source tab keep opening?"). */
function dropLayer(v: any, ml: any) {
  try { if (v.selectedLayer?.layer === ml) v.selectedLayer.visible = false; } catch { /* no panel */ }
  v.layerManager.removeManagedLayer(ml);
}
/** Under a row's percent: pieces done of all, or that there is nothing to do. */
export function rowPieces(r: MatchResult, row: Row): string {
  const pct = row === 'merge' ? r.merge : r.cut;
  const p = row === 'merge' ? r.missing : r.extra;
  if (pct == null && row === 'cut' && r.cutDone) return 'all cut off ✓ nice work';
  if (pct == null) return row === 'merge' ? 'nothing to add' : 'nothing to cut';
  // Plain counts, never blame (Ames 2026-11-16: "3 of 10 pieces added";
  // "an error was merged in" read "like I did an error").
  // A cell that started with nothing to cut: the percent alone (Ames 2026-11-16:
  // "for Cut we say no line at all").
  if (!p || !p.total) return row === 'merge' ? 'a piece to add back' : '';
  return row === 'merge' ? `${p.total - p.left} of ${plural(p.total, 'piece')} added` : `${p.total - p.left} of ${plural(p.total, 'part')} cut off`;
}

/** Cells the HUD scores: their Complete says "Complete and Review" (reactive,
 *  for the Cell Library's buttons). */
const reviewable = reactive(new Set<number>());
export function hasReview(taskId: number | null | undefined): boolean {
  return taskId != null && reviewable.has(taskId);
}
function noteResult(taskId: number, r: MatchResult) {
  last.set(taskId, r);
  lookAhead(taskId, r);
  if (r.scorable && (r.merge !== undefined || r.cut !== undefined)) reviewable.add(taskId); else reviewable.delete(taskId);
}

/** The Sandbox claim whose cell is on screen now, or null. */
function claimOnScreen(): number | null {
  if (!deps || !deps.signedIn()) return null;
  if (canonicalDataset(currentDatasetTag()) !== 'pinky_nf_v2') return null;
  const mine = deps.claims().filter(c => canonicalDataset(c.dataset) === 'pinky_nf_v2');
  if (!mine.length) return null;
  const ml = currentSegLayer();
  if (!ml || ml.visible === false || ml.archived) return null;
  const vis = ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!vis) return null;
  const shown = (c: SandboxClaim) => {
    const roots = [...c.roots, ...(aliases.get(c.id) ?? []), ...(last.get(c.id)?.root ? [last.get(c.id)!.root!] : [])];
    for (const r of roots) {
      if (!/^\d+$/.test(r)) continue;
      try { if (vis.has(Uint64.parseString(r))) return true; } catch { /* not an ID */ }
    }
    return false;
  };
  const found = mine.find(shown)?.id ?? null;
  if (found == null) void findCellOnScreen(mine, vis);
  return found;
}

/** No claim's IDs on screen: ask which cell each claim's soma is in now, and
 *  take it if that is on screen (kfay, report 560: "points still in stand by
 *  even after a dozen merge"). The claim's own IDs are brought up to date
 *  only for a claim seen on screen lately, so after merges made while the box
 *  had lost track (a reload, a lookup that failed) nothing ever caught up.
 *  At most every 10 s. */
let lookedForCell = 0;
async function findCellOnScreen(mine: SandboxClaim[], vis: any) {
  if (Date.now() - lookedForCell < 10_000 || !vis.size) return;
  lookedForCell = Date.now();
  for (const c of mine) {
    if (!c.anchor) continue;
    const root = await getRootFromSupervoxel(c.anchor).catch(() => null);
    if (!root || !/^\d+$/.test(root)) continue;
    let here = false;
    try { here = vis.has(Uint64.parseString(root)); } catch { /* not an ID */ }
    if (here) {
      aliases.set(c.id, new Set([...(aliases.get(c.id) ?? []), root]));
      console.debug('[cell-match] claim', c.id, 'is on screen as', root);
      return;
    }
    // A reloaded view can hold the cell as it was before the last edit
    // (Ames 2026-11-19: "I'm already on my cell. I simply refreshed the
    // page"). An ID on screen that has since become this root is the cell;
    // once found, swapOldIds puts the current one in its place.
    const ids = [...vis].map((v: any) => String(v)).filter(id => /^\d+$/.test(id) && id !== root).slice(0, 12);
    for (const id of ids) {
      const now = await currentIdsOf(id).catch(() => null);
      if (!now || !now.includes(root)) continue;
      aliases.set(c.id, new Set([...(aliases.get(c.id) ?? []), id]));
      console.debug('[cell-match] claim', c.id, 'is on screen as an older', id, 'of', root);
      return;
    }
  }
}

// ── The HUD ─────────────────────────────────────────────────────────────────
// A cockpit readout (Ames: "make this box badass like a cockpit HUD"): Pyr's
// Orbitron, corner brackets, a faint scan grid, tick-marked gauges in blue.
// Nothing moves on its own; a new reading sweeps once.
const GUIDE_ID = 'nge-cell-match-guide';
const CSS = `
#${CARD_ID}{position:fixed;top:64px;left:12px;z-index:59;width:350px;min-width:300px;max-width:calc(100vw - 24px);resize:both;overflow:auto;box-sizing:border-box;
  padding:12px 14px 11px;color:#dfe8f6;font:14px/1.4 Inter,system-ui,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;
  background:linear-gradient(135deg,rgba(4,6,14,.95),rgba(10,16,32,.94));border:1px solid rgba(74,158,255,.45);border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 22px rgba(74,158,255,.14);backdrop-filter:blur(6px);overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(127,190,255,.35) transparent;pointer-events:auto}
/* Ames 2026-11-19: a box resized smaller scrolls. The sweep stays inside the
   box (it moves its background, not itself), so it never adds a scrollbar. */
#${CARD_ID}::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,transparent 40%,rgba(127,216,255,.16) 50%,transparent 60%) 0 100%/100% 300% no-repeat}
#${CARD_ID}.nge-cm-ping::after{animation:nge-cm-sweep .9s ease-out 1}
@keyframes nge-cm-sweep{0%{background-position:0 100%;opacity:1}100%{background-position:0 0;opacity:0}}
@media (prefers-reduced-motion:reduce){#${CARD_ID}.nge-cm-ping::after{animation:none}}
#${CARD_ID} .nge-cm-head{display:flex;align-items:center;gap:4px;margin:-11px -14px 6px;padding:11px 14px 4px;cursor:grab;touch-action:none;user-select:none;font:600 11.5px/1 Orbitron,Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#7fc8ff}
#${CARD_ID} .nge-cm-dot{width:8px;height:8px;border-radius:50%;background:#59e3a7;box-shadow:0 0 6px #59e3a7}
#${CARD_ID}.nge-cm-dragging .nge-cm-head{cursor:grabbing}
#${CARD_ID}.nge-cm-checking .nge-cm-dot{background:#7fc8ff;box-shadow:0 0 6px #7fc8ff}
#${CARD_ID} .nge-cm-title{white-space:nowrap;letter-spacing:.05em;min-width:0;overflow:hidden;text-overflow:ellipsis}
#${CARD_ID} .nge-cm-pre{color:#6f9cc8}
#${CARD_ID} .nge-cm-state{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px/1 Inter,system-ui,sans-serif;color:#7f9fc2;letter-spacing:.04em}
#${CARD_ID} .nge-cm-row{display:grid;grid-template-columns:1fr auto;align-items:end;column-gap:8px;padding:3px 0 2px}
#${CARD_ID} .nge-cm-label{font:600 11.5px/1 Orbitron,Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#8fb6dc}
#${CARD_ID} .nge-cm-read{display:flex;align-items:baseline;gap:6px;justify-self:end}
#${CARD_ID} .nge-cm-num{font:600 16px/1 Inter,system-ui,sans-serif;color:#eaf2ff;transition:opacity .3s}
#${CARD_ID}.nge-cm-checking .nge-cm-num{opacity:.5}
#${CARD_ID}.nge-cm-done{border-color:rgba(89,227,167,.75);box-shadow:0 0 26px rgba(89,227,167,.28),inset 0 0 18px rgba(89,227,167,.12);transition:border-color .3s,box-shadow .3s}
#${CARD_ID}.nge-cm-done .nge-cm-state{color:#59e3a7;text-shadow:0 0 8px rgba(89,227,167,.7)}
#${CARD_ID}.nge-cm-done .nge-cm-dot{background:#59e3a7;box-shadow:0 0 8px #59e3a7}
#${CARD_ID}.nge-cm-bad{border-color:rgba(255,107,138,.8);box-shadow:0 0 26px rgba(255,107,138,.3),inset 0 0 18px rgba(255,107,138,.12);transition:border-color .3s,box-shadow .3s}
#${CARD_ID}.nge-cm-bad .nge-cm-state{color:#ff8fa3;text-shadow:0 0 8px rgba(255,107,138,.7)}
#${CARD_ID}.nge-cm-bad .nge-cm-dot{background:#ff6b8a;box-shadow:0 0 8px #ff6b8a}
#${CARD_ID} .nge-cm-x{margin-left:4px;width:22px;height:22px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:2px;
  background:transparent;color:#8fb6dc;font:400 18px/1 Inter,sans-serif;cursor:pointer}
#${CARD_ID} .nge-cm-x:hover{color:#fff;border-color:rgba(127,200,255,.45);background:rgba(127,200,255,.12)}
#${CARD_ID} .nge-cm-x:focus-visible{outline:2px solid #7fd8ff;outline-offset:1px}
#${CARD_ID}.nge-cm-reviewing .nge-cm-x,#${CARD_ID}.nge-cm-reviewing .nge-cm-tool{display:none}
#${CARD_ID} .nge-cm-tool{width:22px;height:22px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:2px;
  background:transparent;color:#8fb6dc;cursor:pointer;font:600 12px/1 Inter,sans-serif;letter-spacing:0;text-transform:none}
#${CARD_ID} .nge-cm-tool:hover,#${CARD_ID} .nge-cm-i[aria-pressed="true"]{color:#fff;border-color:rgba(127,200,255,.45);background:rgba(127,200,255,.12)}
#${CARD_ID} .nge-cm-tool:focus-visible{outline:2px solid #7fd8ff;outline-offset:1px}
#${CARD_ID} .nge-cm-i{font:italic 700 14px/1 Georgia,serif}
#${CARD_ID} .nge-cm-min-btn svg{transition:transform .2s}
#${CARD_ID}.nge-cm-min .nge-cm-min-btn svg{transform:rotate(180deg)}
#${CARD_ID} .nge-cm-info{display:none;margin:2px 0 8px;padding:9px 10px;border:1px solid rgba(127,200,255,.25);background:rgba(127,200,255,.06);
  color:#cfe6ff;font-size:13px;line-height:1.45}
#${CARD_ID} .nge-cm-info p{margin:0 0 6px}
#${CARD_ID} .nge-cm-info p:last-child{margin:0}
#${CARD_ID} .nge-cm-info b{color:#7fd8ff;font-weight:600}
#${CARD_ID} .nge-cm-info-text br{display:block;content:"";margin-top:6px}
#${CARD_ID} .nge-cm-info-text p,#${CARD_ID} .nge-cm-mark-info-text p{margin:0 0 9px;line-height:1.45}
#${CARD_ID} .nge-cm-info-text p:last-child,#${CARD_ID} .nge-cm-mark-info-text p:last-child{margin-bottom:0}
#${CARD_ID} .nge-cm-info-text > p:first-child{color:#eef5ff;font-size:13.5px;padding-bottom:9px;border-bottom:1px solid rgba(127,200,255,.16)}
#${CARD_ID} .nge-edtext-termline{padding-left:9px;border-left:2px solid rgba(127,216,255,.45)}
#${CARD_ID} .nge-edtext-term{display:block;margin-bottom:2px;font:600 10.5px/1.3 Orbitron,Inter,sans-serif !important;letter-spacing:.12em;text-transform:uppercase;color:#7fd8ff}
#${CARD_ID} .nge-cm-mark-info-text b:not(.nge-edtext-term),#${CARD_ID} .nge-cm-info-text b:not(.nge-edtext-term){color:#bfeaff;font-weight:600}
#${CARD_ID} .nge-cm-info textarea{cursor:text}
#${CARD_ID}.nge-cm-showinfo .nge-cm-info{display:block}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-state,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-label,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-read,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-pieces,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-info{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-head{margin-bottom:2px}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-row{padding:2px 0;grid-template-columns:16px 1fr;align-items:center}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing){width:250px}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-pre{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-i{margin-left:auto}
#${CARD_ID} .nge-cm-short{display:none;font:600 11px/1 Orbitron,Inter,sans-serif;color:#8fb6dc}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-short{display:block}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-gauge{grid-column:2;margin:0}
#${CARD_ID}.nge-cm-idle .nge-cm-pieces{color:#8fb6dc}
#${CARD_ID} .nge-cm-loader{display:none}
#${CARD_ID}.nge-cm-loading .nge-cm-loader{display:flex;align-items:center;gap:14px;padding:6px 0 4px}
#${CARD_ID}.nge-cm-idle:not(.nge-cm-reviewing) .nge-cm-row{display:none !important}
#${CARD_ID}.nge-cm-loading .nge-cm-score,#${CARD_ID}.nge-cm-loading .nge-cm-row,#${CARD_ID}.nge-cm-loading .nge-cm-sub{display:none !important}
#${CARD_ID} .nge-cm-ld-scope{flex:0 0 84px;width:84px;height:98px;position:relative;overflow:hidden;border-radius:8px;background:radial-gradient(circle at 50% 42%,rgba(64,208,255,.14),transparent 70%)}
#${CARD_ID} .nge-cm-ld-glyph{position:absolute;inset:0}
#${CARD_ID} .nge-cm-ld-scan{position:absolute;left:4px;right:4px;top:0;height:2px;border-radius:1px;background:#bfefff;box-shadow:0 0 8px #7fd8ff;opacity:.8;animation:nge-cm-ld-scan 2.6s ease-in-out infinite}
@keyframes nge-cm-ld-spin{to{transform:rotate(360deg)}}
@keyframes nge-cm-ld-trace{0%{stroke-dashoffset:1;opacity:.2}45%{stroke-dashoffset:0;opacity:1}80%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:.15}}
@keyframes nge-cm-ld-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.25);opacity:1}}
@keyframes nge-cm-ld-scan{0%{transform:translateY(4px);opacity:0}10%{opacity:.85}90%{opacity:.85}100%{transform:translateY(94px);opacity:0}}
#${CARD_ID} .nge-cm-ld-text{flex:1 1 auto;min-width:0}
#${CARD_ID} .nge-cm-ld-title{font:600 12px/1.2 Orbitron,Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#bfeaff;margin-bottom:8px}
#${CARD_ID} .nge-cm-ld-steps{list-style:none;margin:0;padding:0;font:12.5px/1.3 Inter,system-ui,sans-serif}
#${CARD_ID} .nge-cm-ld-steps li{position:relative;padding:2px 0 2px 18px;color:rgba(169,195,224,.4);transition:color .3s ease}
#${CARD_ID} .nge-cm-ld-steps li::before{content:'';position:absolute;left:2px;top:7px;width:7px;height:7px;border-radius:50%;border:1px solid currentColor}
#${CARD_ID} .nge-cm-ld-steps li.now{color:#e6f4ff}
#${CARD_ID} .nge-cm-ld-steps li.now::before{border-color:#7fd8ff;background:#7fd8ff;box-shadow:0 0 8px #7fd8ff;animation:nge-cm-ld-pulse 1s ease-in-out infinite;transform-origin:center}
#${CARD_ID} .nge-cm-ld-steps li.now::after{content:'';display:inline-block;width:14px;margin-left:2px;animation:nge-cm-ld-dots 1.2s steps(4) infinite}
#${CARD_ID} .nge-cm-ld-steps li.done{color:#8fb6dc}
#${CARD_ID} .nge-cm-ld-steps li.done::before{content:'✓';border:0;top:2px;left:1px;width:auto;height:auto;color:#5fe3a1;font-size:11px;line-height:1.3}
@keyframes nge-cm-ld-dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
#${CARD_ID} .nge-cm-ld-bar{position:relative;height:3px;margin-top:9px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden}
#${CARD_ID} .nge-cm-ld-bar i{position:absolute;top:0;bottom:0;left:-40%;width:40%;background:linear-gradient(90deg,transparent,#7fd8ff,transparent);animation:nge-cm-ld-sweep 1.4s ease-in-out infinite}
@keyframes nge-cm-ld-sweep{to{left:100%}}
#${CARD_ID}.nge-cm-min.nge-cm-loading .nge-cm-ld-scope{flex-basis:48px;width:48px;height:56px}
#${CARD_ID}.nge-cm-min.nge-cm-loading .nge-cm-ld-steps li:not(.now){display:none}
@media (prefers-reduced-motion:reduce){#${CARD_ID} .nge-cm-loader *{animation:none !important}}
#${CARD_ID} .nge-cm-sub{margin:-2px 0 8px;color:#a9c3e0;font-size:13px;line-height:1.35}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-sub{display:none}
#${CARD_ID} .nge-cm-score{grid-template-columns:auto 1fr auto}
#${CARD_ID} .nge-cm-score .nge-cm-state{justify-self:end;align-self:end;font-size:12px;line-height:1.3}
#${CARD_ID} .nge-cm-head .nge-cm-i{margin-left:auto}
#${CARD_ID} .nge-cm-score .nge-cm-num{font-size:18px}
#${GUIDE_ID}{position:fixed;inset:0;z-index:9500;pointer-events:none}
#${GUIDE_ID} .nge-cm-guide-ring{position:fixed;border:2px solid #7fd8ff;border-radius:8px;box-shadow:0 0 0 4px rgba(127,216,255,.18),0 0 22px rgba(127,216,255,.6);
  animation:nge-cm-guide 1s ease-in-out infinite}
#${GUIDE_ID} .nge-cm-guide-label{position:fixed;padding:5px 10px;border:1px solid rgba(74,158,255,.6);border-radius:8px;background:rgba(6,12,26,.96);
  color:#eaf6ff;font:600 11px/1 Orbitron,Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;box-shadow:0 6px 18px rgba(0,0,0,.5)}
@keyframes nge-cm-guide{0%,100%{box-shadow:0 0 0 4px rgba(127,216,255,.18),0 0 22px rgba(127,216,255,.6)}50%{box-shadow:0 0 0 9px rgba(127,216,255,0),0 0 30px rgba(127,216,255,.85)}}
@media (prefers-reduced-motion:reduce){#${GUIDE_ID} .nge-cm-guide-ring{animation:none}}
#${CARD_ID} .nge-cm-progress{grid-column:1/-1;margin:-1px 0 4px;color:#a9c3e0;font-size:12.5px}
#${CARD_ID} .nge-cm-progress:empty{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-progress{display:none}
/* Checking (Ames 2026-11-13: "it needs a loading indicator"; 2026-11-14: slower, "moves too fast"): a light runs
   along the score bar and a small ring turns beside the word. */
#${CARD_ID}.nge-cm-checking .nge-cm-score .nge-cm-gauge::after{content:'';position:absolute;top:0;bottom:0;left:-40%;width:40%;
  background:linear-gradient(90deg,transparent,rgba(190,240,255,.45),transparent);animation:nge-cm-load 2.8s ease-in-out infinite}
@keyframes nge-cm-load{from{left:-40%}to{left:100%}}
#${CARD_ID}.nge-cm-checking .nge-cm-state::before{content:'';display:inline-block;width:9px;height:9px;margin-right:5px;vertical-align:-1px;
  border:1.5px solid rgba(127,216,255,.35);border-top-color:#7fd8ff;border-radius:50%;animation:nge-cm-spin 1.8s linear infinite}
@keyframes nge-cm-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#${CARD_ID}.nge-cm-checking .nge-cm-score .nge-cm-gauge::after{animation:none;left:30%}#${CARD_ID}.nge-cm-checking .nge-cm-state::before{animation:none}}
#${CARD_ID} .nge-cm-score .nge-cm-gauge{height:7px;margin:7px 0 6px}
/* The Playing box (Ames 2026-11-14). */
body.nge-cm-owns:not(.nge-cm-guiding) .nge-cl-panel--slim{display:none !important}
/* The cell icon leads the top line (Ames 2026-11-14: "put this cell icon on the left"). */
/* The icon on its own, no box around it (Ames 2026-11-19: "I don't think we need the green box around this"). */
#${CARD_ID} .nge-cm-cellbtn{order:-1;margin-right:2px;display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;box-shadow:none;color:#bfe6ff}
#${CARD_ID} .nge-cm-cellbtn:hover{background:rgba(127,190,255,.14);color:#fff}
#${CARD_ID} .nge-cm-cellbtn:focus-visible{outline:2px solid #7fd8ff;outline-offset:1px}
/* Hint, as a small H (Ames 2026-11-14: "a little H button ... if I hover says click for a Hint"). */
#${CARD_ID} .nge-cm-hbtn{border-color:rgba(127,216,255,.6) !important;background:rgba(74,158,255,.18) !important;color:#bfeaff !important}
#${CARD_ID} .nge-cm-hbtn.nge-cm-nudged{animation:nge-cm-hglow 2.6s ease-in-out infinite}
/* One soft glow after a good edit (report 564), then still. */
#${CARD_ID} .nge-cm-hbtn.nge-cm-glow1{animation:nge-cm-hglow 2s ease-in-out 1}
#${CARD_ID} .nge-cm-mark{margin-top:6px;font:12px/1.3 Inter,system-ui,sans-serif;color:#a9c3e0}
#${CARD_ID} .nge-cm-mark-head{display:flex;align-items:center;gap:6px}
#${CARD_ID} .nge-cm-mark-i{width:18px;height:18px;flex:0 0 18px;font-size:11px}
#${CARD_ID} .nge-cm-mark-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
#${CARD_ID} .nge-cm-mark-info{margin:6px 0 2px;padding:8px 10px;border:1px solid rgba(127,200,255,.25);border-radius:6px;background:rgba(127,200,255,.06);font-size:12.5px;line-height:1.45;color:#d6e2f5}
#${CARD_ID} .nge-cm-mark-info[hidden]{display:none}
#${CARD_ID} .nge-cm-mark-info br{display:block;content:"";margin-top:5px}
#${CARD_ID} .nge-cm-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid rgba(127,190,255,.35);border-radius:999px;background:rgba(10,24,48,.6);color:#e6f0ff;font:600 12px/1 Inter,system-ui,sans-serif;cursor:pointer}
#${CARD_ID} .nge-cm-chip:hover{border-color:#7fd8ff;background:rgba(74,158,255,.22)}
#${CARD_ID} .nge-cm-chip i{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
#${CARD_ID} .nge-cm-mode{position:absolute;top:0;left:0;right:0;height:4px;padding:0;margin:0;overflow:hidden;font-size:0;line-height:0;color:transparent;background:transparent;transition:background .2s ease}
#${CARD_ID}.nge-cm-idle .nge-cm-mode,#${CARD_ID}.nge-cm-reviewing .nge-cm-mode{display:none}
#${CARD_ID} .nge-cm-mode[data-mode="merge"]{background:linear-gradient(90deg,#3d9bff,#7fd0ff);box-shadow:0 0 10px rgba(61,155,255,.7)}
/* Cut mode is blue, as the cut bar at the bottom is (Ames 2026-11-19: "keep cut mode blue period"). */
#${CARD_ID} .nge-cm-mode[data-mode="cut"]{background:linear-gradient(90deg,#3d9bff,#7fd0ff);box-shadow:0 0 10px rgba(61,155,255,.7)}
#${CARD_ID} .nge-cm-mode[data-mode="highlight"]{background:linear-gradient(90deg,#2fe39a,#9dffd0);box-shadow:0 0 10px rgba(61,255,154,.55)}
#${CARD_ID}[data-mode="merge"]:not(.nge-cm-idle):not(.nge-cm-reviewing){border-color:rgba(61,155,255,.85)}
#${CARD_ID}[data-mode="cut"]:not(.nge-cm-idle):not(.nge-cm-reviewing){border-color:rgba(61,155,255,.85)}
#${CARD_ID}[data-mode="highlight"]:not(.nge-cm-idle):not(.nge-cm-reviewing){border-color:rgba(61,255,154,.6)}
#${CARD_ID} .nge-cm-cellnote{margin:-2px 0 8px;padding:7px 9px;border-left:3px solid #7fd8ff;border-radius:4px;background:rgba(127,216,255,.08);font:13px/1.35 Inter,system-ui,sans-serif;color:#d6e2f5}
#${CARD_ID} .nge-cm-cellnote[hidden],#${CARD_ID} .nge-cm-acc[hidden],#${CARD_ID} .nge-cm-finish-gate[hidden]{display:none}
#${CARD_ID} .nge-cm-cellnote{display:flex;flex-direction:column;align-items:flex-start;gap:7px}
#${CARD_ID} .nge-cm-cellnote .nge-cm-btn{margin:0;padding:6px 10px;border-radius:6px;border-color:#7fd8ff;background:rgba(74,158,255,.3);color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;text-transform:none;letter-spacing:0}
#${CARD_ID} .nge-cm-acc{margin-top:6px;font:12px/1.3 Inter,system-ui,sans-serif;color:#a9c3e0}
#${CARD_ID} .nge-cm-acc b{color:#e6f0ff}
#${CARD_ID} .nge-cm-finish-how{margin-left:auto;padding:2px 8px;border:1px solid rgba(127,216,255,.5);border-radius:999px;background:rgba(74,158,255,.14);color:#bfeaff;font:600 11.5px/1.3 Inter,system-ui,sans-serif;cursor:pointer;flex:0 0 auto}
#${CARD_ID} .nge-cm-finish-how[hidden],#${CARD_ID} .nge-cm-finish-tip[hidden]{display:none}
#${CARD_ID} .nge-cm-finish-tip{margin:2px 0 8px 23px;padding:8px 10px;border:1px solid rgba(127,216,255,.4);border-radius:6px;background:rgba(10,30,60,.85);font:12.5px/1.4 Inter,system-ui,sans-serif;color:#d6e2f5}
#${CARD_ID} .nge-cm-finish-tip p{margin:0 0 6px}
#${CARD_ID} .nge-cm-finish-tip .nge-cm-btn{margin:0;padding:6px 10px;border-radius:6px;font:600 12px/1 Inter,system-ui,sans-serif;text-transform:none;letter-spacing:0}
#${CARD_ID} .nge-cm-finish-gate{margin:8px 0 0;padding:8px 9px;border:1px solid rgba(255,210,77,.45);border-radius:6px;background:rgba(255,210,77,.08);font:13px/1.35 Inter,system-ui,sans-serif;color:#ffe9b0}
#${CARD_ID}.nge-cm-idle .nge-cm-mark,#${CARD_ID}.nge-cm-reviewing .nge-cm-mark,#${CARD_ID}.nge-cm-finishing .nge-cm-mark,#${CARD_ID}.nge-cm-asking .nge-cm-mark,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-mark{display:none}
#${CARD_ID}.nge-cm-idle .nge-cm-cellnote,#${CARD_ID}.nge-cm-reviewing .nge-cm-cellnote,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-cellnote{display:none}
#${CARD_ID}.nge-cm-idle .nge-cm-acc,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-acc{display:none}
#${CARD_ID} .nge-cm-hbtn[hidden]{display:none}
#${CARD_ID} .nge-cm-hbtn:hover{background:rgba(74,158,255,.4);color:#fff}
@keyframes nge-cm-hglow{50%{box-shadow:0 0 10px rgba(127,216,255,.55)}}
/* Jump searches like Find Path (Ames 2026-11-19: "can you use something like
   the find path loading indicator?"): its explorers run across the button
   while it looks, and the route lights when the spot is found. */
#${CARD_ID} .nge-cm-play .nge-cm-hbtn{position:relative}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn:hover:not(:disabled){background:rgba(74,158,255,.34) !important;border-color:#a8e4ff !important;color:#fff !important}
#${CARD_ID} .nge-cm-hbtn.nge-cm-searching:disabled{opacity:1;cursor:progress}
#${CARD_ID} .nge-cm-hbtn.nge-cm-searching .nge-cm-jlabel{visibility:hidden}
#${CARD_ID} .nge-cm-jloader{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none}
@media (prefers-reduced-motion:reduce){#${CARD_ID} .nge-cm-hbtn.nge-cm-nudged,#${CARD_ID} .nge-cm-hbtn.nge-cm-glow1{animation:none}}
#${CARD_ID}.nge-cm-idle .nge-cm-hbtn,#${CARD_ID}.nge-cm-reviewing .nge-cm-hbtn,#${CARD_ID}.nge-cm-finishing .nge-cm-hbtn,#${CARD_ID}.nge-cm-idle .nge-cm-bulb,#${CARD_ID}.nge-cm-reviewing .nge-cm-bulb,#${CARD_ID}.nge-cm-finishing .nge-cm-bulb{display:none}
#${CARD_ID} .nge-cm-cellimg{width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 0 3px rgba(79,207,255,.5))}
#${CARD_ID} .nge-cm-cellid{margin:-4px 0 8px;font:12px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#a9c3e0}
#${CARD_ID} .nge-cm-nudge{position:relative;overflow:hidden;display:flex;align-items:center;gap:9px;margin:2px 0 9px;padding:8px 9px;border:1px solid rgba(127,216,255,.55);border-radius:8px;background:rgba(127,216,255,.08);box-shadow:0 0 14px rgba(127,216,255,.16)}
#${CARD_ID} .nge-cm-nudge.nge-cm-finding::after{content:'';position:absolute;left:-40%;bottom:0;width:40%;height:2px;background:linear-gradient(90deg,transparent,#7fd8ff,transparent);animation:nge-cm-ld-sweep 1.2s ease-in-out infinite}
#${CARD_ID} .nge-cm-nudge.nge-cm-finding::before{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(127,216,255,.10) 50%,transparent 70%);background-size:220% 100%;animation:nge-cm-find-shine 1.6s linear infinite;pointer-events:none}
#${CARD_ID} .nge-cm-nudge.nge-cm-finding svg{animation:nge-cm-ld-pulse 1s ease-in-out infinite;transform-origin:center}
#${CARD_ID} .nge-cm-nudge.nge-cm-finding .nge-cm-nudge-text::after{content:'';display:inline-block;width:14px;animation:nge-cm-ld-dots 1.2s steps(4) infinite}
@keyframes nge-cm-find-shine{from{background-position:120% 0}to{background-position:-120% 0}}
@media (prefers-reduced-motion:reduce){#${CARD_ID} .nge-cm-nudge.nge-cm-finding::after,#${CARD_ID} .nge-cm-nudge.nge-cm-finding::before,#${CARD_ID} .nge-cm-nudge.nge-cm-finding svg{animation:none}}
#${CARD_ID} .nge-cm-nudge[hidden]{display:none}
/* Folded into a light bulb beside Jump (Ames 2026-11-19: "just a little light
   bulb we can click to open it as an icon to keep it small and sweet"). */
#${CARD_ID} .nge-cm-nudge:not(.nge-cm-nudge-open){display:none}
#${CARD_ID} .nge-cm-nudge-more{flex:0 0 22px;width:22px;height:22px;margin-left:-2px;align-self:flex-start;order:2}
/* Open: the words across the top, Show me under them on the right, below the fold caret (Ames 2026-11-19, 2026-11-20). */
#${CARD_ID} .nge-cm-nudge.nge-cm-nudge-open{flex-wrap:wrap;align-items:flex-start;row-gap:7px}
#${CARD_ID} .nge-cm-nudge.nge-cm-nudge-open .nge-cm-nudge-text{flex:1 1 0;min-width:0;order:1}
#${CARD_ID} .nge-cm-nudge-btns:not(:has(.nge-cm-hint-btn:not([hidden]))){display:none}
#${CARD_ID} .nge-cm-nudge-more svg{transform:rotate(180deg)}
#${CARD_ID} .nge-cm-jumprow{grid-area:jump;display:flex;gap:5px;min-width:0}
#${CARD_ID} .nge-cm-jumprow .nge-cm-hbtn{flex:1 1 auto;min-width:0}
#${CARD_ID} .nge-cm-bulb{flex:0 0 32px;display:grid;place-items:center;padding:0;border:1px solid rgba(127,216,255,.45);border-radius:6px;background:rgba(127,216,255,.08);cursor:pointer;transition:background-color .15s,border-color .15s,box-shadow .15s}
#${CARD_ID} .nge-cm-bulb[hidden]{display:none}
#${CARD_ID} .nge-cm-bulb:hover{background:rgba(127,216,255,.2);border-color:#a8e4ff}
#${CARD_ID} .nge-cm-bulb:focus-visible{outline:2px solid #7fd8ff;outline-offset:1px}
#${CARD_ID} .nge-cm-bulb[aria-expanded="true"]{background:rgba(127,216,255,.24);border-color:#7fd8ff;box-shadow:0 0 8px rgba(127,216,255,.45)}
#${CARD_ID} .nge-cm-nudge svg{flex:0 0 auto}
#${CARD_ID} .nge-cm-nudge-text{flex:1 1 auto;font-size:13px;line-height:1.35;color:#d6e2f5}
#${CARD_ID} .nge-cm-nudge .nge-cm-btn{margin-left:0;flex:0 0 auto;border-color:#7fd8ff;background:rgba(74,158,255,.3);color:#fff}
#${CARD_ID} .nge-cm-play{display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-areas:"jump jump jump" "done done done" "save skip mark";gap:5px;margin-top:6px;padding-top:7px;border-top:1px solid rgba(127,190,255,.18)}
#${CARD_ID} .nge-cm-play .nge-cm-btn{margin-left:0 !important;width:100%;justify-content:center;text-align:center}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn{grid-area:jump}
#${CARD_ID} .nge-cm-play .nge-cm-complete{grid-area:done}
#${CARD_ID} .nge-cm-play .nge-cm-saveview{grid-area:save}
#${CARD_ID} .nge-cm-play .nge-cm-skipcell{grid-area:skip}
#${CARD_ID} .nge-cm-play .nge-cm-marktoggle{grid-area:mark;display:inline-flex;align-items:center;gap:5px}
#${CARD_ID} .nge-cm-marktoggle svg{transition:transform .15s}
#${CARD_ID} .nge-cm-marktoggle[aria-expanded="true"] svg{transform:rotate(180deg)}
#${CARD_ID} .nge-cm-mark[hidden]{display:none !important}
#${CARD_ID} .nge-cm-play .nge-cm-saveview,#${CARD_ID} .nge-cm-play .nge-cm-skipcell,#${CARD_ID} .nge-cm-play .nge-cm-marktoggle{padding:4px 8px !important;border-color:rgba(127,190,255,.22);background:transparent;color:#a9c3e0;font-size:12px !important;font-weight:500 !important}
#${CARD_ID} .nge-cm-play .nge-cm-saveview:hover,#${CARD_ID} .nge-cm-play .nge-cm-skipcell:hover,#${CARD_ID} .nge-cm-play .nge-cm-marktoggle:hover,#${CARD_ID} .nge-cm-play .nge-cm-marktoggle[aria-expanded="true"]{border-color:rgba(127,216,255,.55);background:rgba(74,158,255,.12);color:#e6f0ff}
#${CARD_ID} .nge-cm-btn[hidden]{display:none}
#${CARD_ID} .nge-cm-play .nge-cm-btn,#${CARD_ID} .nge-cm-finish-actions .nge-cm-btn,#${CARD_ID} .nge-cm-nudge .nge-cm-btn{padding:7px 10px;border-radius:6px;font:600 12.5px/1 Inter,system-ui,sans-serif;letter-spacing:0;text-transform:none;white-space:nowrap}
#${CARD_ID} .nge-cm-play .nge-cm-complete,#${CARD_ID} .nge-cm-finish-go{margin-left:auto;border-color:#3eecbe;background:rgba(20,110,80,.55);color:#eafff7}
#${CARD_ID} .nge-cm-play .nge-cm-complete:hover,#${CARD_ID} .nge-cm-finish-go:hover:not(:disabled){background:rgba(24,140,100,.7)}
#${CARD_ID} .nge-cm-btn:disabled{opacity:.5;cursor:default}
/* Circuit edges (Ames 2026-11-20: traces in the face were "too hard to read";
   "draw inspiration from the circuit in the rocket ship border and the borders
   of the layers"). The face is clean, tinted like the hint box. The circuit is
   the edge: a rim with cut corners, short traces that step in at 45 degrees
   and end on pads, and a ring pad at the middle of each side, where Jump's
   lightning starts and ends. Drawn to size by frameButton(). */
#${CARD_ID} .nge-cm-play .nge-cm-hbtn,#${CARD_ID} .nge-cm-play .nge-cm-complete{--cc:127,216,255;position:relative;isolation:isolate;overflow:visible;border:0 !important;border-radius:0 !important;background:none !important;box-shadow:none !important;
  color:#eef8ff !important;font:600 13px/1 Inter,system-ui,sans-serif !important;padding:9px 12px !important;text-shadow:none}
#${CARD_ID} .nge-cm-play .nge-cm-complete{--cc:62,236,190;color:#eafff6 !important}
#${CARD_ID} .nge-cm-frame{position:absolute;inset:0;z-index:-1;pointer-events:none}
#${CARD_ID} .nge-cm-frame svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#${CARD_ID} .nge-cm-frame .rim{fill:rgba(var(--cc),.1);stroke:rgba(var(--cc),.72);stroke-width:1;transition:fill .15s,stroke .15s}
#${CARD_ID} .nge-cm-play .nge-cm-complete .nge-cm-frame .rim{fill:rgba(32,150,110,.28)}
#${CARD_ID} .nge-cm-frame .tr{fill:none;stroke:rgba(var(--cc),.6);stroke-width:1;stroke-linejoin:round;stroke-linecap:round}
#${CARD_ID} .nge-cm-frame .pad{fill:rgb(var(--cc))}
#${CARD_ID} .nge-cm-frame .via{fill:#0a1322;stroke:rgba(var(--cc),.85);stroke-width:1}
#${CARD_ID} .nge-cm-frame .pin{fill:rgba(var(--cc),.7)}
#${CARD_ID} .nge-cm-frame .side{fill:#0a1322;stroke:rgb(var(--cc));stroke-width:1.4;filter:drop-shadow(0 0 3px rgba(var(--cc),.8))}
#${CARD_ID} .nge-cm-frame .side-in{fill:rgb(var(--cc))}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn:hover:not(:disabled) .rim{fill:rgba(var(--cc),.2);stroke:rgb(var(--cc))}
#${CARD_ID} .nge-cm-play .nge-cm-complete:hover:not(:disabled) .rim{fill:rgba(36,170,124,.42);stroke:rgb(var(--cc))}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn:hover:not(:disabled),#${CARD_ID} .nge-cm-play .nge-cm-complete:hover:not(:disabled){filter:drop-shadow(0 0 6px rgba(var(--cc),.35))}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn:focus-visible,#${CARD_ID} .nge-cm-play .nge-cm-complete:focus-visible{outline:none}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn:focus-visible .rim,#${CARD_ID} .nge-cm-play .nge-cm-complete:focus-visible .rim{stroke:#fff}
#${CARD_ID} .nge-cm-jlabel{position:relative;z-index:1}
#${CARD_ID} .nge-cm-jloader{z-index:2}
#${CARD_ID} .nge-cm-play .nge-cm-hbtn .nge-cm-jloader{left:-6px;transform:translateY(-50%)}
/* The bulb is Jump's key, as the play mark is Play's (Ames 2026-11-20: "fit in
   almost like how the play button has that slash line"): Jump ends in a slash,
   the key follows it, and Jump's right pad sits on the slash. */
#${CARD_ID} .nge-cm-jumprow{gap:0;align-items:stretch}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-hbtn{z-index:1;padding-right:18px !important}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb{position:relative;overflow:hidden;flex:0 0 42px;margin-left:-7px;padding:0 0 0 6px;border:0;border-radius:0 4px 4px 0;
  clip-path:polygon(10px 0,100% 0,100% 100%,0 100%);background:linear-gradient(135deg,#e2f6ff 0%,#7fd8ff 45%,#3b86d8 100%);transition:filter .2s}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb svg{stroke:#06213a;position:relative;z-index:1}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:40%;pointer-events:none;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.85),rgba(255,255,255,0));transform:skewX(-20deg)}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb:hover{background:linear-gradient(135deg,#e2f6ff 0%,#7fd8ff 45%,#3b86d8 100%);filter:brightness(1.1)}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb:hover::after,#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb:focus-visible::after{animation:nge-cm-keyshine .6s ease-out}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb:active{filter:brightness(1.35)}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb[aria-expanded="true"]{box-shadow:none;background:linear-gradient(135deg,#fff8d6 0%,#ffe27a 45%,#d9a520 100%)}
#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb[aria-expanded="true"] svg{stroke:#2a1d00}
@keyframes nge-cm-keyshine{to{left:120%}}
@media (prefers-reduced-motion:reduce){#${CARD_ID} .nge-cm-jumprow:has(.nge-cm-bulb:not([hidden])) .nge-cm-bulb::after{animation:none !important}}
#${CARD_ID}.nge-cm-idle .nge-cm-play,#${CARD_ID}.nge-cm-idle .nge-cm-cellid,#${CARD_ID}.nge-cm-idle .nge-cm-nudge,#${CARD_ID}.nge-cm-reviewing .nge-cm-play,#${CARD_ID}.nge-cm-reviewing .nge-cm-nudge,#${CARD_ID}.nge-cm-reviewing .nge-cm-cellid{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-saveview,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-skipcell,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-marktoggle,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-cellid{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing){height:auto !important;resize:horizontal}
#${CARD_ID} .nge-cm-nudge-btns{display:flex;gap:5px;order:3;flex:1 0 100%;justify-content:flex-end;padding-left:0}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-play{margin-top:6px;padding-top:7px}
#${CARD_ID}.nge-cm-finishing .nge-cm-play,#${CARD_ID}.nge-cm-finishing .nge-cm-nudge,#${CARD_ID}.nge-cm-finishing .nge-cm-row[data-row="merge"],#${CARD_ID}.nge-cm-finishing .nge-cm-row[data-row="cut"]{display:none}
#${CARD_ID} .nge-cm-viewnote{margin-top:6px;font-size:11.5px;line-height:1.4;color:#8fa6c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${CARD_ID} .nge-cm-viewnote:empty{display:none}
#${CARD_ID}.nge-cm-idle .nge-cm-viewnote,#${CARD_ID}.nge-cm-reviewing .nge-cm-viewnote,#${CARD_ID}.nge-cm-finishing .nge-cm-viewnote,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-viewnote{display:none}
#${CARD_ID} .nge-cm-skipask{margin-top:8px;padding:10px;border:1px solid rgba(255,138,158,.5);border-radius:8px;background:rgba(255,107,138,.08)}
#${CARD_ID} .nge-cm-skipask[hidden]{display:none}
#${CARD_ID} .nge-cm-skipask-words{margin:0 0 4px;font-size:13px;line-height:1.45;color:#e6edf7}
#${CARD_ID} .nge-cm-skipask .nge-cm-finish-actions{border-top:none;padding-top:4px}
#${CARD_ID} .nge-cm-skipask-label{display:block;margin:8px 0 4px;font:600 12px/1.3 Inter,system-ui,sans-serif;color:#d6e2f5}
#${CARD_ID} .nge-cm-skipask-label span{font-weight:400;color:#8fa6c4;margin-left:4px}
#${CARD_ID} .nge-cm-skipask-note{display:block;box-sizing:border-box;width:100%;min-height:44px;margin:0 0 8px;padding:6px 8px;border:1px solid rgba(127,190,255,.3);border-radius:6px;background:rgba(4,10,22,.7);color:#e6f0ff;font:12.5px/1.4 Inter,system-ui,sans-serif;resize:vertical}
#${CARD_ID} .nge-cm-skipask-note:focus{outline:none;border-color:#7fd8ff;box-shadow:0 0 0 2px rgba(127,216,255,.18)}
#${CARD_ID} .nge-cm-skipask-yes{margin-left:auto !important;border-color:#ff8a9e !important;background:rgba(255,107,138,.22) !important;color:#fff !important}
#${CARD_ID}.nge-cm-asking .nge-cm-play,#${CARD_ID}.nge-cm-asking .nge-cm-viewnote{display:none}
#${CARD_ID} .nge-cm-finish{display:flex;flex-direction:column;gap:8px;margin-top:6px;padding-top:9px;border-top:1px solid rgba(127,190,255,.18)}
#${CARD_ID} .nge-cm-finish[hidden]{display:none}
#${CARD_ID} .nge-cm-finish-title{font:600 12px/1 Orbitron,Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#d6e2f5}
#${CARD_ID} .nge-cm-finish-line{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.35}
#${CARD_ID} .nge-cm-finish-mark{flex:0 0 15px;height:15px;margin-top:1px}
#${CARD_ID} .nge-cm-finish-line.nge-cm-wait .nge-cm-finish-mark{border:1.5px solid rgba(127,216,255,.35);border-top-color:#7fd8ff;border-radius:50%;box-sizing:border-box;animation:nge-cm-spin 1.8s linear infinite}
#${CARD_ID} .nge-cm-finish-addnote{align-self:flex-start;padding:0;border:none;background:none;color:#7fd8ff;font:500 12.5px/1.4 Inter,system-ui,sans-serif;cursor:pointer}
#${CARD_ID} .nge-cm-finish-note{width:100%;box-sizing:border-box;resize:vertical;padding:6px 8px;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:rgba(0,0,0,.35);color:#e6edf7;font:12.5px/1.45 Inter,system-ui,sans-serif}
#${CARD_ID} .nge-cm-finish-left{margin:0;font-size:12.5px;line-height:1.45;color:#a9c3e0}
#${CARD_ID} .nge-cm-finish-left[hidden]{display:none}
#${CARD_ID} .nge-cm-finish-left-count{margin:0 0 3px}
#${CARD_ID} .nge-cm-left-red{color:#ff6b8a;font-weight:600}
#${CARD_ID} .nge-cm-finish-actions{display:flex;gap:6px;align-items:center;padding-top:8px;border-top:1px solid rgba(127,190,255,.18)}
#${CARD_ID} .nge-cm-finish-actions .nge-cm-btn{margin-left:0}
#${CARD_ID} .nge-cm-finish-actions .nge-cm-finish-go{margin-left:auto}
#${CARD_ID} .nge-cm-row[data-row="merge"]{margin-top:2px;border-top:1px solid rgba(127,190,255,.18);padding-top:7px}
#${CARD_ID} .nge-cm-row[data-row="merge"],#${CARD_ID} .nge-cm-row[data-row="cut"]{grid-template-columns:74px 1fr auto;align-items:center}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-gauge,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-gauge{grid-column:1/-1;grid-row:2;height:4px;margin:3px 0 5px}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-fill,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-fill{box-shadow:none;opacity:.85}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-label,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-label{font-size:10.5px;letter-spacing:.12em;grid-column:1;grid-row:1}
/* Merge and Cut as plain labels, like MATCH SCORE (Ames 2026-11-19: the
   pills "don't match our UI"). A label is the M or C button; when its mode
   is on it lights blue, Cut too (Ames: "keep cut mode blue period"). */
#${CARD_ID} .nge-cm-modebtn{justify-self:start;align-self:center;margin:0 0 0 -6px;padding:4px 6px 3px;border:1px solid transparent;border-radius:5px;line-height:1;cursor:pointer;background:transparent;color:#8fb6dc;transition:background .15s ease,box-shadow .15s ease,color .15s ease,border-color .15s ease}
#${CARD_ID} .nge-cm-modebtn:hover{color:#e6f0ff;background:rgba(61,155,255,.12);border-color:rgba(127,190,255,.3)}
#${CARD_ID} .nge-cm-modebtn[aria-pressed="true"]{color:#fff;background:rgba(61,155,255,.32);border-color:rgba(127,208,255,.85);box-shadow:0 0 9px rgba(61,155,255,.55)}
#${CARD_ID} .nge-cm-row:has(.nge-cm-modebtn[aria-pressed="true"]) .nge-cm-pieces{color:#e6f0ff}
#${CARD_ID} .nge-cm-modebtn:focus-visible{outline:2px solid #7fd8ff;outline-offset:2px}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-pieces,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-pieces{grid-column:2;grid-row:1;font-size:13px}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-read,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-read{grid-column:3;grid-row:1}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-num,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-num{font-size:13px;color:#a9c3e0}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-row[data-row="merge"],#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-row[data-row="cut"]{display:none}
#${CARD_ID}:not(.nge-cm-idle):not(.nge-cm-reviewing) .nge-cm-pre{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-score{grid-template-columns:1fr auto;column-gap:10px}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-score .nge-cm-gauge{grid-column:1;grid-row:1;margin:0;align-self:center}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-score .nge-cm-read{display:flex;grid-column:2;grid-row:1}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-score .nge-cm-num{font-size:14px}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-idle-go{display:none}
#${CHIP_ID}{position:fixed;top:64px;left:12px;z-index:59;display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;
  border:1px solid rgba(110,190,255,.4);border-radius:3px;background:linear-gradient(180deg,rgba(7,18,36,.9),rgba(3,9,20,.94));
  box-shadow:0 0 16px rgba(60,150,255,.18);color:#7fc8ff;font:600 12px/1 Orbitron,Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase}
#${CHIP_ID}:hover{color:#fff;border-color:#7fd8ff}
#${CHIP_ID}:focus-visible{outline:2px solid #7fd8ff;outline-offset:2px}
#${CHIP_ID} .nge-cm-dot{width:8px;height:8px;border-radius:50%;background:#59e3a7;box-shadow:0 0 6px #59e3a7}
#${CHIP_ID} .nge-cm-chipnum{color:#eaf6ff;letter-spacing:.06em}
.nge-cm-tip{position:fixed;z-index:9000;width:230px;padding:12px 14px;box-sizing:border-box;
  background:linear-gradient(135deg,rgba(4,6,14,.97),rgba(10,16,32,.96));border:1px solid rgba(74,158,255,.55);border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.55),0 0 22px rgba(74,158,255,.18);color:#dfe8f6;font:13px/1.5 Inter,'Segoe UI',sans-serif;
  animation:nge-cm-tip-in .28s cubic-bezier(.16,1,.3,1) both}
.nge-cm-tip::before{content:'';position:absolute;top:-7px;left:22px;width:12px;height:12px;background:rgba(8,12,26,.97);
  border-left:1px solid rgba(74,158,255,.55);border-top:1px solid rgba(74,158,255,.55);transform:rotate(45deg)}
.nge-cm-tip .nge-cm-tip-kicker{font:600 10px/1 Orbitron,Inter,sans-serif;letter-spacing:.14em;color:#6fb2ff;margin-bottom:6px}
.nge-cm-tip .nge-cm-tip-ok{margin-top:10px;padding:4px 14px;border-radius:12px;border:1px solid rgba(74,158,255,.5);background:rgba(74,158,255,.16);
  color:#eaf2ff;font:600 11px Orbitron,Inter,sans-serif;letter-spacing:.06em;cursor:pointer}
.nge-cm-tip .nge-cm-tip-ok:hover{background:rgba(74,158,255,.28)}
.nge-cm-tip .nge-cm-tip-ok:focus-visible{outline:2px solid #7fd8ff;outline-offset:2px}
@keyframes nge-cm-tip-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
#${CHIP_ID}.nge-cm-tip-target{animation:nge-cm-tip-pulse 1.6s ease-in-out infinite}
@keyframes nge-cm-tip-pulse{0%,100%{box-shadow:0 0 0 0 rgba(74,158,255,.7)}50%{box-shadow:0 0 0 8px rgba(74,158,255,0)}}
@media (prefers-reduced-motion:reduce){.nge-cm-tip,#${CHIP_ID}.nge-cm-tip-target{animation:none}}
.nge-cm-tip .nge-cm-tip-row{display:flex;gap:8px;flex-wrap:wrap}
.nge-cm-tip b{color:#7ee0ff;font-weight:600}
#${CARD_ID} .nge-cm-delta{font:600 12px/1 Inter,system-ui,sans-serif;opacity:0;transition:opacity .8s}
#${CARD_ID} .nge-cm-gauge{grid-column:1/-1;position:relative;height:6px;margin:6px 0 5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
#${CARD_ID} .nge-cm-fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:3px;background:linear-gradient(90deg,#4a9eff,#7ee0ff);box-shadow:0 0 10px rgba(126,224,255,.45);transition:width .6s cubic-bezier(.34,1.56,.64,1)}
#${CARD_ID} .nge-cm-pieces{grid-column:1/-1;color:#a9c3e0;font-size:13.5px}
#${CARD_ID} .nge-cm-sep{height:1px;margin:6px 0;background:linear-gradient(90deg,transparent,rgba(127,190,255,.35),transparent)}
#${CARD_ID} .nge-cm-line{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px}
#${CARD_ID} .nge-cm-swatch{width:11px;height:11px;flex:none;border-radius:1px}
#${CARD_ID} .nge-cm-line b{font:600 12px/1 Orbitron,Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase}
#${CARD_ID} .nge-cm-btn{margin-left:auto;padding:6px 10px;border:1px solid rgba(127,200,255,.45);border-radius:2px;background:rgba(127,200,255,.08);
  color:#cfe6ff;font:600 11px/1 Orbitron,Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
#${CARD_ID} .nge-cm-btn:hover{background:rgba(127,200,255,.18)}
#${CARD_ID} .nge-cm-btn:focus-visible{outline:2px solid #7fd8ff;outline-offset:1px}
#${CARD_ID} .nge-cm-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
#${CARD_ID} .nge-cm-save{margin-right:auto}
#${CARD_ID} .nge-cm-go{margin-left:0;padding:8px 14px;border-color:#7fd8ff;background:rgba(127,216,255,.16);color:#fff;box-shadow:0 0 10px rgba(127,216,255,.25)}
/* Standby (Ames 2026-11-20): a live dot by the line, and the button in
   Play's shape with a circuit face. */
#${CARD_ID}.nge-cm-idle .nge-cm-sub{display:flex;align-items:center;gap:8px;color:#cfe6ff}
#${CARD_ID}.nge-cm-idle .nge-cm-sub::before{content:'';flex:none;width:7px;height:7px;border-radius:50%;background:#7fd8ff;box-shadow:0 0 8px #7fd8ff;animation:nge-cm-standby-dot 1.8s ease-in-out infinite}
@keyframes nge-cm-standby-dot{50%{opacity:.35;box-shadow:0 0 2px #7fd8ff}}
#${CARD_ID} .nge-cm-actions:has(.nge-cm-idle-go){justify-content:stretch;margin-top:10px;padding:0 5px 2px 0}
#${CARD_ID} .nge-cm-idle-go{--cut:6px;position:relative;flex:1 1 auto;display:flex;align-items:stretch;height:38px;margin:0;padding:0;border:0;border-radius:0;background:none !important;box-shadow:none;color:#e8f7ff;
  filter:drop-shadow(0 0 7px rgba(127,216,255,.32));transition:filter .2s,transform .12s}
#${CARD_ID} .nge-cm-idle-go:hover{filter:drop-shadow(0 0 11px rgba(127,216,255,.55))}
#${CARD_ID} .nge-cm-idle-go:active{transform:translateY(1px)}
#${CARD_ID} .nge-cm-tkey{position:relative;z-index:1;display:grid;place-items:center;flex:0 0 46px;overflow:hidden;color:#06213a;
  clip-path:polygon(var(--cut) 0,100% 0,calc(100% - 10px) 100%,0 100%,0 var(--cut));background:linear-gradient(135deg,#e2f6ff 0%,#7fd8ff 45%,#3b86d8 100%)}
#${CARD_ID} .nge-cm-tkey svg{position:relative;z-index:1;transition:transform .2s}
#${CARD_ID} .nge-cm-tkey::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:40%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.85),rgba(255,255,255,0));transform:skewX(-20deg)}
#${CARD_ID} .nge-cm-idle-go:hover .nge-cm-tkey::after,#${CARD_ID} .nge-cm-idle-go:focus-visible .nge-cm-tkey::after{animation:nge-cm-keyshine .6s ease-out}
#${CARD_ID} .nge-cm-idle-go:hover .nge-cm-tkey svg{transform:scale(1.15) rotate(-6deg)}
#${CARD_ID} .nge-cm-tlabel{position:relative;flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-width:0;margin-left:-7px;padding:0 16px 0 18px;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,0 100%);
  background:linear-gradient(180deg,rgba(127,216,255,.16),rgba(127,216,255,.07)),rgba(6,14,28,.92)}
#${CARD_ID} .nge-cm-tlabel::before{content:'';position:absolute;inset:0;padding:1px;clip-path:inherit;pointer-events:none;
  background:linear-gradient(90deg,rgba(127,216,255,.95),rgba(127,216,255,.35));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
#${CARD_ID} .nge-cm-tword{position:relative;z-index:1;font:600 13.5px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;color:#f2faff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* A pad on the slash and one at the far end; the lightning runs between them. */
#${CARD_ID} .nge-cm-idle-go::before,#${CARD_ID} .nge-cm-idle-go::after{content:'';position:absolute;top:50%;z-index:2;box-sizing:border-box;width:9px;height:9px;margin-top:-4.5px;border:1.5px solid #7fd8ff;border-radius:50%;
  background:radial-gradient(circle,#7fd8ff 0 1.4px,#0a1322 1.9px);box-shadow:0 0 6px rgba(127,216,255,.75);pointer-events:none}
#${CARD_ID} .nge-cm-idle-go::before{left:37px}
#${CARD_ID} .nge-cm-idle-go::after{right:-4.5px}
#${CARD_ID} .nge-cm-tloader{position:absolute;left:-3.5px;top:50%;transform:translateY(-50%);z-index:2;pointer-events:none}
#${CARD_ID} .nge-cm-idle-go.nge-cm-teleporting{cursor:progress}
#${CARD_ID} .nge-cm-idle-go.nge-cm-teleporting .nge-cm-tword{visibility:hidden}
#${CARD_ID} .nge-cm-idle-go.nge-cm-teleporting .nge-cm-tkey{animation:nge-cm-tkey-pulse .8s ease-in-out infinite}
@keyframes nge-cm-tkey-pulse{50%{filter:brightness(1.3)}}
@media (prefers-reduced-motion:reduce){#${CARD_ID}.nge-cm-idle .nge-cm-sub::before,#${CARD_ID} .nge-cm-tkey::after,#${CARD_ID} .nge-cm-idle-go.nge-cm-teleporting .nge-cm-tkey{animation:none !important}}
#${CARD_ID} .nge-cm-quiet{margin-left:0;border-color:rgba(127,200,255,.25);background:transparent;color:#8fb6dc}
#${CARD_ID} .nge-cm-clean{color:#59e3a7;font:600 12px/1.4 Orbitron,Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:2px 0}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

const rowHtml = (row: Row) => `<div class="nge-cm-row" data-row="${row}">`
  + `<span class="nge-cm-short" aria-hidden="true">${ROW_SHORT[row]}</span><button type="button" class="nge-cm-label nge-cm-modebtn" data-tool="${row}" aria-pressed="false" title="${ROW_SHORT[row]}">${ROW_LABEL[row]}</button>`
  + '<span class="nge-cm-read"><span class="nge-cm-delta"></span><span class="nge-cm-num"></span></span>'
  + '<div class="nge-cm-gauge"><i class="nge-cm-fill"></i></div>'
  + '<span class="nge-cm-pieces"></span></div>';

const scoreHtml = '<div class="nge-cm-row nge-cm-score" data-row="score">'
  + '<span class="nge-cm-label">Match score</span><span class="nge-cm-state"></span>'
  + '<span class="nge-cm-read"><span class="nge-cm-delta"></span><span class="nge-cm-num"></span></span>'
  + '<div class="nge-cm-gauge"><i class="nge-cm-fill"></i></div>'
  + '<span class="nge-cm-progress"></span></div>';

/** Under the score: where the cell started and the edits made (Ames
 *  2026-11-13: "why is my score 95%, how much have I done? count my edits"). */
export function progressLine(r: MatchResult): string {
  const parts: string[] = [];
  if (r.edits != null) parts.push(plural(r.edits, 'edit'));
  return parts.join(', ');
}

// The i text (Ames 2026-11-13: say what the Sandbox is, that real cells have
// no known answer, and where research datasets are asked for). Admins change
// it in the game (Ames 2026-11-14: "add Edit button for admin"): a site text,
// so the server sends Ames her before and after note (functions/edit-notify.js).
const INFO_KEY = 'sandbox.match_info';
const INFO_LINES = [
  'You are in the <b>Training Sim</b>, on the Sandbox, a dataset used only for learning. Play gives you a cell that has already been proofread, so you can practice and get instant feedback.',
  '<b>Match score</b>: your Merge and Cut together, half each. It starts at 0% and reads 100% when your cell matches the true cell. Merging alone gets you halfway: cut off the wrong parts to go higher.',
  '<b>Merge</b>: the missing pieces you have merged back in.',
  '<b>Cut</b>: the wrong parts you have cut off.',
  'Every missing piece adds to Merge, even a tiny one, but the branches add the most: go for those first. Wrong parts count at any size, since a merged axon can be thin. <b>Jump</b> takes you to the next spot that needs fixing.',
  'In real cells there is no known answer. That is up to you and the brain.',
  'When you feel comfortable editing here, ask for a dataset used for research: <b>Ask for Edit Access</b> in the 🍔 menu, top right.',
];
// One line each, a <br> between: the same look saved or not, and one line per
// paragraph when an admin edits it.
const INFO_HTML = INFO_LINES.join('<br>' + String.fromCharCode(10));
let infoApp: VueApp | null = null;
const editApps = new Map<HTMLElement, VueApp>();
/** An admin editable text in a host (the same as the i text). */
function mountEditable(host: HTMLElement, textKey: string, original: string, textClass: string, label: string) {
  const had = editApps.get(host);
  if (had) { try { had.unmount(); } catch (e) { /* gone */ } editApps.delete(host); }
  const pinia = getActivePinia();
  if (!pinia) { host.innerHTML = `<div class="${textClass}">${original}</div>`; return; }
  const app = createApp(EditableText, { textKey, original, textClass, label, terms: true });
  app.use(pinia);
  app.mount(host);
  editApps.set(host, app);
}
function mountInfo(host: HTMLElement) {
  if (infoApp) { try { infoApp.unmount(); } catch (e) { /* gone */ } infoApp = null; }
  const pinia = getActivePinia();
  if (!pinia) { host.innerHTML = '<div class="nge-cm-info-text">' + INFO_HTML + '</div>'; return; }
  infoApp = createApp(EditableText, { textKey: INFO_KEY, original: INFO_HTML, textClass: 'nge-cm-info-text', label: 'Sandbox Match card, the i text', terms: true });
  infoApp.use(pinia);
  infoApp.mount(host);
}

// ── The Playing box (Ames 2026-11-14) ───────────────────────────────────────
// "Combine these boxes, especially for newer players": on the Sandbox this box
// holds the cell (its ID, a cell icon that opens the Cell Library), Save view,
// Skip and Complete, and the Cell Library's slim row steps aside. The actions
// run in the Cell Library itself (CellLibraryPanel, nge:cm-cell-action), so
// they work exactly as its own buttons do. After a minute with no edit, Hint
// takes the player to the next piece to fix. The lab sees when (play events).
const BULB_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7fd8ff" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>';
const NUDGE_HTML = '<div class="nge-cm-nudge" hidden>' + BULB_SVG
  + '<span class="nge-cm-nudge-text"></span>'
  + '<span class="nge-cm-nudge-btns"><button type="button" class="nge-cm-btn nge-cm-hint-btn" hidden>Show me</button>'
  + '</span><button type="button" class="nge-cm-tool nge-cm-nudge-more" aria-expanded="false" aria-label="Show the whole hint" title="Show the whole hint">'
  + '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button></div>';
const HINT_OPEN_KEY = 'nge_sandbox_hint_open';
// Highlight from the box (Ames 2026-11-14: "a button that opens highlight
// mode ... with checked and come back pre-filled"; "we can't add highlight
// points while you are in merge or cut mode"). A chip leaves Merge or Cut and
// opens Highlight on that color; the pill says what a Ctrl+click does now.
// Ames 2026-11-16: the chips on their own line, and an (i) for Highlight.
const MARK_HTML = '<div class="nge-cm-mark" hidden>'
  + '<div class="nge-cm-mark-head"><span class="nge-cm-mark-label">Mark where you have been</span>'
  + '<button type="button" class="nge-cm-tool nge-cm-mark-i" aria-label="What is Highlight?" aria-expanded="false" title="What is Highlight?">i</button></div>'
  + '<div class="nge-cm-mark-info" hidden></div>'
  + '<div class="nge-cm-mark-chips">'
  + '<button type="button" class="nge-cm-chip" data-mark="checked" title="Highlight a branch you have checked, out to its end"><i></i>Checked</button>'
  + '<button type="button" class="nge-cm-chip" data-mark="comeback" title="One click marks a spot to come back to"><i></i>Come back</button></div></div>';
const MARK_INFO_KEY = 'sandbox.highlight_info';
const MARK_OPEN_KEY = 'nge_sandbox_highlight_open';
const MARK_INFO_HTML = 'Highlight paints over your cell so you can see where you have been.<br>'
  + '<b>Checked</b>: Ctrl+click two points on a branch and the stretch between them is marked. Mark each branch out to its end once you have looked at it.<br>'
  + '<b>Come back</b>: one click marks a spot you want to look at again.<br>'
  + 'With Merge or Cut on, hold H and click to highlight. Your marks are saved with your view.';
const LEFT_KEY = 'sandbox.finish_left';
const LEFT_HTML = 'Press Complete and Review to see the answers. In a production dataset, you should never complete a cell before it is completely proofread.';
const PLAY_HTML = '<div class="nge-cm-play">'
  + '<button type="button" class="nge-cm-btn nge-cm-saveview" title="Save your current view (annotations, layers, camera) to this cell">Save</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-skipcell" title="Not this one: it goes back for someone else, and Pyr takes you to your next cell">Skip Cell</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-marktoggle" aria-expanded="false" title="Mark where you have been">Highlight<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>'
  + '<div class="nge-cm-jumprow"><button type="button" class="nge-cm-btn nge-cm-hbtn" title="Go to the next spot on your cell that needs fixing"><span class="nge-cm-jlabel">Jump to next spot</span></button>'
  + '<button type="button" class="nge-cm-bulb" hidden aria-expanded="false" aria-label="Show the hint" title="Show the hint">' + BULB_SVG + '</button></div>'
  + '<button type="button" class="nge-cm-btn nge-cm-complete">Complete and Review</button></div>'
  + '<div class="nge-cm-viewnote"></div>'
  + MARK_HTML
  + '<div class="nge-cm-acc" hidden></div>'
  + '<div class="nge-cm-skipask" hidden role="alertdialog" aria-label="Skip this cell?">'
  + '<p class="nge-cm-skipask-words"><b>Skip this cell?</b> It goes back for someone else, and your edits on it no longer count for you. Pyr takes you to a new cell.</p>'
  + '<label class="nge-cm-skipask-label" for="nge-cm-skipask-note">Why are you skipping? <span>Optional. The Pyr team reads these.</span></label>'
  + '<textarea id="nge-cm-skipask-note" class="nge-cm-skipask-note" rows="2" maxlength="1000" placeholder="For example: the cell leaves the volume, or it looks like two cells"></textarea>'
  + '<div class="nge-cm-finish-actions"><button type="button" class="nge-cm-btn nge-cm-skipask-no">Keep working</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-skipask-yes">Skip this cell</button></div></div>';
const OK_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="#5fe3a1" stroke-width="1.4"/><path d="M4.8 8.2 7 10.3l4.2-4.5" fill="none" stroke="#5fe3a1" stroke-width="1.6"/></svg>';
const BAD_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="#ff8a9e" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ff8a9e" stroke-width="1.6"/></svg>';
const FINISH_HTML = '<div class="nge-cm-finish" hidden>'
  + '<div class="nge-cm-finish-title">Complete this cell</div>'
  + '<div class="nge-cm-finish-line nge-cm-finish-xh"><span class="nge-cm-finish-mark"></span><span class="nge-cm-finish-words"></span>'
  + '<button type="button" class="nge-cm-finish-how" hidden aria-expanded="false">How?</button></div>'
  // Ames 2026-11-16: "There should be a little info box that has a pop-up showing them what to do."
  + '<div class="nge-cm-finish-tip" hidden><p>The crosshairs are where the red and green lines cross in the 2D view. Drag the 2D view until they sit inside your cell, then press <b>Check again</b>.</p>'
  + '<p>Or let Pyr put them in your cell\'s soma:</p><button type="button" class="nge-cm-btn nge-cm-finish-soma">Put them in the soma</button></div>'
  + '<div class="nge-cm-finish-line nge-cm-finish-view"><span class="nge-cm-finish-mark"></span><span class="nge-cm-finish-words"></span></div>'
  + '<button type="button" class="nge-cm-finish-addnote">+ Add a note</button>'
  + '<textarea class="nge-cm-finish-note" rows="3" maxlength="2000" placeholder="Anything about this cell (optional)" hidden></textarea>'
  + '<div class="nge-cm-finish-left" hidden><p class="nge-cm-finish-left-count"></p><div class="nge-cm-finish-left-edit"></div></div>'
  + '<p class="nge-cm-finish-gate" hidden></p>'
  + '<div class="nge-cm-finish-actions">'
  + '<button type="button" class="nge-cm-btn nge-cm-finish-back">Keep working</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-finish-check" hidden>Check again</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-finish-jump" hidden>Jump to it</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-finish-go">Complete and Review</button></div></div>';

function card(): HTMLElement {
  ensureStyle();
  let el = document.getElementById(CARD_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = CARD_ID;
  el.className = 'ng-extend';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.title = 'Your Merge and Cut together, half each. Merge: the missing pieces you have merged in. Cut: the wrong parts you have cut off.';
  el.innerHTML = '<div class="nge-cm-head">' + '<button type="button" class="nge-cm-tool nge-cm-cellbtn" aria-label="Open the Cell Library" title="Open the Cell Library"><img class="nge-cm-cellimg" src="' + neuronIcon + '" alt="" aria-hidden="true"></button>'
    + '<span class="nge-cm-title">' + TITLE_HTML + '</span>'
    + '<span class="nge-cm-mode" data-mode="look" role="status" title="What a Ctrl+click does right now">Looking</span>'
    + '<button type="button" class="nge-cm-tool nge-cm-i" aria-label="What do these numbers mean?" aria-pressed="false" aria-controls="nge-cell-match-info" title="What do these numbers mean?">i</button>'
    + '<button type="button" class="nge-cm-tool nge-cm-min-btn" aria-label="Collapse" aria-pressed="false" title="Collapse to the score"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>'
    + '<button type="button" class="nge-cm-x" aria-label="Close" title="Close. Press Play to open it again.">×</button></div>'
    + '<div class="nge-cm-sub" hidden></div>'
    + '<div class="nge-cm-cellid" hidden></div>'
    + '<div class="nge-cm-cellnote" hidden></div>'
    + '<div class="nge-cm-info" id="nge-cell-match-info"></div>'
    + scoreHtml + NUDGE_HTML + rowHtml('merge') + rowHtml('cut') + PLAY_HTML + FINISH_HTML + '<div class="nge-cm-extra"></div>';
  mountInfo(el.querySelector('.nge-cm-info') as HTMLElement);
  mountEditable(el.querySelector('.nge-cm-mark-info') as HTMLElement, MARK_INFO_KEY, MARK_INFO_HTML, 'nge-cm-mark-info-text', 'Sandbox box, what Highlight is');
  mountEditable(el.querySelector('.nge-cm-finish-left-edit') as HTMLElement, LEFT_KEY, LEFT_HTML, 'nge-cm-finish-left-text', 'Sandbox Complete, pieces left');
  el.querySelector('.nge-cm-head')!.setAttribute('title', 'Drag to move. Double click to put it back.');
  makeDraggable(el);
  el.querySelector('.nge-cm-x')!.addEventListener('click', closeCard);
  const card0 = el;
  const info = el.querySelector('.nge-cm-i') as HTMLElement;
  info.addEventListener('click', () => {
    const on = card0.classList.toggle('nge-cm-showinfo');
    info.setAttribute('aria-pressed', String(on));
    if (on && card0.classList.contains('nge-cm-min')) setMin(card0, false);
  });
  el.querySelector('.nge-cm-min-btn')!.addEventListener('click', () => setMin(card0, !card0.classList.contains('nge-cm-min')));
  wirePlayBox(el);
  el.querySelectorAll<HTMLButtonElement>('.nge-cm-modebtn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    pressModeButton(b.dataset.tool === 'cut' ? 'cut' : 'merge');
    paintMode(card0);
  }));
  keepSize(el);
  setMin(el, store.get(MIN_KEY) === '1', true);
  document.body.appendChild(el);
  return el;
}

/** Collapsed: the title and the two bars only (Ames 2026-11-13). */
function setMin(el: HTMLElement, min: boolean, quiet = false) {
  el.classList.toggle('nge-cm-min', min);
  if (min) { el.classList.remove('nge-cm-showinfo'); el.querySelector('.nge-cm-i')?.setAttribute('aria-pressed', 'false'); }
  const b = el.querySelector('.nge-cm-min-btn') as HTMLElement | null;
  if (b) {
    b.setAttribute('aria-pressed', String(min));
    b.setAttribute('aria-label', min ? 'Expand' : 'Collapse');
    b.title = min ? 'Show Merge and Cut' : 'Collapse to the score';
  }
  if (!quiet) store.set(MIN_KEY, min ? '1' : '0');
}

/** Playing the Sandbox with no reading to show: the card stays, empty, and
 *  says why. */
const READY_NOTE = 'Getting your cell ready';
/** What the server does for a first look, in order (functions/sandbox-match.js
 *  check): find the cell, read its supervoxels, the answer key, compare. */
const LOAD_STEPS = ['Locking onto your cell', 'Reading its supervoxels', 'Loading the answer key', 'Comparing every piece'];
const LOAD_STEP_MS = 2200;
const LOADER_HTML = '<div class="nge-cm-loader" aria-hidden="true">'
  + '<div class="nge-cm-ld-scope"><div class="nge-cm-ld-glyph"></div><i class="nge-cm-ld-scan"></i></div>'
  + '<div class="nge-cm-ld-text"><div class="nge-cm-ld-title">Getting your cell ready</div>'
  + '<ol class="nge-cm-ld-steps">' + LOAD_STEPS.map(t => `<li>${t}</li>`).join('') + '</ol>'
  + '<div class="nge-cm-ld-bar"><i></i></div></div></div>';
let loadTimer: number | undefined;
/** Step the loader's lines on while the box waits; stop when it has a number. */
function runLoader(el: HTMLElement) {
  let ld = el.querySelector('.nge-cm-loader') as HTMLElement | null;
  if (!ld) {
    (el.querySelector('.nge-cm-sub') as HTMLElement).insertAdjacentHTML('afterend', LOADER_HTML);
    ld = el.querySelector('.nge-cm-loader') as HTMLElement;
    try { createApp(NeuronGlyph).mount(ld.querySelector('.nge-cm-ld-glyph') as HTMLElement); } catch (e) { console.debug('[cell-match] loader neuron', e); }
  }
  if (loadTimer != null) return;
  const started = Date.now();
  const paint = () => {
    if (!el.isConnected || !el.classList.contains('nge-cm-loading')) { window.clearInterval(loadTimer); loadTimer = undefined; return; }
    // The last step stays on until the answer comes.
    const at = Math.min(LOAD_STEPS.length - 1, Math.floor((Date.now() - started) / LOAD_STEP_MS));
    ld!.querySelectorAll('li').forEach((li, i) => { li.className = i < at ? 'done' : i === at ? 'now' : ''; });
  };
  paint();
  loadTimer = window.setInterval(paint, 250);
}

function idle(state: string, note: string, action = false) {
  if (reviewing) return;
  if (playOff()) { hide(); return; }
  if (isClosed()) { folded(); return; }
  const el = card();
  el.classList.add('nge-cm-idle');
  el.classList.remove('nge-cm-done', 'nge-cm-bad');
  const loading = note === READY_NOTE;
  el.classList.toggle('nge-cm-loading', loading);
  if (loading) runLoader(el);
  el.classList.toggle('nge-cm-checking', state === 'Checking');
  (el.querySelector('.nge-cm-state') as HTMLElement).textContent = state;
  const sbox = el.querySelector('.nge-cm-score') as HTMLElement;
  (sbox.querySelector('.nge-cm-num') as HTMLElement).textContent = '';
  (sbox.querySelector('.nge-cm-delta') as HTMLElement).textContent = '';
  (sbox.querySelector('.nge-cm-fill') as HTMLElement).style.width = '0%';
  sbox.title = `Match score: ${note || 'no reading yet'}`;
  (sbox.querySelector('.nge-cm-progress') as HTMLElement).textContent = '';
  sbox.dataset.pct = ''; sbox.dataset.pctWas = '';
  for (const row of ['merge', 'cut'] as Row[]) {
    const box = el.querySelector(`.nge-cm-row[data-row="${row}"]`) as HTMLElement;
    (box.querySelector('.nge-cm-num') as HTMLElement).textContent = '';
    (box.querySelector('.nge-cm-delta') as HTMLElement).textContent = '';
    (box.querySelector('.nge-cm-fill') as HTMLElement).style.width = '0%';
    (box.querySelector('.nge-cm-pieces') as HTMLElement).textContent = '';
    box.title = `${ROW_LABEL[row]}: ${note || 'no reading yet'}`;
    box.dataset.pct = ''; box.dataset.pctWas = '';
  }
  // What the card is waiting for, as a line under the title (Ames 2026-11-13:
  // "this should be sub-header, only visible on open mode").
  const sub = el.querySelector('.nge-cm-sub') as HTMLElement;
  sub.textContent = note;
  sub.hidden = !note;
  const extra = el.querySelector('.nge-cm-extra') as HTMLElement;
  const label = !isPlaying() ? 'Play' : holdsCell() ? 'Open my cell' : 'Teleport to a new cell';
  let b = extra.querySelector('.nge-cm-idle-go') as HTMLButtonElement | null;
  if (!action) { extra.innerHTML = ''; b = null; }
  else if (!b) {
    extra.innerHTML = '<div class="nge-cm-actions"></div>';
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'nge-cm-btn nge-cm-go nge-cm-idle-go';
    // Play's shape (Ames 2026-11-20: "the teleport to a new cell box needs
    // better styling"): a key, a slash, a circuit face, a pad at each end.
    b.innerHTML = '<span class="nge-cm-tkey" aria-hidden="true">' + BOLT_SVG + '</span><span class="nge-cm-tlabel"><span class="nge-cm-tword"></span></span>';
    b.addEventListener('click', () => { startTeleportBolt(b!, el); standbyAction(); });
    extra.firstElementChild!.appendChild(b);
  }
  const word = b?.querySelector('.nge-cm-tword') as HTMLElement | null;
  if (word && word.textContent !== label) word.textContent = label;
  place(el);
  shownFor = null;
  tellShown(null);
  syncOwns();
}

// ── Drag and drop (Ames 2026-11-13) ─────────────────────────────────────────
// Drag the card by its top line; it stays where it is dropped, in this browser,
// until a double click on that line puts it back below the Play button.
const POS_KEY = 'nge-cell-match-pos';
type Pos = { left: number; top: number };
function savedPos(): Pos | null {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : null; } catch { return null; }
}
function clampPos(el: HTMLElement, p: Pos): Pos {
  const w = el.offsetWidth || 310, h = el.offsetHeight || 120;
  return { left: Math.round(Math.min(Math.max(p.left, 0), Math.max(0, window.innerWidth - w))),
           top: Math.round(Math.min(Math.max(p.top, 0), Math.max(0, window.innerHeight - Math.min(h, 40)))) };
}
function makeDraggable(el: HTMLElement) {
  const head = el.querySelector('.nge-cm-head') as HTMLElement;
  head.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    el.classList.add('nge-cm-dragging');
    const move = (m: PointerEvent) => {
      const p = clampPos(el, { left: m.clientX - dx, top: m.clientY - dy });
      el.style.left = `${p.left}px`; el.style.top = `${p.top}px`;
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      el.classList.remove('nge-cm-dragging');
      const p = { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 };
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* private window */ }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  head.addEventListener('dblclick', e => {
    if ((e.target as HTMLElement).closest('button')) return;
    try { localStorage.removeItem(POS_KEY); } catch { /* private window */ }
    el.style.left = '12px';
    place(el);
  });
}

/** The Play button (while Play is off) and the Proofreading Test's line card
 *  and bar sit in the same corner: stay below whichever is showing. */
function place(el: HTMLElement) {
  if (el.classList.contains('nge-cm-dragging')) return;
  const p = savedPos();
  if (p) {
    const c = clampPos(el, p);
    if (el.style.left !== `${c.left}px`) el.style.left = `${c.left}px`;
    if (el.style.top !== `${c.top}px`) el.style.top = `${c.top}px`;
    return;
  }
  let top = 64;
  for (const other of document.querySelectorAll<HTMLElement>('.nge-play-dock, .nge-tqc, #nge-test-hud')) {
    const r = other.getBoundingClientRect();
    if (r.height && r.left < 200) top = Math.max(top, Math.round(r.bottom) + 8);
  }
  if (el.style.top !== `${top}px`) el.style.top = `${top}px`;
}

function hide() {
  if (reviewing) return;
  document.getElementById(CARD_ID)?.remove();
  removeChip();
  shownFor = null;
  tellShown(null);
  syncOwns();
}

// ── Close and reopen (Ames 2026-11-13) ──────────────────────────────────────
// The X folds the card into a small Match button in the same spot; it
// stays folded (in this browser) until that button is clicked. The first time,
// a hint points at the button.
const isClosed = () => store.get(CLOSED_KEY) === '1';
/** Settings, Screen, "Show the Play button" off: PlayButton marks the page. */
const playOff = () => document.body.classList.contains('nge-play-off');
/** The cell on screen when Stop playing hid the box. */
let stoppedOn: number | null = null;
/** Closed: no box, the Cell Library row back, and Pyr's Play button shows
 *  again (PlayButton reads the class) to open the box. */
function folded() {
  document.getElementById(CARD_ID)?.remove();
  removeChip();
  shownFor = null;
  tellShown(null);
  document.body.classList.add('nge-cm-closed');
  syncOwns();
}

function removeChip() {
  document.getElementById(CHIP_ID)?.remove();
  document.getElementById(HINT_ID)?.remove();
}

function closeCard() {
  if (reviewing) return;
  store.set(CLOSED_KEY, '1');
  folded();
  setTimeout(() => (document.querySelector('.nge-play-btn') as HTMLElement | null)?.focus(), 450);
}

function openCard() {
  store.set(CLOSED_KEY, '0');
  removeChip();
  document.body.classList.remove('nge-cm-closed');
  if (playOff()) return;
  const id = onScreen ?? claimOnScreen();
  if (id == null) return;
  onScreen = id;
  show(id, last.get(id), !last.get(id));
  void ask(id);
}

function ping(el: HTMLElement) {
  el.classList.remove('nge-cm-ping');
  void el.offsetWidth;
  el.classList.add('nge-cm-ping');
}

function showScore(el: HTMLElement, r: MatchResult, fresh: boolean) {
  const box = el.querySelector('.nge-cm-score') as HTMLElement;
  box.title = scoreTip(matchScore(r));
  (box.querySelector('.nge-cm-progress') as HTMLElement).textContent = progressLine(r);
  setReading(box, matchScore(r), fresh);
}

function showRow(el: HTMLElement, r: MatchResult, row: Row, fresh: boolean) {
  const box = el.querySelector(`.nge-cm-row[data-row="${row}"]`) as HTMLElement;
  const pct = row === 'merge' ? r.merge : r.cut;
  (box.querySelector('.nge-cm-pieces') as HTMLElement).textContent = rowPieces(r, row);
  // Hover, collapsed or not (Ames 2026-11-13): what the bar says in words.
  box.title = `${ROW_LABEL[row]}${pct == null ? '' : ` ${pct}%`}: ${rowPieces(r, row)}`;
  setReading(box, pct ?? null, fresh);
}

/** A row's number, bar and change since the last reading. */
function setReading(box: HTMLElement, pct: number | null, fresh: boolean) {
  const num = box.querySelector('.nge-cm-num') as HTMLElement;
  const delta = box.querySelector('.nge-cm-delta') as HTMLElement;
  (box.querySelector('.nge-cm-fill') as HTMLElement).style.width = `${pct ?? 0}%`;
  num.textContent = pct == null ? '' : `${pct}%`;
  const before = fresh ? NaN : Number(box.dataset.pct);
  box.dataset.pct = pct == null ? '' : String(pct);
  // To the tenth, as the score is (report 573: 34.9 minus 19.9 read +14.999999).
  const d = pct == null || !Number.isFinite(before) ? 0 : Math.round((pct - before) * 10) / 10;
  if (pct != null && Number.isFinite(before) && box.dataset.pctWas !== '' && d !== 0) {
    // A minus sign, not a hyphen: Pyr's copy has no dashes.
    delta.textContent = d > 0 ? `+${d}` : `−${-d}`;
    delta.style.color = d > 0 ? '#59e3a7' : '#ff8fa3';
    delta.style.opacity = '1';
    const shownText = delta.textContent;
    setTimeout(() => { delta.style.opacity = '0'; }, 2200);
    // Gone once faded, so an old change is never read out later.
    setTimeout(() => { if (delta.textContent === shownText && delta.style.opacity === '0') delta.textContent = ''; }, 3200);
  } else if (pct == null) {
    delta.textContent = '';
  }
  box.dataset.pctWas = pct == null ? '' : 'y';
}

function show(taskId: number, r: MatchResult | undefined, checking: boolean) {
  if (reviewing) return;
  // An older server sends one number only, no Missing and Mergers: show
  // nothing rather than "none missing".
  if (r && r.scorable && r.merge === undefined && r.cut === undefined) { hide(); return; }
  if (!r || !r.scorable) {
    // Checking a cell not seen before: say nothing until there is a number,
    // unless Play is on, when the card waits with the player.
    if (!checking || !r) {
      if (!onSandbox()) hide();
      // The first reading is quiet: no light, no ring (Ames 2026-11-14: "I haven't even made an edit, this animation is a bit much"). They are for checking an edit.
      else if (!r) idle(checking ? '' : 'Standby', checking ? READY_NOTE : standbyNote(), !checking);
      else idle('No key', 'No finished cell to compare this one with');
      return;
    }
  }
  if (playOff()) { hide(); return; }
  if (isClosed()) { folded(); return; }
  const el = card();
  if (el.classList.contains('nge-cm-idle')) {
    (el.querySelector('.nge-cm-extra') as HTMLElement).innerHTML = '';
    (el.querySelector('.nge-cm-sub') as HTMLElement).hidden = true;
  }
  el.classList.remove('nge-cm-idle', 'nge-cm-loading');
  const state = el.querySelector('.nge-cm-state') as HTMLElement;
  el.classList.toggle('nge-cm-checking', checking);
  const done = Date.now() < doneUntil;
  el.classList.toggle('nge-cm-done', done && doneTone === 'good');
  el.classList.toggle('nge-cm-bad', done && doneTone === 'bad');
  if (checking) {
    state.textContent = done ? doneText : 'Checking';
  } else {
    state.textContent = done ? doneText : 'Live';
    const fresh = shownFor !== taskId;
    showScore(el, r!, fresh);
    showRow(el, r!, 'merge', fresh);
    showRow(el, r!, 'cut', fresh);
    if (!fresh) ping(el);
  }
  const idLine = el.querySelector('.nge-cm-cellid') as HTMLElement;
  const rootNow = r?.root || '';
  idLine.textContent = rootNow ? `Cell ${rootNow}` : '';
  idLine.hidden = !rootNow;
  // Little more than a nucleus (Ames 2026-11-14: "it keeps taking me to a
  // nucleus ... indicate that if it's just a nucleus they should add the cell").
  const note = el.querySelector('.nge-cm-cellnote') as HTMLElement;
  // Until most of what is missing is merged in (Ames 2026-11-16: "a lot of
  // the new cells are just a nucleus ... prompting user to merge the nucleus
  // to the cell").
  const nucleus = !!(r && r.scorable && r.nucleusOnly && r.missing && r.missing.left > 0 && (r.merge ?? 0) < 50);
  // Someone finished it before this player got it (Ames 2026-11-17).
  const finishedBefore = !!(r && r.scorable && r.alreadyDone && !r.edits);
  if (finishedBefore && !note.querySelector('.nge-cm-cellnote-new')) {
    note.innerHTML = '<span>Someone already finished this cell, so there is nothing left to fix.</span>'
      + '<button type="button" class="nge-cm-btn nge-cm-cellnote-new">Teleport to a new cell</button>';
    note.querySelector('.nge-cm-cellnote-new')!.addEventListener('click', () => {
      if (shownFor != null) moment(shownFor, 'skip');
      removeHintLayers();
      cellAction('skip');
    });
  }
  if (finishedBefore) { note.hidden = false; void loadMine(); place(el); shownFor = taskId; tellShown(taskId); return; }
  if (note.querySelector('.nge-cm-cellnote-new')) note.innerHTML = '';
  if (nucleus && !note.querySelector('.nge-cm-cellnote-go')) {
    note.innerHTML = '<span>Your cell is only its nucleus so far. Merge the nucleus into the cell body around it, then follow the branches out.</span>'
      + '<button type="button" class="nge-cm-btn nge-cm-cellnote-go">Show me the cell</button>';
    note.querySelector('.nge-cm-cellnote-go')!.addEventListener('click', () => void showBiggestPiece(el));
  }
  // Why the score stays near half until something is cut (kfay, reports 562
  // and 563) is said in the (i) box, not on the card (Ames 2026-11-19: "get
  // rid of this, it belongs in the info box").
  if (!nucleus) note.innerHTML = '';
  note.hidden = !nucleus;
  void loadMine();
  place(el);
  shownFor = taskId;
  tellShown(taskId);
}

function rootShown(root: string): boolean {
  try {
    const vis = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    return !!vis && vis.has(Uint64.parseString(root));
  } catch { return true; }
}
async function ask(taskId: number) {
  const mine = ++asking;
  show(taskId, last.get(taskId), true);
  try {
    const r = await secureWrite<MatchResult>('match.check', { taskId });
    const prev = last.get(taskId);
    noteResult(taskId, r);
    // The other IDs are dropped once the current one is on screen; until then
    // (a reloaded view with an older ID, before swapOldIds runs) they keep
    // the cell found.
    if (r.root && rootShown(r.root)) aliases.delete(taskId);
    if (mine !== asking || onScreen !== taskId) return;
    const kind = editKind;
    editKind = null;
    if (kind && prev && prev.scorable && r.scorable) {
      const v = judgeEdit(kind, prev, r);
      doneText = v.text; doneTone = v.tone; doneUntil = Date.now() + VERDICT_MS;
    }
    show(taskId, r, false);
    if (kind && prev && prev.scorable && r.scorable) flash(doneText, doneTone, VERDICT_MS);
    console.debug('[cell-match]', taskId, 'missing', r.merge, rowPieces(r, 'merge'), 'mergers', r.cut, rowPieces(r, 'cut'));
  } catch (e: any) {
    console.debug('[cell-match] no check', taskId, e?.message);
    if (mine === asking && onScreen === taskId) {
      const r = last.get(taskId);
      if (r && r.scorable) show(taskId, r, false); else hide();
    }
  }
}

// ── The Playing box: actions, Complete, Hint, play moments ─────────────────
const HINT_AFTER_MS = 60_000;
const HINT_SEG_LAYER = 'Hint piece';
const HINT_PIN_LAYER = 'Hint spot';
/** n: which piece the next hint is about; step 1 the place it starts, step 2 the piece. */
interface Clock { opened: number; lastEdit: number; offered: boolean; n: number; step: 1 | 2; jumped: boolean; jumps: number }
const clocks = new Map<number, Clock>();
let finishing = false;
let toldShown: number | null | undefined;

/** The Cell Library hears which cell the box shows, and says how its buttons stand. */
function tellShown(taskId: number | null) {
  if (toldShown === taskId) return;
  toldShown = taskId;
  document.dispatchEvent(new CustomEvent('nge:cm-cell-ask', { detail: { taskId: taskId ?? 0 } }));
  syncOwns();
}
/** While the box shows a cell, the Cell Library's slim row steps aside. */
function syncOwns() {
  const el = document.getElementById(CARD_ID);
  // Also while it waits (Getting your cell ready, Standby): the library's slim
  // row came up under it after Teleport to a new cell (Ames 2026-11-16).
  // And before the box is up at all, from the moment Pyr knows the Sandbox is
  // being played: on a refresh the row came up, then went (Ames 2026-11-16).
  const owns = !playOff() && !isClosed() && ((!!el && document.body.contains(el)) || onSandbox());
  document.body.classList.toggle('nge-cm-owns', owns);
}
/** Save view, Skip and Complete run in the Cell Library, which is only there
 *  while it is open (Ames 2026-11-14: with it closed, Complete sat on
 *  "Checking the crosshairs" for good and Save changed nothing). Closed, it
 *  is opened out of sight (slim, which the box hides) and asked when ready. */
let libraryUp = false;
let pendingAction: CustomEvent | null = null;
function sendPending() {
  const e = pendingAction;
  pendingAction = null;
  if (e) document.dispatchEvent(e);
}
function cellAction(action: string, extra: Record<string, unknown> = {}) {
  const taskId = shownFor ?? onScreen;
  if (taskId == null) return;
  const e = new CustomEvent('nge:cm-cell-action', { detail: { action, taskId, ...extra } });
  if (libraryUp) { document.dispatchEvent(e); return; }
  pendingAction = e;
  (window as any).__ngeCmQuietLibrary = true;
  document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'mine', quiet: true } }));
  // Already open (it opened before this file listened): send it anyway.
  setTimeout(sendPending, 600);
}
function idleSecs(taskId: number): number | null {
  const c = clocks.get(taskId);
  return c ? Math.round((Date.now() - Math.max(c.opened, c.lastEdit)) / 1000) : null;
}
function moment(taskId: number, kind: 'opened' | 'hint_offered' | 'complete' | 'skip', note = '') {
  const r = last.get(taskId);
  const score = r && r.scorable ? matchScore(r) : null;
  void secureWrite('match.event', { taskId, kind, idleSecs: idleSecs(taskId), score, ...(note ? { note: note.slice(0, 1000) } : {}) }).catch((e: any) => console.debug('[cell-match] no moment', kind, e?.message));
}
function noteOpened(taskId: number) {
  if (clocks.has(taskId)) return;
  // A new cell on screen: the last cell's review (Missed pieces, its pins)
  // and any Jump marks go with it (Ames 2026-11-16: "it should also remove
  // the missing pieces layer when I go to a new cell").
  if (!reviewing) { removeReviewLayers(); window.clearInterval(pinsTimer); removeHintLayers(); }
  const now = Date.now();
  clocks.set(taskId, { opened: now, lastEdit: now, offered: false, n: 0, step: 1, jumped: false, jumps: 0 });
  moment(taskId, 'opened');
}
function noteEdit(taskId: number) {
  const c = clocks.get(taskId);
  // After an edit the next Jump starts again with a place, at the same spot in
  // the list: the piece just fixed has left it, so that is the next one.
  if (c) { c.lastEdit = Date.now(); c.offered = false; c.step = 1; c.jumped = false; }
  // Spots looked up before this edit are stale (Ames 2026-11-19: "I've
  // already made the merge, and it's still showing me your cell is missing a
  // branch"): a Jump pressed before the new reading asked the server afresh.
  for (const k of [...ahead.keys()]) if (k.startsWith(`${taskId}:`)) ahead.delete(k);
  removeHintLayers();
  const el = document.getElementById(CARD_ID);
  if (el) resetNudge(el);
}
function resetNudge(el: HTMLElement) {
  const n = el.querySelector('.nge-cm-nudge') as HTMLElement;
  n.hidden = true;
  (n.querySelector('.nge-cm-nudge-text') as HTMLElement).textContent = '';
  const b = n.querySelector('.nge-cm-hint-btn') as HTMLButtonElement;
  b.textContent = 'Show me'; b.disabled = false; b.hidden = true;
  el.querySelector('.nge-cm-hbtn')?.classList.remove('nge-cm-nudged');
}
/** A minute with no edit (Ames 2026-11-14: "introduce hint after like 1 minute"): Jump lights up. */
function maybeOfferHint(taskId: number) {
  const c = clocks.get(taskId);
  const el = document.getElementById(CARD_ID);
  if (!c || !el || c.offered || reviewing || finishing || shownFor !== taskId) return;
  if (Date.now() - Math.max(c.opened, c.lastEdit) < HINT_AFTER_MS) return;
  const r = last.get(taskId);
  if (!r || !r.scorable) return;
  c.offered = true;
  el.querySelector('.nge-cm-hbtn')?.classList.add('nge-cm-nudged');
  moment(taskId, 'hint_offered');
}
/** The biggest piece left, shown at once (the nucleus note's Show me the cell):
 *  Jump to the first spot, then Show me. */
async function showBiggestPiece(el: HTMLElement) {
  const taskId = shownFor;
  if (taskId == null) return;
  const c = clocks.get(taskId);
  if (c) { c.n = 0; c.jumped = false; }
  await pressHint(el, true);
  if (clocks.get(taskId)?.step === 2) await pressHint(el);
}
/** A Sandbox cell first opened while playing: the 2D EM beside the 3D
 *  (Ames 2026-11-17), once per cell in this tab. */
function splitOnce(taskId: number) {
  const KEY = 'nge-cm-split-done';
  let done: number[] = [];
  try { done = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { /* none yet */ }
  if (done.includes(taskId)) return;
  try { sessionStorage.setItem(KEY, JSON.stringify([...done.slice(-50), taskId])); } catch { /* private window */ }
  ensureSplit();
}
/** 2D beside 3D for a hint, unless a 2D view is already open. */
function ensureSplit() {
  try {
    const lay = JSON.stringify((window as any).viewer?.layout?.toJSON?.() ?? '');
    if (/xy|yz|xz|4panel/.test(lay)) return;
    openSplitView();
  } catch { /* the layout stays */ }
}
interface HintPiece { kind: 'merge' | 'cut'; root?: string; size: number; pointNm?: number[]; nearNm?: number[]; bringsMerger?: boolean }
/** Hint in two steps (Ames 2026-11-14: "this is not a hint but giving
 *  immediately the answer"): first the place on your own cell where the
 *  trouble starts, and what to look for there; Show me then shows the piece. */
// ── Look ahead (Ames 2026-11-17: "why does it take so long to find the next
// spot? can we speed it up?"). A spot takes the server 1 to 7 s: it reads the
// cell, the true cell and the image around the spot, and a Jump can reach a
// server copy that has none of it in memory. So the box asks for the next
// spot quietly as soon as a reading lands, keeps the answer here, and Jump
// shows it at once. Keyed by the cell's root, so an edit asks again.
interface HintAnswer { left: number; piece: HintPiece | null }
const ahead = new Map<string, Promise<HintAnswer>>();
const aheadKey = (taskId: number, root: string | undefined, n: number, step: number) => `${taskId}:${root ?? ''}:${n}:${step}`;
function askAhead(taskId: number, root: string | undefined, n: number, step: 1 | 2) {
  const key = aheadKey(taskId, root, n, step);
  if (ahead.has(key)) return;
  if (ahead.size > 40) ahead.delete(ahead.keys().next().value as string);
  const p = secureWrite<HintAnswer>('match.hint', { taskId, n, step, prefetch: true });
  p.catch(() => ahead.delete(key));
  ahead.set(key, p);
}
/** The spot the next Jump goes to, asked for now. */
function lookAhead(taskId: number, r: MatchResult) {
  if (!r.scorable || !r.root || !isPlaying()) return;
  const left = (r.missing?.left ?? 0) + (r.cutParts ?? r.extra?.left ?? 0);
  if (left <= 0) return;
  const c = clocks.get(taskId);
  const n = c ? (c.jumped ? c.n + 1 : c.n) : 0;
  // A moment later, so a burst of edits asks once.
  window.setTimeout(() => { if (last.get(taskId)?.root === r.root) askAhead(taskId, r.root, n, 1); }, 1200);
}

async function pressHint(el: HTMLElement, next = false) {
  const taskId = shownFor;
  if (taskId == null) return;
  const c = clocks.get(taskId) ?? { opened: Date.now(), lastEdit: Date.now(), offered: true, n: 0, step: 1 as const, jumped: false, jumps: 0 };
  if (!clocks.has(taskId)) clocks.set(taskId, c);
  // Jump (Ames 2026-11-14: "Jump (takes me to next error spot)"): the first
  // goes to the biggest piece left, each one after to the next.
  if (next) { if (c.jumped) c.n++; c.step = 1; c.jumped = true; c.jumps++; }
  const b = el.querySelector('.nge-cm-hint-btn') as HTMLButtonElement;
  const jump = el.querySelector('.nge-cm-hbtn') as HTMLButtonElement;
  const text = el.querySelector('.nge-cm-nudge-text') as HTMLElement;
  const step = c.step;
  jump.classList.remove('nge-cm-nudged');
  ensureSplit();
  const line = el.querySelector('.nge-cm-nudge') as HTMLElement;
  line.hidden = false;
  if (step === 1) { b.hidden = true; text.textContent = 'Finding the next spot…'; }
  b.disabled = true; jump.disabled = true; if (step === 2) b.textContent = 'Finding…';
  if (next) startJumpSearch(jump);
  let found = false;
  line.classList.add('nge-cm-finding');
  try {
    const root = last.get(taskId)?.root;
    const key = aheadKey(taskId, root, c.n, step);
    const early = ahead.get(key);
    let h: HintAnswer;
    if (early) {
      // Looked up already: shown at once; the hint itself is still kept.
      h = await early;
      void secureWrite('match.hint', { taskId, n: c.n, step, idleSecs: idleSecs(taskId) }).catch(() => {});
    } else {
      h = await secureWrite<HintAnswer>('match.hint', { taskId, n: c.n, step, idleSecs: idleSecs(taskId) });
    }
    // Show me after this: asked for now.
    if (step === 1 && h.piece) askAhead(taskId, root, c.n, 2);
    if (!h.piece) { text.textContent = 'Nothing left to fix. Complete and Review when you are ready.'; b.hidden = true; return; }
    showHintPiece(h.piece);
    found = true;
    const where = h.left > 1 ? ` Spot ${(c.n % h.left) + 1} of ${h.left}.` : '';
    // A missing branch can bring part of another cell with it (Ames
    // 2026-11-14: "this missed piece has a huge merger on it").
    const merger = h.piece.kind === 'merge' && h.piece.bringsMerger;
    if (step === 1) {
      text.textContent = (h.piece.kind === 'merge'
        ? 'Your cell is missing a branch that starts near the blue pin. Look for a loose end there.'
        : 'Something that is not your cell joins it near the blue pin. Look for where it meets.')
        + (merger ? ' Careful: that branch also carries part of another cell.' : '') + where;
      b.textContent = 'Show me';
      b.hidden = false;
      c.step = 2;
    } else {
      text.textContent = (h.piece.kind === 'merge'
        ? (merger ? 'This gold piece belongs to your cell, and it carries part of another cell too. Merge it in, then cut that part off.' : 'This gold piece belongs to your cell. Merge it in.')
        : 'Your cell runs into another cell at the red pin. Cut it off there.') + where;
      b.hidden = true;
    }
  } catch (e: any) {
    console.debug('[cell-match] no jump', e?.message);
    text.textContent = 'Could not find the next spot right now. Try again in a moment.';
    b.textContent = 'Show me';
  } finally { b.disabled = false; jump.disabled = false; if (next) finishJumpSearch(found); line.classList.remove('nge-cm-finding'); }
}
let hintPinTimer: number | undefined;
function showHintPiece(p: HintPiece) {
  const v = (window as any).viewer;
  if (!v?.layerSpecification) return;
  removeHintLayers();
  const at = p.pointNm ?? p.nearNm;
  if (!at) return;
  flyTo(at);
  // The piece goes in the player's own segmentation layer, in gold, so a
  // Ctrl+click on it picks the real segment to merge. In a layer of its own
  // the click hit that copy and the merge read "Cannot merge segment with
  // itself" (Ames 2026-11-14).
  if (p.kind === 'merge' && p.root) {
    tintCellBlue(shownFor != null ? last.get(shownFor)?.root : null);
    try {
      const layer = currentSegLayer()?.layer;
      const group = layer?.displayState?.segmentationGroupState?.value;
      const colors = layer?.displayState?.segmentationColorGroupState?.value?.segmentStatedColors;
      const seg = Uint64.parseString(p.root);
      if (group) {
        const was = group.visibleSegments.has(seg);
        if (colors) setStatedColor(colors, seg, GOLD_PACKED);
        group.visibleSegments.add(seg);
        hintShown = { root: p.root, wasVisible: was };
      }
    } catch (e) { console.debug('[cell-match] hint piece', e); }
  }
  const point = toView(at);
  if (!point) return;
  const place1 = !p.pointNm;
  const pin = [{ type: 'point', id: 'hint', point, description: place1 ? 'Look near here' : p.kind === 'merge' ? 'Merge this piece in' : 'Cut here' }];
  const color = place1 ? '#7fd8ff' : p.kind === 'merge' ? GOLD : RED;
  const place = () => {
    for (const ml of [...(v.layerManager?.managedLayers ?? [])]) if (ml.name === HINT_PIN_LAYER) dropLayer(v, ml);
    try { v.layerSpecification.add(makeLayer(v.layerSpecification, HINT_PIN_LAYER, { type: 'annotation', source: { url: 'local://annotations' }, annotationColor: color, pointSize: PIN_SIZE, onTop: true, annotations: pin })); }
    catch (e) { console.debug('[cell-match] hint pin', e); }
  };
  place();
  // No beat (Ames 2026-11-18: "immediately remove the animated annotation that appears on jump").
  // A new annotation layer takes its point only once it knows the view's space (as the review's pins).
  window.clearInterval(hintPinTimer);
  let tries = 0;
  hintPinTimer = window.setInterval(() => {
    const ml = (v.layerManager?.managedLayers ?? []).find((x: any) => x.name === HINT_PIN_LAYER);
    let n = -1;
    try { n = ml?.layer?.localAnnotations ? ml.layer.localAnnotations.toJSON().length : -1; } catch { /* loading */ }
    if (!ml || n === 1 || ++tries > 10) { window.clearInterval(hintPinTimer); return; }
    if (tries > 1) place();
  }, 700);
}

/** The hint pin: bigger than before and drawn over the cell (kfay, report 556:
 *  "barely cannot see pins"), but not huge (Ames 2026-11-18: "too large"). */
const PIN_SIZE = 2.5;
/** Complete inside the box: the Cell Library runs the checks and the save; the box shows them. */
function openFinish(el: HTMLElement) {
  finishing = true;
  el.classList.add('nge-cm-finishing');
  const f = el.querySelector('.nge-cm-finish') as HTMLElement;
  f.hidden = false;
  (f.querySelector('.nge-cm-finish-note') as HTMLTextAreaElement).value = '';
  (f.querySelector('.nge-cm-finish-note') as HTMLElement).hidden = true;
  (f.querySelector('.nge-cm-finish-addnote') as HTMLElement).hidden = false;
  if (el.classList.contains('nge-cm-min')) setMin(el, false, true);
  const taskId = shownFor;
  const r = taskId != null ? last.get(taskId) : undefined;
  const left = f.querySelector('.nge-cm-finish-left') as HTMLElement;
  const parts: string[] = [];
  if (r?.missing && r.missing.left > 0) parts.push(`${plural(r.missing.left, 'piece')} to merge in`);
  const cutLeft = r?.cutParts ?? r?.extra?.left ?? 0;
  if (cutLeft > 0) parts.push(`${plural(cutLeft, 'part')} to cut off`);
  // Ames 2026-11-16: practice only; a real cell is never completed half done.
  // The advice after the count is admin editable (LEFT_KEY).
  // The pieces and parts left in red (Ames 2026-11-19).
  const count = left.querySelector('.nge-cm-finish-left-count') as HTMLElement;
  count.textContent = '';
  if (parts.length) {
    count.append('You still have ');
    parts.forEach((part, i) => {
      if (i) count.append(' and ');
      const b = document.createElement('b');
      b.className = 'nge-cm-left-red';
      b.textContent = part;
      count.append(b);
    });
    count.append('.');
  }
  left.hidden = !parts.length;
  showGate(el);
  renderFinish(el, { checking: true, ok: false, message: '', minting: true, submitting: false, link: false });
  heardAt = 0;
  const askedAt = Date.now();
  cellAction('complete-open');
  setTimeout(() => {
    if (!finishing || heardAt >= askedAt || !document.getElementById(CARD_ID)) return;
    renderFinish(el, { checking: false, ok: false, message: 'Pyr did not answer. Press Check again.', minting: false, submitting: false, link: false });
    (el.querySelector('.nge-cm-finish-check') as HTMLElement).hidden = false;
  }, 20000);
}
/** When the Cell Library last answered about the cell on screen. */
let heardAt = 0;
function closeFinish(el: HTMLElement) {
  finishing = false;
  el.classList.remove('nge-cm-finishing');
  (el.querySelector('.nge-cm-finish') as HTMLElement).hidden = true;
}
interface FinishState { checking: boolean; ok: boolean; message: string; minting: boolean; submitting: boolean; link: boolean }
function finishLine(line: HTMLElement, state: 'wait' | 'ok' | 'bad', words: string) {
  line.classList.toggle('nge-cm-wait', state === 'wait');
  (line.querySelector('.nge-cm-finish-mark') as HTMLElement).innerHTML = state === 'ok' ? OK_SVG : state === 'bad' ? BAD_SVG : '';
  (line.querySelector('.nge-cm-finish-words') as HTMLElement).textContent = words;
}
function renderFinish(el: HTMLElement, c: FinishState) {
  const f = el.querySelector('.nge-cm-finish') as HTMLElement;
  const xh = f.querySelector('.nge-cm-finish-xh') as HTMLElement;
  if (c.checking) finishLine(xh, 'wait', 'Checking the crosshairs…');
  else if (c.ok) finishLine(xh, 'ok', 'The crosshairs are inside your cell.');
  else finishLine(xh, 'bad', c.message || 'Put the crosshairs inside your cell, then Check again.');
  const how = f.querySelector('.nge-cm-finish-how') as HTMLElement;
  how.hidden = c.checking || c.ok;
  if (c.checking || c.ok) { (f.querySelector('.nge-cm-finish-tip') as HTMLElement).hidden = true; how.setAttribute('aria-expanded', 'false'); }
  const view = f.querySelector('.nge-cm-finish-view') as HTMLElement;
  if (c.minting) finishLine(view, 'wait', 'Saving your view…');
  else if (c.link) finishLine(view, 'ok', 'Your view is saved with it.');
  else finishLine(view, 'bad', 'Your view could not be saved. Try again in a moment.');
  (f.querySelector('.nge-cm-finish-check') as HTMLElement).hidden = c.checking || c.ok;
  const go = f.querySelector('.nge-cm-finish-go') as HTMLButtonElement;
  go.disabled = c.submitting || c.checking || c.minting || !c.ok || !c.link || gated();
  go.textContent = c.submitting ? 'Saving…' : 'Complete and Review';
}
/** What the Cell Library says about the cell on screen. */
function onCellState(e: Event) {
  const d = (e as CustomEvent).detail || {};
  const el = document.getElementById(CARD_ID);
  if (!el || Number(d.taskId) !== shownFor) return;
  heardAt = Date.now();
  const save = el.querySelector('.nge-cm-saveview') as HTMLButtonElement;
  save.disabled = !!d.saving;
  save.textContent = d.saving ? 'Saving…' : d.saved ? 'Saved ✓' : 'Save';
  // Ames 2026-11-14: "doesn't view auto save? shouldn't it say that?" It
  // saves by itself when you move to another cell; a reload does not.
  const note = el.querySelector('.nge-cm-viewnote') as HTMLElement;
  const savedText = d.saved && (!d.savedText || /not saved/i.test(d.savedText)) ? 'Saved just now' : (d.savedText || 'Not saved yet');
  note.textContent = `${savedText}. Also saves when you change cells.`;
  note.title = `${savedText}. Your view also saves by itself when you move to another cell.`;
  const skip = el.querySelector('.nge-cm-skipcell') as HTMLButtonElement;
  skip.disabled = !!d.skipping;
  skip.textContent = d.skipping ? 'Skipping…' : 'Skip Cell';
  if (d.completing) { if (!finishing) openFinishShown(el); renderFinish(el, d.completing as FinishState); }
  else if (finishing) closeFinish(el);
}
/** The library opened Complete by itself (its own button): show it here too. */
function openFinishShown(el: HTMLElement) {
  finishing = true;
  el.classList.add('nge-cm-finishing');
  (el.querySelector('.nge-cm-finish') as HTMLElement).hidden = false;
}
/** Drag the bottom right corner to resize the box (Ames 2026-11-14); the size
 *  stays, in this browser. Collapsed it keeps its width only. */
const SIZE_KEY = 'nge-cell-match-size';
function keepSize(el: HTMLElement) {
  try {
    const s = JSON.parse(store.get(SIZE_KEY) || 'null');
    if (s && s.w >= 300) el.style.width = `${Math.min(s.w, window.innerWidth - 24)}px`;
    if (s && s.h >= 120) el.style.height = `${Math.min(s.h, window.innerHeight - 80)}px`;
  } catch { /* the default size */ }
  let at = '';
  const save = () => {
    // Only a size the player set: the corner writes width and height inline.
    if (!el.style.width && !el.style.height) return;
    const v = JSON.stringify({ w: Math.round(el.offsetWidth), h: el.style.height ? Math.round(el.offsetHeight) : 0 });
    if (v !== at) { at = v; store.set(SIZE_KEY, v); }
  };
  el.addEventListener('mouseup', save);
  el.addEventListener('pointerup', save);
}
/** Jump's search, drawn with Find Path's loader (find_path_status.ts). */
let jumpSearch: { jump: HTMLElement; cv: HTMLCanvasElement; live: Live; ro?: ResizeObserver; ending?: boolean } | null = null;
function endJumpSearch() {
  const j = jumpSearch;
  if (!j) return;
  jumpSearch = null;
  j.ro?.disconnect();
  cancelAnimationFrame(j.live.raf);
  j.cv.remove();
  j.jump.classList.remove('nge-cm-searching');
}
/** A button's circuit edge, drawn to its size (see "Circuit edges" above).
 *  Keyed: the right end is the slash before the bulb key. */
function frameSvg(w: number, h: number, keyed: boolean): string {
  // A chip on a board (Ames 2026-11-20: "PCB microchip type thing in the
  // border", "it's small, so keep it as simple as you can"): the package
  // outline with cut corners, a few pins on its top and bottom edges, two
  // traces stepping in at 45 degrees to vias in two corners, and a ring pad
  // at the middle of each side. The middle stays clear for the words.
  const c = 7, f = (n: number) => n.toFixed(1);
  const R = w - 0.5, B = h - 0.5, m = h / 2;
  const rim = keyed
    ? `M${c} .5H${f(R)}L${f(w - 10.5)} ${f(B)}H.5V${c}Z`
    : `M${c} .5H${f(R)}V${f(h - c)}L${f(w - c)} ${f(B)}H.5V${c}Z`;
  let tr = '', vias = '', pins = '';
  const via = (x: number, y: number) => { vias += `<circle class="via" cx="${f(x)}" cy="${f(y)}" r="1.35"/>`; };
  const span = Math.min(1, w / 260);
  // Top right: two traces leave the top edge, step in, run left to vias.
  const tx = w - (keyed ? 24 : 15);
  for (let k = 0; k < 2; k++) {
    const x0 = tx - 4 * k, y = 3.5 + 3 * k, L = (28 - 10 * k) * span;
    tr += `M${f(x0)} .5L${f(x0 - y + 0.5)} ${f(y)}H${f(x0 - y + 0.5 - L)}`;
    via(x0 - y + 0.5 - L - 1.4, y);
  }
  // Bottom left: the same, running right.
  for (let k = 0; k < 2; k++) {
    const x0 = 15 + 4 * k, y = h - 3.5 - 3 * k, L = (28 - 10 * k) * span;
    tr += `M${f(x0)} ${f(B)}L${f(x0 + (B - y))} ${f(y)}H${f(x0 + (B - y) + L)}`;
    via(x0 + (B - y) + L + 1.4, y);
  }
  // Pins: four legs on the top edge at the left, four on the bottom at the right.
  const legs = (x0: number, y: number) => { for (let i = 0; i < 4; i++) pins += `<rect class="pin" x="${f(x0 + i * 4.5)}" y="${f(y)}" width="1.8" height="2.6" rx=".4"/>`; };
  legs(c + 14, -2.4);
  legs(w - (keyed ? 30 : 22) - 18, h - 0.2);
  const rx = keyed ? w - 5.5 : R;
  const side = (x: number) => `<circle class="side" cx="${f(x)}" cy="${f(m)}" r="3.6"/><circle class="side-in" cx="${f(x)}" cy="${f(m)}" r="1.3"/>`;
  return `<svg viewBox="0 0 ${f(w)} ${f(h)}" aria-hidden="true">${pins}<path class="rim" d="${rim}"/><path class="tr" d="${tr}"/>${vias}${side(0.5)}${side(rx)}</svg>`;
}
function frameButton(btn: HTMLElement) {
  const host = document.createElement('span');
  host.className = 'nge-cm-frame';
  host.setAttribute('aria-hidden', 'true');
  btn.prepend(host);
  let drawn = '';
  const draw = () => {
    const w = btn.offsetWidth, h = btn.offsetHeight;
    if (!w || !h) return;
    const keyed = !!btn.parentElement?.querySelector('.nge-cm-bulb:not([hidden])') && btn.classList.contains('nge-cm-hbtn');
    const key = `${w}x${h}${keyed}`;
    if (key === drawn) return;
    drawn = key;
    host.innerHTML = frameSvg(w, h, keyed);
  };
  try { new ResizeObserver(draw).observe(btn); } catch { /* drawn once */ }
  requestAnimationFrame(draw);
}
function startJumpSearch(jump: HTMLElement) {
  endJumpSearch();
  const cv = document.createElement('canvas');
  cv.className = 'nge-cm-jloader';
  cv.setAttribute('aria-hidden', 'true');
  jump.appendChild(cv);
  jump.classList.add('nge-cm-searching');
  const live: Live = { raf: 0, timer: 0 };
  const j: NonNullable<typeof jumpSearch> = { jump, cv, live };
  jumpSearch = j;
  // From the pad on one edge to the pad on the other (Ames 2026-11-20: "have
  // the lightning bolts originate from there"). The canvas reaches 6 px past
  // each edge so the end dots sit on the pads.
  // With the bulb beside it, the right pad sits on Jump's slash, 4 px in.
  // The bulb can show while Jump searches (the hint arrives), and Jump
  // narrows: the lightning is fitted again, so it never runs into the bulb.
  let fitted = '';
  // Mid strike it is not restarted (that would lose the strike); the
  // canvas is cut at the slash instead, in pixels, from Jump's size now.
  const fit = () => {
    const Wj = jump.offsetWidth, hj = jump.offsetHeight || 31;
    if (jumpSearch !== j || !Wj) return;
    const keyed = !!jump.parentElement?.querySelector('.nge-cm-bulb:not([hidden])');
    const key = `${Wj}${keyed}`;
    if (key === fitted) return;
    fitted = key;
    if (!j.ending) { cancelAnimationFrame(live.raf); startLoader(cv, live, Wj + (keyed ? 7 : 12), 20, 6); }
    cv.classList.toggle('nge-cm-jloader-keyed', keyed);
    if (!keyed) { cv.style.clipPath = ''; return; }
    const t0 = (hj - 20) / 2, sx = (y: number) => (Wj + 6 - 10 * ((t0 + y) / hj)).toFixed(1), pad = (Wj + 6 - 5 + 3.5).toFixed(1);
    cv.style.clipPath = `polygon(0 0,${sx(0)}px 0,${sx(7)}px 7px,${pad}px 7px,${pad}px 13px,${sx(13)}px 13px,${sx(20)}px 20px,0 20px)`;
  };
  fit();
  try { j.ro = new ResizeObserver(fit); j.ro.observe(jump); } catch { /* fitted once */ }
}
/** Found: the route lights, then the label is back. Not found: it stops. */
function finishJumpSearch(found: boolean) {
  const j = jumpSearch;
  if (!j) return;
  if (!found || !j.live.finish) { endJumpSearch(); return; }
  j.ending = true;
  j.live.finish(() => { if (jumpSearch === j) endJumpSearch(); });
}
function wirePlayBox(el: HTMLElement) {
  el.querySelector('.nge-cm-cellbtn')!.addEventListener('click', () => document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'mine' } })));
  el.querySelector('.nge-cm-hbtn')!.addEventListener('click', () => void pressHint(el, true));
  el.querySelector('.nge-cm-hint-btn')!.addEventListener('click', e => { e.stopPropagation(); void pressHint(el); });
  // The hint folds into a light bulb beside Jump; the bulb opens it, the
  // arrow folds it, and Pyr remembers. The bulb is there only with a hint,
  // still when a new one comes (Ames: "we don't need to pulse the hint").
  const hintLine = el.querySelector('.nge-cm-nudge') as HTMLElement;
  const hintMore = el.querySelector('.nge-cm-nudge-more') as HTMLElement;
  const bulb = el.querySelector('.nge-cm-bulb') as HTMLElement;
  const setHintOpen = (open: boolean) => {
    hintLine.classList.toggle('nge-cm-nudge-open', open);
    hintMore.setAttribute('aria-expanded', String(open)); hintMore.setAttribute('aria-label', 'Fold the hint'); hintMore.title = 'Fold the hint';
    bulb.setAttribute('aria-expanded', String(open));
    bulb.setAttribute('aria-label', open ? 'Hide the hint' : 'Show the hint'); bulb.title = bulb.getAttribute('aria-label')!;
  };
  const syncBulb = () => { bulb.hidden = hintLine.hidden; };
  new MutationObserver(syncBulb).observe(hintLine, { attributes: true, attributeFilter: ['hidden'] });
  syncBulb();
  let hintOpen = false;
  try { hintOpen = localStorage.getItem(HINT_OPEN_KEY) === '1'; } catch { /* folded */ }
  setHintOpen(hintOpen);
  const toggleHint = (open: boolean) => { setHintOpen(open); try { localStorage.setItem(HINT_OPEN_KEY, open ? '1' : '0'); } catch { /* this visit only */ } };
  hintMore.addEventListener('click', e => { e.stopPropagation(); toggleHint(false); });
  bulb.addEventListener('click', () => toggleHint(!hintLine.classList.contains('nge-cm-nudge-open')));
  for (const chip of el.querySelectorAll<HTMLElement>('.nge-cm-chip')) chip.addEventListener('click', () => startMarking(chip.dataset.mark || 'checked'));
  // Highlight folds away (Ames 2026-11-18: "this box is so big"), closed at
  // first; each player's choice is remembered.
  const markBox = el.querySelector('.nge-cm-mark') as HTMLElement;
  const markBtn = el.querySelector('.nge-cm-marktoggle') as HTMLElement;
  const setMarkOpen = (open: boolean) => { markBox.hidden = !open; markBtn.setAttribute('aria-expanded', String(open)); };
  let markOpen = false;
  try { markOpen = localStorage.getItem(MARK_OPEN_KEY) === '1'; } catch { /* closed */ }
  setMarkOpen(markOpen);
  markBtn.addEventListener('click', () => {
    const open = markBox.hidden;
    setMarkOpen(open);
    try { localStorage.setItem(MARK_OPEN_KEY, open ? '1' : '0'); } catch { /* this visit only */ }
  });
  el.querySelector('.nge-cm-mark-i')!.addEventListener('click', e => {
    const box = el.querySelector('.nge-cm-mark-info') as HTMLElement;
    box.hidden = !box.hidden;
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!box.hidden));
  });
  paintChips(el);
  watchMode(el);
  el.querySelector('.nge-cm-finish-jump')!.addEventListener('click', () => {
    cellAction('complete-cancel'); closeFinish(el);
    void pressHint(el, true);
  });
  el.querySelector('.nge-cm-saveview')!.addEventListener('click', () => cellAction('save'));
  const skipAsk = el.querySelector('.nge-cm-skipask') as HTMLElement;
  el.querySelector('.nge-cm-skipcell')!.addEventListener('click', () => {
    skipAsk.hidden = false;
    el.classList.add('nge-cm-asking');
    (el.querySelector('.nge-cm-skipask-no') as HTMLElement).focus();
  });
  el.querySelector('.nge-cm-skipask-no')!.addEventListener('click', () => { skipAsk.hidden = true; el.classList.remove('nge-cm-asking'); });
  // Typing a note must not reach the game's keyboard shortcuts.
  const skipNote = el.querySelector('.nge-cm-skipask-note') as HTMLTextAreaElement;
  for (const k of ['keydown', 'keyup', 'keypress']) skipNote.addEventListener(k, e => e.stopPropagation());
  el.querySelector('.nge-cm-skipask-yes')!.addEventListener('click', () => {
    skipAsk.hidden = true; el.classList.remove('nge-cm-asking');
    if (shownFor != null) moment(shownFor, 'skip', skipNote.value.trim());
    skipNote.value = '';
    removeHintLayers();
    cellAction('skip');
  });
  el.querySelector('.nge-cm-complete')!.addEventListener('click', () => openFinish(el));
  frameButton(el.querySelector('.nge-cm-hbtn') as HTMLElement);
  frameButton(el.querySelector('.nge-cm-complete') as HTMLElement);
  el.querySelector('.nge-cm-finish-back')!.addEventListener('click', () => { cellAction('complete-cancel'); closeFinish(el); });
  el.querySelector('.nge-cm-finish-check')!.addEventListener('click', () => cellAction('complete-check'));
  el.querySelector('.nge-cm-finish-how')!.addEventListener('click', e => {
    const tip = el.querySelector('.nge-cm-finish-tip') as HTMLElement;
    tip.hidden = !tip.hidden;
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!tip.hidden));
  });
  el.querySelector('.nge-cm-finish-soma')!.addEventListener('click', () => {
    (el.querySelector('.nge-cm-finish-tip') as HTMLElement).hidden = true;
    cellAction('complete-soma');
  });
  el.querySelector('.nge-cm-finish-addnote')!.addEventListener('click', e => {
    (e.currentTarget as HTMLElement).hidden = true;
    const t = el.querySelector('.nge-cm-finish-note') as HTMLTextAreaElement;
    t.hidden = false; t.focus();
  });
  // Typing a note must not reach the game's keyboard shortcuts.
  for (const k of ['keydown', 'keyup', 'keypress']) el.querySelector('.nge-cm-finish-note')!.addEventListener(k, e => e.stopPropagation());
  el.querySelector('.nge-cm-finish-go')!.addEventListener('click', () => {
    // Its note is kept with the moment: the Sandbox has no sheet to keep it.
    if (shownFor != null) moment(shownFor, 'complete', (el.querySelector('.nge-cm-finish-note') as HTMLTextAreaElement).value.trim());
    // The accuracy takes this cell in once its score is kept.
    setTimeout(() => void loadMine(true), 4000);
    removeHintLayers();
    cellAction('complete-submit', { notes: (el.querySelector('.nge-cm-finish-note') as HTMLTextAreaElement).value.trim() });
  });
}

// ── Marking from the box ────────────────────────────────────────────────────
const COME_BACK = { key: 'c_comeback', label: 'Come back', color: '#b48cff' };
/** The player's style for a chip: Checked is built in; Come back is added to
 *  their colors the first time (it stays, and can be recolored or removed in
 *  Highlight like any color they add). */
function markStyle(mark: string): { key: string; color: string } | null {
  try {
    const all = highlightStyles();
    if (mark === 'checked') return all.find(s => s.key === 'checked') ?? null;
    const have = all.find(s => s.key === COME_BACK.key || s.label.toLowerCase() === 'come back');
    if (have) return have;
    if (all.length >= MAX_HIGHLIGHT_STYLES) return all.find(s => s.key === 'look') ?? null;
    saveHighlightStyles([...all, { ...COME_BACK, layer: COME_BACK.label }]);
    return COME_BACK;
  } catch { return null; }
}
function paintChips(el: HTMLElement) {
  for (const chip of el.querySelectorAll<HTMLElement>('.nge-cm-chip')) {
    const mark = chip.dataset.mark || 'checked';
    let color = mark === 'checked' ? '#3dff9a' : COME_BACK.color;
    try { const s = highlightStyles().find(x => mark === 'checked' ? x.key === 'checked' : (x.key === COME_BACK.key || x.label.toLowerCase() === 'come back')); if (s) color = s.color; } catch { /* the default */ }
    const dot = chip.querySelector('i') as HTMLElement;
    dot.style.background = color; dot.style.boxShadow = `0 0 6px ${color}`;
  }
}
/** Leave Merge or Cut and open Highlight on this color. */
function startMarking(mark: string) {
  const style = markStyle(mark);
  try { exitGrapheneTool(); } catch { /* no tool on */ }
  (window as any).__ngeHighlightPick = style?.key ?? null;
  document.dispatchEvent(new CustomEvent('nge:open-highlight'));
  document.dispatchEvent(new CustomEvent('nge:highlight-style', { detail: { key: style?.key } }));
  const el = document.getElementById(CARD_ID);
  if (el) { paintChips(el); paintMode(el); }
}
function modeNow(): 'merge' | 'cut' | 'highlight' | 'look' {
  const k = activeGrapheneToolKind();
  if (k === 'merge') return 'merge';
  if (k === 'multicut') return 'cut';
  if (document.querySelector('.nge-hl-panel')) return 'highlight';
  return 'look';
}
const MODE_WORDS = { merge: 'Merging', cut: 'Cutting', highlight: 'Highlighting', look: 'Looking' } as const;
const MODE_TIPS = {
  merge: 'Merge is on: Ctrl+click two cells to join them.',
  cut: 'Cut is on: Ctrl+click points on each side of the cut.',
  highlight: 'Highlight is on: Ctrl+click two points to mark the branch between them. With Merge or Cut on, hold H and click.',
  look: 'Nothing is on: Ctrl+click does nothing to your cell.',
} as const;
/** Merge or Cut on from the box, as the M and C keys do; pressed again, off. */
function pressModeButton(tool: 'merge' | 'cut') {
  if (modeNow() === tool) { try { exitGrapheneTool(); } catch { /* none on */ } return; }
  try { exitGrapheneTool(); } catch { /* none on */ }
  activateGrapheneTool(tool === 'cut' ? 'multicut' : 'merge');
}
function paintMode(el: HTMLElement) {
  const pill = el.querySelector('.nge-cm-mode') as HTMLElement | null;
  if (!pill) return;
  const m = modeNow();
  el.querySelectorAll<HTMLElement>('.nge-cm-modebtn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === m)));
  if (pill.dataset.mode === m) return;
  pill.dataset.mode = m;
  el.dataset.mode = m;
  pill.textContent = MODE_WORDS[m];
  pill.title = MODE_TIPS[m];
}
let modeTimer: number | undefined;
function watchMode(el: HTMLElement) {
  window.clearInterval(modeTimer);
  modeTimer = window.setInterval(() => {
    if (!document.body.contains(el)) { window.clearInterval(modeTimer); return; }
    if (el.classList.contains('nge-cm-idle')) return;
    paintMode(el);
  }, 700);
}

// ── Sandbox accuracy, and Complete after a run of low scores ────────────────
/** A player's Sandbox accuracy (yours without an id), for the profile and the
 *  Cell complete card (Ames 2026-11-16). Null when it cannot be read. */
export function sandboxAccuracy(userId?: string | null): Promise<Mine | null> {
  return secureWrite<Mine>('match.mine', userId ? { userId } : {}).catch((e: any) => { console.debug('[cell-match] no accuracy', e?.message); return null; });
}
/** The Sandbox is the dataset on screen. */
export function sandboxOnScreen(): boolean {
  try { return canonicalDataset(currentDatasetTag()) === 'pinky_nf_v2'; } catch { return false; }
}
let mineInfo: Mine | null = null;
let mineAt = 0;
async function loadMine(force = false) {
  if (!force && Date.now() - mineAt < 5 * 60_000) { paintMine(); return; }
  mineAt = Date.now();
  try { mineInfo = await secureWrite<Mine>('match.mine', {}); } catch (e: any) { console.debug('[cell-match] no accuracy', e?.message); }
  paintMine();
}
function paintMine() {
  const el = document.getElementById(CARD_ID);
  const line = el?.querySelector('.nge-cm-acc') as HTMLElement | null;
  if (!line) return;
  const m = mineInfo;
  if (!m || !m.cells || m.accuracy == null) { line.hidden = true; return; }
  line.innerHTML = `Your Training Sim accuracy: <b>${m.accuracy}%</b> over ${plural(m.cells, 'sim cell')}`;
  line.title = 'The average match score of the sim cells you have completed, each at its last Complete';
  line.hidden = false;
}
/** Low scores in a row (Ames 2026-11-14: "if they complete >n cells with <y
 *  accuracy it makes them review what they did"): Complete waits until the
 *  player has jumped to what is left on this cell. */
function gated(): boolean {
  const m = mineInfo;
  if (!m || !m.reviewFirst || shownFor == null) return false;
  const r = last.get(shownFor);
  const score = r && r.scorable ? matchScore(r) : null;
  if (score == null || score >= m.lowScore) return false;
  return !((clocks.get(shownFor)?.jumps ?? 0) > 0);
}
function showGate(el: HTMLElement) {
  const p = el.querySelector('.nge-cm-finish-gate') as HTMLElement;
  const j = el.querySelector('.nge-cm-finish-jump') as HTMLElement;
  const on = gated();
  p.hidden = !on; j.hidden = !on;
  if (on && mineInfo) p.textContent = `Your last ${mineInfo.lowRun} sim cells finished under ${mineInfo.lowScore}%. Before you complete this one, Jump to what is left and have a look.`;
}

// ── The review after Complete ───────────────────────────────────────────────

/** Ask for the review before the cell is completed (the server reviews the
 *  player's own open claim), so it is ready when Complete is done. */
export function startReview(taskId: number): Promise<ReviewResult | null> {
  return secureWrite<ReviewResult>('match.review', { taskId }).catch((e: any) => {
    console.debug('[cell-match] no review', taskId, e?.message);
    return null;
  });
}

/** nm to the view's own units, axis by axis. */
function toView(nm: number[]): number[] | null {
  try {
    const cs = (window as any).viewer.coordinateSpace.value;
    const names: string[] = cs.names, scales = cs.scales;
    return ['x', 'y', 'z'].map((ax, i) => nm[i] / (scales[names.indexOf(ax)] * 1e9));
  } catch { return null; }
}
/** Save view in the review (Ames 2026-11-13): this view, with the missed
 *  pieces in gold and the pins, goes to My Links in the Cell Library, and a
 *  tip under the button says where it went. */
async function saveReviewView(btn: HTMLButtonElement, r: ReviewResult) {
  if (!deps?.saveLink || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Saving';
  const v: any = (window as any).viewer;
  // The whole view, never the page address: that is only a code for a view
  // kept in this browser (util/local_view.ts).
  const url = fullViewUrl();
  let position: [number, number, number] | undefined;
  try { const p = v.navigationState.position.value; position = [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]; } catch { /* no position */ }
  const shown: string[] = [];
  try { for (const id of currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments ?? []) shown.push(String(id)); } catch { /* none */ }
  const pct = (n: number | null | undefined) => (n == null ? 'none' : `${n}%`);
  savedTitle = practiceTitle(r.taskId);
  const id = await deps.saveLink({
    title: savedTitle,
    note: `Match score ${pct(matchScore(r))}. Merge ${pct(r.merge)}, Cut ${pct(r.cut)}. Missed pieces in gold, merged parts pinned.`,
    url, dataset: 'pinky_nf_v2', position, visibleSegments: shown,
  }).catch(() => null);
  if (!id) {
    btn.disabled = false;
    btn.textContent = 'Save view';
    savedTip(btn, false);
    return;
  }
  btn.textContent = 'Saved \u2713';
  savedTip(btn, true);
}

let savedTitle = '';
/** "My 3rd practice cell": the next number after the player's saved ones;
 *  the same cell saved again keeps its number. */
const PRACTICE_TITLE = /^My (\d+)(st|nd|rd|th) practice cell$/;
const titled = new Map<number, string>();
function ordinal(n: number) {
  const t = n % 100, o = n % 10;
  return `${n}${t >= 11 && t <= 13 ? 'th' : o === 1 ? 'st' : o === 2 ? 'nd' : o === 3 ? 'rd' : 'th'}`;
}
function practiceTitle(taskId: number): string {
  const had = titled.get(taskId);
  if (had) return had;
  let most = 0;
  for (const t of deps?.myLinkTitles?.() ?? []) { const m = PRACTICE_TITLE.exec(t.trim()); if (m) most = Math.max(most, Number(m[1])); }
  for (const t of titled.values()) { const m = PRACTICE_TITLE.exec(t); if (m) most = Math.max(most, Number(m[1])); }
  const title = `My ${ordinal(most + 1)} sim cell`;
  titled.set(taskId, title);
  return title;
}
function savedTip(btn: HTMLElement, ok: boolean) {
  document.getElementById(SAVED_ID)?.remove();
  const h = document.createElement('div');
  h.id = SAVED_ID;
  h.className = 'ng-extend nge-cm-tip';
  h.setAttribute('role', 'status');
  h.innerHTML = ok
    ? '<div class="nge-cm-tip-kicker">SAVED</div><div>Find this view in <b>My Links</b>, in the Cell Library.</div>'
      + '<div class="nge-cm-tip-row"><button type="button" class="nge-cm-tip-ok nge-cm-tip-open">Open My Links</button><button type="button" class="nge-cm-tip-ok nge-cm-tip-close">Got it</button></div>'
    : '<div class="nge-cm-tip-kicker">NOT SAVED</div><div>The view could not be saved. Try again in a moment.</div>'
      + '<div class="nge-cm-tip-row"><button type="button" class="nge-cm-tip-ok nge-cm-tip-close">Got it</button></div>';
  document.body.appendChild(h);
  const r = btn.getBoundingClientRect();
  h.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - h.offsetWidth - 8)))}px`;
  h.style.top = `${Math.round(r.bottom + 12)}px`;
  h.querySelector('.nge-cm-tip-close')?.addEventListener('click', () => h.remove());
  h.querySelector('.nge-cm-tip-open')?.addEventListener('click', () => {
    h.remove();
    void guideToLinks(savedTitle);
  });
}

// ── The way to My Links, shown (Ames 2026-11-13: "animate highlight cell
// library, click to expand, click to My Links and then show here") ─────────
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const visible = (e: Element | null): e is HTMLElement => !!e && (e as HTMLElement).getBoundingClientRect().width > 0;
async function waitFor(find: () => HTMLElement | null, ms: number): Promise<HTMLElement | null> {
  for (let t = 0; t < ms; t += 100) { const e = find(); if (visible(e)) return e; await sleep(100); }
  return null;
}
/** A glowing ring on an element with a label under it, for `ms`. */
async function ring(target: HTMLElement, label: string, ms: number) {
  document.getElementById(GUIDE_ID)?.remove();
  const g = document.createElement('div');
  g.id = GUIDE_ID;
  g.className = 'ng-extend';
  g.innerHTML = `<div class="nge-cm-guide-ring"></div><div class="nge-cm-guide-label">${label}</div>`;
  document.body.appendChild(g);
  const box = g.firstElementChild as HTMLElement, tag = g.lastElementChild as HTMLElement;
  const follow = () => {
    if (!g.isConnected) return;
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 5}px`, top: `${r.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
    tag.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - tag.offsetWidth - 8)))}px`;
    tag.style.top = `${Math.round(r.bottom + 10)}px`;
    requestAnimationFrame(follow);
  };
  follow();
  await sleep(ms);
  g.remove();
}
async function guideToLinks(title: string) {
  ensureStyle();
  const panel = () => document.querySelector('.nge-cl-panel') as HTMLElement | null;
  // While guiding, the slim row shows even with the box on screen.
  document.body.classList.add('nge-cm-guiding');
  try {
  // 1. The Cell Library button in the top bar, pressed (only when the library
  // is not open at all: pressed when open, it closes it).
  const btn = document.querySelector('#extensionBar [data-icon-id="cells"]') as HTMLElement | null;
  if (visible(btn)) {
    await ring(btn, 'Cell Library', 1300);
    if (!panel()) btn.click();
  }
  if (!panel()) document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: {} }));
  if (!await waitFor(panel, 5000)) return;
  // 2. Slim: Full view.
  const full = document.querySelector('.nge-cl-panel .nge-cl-slim-expand') as HTMLElement | null;
  if (visible(full)) { await ring(full, 'Full view', 1300); full.click(); await sleep(700); }
  // 3. The My Links tab.
  const tab = await waitFor(() => document.querySelector('.nge-cl-panel .nge-cl-links-tab'), 3000);
  if (!tab) { document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'links' } })); return; }
  await ring(tab, 'My Links', 1300);
  tab.click();
  // 4. The saved view.
  const row = await waitFor(() => {
    const t = [...document.querySelectorAll<HTMLElement>('.nge-cl-panel .nge-cl-link-title')].find(e => e.textContent?.trim() === title);
    return (t?.closest('.nge-cl-link-item') as HTMLElement | null) ?? null;
  }, 4000);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await sleep(400);
  await ring(row, title, 4000);
  } finally { document.body.classList.remove('nge-cm-guiding'); }
}

function flyTo(nm: number[]) {
  const p = toView(nm);
  if (!p) return;
  try {
    const v = (window as any).viewer;
    const cur: Float32Array = v.navigationState.position.value;
    const next = Float32Array.from(cur);
    p.forEach((x, i) => { next[i] = x; });
    v.navigationState.position.value = next;
  } catch { /* the view stays put */ }
}

// neuroglancer packs a colour as 0xBBGGRR: GOLD (#ffd36e).
const GOLD_PACKED = 0x6ed3ff;
/** The player's cell while gold pieces are on screen: blue, so a cell that
 *  happens to be gold never hides them (Ames 2026-11-16). #3d9bff, packed. */
const CELL_BLUE_PACKED = 0xff9b3d;
let cellTint: { root: string; had: boolean; prev: Uint64 } | null = null;
function segColors(): any {
  return currentSegLayer()?.layer?.displayState?.segmentationColorGroupState?.value?.segmentStatedColors;
}
/** Paint the player's cell blue; its own color comes back with untintCell. */
function tintCellBlue(root: string | undefined | null) {
  if (!root || cellTint?.root === root) return;
  untintCell();
  try {
    const colors = segColors();
    if (!colors) return;
    const seg = Uint64.parseString(root);
    const prev = new Uint64();
    const had = !!colors.get(seg, prev);
    setStatedColor(colors, seg, CELL_BLUE_PACKED);
    cellTint = { root, had, prev };
  } catch (e) { console.debug('[cell-match] cell tint', e); }
}
function untintCell() {
  const t = cellTint;
  cellTint = null;
  if (!t) return;
  try {
    const colors = segColors();
    if (!colors) return;
    const seg = Uint64.parseString(t.root);
    colors.delete(seg);
    if (t.had) colors.set(seg, t.prev);
  } catch (e) { console.debug('[cell-match] cell untint', e); }
}
let hintShown: { root: string; wasVisible: boolean } | null = null;
function removeHintLayers() {
  if (!reviewing) untintCell();
  // The gold piece leaves the player's layer again, unless it was there before
  // (once merged it is part of their cell, under the cell's own id).
  if (hintShown) {
    try {
      const layer = currentSegLayer()?.layer;
      const seg = Uint64.parseString(hintShown.root);
      const colors = layer?.displayState?.segmentationColorGroupState?.value?.segmentStatedColors;
      try { colors?.delete(seg); } catch { /* keeps it */ }
      if (!hintShown.wasVisible) layer?.displayState?.segmentationGroupState?.value?.visibleSegments.delete(seg);
    } catch { /* gone */ }
    hintShown = null;
  }
  const v = (window as any).viewer;
  for (const ml of [...(v?.layerManager?.managedLayers ?? [])]) {
    if (ml.name === HINT_SEG_LAYER || ml.name === HINT_PIN_LAYER) { try { dropLayer(v, ml); } catch { /* gone */ } }
  }
  pinGlow(null);
}

/** The Jump pin breathes (Ames 2026-11-18: "no animation of the annotation
 *  point!"): a soft glow in the pin's color around it in 3D, as the tour's
 *  synapse marker, a steady size on screen. It stops with the pin. */
let pinGlowRaf = 0;
function pinGlow(nm: number[] | null, hex = '#7fd8ff') {
  cancelAnimationFrame(pinGlowRaf);
  pinGlowRaf = 0;
  setNgeGlow(null, 'cell-match-pin');
  const v = (window as any).viewer;
  const unit = toView([1, 1, 1]);
  if (!nm || !v || !unit) return;
  const per = unit.map(u => 1 / u) as [number, number, number];
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const glow: NgeGlow = { positions: Float32Array.from(toView(nm)!), colors: new Float32Array(4), sizesNm: new Float32Array(1), count: 1, nmRight: [unit[0], 0, 0] };
  const t0 = performance.now();
  const step = (now: number) => {
    if (!(v.layerManager?.managedLayers ?? []).some((ml: any) => ml.name === HINT_PIN_LAYER)) { pinGlow(null); return; }
    const k = 0.5 + 0.5 * Math.sin((now - t0) / 1000 * 3.2);
    let across = 40_000;
    try { across = v.projectionScale.value * Math.min(...per); } catch { /* a guess */ }
    glow.colors.set([rgb[0], rgb[1], rgb[2], 0.55 + 0.45 * k]);
    glow.sizesNm[0] = Math.min(4000, across * 0.04) * (0.7 + 0.45 * k);
    const cam = cameraAxes(per);
    if (cam) {
      glow.nmRight = [cam.right[0] * unit[0], cam.right[1] * unit[1], cam.right[2] * unit[2]];
      // A little toward the viewer, so the membrane it sits on does not cut it in half.
      for (let a = 0; a < 3; a++) glow.positions[a] = (nm[a] + cam.toEye[a] * 2400) * unit[a];
    }
    setNgeGlow(glow, 'cell-match-pin');
    try { v.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    pinGlowRaf = requestAnimationFrame(step);
  };
  pinGlowRaf = requestAnimationFrame(step);
}
/** For headless checks: is the Jump pin glowing. */
(window as any).__ngeCellMatchPinGlow = () => pinGlowRaf !== 0;
function removeReviewLayers() {
  untintCell();
  const v = (window as any).viewer;
  for (const ml of [...(v?.layerManager?.managedLayers ?? [])]) {
    if (ml.name === MISSED_LAYER || ml.name === MERGERS_LAYER) { try { dropLayer(v, ml); } catch { /* gone */ } }
  }
}
let pinsTimer: number | undefined;
function addReviewLayers(r: ReviewResult) {
  const v = (window as any).viewer;
  if (!v?.layerSpecification) return;
  removeReviewLayers();
  removeHintLayers();
  const missed = r.missed ?? [];
  if (missed.length) tintCellBlue(r.root);
  if (missed.length) {
    const colors = Object.fromEntries(missed.map(p => [p.root, GOLD]));
    try { v.layerSpecification.add(makeLayer(v.layerSpecification, MISSED_LAYER, { type: 'segmentation', source: SANDBOX_SOURCE, segments: missed.map(p => p.root), segmentColors: colors, objectAlpha: 1 })); }
    catch (e) { console.debug('[cell-match] missed layer', e); }
  }
  const pins = (r.mergers ?? []).map((m, i) => ({ type: 'point', id: `m${i}`, point: toView(m.pointNm), description: `Merger left, ${m.size.toLocaleString('en-US')} supervoxels` })).filter(a => a.point);
  if (!pins.length) return;
  // A new annotation layer takes points only once it knows the view's space:
  // put them back while they are short (as the test review does).
  const place = () => {
    for (const ml of [...(v.layerManager?.managedLayers ?? [])]) if (ml.name === MERGERS_LAYER) dropLayer(v, ml);
    try { v.layerSpecification.add(makeLayer(v.layerSpecification, MERGERS_LAYER, { type: 'annotation', source: { url: 'local://annotations' }, annotationColor: RED, pointSize: 3, annotations: pins })); }
    catch (e) { console.debug('[cell-match] mergers layer', e); }
  };
  place();
  window.clearInterval(pinsTimer);
  let tries = 0;
  pinsTimer = window.setInterval(() => {
    const ml = (v.layerManager?.managedLayers ?? []).find((x: any) => x.name === MERGERS_LAYER);
    let n = -1;
    try { n = ml?.layer?.localAnnotations ? ml.layer.localAnnotations.toJSON().length : -1; } catch { /* loading */ }
    if (!reviewing || n === pins.length || ++tries > 10) { window.clearInterval(pinsTimer); return; }
    if (tries > 1) place();
  }, 700);
}

/**
 * Complete and Review: show what was missed, and wait. Resolves 'next' when
 * the player asks for the next cell, 'stay' when they close the review and
 * stay with this one. With nothing to review (no true cell, or the review
 * could not be had) it resolves 'next' at once, and Complete goes on as before.
 */
export async function showReview(_taskId: number, pending: Promise<ReviewResult | null>, playing: boolean): Promise<'next' | 'stay'> {
  reviewing = true;
  removeChip();
  const el = card();
  el.classList.add('nge-cm-reviewing');
  el.classList.add('nge-cm-checking');
  (el.querySelector('.nge-cm-title') as HTMLElement).textContent = 'Review';
  (el.querySelector('.nge-cm-state') as HTMLElement).textContent = 'Scoring';
  place(el);
  const r = await pending;
  if (!r || !r.scorable || (r.merge === undefined && r.cut === undefined)) {
    reviewing = false;
    hide();
    return 'next';
  }
  el.classList.remove('nge-cm-checking');
  (el.querySelector('.nge-cm-state') as HTMLElement).textContent = 'Final';
  showScore(el, r, true);
  showRow(el, r, 'merge', true);
  showRow(el, r, 'cut', true);
  ping(el);
  addReviewLayers(r);
  const missed = r.missed ?? [], mergers = r.mergers ?? [];
  const extra = el.querySelector('.nge-cm-extra') as HTMLElement;
  extra.innerHTML = '<div class="nge-cm-sep"></div>';
  const line = (color: string, label: string, text: string, tip: string, list: { pointNm: number[] }[]) => {
    const row = document.createElement('div');
    row.className = 'nge-cm-line';
    row.title = tip;
    row.innerHTML = `<span class="nge-cm-swatch" style="background:${color};box-shadow:0 0 6px ${color}"></span><b style="color:${color}">${label}</b><span></span>`;
    (row.lastElementChild as HTMLElement).textContent = text;
    if (list.length) {
      let i = 0;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nge-cm-btn';
      b.textContent = list.length > 1 ? `Show 1 of ${list.length}` : 'Show';
      b.addEventListener('click', () => {
        flyTo(list[i].pointNm);
        b.textContent = list.length > 1 ? `Show ${((i + 1) % list.length) + 1} of ${list.length}` : 'Show';
        i = (i + 1) % list.length;
      });
      row.appendChild(b);
    }
    extra.appendChild(row);
  };
  if (!missed.length && !mergers.length) {
    const clean = document.createElement('div');
    clean.className = 'nge-cm-clean';
    clean.textContent = 'Nothing missed. Clean cell.';
    extra.appendChild(clean);
  } else {
    if (missed.length) line(GOLD, 'Missed', plural(missed.length, 'piece'), 'Pieces of the cell you did not merge in, drawn in gold in the 3D view', missed);
    if (mergers.length) line(RED, 'Merged', plural(mergers.length, 'part'), 'Parts of other cells still merged into yours, each marked with a pin', mergers);
  }
  const actions = document.createElement('div');
  actions.className = 'nge-cm-actions';
  extra.appendChild(actions);
  return new Promise(resolve => {
    const end = (choice: 'next' | 'stay') => {
      removeReviewLayers();
      window.clearInterval(pinsTimer);
      document.getElementById(SAVED_ID)?.remove();
      reviewing = false;
      extra.innerHTML = '';
      (el.querySelector('.nge-cm-title') as HTMLElement).innerHTML = TITLE_HTML;
      el.classList.remove('nge-cm-reviewing');
      el.remove();
      shownFor = null;
      onScreen = null;
      resolve(choice);
    };
    const stay = document.createElement('button');
    stay.type = 'button';
    stay.className = 'nge-cm-btn nge-cm-quiet';
    stay.textContent = 'Close';
    stay.title = 'Close the review and stay with this cell';
    stay.addEventListener('click', () => end('stay'));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'nge-cm-btn nge-cm-go';
    next.textContent = playing ? 'Next cell' : 'Done';
    next.addEventListener('click', () => end('next'));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'nge-cm-btn nge-cm-quiet nge-cm-save';
    save.textContent = 'Save view';
    save.title = 'Save this view, with the missed pieces and pins, to My Links in the Cell Library';
    save.addEventListener('click', () => { void saveReviewView(save, r); });
    actions.append(save, stay, next);
    next.focus();
  });
}

/** The claim's own listed IDs (from the sheet, or an older view) are old
 *  versions of the cell: on screen next to the current one, the cell showed
 *  twice, as it is and as it was (Ames 2026-11-17: "Do you see the two
 *  segments in view? They're the same cell", 648518346352170608 last current
 *  on Nov 14). Swapped for the current ID whenever they appear. */
const outdated = new Map<string, boolean>();
/** `old:live` → is that old ID the live cell now. */
const becomes = new Map<string, boolean>();
const lookedUp = new Map<string, number>();
let swapping = false;
async function swapOldIds(taskId: number) {
  const live = last.get(taskId)?.root;
  if (!live || !deps || swapping) return;
  const claim = deps.claims().find(c => c.id === taskId);
  const group = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value;
  const vis = group?.visibleSegments;
  if (!claim || !vis) return;
  // Any old ID on screen that is the cell now, not only the claim's own: after
  // a cut, the cell's ID from before stayed on screen over the new one and
  // looked like the finished cell (Ames 2026-11-18, task 16780: 596200 over
  // 100509, which differ by 21 supervoxels). A piece cut off is not the cell
  // now, so it is never swapped in.
  let shown: string[];
  try {
    shown = [...vis].map(String).filter(id => /^\d+$/.test(id) && id !== live && outdated.get(id) !== false
      && becomes.get(`${id}:${live}`) !== false && Uint64.parseString(id).high >>> 24 !== 1);
  } catch { return; }
  if (!shown.length) return;
  swapping = true;
  try {
    // Only an ID CAVE says is out of date, and only for a current one: right
    // after an edit the claim can hold the new ID before the box's reading has
    // it, and that must never be swapped for the older one.
    const ask = [live, ...shown].filter(id => !outdated.has(id) || id === live);
    if (ask.length) {
      const got = await isLatestRoots(ask);
      for (const id of ask) if (got?.has(id)) outdated.set(id, got.get(id) === false);
    }
    if (outdated.get(live) !== false) { outdated.delete(live); return; }
    if (last.get(taskId)?.root !== live) return;
    const now = Uint64.parseString(live);
    for (const id of shown) {
      if (outdated.get(id) !== true) continue;
      if (!claim.roots.includes(id)) {
        const k = `${id}:${live}`;
        if (!becomes.has(k) && (lookedUp.get(k) ?? 0) < Date.now() - 30_000) {
          lookedUp.set(k, Date.now());
          const ends = await currentIdsOf(id).catch(() => null);
          // A lookup that failed is asked again, half a minute later.
          if (ends) becomes.set(k, ends.includes(live));
        }
        if (!becomes.get(k) || last.get(taskId)?.root !== live) continue;
      }
      const old = Uint64.parseString(id);
      if (!vis.has(old)) continue;
      const wasSelected = !!group.selectedSegments?.has(old);
      vis.delete(old);
      group.selectedSegments?.delete(old);
      vis.add(now);
      if (wasSelected) group.selectedSegments?.add(now);
      console.debug('[cell-match] old ID of the cell on screen', id, 'swapped for', live);
    }
  } catch (e) { console.debug('[cell-match] swap old IDs', e); }
  finally { swapping = false; }
}

function tick() {
  const el = document.getElementById(CARD_ID);
  if (el) place(el);
  const b = document.getElementById(CHIP_ID);
  if (b) place(b);
  if (reviewing) return;
  const id = claimOnScreen();
  if (id == null) {
    onScreen = null;
    if (onSandbox()) idle('Standby', standbyNote(), true); else hide();
    return;
  }
  maybeOfferHint(id);
  void swapOldIds(id);
  // Play back on, on the cell Stop hid the box from: show it again.
  if (stoppedOn != null && isPlaying()) { if (stoppedOn === onScreen) onScreen = null; stoppedOn = null; }
  if (id === onScreen) return;
  onScreen = id;
  noteOpened(id);
  if (onSandbox()) splitOnce(id);
  const r = last.get(id);
  if (r) show(id, r, false);
  void ask(id);
}

export function startSandboxMatch(d: Deps) {
  if (deps) { deps = d; return; }
  deps = d;
  window.addEventListener('nge-graph-edit', ((e: CustomEvent) => {
    if (reviewing) return;
    const det = e.detail || {};
    if (det.kind !== 'merge' && det.kind !== 'split') return;
    const id = onScreen ?? claimOnScreen();
    if (id == null) return;
    const roots: string[] = Array.isArray(det.roots) ? det.roots.map(String) : [];
    if (roots.length) aliases.set(id, new Set([...(aliases.get(id) ?? []), ...roots]));
    noteEdit(id);
    if (editTimer) clearTimeout(editTimer);
    // Done at once, but not yet judged: plain until the reading says good or wrong.
    editKind = det.kind;
    doneText = det.kind === 'split' ? 'Cut complete' : 'Merge complete';
    doneTone = 'plain';
    doneUntil = Date.now() + DONE_MS;
    show(id, last.get(id), true);
    const shown = document.getElementById(CARD_ID);
    if (shown) ping(shown);
    flash(doneText, 'plain', DONE_MS);
    editTimer = setTimeout(() => { editTimer = null; onScreen = id; void ask(id); }, EDIT_WAIT_MS);
  }) as EventListener);
  document.addEventListener('nge:cm-cell-state', onCellState);
  document.addEventListener('nge:cm-library-ready', () => { libraryUp = true; toldShown = undefined; tellShown(shownFor); sendPending(); });
  document.addEventListener('nge:cm-library-gone', () => { libraryUp = false; });
  setInterval(() => { if (!document.hidden) { tick(); syncOwns(); } }, 2000);
  // Right after a page load, often, so the Cell Library's row never shows first.
  let early = 0;
  const fast = window.setInterval(() => { syncOwns(); if (++early >= 40) window.clearInterval(fast); }, 250);
}

/** For headless checks. */
// Stop playing: the box goes at once (Ames 2026-11-17: "it kept the match
// score box behind the start playing"; it went only on a refresh). A tick
// later, so the Cell Library, hearing the same stop, still sees the box own it.
document.addEventListener('nge:play-stopped', () => {
  if (canonicalDataset(currentDatasetTag()) !== 'pinky_nf_v2') return;
  // It keeps which cell it hid, so Start playing on that same cell shows it
  // again (Ames 2026-11-17: "i hit start playing and the training sim box
  // disappeared": the cell counted as already on screen).
  window.setTimeout(() => { if (!isPlaying()) { hide(); stoppedOn = onScreen; syncOwns(); } }, 0);
});
// The Play button setting changed: the box goes, or comes back.
document.addEventListener('nge:play-pref', () => {
  if (playOff()) { hide(); syncOwns(); return; }
  if (!isClosed() && onScreen != null) show(onScreen, last.get(onScreen), !last.get(onScreen));
});
if (isClosed()) document.body.classList.add('nge-cm-closed');
(window as any).__ngeCellMatch = { loading: () => idle('', READY_NOTE), loaded: () => { const id = shownFor ?? onScreen; const r = id != null ? last.get(id) : undefined; if (id != null && r) show(id, r, false); }, setSaveLink: (f: Deps['saveLink']) => { if (deps) deps.saveLink = f; }, judgeEdit, closeCard, openCard, show: (id: number, r: MatchResult) => { onScreen = id; noteResult(id, r); show(id, r, false); }, hide, rowPieces, progressLine, matchScore, hasReview, startReview, showReview, ageHintClock: (id: number, ms: number) => { const c = clocks.get(id); if (c) { c.opened -= ms; c.lastEdit -= ms; } }, setMine: (m: Mine | null) => { mineInfo = m; mineAt = Date.now(); paintMine(); }, withClaims: (f: Deps['claims']) => { if (deps) deps.claims = f; }, setReading };
