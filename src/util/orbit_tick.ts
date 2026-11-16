/**
 * The Cell Library's JUMP-button orbit: one mote at a time, handed from row
 * to row every 2.8 s. The tick lives here, read only by OrbitDot.vue, so it
 * redraws the dots and not the whole panel. It runs while some panel that
 * uses it is open, and not in a hidden tab.
 */
import { onBeforeUnmount, ref } from 'vue';

export const orbitSeq = ref(0);
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Call from a component's setup: ticks while that component is mounted. */
export function useOrbitTick() {
  users++;
  if (!timer) timer = setInterval(() => { if (!document.hidden) orbitSeq.value += 1; }, 2800);
  onBeforeUnmount(() => {
    users--;
    if (!users && timer) { clearInterval(timer); timer = null; }
  });
}
