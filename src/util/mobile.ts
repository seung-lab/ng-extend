/**
 * Mobile mode detection.
 *
 * One source of truth for "are we on a phone sized screen": a live media
 * query that combines coarse pointer (real phones and tablets) with a plain
 * width fallback (so a narrow desktop window can preview the mobile layout).
 *
 * Consumers:
 *   · CSS: body gets the `nge-mobile` class, every mobile override in
 *     mobile.css is scoped under it so desktop styles never change.
 *   · Vue: `isMobileRef` is a reactive ref for v-if template gating
 *     (bottom nav, mobile welcome sheet).
 *
 * The query stays live: rotating a tablet or resizing a window flips the
 * class and the ref without a reload.
 */
import {ref} from 'vue';

export const MOBILE_MEDIA_QUERY =
    '(max-width: 900px) and (pointer: coarse), (max-width: 640px)';

export const isMobileRef = ref(false);

/**
 * True while the mobile welcome sheet (the phone landing page) is showing.
 * LoginModal watches this to stay out of the way: on phones the welcome
 * sheet IS the landing experience, and identity verification only appears
 * when the visitor taps its Log in button (or dismisses the sheet).
 */
export const mobileWelcomeOpenRef = ref(false);

export function isMobile(): boolean {
  return isMobileRef.value;
}

export function installMobileMode() {
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  const apply = () => {
    isMobileRef.value = mq.matches;
    document.body.classList.toggle('nge-mobile', mq.matches);
  };
  // Older Safari only has the deprecated addListener form.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', apply);
  } else {
    (mq as any).addListener(apply);
  }
  apply();
  // Belt and braces for iPhone Safari (see mobile.css): if the page is ever
  // slid up anyway (the browser bar showing, the keyboard closing), put it
  // back, so the top bar never ends up under the status bar.
  const unslide = () => {
    if (!isMobileRef.value) return;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', unslide, { passive: true });
  window.visualViewport?.addEventListener('resize', unslide);
  trackKeyboard();
}

/**
 * Typing in chat on a phone (Ames 2026-10-05: "chat needs to be more usable
 * on a phone"). The on-screen keyboard does not shrink the page; it covers
 * the bottom of it. The chat sheet is pinned to the bottom of the page, so
 * its message box sat behind the keyboard and you typed blind.
 *
 * The browser does say what part of the page is still visible (the visual
 * viewport). While the keyboard is up and the cursor is in chat, body gets
 * `nge-kb-chat` and two lengths, and mobile.css fits the chat sheet to
 * exactly that visible part: messages above, the message box resting on the
 * keyboard.
 */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const body = document.body;
    // A keyboard, not a browser bar sliding: well over 120px of the page is covered.
    const covered = window.innerHeight - vv.height;
    const inChat = !!(document.activeElement as HTMLElement | null)?.closest?.('.nge-chat-float');
    const on = isMobileRef.value && inChat && covered > 120;
    if (on) {
      body.style.setProperty('--nge-vv-top', `${Math.max(0, vv.offsetTop)}px`);
      body.style.setProperty('--nge-vv-h', `${Math.round(vv.height)}px`);
    }
    if (body.classList.contains('nge-kb-chat') !== on) body.classList.toggle('nge-kb-chat', on);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  // The keyboard follows focus: check when the cursor enters or leaves chat.
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', () => setTimeout(schedule, 60));
}
