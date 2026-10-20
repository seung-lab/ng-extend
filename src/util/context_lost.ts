/**
 * When the graphics card takes the drawing back from a tab, the 2D and 3D
 * views go blank. Chrome usually hands it back and the page reloads itself
 * (neuroglancer's display_context.ts), but with many tabs open it may not
 * (Nseraf #182, lost 3D in one of several tabs). Say so, and offer a reload.
 */
const WAIT_MS = 4000;

export function startContextLostNotice(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The event does not bubble, so listen on the way down.
  window.addEventListener('webglcontextlost', () => {
    if (timer) return;
    timer = setTimeout(show, WAIT_MS);
  }, true);
  window.addEventListener('webglcontextrestored', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  }, true);
}

function show() {
  if (document.getElementById('nge-context-lost')) return;
  const bar = document.createElement('div');
  bar.id = 'nge-context-lost';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;'
    + 'background:#1b2333;color:#e6edf7;border:1px solid #4a6fa5;border-radius:8px;padding:10px 14px;'
    + 'font:13px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.5)';
  const text = document.createElement('span');
  text.textContent = 'The views stopped drawing: your graphics card ran short, which can happen with several Pyr tabs open. Reloading this tab brings them back.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Reload this tab';
  btn.style.cssText = 'background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit;white-space:nowrap';
  btn.onclick = () => window.location.reload();
  bar.append(text, btn);
  document.body.appendChild(bar);
}
