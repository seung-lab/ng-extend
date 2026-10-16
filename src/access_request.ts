/**
 * access_request.ts: retina access requests (Ames, 2026-10-16). The EyeWire II
 * Dataset Access form, in the game: 7 cut examples (an accidental merger, with
 * red and blue Multicut points where the player would cut) and 3 merge
 * examples (an accidental split, with both pieces shown). Each one is the
 * player's view, saved as a share link plus what is in it, so a reviewer can
 * open it and judge every point. Server: functions/access-request.js
 * (ewAccessRequest). Panel: components/AccessRequestPanel.vue. Review: the
 * Admin Hub's Access requests tab.
 */
import { ref } from 'vue';
import { secureWrite } from './secure_write';
import { mintShortStateLink } from './util/state_link';
import { currentSegLayer, currentDatasetTag } from './datasets';

export type AccessKind = 'cut' | 'merge';
export const ACCESS_SLOTS: Record<AccessKind, number> = { cut: 7, merge: 3 };

export interface AccessPoint { position: number[]; segmentId?: string; rootId?: string }
export interface AccessItem {
  id?: number; request_id?: number;
  kind: AccessKind; slot: number; link: string; dataset: string | null; note: string | null;
  points: { red?: AccessPoint[]; blue?: AccessPoint[] }; segments: string[]; position: number[] | null;
  saved_at?: string; verdict?: 'good' | 'redo' | null; point_marks?: Record<string, 'good' | 'off'>; feedback?: string | null;
}
export interface AccessRequest {
  id: number; status: 'draft' | 'submitted' | 'redo' | 'invited'; tries: number; affiliation: string | null;
  submitted_at: string | null; reviewed_at: string | null; reviewer_note: string | null;
  // Reviewer side only.
  email?: string; player_name?: string; user_id?: string; pilot_added?: boolean; items?: AccessItem[];
}
export interface AccessMine { request: AccessRequest | null; items: AccessItem[] }

/** The player's own request, shared by the menu line and the panel. */
export const myAccess = ref<AccessMine | null>(null);

export async function loadMyAccess(): Promise<AccessMine> {
  const mine = await secureWrite<AccessMine>('access.mine');
  myAccess.value = mine;
  return mine;
}

/** What is in the view right now: the Multicut points and the pieces shown. */
export function viewContents(): { red: AccessPoint[]; blue: AccessPoint[]; segments: string[] } {
  const out = { red: [] as AccessPoint[], blue: [] as AccessPoint[], segments: [] as string[] };
  try {
    const ml = currentSegLayer();
    const layer = ml?.layer;
    const multicut = layer?.graphConnection?.value?.state?.multicutState;
    const toPoint = (s: any): AccessPoint => ({
      position: Array.from(s?.position ?? []).map(Number),
      ...(s?.segmentId != null ? { segmentId: String(s.segmentId) } : {}),
      ...(s?.rootId != null ? { rootId: String(s.rootId) } : {}),
    });
    // Neuroglancer's red group is the sinks, the blue group the sources.
    if (multicut) {
      out.red = [...multicut.sinks].map(toPoint).filter(p => p.position.length === 3);
      out.blue = [...multicut.sources].map(toPoint).filter(p => p.position.length === 3);
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
  if (kind === 'merge' && v.segments.length < 2) return 'Show both pieces you would join. Do not merge them.';
  return '';
}

function viewPosition(): number[] | null {
  try {
    const pos = (window as any).viewer?.position?.value;
    return pos && pos.length === 3 ? Array.from(pos as ArrayLike<number>).map(Number) : null;
  } catch { return null; }
}

/** Save the view as one example. Throws a sentence the player can act on. */
export async function saveExample(kind: AccessKind, slot: number, note: string, affiliation: string): Promise<AccessMine> {
  const v = viewContents();
  const reason = whyNot(kind, v);
  if (reason) throw new Error(reason);
  const link = await mintShortStateLink();
  if (!link) throw new Error('A link to this view could not be made. Check that you are signed in, then try again.');
  const mine = await secureWrite<AccessMine>('access.save', {
    kind, slot, link, dataset: currentDatasetTag(), note,
    points: kind === 'cut' ? { red: v.red, blue: v.blue } : {},
    segments: v.segments, position: viewPosition(), affiliation,
  });
  myAccess.value = mine;
  return mine;
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

export async function submitAccess(affiliation: string): Promise<AccessMine> {
  const mine = await secureWrite<AccessMine>('access.submit', { affiliation });
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

export async function decideAccess(requestId: number, outcome: 'redo' | 'invited', note: string) {
  return secureWrite<AccessRequest & { redos: number; pilot_added: boolean }>('access.decide', { requestId, outcome, note });
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

/** Load an example's view in place; a link we cannot load opens in a new tab. */
export function openExample(it: AccessItem) {
  try {
    const hash = new URL(it.link).hash;
    if (hash.startsWith('#!')) { window.location.hash = hash; return; }
  } catch { /* fall through */ }
  window.open(it.link, '_blank', 'noopener');
}

/** Back to the list in the Admin Hub. */
export function backToRequests() {
  reviewing.value = null;
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'access' } }));
}
