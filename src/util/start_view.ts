/**
 * A player's own start view for a dataset: a share link they paste in
 * Settings, loaded instead of the curated view whenever they switch to that
 * dataset (store.ts selectLayers).
 *
 * Only neuroglancer state hashes are accepted: inline JSON state, or a saved
 * state on one of the state servers this app already uses. A link that points
 * the viewer at some other server's state file is refused, so a pasted link
 * can only ever describe a view, never pull state from an unknown host.
 */
const STATE_SERVER = /^(?:middleauth\+)?https:\/\/(?:global\.brain-wire-test\.org|global\.daf-apis\.com)\/nglstate\/api\/v1\/\d+\/?$/;

/** The '#!...' part of a share link if it is one we accept, else ''. */
export function startViewHash(link: string | undefined | null): string {
  const s = String(link || '').trim();
  const i = s.indexOf('#!');
  if (i < 0) return '';
  const hash = s.slice(i);
  const body = hash.slice(2);
  let decoded = body;
  try { decoded = decodeURIComponent(body); } catch { /* keep raw */ }
  if (decoded.startsWith('{')) return hash;
  if (STATE_SERVER.test(decoded)) return hash;
  return '';
}
