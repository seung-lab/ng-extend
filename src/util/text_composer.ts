/**
 * Format buttons for a text box whose text players read as Markdown (bold,
 * bullets, numbers, pasted lists kept), drawn with renderSafeMarkdown. The same
 * moves as the Notifications composer in AdminHub.vue (Ames 2026-10-16: her
 * numbered list lost its numbers), shared here so a new box gets them without a
 * copy inside the Admin Hub; first used by the Hunt's description (Ames
 * 2026-10-21: "need formatting here").
 */
import { htmlHasFormatting, htmlToMarkdown } from './html_to_markdown';

export type Composer = { el: HTMLTextAreaElement | null; get: () => string; set: (v: string) => void };

export function replaceSelection(c: Composer, text: string, selectFrom?: number, selectTo?: number) {
  const el = c.el;
  if (!el) { c.set(c.get() + text); return; }
  const a = el.selectionStart, b = el.selectionEnd;
  c.set(el.value.slice(0, a) + text + el.value.slice(b));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + (selectFrom ?? text.length), a + (selectTo ?? text.length));
  });
}

/** A paste with formatting (a list from a document or a chat) comes in as Markdown. */
export function pasteFormatted(c: Composer, e: ClipboardEvent) {
  const html = e.clipboardData?.getData('text/html') || '';
  if (!html || !htmlHasFormatting(html)) return;   // plain paste as usual
  const md = htmlToMarkdown(html);
  if (!md) return;
  e.preventDefault();
  replaceSelection(c, md);
}

/** Wrap the selection in a marker (bold, italic), or drop in a placeholder. */
export function wrapSelection(c: Composer, mark: string, placeholder: string) {
  const el = c.el;
  const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  const inner = sel || placeholder;
  replaceSelection(c, `${mark}${inner}${mark}`, mark.length, mark.length + inner.length);
}

/** Start each selected line with a prefix (a bullet, or "1. ", "2. " counted down the
 *  selection). A marker already there is swapped, not doubled. Blank lines stay blank. */
export function prefixLines(c: Composer, prefix: string | ((i: number) => string), placeholder: string) {
  const el = c.el;
  if (!el) return;
  const v = el.value;
  const a = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
  let b = v.indexOf('\n', el.selectionEnd);
  if (b < 0) b = v.length;
  const pre = typeof prefix === 'string' ? () => prefix : prefix;
  let n = 0;
  const lines = (v.slice(a, b) || placeholder).split('\n')
    .map(l => (l.trim() ? pre(n++) + l.replace(/^\s*(#{1,4}\s+|[-*•·]\s+|\d{1,3}[.)]\s+)/, '') : l));
  el.setSelectionRange(a, b);
  replaceSelection(c, lines.join('\n'));
}
