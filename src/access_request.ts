/**
 * access_request.ts: retina access requests (Ames, 2026-10-16). The EyeWire II
 * Dataset Access form, in the game: 7 cut examples (an accidental merger, with
 * red and blue Multicut points where the player would cut) and 3 merge
 * examples (an accidental split, with merge points on the two pieces), the points placed but never submitted. Each one is the
 * player's view, saved as a share link plus what is in it, so a reviewer can
 * open it and judge every point. Server: functions/access-request.js
 * (ewAccessRequest). Panel: components/AccessRequestPanel.vue. Review: the
 * Admin Hub's Access requests tab.
 */
import { ref } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { secureWrite } from './secure_write';
import { mintShortStateLink } from './util/state_link';
import { currentSegLayer, currentDatasetTag } from './datasets';

export type AccessKind = 'cut' | 'merge';
export const ACCESS_SLOTS: Record<AccessKind, number> = { cut: 7, merge: 3 };

export interface AccessPoint { position: number[]; segmentId?: string; rootId?: string }
/** The point kinds an example carries: Multicut red and blue for a cut, the
 *  merge tool's points for a merge (two per merge, the ends in order). */
export type AccessColor = 'red' | 'blue' | 'merge';
export interface AccessItem {
  id?: number; request_id?: number;
  kind: AccessKind; slot: number; link: string; dataset: string | null; note: string | null;
  points: { red?: AccessPoint[]; blue?: AccessPoint[]; merge?: AccessPoint[] }; segments: string[]; position: number[] | null;
  saved_at?: string; verdict?: 'good' | 'redo' | null; point_marks?: Record<string, 'good' | 'off'>; feedback?: string | null;
  /** Reviewer side: this slot's earlier examples, kept when the player replaced them. */
  earlier?: (AccessItem & { try?: number; replaced_at?: string })[];
}
export interface AccessRequest {
  id: number; status: 'draft' | 'submitted' | 'redo' | 'invited'; tries: number; affiliation: string | null;
  eyewire_username?: string | null; player_note?: string | null;
  submitted_at: string | null; reviewed_at: string | null; reviewer_note: string | null;
  // Reviewer side only.
  email?: string; player_name?: string; user_id?: string; pilot_added?: boolean; items?: AccessItem[];
  removed?: (AccessItem & { try?: number; replaced_at?: string })[];
}
export interface AccessMine { request: AccessRequest | null; items: AccessItem[] }

/** The player's own request, shared by the menu line and the panel. */
export const myAccess = ref<AccessMine | null>(null);

export async function loadMyAccess(): Promise<AccessMine> {
  const mine = await secureWrite<AccessMine>('access.mine');
  myAccess.value = mine;
  return mine;
}

/** What is in the view right now: Multicut points, merge points, pieces shown. */
export function viewContents(): { red: AccessPoint[]; blue: AccessPoint[]; merge: AccessPoint[]; segments: string[]; cutCell?: string } {
  const out = { red: [] as AccessPoint[], blue: [] as AccessPoint[], merge: [] as AccessPoint[], segments: [] as string[], cutCell: undefined as string | undefined };
  try {
    const ml = currentSegLayer();
    const layer = ml?.layer;
    const state = layer?.graphConnection?.value?.state;
    const multicut = state?.multicutState;
    const toPoint = (s: any): AccessPoint => ({
      position: Array.from(s?.position ?? []).map(Number),
      ...(s?.segmentId != null ? { segmentId: String(s.segmentId) } : {}),
      ...(s?.rootId != null ? { rootId: String(s.rootId) } : {}),
    });
    // Neuroglancer's red group is the sinks, the blue group the sources.
    if (multicut) {
      out.red = [...multicut.sinks].map(toPoint).filter(p => p.position.length === 3);
      out.blue = [...multicut.sources].map(toPoint).filter(p => p.position.length === 3);
      // The cell the points are on. It can be hidden while cut mode is
      // closed, and a saved view must show it (whyNot).
      if (multicut.focusSegment?.value != null) out.cutCell = String(multicut.focusSegment.value);
    }
    // Merge points placed with the merge tool (M, Ctrl+click two pieces) and
    // not submitted: each pending merge has both ends and no merged root.
    const merges = state?.mergeState?.merges?.value;
    if (Array.isArray(merges)) {
      for (const m of merges) {
        if (!m?.source || !m?.sink || m.mergedRoot || m.locked) continue;
        const a = toPoint(m.sink), b = toPoint(m.source);
        if (a.position.length === 3 && b.position.length === 3) out.merge.push(a, b);
      }
    }
    const visible = layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (visible) out.segments = [...visible].map((s: any) => String(s));
  } catch (e) {
    console.warn('[access] could not read the view:', e);
  }
  return out;
}

