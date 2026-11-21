/**
 * Hold D: the cell colors in 2D go away while the key is down, to see the EM
 * underneath, and come back when it is let go (cognaso 2026-11-20: "is there
 * a key that hides highlights in 2D like in eyewire"; Ames: "hold D"). Only
 * the 2D fill changes; 3D stays. Not while typing, and not with Ctrl, Alt or
 * Cmd (Ctrl+D is taken).
 */
const before = new Map<any, number>();

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function segLayers(): any[] {
  const viewer = (window as any).viewer;
  return (viewer?.layerManager?.managedLayers ?? [])
    .map((m: any) => m.layer)
    .filter((l: any) => l?.displayState?.selectedAlpha && String(l.type || '').startsWith('segmentation'));
}

function hide() {
  if (before.size) return;
  for (const l of segLayers()) {
    const a = l.displayState.selectedAlpha;
    if (a.value > 0) { before.set(l, a.value); a.value = 0; }
  }
}

function show() {
  for (const [l, v] of before) {
    try { if (l.displayState.selectedAlpha.value === 0) l.displayState.selectedAlpha.value = v; } catch { /* layer gone */ }
  }
  before.clear();
}

export function startTwoDColorKey(): void {
  window.addEventListener('keydown', e => {
    if (e.key !== 'd' && e.key !== 'D') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || typing(e.target)) return;
    hide();
  });
  window.addEventListener('keyup', e => { if (e.key === 'd' || e.key === 'D') show(); });
  // Let go while the window lost focus: never leave the colors off.
  window.addEventListener('blur', show);
  document.addEventListener('visibilitychange', () => { if (document.hidden) show(); });
}
