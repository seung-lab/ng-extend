/**
 * The D key: hide the cell colors in 2D, to see the EM underneath, and D
 * again to bring them back (cognaso 2026-11-20: "is there a key that hides
 * highlights in 2D like in eyewire"). Only the 2D fill changes; 3D stays.
 * Not while typing, and not with Ctrl, Alt or Cmd (Ctrl+D is taken).
 */
const before = new WeakMap<object, number>();

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

/** Hide the 2D colors if any show; otherwise bring them back. */
export function toggleTwoDColor(): void {
  const layers = segLayers();
  if (!layers.length) return;
  const showing = layers.some(l => l.displayState.selectedAlpha.value > 0);
  for (const l of layers) {
    const a = l.displayState.selectedAlpha;
    if (showing) {
      if (a.value > 0) { before.set(l, a.value); a.value = 0; }
    } else {
      a.value = before.get(l) ?? 0.5;
      before.delete(l);
    }
  }
}

export function startTwoDColorKey(): void {
  window.addEventListener('keydown', e => {
    if (e.key !== 'd' && e.key !== 'D') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat || typing(e.target)) return;
    toggleTwoDColor();
  });
}
