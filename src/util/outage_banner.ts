/**
 * A message to every player that needs nothing from the database (Ames
 * 2026-10-25: Supabase stopped answering, so chat, profiles and notifications
 * were all down, and there was no way to tell players). It is built into the
 * game: set the text and deploy; clear it and deploy again when it is over.
 */
const OUTAGE_MESSAGE = "We're having server trouble: chat, profiles and notifications are down for now. Merging and cutting still work, and your edits will be counted once it is back. We're on it!";

export function showOutageBanner(): void {
  if (!OUTAGE_MESSAGE) return;
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:100000;margin-top:6px;' +
    'max-width:min(720px,92vw);padding:8px 14px;border-radius:8px;font:600 13px/1.35 Inter,sans-serif;' +
    'color:#1a1204;background:#ffcf5a;box-shadow:0 4px 18px rgba(0,0,0,.45);display:flex;gap:10px;align-items:center';
  const text = document.createElement('span');
  text.textContent = OUTAGE_MESSAGE;
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Hide this message');
  close.style.cssText = 'background:none;border:0;font:700 18px/1 Inter,sans-serif;color:#1a1204;cursor:pointer;padding:0 2px';
  close.addEventListener('click', () => bar.remove());
  bar.append(text, close);
  const add = () => document.body.appendChild(bar);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add, { once: true });
}
