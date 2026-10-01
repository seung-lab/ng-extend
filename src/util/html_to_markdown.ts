/**
 * Formatted text from the clipboard (text/html) as Markdown, for the
 * notification composer: pasting from a doc, a chat or an email keeps its
 * bold, italics, headings, lists and links (Ames 2026-10-01). Only the tags
 * the notification renderer shows (util/safe_markdown) are kept; everything
 * else becomes its plain text.
 */
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'HR']);

function isBold(el: HTMLElement): boolean {
  if (el.tagName === 'B' || el.tagName === 'STRONG') {
    // Google Docs wraps the whole paste in <b style="font-weight:normal">.
    return el.style.fontWeight !== 'normal' && el.style.fontWeight !== '400';
  }
  const w = el.style.fontWeight;
  return w === 'bold' || w === 'bolder' || Number(w) >= 600;
}
const isItalic = (el: HTMLElement) => el.tagName === 'I' || el.tagName === 'EM' || el.style.fontStyle === 'italic';

/** Wrap text in a marker, keeping any outer spaces outside it ("** x**" does not render). */
function wrap(text: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function inline(node: Node): string {
  if (node.nodeType === 3) return (node.textContent || '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return '\n';
  if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return '';
  let text = Array.from(el.childNodes).map(c => (c.nodeType === 1 && BLOCK.has((c as HTMLElement).tagName) ? block(c as HTMLElement) : inline(c))).join('');
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') || '';
    return /^https:\/\//i.test(href) && text.trim() ? `[${text.trim()}](${href})` : text;
  }
  if (el.tagName === 'CODE') return wrap(text, '`');
  if (isBold(el)) text = wrap(text, '**');
  if (isItalic(el)) text = wrap(text, '*');
  return text;
}

function list(el: HTMLElement, depth: number): string {
  const ordered = el.tagName === 'OL';
  let n = 0;
  const lines: string[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue;
    n++;
    const own = Array.from(li.childNodes).filter(c => !(c.nodeType === 1 && /^(UL|OL)$/.test((c as HTMLElement).tagName)));
    const text = own.map(c => (c.nodeType === 1 && BLOCK.has((c as HTMLElement).tagName) ? inline(c) : inline(c))).join('').replace(/\s*\n\s*/g, ' ').trim();
    lines.push(`${'  '.repeat(depth)}${ordered ? `${n}.` : '-'} ${text}`);
    for (const sub of Array.from(li.children)) {
      if (/^(UL|OL)$/.test(sub.tagName)) lines.push(list(sub as HTMLElement, depth + 1));
    }
  }
  return lines.join('\n');
}

function block(el: HTMLElement): string {
  const tag = el.tagName;
  if (tag === 'UL' || tag === 'OL') return `\n\n${list(el, 0)}\n\n`;
  if (tag === 'HR') return '\n\n---\n\n';
  const h = /^H([1-6])$/.exec(tag);
  if (h) {
    // A heading is already strong: drop bold markers inside it.
    const text = inline(el).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return text ? `\n\n${'#'.repeat(Math.min(4, Math.max(2, Number(h[1]))))} ${text}\n\n` : '';
  }
  if (tag === 'BLOCKQUOTE') {
    return `\n\n${inline(el).trim().split('\n').map(l => `> ${l.trim()}`).join('\n')}\n\n`;
  }
  return `\n\n${inline(el)}\n\n`;
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = inline(doc.body);
  return out
    // Trim each line, but keep the indent of nested list items.
    .split('\n').map(l => {
      const t = l.replace(/[ \t]+$/g, '');
      return /^\s+(-|\d+\.)\s/.test(t) ? t : t.replace(/^[ \t]+/, '');
    }).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the HTML carries formatting worth converting (not just a plain run of text). */
export function htmlHasFormatting(html: string): boolean {
  return /<(b|strong|i|em|h[1-6]|ul|ol|li|a|blockquote)[\s>]/i.test(html)
    || /font-weight\s*:\s*(bold|[6-9]00)/i.test(html);
}
