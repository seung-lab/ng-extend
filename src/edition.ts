/**
 * The Princeton Tracers edition (Ames, 2026-10-16).
 *
 * Professional tracers at Princeton play the same game on its own address,
 * princeton-tracers-dot-brain-wire-dot-seung-lab.ue.r.appspot.com, built from
 * the `princeton-tracers` branch. Everything that differs for them checks
 * TRACER_EDITION, which is true only on that address (or with ?tracers in the
 * address, for testing on a dev server). On any other address this file
 * changes nothing, so the branch can merge from live, or into it, without
 * drifting.
 *
 * What differs:
 *   - a first open starts the Tracer Tour (tutorial 12, src/tracer-tour.ts),
 *     never Get Started and its push into the Merge tutorial;
 *   - an address with no view in it opens MEC, not the Sandbox
 *     (src/edition_start.ts).
 *
 * No imports here, so the stores can read it without a cycle.
 */
export const TRACER_EDITION: boolean = (() => {
  try {
    return location.hostname.startsWith('princeton-tracers-dot-')
      || new URLSearchParams(location.search).has('tracers');
  } catch {
    return false;
  }
})();

/** The Tracer Tour's tutorial number (Tutorial.vue, store-pyr.ts). */
export const TRACER_TOUR = 12;
