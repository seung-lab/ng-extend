/**
 * The P key: the cell under the mouse in 3D sends one ring of light out along
 * itself from the mouse (Ames 2026-10-20: "maybe we need a hot key to make the
 * cell pulse"). Any 3D Hover look; drawn by mesh/frontend.ts (ngeFirePulse).
 * Not while typing, and not with Ctrl, Alt or Cmd (Ctrl+Shift+P is the
 * command palette).
 */
import { ngeFirePulse } from 'neuroglancer/mesh/frontend';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function startPulseKey(): void {
  window.addEventListener('keydown', e => {
    if (e.key !== 'p' && e.key !== 'P') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || typing(e.target)) return;
    ngeFirePulse();
    try { (window as any).viewer?.display?.scheduleRedraw(); } catch { /* no viewer */ }
  });
}
