import { practiceAction } from './pilot_actions';
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
  claim_nonce: string | null;
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
async function undoSinceBaseline(ex: PracticeExample, assertLease: () => Promise<void>): Promise<{ a: string; b: string; undone: number }> {
  await assertLease();
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
  for (const op of activeOps) { await assertLease(); await undoOp(ex, op.operationId); }
  await assertLease();
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
  if (!session.example?.claim_nonce || !['merge', 'cut'].includes(session.phase)) return;
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
  if (!Object.keys(session.held).length) return null;
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
    const cells = Object.values(session.held);
    if (!cells.length) { clearInterval(activityTimer!); activityTimer = null; return; }
    const idle = Date.now() - lastActivity;
    // Active: push every held claim's expiry along once a minute.
    if (idle < WARN_AFTER_MS && Date.now() - lastHeartbeat > 60 * 1000) {
      lastHeartbeat = Date.now();
      for (const ex of cells) {
        practiceAction('heartbeat', { id: ex.id, session: ex.claim_nonce }).catch((error) => {
          console.warn('[practice] heartbeat failed:', error.message);
          for (const [slot, held] of Object.entries(session.held)) {
            if (held.id === ex.id && held.claim_nonce === ex.claim_nonce) delete session.held[slot];
          }
          if (session.example?.id === ex.id && session.example?.claim_nonce === ex.claim_nonce) practiceUnavailable();
        });
      }

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

/** How many cells of a kind exist, and how many could be claimed right now
 *  (ready, or held by this learner, or expired). Reads only. */
/**
 * How many cells of a kind can be used, are free, and are held by someone
 * else right now. A cell whose reset failed (or that was never set up) does
 * not count: it would block the tutorial for everyone while nobody is on it
 * (Ames, 2026-09-29: "in use" with no one using it).
 */
export async function practiceAvailability(kind: PracticeKind): Promise<{ registered: number; free: number; heldByOthers: number }> {
  const uid = userId();
  const { data: all, error } = await supabase.from('tutorial_practice_examples')
    .select('kind,status,claimed_by,expires_at,last_error,updated_at,supervoxel_a,supervoxel_b').eq('enabled', true);
  if (error || !all) { console.warn('[practice] availability check failed:', error?.message); return { registered: 0, free: 0, heldByOthers: 0 }; }
  const now = Date.now();
  const live = (r: any) => r.status === 'in_use' && (!r.expires_at || Date.parse(r.expires_at) > now);
  const data = all.filter((r: any) => r.kind === kind);
  // Cells of the other tutorial on the same neuron: a reset of one undoes
  // edits on the other, so someone in the Cut tutorial holds the Merge
  // tutorial too, and the other way round (both use one neuron, 2026-09-29).
  const pieces = new Set(data.flatMap((r: any) => [r.supervoxel_a, r.supervoxel_b]).filter(Boolean));
  const neighbourHeld = all.filter((r: any) => r.kind !== kind && live(r) && r.claimed_by !== uid
    && [r.supervoxel_a, r.supervoxel_b].some((sv: string) => sv && pieces.has(sv))).length;
  const usable = data.filter((r: any) => r.status === 'ready' || r.status === 'in_use' || r.status === 'resetting'
    // A reset still pending (the job runs every 10 minutes), not a failed one.
    || (r.status === 'needs_reset' && !r.last_error && Date.parse(r.updated_at) > now - 15 * 60 * 1000));
  const free = usable.filter((r: any) => r.status === 'ready' || (r.status === 'in_use' && (r.claimed_by === uid || !live(r)))).length;
  const heldByOthers = usable.filter((r: any) => live(r) && r.claimed_by !== uid).length + neighbourHeld;
  // While the neighbour is held, nothing here counts as free.
  return { registered: usable.length, free: neighbourHeld ? 0 : free, heldByOthers };
}

/** Cells a tutorial needs before it starts: both of its practice cells when
 *  two are registered, otherwise whatever exists. */
export async function tutorialNeeds(kind: PracticeKind): Promise<{ needed: number; free: number; registered: number; heldByOthers: number }> {
  const a = await practiceAvailability(kind);
  return { needed: Math.min(2, Math.max(1, a.registered)), free: a.free, registered: a.registered, heldByOthers: a.heldByOthers };
}

let tutorialWaitTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Get in line for a whole tutorial (Amy): join the queue, watch every 20 s,
 * and when first in line with enough cells free, notify and call onReady.
 */
export async function waitForTutorial(kind: PracticeKind, onReady: () => void, onPosition: (n: number, needed: number) => void) {
  const uid = userId();
  if (!uid) return;
  stopWaitingForTutorial();
  const { error } = await supabase.from('tutorial_practice_waitlist')
    .upsert({ user_id: uid, kind, created_at: new Date().toISOString() }, { onConflict: 'user_id,kind' });
  if (error) console.warn('[practice] waitlist join failed:', error.message);
  const check = async () => {
    const { data } = await supabase.from('tutorial_practice_waitlist').select('user_id').eq('kind', kind).order('created_at');
    const queue = (data ?? []).map((r: any) => r.user_id as string);
    const pos = queue.indexOf(uid);
    const need = await tutorialNeeds(kind);
    onPosition(pos < 0 ? 1 : pos + 1, need.needed);
    if (pos > 0 || need.free < need.needed) return;
    stopWaitingForTutorial();
    try {
      const { useProofreadingBackendStore } = await import('./store');
      await useProofreadingBackendStore().createSelfNotification({
        title: kind === 'cut' ? 'The Cut tutorial is free' : 'The Merge tutorial is free',
        body: 'Your turn. Open the burger menu at the top right and start it; the practice cells are yours once you begin.',
      });
    } catch { /* the card says it too */ }
    onReady();
  };
  await check();
  if (!tutorialWaitTimer) tutorialWaitTimer = setInterval(check, 20 * 1000);
}

export function stopWaitingForTutorial() {
  if (tutorialWaitTimer) { clearInterval(tutorialWaitTimer); tutorialWaitTimer = null; }
  leaveWaitlist();
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
  /** The cell the current step works on. */
  example: null as PracticeExample | null,
  /** Every cell this learner holds, by slot ('a' for the first practice
   *  step of a tutorial, 'b' for the second). All go back together at the
   *  end, so one learner runs the whole tutorial on cells nobody else can
   *  take (Amy: one person at a time, and the merge section has two parts). */
  held: {} as Record<string, PracticeExample>,
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

function pausePracticeTools() {
  const viewer = getViewer();
  viewer?.globalToolBinder?.activeTool_?.cancel?.();
  viewer?.toolBinder?.activeTool_?.cancel?.();
}

function practiceUnavailable() {
  session.example = null;
  session.shownId = '';
  session.phase = 'unavailable';
  pausePracticeTools();
  document.dispatchEvent(new CustomEvent('nge:practice-unavailable'));
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

/** Whether this learner holds a cell in the slot. */
export function holdsSlot(slot: string): boolean {
  return !!session.held[slot];
}

/** True once a practice view is on screen (no need to announce the move). */
export function practiceShown(): boolean {
  return !!session.shownId;
}

/** Claim (or keep) a practice cell in a slot and show it. `show: false`
 *  only claims, for a slot the tutorial will show later (Merge step 3 takes
 *  both cells up front; loading the second view there cost seconds). */
export async function beginPractice(kind: PracticeKind = 'merge_then_cut', view: PracticeView = 'start', opts: { slot?: string; show?: boolean } = {}): Promise<PracticeExample | null> {
  const slot = opts.slot ?? 'a';
  const show = opts.show !== false;
  // Right after a reload the login is still settling; give it a few seconds
  // before deciding the learner is signed out (Amy saw "you need to be
  // signed in" while signed in).
  let uid = userId();
  for (let i = 0; !uid && i < 12; i++) { await new Promise(r => setTimeout(r, 500)); uid = userId(); }
  if (!uid) { practiceUnavailable(); return null; }
  const held = session.held[slot];
  if (held && held.claimed_by === uid && held.kind === kind) {
    try { await practiceAction('heartbeat', { id: held.id, session: held.claim_nonce }); }
    catch { delete session.held[slot]; practiceUnavailable(); return null; }
    if (!show) return held;
    session.example = held;
    await showExample(held, view);
    session.phase = kind === 'cut' ? 'cut' : 'merge';
    resumeTool();
    startActivityWatch();
    return held;

  }
  // A different kind in this slot (merge tutorial, then cut tutorial): put
  // everything back first.
  if (Object.values(session.held).some(ex => ex.kind !== kind)) await endPractice();
  session.phase = 'claiming';
  pausePracticeTools();
  const exclude = Object.values(session.held).map(ex => ex.id);
  // Never hand out a cell registered wrong (Celia's Test cell holds segment
  // ids where supervoxels belong, so nothing can tell when it is merged).
  try {
    const { data } = await supabase.from('tutorial_practice_examples')
      .select('id,supervoxel_a,supervoxel_b').eq('enabled', true).eq('kind', kind);
    for (const r of (data ?? []) as any[]) {
      const bad = [r.supervoxel_a, r.supervoxel_b].some((sv: string) => sv && pcgLayer(sv) !== 1)
        || (r.supervoxel_a && r.supervoxel_a === r.supervoxel_b);
      if (bad && !exclude.includes(r.id)) exclude.push(r.id);
    }
  } catch { /* the claim still runs */ }
  let row: PracticeExample | null;
  try { row = await practiceAction('claim', { kind, exclude }); }
  catch (error: any) { console.warn('[practice] claim failed:', error.message); practiceUnavailable(); return null; }
  // A claim that hands back a cell already held (the database still has
  // the claim function without p_exclude) counts as nothing free: a
  // practice step never shows the previous step's cell again (Amy).
  console.info(`[practice] claim ${kind} slot ${slot} excluding [${exclude.join(', ')}] returned`, row ? `${row.id} (${row.title})` : 'nothing');
  if (row && exclude.includes(row.id)) row = null;
  if (!row) { session.phase = 'busy'; return null; }
  session.held[slot] = row;
  if (!show) {
    // Claimed, not shown: the step's own cell stays on screen.
    if (session.example) session.phase = kind === 'cut' ? 'cut' : 'merge';
    startActivityWatch();
    return row;
  }

  session.example = row;
  await showExample(row, view);
  session.phase = kind === 'cut' ? 'cut' : 'merge';
  resumeTool();
  startActivityWatch();
  return row;
}

/** Every browser undo obtains a fresh server lease and uses its saved geometry.
 * A paused tab must revalidate before each operation; it cannot resume a reset
 * after the scheduled worker or another learner has taken over. */
export async function resetPracticeExample(exampleId: string, sessionNonce?: string | null): Promise<{a: string; b: string; undone: number}> {
  const ex = await practiceAction('begin_reset', { id: exampleId, session: sessionNonce });
  const nonce = ex.reset_nonce;
  const started = Date.now();
  const assertLease = async () => {
    if (Date.now() - started > 120000) throw new Error('Reset timed out. The scheduled reset will finish it.');
    await practiceAction('check_reset', { id: ex.id, nonce });
  };
  try {
    const result = await undoSinceBaseline(ex, assertLease);
    await practiceAction('finish_reset', { id: ex.id, nonce, clean: true, root_a: result.a, root_b: result.b });
    return result;
  } catch (error: any) {
    await practiceAction('finish_reset', { id: ex.id, nonce, clean: false, error: String(error?.message || error) }).catch(() => {});
    throw error;
  }
}

let resumeToolAfterLoad: 'merge' | 'multicut' | null = null;

function resumeTool() {
  const tool = resumeToolAfterLoad;
  resumeToolAfterLoad = null;
  if (tool) setTimeout(() => ensureTool(tool), 600);
}

/** True while a tool (merge, cut) is switched on. */
function toolActive(): boolean {
  const viewer = getViewer();
  try { if (viewer?.globalToolBinder?.activeTool_ || viewer?.toolBinder?.activeTool_) return true; } catch { /* DOM check */ }
  return !!document.querySelector('.neuroglancer-tool-status');
}

async function showExample(ex: PracticeExample, view: PracticeView = 'start') {
  if (session.shownId !== ex.id) {
    // Loading a view rebuilds the layers, and a tool left on stays bound to
    // the old one: it looks on but does nothing (Ames had to leave and
    // re-enter merge mode at step 6). Switch it off here and back on after.
    const wasOn = toolActive();
    pausePracticeTools();
    await useLayersStore().loadState(ex.state_url);
    // Back on once the practice phase is set (beginPractice does it), so
    // ensureTool's guard lets it through.
    if (wasOn) resumeToolAfterLoad = ex.kind === 'cut' ? 'multicut' : 'merge';
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
  const cells = Object.values(session.held);
  const uid = userId();
  if (!cells.length || !uid) { session.phase = 'none'; return Promise.resolve(); }
  session.releasing = (async () => {
    for (const ex of cells) {
      try { await resetPracticeExample(ex.id, ex.claim_nonce); }
      catch (error: any) { console.warn('[practice] reset left to the scheduled worker:', error?.message || error); }
    }
    session.held = {};
    session.example = null;
    session.shownId = '';
    session.rootA = '';
    session.rootB = '';
    session.phase = 'done';
    session.releasing = null;
  })();
  return session.releasing;
}
