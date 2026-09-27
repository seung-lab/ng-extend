/**
 * practice.ts — resettable practice cells for the Cut & Merge tutorial.
 *
 * Schema: supabase-tutorial-practice-schema.sql. One example goes to one
 * user at a time. Two kinds: `merge_then_cut` (B starts disconnected; merge
 * it onto A, then cut it off) and `cut` (A and B start fused; cut them
 * apart).
 * When they finish or leave, every PyChunkedGraph operation made on the
 * example since its baseline is undone, newest first, with the user's own
 * CAVE token, and the example goes back to `ready` with refreshed roots.
 * If that fails, or the tab just closes, the example is marked
 * `needs_reset` (or its claim expires) and scripts/reset-practice-examples.mjs
 * does the same undo with the service token.
 *
 * Supervoxels are the durable identity of the two pieces; roots are looked
 * up from them whenever the example is handed out.
 */
import { Uint64 } from 'neuroglancer/util/uint64';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { useLayersStore, useProofreadingBackendStore } from './store';

export type PracticeKind = 'merge_then_cut' | 'cut';

export interface PracticeExample {
  id: string;
  title: string;
  kind: PracticeKind;
  dataset: string;
  pcg_server: string;
  pcg_table: string;
  state_url: string;
  supervoxel_a: string;
  supervoxel_b: string;
  root_a: string;
  root_b: string;
  baseline_at: string;
  status: 'ready' | 'in_use' | 'needs_reset' | 'resetting' | 'broken';
  enabled: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
  uses: number;
  reset_failures: number;
  last_reset_at: string | null;
  last_error: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function getViewer(): any {
  return (window as any)['viewer'];
}

// ─── PCG calls against the example's own server and table ──────────────────
// (pcg_service.ts reads the server from the viewer's current layer, which is
// not necessarily the example's dataset.)

function caveToken(server: string): string | null {
  let fallback: string | null = null;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith('auth_token_v2_')) continue;
    try {
      const data = JSON.parse(window.localStorage.getItem(key) || '{}');
      if (!data.accessToken) continue;
      try {
        if (new URL(data.url).hostname === new URL(server).hostname) return data.accessToken;
      } catch { /* keep looking */ }
      fallback = fallback ?? data.accessToken;
    } catch { /* not ours */ }
  }
  return fallback;
}

