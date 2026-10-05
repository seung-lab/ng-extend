/**
 * The last few console warnings and errors, kept so a player can attach them
 * to "Submit an issue" (Ames 2026-09-29). Crash-type errors already go to
 * client_errors on their own (error_reporting.ts); this also catches the
 * warnings, like a tutorial step whose view stalled, that explain a report.
 *
 * Installed first thing in main.ts. Anything that looks like a credential is
 * blanked before it is stored.
 */

const MAX_ENTRIES = 60;
const MAX_ENTRY_CHARS = 600;

type Entry = { t: number; level: 'warn' | 'error'; text: string };
const entries: Entry[] = [];
let installed = false;

function redact(s: string): string {
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(/((?:access_?token|token|apikey|api_key|key|password|secret)["']?\s*[:=]\s*["']?)[^"'\s&,}]{6,}/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt redacted]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}/g, '[key redacted]');
}

function stringify(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack.split('\n').slice(1, 4).join('\n') : ''}`;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function push(level: Entry['level'], args: unknown[]) {
  try {
    let text = args.map(stringify).join(' ');
    if (text.length > MAX_ENTRY_CHARS) text = text.slice(0, MAX_ENTRY_CHARS) + ' …';
    entries.push({ t: Date.now(), level, text: redact(text) });
    if (entries.length > MAX_ENTRIES) entries.shift();
  } catch { /* never let logging break the page */ }
}

export function installConsoleBuffer() {
  if (installed) return;
  installed = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { push(level, args); original(...args); };
  }
  // An error from a background worker arrives with a message but no Error
  // object, so no stack ("Cannot read properties of undefined (reading
  // 'has')", Ames 2026-10-04, could not be traced). Keep where it came from.
  window.addEventListener('error', e => {
    if (e.error) { push('error', [e.error]); return; }
    const file = (e.filename || '').split('/').pop()?.split('?')[0] || '';
    push('error', [file ? `${e.message} (${file}:${e.lineno}:${e.colno})` : e.message]);
  });
  window.addEventListener('unhandledrejection', e => push('error', ['Unhandled promise rejection:', (e as PromiseRejectionEvent).reason]));
}

export function recentConsoleCount(): number { return entries.length; }

/** Newest last, one line per entry: "10:37:02 WARN message". */
export function recentConsoleText(): string {
  return entries.map(e => {
    const d = new Date(e.t);
    const hh = d.toTimeString().slice(0, 8);
    return `${hh} ${e.level.toUpperCase()} ${e.text}`;
  }).join('\n');
}
