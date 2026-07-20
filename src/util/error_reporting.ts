/**
 * Client error reporting.
 *
 * WHY THIS EXISTS
 * `.vue` files get no type checking in this project (tsconfig has no `include`
 * so tsc skips SFCs entirely, and esbuild transpiles without checking
 * bindings). A ReferenceError in a `<script setup>` block shipped to production
 * and broke chat completely — every render threw, the panel never mounted, and
 * the only reason anyone found out was a person saying "we broke chat".
 *
 * This is the compensating control: catch it at runtime and record it, so the
 * next one surfaces in minutes with a stack trace instead of by report.
 *
 * DESIGN NOTES
 * - Vue's own errorHandler is the important one. Vue catches render/lifecycle
 *   errors internally, so `window.onerror` never sees them. The chat crash was
 *   exactly that class.
 * - Reporting is heavily throttled. That crash threw on EVERY render, which
 *   would be thousands of rows a minute. We report the FIRST occurrence of each
 *   distinct error and then stay quiet about it.
 * - Never throws, never blocks, never retries. A reporting failure must be
 *   completely invisible to the user.
 */

/** Distinct errors reported this session (fingerprint → times seen). */
const seen = new Map<string, number>();

/** Hard ceiling per page load, so a pathological loop can't flood the table. */
const MAX_REPORTS_PER_SESSION = 20;
let reportsSent = 0;

let installed = false;

/** Collapse an error to a stable key: message + first stack frame. */
function fingerprint(message: string, stack?: string): string {
  const frame = (stack || '').split('\n').find(l => /\s+at\s/.test(l))?.trim() || '';
  return `${message}::${frame}`;
}

/** Best-effort context. Every lookup is guarded — reporting must never throw. */
function context() {
  let userId: string | null = null;
  let dataset: string | null = null;
  try {
    // Imported lazily and defensively: the store may not exist yet if the
    // failure happened during bootstrap, which is precisely when we most want
    // the report to still go out.
    const w = window as any;
    userId = w.__ngeUserId ?? null;
    const layers = w.viewer?.layerManager?.managedLayers || [];
    for (const l of layers) {
      const cn = l?.layer?.constructor?.name || '';
      if (cn.includes('Segmentation') || l?.layer?.type === 'segmentation') {
        dataset = l.name || null;
        break;
      }
    }
  } catch { /* context is a nicety, not a requirement */ }
  return { userId, dataset };
}

async function report(
  message: string,
  stack: string | undefined,
  source: 'vue' | 'window' | 'promise',
  component?: string,
) {
  try {
    if (!message) return;
    if (reportsSent >= MAX_REPORTS_PER_SESSION) return;

    const key = fingerprint(message, stack);
    const priorCount = seen.get(key) || 0;
    seen.set(key, priorCount + 1);
    // Only the first occurrence is sent. A crash that fires on every render
    // would otherwise write thousands of identical rows.
    if (priorCount > 0) return;
    reportsSent++;

    const { userId, dataset } = context();
    const { supabase } = await import('../supabase');
    await supabase.from('client_errors').insert({
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : null,
      source,
      component: component || null,
      // Pathname only — the hash holds the whole viewer state (multiple KB).
      url: location.pathname.slice(0, 500),
      dataset,
      user_id: userId,
      user_agent: navigator.userAgent.slice(0, 500),
      build: (window as any).__ngeBuild || null,
    });
  } catch {
    // Swallow entirely. A failure to report an error must never itself become
    // a visible error, and must never recurse back into these handlers.
  }
}

/**
 * Install global handlers. Call once during bootstrap, passing the Vue app so
 * component errors are captured too.
 */
export function installErrorReporting(app?: { config: { errorHandler?: any } }) {
  if (installed) return;
  installed = true;

  // 1. Vue component errors — the class that broke chat. Vue swallows these
  //    into console.error, so nothing else sees them.
  if (app) {
    const previous = app.config.errorHandler;
    app.config.errorHandler = (err: any, instance: any, info: string) => {
      const name =
        instance?.$options?.__name ||
        instance?.$options?.name ||
        instance?.type?.__name ||
        undefined;
      report(err?.message || String(err), err?.stack, 'vue', `${name || 'unknown'} (${info})`);
      // Preserve existing behaviour and keep it visible in the console.
      if (typeof previous === 'function') previous(err, instance, info);
      else console.error('[vue error]', err, info);
    };
  }

  // 2. Uncaught errors outside Vue.
  window.addEventListener('error', (e: ErrorEvent) => {
    // Resource load failures (img/script 404s) surface here with no error
    // object; they're noise for this purpose.
    if (!e.error && !e.message) return;
    report(e.error?.message || e.message, e.error?.stack, 'window');
  });

  // 3. Rejected promises nobody handled — how most async failures escape.
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r: any = e.reason;
    report(r?.message || String(r), r?.stack, 'promise');
  });
}
