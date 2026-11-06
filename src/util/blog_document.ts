/**
 * The blog editor is a normal document (see BlogEditor.vue): authors click
 * buttons and see the result. This turns that document into the blog's stored
 * text format (blog_markdown.ts), and offers the small editing helpers the
 * toolbar needs. Loading goes the other way through renderBlogMarkdown(text, true).
 */

import { blogImageOk } from './blog_markdown';

const LINK_OK = /^(https:\/\/|\/(?!\/))/;
const clean = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ');

/** Formatting marks hug the words: "**bold **next" would not read as bold. */
function wrap(mark: string, inner: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function inlineOf(node: Node): string {
  let out = '';
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) { out += clean(child.textContent || ''); return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (tag === 'BR') { out += ' '; return; }
    if (tag === 'IMG' || tag === 'FIGURE' || tag === 'UL' || tag === 'OL') return;   // handled as blocks
    const inner = inlineOf(el);
    const weight = el.style?.fontWeight || '';
    // Google Docs wraps a whole copied passage in <b style="font-weight:normal">.
    const notBold = weight === 'normal' || (Number(weight) > 0 && Number(weight) < 600);
    if (((tag === 'STRONG' || tag === 'B') && !notBold) || weight === 'bold' || Number(weight) >= 600) out += wrap('**', inner);
    else if (tag === 'EM' || tag === 'I' || el.style?.fontStyle === 'italic') out += wrap('*', inner);
    else if (tag === 'CODE') out += inner.trim() ? '`' + inner.trim() + '`' : '';
    else if (tag === 'A') {
      const href = el.getAttribute('href') || '';
      out += LINK_OK.test(href) && inner.trim() ? wrap('', `[${inner.trim()}](${href.replace(/\s/g, '%20')})`) : inner;
    } else out += inner;
  });
  return out;
}

