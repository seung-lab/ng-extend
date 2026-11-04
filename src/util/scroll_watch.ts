/**
 * Catch the annotation list's "scroll lock" in the act (Nseraf, report 328:
 * after adding many highlight marks fast, the list will not scroll until a
 * reload or a tab change; not reproduced here). When a scroll over a list does
 * not move it, a warning goes to the console with what was under the mouse
 * and the list's state, so the next report's console messages show the cause.
 * Watches only; changes nothing. At most one warning a minute.
 */
let lastWarn = 0;
const describe = (el: Element | null) => {
  if (!el) return 'nothing';
  const h = el as HTMLElement;
  return `${el.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}${typeof h.className === 'string' && h.className ? '.' + h.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
};

function onWheel(e: WheelEvent) {
  if (!e.deltaY || Date.now() - lastWarn < 60_000) return;
  const lists = [...document.querySelectorAll<HTMLElement>('.neuroglancer-annotation-list')].filter(l => l.offsetParent);
  const list = lists.find(l => {
    const r = l.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (!list) return;
  const before = list.scrollTop;
  const room = e.deltaY > 0 ? list.scrollHeight - list.clientHeight - before : before;
  if (room < 4) return;  // at the end already: nothing to move
  const target = e.target as Element | null;
  const covered = !!target && !list.contains(target);
  setTimeout(() => {
    if (Math.abs(list.scrollTop - before) > 1) return;
    lastWarn = Date.now();
    const style = getComputedStyle(list);
    const top = document.elementFromPoint(e.clientX, e.clientY);
    console.warn('[scroll lock] the annotation list did not scroll', {
      covered, target: describe(target), atPoint: describe(top),
      scrollTop: Math.round(before), scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
      overflowY: style.overflowY, pointerEvents: style.pointerEvents,
      defaultPrevented: e.defaultPrevented, bodyClass: document.body.className.slice(0, 200),
      active: describe(document.activeElement), rows: list.querySelectorAll('.neuroglancer-annotation-list-entry').length,
    });
  }, 250);
}

let started = false;
export function startScrollWatch() {
  if (started) return;
  started = true;
  window.addEventListener('wheel', onWheel, { capture: true, passive: true });
}
