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
import { secureWrite } from './secure_write';
import { canonicalDataset, currentDatasetTag, currentSegLayer } from './datasets';
import { Uint64 } from 'neuroglancer/util/uint64';
import { makeLayer } from 'neuroglancer/layer';
import { reactive, createApp, type App as VueApp } from 'vue';
import { setStatedColor } from './widgets/widget_utils';
import { openSplitView } from './practice';
import { getActivePinia } from 'pinia';
import EditableText from './components/EditableText.vue';
// The Cell Library's own neuron (Ames 2026-11-14: "use the neuron").
import neuronIcon from '../static/badges/pyr/neuron-icon-white.png';

export interface SandboxClaim { id: number; dataset: string; roots: string[] }
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
}
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
function standbyNote(): string { return isPlaying() ? 'Your cell is not on screen' : 'Press Play for a practice cell'; }
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
  const moves = [rowMove(prev.merge, now.merge), rowMove(prev.cut, now.cut), leftMove(prev.missing, now.missing), leftMove(prev.extra, now.extra)];
  if (moves.some(m => m < 0)) return { text: `Wrong ${word}`, tone: 'bad' };
  if (moves.some(m => m > 0)) return { text: `Good ${word}`, tone: 'good' };
  return { text: 'No change', tone: 'plain' };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