function pcgHeaders(server: string): HeadersInit {
  const token = caveToken(server);
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function pcgBase(ex: Pick<PracticeExample, 'pcg_server' | 'pcg_table'>) {
  return `${ex.pcg_server}/segmentation/api/v1/table/${ex.pcg_table}`;
}

export async function rootOfSupervoxel(ex: Pick<PracticeExample, 'pcg_server' | 'pcg_table'>, sv: string): Promise<string | null> {
  const res = await fetch(`${pcgBase(ex)}/node/${sv}/root?int64_as_str=1`, { headers: pcgHeaders(ex.pcg_server) });
  if (!res.ok) { console.warn(`[practice] root of ${sv}: ${res.status}`); return null; }
  const data = await res.json();
  return data.root_id != null ? String(data.root_id) : null;
}

interface LogOp { operationId: number; at: number }

/** Operations in a root's lineage made after `sinceIso`, newest first. */
async function opsSince(ex: PracticeExample, rootId: string, sinceIso: string): Promise<LogOp[]> {
  const res = await fetch(`${pcgBase(ex)}/root/${rootId}/tabular_change_log`, { headers: pcgHeaders(ex.pcg_server) });
  if (!res.ok) throw new Error(`tabular_change_log ${res.status}`);
  const data = await res.json();
  const ids: any[] = data.operation_id ?? [];
  const stamps: any[] = data.timestamp ?? [];
  const since = new Date(sinceIso).getTime();
  const out: LogOp[] = [];
  for (let i = 0; i < ids.length; i++) {
    const at = new Date(stamps[i]).getTime();
    if (Number.isFinite(at) && at > since) out.push({ operationId: Number(ids[i]), at });
  }
  return out.sort((a, b) => b.at - a.at);
}

async function undoOp(ex: PracticeExample, operationId: number): Promise<void> {
  const res = await fetch(`${pcgBase(ex)}/undo?int64_as_str=1`, {
    method: 'POST', headers: pcgHeaders(ex.pcg_server),
    body: JSON.stringify({ operation_id: operationId }),
  });
  if (!res.ok) throw new Error(`undo ${operationId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// ─── Viewer helpers ─────────────────────────────────────────────────────────

function segLayer(dataset: string): any {
  const viewer = getViewer();
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    const url: string = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
    if (ml.name === dataset || url.includes(`/table/${dataset}`)) return ml.layer;
  }
  return null;
}

function showOnly(dataset: string, rootIds: string[]) {
  const layer = segLayer(dataset);
  const set = layer?.displayState?.segmentationGroupState?.value?.visibleSegments
    ?? layer?.displayState?.rootSegments;
  if (!set) { console.warn('[practice] no segmentation layer for', dataset); return; }
  const current: any[] = [];
  for (const seg of set) current.push(seg);
  for (const seg of current) set.delete(seg);
  for (const id of rootIds) {
    try { set.add(Uint64.parseString(id)); } catch (e) { console.warn('[practice] bad root id', id); }
  }
}

/**
 * Undo every operation on either piece since the example's baseline, newest
 * first, with the signed-in user's token, and return the refreshed roots.
 * Throws if an undo fails or the pieces still share a root afterwards. Used
 * by the tutorial hand-back and by the admin "Reset now" button.
 */
export async function undoSinceBaseline(ex: PracticeExample): Promise<{ a: string; b: string; undone: number }> {
  // Both lineages, since a cut can leave the pieces on different roots with
  // the merge in each history.
  const roots = new Set<string>();
  for (const sv of [ex.supervoxel_a, ex.supervoxel_b]) {
    const r = await rootOfSupervoxel(ex, sv);
    if (r) roots.add(r);
  }
  const seen = new Set<number>();
  const ops: LogOp[] = [];
  for (const r of roots) for (const op of await opsSince(ex, r, ex.baseline_at)) {
    if (!seen.has(op.operationId)) { seen.add(op.operationId); ops.push(op); }
  }
  ops.sort((x, y) => y.at - x.at);
  for (const op of ops) await undoOp(ex, op.operationId);
  const a = await rootOfSupervoxel(ex, ex.supervoxel_a);
  const b = await rootOfSupervoxel(ex, ex.supervoxel_b);
  if (!a || !b) throw new Error(`could not resolve roots after undo (${a}, ${b})`);
  // A cut example starts fused; a merge example starts separate.
  const wantFused = ex.kind === 'cut';
  if ((a === b) !== wantFused) {
    throw new Error(wantFused ? `after undo the pieces are still apart (${a}, ${b})`
                              : `after undo both pieces are still on root ${a}`);
  }
  return { a, b, undone: ops.length };
}

// ─── Session state ──────────────────────────────────────────────────────────

export type PracticePhase = 'none' | 'claiming' | 'merge' | 'cut' | 'busy' | 'unavailable' | 'done';

const session = {
  example: null as PracticeExample | null,
  rootA: '',
  rootB: '',
  phase: 'none' as PracticePhase,
  releasing: null as Promise<void> | null,
};

export function currentPractice() {
  return session;
}

function userId(): string | null {
  try { return useProofreadingBackendStore().userId; } catch { return null; }
}

/**
 * Claim an example of the given kind for this user and put the viewer on
 * it: load the saved view, then show only the two pieces at their current
 * root ids. A held example of that kind is reused; a held example of the
 * other kind is handed back first.
 * Returns null when nobody is logged in or every example is busy.
 */
export async function beginPractice(kind: PracticeKind = 'merge_then_cut'): Promise<PracticeExample | null> {
  const uid = userId();
  if (!uid) { session.phase = 'unavailable'; return null; }
  if (session.example && session.example.claimed_by === uid) {
    if (session.example.kind === kind) {
      await showExample(session.example);
      return session.example;
    }
    await endPractice();
  }
  session.phase = 'claiming';
  const { data, error } = await supabase.rpc('claim_practice_example', { p_user: uid, p_kind: kind });
  if (error) { console.warn('[practice] claim failed:', error.message); session.phase = 'unavailable'; return null; }
  const row = (Array.isArray(data) ? data[0] : data) as PracticeExample | undefined;
  if (!row) { session.phase = 'busy'; return null; }
  session.example = row;
  await showExample(row);
  session.phase = kind === 'cut' ? 'cut' : 'merge';
  return row;
}

async function showExample(ex: PracticeExample) {
  const [a, b] = await Promise.all([rootOfSupervoxel(ex, ex.supervoxel_a), rootOfSupervoxel(ex, ex.supervoxel_b)]);
  session.rootA = a ?? ex.root_a;
  session.rootB = b ?? ex.root_b;
  await useLayersStore().loadState(ex.state_url);
  // restoreState applies asynchronously; give the layer a moment to exist.
  await new Promise(r => setTimeout(r, 800));
  showOnly(ex.dataset, session.rootA === session.rootB ? [session.rootA] : [session.rootA, session.rootB]);
}

/** True when the two pieces currently share a root. */
export async function piecesMerged(): Promise<boolean | null> {
  const ex = session.example;
  if (!ex) return null;
  const [a, b] = await Promise.all([rootOfSupervoxel(ex, ex.supervoxel_a), rootOfSupervoxel(ex, ex.supervoxel_b)]);
  if (!a || !b) return null;
  session.rootA = a;
  session.rootB = b;
  return a === b;
}

/**
 * Undo everything done to the example since its baseline and hand it back.
 * Safe to call more than once; later calls wait on the first.
 */
export function endPractice(): Promise<void> {
  if (session.releasing) return session.releasing;
  const ex = session.example;
  const uid = userId();
  if (!ex || !uid) { session.phase = 'none'; return Promise.resolve(); }
  session.releasing = (async () => {
    let clean = false;
    let err: string | null = null;
    let rootA = '';
    let rootB = '';
    try {
      const r = await undoSinceBaseline(ex);
      clean = true; rootA = r.a; rootB = r.b;
    } catch (e: any) {
      err = e?.message ?? String(e);
      console.warn('[practice] client reset failed, leaving it to the reset job:', err);
    }
    const { error } = await supabase.rpc('release_practice_example', {
      p_id: ex.id, p_user: uid, p_clean: clean,
      p_root_a: rootA || null, p_root_b: rootB || null, p_error: err,
    });
    if (error) console.warn('[practice] release failed:', error.message);
    session.example = null;
    session.rootA = '';
    session.rootB = '';
    session.phase = 'done';
    session.releasing = null;
  })();
  return session.releasing;
}

// A closed tab cannot undo anything, so the claim simply expires and the
// reset job takes the example. `keepalive` at least records the hand-back.
window.addEventListener('pagehide', () => {
  const ex = session.example;
  const uid = userId();
  if (!ex || !uid) return;
  try {
    const key = SUPABASE_ANON_KEY;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/release_practice_example`, {
      method: 'POST', keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: ex.id, p_user: uid, p_clean: false, p_error: 'tab closed' }),
    }).catch(() => { /* best effort */ });
  } catch { /* best effort */ }
});
