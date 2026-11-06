/**
 * The blog's small, safe text format. Authors never see it: the editor in the
 * game shows a normal document with formatting buttons and turns it into this
 * when saving (src/util/blog_document.ts). The SAME rules live in the public
 * site (seunglabdata/assets/blog.js, renderBlogMarkdown) so the editor matches
 * the published page. Change both together.
 *
 * Everything is HTML-escaped first, then only these are turned into tags:
 *   ## Heading, ### Smaller heading
 *   - list items, 1. numbered items, > quotes
 *   **bold**, *italic*, `code`, [text](https://link)
 *   ![description](image)      an image; a line "^ caption" under it is its caption;
 *   ![description](image){small}  the same at a set size: small, medium or large
 *                              (no size: as wide as the text, as before);
 *                              two or more image lines together sit side by side
 *   @[phone](image)            under an image: a tall version phones get instead
 *   ^^ longer text             under an image: a longer description, with links,
 *                              shown when the picture is enlarged
 *   @[link](https://...)       under an image: clicking the picture opens this link
 *                              (without one, clicking a picture shows it larger)
 *   @[gallery]                 a line above image lines: they show as a gallery,
 *                              a grid of pictures, each with its caption
 *   !> text                    a callout box (one paragraph per line)
 *   @[youtube](VIDEO_ID)       a YouTube video
 *   ---                        a divider
 *   A link alone on its own line becomes a button.
 * Links must be https (or a path on the site). Images must be ours.
 */
const IMG_OK = /^https:\/\/(javthknksdcrlhiaaptj\.supabase\.co\/storage\/v1\/object\/public\/|connectome\.quest\/assets\/)/;
const LINK_OK = /^(https:\/\/|\/(?!\/))/;
const IMG_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{(small|medium|large)\})?$/;
const VIDEO_LINE = /^@\[youtube\]\(([A-Za-z0-9_-]{11})\)$/;
const PHONE_LINE = /^@\[phone\]\(([^)\s]+)\)$/;
const LINK_LINE = /^@\[link\]\(([^)\s]+)\)$/;
const GALLERY_LINE = '@[gallery]';

/** Is this a picture address the blog shows (ours only)? */
export function blogImageOk(url: string): boolean { return IMG_OK.test(url); }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unamp = (s: string) => s.replace(/&amp;/g, '&');

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => IMG_OK.test(unamp(url)) ? `<img src="${url}" alt="${alt}" loading="lazy" />` : m)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => LINK_OK.test(unamp(url)) ? `<a href="${url}"${/^https:/.test(url) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>` : m)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

/** Image lines, each optionally followed by a "^ caption" line, an
 *  "@[phone](url)" line: a tall version of the same picture that phones get
 *  instead (Ames 2026-11-04: wide diagrams were too small to read on a phone),
 *  and an "@[link](url)" line: where clicking the picture goes (Ames
 *  2026-11-05). gallery: the pictures of an @[gallery], shown as a grid.
 *  editor: a picture's link is kept on the figure, not as a link, so a click
 *  in the editor picks the picture. */
