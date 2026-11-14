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
import { getActivePinia } from 'pinia';
import EditableText from './components/EditableText.vue';

export interface SandboxClaim { id: number; dataset: string; roots: string[] }
export interface SavedLinkInput { title: string; note?: string; url: string; dataset?: string; position?: [number, number, number]; visibleSegments?: string[] }
interface Deps { claims: () => SandboxClaim[]; signedIn: () => boolean; saveLink?: (l: SavedLinkInput) => Promise<string | null> }
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
const TITLE_HTML = '<span class="nge-cm-pre">Playing: </span>Practice cell';
// Merge and Cut together, half each, so it starts at 0 (Ames 2026-11-13:
// "match score should start at 0"). By total size, one big merger cut off read
// 90% with every thin missing piece still missed ("I got 90% and missed everything").
const scoreTip = (pct: number | null | undefined) => `Match score${pct == null ? '' : ` ${pct}%`}: your Merge and Cut together, half each`;
/** The match score: Merge and Cut averaged (only the ones this cell has). */
export function matchScore(r: MatchResult): number | null {
  const parts = [r.merge, r.cut].filter((n): n is number => n != null);
  return parts.length ? Math.floor(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
}

/** Under a row's percent: pieces done of all, or that there is nothing to do. */
export function rowPieces(r: MatchResult, row: Row): string {
  const pct = row === 'merge' ? r.merge : r.cut;
  const p = row === 'merge' ? r.missing : r.extra;
  if (pct == null) return row === 'merge' ? 'nothing to merge' : 'nothing to cut';
  if (!p || !p.total) return row === 'merge' ? 'part of the cell was cut off' : 'a wrong part was merged in';
  return row === 'merge' ? `${p.total - p.left} of ${plural(p.total, 'piece')} merged in` : `${p.total - p.left} of ${p.total} cut off`;
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
#${CARD_ID}{position:fixed;top:64px;left:12px;z-index:59;width:350px;max-width:calc(100vw - 24px);box-sizing:border-box;
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
#${CARD_ID} .nge-cm-title{white-space:nowrap;letter-spacing:.08em}
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
/* Checking (Ames 2026-11-13: "it needs a loading indicator"): a light runs
   along the score bar and a small ring turns beside the word. */
#${CARD_ID}.nge-cm-checking .nge-cm-score .nge-cm-gauge::after{content:'';position:absolute;top:0;bottom:0;left:-40%;width:40%;
  background:linear-gradient(90deg,transparent,rgba(190,240,255,.85),transparent);animation:nge-cm-load 1.1s ease-in-out infinite}
@keyframes nge-cm-load{from{left:-40%}to{left:100%}}
#${CARD_ID}.nge-cm-checking .nge-cm-state::before{content:'';display:inline-block;width:9px;height:9px;margin-right:5px;vertical-align:-1px;
  border:1.5px solid rgba(127,216,255,.35);border-top-color:#7fd8ff;border-radius:50%;animation:nge-cm-spin .8s linear infinite}
@keyframes nge-cm-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#${CARD_ID}.nge-cm-checking .nge-cm-score .nge-cm-gauge::after{animation:none;left:30%}#${CARD_ID}.nge-cm-checking .nge-cm-state::before{animation:none}}
#${CARD_ID} .nge-cm-score .nge-cm-gauge{height:7px;margin:7px 0 6px}
#${CARD_ID} .nge-cm-row[data-row="merge"]{margin-top:2px;border-top:1px solid rgba(127,190,255,.18);padding-top:7px}
#${CARD_ID} .nge-cm-row[data-row="merge"],#${CARD_ID} .nge-cm-row[data-row="cut"]{grid-template-columns:58px 1fr auto;align-items:baseline}
#${CARD_ID} .nge-cm-row[data-row="merge"] .nge-cm-gauge,#${CARD_ID} .nge-cm-row[data-row="cut"] .nge-cm-gauge{display:none}
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
  el.innerHTML = '<div class="nge-cm-head"><span class="nge-cm-dot"></span><span class="nge-cm-title">' + TITLE_HTML + '</span>'
    + '<button type="button" class="nge-cm-tool nge-cm-i" aria-label="What do these numbers mean?" aria-pressed="false" aria-controls="nge-cell-match-info" title="What do these numbers mean?">i</button>'
    + '<button type="button" class="nge-cm-tool nge-cm-min-btn" aria-label="Collapse" aria-pressed="false" title="Collapse to the score"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>'
    + '<button type="button" class="nge-cm-x" aria-label="Close" title="Close. A small Match button stays to open it again.">×</button></div>'
    + '<div class="nge-cm-sub" hidden></div>'
    + '<div class="nge-cm-info" id="nge-cell-match-info"></div>'
    + scoreHtml + rowHtml('merge') + rowHtml('cut') + '<div class="nge-cm-extra"></div>';
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
  if (isClosed()) { chip(undefined); return; }
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
}

