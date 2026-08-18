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
}
