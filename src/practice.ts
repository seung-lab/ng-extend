/**
 * practice.ts — resettable practice cells for the Cut & Merge tutorial.
 *
 * Schema: supabase-tutorial-practice-schema.sql. One example goes to one
 * user at a time. Two kinds: `merge_then_cut` (a merge example: B starts
 * wrongly disconnected and the learner merges it onto A) and `cut` (A and B
 * start wrongly fused and the learner cuts them apart). The kind name is
 * historical; the reset undoes whatever the learner did either way.
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
import { setStatedColor } from './widgets/widget_utils';
import { supabase } from './supabase';
import { practiceBase, practiceToken } from './util/practice_destination';
import { practiceOperationsAfter, remainingPracticeOperations } from './util/practice_history';
export { parsePcgStamp } from './util/practice_history';
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
  /** JSON [x, y, z] in viewer voxels, from the registering admin's hover. */
  point_a?: string | null;
  point_b?: string | null;
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
  return practiceToken(window.localStorage, server);
}

function pcgHeaders(server: string): HeadersInit {
  const token = caveToken(server);
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function pcgBase(ex: Pick<PracticeExample, 'pcg_server' | 'pcg_table'>) {
  return practiceBase(ex.pcg_server, ex.pcg_table);
}

export async function rootOfSupervoxel(ex: Pick<PracticeExample, 'pcg_server' | 'pcg_table'>, sv: string): Promise<string | null> {
  // Three tries: a fresh login can race the token, and the server rate limits.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${pcgBase(ex)}/node/${sv}/root?int64_as_str=1`, { headers: pcgHeaders(ex.pcg_server), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      return data.root_id != null ? String(data.root_id) : null;
    }
    console.warn(`[practice] root of ${sv} on ${ex.pcg_table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    if (res.status === 401 || res.status === 403 || res.status === 404) break;
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  return null;
}

/** PyChunkedGraph ids carry their layer in the top byte; supervoxels are layer 1. */
function pcgLayer(id: string): number {
  // Number() keeps 53 bits, plenty for the top byte of a 64-bit id.
  return Math.floor(Number(id) / 2 ** 56);
}

/** Walk a root down to one of its supervoxels (about eight calls). Works for
 *  old roots too, so a row registered by root id alone can be completed. */
export async function anySupervoxelOf(ex: Pick<PracticeExample, 'pcg_server' | 'pcg_table'>, rootId: string): Promise<string> {
  let id = rootId;
  for (let i = 0; i < 12 && pcgLayer(id) > 1; i++) {
    const res = await fetch(`${pcgBase(ex)}/node/${id}/children?int64_as_str=1`, { headers: pcgHeaders(ex.pcg_server), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`children of ${id}: ${res.status}`);
    const data = await res.json();
    const kids: string[] = (data.children_ids ?? data.children ?? []).map(String);
    if (!kids.length) throw new Error(`node ${id} has no children`);
    id = kids[0];
  }
  if (pcgLayer(id) !== 1) throw new Error(`could not reach a supervoxel from ${rootId}`);
  return id;
}

/** Rows registered by root id alone get their supervoxels on first use. */
export async function ensureSupervoxels(ex: PracticeExample): Promise<PracticeExample> {
  if (ex.supervoxel_a && ex.supervoxel_b) return ex;
  const a = ex.supervoxel_a || await anySupervoxelOf(ex, ex.root_a);
  const b = ex.supervoxel_b || await anySupervoxelOf(ex, ex.root_b);
  const { error } = await supabase.from('tutorial_practice_examples')
    .update({ supervoxel_a: a, supervoxel_b: b, updated_at: new Date().toISOString() }).eq('id', ex.id);
  if (error) console.warn('[practice] could not save supervoxels:', error.message);
  ex.supervoxel_a = a;
  ex.supervoxel_b = b;
  return ex;
}

/** PyChunkedGraph timestamps arrive as epoch seconds, epoch milliseconds
 *  or "YYYY-MM-DD HH:MM:SS.ffffff" strings depending on the version; read
 *  them all. NaN means unparseable. */
interface LogOp { operationId: number; at: number }

/** Operations in a root's lineage made after `sinceIso`, newest first. */
async function opsSince(ex: PracticeExample, rootId: string, sinceIso: string): Promise<LogOp[]> {
  const res = await fetch(`${pcgBase(ex)}/root/${rootId}/tabular_change_log?filtered=false`, { headers: pcgHeaders(ex.pcg_server), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`tabular_change_log ${res.status}`);
  const data = await res.json();
  return practiceOperationsAfter(data, rootId, sinceIso);
}

async function undoOp(ex: PracticeExample, operationId: number): Promise<void> {
  const res = await fetch(`${pcgBase(ex)}/undo?int64_as_str=1`, {
    method: 'POST', headers: pcgHeaders(ex.pcg_server), redirect: 'error', signal: AbortSignal.timeout(15000),
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
  await ensureSupervoxels(ex);
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
  if (ops.length > 10000) throw Error('Unexpectedly large practice history; ask an admin to review this example.');
  const details: Record<string, any> = {};
  for (let i = 0; i < ops.length; i += 100) {
    const ids = ops.slice(i, i + 100).map(op => op.operationId);
    const res = await fetch(`${pcgBase(ex)}/operation_details?int64_as_str=1&operation_ids=${encodeURIComponent(JSON.stringify(ids))}`, { headers: pcgHeaders(ex.pcg_server), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw Error(`operation_details ${res.status}`);
    Object.assign(details, await res.json());
  }
  const activeOps = remainingPracticeOperations(ops, details);
  for (const op of activeOps) await undoOp(ex, op.operationId);
  const a = await rootOfSupervoxel(ex, ex.supervoxel_a);
  const b = await rootOfSupervoxel(ex, ex.supervoxel_b);
  if (!a || !b) throw new Error(`could not look up the roots of supervoxels ${ex.supervoxel_a} and ${ex.supervoxel_b} on ${ex.pcg_server} ${ex.pcg_table} (see the console for the server's answer)`);
  // A cut example starts fused; a merge example starts separate.
  const wantFused = ex.kind === 'cut';
  if ((a === b) !== wantFused) {
    const detail = `${activeOps.length} operation(s) after the baseline ${ex.baseline_at} were undone`;
    throw new Error(wantFused ? `after undo the pieces are still apart (${a}, ${b}); ${detail}`
                              : `after undo both pieces are still on root ${a}; ${detail}`);
  }
  return { a, b, undone: activeOps.length };
}

// ─── Viewer colours and tools ───────────────────────────────────────────────

/** Amy: the cell is purple, the loose piece yellow, and after the merge the
 *  whole thing is purple. Packed as 0xBBGGRR, the stated-colour format. */
const PURPLE = 0xff40a0 | 0; // rgb(160, 64, 255)
const YELLOW = 0x00d7ff | 0; // rgb(255, 215, 0)

export function colorSegments(dataset: string, colors: Array<[string, number]>) {
  const layer = segLayer(dataset);
  const map = layer?.displayState?.segmentationColorGroupState?.value?.segmentStatedColors;
  if (!map) return;
  for (const [id, packed] of colors) {
    try { setStatedColor(map, Uint64.parseString(id), packed); } catch (e) { console.warn('[practice] colour', id, e); }
  }
}

/** No practice cell: colour the first two visible segments of Amy's
 *  example so the copy ("yellow branch", "purple cell") still holds. */
export function colorFirstTwoVisible(dataset: string, attempt = 0) {
  const layer = segLayer(dataset);
  const set = layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  const ids: string[] = [];
  if (set) for (const seg of set) ids.push(seg.toString());
  // The saved view takes a moment to populate; keep trying for ten seconds.
  if (ids.length < 2 && attempt < 20) { setTimeout(() => colorFirstTwoVisible(dataset, attempt + 1), 500); if (!ids.length) return; }
  const colors: Array<[string, number]> = [];
  if (ids[0]) colors.push([ids[0], PURPLE]);
  if (ids[1]) colors.push([ids[1], YELLOW]);
  colorSegments(dataset, colors);
}

/** Activate the merge or cut tool if none is active, the way the command
 *  palette does: the segmentation layer gets selected and the tool's key is
 *  sent to the viewer. Used when a step says "press M" and the learner
 *  pressed next instead. */
export function ensureTool(tool: 'merge' | 'multicut', attempt = 0) {
  const viewer = getViewer();
  if (!viewer) return;
  try {
    if (viewer.globalToolBinder?.activeTool_ || viewer.toolBinder?.activeTool_) return;
  } catch { /* check the DOM instead */ }
  if (document.querySelector('.neuroglancer-tool-status')) return;
  // A freshly loaded state can drop the tool once its layer finishes
  // loading, so keep trying for a few seconds until the tool bar is up.
  if (attempt < 8) setTimeout(() => ensureTool(tool, attempt + 1), 700);
  try {
    const seg = viewer.layerManager?.managedLayers?.find((x: any) => x.layer?.constructor?.name?.includes('Segmentation'));
    if (seg) { viewer.selectedLayer.layer = seg; viewer.selectedLayer.visible = true; }
  } catch { /* non-critical */ }
  const key = tool === 'multicut' ? 'c' : 'm';
  const init: KeyboardEventInit = { key, code: key === 'c' ? 'KeyC' : 'KeyM', bubbles: true, cancelable: true };
  for (const el of [viewer.element, viewer.display?.container, document.getElementById('neuroglancer-container')]) {
    if (!el) continue;
    if (el instanceof HTMLElement) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', init));
  }
}

/**
 * Put the example's registered points into the merge tool as a finished
 * merge line, so a stuck learner only has to press Submit. The graphene
 * layer keeps merge lines as annotations in `mergeAnnotationState`; adding
 * one there is exactly what two Ctrl+clicks do. Points are in the viewer's
 * voxel space; the annotation layer shares it for these datasets.
 */
export function placeMergeLine(): boolean {
  const ex = session.example;
  if (!ex || !ex.point_a || !ex.point_b) return false;
  let pa: number[], pb: number[];
  try { pa = JSON.parse(ex.point_a); pb = JSON.parse(ex.point_b); } catch { return false; }
  if (!Array.isArray(pa) || !Array.isArray(pb) || pa.length < 3 || pb.length < 3) return false;
  const layer = segLayer(ex.dataset);
  const gc = layer?.graphConnection?.value;
  const source = gc?.mergeAnnotationState?.source;
  if (!source) { console.warn('[practice] no merge annotation source; is the merge tool on?'); return false; }
  const rootA = session.rootA || ex.root_a, rootB = session.rootB || ex.root_b;
  try {
    // The sink is the cell (B side of the line is the piece), matching what
    // the tool records from two clicks: [sinkRoot, sinkSupervoxel, sourceRoot, sourceSupervoxel].
    source.add({
      id: `nge-practice-${ex.id}`,
      type: 1, // AnnotationType.LINE
      pointA: Float32Array.from(pa.slice(0, 3)),
      pointB: Float32Array.from(pb.slice(0, 3)),
      relatedSegments: [[
        Uint64.parseString(rootA), Uint64.parseString(ex.supervoxel_a),
        Uint64.parseString(rootB), Uint64.parseString(ex.supervoxel_b),
      ]],
      properties: [],
    });
    return true;
  } catch (e) {
    console.warn('[practice] placing the merge line failed:', e);
    return false;
  }
}

// ─── Holding a cell: activity keeps it, silence hands it back ───────────────
// Amy: a cell is held while the learner is active; after a minute of
// silence a countdown shows, and at five minutes the cell is undone and
// released for the next person. The claim itself expires after the same five
// minutes, so a closed tab releases on the server side too.

export const HOLD_MINUTES = 5;
const WARN_AFTER_MS = 60 * 1000;
const RELEASE_AFTER_MS = HOLD_MINUTES * 60 * 1000;

let lastActivity = Date.now();
let lastHeartbeat = 0;
let activityTimer: ReturnType<typeof setInterval> | null = null;
let activityListening = false;

function noteActivity() {
  lastActivity = Date.now();
}

/** Seconds left before the cell is released, or null when not counting down. */
export function releaseCountdown(): number | null {
  if (!session.example) return null;
  const idle = Date.now() - lastActivity;
  if (idle < WARN_AFTER_MS) return null;
  return Math.max(0, Math.ceil((RELEASE_AFTER_MS - idle) / 1000));
}

function startActivityWatch() {
  lastActivity = Date.now();
  if (!activityListening) {
    activityListening = true;
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
      window.addEventListener(ev, noteActivity, { passive: true, capture: true });
    }
  }
  if (activityTimer) return;
  activityTimer = setInterval(async () => {
    const ex = session.example;
    if (!ex) { clearInterval(activityTimer!); activityTimer = null; return; }
    const idle = Date.now() - lastActivity;
    // Active: push the claim's expiry along once a minute.
    if (idle < WARN_AFTER_MS && Date.now() - lastHeartbeat > 60 * 1000) {
      lastHeartbeat = Date.now();
      supabase.from('tutorial_practice_examples')
        .update({ expires_at: new Date(Date.now() + RELEASE_AFTER_MS).toISOString(), updated_at: new Date().toISOString() })
        .eq('id', ex.id).eq('status', 'in_use')
        .then(({ error }) => { if (error) console.warn('[practice] heartbeat failed:', error.message); });
    }
    document.dispatchEvent(new CustomEvent('nge:practice-countdown', { detail: { seconds: releaseCountdown() } }));
    if (idle >= RELEASE_AFTER_MS) {
      clearInterval(activityTimer!); activityTimer = null;
      session.phase = 'released';
      await endPractice();
      session.phase = 'released';
      document.dispatchEvent(new CustomEvent('nge:practice-released'));
    }
  }, 1000);
}

// ─── Waiting list ───────────────────────────────────────────────────────────
// When every cell of a kind is held, the learner joins the queue
// (tutorial_practice_waitlist). While the tutorial step is open the client
// checks every 20 s; the first in line whose turn comes gets the cell and a
// notification. Someone who leaves the step drops out of the queue.

let waitTimer: ReturnType<typeof setInterval> | null = null;

export async function joinWaitlist(kind: PracticeKind, onReady: (ex: PracticeExample) => void, onPosition: (n: number) => void) {
  const uid = userId();
  if (!uid) return;
  leaveWaitlist();
  const { error } = await supabase.from('tutorial_practice_waitlist')
    .upsert({ user_id: uid, kind, created_at: new Date().toISOString() }, { onConflict: 'user_id,kind' });
  if (error) { console.warn('[practice] waitlist join failed:', error.message); return; }
  const check = async () => {
    const { data } = await supabase.from('tutorial_practice_waitlist')
      .select('user_id').eq('kind', kind).order('created_at');
    const queue = (data ?? []).map((r: any) => r.user_id as string);
    const pos = queue.indexOf(uid);
    onPosition(pos < 0 ? 0 : pos + 1);
    if (pos !== 0) return; // not our turn yet
    const ex = await beginPractice(kind);
    if (ex) {
      leaveWaitlist();
      try {
        const { useProofreadingBackendStore } = await import('./store');
        await useProofreadingBackendStore().createSelfNotification({
          title: 'Your practice cell is ready',
          body: 'A cell freed up for the tutorial. Jump in, it is yours while you work; after five quiet minutes it goes to the next person in line.',
        });
      } catch { /* the status box says it too */ }
      onReady(ex);
    }
  };
  await check();
  waitTimer = setInterval(check, 20 * 1000);
}

export function leaveWaitlist() {
  if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
  const uid = userId();
  if (!uid) return;
  supabase.from('tutorial_practice_waitlist').delete().eq('user_id', uid)
    .then(({ error }) => { if (error) console.warn('[practice] waitlist leave failed:', error.message); });
}

// ─── Session state ──────────────────────────────────────────────────────────

export type PracticePhase = 'none' | 'claiming' | 'merge' | 'cut' | 'busy' | 'unavailable' | 'done' | 'released';

const session = {
  example: null as PracticeExample | null,
  /** Example whose saved view is currently loaded, so later steps do not
   *  reload it (a reload drops the active tool and the colours). */
  shownId: '',
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
/**
 * For a cut example, `root_a` and `root_b` are the two pieces as they were
 * after Amy's cut (the row is registered from them and resets leave them
 * alone), while the cell at rest is the fused root. 'preview' shows those
 * two pieces in yellow and purple, the result the learner is about to
 * reproduce; 'start' shows the fused root for them to cut.
 */
export type PracticeView = 'start' | 'preview';

export async function beginPractice(kind: PracticeKind = 'merge_then_cut', view: PracticeView = 'start'): Promise<PracticeExample | null> {
  const uid = userId();
  if (!uid) { session.phase = 'unavailable'; return null; }
  if (session.example && session.example.claimed_by === uid) {
    if (session.example.kind === kind) {
      await showExample(session.example, view);
      return session.example;
    }
    await endPractice();
  }
  session.phase = 'claiming';
  const { data, error } = await supabase.rpc('claim_practice_example', { p_user: uid, p_kind: kind, p_minutes: HOLD_MINUTES });
  if (error) { console.warn('[practice] claim failed:', error.message); session.phase = 'unavailable'; return null; }
  let row = (Array.isArray(data) ? data[0] : data) as PracticeExample | undefined;
  if (!row) row = await takeNeedsReset(uid, kind) ?? undefined;
  if (!row) { session.phase = 'busy'; return null; }
  session.example = row;
  await showExample(row, view);
  session.phase = kind === 'cut' ? 'cut' : 'merge';
  startActivityWatch();
  return row;
}

/**
 * Nothing ready? A cell left in needs_reset (a learner's tab closed, or the
 * reset job has not run) can be put right here with this learner's token,
 * then used. Not atomic like the RPC, but the row is marked in_use first so
 * two learners racing for it is unlikely.
 */
async function takeNeedsReset(uid: string, kind: PracticeKind): Promise<PracticeExample | null> {
  const { data } = await supabase.from('tutorial_practice_examples').select('*')
    .eq('enabled', true).eq('kind', kind).eq('status', 'needs_reset').order('uses').limit(1);
  const row = (data?.[0] ?? null) as PracticeExample | null;
  if (!row) return null;
  const expires = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
  const { error } = await supabase.from('tutorial_practice_examples')
    .update({ status: 'in_use', claimed_by: uid, claimed_at: new Date().toISOString(), expires_at: expires, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'needs_reset');
  if (error) return null;
  try {
    const r = await undoSinceBaseline(row);
    const roots = row.kind === 'cut' ? {} : { root_a: r.a, root_b: r.b };
    await supabase.from('tutorial_practice_examples')
      .update({ ...roots, reset_failures: 0, last_error: null, last_reset_at: new Date().toISOString() }).eq('id', row.id);
    if (row.kind !== 'cut') { row.root_a = r.a; row.root_b = r.b; }
    row.status = 'in_use'; row.claimed_by = uid;
    return row;
  } catch (e: any) {
    console.warn('[practice] could not reset a waiting cell:', e?.message ?? e);
    await supabase.from('tutorial_practice_examples')
      .update({ status: 'needs_reset', claimed_by: null, claimed_at: null, expires_at: null, last_error: String(e?.message ?? e).slice(0, 500) }).eq('id', row.id);
    return null;
  }
}

async function showExample(ex: PracticeExample, view: PracticeView = 'start') {
  if (session.shownId !== ex.id) {
    await useLayersStore().loadState(ex.state_url);
    // restoreState applies asynchronously; give the layer a moment to exist.
    await new Promise(r => setTimeout(r, 800));
    session.shownId = ex.id;
  }
  await ensureSupervoxels(ex);
  const [a, b] = await Promise.all([rootOfSupervoxel(ex, ex.supervoxel_a), rootOfSupervoxel(ex, ex.supervoxel_b)]);
  session.rootA = a ?? ex.root_a;
  session.rootB = b ?? ex.root_b;
  if (view === 'preview' && ex.kind === 'cut') {
    // The finished cut: piece yellow, cell purple. Old roots still render.
    showOnly(ex.dataset, [ex.root_b, ex.root_a]);
    colorSegments(ex.dataset, [[ex.root_b, PURPLE], [ex.root_a, YELLOW]]);
    return;
  }
  showOnly(ex.dataset, session.rootA === session.rootB ? [session.rootA] : [session.rootA, session.rootB]);
  // Merge example: cell purple, loose piece yellow. Cut example: the fused
  // segment purple, so the piece cut off it stands out in its own colour.
  colorSegments(ex.dataset, session.rootA === session.rootB
    ? [[session.rootA, PURPLE]]
    : [[session.rootA, PURPLE], [session.rootB, YELLOW]]);
}

/** True when the two pieces currently share a root. */
export async function piecesMerged(): Promise<boolean | null> {
  const ex = session.example;
  if (!ex) return null;
  await ensureSupervoxels(ex);
  const [a, b] = await Promise.all([rootOfSupervoxel(ex, ex.supervoxel_a), rootOfSupervoxel(ex, ex.supervoxel_b)]);
  if (!a || !b) return null;
  const changed = a !== session.rootA || b !== session.rootB;
  session.rootA = a;
  session.rootB = b;
  if (changed) {
    // New roots after an edit: keep the story's colours on them.
    colorSegments(ex.dataset, a === b ? [[a, PURPLE]] : [[a, PURPLE], [b, YELLOW]]);
  }
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
      // A cut example keeps its post-cut roots: they are the preview.
      p_root_a: ex.kind === 'cut' ? null : (rootA || null),
      p_root_b: ex.kind === 'cut' ? null : (rootB || null),
      p_error: err,
    });
    if (error) console.warn('[practice] release failed:', error.message);
    session.example = null;
    session.shownId = '';
    session.rootA = '';
    session.rootB = '';
    session.phase = 'done';
    session.releasing = null;
  })();
  return session.releasing;
}
