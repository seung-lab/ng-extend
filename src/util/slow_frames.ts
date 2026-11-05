/**
 * Freezes, named in the console (Nseraf, report 399: "a momentary
 * freeze/lag" opening the Δ menu or the cell type list, since a day or two).
 * The console goes with every report, so a line here says how long the page
 * stood still and what was running: the click or timer that started it and
 * the script it spent the time in. Chrome and Edge only (the Long Animation
 * Frames API); elsewhere nothing happens.
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
  if (!PO?.supportedEntryTypes?.includes('long-animation-frame')) return;
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
        const style = Math.round(f.styleAndLayoutStart ? f.startTime + f.duration - f.styleAndLayoutStart : 0);
        console.warn(`[slow] page froze ${Math.round(f.duration)}ms${style > 50 ? ` (layout ${style}ms)` : ''}: ${scripts.join(' | ') || 'no script named'}`);
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* not supported after all */ }
}
