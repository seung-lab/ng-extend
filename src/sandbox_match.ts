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
import { reactive } from 'vue';

export interface SandboxClaim { id: number; dataset: string; roots: string[] }
interface Deps { claims: () => SandboxClaim[]; signedIn: () => boolean }
export interface MatchResult {
  taskId: number; scorable: boolean; root?: string; match?: number | null;
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
const STYLE_ID = 'nge-cell-match-style';
const CHIP_ID = 'nge-cell-match-open';
const HINT_ID = 'nge-cell-match-hint';
const CLOSED_KEY = 'nge-cell-match-closed';
const HINTED_KEY = 'nge-cell-match-hinted';
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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const ROW_LABEL: Record<Row, string> = { merge: 'Missing', cut: 'Mergers' };

/** Under a row's percent: pieces done of all, or that there is nothing to do. */
export function rowPieces(r: MatchResult, row: Row): string {
  const pct = row === 'merge' ? r.merge : r.cut;
  const p = row === 'merge' ? r.missing : r.extra;
  if (pct == null) return row === 'merge' ? 'none missing' : 'none to cut';
  if (!p || !p.total) return row === 'merge' ? 'real cell cut off' : 'wrong parts merged in';
  return row === 'merge' ? `${p.total - p.left} of ${plural(p.total, 'piece')} found` : `${p.total - p.left} of ${p.total} cut off`;
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
const CSS = `
#${CARD_ID}{position:fixed;top:64px;left:12px;z-index:59;width:310px;max-width:calc(100vw - 24px);box-sizing:border-box;
  padding:11px 14px 10px;color:#cfe6ff;font:14px/1.4 Inter,system-ui,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;
  background:linear-gradient(180deg,rgba(7,18,36,.88),rgba(3,9,20,.92));border:1px solid rgba(110,190,255,.28);border-radius:3px;
  box-shadow:0 0 22px rgba(60,150,255,.12),inset 0 0 18px rgba(60,150,255,.08);backdrop-filter:blur(5px);overflow:hidden;pointer-events:auto}
#${CARD_ID}::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(#7fd8ff,#7fd8ff) 0 0/12px 2px no-repeat,linear-gradient(#7fd8ff,#7fd8ff) 0 0/2px 12px no-repeat,
  linear-gradient(#7fd8ff,#7fd8ff) 100% 0/12px 2px no-repeat,linear-gradient(#7fd8ff,#7fd8ff) 100% 0/2px 12px no-repeat,
  linear-gradient(#7fd8ff,#7fd8ff) 0 100%/12px 2px no-repeat,linear-gradient(#7fd8ff,#7fd8ff) 0 100%/2px 12px no-repeat,
  linear-gradient(#7fd8ff,#7fd8ff) 100% 100%/12px 2px no-repeat,linear-gradient(#7fd8ff,#7fd8ff) 100% 100%/2px 12px no-repeat,
  repeating-linear-gradient(0deg,rgba(127,216,255,.035) 0 1px,transparent 1px 3px)}
#${CARD_ID}::after{content:'';position:absolute;left:0;right:0;top:-30%;height:30%;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,transparent,rgba(127,216,255,.16),transparent)}
#${CARD_ID}.nge-cm-ping::after{animation:nge-cm-sweep .9s ease-out 1}
@keyframes nge-cm-sweep{0%{top:-30%;opacity:1}100%{top:110%;opacity:0}}
@media (prefers-reduced-motion:reduce){#${CARD_ID}.nge-cm-ping::after{animation:none}}
#${CARD_ID} .nge-cm-head{display:flex;align-items:center;gap:8px;margin:-11px -14px 6px;padding:11px 14px 4px;cursor:grab;touch-action:none;user-select:none;font:600 12px/1 Orbitron,Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#7fc8ff}
#${CARD_ID} .nge-cm-dot{width:8px;height:8px;border-radius:50%;background:#59e3a7;box-shadow:0 0 6px #59e3a7}
#${CARD_ID}.nge-cm-dragging .nge-cm-head{cursor:grabbing}
#${CARD_ID}.nge-cm-checking .nge-cm-dot{background:#7fc8ff;box-shadow:0 0 6px #7fc8ff}
#${CARD_ID} .nge-cm-state{margin-left:auto;color:#5f86ad;letter-spacing:.16em}
#${CARD_ID} .nge-cm-row{display:grid;grid-template-columns:1fr auto;align-items:end;column-gap:8px;padding:3px 0 2px}
#${CARD_ID} .nge-cm-label{font:600 11.5px/1 Orbitron,Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#8fb6dc}
#${CARD_ID} .nge-cm-read{display:flex;align-items:baseline;gap:6px;justify-self:end}
#${CARD_ID} .nge-cm-num{font:700 25px/1 Orbitron,Inter,sans-serif;color:#eaf6ff;text-shadow:0 0 10px rgba(127,216,255,.45);transition:opacity .3s}
#${CARD_ID}.nge-cm-checking .nge-cm-num{opacity:.5}
#${CARD_ID} .nge-cm-x{margin-left:4px;width:22px;height:22px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:2px;
  background:transparent;color:#8fb6dc;font:400 18px/1 Inter,sans-serif;cursor:pointer}
#${CARD_ID} .nge-cm-x:hover{color:#fff;border-color:rgba(127,200,255,.45);background:rgba(127,200,255,.12)}
#${CARD_ID} .nge-cm-x:focus-visible{outline:2px solid #7fd8ff;outline-offset:1px}
#${CARD_ID}.nge-cm-reviewing .nge-cm-x{display:none}
#${CHIP_ID}{position:fixed;top:64px;left:12px;z-index:59;display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;
  border:1px solid rgba(110,190,255,.4);border-radius:3px;background:linear-gradient(180deg,rgba(7,18,36,.9),rgba(3,9,20,.94));
  box-shadow:0 0 16px rgba(60,150,255,.18);color:#7fc8ff;font:600 12px/1 Orbitron,Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase}
#${CHIP_ID}:hover{color:#fff;border-color:#7fd8ff}
#${CHIP_ID}:focus-visible{outline:2px solid #7fd8ff;outline-offset:2px}
#${CHIP_ID} .nge-cm-dot{width:8px;height:8px;border-radius:50%;background:#59e3a7;box-shadow:0 0 6px #59e3a7}
#${CHIP_ID} .nge-cm-chipnum{color:#eaf6ff;letter-spacing:.06em}
#${HINT_ID}{position:fixed;z-index:60;padding:9px 13px;border-radius:3px;background:#7fd8ff;color:#031226;pointer-events:none;
  font:600 13px/1.2 Inter,system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;transition:opacity .4s}
#${HINT_ID}.nge-cm-on{opacity:1}
#${HINT_ID}::before{content:'';position:absolute;left:-6px;top:50%;margin-top:-6px;border:6px solid transparent;border-left:0;border-right-color:#7fd8ff}
#${CARD_ID} .nge-cm-delta{font:600 13px/1 Orbitron,Inter,sans-serif;opacity:0;transition:opacity .8s}
#${CARD_ID} .nge-cm-gauge{grid-column:1/-1;position:relative;height:7px;margin:5px 0 4px;background:rgba(127,190,255,.10);overflow:hidden}
#${CARD_ID} .nge-cm-fill{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,#2f7dff,#7fd8ff);box-shadow:0 0 8px rgba(127,216,255,.6);transition:width .7s ease}
#${CARD_ID} .nge-cm-gauge::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 9px,rgba(3,9,20,.95) 9px 11px)}
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
  + `<span class="nge-cm-label">${ROW_LABEL[row]}</span>`
  + '<span class="nge-cm-read"><span class="nge-cm-delta"></span><span class="nge-cm-num"></span></span>'
  + '<div class="nge-cm-gauge"><i class="nge-cm-fill"></i></div>'
  + '<span class="nge-cm-pieces"></span></div>';

function card(): HTMLElement {
  ensureStyle();
  let el = document.getElementById(CARD_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = CARD_ID;
  el.className = 'ng-extend';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.title = 'How close your cell is to the finished cell, by size. Missing: how much of what is missing you have merged in. Mergers: how much of what does not belong you have cut off.';
  el.innerHTML = '<div class="nge-cm-head"><span class="nge-cm-dot"></span><span class="nge-cm-title">Cell match</span><span class="nge-cm-state"></span>'
    + '<button type="button" class="nge-cm-x" aria-label="Close" title="Close. A small Cell match button stays to open it again.">×</button></div>'
    + rowHtml('merge') + rowHtml('cut') + '<div class="nge-cm-extra"></div>';
  el.querySelector('.nge-cm-head')!.setAttribute('title', 'Drag to move. Double click to put it back.');
  makeDraggable(el);
  el.querySelector('.nge-cm-x')!.addEventListener('click', closeCard);
  document.body.appendChild(el);
  return el;
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
// The X folds the card into a small Cell match button in the same spot; it
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
    b.title = 'Open Cell match again';
    b.innerHTML = '<span class="nge-cm-dot"></span><span>Cell match</span><span class="nge-cm-chipnum"></span>';
    b.addEventListener('click', openCard);
    document.body.appendChild(b);
  }
  (b.querySelector('.nge-cm-chipnum') as HTMLElement).textContent = r?.merge != null ? `${r.merge}%` : '';
  place(b);
  return b;
}

function showHint(b: HTMLElement) {
  if (store.get(HINTED_KEY)) return;
  store.set(HINTED_KEY, '1');
  const h = document.createElement('div');
  h.id = HINT_ID;
  h.className = 'ng-extend';
  h.setAttribute('role', 'status');
  h.textContent = 'Click here to reopen';
  document.body.appendChild(h);
  const at = () => {
    const r = b.getBoundingClientRect();
    h.style.left = `${Math.round(r.right + 12)}px`;
    h.style.top = `${Math.round(r.top + r.height / 2 - h.offsetHeight / 2)}px`;
  };
  at();
  requestAnimationFrame(() => h.classList.add('nge-cm-on'));
  setTimeout(() => { h.classList.remove('nge-cm-on'); setTimeout(() => h.remove(), 500); }, 7000);
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

function showRow(el: HTMLElement, r: MatchResult, row: Row, fresh: boolean) {
  const box = el.querySelector(`.nge-cm-row[data-row="${row}"]`) as HTMLElement;
  const num = box.querySelector('.nge-cm-num') as HTMLElement;
  const delta = box.querySelector('.nge-cm-delta') as HTMLElement;
  const pct = row === 'merge' ? r.merge : r.cut;
  (box.querySelector('.nge-cm-pieces') as HTMLElement).textContent = rowPieces(r, row);
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
    // Checking a cell not seen before: say nothing until there is a number.
    if (!checking || !r) { if (!r || !r.scorable) hide(); return; }
  }
  if (isClosed()) { chip(r); return; }
  const el = card();
  const state = el.querySelector('.nge-cm-state') as HTMLElement;
  el.classList.toggle('nge-cm-checking', checking);
  if (checking) {
    state.textContent = 'Checking';
  } else {
    state.textContent = 'Live';
    const fresh = shownFor !== taskId;
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
    noteResult(taskId, r);
    if (r.root) aliases.delete(taskId);
    if (mine !== asking || onScreen !== taskId) return;
    show(taskId, r, false);
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
    if (mergers.length) line(RED, 'Mergers', `${mergers.length} attached`, 'Parts of other cells still merged into yours, each marked with a pin', mergers);
  }
  const actions = document.createElement('div');
  actions.className = 'nge-cm-actions';
  extra.appendChild(actions);
  return new Promise(resolve => {
    const end = (choice: 'next' | 'stay') => {
      removeReviewLayers();
      window.clearInterval(pinsTimer);
      reviewing = false;
      extra.innerHTML = '';
      (el.querySelector('.nge-cm-title') as HTMLElement).textContent = 'Cell match';
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
    actions.append(stay, next);
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
  if (id === onScreen) return;
  onScreen = id;
  if (id == null) { hide(); return; }
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
    show(id, last.get(id), true);
    editTimer = setTimeout(() => { editTimer = null; onScreen = id; void ask(id); }, EDIT_WAIT_MS);
  }) as EventListener);
  setInterval(() => { if (!document.hidden) tick(); }, 2000);
}

/** For headless checks. */
(window as any).__ngeCellMatch = { closeCard, openCard, show: (id: number, r: MatchResult) => { onScreen = id; noteResult(id, r); show(id, r, false); }, hide, rowPieces, hasReview, startReview, showReview };
