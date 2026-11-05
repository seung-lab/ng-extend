/**
 * A small chip that says when a player's work is not saved yet (save
 * failures audit, 2026-10-23, docs/SAVE-FAILURES-AUDIT.md).
 *
 *   Saving...                 a save is taking longer than a moment
 *   Couldn't save, retrying   saves are waiting for our server or for CAVE
 *   Saved                     the waiting saves went through (a few seconds)
 *
 * Hidden the rest of the time, so a normal edit shows nothing. Clicking it
 * while saves wait opens a box that says what is going on, with Try now
 * (toknow's "save problem", Ames 2026-11-01: "let's add an info box").
 */
type Source = 'activity' | 'cave';

const waiting: Record<Source, number> = { activity: 0, cave: 0 };
const nextTry: Record<Source, number> = { activity: 0, cave: 0 };
let inFlight = 0;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let slow = false;
let savedUntil = 0;
let tick: ReturnType<typeof setInterval> | null = null;
let el: HTMLButtonElement | null = null;
let box: HTMLDivElement | null = null;

function closeBox() { box?.remove(); box = null; }
/** The info box, over the chip. Plain text only. */
function openBox() {
  closeBox();
  box = document.createElement('div');
  box.id = 'nge-save-info';
  box.setAttribute('role', 'status');
  Object.assign(box.style, {
    position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: '76px', zIndex: '9001', width: 'min(360px, calc(100vw - 32px))',
    padding: '12px 14px', borderRadius: '10px', font: '13px/1.45 system-ui, sans-serif', color: '#e8eef5',
    background: 'rgba(16, 22, 30, 0.97)', border: '1px solid rgba(245, 165, 36, 0.45)', boxShadow: '0 6px 22px rgba(0, 0, 0, 0.5)',
  } as Partial<CSSStyleDeclaration>);
  const lead = document.createElement('div');
  lead.textContent = 'Your work is safe.';
  Object.assign(lead.style, { fontWeight: '700', marginBottom: '4px' });
  const why: string[] = [];
  if (waiting.cave) why.push(`${waiting.cave} save${waiting.cave === 1 ? ' is' : 's are'} waiting for CAVE, the lab's data server.`);
  if (waiting.activity) why.push(`${waiting.activity} edit${waiting.activity === 1 ? ' is' : 's are'} waiting for Pyr's server.`);
  const body = document.createElement('div');
  body.textContent = `${why.join(' ')} This happens when the servers are slow, and it usually clears by itself. It is kept in this browser and sent automatically, even if you reload, so there is nothing to redo.`;
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' });
  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, { padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.25)', background: 'transparent', color: '#e8eef5', cursor: 'pointer', font: 'inherit' });
    b.addEventListener('click', onClick);
    return b;
  };
  row.append(button('Close', closeBox), button('Try now', () => { closeBox(); window.dispatchEvent(new CustomEvent('nge:save-retry-now')); }));
  box.append(lead, body, row);
  document.body.appendChild(box);
}

function chip(): HTMLButtonElement | null {
  if (el) return el;
  if (typeof document === 'undefined' || !document.body) return null;
  el = document.createElement('button');
  el.id = 'nge-save-status';
  el.type = 'button';
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: '40px', zIndex: '9000', display: 'none',
    alignItems: 'center', gap: '7px', padding: '5px 11px', borderRadius: '999px',
    font: '600 12px/1.3 system-ui, sans-serif', color: '#e8eef5', cursor: 'default',
    background: 'rgba(16, 22, 30, 0.92)', border: '1px solid rgba(255, 255, 255, 0.14)',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.35)',
  } as Partial<CSSStyleDeclaration>);
  el.addEventListener('click', () => {
    if (waiting.activity + waiting.cave === 0) return;
    if (box) closeBox(); else openBox();
  });
  document.body.appendChild(el);
  return el;
}