// Named for what you do (Ames 2026-11-13: "Missing" and "Mergers" were confusing).
const ROW_LABEL: Record<Row, string> = { merge: 'Merge', cut: 'Cut' };
const ROW_SHORT: Record<Row, string> = { merge: 'M', cut: 'C' };
// Ames 2026-11-13: "Playing: Practice Cell" over one Match Score.
const TITLE_HTML = '<span class="nge-cm-pre">Playing: </span>Practice';
// Merge and Cut together, half each, so it starts at 0 (Ames 2026-11-13:
// "match score should start at 0"). By total size, one big merger cut off read
// 90% with every thin missing piece still missed ("I got 90% and missed everything").
const scoreTip = (pct: number | null | undefined) => `Match score${pct == null ? '' : ` ${pct}%`}: your Merge and Cut together, half each`;
/** The match score: Merge and Cut averaged (only the ones this cell has). */
export function matchScore(r: MatchResult): number | null {
  const parts = [r.merge, r.cut].filter((n): n is number => n != null);
  return parts.length ? Math.floor(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
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
  if (pct == null) return row === 'merge' ? 'nothing to merge' : 'nothing to cut';
  if (!p || !p.total) return row === 'merge' ? 'part of the cell was cut off' : 'an error was merged in';
  return row === 'merge' ? `${p.total - p.left} of ${plural(p.total, 'piece')} merged in` : `removed ${p.total - p.left} of ${plural(p.total, 'error')}`;
}

/** Cells the HUD scores: their Complete says "Complete and Review" (reactive,
 *  for the Cell Library's buttons). */
const reviewable = reactive(new Set<number>());
export function hasReview(taskId: number | null | undefined): boolean {
  return taskId != null && reviewable.has(taskId);
}
function noteResult(taskId: number, r: MatchResult) {
  last.set(taskId, r);
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
  return mine.find(shown)?.id ?? null;
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
  box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 22px rgba(74,158,255,.14);backdrop-filter:blur(6px);overflow:hidden;pointer-events:auto}
#${CARD_ID}::after{content:'';position:absolute;left:0;right:0;top:-30%;height:30%;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,transparent,rgba(127,216,255,.16),transparent)}
#${CARD_ID}.nge-cm-ping::after{animation:nge-cm-sweep .9s ease-out 1}
@keyframes nge-cm-sweep{0%{top:-30%;opacity:1}100%{top:110%;opacity:0}}
@media (prefers-reduced-motion:reduce){#${CARD_ID}.nge-cm-ping::after{animation:none}}
#${CARD_ID} .nge-cm-head{display:flex;align-items:center;gap:6px;margin:-11px -14px 6px;padding:11px 14px 4px;cursor:grab;touch-action:none;user-select:none;font:600 11.5px/1 Orbitron,Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#7fc8ff}
#${CARD_ID} .nge-cm-dot{width:8px;height:8px;border-radius:50%;background:#59e3a7;box-shadow:0 0 6px #59e3a7}
#${CARD_ID}.nge-cm-dragging .nge-cm-head{cursor:grabbing}
#${CARD_ID}.nge-cm-checking .nge-cm-dot{background:#7fc8ff;box-shadow:0 0 6px #7fc8ff}
#${CARD_ID} .nge-cm-title{white-space:nowrap;letter-spacing:.08em;min-width:0;overflow:hidden;text-overflow:ellipsis}
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
#${CARD_ID} .nge-cm-info textarea{cursor:text}
#${CARD_ID}.nge-cm-showinfo .nge-cm-info{display:block}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-state,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-label,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-read,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-pieces,
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-info{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-head{margin-bottom:2px}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-row{padding:2px 0;grid-template-columns:16px 1fr;align-items:center}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing){width:240px}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-i{margin-left:auto}
#${CARD_ID} .nge-cm-short{display:none;font:600 11px/1 Orbitron,Inter,sans-serif;color:#8fb6dc}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-short{display:block}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-gauge{grid-column:2;margin:0}
#${CARD_ID}.nge-cm-idle .nge-cm-pieces{color:#8fb6dc}
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
#${CARD_ID} .nge-cm-cellbtn{order:-1;margin-right:2px;display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid rgba(127,190,255,.35);border-radius:6px;background:rgba(127,190,255,.08);color:#bfe6ff}
/* The light that was a dot is now the icon's box: green playing, blue checking, red when an edit went the wrong way. */
#${CARD_ID} .nge-cm-cellbtn{border:1.5px solid #59e3a7;box-shadow:0 0 7px rgba(89,227,167,.45),inset 0 0 6px rgba(89,227,167,.15)}
#${CARD_ID}.nge-cm-checking .nge-cm-cellbtn{border-color:#7fc8ff;box-shadow:0 0 7px rgba(127,200,255,.45)}
#${CARD_ID}.nge-cm-bad .nge-cm-cellbtn{border-color:#ff6b8a;box-shadow:0 0 8px rgba(255,107,138,.5)}
#${CARD_ID}.nge-cm-idle .nge-cm-cellbtn{border-color:rgba(127,190,255,.35);box-shadow:none}
#${CARD_ID} .nge-cm-cellbtn:hover{background:rgba(127,190,255,.2);color:#fff}
/* Hint, as a small H (Ames 2026-11-14: "a little H button ... if I hover says click for a Hint"). */
#${CARD_ID} .nge-cm-hbtn{border-color:rgba(127,216,255,.6) !important;background:rgba(74,158,255,.18) !important;color:#bfeaff !important;animation:nge-cm-hglow 2.6s ease-in-out infinite}
#${CARD_ID} .nge-cm-hbtn[hidden]{display:none}
#${CARD_ID} .nge-cm-hbtn:hover{background:rgba(74,158,255,.4);color:#fff}
@keyframes nge-cm-hglow{50%{box-shadow:0 0 10px rgba(127,216,255,.55)}}
@media (prefers-reduced-motion:reduce){#${CARD_ID} .nge-cm-hbtn{animation:none}}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-hbtn,#${CARD_ID}.nge-cm-idle .nge-cm-hbtn,#${CARD_ID}.nge-cm-reviewing .nge-cm-hbtn,#${CARD_ID}.nge-cm-finishing .nge-cm-hbtn{display:none}
#${CARD_ID} .nge-cm-cellimg{width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 0 3px rgba(79,207,255,.5))}
#${CARD_ID} .nge-cm-cellid{margin:-4px 0 8px;font:12px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#a9c3e0}
#${CARD_ID} .nge-cm-nudge{display:flex;align-items:center;gap:9px;margin:2px 0 9px;padding:8px 9px;border:1px solid rgba(127,216,255,.55);border-radius:8px;background:rgba(127,216,255,.08);box-shadow:0 0 14px rgba(127,216,255,.16)}
#${CARD_ID} .nge-cm-nudge[hidden]{display:none}
#${CARD_ID} .nge-cm-nudge svg{flex:0 0 auto}
#${CARD_ID} .nge-cm-nudge-text{flex:1 1 auto;font-size:13px;line-height:1.35;color:#d6e2f5}
#${CARD_ID} .nge-cm-nudge .nge-cm-btn{margin-left:0;flex:0 0 auto;border-color:#7fd8ff;background:rgba(74,158,255,.3);color:#fff}
#${CARD_ID} .nge-cm-play{display:flex;gap:6px;align-items:center;margin-top:8px;padding-top:9px;border-top:1px solid rgba(127,190,255,.18)}
#${CARD_ID} .nge-cm-play .nge-cm-btn{margin-left:0}
#${CARD_ID} .nge-cm-btn[hidden]{display:none}
#${CARD_ID} .nge-cm-play .nge-cm-btn,#${CARD_ID} .nge-cm-finish-actions .nge-cm-btn,#${CARD_ID} .nge-cm-nudge .nge-cm-btn{padding:7px 10px;border-radius:6px;font:600 12.5px/1 Inter,system-ui,sans-serif;letter-spacing:0;text-transform:none;white-space:nowrap}
#${CARD_ID} .nge-cm-play .nge-cm-complete,#${CARD_ID} .nge-cm-finish-go{margin-left:auto;border-color:#3eecbe;background:rgba(20,110,80,.55);color:#eafff7}
#${CARD_ID} .nge-cm-play .nge-cm-complete:hover,#${CARD_ID} .nge-cm-finish-go:hover:not(:disabled){background:rgba(24,140,100,.7)}
#${CARD_ID} .nge-cm-btn:disabled{opacity:.5;cursor:default}
#${CARD_ID}.nge-cm-idle .nge-cm-play,#${CARD_ID}.nge-cm-idle .nge-cm-cellid,#${CARD_ID}.nge-cm-idle .nge-cm-nudge,#${CARD_ID}.nge-cm-reviewing .nge-cm-play,#${CARD_ID}.nge-cm-reviewing .nge-cm-nudge,#${CARD_ID}.nge-cm-reviewing .nge-cm-cellid{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-saveview,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-skipcell,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-cellid{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-nudge{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing){height:auto !important;resize:horizontal}
#${CARD_ID} .nge-cm-nudge-btns{display:flex;flex-direction:column;gap:5px;flex:0 0 auto}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-play{margin-top:6px;padding-top:7px}
#${CARD_ID}.nge-cm-finishing .nge-cm-play,#${CARD_ID}.nge-cm-finishing .nge-cm-nudge,#${CARD_ID}.nge-cm-finishing .nge-cm-row[data-row="merge"],#${CARD_ID}.nge-cm-finishing .nge-cm-row[data-row="cut"]{display:none}
#${CARD_ID} .nge-cm-viewnote{margin-top:6px;font-size:11.5px;line-height:1.4;color:#8fa6c4}
#${CARD_ID} .nge-cm-viewnote:empty{display:none}
#${CARD_ID}.nge-cm-idle .nge-cm-viewnote,#${CARD_ID}.nge-cm-reviewing .nge-cm-viewnote,#${CARD_ID}.nge-cm-finishing .nge-cm-viewnote,#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-viewnote{display:none}
#${CARD_ID} .nge-cm-skipask{margin-top:8px;padding:10px;border:1px solid rgba(255,138,158,.5);border-radius:8px;background:rgba(255,107,138,.08)}
#${CARD_ID} .nge-cm-skipask[hidden]{display:none}
#${CARD_ID} .nge-cm-skipask-words{margin:0 0 4px;font-size:13px;line-height:1.45;color:#e6edf7}
#${CARD_ID} .nge-cm-skipask .nge-cm-finish-actions{border-top:none;padding-top:4px}
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
#${CARD_ID} .nge-cm-finish-actions{display:flex;gap:6px;align-items:center;padding-top:8px;border-top:1px solid rgba(127,190,255,.18)}
#${CARD_ID} .nge-cm-finish-actions .nge-cm-btn{margin-left:0}
#${CARD_ID} .nge-cm-finish-actions .nge-cm-finish-go{margin-left:auto}
#${CARD_ID} .nge-cm-row[data-row="merge"]{margin-top:2px;border-top:1px solid rgba(127,190,255,.18);padding-top:7px}
#${CARD_ID} .nge-cm-row[data-row="merge"],#${CARD_ID} .nge-cm-row[data-row="cut"]{grid-template-columns:58px 1fr auto;align-items:baseline}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-gauge,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-gauge{grid-column:1/-1;grid-row:2;height:4px;margin:4px 0 7px}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-fill,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-fill{box-shadow:none;opacity:.85}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-label,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-label{font-size:10.5px;letter-spacing:.12em;grid-column:1;grid-row:1}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-pieces,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-pieces{grid-column:2;grid-row:1;font-size:13px}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-read,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-read{grid-column:3;grid-row:1}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-num,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-num{font-size:13px;color:#a9c3e0}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-row[data-row="merge"],#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-row[data-row="cut"]{display:none}
#${CARD_ID}.nge-cm-min:not(.nge-cm-reviewing) .nge-cm-pre{display:none}
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
  + `<span class="nge-cm-short" aria-hidden="true">${ROW_SHORT[row]}</span><span class="nge-cm-label">${ROW_LABEL[row]}</span>`
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
  'You are in the <b>Sandbox</b>, a dataset used only for learning. Play gives you a cell that has already been proofread, so you can practice and get instant feedback.',
  '<b>Match score</b>: your Merge and Cut together, half each. It starts at 0% and reads 100% when your cell matches the true cell.',
  '<b>Merge</b>: the missing pieces you have merged back in. <b>Cut</b>: the wrong parts you have cut off.',
  'In real cells there is no known answer. That is up to you and the brain.',
  'When you feel comfortable editing here, ask for a dataset used for research: <b>Ask for Edit Access</b> in the 🍔 menu, top right.',
];
// One line each, a <br> between: the same look saved or not, and one line per
// paragraph when an admin edits it.
const INFO_HTML = INFO_LINES.join('<br>' + String.fromCharCode(10));
let infoApp: VueApp | null = null;
function mountInfo(host: HTMLElement) {
  if (infoApp) { try { infoApp.unmount(); } catch (e) { /* gone */ } infoApp = null; }
  const pinia = getActivePinia();
  if (!pinia) { host.innerHTML = '<div class="nge-cm-info-text">' + INFO_HTML + '</div>'; return; }
  infoApp = createApp(EditableText, { textKey: INFO_KEY, original: INFO_HTML, textClass: 'nge-cm-info-text', label: 'Sandbox Match card, the i text' });
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
  + '<button type="button" class="nge-cm-btn nge-cm-next-btn" hidden>Next hint</button></span></div>';
const PLAY_HTML = '<div class="nge-cm-play">'
  + '<button type="button" class="nge-cm-btn nge-cm-saveview" title="Save your current view (annotations, layers, camera) to this cell">Save</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-skipcell" title="Not this one: it goes back for someone else, and Pyr takes you to your next cell">Skip Cell</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-hbtn" title="Click for a Hint" hidden>Hint</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-complete">Complete and Review</button></div>'
  + '<div class="nge-cm-viewnote"></div>'
  + '<div class="nge-cm-skipask" hidden role="alertdialog" aria-label="Skip this cell?">'
  + '<p class="nge-cm-skipask-words"><b>Skip this cell?</b> It goes back for someone else, and your edits on it no longer count for you. Pyr takes you to a new cell.</p>'
  + '<div class="nge-cm-finish-actions"><button type="button" class="nge-cm-btn nge-cm-skipask-no">Keep working</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-skipask-yes">Skip this cell</button></div></div>';
const OK_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="#5fe3a1" stroke-width="1.4"/><path d="M4.8 8.2 7 10.3l4.2-4.5" fill="none" stroke="#5fe3a1" stroke-width="1.6"/></svg>';
const BAD_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="#ff8a9e" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ff8a9e" stroke-width="1.6"/></svg>';
const FINISH_HTML = '<div class="nge-cm-finish" hidden>'
  + '<div class="nge-cm-finish-title">Complete this cell</div>'
  + '<div class="nge-cm-finish-line nge-cm-finish-xh"><span class="nge-cm-finish-mark"></span><span class="nge-cm-finish-words"></span></div>'
  + '<div class="nge-cm-finish-line nge-cm-finish-view"><span class="nge-cm-finish-mark"></span><span class="nge-cm-finish-words"></span></div>'
  + '<button type="button" class="nge-cm-finish-addnote">+ Add a note</button>'
  + '<textarea class="nge-cm-finish-note" rows="3" maxlength="2000" placeholder="Anything about this cell (optional)" hidden></textarea>'
  + '<p class="nge-cm-finish-left" hidden></p>'
  + '<div class="nge-cm-finish-actions">'
  + '<button type="button" class="nge-cm-btn nge-cm-finish-back">Keep working</button>'
  + '<button type="button" class="nge-cm-btn nge-cm-finish-check" hidden>Check again</button>'
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
    + '<button type="button" class="nge-cm-tool nge-cm-i" aria-label="What do these numbers mean?" aria-pressed="false" aria-controls="nge-cell-match-info" title="What do these numbers mean?">i</button>'
    + '<button type="button" class="nge-cm-tool nge-cm-min-btn" aria-label="Collapse" aria-pressed="false" title="Collapse to the score"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>'
    + '<button type="button" class="nge-cm-x" aria-label="Close" title="Close. Press Play to open it again.">×</button></div>'
    + '<div class="nge-cm-sub" hidden></div>'
    + '<div class="nge-cm-cellid" hidden></div>'
    + '<div class="nge-cm-info" id="nge-cell-match-info"></div>'
    + scoreHtml + NUDGE_HTML + rowHtml('merge') + rowHtml('cut') + PLAY_HTML + FINISH_HTML + '<div class="nge-cm-extra"></div>';
  mountInfo(el.querySelector('.nge-cm-info') as HTMLElement);
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
function idle(state: string, note: string, action = false) {
  if (reviewing) return;
  if (playOff()) { hide(); return; }
  if (isClosed()) { folded(); return; }
  const el = card();
  el.classList.add('nge-cm-idle');
  el.classList.remove('nge-cm-done', 'nge-cm-bad');
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
  const label = isPlaying() ? 'Open my cell' : 'Play';
  let b = extra.querySelector('.nge-cm-idle-go') as HTMLButtonElement | null;
  if (!action) { extra.innerHTML = ''; b = null; }
  else if (!b) {
    extra.innerHTML = '<div class="nge-cm-actions"></div>';
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'nge-cm-btn nge-cm-go nge-cm-idle-go';
    b.addEventListener('click', standbyAction);
    extra.firstElementChild!.appendChild(b);
  }
  if (b && b.textContent !== label) b.textContent = label;
  place(el);
  shownFor = null;
  tellShown(null);
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
}

// ── Close and reopen (Ames 2026-11-13) ──────────────────────────────────────
// The X folds the card into a small Match button in the same spot; it
// stays folded (in this browser) until that button is clicked. The first time,
// a hint points at the button.
const isClosed = () => store.get(CLOSED_KEY) === '1';
/** Settings, Screen, "Show the Play button" off: PlayButton marks the page. */
const playOff = () => document.body.classList.contains('nge-play-off');
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
  if (pct != null && Number.isFinite(before) && box.dataset.pctWas !== '' && before !== pct) {
    const d = pct - before;
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
      else if (!r) idle(checking ? '' : 'Standby', checking ? 'Getting your cell ready' : standbyNote(), !checking);
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
  el.classList.remove('nge-cm-idle');
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
  place(el);
  shownFor = taskId;
  tellShown(taskId);
}

async function ask(taskId: number) {
  const mine = ++asking;
  show(taskId, last.get(taskId), true);
  try {
    const r = await secureWrite<MatchResult>('match.check', { taskId });
    const prev = last.get(taskId);
    noteResult(taskId, r);
    if (r.root) aliases.delete(taskId);
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
interface Clock { opened: number; lastEdit: number; offered: boolean; n: number; step: 1 | 2 }
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
  const owns = !!el && !el.classList.contains('nge-cm-idle') && shownFor != null;
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
function moment(taskId: number, kind: 'opened' | 'hint_offered' | 'complete' | 'skip') {
  const r = last.get(taskId);
  const score = r && r.scorable ? matchScore(r) : null;
  void secureWrite('match.event', { taskId, kind, idleSecs: idleSecs(taskId), score }).catch((e: any) => console.debug('[cell-match] no moment', kind, e?.message));
}
function noteOpened(taskId: number) {
  if (clocks.has(taskId)) return;
  const now = Date.now();
  clocks.set(taskId, { opened: now, lastEdit: now, offered: false, n: 0, step: 1 });
  moment(taskId, 'opened');
}
function noteEdit(taskId: number) {
  const c = clocks.get(taskId);
  // After an edit the next hint starts again with a place, about the piece it was on.
  if (c) { c.lastEdit = Date.now(); c.offered = false; c.step = 1; }
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
  (n.querySelector('.nge-cm-next-btn') as HTMLElement).hidden = true;
  (el.querySelector('.nge-cm-hbtn') as HTMLElement).hidden = true;
}
/** A minute with no edit (Ames 2026-11-14: "introduce hint after like 1 minute"). */
function maybeOfferHint(taskId: number) {
  const c = clocks.get(taskId);
  const el = document.getElementById(CARD_ID);
  if (!c || !el || c.offered || reviewing || finishing || shownFor !== taskId) return;
  if (Date.now() - Math.max(c.opened, c.lastEdit) < HINT_AFTER_MS) return;
  const r = last.get(taskId);
  if (!r || !r.scorable) return;
  c.offered = true;
  (el.querySelector('.nge-cm-hbtn') as HTMLElement).hidden = false;
  moment(taskId, 'hint_offered');
}
/** 2D beside 3D for a hint, unless a 2D view is already open. */
function ensureSplit() {
  try {
    const lay = JSON.stringify((window as any).viewer?.layout?.toJSON?.() ?? '');
    if (/xy|yz|xz|4panel/.test(lay)) return;
    openSplitView();
  } catch { /* the layout stays */ }
}
interface HintPiece { kind: 'merge' | 'cut'; root?: string; size: number; pointNm?: number[]; nearNm?: number[] }
/** Hint in two steps (Ames 2026-11-14: "this is not a hint but giving
 *  immediately the answer"): first the place on your own cell where the
 *  trouble starts, and what to look for there; Show me then shows the piece. */
async function pressHint(el: HTMLElement, next = false) {
  const taskId = shownFor;
  if (taskId == null) return;
  const c = clocks.get(taskId) ?? { opened: Date.now(), lastEdit: Date.now(), offered: true, n: 0, step: 1 as const };
  if (!clocks.has(taskId)) clocks.set(taskId, c);
  if (next) { c.n++; c.step = 1; }
  const b = el.querySelector('.nge-cm-hint-btn') as HTMLButtonElement;
  const nb = el.querySelector('.nge-cm-next-btn') as HTMLButtonElement;
  const text = el.querySelector('.nge-cm-nudge-text') as HTMLElement;
  const step = c.step;
  ensureSplit();
  const line = el.querySelector('.nge-cm-nudge') as HTMLElement;
  line.hidden = false;
  if (step === 1) { b.hidden = true; nb.hidden = true; text.textContent = 'Finding the next spot…'; }
  b.disabled = true; nb.disabled = true; if (step === 2) b.textContent = 'Finding…';
  try {
    const h = await secureWrite<{ left: number; piece: HintPiece | null }>('match.hint', { taskId, n: c.n, step, idleSecs: idleSecs(taskId) });
    if (!h.piece) { text.textContent = 'Nothing left to fix. Complete and Review when you are ready.'; b.hidden = true; nb.hidden = true; return; }
    showHintPiece(h.piece);
    if (step === 1) {
      text.textContent = h.piece.kind === 'merge'
        ? 'Your cell is missing a branch that starts near the blue pin. Look for a loose end there.'
        : 'Something that is not your cell joins it near the blue pin. Look for where it meets.';
      b.textContent = 'Show me';
      b.hidden = false;
      c.step = 2;
    } else {
      text.textContent = h.piece.kind === 'merge'
        ? 'This gold piece belongs to your cell. Merge it in.'
        : 'Your cell runs into another cell at the red pin. Cut it off there.';
      b.hidden = true;
    }
    nb.hidden = h.left < 2 && step === 1;
    nb.textContent = h.left > 1 ? 'Next hint' : 'Start over';
  } catch (e: any) {
    console.debug('[cell-match] no hint', e?.message);
    text.textContent = 'No hint right now. Try again in a moment.';
    b.textContent = 'Show me';
  } finally { b.disabled = false; nb.disabled = false; }
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
    try { v.layerSpecification.add(makeLayer(v.layerSpecification, HINT_PIN_LAYER, { type: 'annotation', source: { url: 'local://annotations' }, annotationColor: color, pointSize: 1.5, annotations: pin })); }
    catch (e) { console.debug('[cell-match] hint pin', e); }
  };
  place();
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
  if (r?.extra && r.extra.left > 0) parts.push(`${plural(r.extra.left, 'part')} to cut off`);
  left.textContent = parts.length ? `You still have ${parts.join(' and ')}. You can finish now, and Review will show you where they are.` : '';
  left.hidden = !parts.length;
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
  const view = f.querySelector('.nge-cm-finish-view') as HTMLElement;
  if (c.minting) finishLine(view, 'wait', 'Saving your view…');
  else if (c.link) finishLine(view, 'ok', 'Your view is saved with it.');
  else finishLine(view, 'bad', 'Your view could not be saved. Try again in a moment.');
  (f.querySelector('.nge-cm-finish-check') as HTMLElement).hidden = c.checking || c.ok;
  const go = f.querySelector('.nge-cm-finish-go') as HTMLButtonElement;
  go.disabled = c.submitting || c.checking || c.minting || !c.ok || !c.link;
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
  note.textContent = `${savedText}. Your view also saves by itself when you move to another cell.`;
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
function wirePlayBox(el: HTMLElement) {
  el.querySelector('.nge-cm-cellbtn')!.addEventListener('click', () => document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'mine' } })));
  el.querySelector('.nge-cm-hbtn')!.addEventListener('click', () => { const c = shownFor != null ? clocks.get(shownFor) : undefined; if (c) c.step = 1; void pressHint(el); });
  el.querySelector('.nge-cm-hint-btn')!.addEventListener('click', () => void pressHint(el));
  el.querySelector('.nge-cm-next-btn')!.addEventListener('click', () => void pressHint(el, true));
  el.querySelector('.nge-cm-saveview')!.addEventListener('click', () => cellAction('save'));
  const skipAsk = el.querySelector('.nge-cm-skipask') as HTMLElement;
  el.querySelector('.nge-cm-skipcell')!.addEventListener('click', () => {
    skipAsk.hidden = false;
    el.classList.add('nge-cm-asking');
    (el.querySelector('.nge-cm-skipask-no') as HTMLElement).focus();
  });
  el.querySelector('.nge-cm-skipask-no')!.addEventListener('click', () => { skipAsk.hidden = true; el.classList.remove('nge-cm-asking'); });
  el.querySelector('.nge-cm-skipask-yes')!.addEventListener('click', () => {
    skipAsk.hidden = true; el.classList.remove('nge-cm-asking');
    if (shownFor != null) moment(shownFor, 'skip');
    removeHintLayers();
    cellAction('skip');
  });
  el.querySelector('.nge-cm-complete')!.addEventListener('click', () => openFinish(el));
  el.querySelector('.nge-cm-finish-back')!.addEventListener('click', () => { cellAction('complete-cancel'); closeFinish(el); });
  el.querySelector('.nge-cm-finish-check')!.addEventListener('click', () => cellAction('complete-check'));
  el.querySelector('.nge-cm-finish-addnote')!.addEventListener('click', e => {
    (e.currentTarget as HTMLElement).hidden = true;
    const t = el.querySelector('.nge-cm-finish-note') as HTMLTextAreaElement;
    t.hidden = false; t.focus();
  });
  // Typing a note must not reach the game's keyboard shortcuts.
  for (const k of ['keydown', 'keyup', 'keypress']) el.querySelector('.nge-cm-finish-note')!.addEventListener(k, e => e.stopPropagation());
  el.querySelector('.nge-cm-finish-go')!.addEventListener('click', () => {
    if (shownFor != null) moment(shownFor, 'complete');
    removeHintLayers();
    cellAction('complete-submit', { notes: (el.querySelector('.nge-cm-finish-note') as HTMLTextAreaElement).value.trim() });
  });
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
  let url = window.location.href;
  try { url = `${location.origin}${location.pathname}#!${encodeURIComponent(JSON.stringify(v.state.toJSON()))}`; } catch { /* the address bar's view */ }
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
  const title = `My ${ordinal(most + 1)} practice cell`;
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
let hintShown: { root: string; wasVisible: boolean } | null = null;
function removeHintLayers() {
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
}
function removeReviewLayers() {
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
  if (id === onScreen) return;
  onScreen = id;
  noteOpened(id);
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
}

/** For headless checks. */
// The Play button setting changed: the box goes, or comes back.
document.addEventListener('nge:play-pref', () => {
  if (playOff()) { hide(); syncOwns(); return; }
  if (!isClosed() && onScreen != null) show(onScreen, last.get(onScreen), !last.get(onScreen));
});
if (isClosed()) document.body.classList.add('nge-cm-closed');
(window as any).__ngeCellMatch = { setSaveLink: (f: Deps['saveLink']) => { if (deps) deps.saveLink = f; }, judgeEdit, closeCard, openCard, show: (id: number, r: MatchResult) => { onScreen = id; noteResult(id, r); show(id, r, false); }, hide, rowPieces, progressLine, matchScore, hasReview, startReview, showReview, ageHintClock: (id: number, ms: number) => { const c = clocks.get(id); if (c) { c.opened -= ms; c.lastEdit -= ms; } } };