/** Why this view cannot be saved as that kind of example, or ''. */
export function whyNot(kind: AccessKind, v = viewContents()): string {
  if (kind === 'cut' && (!v.red.length || !v.blue.length)) {
    return 'Place red and blue Multicut points on each side of where you would cut. Do not press Cut.';
  }
  // A view whose points sit on a hidden cell shows the reviewer points in empty space.
  if (kind === 'cut' && v.cutCell && !v.segments.includes(v.cutCell)) return 'Show the cell your points are on, then save.';
  if (kind === 'merge' && v.merge.length < 2) {
    return 'Press M and Ctrl+click the two pieces you would join. Do not press Submit merge.';
  }
  return '';
}

function viewPosition(): number[] | null {
  try {
    const pos = (window as any).viewer?.position?.value;
    return pos && pos.length === 3 ? Array.from(pos as ArrayLike<number>).map(Number) : null;
  } catch { return null; }
}

/** Save the view as one example. Throws a sentence the player can act on. */
export async function saveExample(kind: AccessKind, slot: number, note: string, eyewireUsername: string): Promise<AccessMine> {
  const v = viewContents();
  const reason = whyNot(kind, v);
  if (reason) throw new Error(reason);
  const link = await mintShortStateLink();
  if (!link) throw new Error('A link to this view could not be made. Check that you are signed in, then try again.');
  const mine = await secureWrite<AccessMine>('access.save', {
    kind, slot, link, dataset: currentDatasetTag(), note,
    points: kind === 'cut' ? { red: v.red, blue: v.blue } : { merge: v.merge },
    segments: v.segments, position: viewPosition(), eyewireUsername,
  });
  myAccess.value = mine;
  clearToolPoints(kind);
  return mine;
}

/** Clear the points just saved, so the next example starts fresh (Ames
 *  2026-10-16: points from earlier examples piled up). The saved link keeps
 *  them. Through the cut and merge bar's own Clear when it is open, else
 *  straight on the layer's state. */
function clearToolPoints(kind: AccessKind) {
  try {
    const detail: { kind: AccessKind; done?: boolean } = { kind };
    document.dispatchEvent(new CustomEvent('nge:clear-tool-points', { detail }));
    if (detail.done) return;
    const state = currentSegLayer()?.layer?.graphConnection?.value?.state;
    if (kind === 'merge') { if (state?.mergeState?.merges) state.mergeState.merges.value = []; }
    else state?.multicutState?.reset?.();
  } catch (e) { console.warn('[access] could not clear the points:', e); }
}

export async function removeExample(kind: AccessKind, slot: number): Promise<AccessMine> {
  const mine = await secureWrite<AccessMine>('access.remove', { kind, slot });
  myAccess.value = mine;
  return mine;
}

/** Take sent examples back to change them; the next send is a new try. */
export async function withdrawAccess(): Promise<AccessMine> {
  const mine = await secureWrite<AccessMine>('access.withdraw');
  myAccess.value = mine;
  return mine;
}

export async function submitAccess(eyewireUsername: string, note: string): Promise<AccessMine> {
  const mine = await secureWrite<AccessMine>('access.submit', { eyewireUsername, note });
  myAccess.value = mine;
  return mine;
}

/** Move the view to a point (viewer coordinates). */
export function flyTo(position: number[] | null | undefined) {
  try {
    const viewer = (window as any).viewer;
    if (!viewer || !position || position.length !== 3) return;
    viewer.position.value = Float32Array.from(position);
  } catch (e) { console.warn('[access] fly to failed:', e); }
}

/** A point's name in a list: "red 2", or "merge 1a" for the first end of merge 1. */
export function pointName(color: AccessColor, i: number): string {
  return color === 'merge' ? `merge ${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}` : `${color} ${i + 1}`;
}

/** The menu's word for where the player's request stands. */
export function accessStatusLabel(mine: AccessMine | null): string {
  const s = mine?.request?.status;
  if (s === 'submitted') return 'sent';
  if (s === 'redo') return 'notes waiting';
  if (s === 'invited') return 'invited';
  const n = mine?.items?.length ?? 0;
  return n ? `${n} of 10` : '';
}

// ── Reviewers (Admin Hub > Access requests, and the bar in the view) ─────

export type AccessFilter = 'open' | 'submitted' | 'invited' | 'all';

export async function listAccessRequests(status: AccessFilter = 'open'): Promise<AccessRequest[]> {
  const out = await secureWrite<{ requests: AccessRequest[] }>('access.list', { status });
  return out.requests;
}

export async function reviewAccessItem(itemId: number, patch: { verdict?: 'good' | 'redo' | null; pointMarks?: Record<string, 'good' | 'off'>; feedback?: string }): Promise<AccessItem> {
  return secureWrite<AccessItem>('access.review', { itemId, ...patch });
}

export async function decideAccess(requestId: number, outcome: 'redo' | 'invited', note: string, byHand = false) {
  return secureWrite<AccessRequest & { redos: number; pilot_added: boolean; cave_granted: boolean }>('access.decide', { requestId, outcome, note, ...(byHand ? { byHand: true } : {}) });
}

/** Admins: delete a request and its examples (no id: your own), so it can
 *  start over. For testing, or a player who wants a clean slate. */
export async function resetAccess(requestId?: number): Promise<void> {
  await secureWrite('access.reset', requestId != null ? { requestId } : {});
  if (requestId == null) myAccess.value = { request: null, items: [] };
}

