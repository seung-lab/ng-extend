/**
 * Which other Pyr tabs are open in this browser. Players often keep several
 * tabs open at once (Ames 2026-10-20), so anything a tab remembers in shared
 * browser storage must know whether another tab may be using it too.
 *
 * Each tab says hello on a BroadcastChannel when it opens, answers a hello,
 * and says goodbye when it closes. Same browser and site only.
 */
const CHANNEL = 'pyr-tabs';
const others = new Set<string>();
const me = Math.random().toString(36).slice(2) + Date.now().toString(36);
let channel: BroadcastChannel | null = null;

export function startTabs(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data || {};
    if (typeof m.id !== 'string' || m.id === me) return;
    if (m.kind === 'hello') { others.add(m.id); channel?.postMessage({ kind: 'here', id: me }); }
    else if (m.kind === 'here') others.add(m.id);
    else if (m.kind === 'bye') others.delete(m.id);
  };
  channel.postMessage({ kind: 'hello', id: me });
  window.addEventListener('pagehide', () => channel?.postMessage({ kind: 'bye', id: me }));
}

/** How many other Pyr tabs answered. Known a moment after this tab opens. */
export function otherTabCount(): number {
  return others.size;
}
