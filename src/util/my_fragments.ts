/**
 * The Lost Fragments a player holds (Ames 2026-11-21: her edited fragment
 * went back to the pool when Play gave her the next one, and it was nowhere
 * in My Cells). A fragment they have edited stays theirs ("kept"), up to
 * FRAGMENT_LIMIT at once ("it should force me to complete or skip them after
 * say 5 fragments"). The server decides (functions/lost-fragments.js); this
 * keeps the game's copy, for the Lost Fragments tab and for My Cells.
 */
import { computed, reactive } from 'vue';
import { secureWrite } from '../secure_write';
import { ORPHANS_LARGE, ORPHANS_SMALLER, ORPHANS_GLIA, ORPHANS_SOMA } from '../data/orphan-segments';

export const FRAGMENT_LIMIT = 5;
/** The unfinished answer, saved as the player goes (fragments.progress). */
export interface FragmentDraft {
  fixed: boolean; ends: boolean; where: 'dendrite' | 'soma';
  point: [number, number, number] | null; pointOk: boolean;
  note: string; cellType: string; cellTypeCustom: string;
}
/** Like a claimed cell (Ames 2026-11-21): anchor is a supervoxel inside the
 *  fragment where the lab listed it, root its current ID. */
export interface HeldFragment { id: string; kept: boolean; at: string; anchor?: string | null; root?: string | null; draft?: FragmentDraft | null; draftAt?: number }
export const heldFragments = reactive<{ list: HeldFragment[]; loaded: boolean }>({ list: [], loaded: false });
export const keptFragmentIds = computed(() => heldFragments.list.filter(f => f.kept).map(f => f.id));

export function setHeldFragments(rows: any[] | undefined) {
  if (!Array.isArray(rows)) return;
  heldFragments.list = rows.filter(r => r && r.fragment_id)
    .map(r => ({ id: String(r.fragment_id), kept: !!r.kept, at: String(r.claimed_at || ''),
      anchor: r.anchor_sv ? String(r.anchor_sv) : null, root: r.root_id ? String(r.root_id) : null,
      draft: r.draft && typeof r.draft === 'object' ? r.draft : null, draftAt: Date.parse(r.draft_at || '') || 0 }));
  heldFragments.loaded = true;
}
export function markKept(id: string) {
  const f = heldFragments.list.find(x => x.id === id);
  if (f) f.kept = true; else heldFragments.list.unshift({ id, kept: true, at: new Date().toISOString() });
}
export function dropHeld(id: string) {
  heldFragments.list = heldFragments.list.filter(f => f.id !== id);
  dropLocalDraft(id);
}

export async function refreshHeldFragments(): Promise<void> {
  try {
    const res = await secureWrite<{ myClaims?: any[] }>('fragments.list');
    setHeldFragments(res?.myClaims || []);
  } catch { /* the list stays as it was */ }
}

/** The fragment's group, by the name its tab shows. */
const GROUP_OF = new Map<string, string>();
for (const [rows, label] of [[ORPHANS_LARGE, 'Large'], [ORPHANS_SMALLER, 'Small'], [ORPHANS_GLIA, 'Glia-like'], [ORPHANS_SOMA, 'Soma-like']] as const) {
  for (const r of rows) GROUP_OF.set(r.id, label);
}
/** How far the unfinished answer got: of the three steps (fix, ends, point). */
export function draftSteps(d?: FragmentDraft | null): number {
  return d ? (d.fixed ? 1 : 0) + (d.ends ? 1 : 0) + (d.point && d.pointOk ? 1 : 0) : 0;
}
export const heldOf = (id: string) => heldFragments.list.find(f => f.id === id);
/** The newest copy of a held fragment's work and ID: the server's, or this browser's if newer. */
export function bestDraft(f: HeldFragment): FragmentDraft | null {
  const loc = localDrafts()[f.id];
  return loc?.draft && (loc.at || 0) > (f.draftAt || 0) ? loc.draft : (f.draft || loc?.draft || null);
}
export const bestRoot = (f: HeldFragment): string => f.root || localDrafts()[f.id]?.root || f.id;

// ── The unfinished answers in this browser too, by fragment, for a page that
// could not reach the server (and as the newest copy until it can).
const LOCAL_KEY = 'nge_orph_progress_v1';
type LocalDrafts = Record<string, { draft: FragmentDraft; at: number; root?: string | null; anchor?: string | null }>;
export function localDrafts(): LocalDrafts {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch { return {}; }
}
export function saveLocalDraft(id: string, v: { draft?: FragmentDraft; root?: string | null; anchor?: string | null }) {
  try {
    const all = localDrafts();
    const was = all[id];
    const next = { draft: v.draft ?? was?.draft, root: v.root ?? was?.root ?? null, anchor: v.anchor ?? was?.anchor ?? null, at: v.draft ? Date.now() : (was?.at ?? 0) };
    if (!next.draft) next.draft = null as any;
    all[id] = next as any;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch { /* private window */ }
}
export function dropLocalDraft(id: string) {
  try { const all = localDrafts(); delete all[id]; localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch { /* */ }
}
export const fragmentGroup = (id: string) => GROUP_OF.get(id) || 'Stashed';

/** Open a held fragment in the Lost Fragments tab. The tab takes it when it
 *  opens (OrphanSegmentsTab reads pendingFragment) or at once if open. */
export const pendingFragment = reactive<{ id: string | null }>({ id: null });
export function openHeldFragment(id: string) {
  pendingFragment.id = id;
  document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'orphans' } }));
  document.dispatchEvent(new CustomEvent('nge:open-fragment', { detail: { id } }));
}
export async function releaseHeldFragment(id: string) {
  dropHeld(id);
  await secureWrite('fragments.release', { fragmentId: id }).catch(() => undefined);
}
