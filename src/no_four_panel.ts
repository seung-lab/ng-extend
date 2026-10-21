// Split screen replaces the 4 panel layout (Ames 2026-10-02: "effectively
// eliminate 4 panel view"). Players got stranded in 4 panel after a stray
// Space or a dataset switch. Neuroglancer's own keys already do the rest:
// Space over a panel of the split screen shows that panel alone, and Space
// again asks for 4 panel, which now lands back on split screen. So Space
// simply flips between one panel and split screen. Anything else that asks
// for 4 panel (a shared link, a saved view) opens as split screen too.
//
// Phones (Ames 2026-10-15): 3D only stays the default (store.ts). The one
// corner button on a phone asked for 4 panel, and phones were left out of
// the rule above, so one tap landed in 4 panel on a small screen. Now that
// button reads "2D + 3D" and opens split screen (2D above 3D in portrait),
// and in split screen the only button is "3D only", which goes back.

function layoutName(viewer: any): string {
  try {
    const j = viewer?.layout?.toJSON?.();
    return typeof j === 'string' ? j : (j?.type ?? '');
  } catch { return ''; }
}

const SPLIT = /^(xy|xz|yz)-3d$/;

/** Call once the viewer exists. */
export function installNoFourPanel(viewer: any) {
  const changed = viewer?.layout?.changed;
  if (!changed?.add) return;
  let lastSplit = 'xy-3d';
  let pending = false;
  const check = () => {
    const name = layoutName(viewer);
    // For the phone buttons below: in split screen "2D + 3D" is not shown.
    document.body.dataset.ngeLayout = name;
    if (SPLIT.test(name)) { lastSplit = name; return; }
    if (name !== '4panel' || pending) return;
    pending = true;
    // After neuroglancer finishes the change it is in the middle of.
    queueMicrotask(() => {
      pending = false;
      if (layoutName(viewer) === '4panel') viewer.layout.restoreState(lastSplit);
    });
  };
  changed.add(check);
  check();

  // Touch screens: a tablet gets the desktop layout but has no Space key, so
  // the word buttons below are for any touch screen, not only a phone
  // (Nseraf, report 157: on a tablet "3D only" left no button to go back).
  const coarse = window.matchMedia('(pointer: coarse)');
  const paintCoarse = () => document.body.classList.toggle('nge-coarse', coarse.matches);
  coarse.addEventListener?.('change', paintCoarse);
  paintCoarse();

  // The corner button that asks for 4 panel reads "2D + 3D" and opens split
  // screen. With a mouse it used to be hidden everywhere (Space does the
  // same), which left 3D only with no way back for anyone who did not know
  // Space (wolfryder101, report 168, 2026-10-19). Now it shows wherever the
  // view is not split already.
  const style = document.createElement('style');
  style.textContent = CORNER_CSS;
  document.head.appendChild(style);

  // Neuroglancer titles the corner buttons "Switch to 4panel layout." and so
  // on, which is not what they do here. Mark each with what it does and give
  // it a tooltip that says so (Ames 2026-10-19). Mutation callbacks run
  // before the next paint, so the styles, keyed on the mark, never miss a
  // frame.
  const mark = () => {
    for (const b of document.querySelectorAll<HTMLElement>(`${C}[title]`)) {
      const title = b.getAttribute('title') || '';
      const kind = BUTTONS[title] ?? (/^Switch to (xy|xz|yz)-3d layout\.$/.test(title) ? 'split'
        : /^Switch to (xy|xz|yz) layout\.$/.test(title) ? 'xy' : undefined);
      if (!kind) continue;
      b.dataset.ngeBtn = kind;
      b.dataset.ngeLabel = LABELS[kind];
      // The words show on hover with a mouse (Ames 2026-10-19), so no
      // tooltip on top of them; screen readers get the full sentence.
      b.removeAttribute('title');
      b.setAttribute('aria-label', TIPS[kind]);
    }
    // A single 2D view gets neuroglancer's own split screen button as well
    // as the 4 panel one, which here does the same: show one of them.
    for (const box of document.querySelectorAll<HTMLElement>('.neuroglancer-data-panel-layout-controls')) {
      const splits = [...box.querySelectorAll<HTMLElement>('button[data-nge-btn="split"]')];
      for (const extra of splits.slice(1)) extra.dataset.ngeBtn = 'dup';
    }
  };
  new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
  mark();

  // The 4 panel button opens split screen straight away, without a trip
  // through 4 panel. Capture phase, so neuroglancer's own click on the
  // button never runs.
  document.addEventListener('click', e => {
    const b = (e.target as HTMLElement | null)?.closest?.(C) as HTMLElement | null;
    if (!b || (b.getAttribute('title') !== FOUR && b.dataset.ngeBtn !== 'split' && b.dataset.ngeBtn !== 'dup')) return;
    e.stopPropagation();
    e.preventDefault();
    viewer.layout.restoreState(lastSplit);
  }, true);
}

