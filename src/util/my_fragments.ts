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
export interface HeldFragment { id: string; kept: boolean; at: string }
export const heldFragments = reactive<{ list: HeldFragment[]; loaded: boolean }>({ list: [], loaded: false });
export const keptFragmentIds = computed(() => heldFragments.list.filter(f => f.kept).map(f => f.id));

export function setHeldFragments(rows: any[] | undefined) {
  if (!Array.isArray(rows)) return;
  heldFragments.list = rows.filter(r => r && r.fragment_id)
    .map(r => ({ id: String(r.fragment_id), kept: !!r.kept, at: String(r.claimed_at || '') }));
  heldFragments.loaded = true;
}
export function markKept(id: string) {
  const f = heldFragments.list.find(x => x.id === id);
  if (f) f.kept = true; else heldFragments.list.unshift({ id, kept: true, at: new Date().toISOString() });
}
export function dropHeld(id: string) {
  heldFragments.list = heldFragments.list.filter(f => f.id !== id);
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
