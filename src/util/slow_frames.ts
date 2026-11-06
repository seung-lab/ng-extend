/**
 * Freezes, named in the console (Nseraf, report 399: "a momentary
 * freeze/lag" opening the Δ menu or the cell type list, since a day or two).
 * The console goes with every report, so a line here says how long the page
 * stood still and what was running: the click or timer that started it and
 * the script it spent the time in, in Chrome and Edge (the Long Animation
 * Frames API). Elsewhere a timer notices the freeze and names the click or
 * key before it (startHeartbeat).
 */

/** Shorter than this is not a freeze anyone feels. */
const SLOW_MS = 250;
/** At most this many lines a minute, so a slow machine doesn't fill the log. */
const PER_MINUTE = 10;

let started = false;
export function startSlowFrameLog() {
  if (started) return;
  started = true;
  const PO = (window as any).PerformanceObserver;
  if (!PO?.supportedEntryTypes?.includes('long-animation-frame')) { startHeartbeat(); return; }
  let minute = 0, count = 0;
  try {
    new PO((list: any) => {
      for (const f of list.getEntries()) {
        if (f.duration < SLOW_MS) continue;
        const m = Math.floor(Date.now() / 60_000);
        if (m !== minute) { minute = m; count = 0; }
        if (++count > PER_MINUTE) continue;
        const scripts = [...(f.scripts ?? [])].sort((a: any, b: any) => b.duration - a.duration).slice(0, 3)
          .map((s: any) => {
            const where = String(s.sourceURL || '').split('/').pop()?.split('?')[0] || '';
            const fn = s.sourceFunctionName ? ` ${s.sourceFunctionName}` : '';
            const at = s.sourceCharPosition >= 0 ? `:${s.sourceCharPosition}` : '';
            return `${Math.round(s.duration)}ms ${s.invoker || s.invokerType || '?'} →${fn} ${where}${at}`;
          });
        // Where the time went when no one script is named (Celia 2026-11-06:
        // freezes of 600 ms with "no script named"): many short scripts, the
        // frame's rendering (style, layout, paint), or the wait before it.
        const end = f.startTime + f.duration;
        const scriptMs = Math.round([...(f.scripts ?? [])].reduce((t: number, s: any) => t + s.duration, 0));
        const renderMs = f.renderStart ? Math.round(end - f.renderStart) : 0;
        const layoutMs = f.styleAndLayoutStart ? Math.round(end - f.styleAndLayoutStart) : 0;
        const parts = [`scripts ${scriptMs}ms (${(f.scripts ?? []).length})`, `render ${renderMs}ms`, `layout ${layoutMs}ms`, `blocking ${Math.round(f.blockingDuration ?? 0)}ms`];
        console.warn(`[slow] page froze ${Math.round(f.duration)}ms, ${parts.join(', ')}: ${scripts.join(' | ') || 'no script over 5ms'}`);
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* not supported after all */ }
}

/** What the player last clicked or pressed, in a few words, so a freeze line
 *  says what came before it. */
function describe(el: EventTarget | null): string {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return '?';
  const text = (e.getAttribute?.('title') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const cls = typeof e.className === 'string' ? e.className.split(' ').filter(Boolean)[0] : '';
  return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
}

/** Firefox and Safari have no Long Animation Frames (Nseraf plays in
 *  Firefox, report 404: his freezes left no line). A timer that should tick
 *  every 50 ms notices when the page stood still, without saying which
 *  script; the line names the click or key just before it. */
function startHeartbeat() {
  let last = performance.now();
  let lastInput = '', lastInputAt = 0;
  const note = (what: string) => (e: Event) => { lastInput = `${what} ${e instanceof KeyboardEvent ? e.key : describe(e.target)}`; lastInputAt = performance.now(); };
  window.addEventListener('pointerdown', note('click'), true);
  window.addEventListener('keydown', note('key'), true);
  let minute = 0, count = 0;
  setInterval(() => {
    const now = performance.now();
    const gap = now - last - 50;
    last = now;
    if (gap < SLOW_MS || document.hidden) return;
    const m = Math.floor(Date.now() / 60_000);
    if (m !== minute) { minute = m; count = 0; }
    if (++count > PER_MINUTE) return;
    const after = lastInputAt && now - lastInputAt < gap + 2000 ? `, after ${lastInput}` : '';
    console.warn(`[slow] page froze about ${Math.round(gap)}ms${after} (no script names in this browser)`);
  }, 50);
}
