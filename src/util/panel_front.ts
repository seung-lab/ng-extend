/**
 * The floating window you click comes to the front (Ames 2026-10-24: "If I
 * have clicked into chat, shouldn't it come to the front? and then if I
 * click on cell library it should come in front right?").
 *
 * Each window has its own z-index, and the Cell Library's is above chat's,
 * so it covered chat whatever was clicked. A click on a window puts it back
 * at its own level and moves any other window at or above that level just
 * under it. Nothing is ever raised past the level it was built with, so menus,
 * pop-ups and the tutorial box stay above the windows as they always were.
 */
const PANELS = [
  '.nge-chat-float', '.nge-cl-panel', '.nge-bp-panel', '.nge-acc', '.nge-hl-panel',
  '.nge-quest-board', '.nge-guide', '.nge-arv', '.nge-trv',
].join(', ');

const zOf = (el: HTMLElement) => Number.parseInt(getComputedStyle(el).zIndex, 10) || 0;

function bringToFront(panel: HTMLElement) {
  panel.style.removeProperty('z-index');
  const top = zOf(panel);
  for (const other of Array.from(document.querySelectorAll<HTMLElement>(PANELS))) {
    if (other === panel || other.contains(panel) || panel.contains(other)) continue;
    // Back to its own level first, so a window lowered before can rise again.
    other.style.removeProperty('z-index');
    if (zOf(other) >= top) other.style.zIndex = String(top - 1);
  }
}

export function startPanelFront(): void {
  document.addEventListener('pointerdown', e => {
    const panel = (e.target as Element | null)?.closest?.(PANELS) as HTMLElement | null;
    if (panel) bringToFront(panel);
  }, true);
}
