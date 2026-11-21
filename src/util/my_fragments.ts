/**
 * The Lost Fragments a player holds (Ames 2026-11-21: her edited fragment
 * went back to the pool when Play gave her the next one, and it was nowhere
 * in My Cells). A fragment they have edited stays theirs ("kept"), up to
 * FRAGMENT_LIMIT at once ("it should force me to complete or skip them after
 * say 5 fragments"). The server decides (functions/lost-fragments.js); this
 * keeps the game's copy, for the Lost Fragments tab and for My Cells.
 */
import { computed, reactive, ref } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { currentSegLayer } from '../datasets';
import { secureWrite } from '../secure_write';
import { mintShortStateLink } from './state_link';
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
export interface HeldFragment { id: string; kept: boolean; at: string; anchor?: string | null; root?: string | null; draft?: FragmentDraft | null; draftAt?: number;
  /** The saved view (layers, annotations, Highlight marks, camera), as a claimed cell's. */
  link?: string | null; viewAt?: number }
export const heldFragments = reactive<{ list: HeldFragment[]; loaded: boolean }>({ list: [], loaded: false });
export const keptFragmentIds = computed(() => heldFragments.list.filter(f => f.kept).map(f => f.id));

export function setHeldFragments(rows: any[] | undefined) {
  if (!Array.isArray(rows)) return;
  heldFragments.list = rows.filter(r => r && r.fragment_id)
    .map(r => ({ id: String(r.fragment_id), kept: !!r.kept, at: String(r.claimed_at || ''),
      anchor: r.anchor_sv ? String(r.anchor_sv) : null, root: r.root_id ? String(r.root_id) : null,
      draft: r.draft && typeof r.draft === 'object' ? r.draft : null, draftAt: Date.parse(r.draft_at || '') || 0,
      link: r.working_link ? String(r.working_link) : null, viewAt: Date.parse(r.view_at || '') || 0 }));
  heldFragments.loaded = true;
}
export function markKept(id: string) {
  const f = heldFragments.list.find(x => x.id === id);
  if (f) f.kept = true; else heldFragments.list.unshift({ id, kept: true, at: new Date().toISOString() });
}
export function dropHeld(id: string) {
  heldFragments.list = heldFragments.list.filter(f => f.id !== id);
  dropLocalDraft(id);
  if (activeFragment.id === id) activeFragment.id = null;
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
type LocalDrafts = Record<string, { draft: FragmentDraft; at: number; root?: string | null; anchor?: string | null; link?: string | null; viewAt?: number }>;
export function localDrafts(): LocalDrafts {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch { return {}; }
}
export function saveLocalDraft(id: string, v: { draft?: FragmentDraft; root?: string | null; anchor?: string | null; link?: string | null }) {
  try {
    const all = localDrafts();
    const was = all[id];
    const next = { draft: v.draft ?? was?.draft, root: v.root ?? was?.root ?? null, anchor: v.anchor ?? was?.anchor ?? null, at: v.draft ? Date.now() : (was?.at ?? 0),
      link: v.link ?? was?.link ?? null, viewAt: v.link ? Date.now() : (was?.viewAt ?? 0) };
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
export const pendingFragment = reactive<{ id: string | null; finish?: boolean }>({ id: null });
/** finish: open its checklist too (Complete in My Cells). */
export function openHeldFragment(id: string, finish = false) {
  pendingFragment.id = id;
  pendingFragment.finish = finish;
  document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'orphans' } }));
  document.dispatchEvent(new CustomEvent('nge:open-fragment', { detail: { id } }));
}
export async function releaseHeldFragment(id: string) {
  dropHeld(id);
  document.dispatchEvent(new CustomEvent('nge:fragment-released', { detail: { id } }));
  await secureWrite('fragments.release', { fragmentId: id }).catch(() => undefined);
}

/** The fragment you are working on, as a claimed cell's working claim: it
 *  outlives the Lost Fragments tab (My Cells, another tab), so its view still
 *  saves and My Cells marks it Active. Set when a fragment opens; cleared when
 *  it is completed or let go. */
export const activeFragment = reactive<{ id: string | null }>({ id: null });

/** A held fragment's saved view: the server's, or this browser's if newer. */
export function bestLink(f: HeldFragment): { link: string | null; at: number } {
  const loc = localDrafts()[f.id];
  if (loc?.link && (loc.viewAt || 0) > (f.viewAt || 0)) return { link: loc.link, at: loc.viewAt || 0 };
  return { link: f.link || loc?.link || null, at: f.viewAt || loc?.viewAt || 0 };
}
/** Save the view on screen to a fragment's claim, as Save view does for a
 *  claimed cell (Ames 2026-11-21): its layers, annotations, Highlight marks
 *  and camera come back when it is opened again. Kept in this browser too. */
export async function saveFragmentView(id: string): Promise<boolean> {
  const link = await mintShortStateLink().catch(() => null);
  if (!link) return false;
  saveLocalDraft(id, { link });
  const h = heldOf(id);
  if (h) { h.link = link; h.viewAt = Date.now(); }
  try {
    const res = await secureWrite<{ saved: boolean }>('fragments.progress', { fragmentId: id, workingLink: link });
    return !!(res && res.saved);
  } catch { return true; }   // a server without views yet: this browser keeps it
}

// ── The view autosaves, as a claimed cell's (Ames 2026-11-21: "I want it all
// to autosave just like all the other cells you've claimed"): a few seconds
// after you arrive, when you leave it for another, after a merge or cut, every
// two minutes while it changes, when Pyr goes to the background, and with
// Save view. Only while the fragment is on screen, so a cell you went on to is
// never saved as the fragment's view.
export const viewSaving = ref<string | null>(null);
let lastViewJson = '';
function viewJson(): string {
  try { return JSON.stringify((window as any).viewer?.state?.toJSON() ?? null); } catch { return ''; }
}
/** A view just opened: it is saved already. */
export function markViewSaved() { lastViewJson = viewJson(); }
export function fragmentInView(id: string): boolean {
  try {
    const vis = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (!vis) return false;
    const f = heldOf(id);
    return [id, f?.root, localDrafts()[id]?.root].some(r => !!r && /^\d+$/.test(r) && vis.has(Uint64.parseString(r)));
  } catch { return false; }
}
/** Save the fragment's view now. onlyIfChanged: skip when nothing changed. */
export async function autosaveFragmentView(id: string, onlyIfChanged = false): Promise<boolean> {
  if (!heldOf(id) || viewSaving.value || !fragmentInView(id)) return false;
  const json = viewJson();
  if (onlyIfChanged && json === lastViewJson) return false;
  viewSaving.value = id;
  try {
    const ok = await saveFragmentView(id);
    if (ok) lastViewJson = json;
    return ok;
  } finally { viewSaving.value = null; }
}
let firstSaveTimer: ReturnType<typeof setTimeout> | undefined;
/** Arrived on a fragment: with no saved view, save one a few seconds in. */
export function firstViewSave(id: string, hasView: boolean) {
  clearTimeout(firstSaveTimer);
  if (hasView) { setTimeout(() => { if (activeFragment.id === id) markViewSaved(); }, 4000); return; }
  firstSaveTimer = setTimeout(() => { if (activeFragment.id === id) void autosaveFragmentView(id); }, 5000);
}
setInterval(() => {
  const id = activeFragment.id;
  if (id && !document.hidden) void autosaveFragmentView(id, true);
}, 120000);
document.addEventListener('visibilitychange', () => {
  const id = activeFragment.id;
  if (document.hidden && id) void autosaveFragmentView(id, true);
});