function figures(para: string[], gallery = false, editor = false): string | null {
  const figs: string[] = [];
  for (let k = 0; k < para.length; k++) {
    const m = IMG_LINE.exec(para[k]);
    if (!m || !IMG_OK.test(unamp(m[2]))) return null;
    let caption = '', phone = '', link = '', more = '';
    for (;;) {
      const next = para[k + 1];
      if (next === undefined) break;
      const p = PHONE_LINE.exec(next);
      const l = LINK_LINE.exec(next);
      if (p && IMG_OK.test(unamp(p[1]))) { phone = p[1]; k++; }
      else if (l && LINK_OK.test(unamp(l[1])) && !link) { link = l[1]; k++; }
      else if (/^\^\^/.test(next)) { if (!more) more = next.replace(/^\^\^\s?/, ''); k++; }
      else if (/^\^\s?/.test(next) && !caption) { caption = next.replace(/^\^\s?/, ''); k++; }
      else break;
    }
    const img = `<img src="${m[2]}" alt="${m[1]}" loading="lazy" />`;
    let pic = phone ? `<picture><source media="(max-width: 700px)" srcset="${phone}" />${img}</picture>` : img;
    if (link && !editor) pic = `<a class="blog-post__piclink" href="${link}"${/^https:/.test(link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${pic}</a>`;
    // A picture's size (Celia, triage #395: "loads huge and I can't adjust
    // its size"). Sizes apply to a picture on its own, not to a pair or a gallery.
    const sized = m[3] && !gallery ? m[3] : '';
    const size = sized ? ` blog-post__figure--${sized}` : '';
    figs.push(`<figure class="blog-post__figure${size}"${sized ? ` data-size="${sized}"` : ''}${link && editor ? ` data-link="${link}"` : ''}>${pic}${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}${more ? `<div class="blog-post__more">${inline(more)}</div>` : ''}</figure>`);
  }
  if (!figs.length) return null;
  if (gallery) return `<div class="blog-post__gallery">${figs.join('')}</div>`;
  return figs.length === 1 ? figs[0] : `<div class="blog-post__pair">${figs.map(f => f.replace(/ blog-post__figure--\w+"/, '"').replace(/ data-size="\w+"/, '')).join('')}</div>`;
}

/** editor: draw a video as a still picture, so it can sit inside the editor. */
export function renderBlogMarkdown(text: string, editor = false): string {
  const lines = esc(String(text || '').replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let i = 0;
  const run = (re: RegExp) => { const got: string[] = []; while (i < lines.length && re.test(lines[i])) got.push(lines[i++].replace(re, '')); return got; };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const video = VIDEO_LINE.exec(line.trim());
    if (/^```/.test(line)) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
    } else if (video) {
      i++;
      out.push(editor
        ? `<div class="blog-post__video" data-yt="${video[1]}" contenteditable="false"><img src="https://i.ytimg.com/vi/${video[1]}/hqdefault.jpg" alt="YouTube video" /></div>`
        : `<div class="blog-post__video"><iframe src="https://www.youtube-nocookie.com/embed/${video[1]}" title="YouTube video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`);
    } else if (/^-{3,}\s*$/.test(line)) { out.push('<hr />'); i++; }
    else if (/^###\s+/.test(line)) { out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`); i++; }
    else if (/^##?\s+/.test(line)) { out.push(`<h2>${inline(line.replace(/^##?\s+/, ''))}</h2>`); i++; }
    else if (/^!&gt;\s?/.test(line)) out.push(`<aside class="blog-post__callout">${run(/^!&gt;\s?/).map(x => `<p>${inline(x)}</p>`).join('')}</aside>`);
    else if (/^[-*]\s+/.test(line)) out.push(`<ul>${run(/^[-*]\s+/).map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
    else if (/^\d+\.\s+/.test(line)) out.push(`<ol>${run(/^\d+\.\s+/).map(x => `<li>${inline(x)}</li>`).join('')}</ol>`);
    else if (/^&gt;\s?/.test(line)) out.push(`<blockquote><p>${inline(run(/^&gt;\s?/).join(' '))}</p></blockquote>`);
    else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(```|##?#?\s|[-*]\s|\d+\.\s|&gt;|!&gt;|-{3,}\s*$|@\[youtube\])/.test(lines[i])) para.push(lines[i++].trim());
      // A line that looks like a block but is not a valid one (a video with a
      // bad id, say) is plain text. Always move on, or this loop never ends.
      if (!para.length) para.push(lines[i++].trim());
      const figs = para[0] === GALLERY_LINE ? figures(para.slice(1), true, editor) : figures(para, false, editor);
      if (figs) { out.push(figs); continue; }
      const joined = para.join(' ');
      const html = inline(joined);
      if (/^\[[^\]]+\]\([^)\s]+\)$/.test(joined) && html.startsWith('<a ')) out.push(`<p class="blog-post__cta">${html.replace('<a ', '<a class="blog-post__button" ')}</p>`);
      else out.push(`<p>${html}</p>`);
    }
  }
  return out.join('\n');
}

/** A web address for a title: "Hello, World!" becomes "hello-world". */
export function blogSlug(title: string): string {
  return String(title || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}
