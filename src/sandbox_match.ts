/**
 * Cell match (Ames 2026-11-12): while a player works a Sandbox Cell Library
 * cell, a small card at the top left says how close the cell is to the
 * finished one, and it updates a few seconds after every merge or cut.
 *
 * The score comes from the server (ewSandboxMatch, functions/sandbox-match.js),
 * which compares the player's cell with the true cell in pinky_training; the
 * answer key never reaches the browser. This file only decides when to ask and
 * shows the answer:
 *   - asks when a Sandbox claim's cell comes on screen, and 2 s after the last
 *     of a burst of edits (nge-graph-edit) while it is on screen;
 *   - shows nothing for cells with no true cell to compare with, off the
 *     Sandbox, or when the check fails (a quiet card beats a wrong one).
 */
import { secureWrite } from './secure_write';
import { canonicalDataset, currentDatasetTag, currentSegLayer } from './datasets';
import { Uint64 } from 'neuroglancer/util/uint64';

export interface SandboxClaim { id: number; dataset: string; roots: string[] }
interface Deps { claims: () => SandboxClaim[]; signedIn: () => boolean }
export interface MatchResult {
  taskId: number; scorable: boolean; root?: string; match?: number | null;
  missing?: { left: number; total: number }; extra?: { left: number; total: number };
}

const CARD_ID = 'nge-cell-match';
const APP_FONT = "font-family:Inter,system-ui,'Segoe UI',sans-serif;";
const EDIT_WAIT_MS = 2000;

let deps: Deps | null = null;
let onScreen: number | null = null;
let shownFor: number | null = null;
const last = new Map<number, MatchResult>();
/** Roots each claim's cell has had after an edit, until the claim catches up. */
const aliases = new Map<number, Set<string>>();
let editTimer: ReturnType<typeof setTimeout> | null = null;
let asking = 0;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The line under the number: what is still wrong, in pieces. */
export function piecesLine(r: MatchResult): string {
  const parts: string[] = [];
  if (r.missing && r.missing.total) parts.push(`Missing ${r.missing.left} of ${plural(r.missing.total, 'piece')}`);
  if (r.extra && r.extra.total) parts.push(`Extra ${r.extra.left} of ${plural(r.extra.total, 'piece')}`);
  return parts.join(' · ');
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

function card(): HTMLElement {
  let el = document.getElementById(CARD_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = CARD_ID;
  el.className = 'ng-extend';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.title = 'How close your cell is to the finished cell. 0% at the start, 100% when every piece is right.';
  el.style.cssText = 'position:fixed;top:64px;left:12px;z-index:59;display:grid;gap:2px;padding:7px 12px 8px;min-width:150px;max-width:calc(100vw - 24px);'
    + 'border:1px solid rgba(126,180,255,.28);border-radius:10px;background:rgba(8,16,28,.82);color:#cfe0f7;pointer-events:auto;'
    + APP_FONT + 'font-size:12px;font-variant-numeric:tabular-nums;backdrop-filter:blur(4px);';
  el.innerHTML = '<div style="display:flex;align-items:baseline;gap:8px">'
    + '<span style="color:#8ea3c0">Cell match</span>'
    + '<span class="nge-cm-num" style="font-size:16px;font-weight:600;color:#fff"></span>'
    + '<span class="nge-cm-delta" style="color:#8fd9b4;opacity:0;transition:opacity .8s"></span></div>'
    + '<div class="nge-cm-sub" style="color:#8ea3c0"></div>'
    + '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,.1);margin-top:4px;overflow:hidden">'
    + '<i class="nge-cm-bar" style="display:block;height:100%;width:0;background:#6fa3f5;transition:width .6s ease"></i></div>';
  document.body.appendChild(el);
  return el;
}

/** The Proofreading Test's line card and bar sit in the same corner: stay
 *  below whichever is showing. */
function place(el: HTMLElement) {
  let top = 64;
  for (const other of document.querySelectorAll<HTMLElement>('.nge-tqc, #nge-test-hud')) {
    const r = other.getBoundingClientRect();
    if (r.height && r.left < 200) top = Math.max(top, Math.round(r.bottom) + 8);
  }
  if (el.style.top !== `${top}px`) el.style.top = `${top}px`;
}

function hide() {
  document.getElementById(CARD_ID)?.remove();
  shownFor = null;
}

function show(taskId: number, r: MatchResult | undefined, checking: boolean) {
  if (!r || !r.scorable || r.match == null) {
    // Checking a cell not seen before: say nothing until there is a number.
    if (!checking || !r) { if (!r || !r.scorable) hide(); return; }
  }
  const el = card();
  const num = el.querySelector('.nge-cm-num') as HTMLElement;
  const sub = el.querySelector('.nge-cm-sub') as HTMLElement;
  const bar = el.querySelector('.nge-cm-bar') as HTMLElement;
  const delta = el.querySelector('.nge-cm-delta') as HTMLElement;
  if (checking) {
    num.style.opacity = '.55';
    sub.textContent = 'Checking';
  } else {
    const before = shownFor === taskId ? Number(el.dataset.match) : NaN;
    num.style.opacity = '1';
    num.textContent = `${r!.match}%`;
    sub.textContent = piecesLine(r!);
    bar.style.width = `${r!.match}%`;
    el.dataset.match = String(r!.match);
    if (Number.isFinite(before) && before !== r!.match) {
      const d = r!.match! - before;
      // A minus sign, not a hyphen: Pyr's copy has no dashes.
      delta.textContent = d > 0 ? `+${d}` : `−${-d}`;
      delta.style.color = d > 0 ? '#8fd9b4' : '#f0a08f';
      delta.style.opacity = '1';
      setTimeout(() => { delta.style.opacity = '0'; }, 2200);
    }
  }
  place(el);
  shownFor = taskId;
}

async function ask(taskId: number) {
  const mine = ++asking;
  show(taskId, last.get(taskId), true);
  try {
    const r = await secureWrite<MatchResult>('match.check', { taskId });
    last.set(taskId, r);
    if (r.root) aliases.delete(taskId);
    if (mine !== asking || onScreen !== taskId) return;
    show(taskId, r, false);
    console.debug('[cell-match]', taskId, r.match, piecesLine(r));
  } catch (e: any) {
    console.debug('[cell-match] no check', taskId, e?.message);
    if (mine === asking && onScreen === taskId) {
      const r = last.get(taskId);
      if (r && r.scorable) show(taskId, r, false); else hide();
    }
  }
}

function tick() {
  const el = document.getElementById(CARD_ID);
  if (el) place(el);
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

/** For headless checks: what the card would say for a result. */
(window as any).__ngeCellMatch = { show: (id: number, r: MatchResult) => { onScreen = id; last.set(id, r); show(id, r, false); }, hide, piecesLine };
