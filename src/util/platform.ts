/**
 * Platform-aware keyboard shortcut labels.
 *
 * The toolbar used to hard-code "⌘K", which is Mac notation — most users here
 * are on Windows, where that symbol means nothing. Anything that renders a
 * shortcut should go through these helpers so it reads correctly on the user's
 * actual platform.
 */

/** True on macOS (and iPadOS, which reports MacIntel). */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as any).userAgentData?.platform || navigator.platform || '';
  return /mac/i.test(p);
}

/** The primary modifier's display name: "⌘" on Mac, "Ctrl" elsewhere. */
export function modKeyLabel(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/**
 * Render a shortcut for display, e.g. shortcutLabel('K') →
 * "⌘K" on Mac, "Ctrl+K" on Windows/Linux.
 */
export function shortcutLabel(key: string): string {
  return isMac() ? `⌘${key}` : `Ctrl+${key}`;
}
