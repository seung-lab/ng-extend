/**
 * Ask before the tab closes on Ctrl+W (Nseraf 2026-10-11: "I have mistakenly
 * clicked ctrl + w, wanting to click 2 or 3 above w ... which closes the
 * tab"). Ctrl+2 and Ctrl+3 sit right above W.
 *
 * A page cannot see or stop Ctrl+W itself: the browser keeps that key. It can
 * only ask "Leave site?" as the page goes, and that question would also come
 * up on every refresh, which players do all day. So it is asked only when
 * the page is going while Ctrl is held and the last key pressed was not one
 * of the refresh keys. Ctrl+W and Ctrl+F4 never reach the page as keys;
 * Ctrl+R, Ctrl+Shift+R and F5 do, so a refresh is told apart and goes
 * straight through.
 *
 * The browser shows its own wording and may skip the question on a page that
 * has not been clicked or typed in yet.
 */
export function startCloseGuard() {
  let ctrlHeld = false;
  let lastKey = '';
  const note = (e: KeyboardEvent) => { ctrlHeld = e.ctrlKey || e.metaKey; };
  window.addEventListener('keydown', e => { note(e); if (e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Shift') lastKey = e.key.toLowerCase(); }, true);
  window.addEventListener('keyup', e => { note(e); if (!ctrlHeld) lastKey = ''; }, true);
  // Ctrl let go while another window had the keyboard: do not go on believing it is held.
  window.addEventListener('blur', () => { ctrlHeld = false; lastKey = ''; });
  window.addEventListener('beforeunload', e => {
    if (!ctrlHeld) return;
    if (lastKey === 'r' || lastKey === 'f5') return;
    e.preventDefault();
    e.returnValue = '';
  });
}
