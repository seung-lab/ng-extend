/**
 * A picture of the whole page, drawn by the app itself (Ames 2026-10-01).
 *
 * The browser's tab capture asks "share this tab?" every single time and no
 * site may remember the answer. This draws the page into a canvas instead:
 * the viewer's own picture first, then every panel and window on top of it,
 * so there is nothing to approve. The tab capture stays as the fallback if
 * this fails.
 */
import {domToCanvas} from 'modern-screenshot';

/** An element carrying this attribute is left out of the picture. */
export const CAPTURE_SKIP = 'data-nge-capture-skip';
const MARK = CAPTURE_SKIP;

/** The viewer's WebGL picture as a plain canvas. WebGL throws its picture
 *  away after showing it, so it is redrawn and copied in the same breath. */
function snapshotViewer(): { gl: HTMLCanvasElement; copy: HTMLCanvasElement } | null {
  const viewer: any = (window as any).viewer;
  const gl: HTMLCanvasElement | undefined = viewer?.display?.canvas;
  if (!gl || !gl.width || !gl.height) return null;
  try { viewer.display.draw?.(); } catch { /* use whatever is there */ }
  const copy = document.createElement('canvas');
  copy.width = gl.width;
  copy.height = gl.height;
  copy.getContext('2d')!.drawImage(gl, 0, 0);
  return { gl, copy };
}

/** The web fonts' stylesheets (icon font, display fonts) live on another
 *  site, where the page may not read their rules; fetch their text once so
 *  the fonts can be carried into the picture. Without this the toolbar icons
 *  come out as their names ("forum", "database"). */
let fontCss: Promise<string> | null = null;
function loadFontCss(): Promise<string> {
  if (fontCss) return fontCss;
  const urls = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    const href = sheet.href;
    if (href && new URL(href, location.href).origin !== location.origin) { urls.add(href); continue; }
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSImportRule && rule.href) urls.add(new URL(rule.href, href || location.href).href);
      }
    } catch { /* unreadable sheet */ }
  }
  fontCss = Promise.all(Array.from(urls).map(u => fetch(u).then(r => r.ok ? r.text() : '').catch(() => '')))
    .then(parts => inlineFontFiles(parts.join(String.fromCharCode(10))));
  return fontCss;
}

/** A picture cannot load files from the network, so each font file the
 *  stylesheet points at is fetched and written into it as data. */
async function inlineFontFiles(css: string): Promise<string> {
  const found = Array.from(new Set(Array.from(css.matchAll(/url\((https:[^)"']+)\)/g), m => m[1])));
  const data = new Map<string, string>();
  await Promise.all(found.map(async u => {
    try {
      const blob = await (await fetch(u)).blob();
      data.set(u, await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      }));
    } catch { /* that face falls back to a system font */ }
  }));
  return css.replace(/url\((https:[^)"']+)\)/g, (all, u) => data.has(u) ? `url(${data.get(u)})` : all);
}

/** Ticks and typed values live in properties the copy does not see; write
 *  them to attributes first (this never changes what is on screen). */
function syncFormState() {
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[type=checkbox], input[type=radio]'))) {
    if (el.checked !== el.hasAttribute('checked')) el.toggleAttribute('checked', el.checked);
  }
}

export async function capturePage(timeoutMs = 12000): Promise<HTMLCanvasElement> {
  const snap = snapshotViewer();
  const cleanup: Array<() => void> = [];
  try {
    if (snap) {
      // Stand the copy in the WebGL canvas's exact place for the drawing, and
      // leave the WebGL canvas itself out (it would come through blank).
      const { gl, copy } = snap;
      const cs = getComputedStyle(gl);
      copy.style.cssText = `position:${cs.position === 'static' ? 'relative' : cs.position};left:${cs.left};top:${cs.top};` +
        `width:${gl.clientWidth}px;height:${gl.clientHeight}px;z-index:${cs.zIndex};display:block;pointer-events:none;`;
      gl.setAttribute(MARK, '');
      gl.insertAdjacentElement('afterend', copy);
      cleanup.push(() => { copy.remove(); gl.removeAttribute(MARK); });
    }
    syncFormState();
    const cssText = await Promise.race([loadFontCss(), new Promise<string>(r => setTimeout(() => r(''), 4000))]);
    const w = window.innerWidth, h = window.innerHeight;
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const work = domToCanvas(document.body, {
      width: w, height: h, scale,
      backgroundColor: '#000000',
      style: { margin: '0' },
      ...(cssText ? { font: { cssText } } : {}),
      filter: (node: Node) => {
        if (!(node instanceof Element)) return true;
        if (node.hasAttribute(MARK)) return false;
        // Hidden for the shot (this dialog, modal pop-ups): leave them out
        // entirely instead of drawing an invisible box.
        if (node instanceof HTMLElement && getComputedStyle(node).visibility === 'hidden' && node !== document.body) {
          return node.querySelector(':scope *') ? !node.matches('.nge-overlay-blocker, .nge-shotdlg-overlay') : false;
        }
        return true;
      },
      // A font or image that cannot be fetched must not sink the picture.
      fetch: { bypassingCache: false, placeholderImage: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
      timeout: timeoutMs,
    } as any);
    const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Drawing the page took too long.')), timeoutMs));
    const canvas = await Promise.race([work, timer]);
    if (!canvas.width || !canvas.height) throw new Error('The page picture came out empty.');
    return canvas;
  } finally {
    cleanup.forEach(fn => fn());
  }
}
