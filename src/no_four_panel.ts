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

  // The corner button that asks for 4 panel has nowhere to go now.
  const style = document.createElement('style');
  style.textContent = `body:not(.nge-mobile) .neuroglancer-data-panel-layout-controls button[title="Switch to 4panel layout."] { display: none; }
${PHONE_CSS}`;
  document.head.appendChild(style);

  // Phone: the 4 panel button opens split screen straight away, without a
  // trip through 4 panel. Capture phase, so neuroglancer's own click on the
  // button never runs.
  document.addEventListener('click', e => {
    if (!document.body.classList.contains('nge-mobile')) return;
    const b = (e.target as HTMLElement | null)?.closest?.('.neuroglancer-data-panel-layout-controls button');
    if (!b || b.getAttribute('title') !== FOUR) return;
    e.stopPropagation();
    e.preventDefault();
    viewer.layout.restoreState(lastSplit);
  }, true);
}

const FOUR = 'Switch to 4panel layout.';

// Phone corner buttons as words: the 4 panel button reads "2D + 3D", the
// "3d" button reads "3D only", and the single 2D view button is not shown
// (a phone is 3D only or split, nothing else).
const PHONE_CSS = `
body.nge-mobile .neuroglancer-data-panel-layout-controls button[title="${FOUR}"],
body.nge-mobile .neuroglancer-data-panel-layout-controls button[title="Switch to 3d layout."] {
  width: auto !important; height: 34px !important; padding: 0 12px; border-radius: 17px;
  background: rgba(8, 14, 28, 0.82); border: 1px solid rgba(79, 207, 255, 0.55); color: #dff4ff;
  font: 600 13px/1 'Inter', 'Roboto', sans-serif; white-space: nowrap;
}
body.nge-mobile .neuroglancer-data-panel-layout-controls button[title="${FOUR}"] > div,
body.nge-mobile .neuroglancer-data-panel-layout-controls button[title="Switch to 3d layout."] > div { display: none; }
body.nge-mobile .neuroglancer-data-panel-layout-controls button[title="${FOUR}"]::after { content: '2D + 3D'; }
body.nge-mobile .neuroglancer-data-panel-layout-controls button[title="Switch to 3d layout."]::after { content: '3D only'; }
body.nge-mobile[data-nge-layout$="-3d"] .neuroglancer-data-panel-layout-controls button[title="${FOUR}"],
body.nge-mobile .neuroglancer-data-panel-layout-controls button:not([title="${FOUR}"]):not([title="Switch to 3d layout."]) { display: none !important; }
`;
