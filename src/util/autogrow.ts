/**
 * v-autogrow: a text box as tall as what is in it (Marissa, To do card "Text
 * edit boxes in full screen of a triage card are truncated", Ames 2026-11-02).
 * It never shrinks below the rows it was given, and stops at 60% of the
 * window, where it scrolls. Grows as you type, and when a draft is filled in
 * or cleared from code.
 */
import type { Directive } from 'vue';

/** What each box was last fitted to: the page redraws it for many reasons
 *  (adding a player to a notification, Ames 2026-11-10), and fitting again
 *  when nothing in it changed threw a long message back to its top. */
const fittedTo = new WeakMap<HTMLTextAreaElement, string>();

/** Every scrolled box around the text box, and how far each was scrolled. */
function scrollsAround(el: HTMLElement): [Element, number][] {
  const out: [Element, number][] = [];
  for (let p: Element | null = el.parentElement; p; p = p.parentElement) if (p.scrollTop) out.push([p, p.scrollTop]);
  if (document.scrollingElement?.scrollTop) out.push([document.scrollingElement, document.scrollingElement.scrollTop]);
  return out;
}

function fit(el: HTMLTextAreaElement) {
  if (!el.isConnected) return;
  const key = el.value.length + '|' + el.value.slice(-40) + '|' + el.clientWidth + '|' + window.innerHeight;
  if (fittedTo.get(el) === key) return;
  fittedTo.set(el, key);
  // Measuring shrinks the box for a moment; put every scroll back after.
  const ownTop = el.scrollTop;
  const around = scrollsAround(el);
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35 || 18;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const min = (el.rows || 2) * line + pad + border;
  const max = Math.max(min, window.innerHeight * 0.6);
  el.style.height = 'auto';
  const want = el.scrollHeight + border;
  el.style.height = Math.min(max, Math.max(min, want)) + 'px';
  el.style.overflowY = want > max ? 'auto' : 'hidden';
  el.scrollTop = ownTop;
  for (const [p, top] of around) p.scrollTop = top;
}

const onInput = (e: Event) => fit(e.target as HTMLTextAreaElement);

export const vAutogrow: Directive<HTMLTextAreaElement> = {
  mounted(el) { el.addEventListener('input', onInput); requestAnimationFrame(() => fit(el)); },
  updated(el) { fit(el); },
  unmounted(el) { el.removeEventListener('input', onInput); },
};