/** The request a reviewer is looking at in the view, and which example. */
export const reviewing = ref<{ request: AccessRequest; index: number } | null>(null);

/** Leave the Admin Hub and open one example in the view, with the review bar. */
export function reviewInView(request: AccessRequest, index: number) {
  reviewing.value = { request, index };
  const it = request.items?.[index];
  document.dispatchEvent(new CustomEvent('nge:access-review'));
  if (it) openExample(it);
}

/** Load an example's view in place, then draw its points (see
 *  showReviewPoints); a link we cannot load opens in a new tab. */
export function openExample(it: AccessItem) {
  try {
    const hash = new URL(it.link).hash;
    if (hash.startsWith('#!')) {
      if (window.location.hash !== hash) window.location.hash = hash;
      showReviewPoints(it);
      return;
    }
  } catch { /* fall through */ }
  window.open(it.link, '_blank', 'noopener');
}

// ── Review mode: the example's points, drawn by Pyr (Ames 2026-10-16) ─────
// Neuroglancer draws Multicut and merge points only while its tool is on,
// so a reviewer opening the link saw the cells and no points. Review mode
// adds them as annotation layers of their own, and makes the cells partly
// see through (Ames: "default to partial opacity in review mode"), so a point
// inside or behind a cell still shows. Both go when review mode ends.
const REVIEW_LAYERS: Record<AccessColor, { name: string; color: string }> = {
  red: { name: 'Review red', color: '#ff4040' },
  blue: { name: 'Review blue', color: '#4f7bff' },
  merge: { name: 'Review merge', color: '#ff4fd8' },
};
const REVIEW_ALPHA = 0.5;
let reviewTimer: number | undefined;

function segLayers(): any[] {
  const v = (window as any).viewer;
  return (v?.layerManager?.managedLayers ?? []).filter((ml: any) => ml?.layer?.displayState?.objectAlpha);
}

function placeReviewPoints(it: AccessItem): boolean {
  const v = (window as any).viewer;
  if (!v?.layerSpecification) return false;
  const managed = v.layerManager?.managedLayers ?? [];
  for (const ml of [...managed]) if (Object.values(REVIEW_LAYERS).some(r => r.name === ml.name)) v.layerManager.removeManagedLayer(ml);
  for (const color of ['red', 'blue', 'merge'] as const) {
    const pts = it.points[color] ?? [];
    if (!pts.length) continue;
    const spec = { type: 'annotation', source: { url: 'local://annotations' }, annotationColor: REVIEW_LAYERS[color].color, pointSize: 8,
      annotations: pts.map((p, i) => ({ type: 'point', id: `${color}-${i}`, point: p.position, description: pointName(color, i) })) };
    v.layerSpecification.add(makeLayer(v.layerSpecification, REVIEW_LAYERS[color].name, spec));
  }
  for (const ml of segLayers()) ml.layer.displayState.objectAlpha.value = REVIEW_ALPHA;
  return true;
}

/** The link loads a while after the hash changes (seconds, on real data)
 *  and replaces every layer, the drawn points too (Ames 2026-10-16: still no
 *  points). So for as long as this example is being reviewed, the points and
 *  the opacity are put back whenever they are gone. */
export function showReviewPoints(it: AccessItem) {
  window.clearInterval(reviewTimer);
  const want = (['red', 'blue', 'merge'] as const).filter(c => (it.points[c] ?? []).length)
    .map(c => ({ name: REVIEW_LAYERS[c].name, n: (it.points[c] ?? []).length }));
  const have = () => {
    const ls = (window as any).viewer?.layerManager?.managedLayers ?? [];
    const count = (name: string) => {
      const l = ls.find((x: any) => x.name === name);
      try { return l?.layer?.localAnnotations ? l.layer.localAnnotations.toJSON().length : -1; } catch { return -1; }
    };
    return want.every(w => count(w.name) === w.n) && segLayers().every(ml => ml.layer.displayState.objectAlpha.value === REVIEW_ALPHA);
  };
  let first = true;
  reviewTimer = window.setInterval(() => {
    // A layer that is still loading reports no annotations yet: wait a beat
    // before the first placing, then put back whatever went missing.
    if (first) { first = false; return; }
    if (!have()) placeReviewPoints(it);
  }, 600);
}

/** Review mode ends: the drawn points go, the cells are solid again. */
export function endReview() {
  window.clearInterval(reviewTimer);
  try {
    const v = (window as any).viewer;
    for (const ml of [...(v?.layerManager?.managedLayers ?? [])]) {
      if (Object.values(REVIEW_LAYERS).some(r => r.name === ml.name)) v.layerManager.removeManagedLayer(ml);
    }
    for (const ml of segLayers()) ml.layer.displayState.objectAlpha.value = 1;
  } catch (e) { console.warn('[access] could not end review mode:', e); }
}

/** Back to the list in the Admin Hub. */
export function backToRequests() {
  reviewing.value = null;
  endReview();
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'access' } }));
}
