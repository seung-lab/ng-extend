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
 *                              two or more image lines together sit side by side
 *   !> text                    a callout box (one paragraph per line)
 *   @[youtube](VIDEO_ID)       a YouTube video
 *   ---                        a divider
 *   A link alone on its own line becomes a button.
 * Links must be https (or a path on the site). Images must be ours.
 */
const IMG_OK = /^https:\/\/(javthknksdcrlhiaaptj\.supabase\.co\/storage\/v1\/object\/public\/|connectome\.quest\/assets\/)/;
const LINK_OK = /^(https:\/\/|\/(?!\/))/;
const IMG_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const VIDEO_LINE = /^@\[youtube\]\(([A-Za-z0-9_-]{11})\)$/;

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

/** Image lines, each optionally followed by a "^ caption" line. */
function figures(para: string[]): string | null {
  const figs: string[] = [];
  for (let k = 0; k < para.length; k++) {
    const m = IMG_LINE.exec(para[k]);
    if (!m || !IMG_OK.test(unamp(m[2]))) return null;
    let caption = '';
    if (k + 1 < para.length && /^\^\s?/.test(para[k + 1])) caption = para[++k].replace(/^\^\s?/, '');
    figs.push(`<figure class="blog-post__figure"><img src="${m[2]}" alt="${m[1]}" loading="lazy" />${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`);
  }
  if (!figs.length) return null;
  return figs.length === 1 ? figs[0] : `<div class="blog-post__pair">${figs.join('')}</div>`;
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
      const figs = figures(para);
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
