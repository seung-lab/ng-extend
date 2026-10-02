// Split screen replaces the 4 panel layout (Ames 2026-10-02: "effectively
// eliminate 4 panel view"). Players got stranded in 4 panel after a stray
// Space or a dataset switch. Neuroglancer's own keys already do the rest:
// Space over a panel of the split screen shows that panel alone, and Space
// again asks for 4 panel, which now lands back on split screen. So Space
// simply flips between one panel and split screen. Anything else that asks
// for 4 panel (a shared link, a saved view) opens as split screen too.

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
    if (SPLIT.test(name)) { lastSplit = name; return; }
    if (name !== '4panel' || pending) return;
    if (document.body.classList.contains('nge-mobile')) return;  // phones manage their own layout
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
  style.textContent = `body:not(.nge-mobile) .neuroglancer-data-panel-layout-controls button[title="Switch to 4panel layout."] { display: none; }`;
  document.head.appendChild(style);
}