const SIZES = ['small', 'medium', 'large'];
/** The size chosen for a picture on its own, or '' (as wide as the text). */
export function figureSize(fig: Element | null): string {
  const s = (fig as HTMLElement | null)?.dataset?.size || '';
  return SIZES.includes(s) ? s : '';
}
function figureLines(fig: HTMLElement, inPair = false): string[] {
  const img = fig.tagName === 'IMG' ? fig as HTMLImageElement : fig.querySelector('img');
  if (!img) return [];
  const caption = clean(inlineOf(fig.querySelector('figcaption') || document.createElement('i'))).trim();
  const alt = clean(img.getAttribute('alt') || '').replace(/[\[\]]/g, '').trim() || caption.replace(/[*`\[\]()]/g, '');
  const size = inPair || fig.tagName !== 'FIGURE' ? '' : figureSize(fig);
  const lines = [`![${alt}](${img.getAttribute('src') || ''})${size ? `{${size}}` : ''}`];
  if (caption) lines.push('^ ' + caption);
  const more = clean(inlineOf(fig.querySelector('.blog-post__more') || document.createElement('i'))).trim();
  if (more) lines.push('^^ ' + more);
  // a phone version (<picture><source>) is kept as its own line under the image
  const phone = img.parentElement?.tagName === 'PICTURE' ? img.parentElement.querySelector('source')?.getAttribute('srcset') : null;
  if (phone) lines.push(`@[phone](${phone})`);
  // where clicking the picture goes (kept on the figure in the editor)
  const link = fig.tagName === 'FIGURE' ? (fig.dataset.link || fig.querySelector(':scope > a.blog-post__piclink')?.getAttribute('href') || '') : '';
  if (link && LINK_OK.test(link) && !/\s/.test(link)) lines.push(`@[link](${link})`);
  return lines;
}

const BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|BLOCKQUOTE|PRE|HR|FIGURE|ASIDE|TABLE|SECTION|ARTICLE)$/;
const BLOCK_SELECTOR = 'p, div, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, hr, figure, aside, table, section, article';

function blocksOf(root: Node, out: string[]) {
  let loose = '';
  const flush = () => { const t = loose.trim(); if (t) out.push(t); loose = ''; };
  root.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) { loose += clean(child.textContent || ''); return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (!BLOCK.test(tag) && tag !== 'IMG' && el.querySelector(BLOCK_SELECTOR)) {
      flush();                                          // an inline tag wrapped around whole blocks (pasted pages do this)
      blocksOf(el, out);
      return;
    }
    if (!BLOCK.test(tag) && tag !== 'IMG') {            // loose inline content at the top level
      const holder = document.createElement('span');
      holder.appendChild(el.cloneNode(true));
      loose += inlineOf(holder);
      return;
    }
    flush();
    if (tag === 'HR') out.push('---');
    else if (/^H[12]$/.test(tag)) { const t = inlineOf(el).trim(); if (t) out.push('## ' + t.replace(/\*\*/g, '')); }
    else if (/^H[3-6]$/.test(tag)) { const t = inlineOf(el).trim(); if (t) out.push('### ' + t.replace(/\*\*/g, '')); }
    else if (tag === 'UL' || tag === 'OL') {
      const items: string[] = [];
      el.querySelectorAll('li').forEach(li => { const t = inlineOf(li).trim(); if (t) items.push(t); });
      if (items.length) out.push(items.map((t, n) => (tag === 'OL' ? `${n + 1}. ` : '- ') + t).join('\n'));
    } else if (tag === 'BLOCKQUOTE') {
      const inner: string[] = [];
      blocksOf(el, inner);
      const t = inner.join(' ').replace(/\n/g, ' ').trim();
      if (t) out.push('> ' + t);
    } else if (tag === 'PRE') {
      const t = (el.textContent || '').replace(/\n+$/, '');
      if (t.trim()) out.push('```\n' + t + '\n```');
    } else if (tag === 'FIGURE' || tag === 'IMG') {
      const lines = figureLines(el);
      if (lines.length) out.push(lines.join('\n'));
    } else if (tag === 'ASIDE') {
      const inner: string[] = [];
      blocksOf(el, inner);
      const paras = inner.join('\n').split('\n').map(x => x.trim()).filter(Boolean);
      if (paras.length) out.push(paras.map(x => '!> ' + x).join('\n'));
    } else if (el.classList.contains('blog-post__gallery')) {
      const lines: string[] = [];
      el.querySelectorAll('figure').forEach(f => lines.push(...figureLines(f as HTMLElement, true)));
      if (lines.length) out.push(['@[gallery]', ...lines].join('\n'));
    } else if (el.classList.contains('blog-post__pair')) {
      const lines: string[] = [];
      el.querySelectorAll('figure').forEach(f => lines.push(...figureLines(f as HTMLElement, true)));
      if (lines.length) out.push(lines.join('\n'));
    } else if (el.dataset?.yt) {
      if (/^[A-Za-z0-9_-]{11}$/.test(el.dataset.yt)) out.push(`@[youtube](${el.dataset.yt})`);
    } else if (el.querySelector('figure, ul, ol, blockquote, pre, hr, aside, h1, h2, h3, p, div')) {
      blocksOf(el, out);                                // a wrapper around other blocks
    } else {
      const img = el.querySelector('img');
      const t = inlineOf(el).trim();
      if (t) out.push(t);
      if (img) out.push(figureLines(img as HTMLElement).join('\n'));
    }
  });
  flush();
}

/**
 * Keep the editor's page in the shapes the blog can store, so what an author
 * sees is what gets saved (Celia, triage #395: lists and text styles that
 * needed fiddling). The browser's own formatting commands leave behind
 * <div>s, <span style>s, <font>s, headings inside list items and lists inside
 * list items; none of those exist in a saved post. Run after every toolbar
 * command and before saving or previewing, never while the person types.
 */
export function tidyDocument(root: HTMLElement): boolean {
  let changed = false;
  const unwrap = (el: Element) => { el.replaceWith(...Array.from(el.childNodes)); changed = true; };
  // Styling the browser added: plain text inside instead.
  root.querySelectorAll('span, font').forEach(unwrap);
  root.querySelectorAll('[style]').forEach(el => { el.removeAttribute('style'); changed = true; });
  // A list item holds words only: unwrap blocks inside it, and move a list
  // inside a list item out after its parent list (the blog has one level).
  root.querySelectorAll('li').forEach(li => {
    li.querySelectorAll(':scope > p, :scope > div, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > blockquote').forEach(unwrap);
  });
  root.querySelectorAll('li > ul, li > ol').forEach(inner => {
    const outer = inner.parentElement!.closest('ul, ol')!;
    const li = inner.parentElement!;
    let after: Element = li;
    Array.from(inner.children).forEach(item => { after.after(item); after = item; });
    inner.remove();
    changed = true;
    void outer;
  });
  // Top level: no <div> paragraphs, no loose words, no heading wrapped in a list.
  Array.from(root.children).forEach(el => {
    if (el.tagName === 'DIV' && !el.className && !(el as HTMLElement).dataset.yt) {
      const p = document.createElement('p');
      p.append(...Array.from(el.childNodes));
      el.replaceWith(p);
      changed = true;
    }
  });
  Array.from(root.childNodes).forEach(n => {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()) {
      const p = document.createElement('p');
      n.replaceWith(p);
      p.appendChild(n);
      changed = true;
    }
  });
  // Empty lists left behind by toggling a list off.
  root.querySelectorAll('ul:empty, ol:empty').forEach(el => { el.remove(); changed = true; });
  if (!root.firstElementChild) { root.innerHTML = '<p><br></p>'; changed = true; }
  return changed;
}

/** The editor's document as the blog's stored text. */
export function documentToMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  blocksOf(root, out);
  return out.join('\n\n');
}

/**
 * Something copied from another page or document (a web page, Google Docs,
 * Word), as the blog's stored text: headings, paragraphs, lists, quotes, bold,
 * italic and links come along; styling, code and other sites' pictures do not
 * (Ames 2026-11-05: "allow direct copy paste including links"). The page is
 * parsed by DOMParser, which runs no scripts and loads no pictures.
 */
export function htmlToBlogMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, meta, link, title, noscript, template, iframe, object, embed, svg, canvas, video, audio, button, input, select, textarea').forEach(el => el.remove());
  // pictures from other sites cannot be shown; a copied picture arrives as a file and is uploaded
  doc.querySelectorAll('img').forEach(img => { if (!blogImageOk(img.getAttribute('src') || '')) img.remove(); });
  doc.querySelectorAll('a').forEach(a => {
    const href = (a.getAttribute('href') || '').trim();
    if (/^http:\/\//i.test(href)) a.setAttribute('href', 'https://' + href.slice(7));
    // a link inside the other page ("/about", "#top") means nothing here
    else if (!/^https:\/\//i.test(href)) a.replaceWith(...Array.from(a.childNodes));
  });
  const out: string[] = [];
  blocksOf(doc.body, out);
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The id in a YouTube link of any usual shape, or ''. */
export function youtubeId(link: string): string {
  const s = String(link || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/.exec(s);
  return m ? m[1] : '';
}

/** A link as typed, made safe to store: https only, or a path on the site. */
export function tidyLink(link: string): string {
  let s = String(link || '').trim();
  if (!s) return '';
  if (/^http:\/\//i.test(s)) s = 'https://' + s.slice(7);
  if (!/^(https:\/\/|\/)/i.test(s)) s = 'https://' + s;
  return LINK_OK.test(s) && !/\s/.test(s) ? s : '';
}
