/**
 * The blog editor is a normal document (see BlogEditor.vue): authors click
 * buttons and see the result. This turns that document into the blog's stored
 * text format (blog_markdown.ts), and offers the small editing helpers the
 * toolbar needs. Loading goes the other way through renderBlogMarkdown(text, true).
 */

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
    if (tag === 'STRONG' || tag === 'B' || weight === 'bold' || Number(weight) >= 600) out += wrap('**', inner);
    else if (tag === 'EM' || tag === 'I' || el.style?.fontStyle === 'italic') out += wrap('*', inner);
    else if (tag === 'CODE') out += inner.trim() ? '`' + inner.trim() + '`' : '';
    else if (tag === 'A') {
      const href = el.getAttribute('href') || '';
      out += LINK_OK.test(href) && inner.trim() ? wrap('', `[${inner.trim()}](${href.replace(/\s/g, '%20')})`) : inner;
    } else out += inner;
  });
  return out;
}

function figureLines(fig: HTMLElement): string[] {
  const img = fig.tagName === 'IMG' ? fig as HTMLImageElement : fig.querySelector('img');
  if (!img) return [];
  const caption = clean(inlineOf(fig.querySelector('figcaption') || document.createElement('i'))).trim();
  const alt = clean(img.getAttribute('alt') || '').replace(/[\[\]]/g, '').trim() || caption.replace(/[*`\[\]()]/g, '');
  const lines = [`![${alt}](${img.getAttribute('src') || ''})`];
  if (caption) lines.push('^ ' + caption);
  return lines;
}

const BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|BLOCKQUOTE|PRE|HR|FIGURE|ASIDE|TABLE|SECTION|ARTICLE)$/;

function blocksOf(root: Node, out: string[]) {
  let loose = '';
  const flush = () => { const t = loose.trim(); if (t) out.push(t); loose = ''; };
  root.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) { loose += clean(child.textContent || ''); return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName;
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
    } else if (el.classList.contains('blog-post__pair')) {
      const lines: string[] = [];
      el.querySelectorAll('figure').forEach(f => lines.push(...figureLines(f as HTMLElement)));
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

/** The editor's document as the blog's stored text. */
export function documentToMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  blocksOf(root, out);
  return out.join('\n\n');
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