function render() {
  const c = chip();
  if (!c) return;
  const total = waiting.activity + waiting.cave;
  const now = Date.now();
  let dot = '', text = '', title = '';
  if (total > 0) {
    const soonest = Math.min(...(['activity', 'cave'] as Source[]).filter(s => waiting[s] && nextTry[s] > now).map(s => nextTry[s]), Infinity);
    const secs = Number.isFinite(soonest) ? Math.max(1, Math.round((soonest - now) / 1000)) : 0;
    dot = '#f5a524';
    text = "Couldn't save, retrying";
    if (secs) text += ` in ${secs >= 60 ? Math.round(secs / 60) + ' min' : secs + ' s'}`;
    const parts: string[] = [];
    if (waiting.activity) parts.push(`${waiting.activity} edit${waiting.activity === 1 ? '' : 's'} waiting for the Pyr server`);
    if (waiting.cave) parts.push(`${waiting.cave} save${waiting.cave === 1 ? '' : 's'} waiting for CAVE`);
    title = `${parts.join(', ')}. Your work is kept in this browser and sent as soon as the server answers, even after a reload. Click to try now.`;
    c.style.cursor = 'pointer';
  } else if (slow && inFlight > 0) {
    dot = '#7aa7ff';
    text = 'Saving...';
    title = 'Sending your edit to the server.';
    c.style.cursor = 'default';
  } else if (savedUntil > now) {
    dot = '#3ecf8e';
    text = 'Saved';
    title = 'Everything that was waiting has been saved.';
    c.style.cursor = 'default';
  }
  if (total === 0) closeBox();
  if (!text) { c.style.display = 'none'; return; }
  c.style.display = 'inline-flex';
  c.title = total > 0 ? "Your work is safe. Click for what's going on." : title;
  c.innerHTML = '';
  const d = document.createElement('span');
  Object.assign(d.style, { width: '8px', height: '8px', borderRadius: '50%', background: dot, flex: 'none' });
  const t = document.createElement('span');
  t.textContent = text;
  c.append(d, t);
  // Says there is more to read.
  if (total > 0) {
    const i = document.createElement('span');
    i.textContent = 'ⓘ';
    i.setAttribute('aria-hidden', 'true');
    i.style.opacity = '0.75';
    c.append(i);
  }
}

function ensureTick() {
  const busy = waiting.activity + waiting.cave > 0 || savedUntil > Date.now();
  if (busy && !tick) tick = setInterval(render, 1000);
  if (!busy && tick) { clearInterval(tick); tick = null; }
}

/** How many saves of one kind wait, and when the next try is. */
export function noteSaveWaiting(source: Source, count: number, nextAt = 0) {
  const before = waiting.activity + waiting.cave;
  waiting[source] = Math.max(0, count);
  nextTry[source] = nextAt;
  if (before > 0 && waiting.activity + waiting.cave === 0) {
    savedUntil = Date.now() + 4000;
    setTimeout(() => { ensureTick(); render(); }, 4050);
  }
  ensureTick();
  render();
}

/** Wrap one save so a slow one shows "Saving...". */
export async function trackSave<T>(work: Promise<T>): Promise<T> {
  inFlight++;
  if (!slowTimer) slowTimer = setTimeout(() => { slowTimer = null; slow = true; render(); }, 1200);
  try { return await work; }
  finally {
    inFlight--;
    if (inFlight === 0) {
      if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
      slow = false;
      render();
    }
  }
}

// CAVE's own waiting list (cave_outbox.ts) says how many it holds.
if (typeof document !== 'undefined') {
  document.addEventListener('nge:cave-outbox', e => {
    const d = (e as CustomEvent).detail || {};
    noteSaveWaiting('cave', Number(d.waiting) || 0, Number(d.nextAt) || 0);
  });
}

// For checking from the console and in tests.
if (typeof window !== 'undefined') (window as any).__ngeNoteSaveWaiting = noteSaveWaiting;