// ── Close and reopen (Ames 2026-11-13) ──────────────────────────────────────
// The X folds the card into a small Match button in the same spot; it
// stays folded (in this browser) until that button is clicked. The first time,
// a hint points at the button.
const isClosed = () => store.get(CLOSED_KEY) === '1';

function removeChip() {
  document.getElementById(CHIP_ID)?.remove();
  document.getElementById(HINT_ID)?.remove();
}

function chip(r: MatchResult | undefined): HTMLElement {
  ensureStyle();
  let b = document.getElementById(CHIP_ID) as HTMLElement | null;
  if (!b) {
    const btn = document.createElement('button');
    btn.type = 'button';
    b = btn;
    b.id = CHIP_ID;
    b.className = 'ng-extend';
    b.title = 'Open your match score again';
    b.innerHTML = '<span class="nge-cm-dot"></span><span>Match</span><span class="nge-cm-chipnum"></span>';
    b.addEventListener('click', openCard);
    document.body.appendChild(b);
  }
  (b.querySelector('.nge-cm-chipnum') as HTMLElement).textContent = r && matchScore(r) != null ? `${matchScore(r)}%` : '';
  place(b);
  return b;
}

function showHint(b: HTMLElement) {
  if (store.get(HINTED_KEY)) return;
  store.set(HINTED_KEY, '1');
  // Pyr's tip box (as split_screen_tip.ts): under the button, until Got it.
  const h = document.createElement('div');
  h.id = HINT_ID;
  h.className = 'ng-extend nge-cm-tip';
  h.setAttribute('role', 'dialog');
  h.setAttribute('aria-label', 'Tip');
  h.innerHTML = '<div class="nge-cm-tip-kicker">TIP</div><div class="nge-cm-tip-text">Click here to reopen</div>'
    + '<button type="button" class="nge-cm-tip-ok">Got it</button>';
  document.body.appendChild(h);
  b.classList.add('nge-cm-tip-target');
  const r = b.getBoundingClientRect();
  h.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - h.offsetWidth - 8)))}px`;
  h.style.top = `${Math.round(r.bottom + 12)}px`;
  const gone = () => { h.remove(); b.classList.remove('nge-cm-tip-target'); document.removeEventListener('keydown', esc, true); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') gone(); };
  document.addEventListener('keydown', esc, true);
  h.querySelector('.nge-cm-tip-ok')!.addEventListener('click', gone);
}

function closeCard() {
  if (reviewing) return;
  store.set(CLOSED_KEY, '1');
  const id = onScreen;
  document.getElementById(CARD_ID)?.remove();
  shownFor = null;
  if (id == null) return;
  const b = chip(last.get(id));
  b.focus();
  showHint(b);
}

function openCard() {
  store.set(CLOSED_KEY, '0');
  removeChip();
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
      else if (!r) idle(checking ? 'Checking' : 'Standby', checking ? 'Reading your cell' : standbyNote(), !checking);
      else idle('No key', 'No finished cell to compare this one with');
      return;
    }
  }
  if (isClosed()) { chip(r); return; }
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
  place(el);
  shownFor = taskId;
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
  savedTitle = `Sandbox review, cell ${r.root ?? ''}`.trim();
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
  // 1. The Cell Library button in the top bar, pressed.
  const btn = document.querySelector('#extensionBar [data-icon-id="cells"]') as HTMLElement | null;
  if (visible(btn)) {
    await ring(btn, 'Cell Library', 1300);
    if (!visible(panel())) btn.click();
  }
  if (!visible(panel())) document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: {} }));
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
  await ring(row, 'Your review view', 4000);
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

function removeReviewLayers() {
  const v = (window as any).viewer;
  for (const ml of [...(v?.layerManager?.managedLayers ?? [])]) {
    if (ml.name === MISSED_LAYER || ml.name === MERGERS_LAYER) { try { v.layerManager.removeManagedLayer(ml); } catch { /* gone */ } }
  }
}
let pinsTimer: number | undefined;
function addReviewLayers(r: ReviewResult) {
  const v = (window as any).viewer;
  if (!v?.layerSpecification) return;
  removeReviewLayers();
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
    for (const ml of [...(v.layerManager?.managedLayers ?? [])]) if (ml.name === MERGERS_LAYER) v.layerManager.removeManagedLayer(ml);
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
  if (id === onScreen) return;
  onScreen = id;
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
  setInterval(() => { if (!document.hidden) tick(); }, 2000);
}

/** For headless checks. */
(window as any).__ngeCellMatch = { setSaveLink: (f: Deps['saveLink']) => { if (deps) deps.saveLink = f; }, judgeEdit, closeCard, openCard, show: (id: number, r: MatchResult) => { onScreen = id; noteResult(id, r); show(id, r, false); }, hide, rowPieces, progressLine, matchScore, hasReview, startReview, showReview };
