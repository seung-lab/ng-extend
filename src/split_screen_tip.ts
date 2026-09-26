// First time someone lands in the 4 panel layout, point at the way back to
// split screen (Amy 2026-09-25: users get stranded in 4 panel view after a
// dataset switch or a stray Space). Neuroglancer gives each 4 panel slice view
// two corner buttons: a single square (that view alone) and ◫ (that view plus
// 3D, i.e. split screen). Shift + Space over the panel does the same as ◫
// ('toggle-layout-alternative' in default_input_event_bindings.ts).
//
// Shown once per browser; "Got it", Escape, or leaving 4 panel dismisses it.

const SEEN_KEY = 'nge_tip_split_screen_v1';
const TARGET_CLASS = 'nge-split-tip-target';

let tipEl: HTMLElement | null = null;
let targetEl: HTMLElement | null = null;
let showTimer: number | null = null;

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
}

function layoutName(viewer: any): string {
  try {
    const j = viewer?.layout?.toJSON?.();
    return typeof j === 'string' ? j : (j?.type ?? '');
  } catch { return ''; }
}

/** The ◫ (xy-3d style) button of the top-left 4 panel view. */
function findSplitButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(
    '.neuroglancer-data-panel-layout-controls button[title$="-3d layout."]'));
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const b of buttons) {
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    const score = r.top * 4 + r.left;  // prefer the top row, then the left
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}

function injectStyles() {
  if (document.getElementById('nge-split-tip-style')) return;
  const s = document.createElement('style');
  s.id = 'nge-split-tip-style';
  s.textContent = `
.${TARGET_CLASS} {
  position: relative;
  z-index: 3;
  outline: 2px solid #4a9eff !important;
  outline-offset: 2px;
  border-radius: 3px;
  animation: ngeSplitTipPulse 1.6s ease-in-out infinite;
}
@keyframes ngeSplitTipPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(74, 158, 255, 0.7); }
  50%      { box-shadow: 0 0 0 8px rgba(74, 158, 255, 0); }
}
.nge-split-tip {
  position: fixed;
  z-index: 9000;
  width: 270px;
  padding: 12px 14px 12px;
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.97), rgba(10, 16, 32, 0.96));
  border: 1px solid rgba(74, 158, 255, 0.55);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 0 22px rgba(74, 158, 255, 0.18);
  color: #dfe8f6;
  font: 13px/1.5 Inter, 'Segoe UI', sans-serif;
  animation: ngeSplitTipIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.nge-split-tip::before {
  content: '';
  position: absolute;
  top: -7px;
  right: var(--nge-tip-arrow-right, 14px);
  width: 12px; height: 12px;
  background: rgba(8, 12, 26, 0.97);
  border-left: 1px solid rgba(74, 158, 255, 0.55);
  border-top: 1px solid rgba(74, 158, 255, 0.55);
  transform: rotate(45deg);
}
.nge-split-tip-kicker {
  font: 600 10px/1 Orbitron, Inter, sans-serif;
  letter-spacing: 0.14em;
  color: #6fb2ff;
  margin-bottom: 6px;
}
.nge-split-tip kbd {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-bottom-width: 2px;
  border-radius: 4px;
  font: 600 11px/17px Inter, sans-serif;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}
.nge-split-tip-glyph { color: #fff; font-weight: 700; }
.nge-split-tip-ok {
  margin-top: 10px;
  padding: 4px 14px;
  border-radius: 12px;
  border: 1px solid rgba(74, 158, 255, 0.5);
  background: rgba(74, 158, 255, 0.16);
  color: #eaf2ff;
  font: 600 11px Orbitron, Inter, sans-serif;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.nge-split-tip-ok:hover { background: rgba(74, 158, 255, 0.28); }
@keyframes ngeSplitTipIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .${TARGET_CLASS}, .nge-split-tip { animation: none; }
}`;
  document.head.appendChild(s);
}

function hideTip(remember: boolean) {
  if (showTimer !== null) { window.clearTimeout(showTimer); showTimer = null; }
  if (remember && (tipEl || targetEl)) markSeen();
  tipEl?.remove();
  tipEl = null;
  targetEl?.classList.remove(TARGET_CLASS);
  targetEl = null;
  window.removeEventListener('resize', positionTip);
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') hideTip(true);
}

function positionTip() {
  if (!tipEl || !targetEl) return;
  const r = targetEl.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  // Below the button, right edges aligned, kept on screen.
  const left = Math.max(8, Math.min(r.right + 6 - w, window.innerWidth - w - 8));
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${r.bottom + 12}px`;
  const arrowRight = Math.max(8, Math.min(w - 20, left + w - (r.left + r.width / 2) - 6));
  tipEl.style.setProperty('--nge-tip-arrow-right', `${arrowRight}px`);
}

function showTip() {
  if (seen() || tipEl) return;
  if (document.body.classList.contains('nge-mobile')) return;  // phones use fullscreen 3D
  const btn = findSplitButton();
  if (!btn) return;
  injectStyles();
  targetEl = btn;
  btn.classList.add(TARGET_CLASS);
  const tip = document.createElement('div');
  tip.className = 'nge-split-tip';
  tip.setAttribute('role', 'dialog');
  tip.innerHTML = `
    <div class="nge-split-tip-kicker">TIP</div>
    <div>Click <span class="nge-split-tip-glyph">◫</span> here, or hover a panel and press
      <kbd>Shift</kbd> + <kbd>Space</kbd>, to get back to split screen.</div>
    <button class="nge-split-tip-ok" type="button">Got it</button>`;
  tip.querySelector('button')!.addEventListener('click', () => hideTip(true));
  document.body.appendChild(tip);
  tipEl = tip;
  positionTip();
  window.addEventListener('resize', positionTip);
  document.addEventListener('keydown', onKey, true);
}

function onLayoutChanged(viewer: any) {
  if (layoutName(viewer) === '4panel') {
    if (seen() || tipEl || showTimer !== null) return;
    // Let neuroglancer build the panels and their corner buttons first.
    showTimer = window.setTimeout(() => { showTimer = null; showTip(); }, 700);
  } else {
    // Left 4 panel (via the button or Shift + Space): they know the way now.
    hideTip(true);
  }
}

function install(attempts = 40) {
  const viewer = (window as any)['viewer'];
  const changed = viewer?.layout?.changed;
  if (!changed?.add) {
    if (attempts > 0) window.setTimeout(() => install(attempts - 1), 500);
    return;
  }
  changed.add(() => onLayoutChanged(viewer));
  onLayoutChanged(viewer);  // already in 4 panel on load
}

if (!seen()) install();
