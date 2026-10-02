/**
 * How much of the bottom of the screen neuroglancer's status bar is using
 * (the Find Path bar, "Path found", tool bars), published as the CSS variable
 * --nge-bottom-bar on <body>, so floating windows parked at the bottom (chat)
 * can sit above it instead of under it (Ames 2026-10-02).
 */
export function installBottomBarWatch() {
  if (!document.body) { document.addEventListener('DOMContentLoaded', installBottomBarWatch, { once: true }); return; }
  let watched: HTMLElement | null = null;
  let last = -1;
  const measure = () => {
    const el = document.getElementById('statusContainer');
    let h = 0;
    if (el && el.childElementCount > 0) {
      const r = el.getBoundingClientRect();
      // Only when it really is a bar along the bottom edge.
      if (r.height > 0 && r.bottom >= window.innerHeight - 4) h = Math.round(Math.min(window.innerHeight * 0.5, window.innerHeight - r.top));
    }
    if (h !== last) {
      last = h;
      document.body.style.setProperty('--nge-bottom-bar', h + 'px');
    }
  };
  const resize = new ResizeObserver(measure);
  const content = new MutationObserver(measure);
  const attach = () => {
    const el = document.getElementById('statusContainer');
    if (el === watched) return;
    if (watched) { resize.unobserve(watched); content.disconnect(); }
    watched = el;
    if (el) { resize.observe(el); content.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] }); }
    measure();
  };
  // The container is created lazily, so look for it as the page changes.
  new MutationObserver(attach).observe(document.body, { childList: true });
  window.addEventListener('resize', measure);
  attach();
}