const FOUR = 'Switch to 4panel layout.';
/** Neuroglancer's title of each corner button, and what it does here. */
const BUTTONS: Record<string, 'split' | '3d' | 'xy'> = {
  [FOUR]: 'split', 'Switch to 3d layout.': '3d', 'Switch to xy layout.': 'xy',
};
const TIPS = {
  split: 'Split screen: 2D beside 3D (Space)',
  '3d': 'Full screen 3D (Space)',
  xy: 'Full screen 2D (Space)',
};
/** What each button says: on hover with a mouse, always on a touch screen. */
const LABELS = { split: '2D + 3D', '3d': '3D only', xy: '2D only' };
const C = '.neuroglancer-data-panel-layout-controls button';
const B = (kind: string) => `${C}[data-nge-btn="${kind}"]`;
/** Selectors for a phone (or a narrow window) and for any touch screen. */
const touch = (rest: string) => `body.nge-mobile${rest}, body.nge-coarse${rest}`;
const mouse = (rest: string) => `body:not(.nge-mobile):not(.nge-coarse)${rest}`;

// Line icons in the site's style, drawn in the button's text colour.
const icon = (paths: string) => `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`)}")`;
const ICON_SPLIT = icon(`<rect x='1.8' y='2.8' width='12.4' height='10.4' rx='1.8'/><path d='M8 3.2v9.6'/>`);
const ICON_FULL = icon(`<path d='M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10'/>`);

// With a mouse (Ames 2026-10-19: "match our site"): small dark rounded
// squares with a thin cyan edge and a line icon, lit cyan on hover, like the
// site's other window buttons. Full screen on the panel you are in, split
// screen to come back; split screen is not offered while the view is split.
// On a touch screen they are words instead: "2D + 3D", "3D only" and
// "2D only". A phone is 3D only or split, so it has no "2D only".
const CORNER_CSS = `
${mouse(' .neuroglancer-data-panel-layout-controls')} { gap: 4px; }
${mouse(` ${C}[data-nge-btn]`)} {
  width: auto !important; min-width: 24px; height: 24px !important; padding: 0 4px !important;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px !important; border: 1px solid rgba(126, 224, 255, 0.35) !important;
  background: rgba(8, 14, 28, 0.78) !important; color: rgba(214, 236, 255, 0.9) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, color 0.15s;
}
${mouse(` ${C}[data-nge-btn]:hover`)}, ${mouse(` ${C}[data-nge-btn]:focus-visible`)} {
  color: #ffffff !important; border-color: rgba(126, 224, 255, 0.8) !important;
  background: rgba(14, 38, 58, 0.95) !important; box-shadow: 0 0 12px rgba(126, 224, 255, 0.3); outline: none;
}
${mouse(` ${C}[data-nge-btn] > div`)} { display: none; }
${mouse(` ${C}[data-nge-btn]::before`)} {
  content: attr(data-nge-label); max-width: 0; overflow: hidden; white-space: nowrap;
  font: 600 12px/1 'Inter', 'Roboto', sans-serif; letter-spacing: 0.01em;
  transition: max-width 0.18s ease, margin 0.18s ease;
}
${mouse(` ${C}[data-nge-btn]:hover::before`)}, ${mouse(` ${C}[data-nge-btn]:focus-visible::before`)} { max-width: 90px; margin: 0 6px 0 4px; }
${mouse(` ${C}[data-nge-btn]::after`)} {
  content: ''; flex: none; width: 14px; height: 14px; background-color: currentColor;
  -webkit-mask: var(--nge-icon) center / contain no-repeat; mask: var(--nge-icon) center / contain no-repeat;
}
${mouse(` ${B('split')}`)} { --nge-icon: ${ICON_SPLIT}; }
${mouse(` ${B('3d')}`)}, ${mouse(` ${B('xy')}`)} { --nge-icon: ${ICON_FULL}; }
${mouse(`[data-nge-layout$="-3d"] ${B('split')}`)}, ${C}[data-nge-btn="dup"] { display: none !important; }
${touch(` ${B('split')}`)},
${touch(` ${B('3d')}`)},
${touch(` ${B('xy')}`)} {
  width: auto !important; height: 34px !important; padding: 0 12px; border-radius: 17px;
  background: rgba(8, 14, 28, 0.82); border: 1px solid rgba(79, 207, 255, 0.55); color: #dff4ff;
  font: 600 13px/1 'Inter', 'Roboto', sans-serif; white-space: nowrap;
}
${touch(` ${C}[data-nge-btn] > div`)} { display: none; }
${touch(` ${C}[data-nge-btn]::after`)} { content: attr(data-nge-label); }
${touch(`[data-nge-layout$="-3d"] ${B('split')}`)},
${touch(` ${C}:not([data-nge-btn])`)},
body.nge-mobile ${B('xy')} { display: none !important; }
`;
