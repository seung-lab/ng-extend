/**
 * lightbulb_service.ts
 * Eyewire II — CAVE API helpers for cell completion and annotation.
 *
 * Per-dataset CAVE config is resolved via getDatasetCaveConfig() in config.ts.
 * Each dataset (stroeh_mouse_retina, pinky_sandbox, etc.) can have its own
 * annotation tables, datastack, and aligned volume.
 */

import { reportWriteFailure } from '../util/error_reporting';
import {getDatasetCaveConfig, isRegisteredDataset, EYEWIRE_II_CAVE_CONFIG, type DatasetCaveConfig} from '../config';
import {useProofreadingBackendStore, useCellHistoryStore, useUserStatsStore} from '../store';
import {supabase} from '../supabase';
import {currentDatasetTag} from '../datasets';
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import {cellAtCrosshair} from '../util/crosshair_cell';
import {markToCarry, type KeptMark} from '../util/mark_follow';
import {ancestorAmong, latestDescendants, getRootFromSupervoxel} from './pcg_service';
import nurroSuccess from '../../static/nurro/nurro-success.png';
import nurroTrophy from '../../static/nurro/nurro-trophy.png';
import nurroCelebrate from '../../static/nurro/nurro-celebrate.png';
import nurroDance from '../../static/nurro/nurro-dance.png';
import nurroAtHome from '../../static/nurro/nurro-at-home.png';
import nurroConfetti from '../../static/nurro/nurro-confetti.png';
import nurroCelebrate2 from '../../static/nurro/nurro-celebrate2.png';
import nurroPopcorn from '../../static/nurro/nurro-popcorn.png';
import nurroCelebrate3 from '../../static/nurro/nurro-celebrate3.png';
import nurroExperiment from '../../static/nurro/nurro-experiment.png';
export const NURRO_IMAGES = [nurroSuccess, nurroTrophy, nurroCelebrate, nurroDance, nurroAtHome, nurroConfetti, nurroCelebrate2, nurroPopcorn, nurroCelebrate3, nurroExperiment];

// ─── Auth token helpers (mirrors the pattern in store.ts) ───────────────────

/** All CAVE backends we use (minnie.microns-daf.com, global.daf-apis.com, etc.)
 *  authenticate through this single sticky_auth realm. Tokens for other realms
 *  (e.g. global.brain-wire-test.org/sticky_auth, used by the state server) are
 *  NOT valid for CAVE writes — sending them returns 401 "invalid_token". */
const CAVE_STICKY_AUTH_URL = 'https://global.daf-apis.com/sticky_auth';

function getAuthToken(_caveServer: string): string | null {
  try {
    const raw = window.localStorage.getItem(`auth_token_v2_${CAVE_STICKY_AUTH_URL}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.accessToken ?? null;
  } catch { return null; }
}

function authHeaders(caveServer: string): HeadersInit {
  const token = getAuthToken(caveServer);
  return {
    'Content-Type': 'application/json',
    ...(token ? {'Authorization': `Bearer ${token}`} : {}),
  };
}

/** Parse the auth realm hostname from a 401's WWW-Authenticate header.
 *  CAVE 401s advertise `Bearer realm="https://global.daf-apis.com/sticky_auth/..."`,
 *  and tokens in localStorage are keyed by that realm host — NOT the API host. */
function parseAuthRealmHost(res: Response): string | undefined {
  const m = res.headers.get('www-authenticate')?.match(/realm="([^"]+)"/);
  if (!m) return undefined;
  try { return new URL(m[1]).hostname; } catch { return undefined; }
}

/** Notify the app shell on a CAVE 401 so a banner can prompt the user.
 *
 *  We deliberately do NOT clear the token here. Neuroglancer's middleauth
 *  tokens don't carry a `tokenExpiration` field, so we can't tell whether
 *  the token is actually past its TTL or whether the server is rejecting it
 *  for another reason (server hiccup, scope mismatch, transient bug). Old
 *  behavior was to clear on every 401, which forced a re-login loop where
 *  every retry failed for the same reason and the user got stuck behind
 *  the "session expired" banner indefinitely.
 *
 *  Today: just dispatch the banner. If the token IS truly expired, the
 *  user clicks "Refresh to log in again" and neuroglancer's middleauth
 *  flow re-prompts naturally. If it's a server-side issue, the token stays
 *  put and the next attempt succeeds once the server recovers. */
function handleCaveAuthExpired(caveServer: string, _realmHost?: string): void {
  document.dispatchEvent(new CustomEvent('nge:cave-auth-expired', {
    detail: { server: caveServer },
  }));
}

// ─── Materialization version + query body helpers ──────────────────────────

const _versionCache = new Map<string, number>();

async function getLatestMaterializedVersion(
    caveServer: string, datastack: string): Promise<number | null> {
  const cacheKey = `${caveServer}:${datastack}`;
  const cached = _versionCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(
      `${caveServer}/materialize/api/v3/datastack/${datastack}/versions`,
      {headers: authHeaders(caveServer)});
    if (!res.ok) return null;
    const versions: number[] = await res.json();
    if (!Array.isArray(versions) || versions.length === 0) return null;
    const latest = Math.max(...versions);
    _versionCache.set(cacheKey, latest);
    return latest;
  } catch { return null; }
}

/** Build JSON body for /datastack/<ds>/query (live query). pt_root_id is
 *  emitted as a JSON int literal (not quoted) — JS Number can't hold root_ids
 *  precisely (> 2^53), and postgres BIGINT comparison against a quoted string
 *  isn't reliable. We hand-build the JSON to bypass JS number precision. */
function buildLiveQueryBody(table: string, timestamp: string, rootId: string): string {
  return `{"table":"${table}","timestamp":"${timestamp}","filter_in_dict":{"${table}":{"pt_root_id":[${rootId}]}}}`;
}

/** Same idea for /version/<N>/table/<t>/query (frozen / materialized query). */
function buildFrozenQueryBody(table: string, rootId: string): string {
  return `{"filter_in_dict":{"${table}":{"pt_root_id":[${rootId}]}}}`;
}

/** Try live query first (catches writes after the latest materialization),
 *  fall back to the materialized snapshot if live errors out. Returns the
 *  parsed row array, or [] if both paths fail. */
async function queryAnnotationsForRootId(
    caveServer: string, datastack: string,
    table: string, rootId: string): Promise<any[]> {
  const nowIso = new Date().toISOString();
  // Live query — returns rows including post-materialization writes.
  try {
    const res = await fetch(
      `${caveServer}/materialize/api/v3/datastack/${datastack}/query?return_pyarrow=false`,
      {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: buildLiveQueryBody(table, nowIso, rootId),
      });
    if (res.ok) {
      const rows = await res.json();
      console.info(`[lightbulb] live query ${table} → ${rows.length} rows`);
      return rows;
    }
    console.warn(`[lightbulb] live query ${table} ${res.status} — falling back to materialized`);
  } catch (e) {
    console.warn(`[lightbulb] live query ${table} error — falling back to materialized:`, e);
  }
  // Fallback: materialized snapshot at the latest version.
  const version = await getLatestMaterializedVersion(caveServer, datastack);
  if (version === null) return [];
  try {
    const res = await fetch(
      `${caveServer}/materialize/api/v3/datastack/${datastack}/version/${version}/table/${table}/query?return_pyarrow=false`,
      {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: buildFrozenQueryBody(table, rootId),
      });
    if (res.ok) {
      const rows = await res.json();
      console.info(`[lightbulb] materialized v${version} ${table} → ${rows.length} rows`);
      return rows;
    }
    console.warn(`[lightbulb] materialized v${version} ${table} ${res.status}`);
  } catch (e) {
    console.warn(`[lightbulb] materialized ${table} error:`, e);
  }
  return [];
}

// ─── User attribution (interim — CAVE schemas don't have user_id) ──────────
// CAVE's bound_tag and cell_type_local schemas don't include a per-row user_id
// column, so we encode the writer's identifier into the existing string fields
// until the schema is extended:
//   - cell_type_local: stash user in `classification_system` (currently always
//     '' for ng-extend writes; the original 480 stroeh rows use AC/RGC there
//     so we leave those untouched).
//   - bound_tag tag='complete' (cell_status): write `complete|<user>`. Read
//     filter accepts either bare 'complete' or the prefixed form.
//   - bound_tag tag=<cell type> (cell_type_dev): write `<cell_type>|<user>`.
//     Read parses the suffix.
// USER_DELIMITER is unique enough not to collide with cell-type free text.
const USER_DELIMITER = '|by:';

function getUserIdentifier(): string {
  try {
    // Avoid a circular import at module load — resolve lazily.
    const backend = useProofreadingBackendStore();
    return backend.userName || backend.userEmail?.split('@')[0] || 'anon';
  } catch { return 'anon'; }
}

function encodeTag(base: string): string {
  const u = getUserIdentifier();
  return u && u !== 'anon' ? `${base}${USER_DELIMITER}${u}` : base;
}

function decodeTag(stored: string | undefined): {value: string; user?: string} {
  if (!stored) return {value: ''};
  const i = stored.indexOf(USER_DELIMITER);
  if (i < 0) return {value: stored};
  return {value: stored.slice(0, i), user: stored.slice(i + USER_DELIMITER.length)};
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CellStatus {
  isComplete: boolean;
  /** ID of the completion annotation row (needed for deletion / unmark). */
  annotationId?: number;
  cellType?: string;
  /** Classification system (e.g. 'RGC', 'AC') from cell_type_local schema. */
  classificationSystem?: string;
  cellTypeAnnotationId?: number;
  /** User who labeled the cell type (parsed from interim user attribution). */
  labeledBy?: string;
  /** User who marked the cell complete. */
  completedBy?: string;
}

// ─── localStorage fallback for dev/testing ──────────────────────────────────
// When CAVE dev tables don't exist yet, annotations are stored locally so the
// full UI flow can be tested end-to-end.  Once real tables are created, the
// CAVE API calls succeed and the fallback is never used.

// _v3 (2026-04-29): re-keyed by segment root ID instead of viewer position.
// Position keying caused cross-row leakage in the seg-list — every row's
// localStorage merge read the SAME current-viewer-position entry, so every
// row showed the most recently written cellType. Bumping the key version
// discards legacy positional entries (incompatible format).
const LOCAL_ANNOTATION_KEY = 'nge_local_annotations_v3';

interface LocalAnnotationStore {
  /** Keys are "seg:<rootId>" — one entry per segment root ID. */
  [key: string]: {
    isComplete: boolean;
    cellType: string;
    /** The supervoxel the mark was made on, when known: it says which cell
     *  the mark belongs to after any number of edits, as CAVE itself does. */
    sv?: string;
  };
}

/** Generate a segment-keyed localStorage key from a root ID. */
function segKey(rootId: string): string {
  return `seg:${rootId}`;
}

function getLocalAnnotations(): LocalAnnotationStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ANNOTATION_KEY) || '{}');
  } catch { return {}; }
}

function setLocalAnnotation(key: string, data: Partial<{isComplete: boolean; cellType: string; sv: string}>) {
  const store = getLocalAnnotations();
  store[key] = { ...{isComplete: false, cellType: ''}, ...store[key], ...data };
  localStorage.setItem(LOCAL_ANNOTATION_KEY, JSON.stringify(store));
}

/**
 * This browser's copy of a cell's marks, following the cell through edits.
 *
 * A mark made in the menu shows at once from this copy, kept under the ID the
 * cell had then; CAVE only starts reporting a new mark some time later. An
 * edit gives the cell a new ID, so straight after a merge the cell type or
 * completion just set was gone from the menu (Nseraf 2026-10-11: "the
 * annotation does not follow with the new segID"). When the new ID has no
 * copy, the cell's history is asked whether an ID that has one led to it,
 * and that copy is carried over to the new ID.
 */
const followed = new Map<string, Promise<void>>();
let lineageBusy = 0;
const lineageQueue: (() => void)[] = [];
async function carryLocalAnnotation(rootId: string): Promise<void> {
  const marks: Record<string, KeptMark> = {};
  const store = getLocalAnnotations();
  for (const k of Object.keys(store)) if (k.startsWith('seg:')) marks[k.slice(4)] = store[k];
  // A long segment list asks for many cells at once: a few at a time.
  if (lineageBusy >= 4) await new Promise<void>(go => lineageQueue.push(go));
  lineageBusy++;
  let from: string | null = null;
  try {
    from = await markToCarry(rootId, marks, { ancestorAmong, rootOfSupervoxel: getRootFromSupervoxel, liveEnds: latestDescendants });
  } finally { lineageBusy--; lineageQueue.shift()?.(); }
  const old = from ? getLocalAnnotations()[segKey(from)] : undefined;
  if (!old || getLocalAnnotations()[segKey(rootId)]) return;
  setLocalAnnotation(segKey(rootId), { isComplete: !!old.isComplete, cellType: old.cellType || '', ...(old.sv ? { sv: old.sv } : {}) });
}
/** Note the spot a mark was just made on, if the crosshairs are in the cell. */
function rememberMarkSpot(rootId: string) {
  void cellAtCrosshair().then(at => {
    if (at.supervoxel && at.root === rootId && getLocalAnnotations()[segKey(rootId)]) setLocalAnnotation(segKey(rootId), { sv: at.supervoxel });
  }).catch(() => { /* the mark is kept without its spot */ });
}
/** The copy for this cell, carried over from an earlier ID of it if need be. */
async function localAnnotationFor(rootId: string): Promise<LocalAnnotationStore[string] | undefined> {
  const exact = getLocalAnnotations()[segKey(rootId)];
  if (exact || !/^\d+$/.test(rootId)) return exact;
  // Asked once per ID and per number of marks kept, not on every redraw.
  const key = rootId + ':' + Object.keys(getLocalAnnotations()).length;
  let p = followed.get(key);
  if (!p) { p = carryLocalAnnotation(rootId).catch(() => { followed.delete(key); }); followed.set(key, p); }
  await p;
  return getLocalAnnotations()[segKey(rootId)];
}

function deleteLocalAnnotation(key: string, field: 'isComplete' | 'cellType') {
  const store = getLocalAnnotations();
  if (!store[key]) return;
  if (field === 'isComplete') store[key].isComplete = false;
  if (field === 'cellType') store[key].cellType = '';
  localStorage.setItem(LOCAL_ANNOTATION_KEY, JSON.stringify(store));
}

// ─── Current dataset helper ─────────────────────────────────────────────────

function getCurrentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      // Check layer type name (works even if dataSources haven't loaded)
      const typeName = ml.layer?.constructor?.name ?? '';
      if (typeName.includes('Segmentation') || ml.layer?.type === 'segmentation') return ml.name ?? '';
      // Fallback: check URL
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('graphene') || url.includes('segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

// ─── Current viewer position helper ─────────────────────────────────────────

function getViewerPosition(): [number, number, number] {
  try {
    const viewer = (window as any)['viewer'];
    const pos = viewer?.navigationState?.position?.value;
    if (pos && pos.length >= 3) {
      return [Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2])];
    }
  } catch {}
  return [0, 0, 0];
}

// ─── Cell status (mark complete) ────────────────────────────────────────────

// ─── Per-dataset config resolution ──────────────────────────────────────────

/** PCG table name out of the active graphene layer URL, e.g. 'pni_mec'.
 *  Unlike the layer name this is chosen by whoever built the volume, not by
 *  whoever saved the state, so it is the reliable identifier. */
function getCurrentGrapheneTable(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.startsWith('graphene://')) {
        const m = url.match(/\/segmentation\/table\/([^/?#]+)/);
        if (m) return m[1];
      }
    }
  } catch {}
  return '';
}

/** Resolve the CAVE config for the currently active dataset in the viewer. */
function getActiveDatasetConfig(): DatasetCaveConfig {
  const layerName = getCurrentDataset();
  if (isRegisteredDataset(layerName)) return getDatasetCaveConfig(layerName);
  // The layer name did not resolve. States shared out of spelunker routinely
  // use generic names ('seg', 'segmentation'), and accepting the default here
  // is how CAVE writes end up on the production retina. Try the PCG table in
  // the graphene URL before giving up.
  const table = getCurrentGrapheneTable();
  if (isRegisteredDataset(table)) return getDatasetCaveConfig(table);
  return getDatasetCaveConfig(layerName);
}

/** CAVE host for whatever dataset is on screen.
 *
 *  MEC lives on hc.himc-cave.com while everything else lives on
 *  minnie.microns-daf.com, so no caller may assume a single server. Priority
 *  mirrors store.ts getCaveServerUrl(): the live graphene layer first (correct
 *  even for an unregistered dataset), then the registered config, then the
 *  global override as a last resort. */
export function activeCaveServer(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.startsWith('graphene://')) {
        const clean = url.replace('graphene://', '').replace('middleauth+', '');
        const u = new URL(clean);
        return `${u.protocol}//${u.host}${u.pathname.split('/segmentation')[0]}`;
      }
    }
  } catch {}
  const cfg = getActiveDatasetConfig();
  // An explore only volume has no CAVE: never borrow another dataset's server.
  if (cfg.exploreOnly) return '';
  return cfg.caveServer || EYEWIRE_II_CAVE_CONFIG.caveServerOverride;
}

// ─── CAVE Annotation API v2 helpers ─────────────────────────────────────────

function annotationBaseUrl(caveServer: string, table: string, alignedVolume?: string): string {
  const vol = alignedVolume ?? getActiveDatasetConfig().alignedVolume;
  return `${caveServer}/annotation/api/v2/aligned_volume/${vol}/table/${table}/annotations`;
}

/**
 * Authenticated fetch through neuroglancer's middleauth pipeline.
 * This bypasses CORS issues by routing through the credentials provider.
 */
/** @internal Authenticated fetch through neuroglancer's middleauth pipeline — for future use. */
export async function caveFetch(url: string, init?: RequestInit): Promise<Response> {
  const maUrl = `middleauth+${url}`;
  const {url: fetchUrl, credentialsProvider} = parseSpecialUrl(maUrl, defaultCredentialsManager);
  // cancellableFetchSpecialOk only supports GET+responseJson, so for POST/DELETE
  // we need to get the credentials and do the fetch ourselves
  if (credentialsProvider) {
    try {
      const creds: any = await credentialsProvider.get(undefined as any);
      const token = creds?.credentials?.token || creds?.token;
      if (token) {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        return fetch(fetchUrl, { ...init, headers });
      }
    } catch {}
  }
  // Fallback: try with localStorage token
  const token = getAuthToken(url);
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...init, headers });
}

/**
 * BANC cell_info: many rows per cell, tag = the label, tag2 = what kind of
 * label ("primary class", "neuron identity", or the parent type a subtype
 * belongs to, e.g. tag "T4a" under tag2 "T4 neuron"). Shown as the primary
 * class plus the most specific type: an identity if there is one, else the
 * deepest label in the hierarchy. Region and projection facts are left out.
 */
const BANC_FACT_KINDS = new Set(['soma region', 'anterior-posterior projection pattern', 'body part innervated',
  'body side innervated', 'innervates leg']);
function bancTypeLabel(rows: any[]): string {
  const live = rows.filter(r => typeof r.tag === 'string' && r.tag && !BANC_FACT_KINDS.has(r.tag2));
  const primary = live.find(r => r.tag2 === 'primary class')?.tag || '';
  const identity = live.find(r => r.tag2 === 'neuron identity')?.tag || '';
  const parents = new Set(live.map(r => r.tag2));
  const deepest = live.filter(r => r.tag2 !== 'primary class' && r.tag2 !== 'neuron identity' && !parents.has(r.tag))
    .map(r => r.tag)[0] || '';
  return [...new Set([primary, identity || deepest].filter(Boolean))].join(' · ');
}

/**
 * Fetch the current completion + cell-type status for a root ID.
 * Uses materialization to find annotations at the current viewer position,
 * with localStorage fallback when CAVE is unavailable.
 */
/**
 * Completion + cell type for a root from Supabase edit_log, for datasets whose
 * CAVE tables don't exist yet (config annotationLog: 'edit_log', MEC). The
 * newest mark_complete / unmark_complete decides completion; the newest
 * set_cell_type decides the type.
 */
async function statusFromEditLog(rootId: string): Promise<CellStatus> {
  const status: CellStatus = {isComplete: false};
  try {
    const {data} = await supabase.from('edit_log')
      .select('operation,user_id,metadata,timestamp')
      .eq('dataset', currentDatasetTag()).eq('segment_after', rootId)
      .in('operation', ['mark_complete', 'unmark_complete', 'set_cell_type'])
      .order('timestamp', {ascending: false}).limit(50);
    const rows = (data || []) as any[];
    const done = rows.find(r => r.operation === 'mark_complete' || r.operation === 'unmark_complete');
    if (done?.operation === 'mark_complete') {
      status.isComplete = true;
      status.annotationId = -1;
      if (done.user_id) status.completedBy = String(done.user_id);
    }
    const typed = rows.find(r => r.operation === 'set_cell_type' && r.metadata?.cell_type);
    if (typed) {
      status.cellType = String(typed.metadata.cell_type);
      status.cellTypeAnnotationId = -1;
      if (typed.user_id) status.labeledBy = String(typed.user_id);
    }
  } catch (e) {
    console.warn('[lightbulb] edit_log status read failed:', e);
  }
  return status;
}

export async function getCellStatus(
    caveServer: string, rootId: string): Promise<CellStatus | null> {
  const dsCfg = getActiveDatasetConfig();
  const {cellStatusTable, cellTypeTable, datastack, cellTypeSchema} = dsCfg;
  // Explore only volumes have no CAVE; a caller may still hand in a default
  // server, so the dataset's own config decides.
  if (!caveServer || dsCfg.exploreOnly || !datastack) return null;
  // A dataset with neither table (CA3): there is nothing to ask CAVE.
  if (!cellStatusTable && !cellTypeTable) return {isComplete: false};

  if (dsCfg.annotationLog === 'edit_log') {
    const logged = await statusFromEditLog(rootId);
    // Your own just-made change shows at once, even before the read sees it.
    const local = await localAnnotationFor(rootId);
    if (local && local.isComplete !== undefined && !logged.isComplete && local.isComplete) { logged.isComplete = true; logged.annotationId = -1; }
    if (local?.cellType && !logged.cellType) { logged.cellType = local.cellType; logged.cellTypeAnnotationId = -1; }
    return logged;
  }

  console.info(`[lightbulb] getCellStatus: datastack=${datastack}, rootId=${rootId}`);

  const status: CellStatus = {isComplete: false};
  let caveAvailable = false;

  // Cell completion — live query first, materialized fallback.
  const completionRows = await queryAnnotationsForRootId(
    caveServer, datastack, cellStatusTable, rootId);
  if (completionRows.length > 0) caveAvailable = true;
  // Match both legacy bare 'complete' and new 'complete|by:<user>' encoding.
  const completionHit = dsCfg.cellStatusSchema === 'proofreading_boolstatus_user'
    // BANC backbone_proofread: a row per proofread cell, proofread = true.
    ? completionRows.find((a: any) => a.proofread === true || a.proofread === 't')
    : dsCfg.cellStatusSchema === 'representative_point'
    // FlyWire proofread_neurons: a row for the cell means it is proofread.
    ? completionRows[0]
    : completionRows.find((a: any) =>
        typeof a.tag === 'string' && (a.tag === 'complete' || a.tag.startsWith('complete' + USER_DELIMITER)));
  if (completionHit) {
    status.isComplete = true;
    status.annotationId = completionHit.id;
    // Prefer server-injected user_id (bound_tag_user schema). Fall back to
    // suffix-decoded user (interim hack on plain bound_tag tables).
    if (completionHit.user_id !== undefined && completionHit.user_id !== null) {
      status.completedBy = String(completionHit.user_id);
    } else {
      const decoded = decodeTag(completionHit.tag);
      if (decoded.user) status.completedBy = decoded.user;
    }
  }

  // Cell type — same hybrid path.
  const cellTypeRows = await queryAnnotationsForRootId(
    caveServer, datastack, cellTypeTable, rootId);
  if (cellTypeRows.length > 0) caveAvailable = true;
  if (cellTypeRows.length > 0 && cellTypeSchema === 'bound_double_tag_user') {
    status.cellType = bancTypeLabel(cellTypeRows);
  } else if (cellTypeRows.length > 0) {
    const latest = cellTypeRows[cellTypeRows.length - 1];
    if (cellTypeSchema === 'cell_type_local') {
      status.cellType = latest.cell_type || latest.tag;
      // classification_system doubles as our interim user_id slot for ng-extend
      // writes. The original 480 stroeh rows use real classifications (AC/RGC),
      // so we pass that through unchanged when it doesn't look like a user id.
      const cs: string = latest.classification_system || '';
      if (cs) {
        // Heuristic: real classifications are short/uppercase (AC, RGC, ON Bipolar
        // Cell). User identifiers are typically lowercase or contain a dot/space.
        // We treat everything as classificationSystem and ALSO surface it as
        // labeledBy if it looks user-like; UIs can pick which to show.
        status.classificationSystem = cs;
        if (/[a-z]|@|\./.test(cs)) status.labeledBy = cs;
      }
    } else {
      // bound_tag (or bound_tag_user). Prefer server-injected user_id when
      // present (bound_tag_user); fall back to suffix-decoded user from the
      // tag (interim hack on plain bound_tag tables).
      if (latest.user_id !== undefined && latest.user_id !== null) {
        status.cellType = latest.tag;  // tag is the cell type, no encoding
        status.labeledBy = String(latest.user_id);
      } else {
        const decoded = decodeTag(latest.tag);
        status.cellType = decoded.value;
        if (decoded.user) status.labeledBy = decoded.user;
      }
    }
    status.cellTypeAnnotationId = latest.id;
  }

  // Always merge localStorage on top of CAVE results: writes are mirrored to
  // localStorage immediately, but CAVE materialization runs only every other
  // day. So a just-written annotation isn't in any materialized version yet
  // and the /query above returns empty. The local mirror fills the gap.
  // Local data only fills fields CAVE didn't already populate (CAVE wins ties).
  // Mirror is keyed by rootId, so each per-segment read gets its own entry.
  {
    // Only when CAVE left something unanswered: it is the record once it knows.
    const local = status.isComplete && status.cellType ? undefined : await localAnnotationFor(rootId);
    if (local) {
      if (!status.isComplete && local.isComplete) {
        status.isComplete = true;
        if (status.annotationId === undefined) status.annotationId = -1;
      }
      if (!status.cellType && local.cellType) {
        status.cellType = local.cellType;
        if (status.cellTypeAnnotationId === undefined) status.cellTypeAnnotationId = -1;
      }
      if (!caveAvailable) {
        console.info('[lightbulb] CAVE not reachable — using localStorage');
      }
    }
  }

  return status;
}

/**
 * Mark or unmark a cell as complete.
 * If marking complete, creates a new annotation row.
 * If unmarking, deletes the existing annotation by ID.
 */
/** Why the last completion was refused, in plain words ('' if it wasn't). */
let lastCompletionProblem = '';
export function getLastCompletionProblem(): string { return lastCompletionProblem; }

/**
 * A completion is saved at a POINT, and CAVE files it under whatever cell is
 * at that point. Without a verified point we use the crosshairs, so they must
 * be inside this cell (or a cell it became through edits): a July completion
 * landed on segment 0 because the crosshairs were on empty space (Amy
 * 2026-09-29). Returns '' when fine, else what to do.
 */
async function crosshairProblem(rootId: string, alsoAccept: string[] = []): Promise<string> {
  const at = await cellAtCrosshair();
  if (!at.root) return at.problem || 'Could not check the crosshairs.';
  if (at.root === rootId || alsoAccept.includes(at.root)) return '';
  const lineage = await ancestorAmong(at.root, [rootId, ...alsoAccept]);
  if (lineage) return '';
  if (lineage === undefined) return 'Could not check the crosshairs against this cell. Try again in a moment.';
  const short = (id: string) => '…' + id.slice(-6);
  return `The crosshairs are inside ${short(at.root)}, not this cell (${short(rootId)}). Move them into the cell, then mark it again.`;
}

export async function setCellComplete(
    caveServer: string, rootId: string, complete: boolean,
    existingAnnotationId?: number,
    pointOverride?: [number, number, number],
    suppressCelebration?: boolean,
    /** Other segments the crosshairs may be on, e.g. a MEC nucleus when the
     *  cell around it is what gets marked. */
    alsoAcceptAtCrosshair: string[] = []): Promise<boolean> {
  const dsCfg = getActiveDatasetConfig();
  const {cellStatusTable, alignedVolume} = dsCfg;
  lastCompletionProblem = '';
  if (!caveServer) {
    console.warn('[lightbulb] No CAVE server — cannot save completion status.');
    return false;
  }
  if (complete && !pointOverride) {
    const problem = await crosshairProblem(rootId, alsoAcceptAtCrosshair);
    if (problem) {
      lastCompletionProblem = problem;
      console.warn('[lightbulb] completion refused:', problem);
      return false;
    }
  }

  const baseUrl = annotationBaseUrl(caveServer, cellStatusTable, alignedVolume);

  // annotationLog: no CAVE table to write; the edit_log path below is the record.
  if (!dsCfg.annotationLog) try {
    // Unmarking needs the mark's ID in CAVE. The menu may only know the copy
    // kept in this browser (shown as -1) or nothing at all, and then the
    // mark was cleared here while CAVE kept it. Look the real one up first.
    if (!complete && (existingAnnotationId === undefined || existingAnnotationId < 0) && dsCfg.datastack && cellStatusTable) {
      const rows = await queryAnnotationsForRootId(caveServer, dsCfg.datastack, cellStatusTable, rootId).catch(() => []);
      const hit = dsCfg.cellStatusSchema === 'proofreading_boolstatus_user' || dsCfg.cellStatusSchema === 'representative_point' ? undefined
        : rows.find((a: any) => typeof a.tag === 'string' && (a.tag === 'complete' || a.tag.startsWith('complete' + USER_DELIMITER)));
      if (hit && typeof hit.id === 'number' && hit.id >= 0) existingAnnotationId = hit.id;
    }
    if (!complete && existingAnnotationId !== undefined) {
      // Local annotation — just clear localStorage
      if (existingAnnotationId < 0) {
        deleteLocalAnnotation(segKey(rootId), 'isComplete');
        return true;
      }
      // CAVE v2 DELETE uses JSON body with annotation_ids
      console.info(`[lightbulb] DELETE completion → ${baseUrl} id=${existingAnnotationId}`);
      const res = await fetch(baseUrl, {
        method: 'DELETE',
        headers: authHeaders(caveServer),
        body: JSON.stringify({ annotation_ids: [existingAnnotationId] }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[lightbulb] CAVE DELETE failed (${res.status}):`, errText);
        lastCompletionProblem = `CAVE did not remove the mark (error ${res.status}), so the cell is still marked. Try again in a moment.`;
      } else {
        // Clear local mirror so the lightbulb doesn't keep showing the deleted state.
        deleteLocalAnnotation(segKey(rootId), 'isComplete');
        // Record the un-mark. It was only recorded when CAVE could not be
        // reached, so a cell unmarked the normal way stayed counted as
        // completed on the leaderboard.
        try {
          const backend = useProofreadingBackendStore();
          if (backend.userId) {
            const p = getViewerPosition();
            backend.logEdit({ operation: 'unmark_complete', segment_after: rootId, coordinates: `${p[0]}, ${p[1]}, ${p[2]}`, metadata: { root_id: rootId } });
          }
        } catch { /* non-critical */ }
      }
      return res.ok;
    }

    if (complete) {
      // pointOverride lets batch-complete supply per-segment crosshair points
      // (otherwise CAVE would resolve every batch row to the live crosshair's
      // pt_root_id — silently bogus).
      const pos = pointOverride ?? getViewerPosition();
      // bound_tag_user → server auto-fills user_id from auth context, no need
      // to encode it into the tag. Plain bound_tag → use the interim suffix.
      const dsCfg = getActiveDatasetConfig();
      const usesAutoUserId = dsCfg.cellStatusSchema === 'bound_tag_user';
      const body = {
        annotations: [{
          pt: {position: pos},
          tag: usesAutoUserId ? 'complete' : encodeTag('complete'),
        }],
      };
      console.info(`[lightbulb] POST completion → ${baseUrl}`, body);
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        const errText = await res.text().catch(() => '');
        console.error('[lightbulb] CAVE 401 — token expired:', errText);
        handleCaveAuthExpired(caveServer, parseAuthRealmHost(res));
        return false;  // do NOT fake-save to localStorage on auth failure
      }
      if (res.ok) {
        console.info(`[lightbulb] ✓ Completion saved to CAVE`);
        // Mirror to localStorage so the lightbulb shows the write immediately,
        // before the next materialization cron run (every other day on stroeh).
        setLocalAnnotation(segKey(rootId), {isComplete: true});
        if (!pointOverride) rememberMarkSpot(rootId);
        // Notify all rendered lightbulbs in the seg panel so their triangle
        // pip flips immediately. Without this, the pip stays gray until page
        // reload — particularly visible after batch completions.
        document.dispatchEvent(new CustomEvent('nge:seg-status-changed', {
          detail: { segId: rootId, status: { isComplete: true } },
        }));
        try {
          const backend = useProofreadingBackendStore();
          if (backend.userId) {
            const p = pointOverride ?? getViewerPosition();
            backend.logEdit({ operation: 'mark_complete', segment_after: rootId, coordinates: `${p[0]}, ${p[1]}, ${p[2]}`, metadata: { root_id: rootId } });
            backend.postActivity(`marked ...${rootId.slice(-4)} complete`, rootId);
          }
        } catch { /* non-critical */ }
        // Update local cell history & stats so Profile UI reflects immediately
        try {
          const historyStore = useCellHistoryStore();
          historyStore.upsert({
            segId: rootId,
            isComplete: true,
            claimPoint: pos,
            position: pos,
            dataset: getCurrentDataset(),
          });
          const statsStore = useUserStatsStore();
          statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
          statsStore.logDailyCellComplete();
        } catch { /* non-critical */ }
        // Celebration! Read fresh count from Supabase for accuracy.
        // Skipped when suppressCelebration is set — used by the batch wizard so
        // we don't pop the overlay 25× during a batch; wizard fires its own
        // single batch celebration once the loop finishes.
        if (!suppressCelebration) {
          try {
            const backend = useProofreadingBackendStore();
            await backend.loadUserStats(); // refresh from DB
            const statsStore = useUserStatsStore();
            const total = statsStore.stats.cellsSubmitted;
            const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
            backend.pendingCellCelebration = {
              totalCells: total,
              imageUrl: nurro,
              segId: rootId,
            };
          } catch { /* non-critical */ }
        }
        return true;
      }
      const errText = await res.text().catch(() => '');
      console.error(`[lightbulb] CAVE POST failed (${res.status}):`, errText);
      reportWriteFailure('cave_write', `proofread mark ${res.status} on ${getActiveDatasetConfig().cellStatusTable}`, errText.slice(0, 500));
      // CAVE did not save it, so it is NOT proofread. This used to fall
      // through to "saved in this browser only": the menu said Proofread,
      // the completion was counted and the sheet was written, while CAVE and
      // every other browser still said In Progress (Krzysztof 2026-10-09).
      lastCompletionProblem = `CAVE did not save this (error ${res.status}), so the cell is not marked. Try again in a moment.`;
      return false;
    }
  } catch (e) {
    console.error('[lightbulb] setCellComplete — CAVE network error:', e);
    lastCompletionProblem = 'CAVE could not be reached, so nothing was changed. Try again in a moment.';
    return false;
  }

  // localStorage fallback — save locally so UI still works (keyed by rootId)
  const fallbackPos = pointOverride ?? getViewerPosition();
  setLocalAnnotation(segKey(rootId), {isComplete: complete});
  document.dispatchEvent(new CustomEvent('nge:seg-status-changed', {
    detail: { segId: rootId, status: { isComplete: complete } },
  }));
  console.info(`[lightbulb] Saved completion locally for ${segKey(rootId)} (CAVE unavailable)`);
  // Update local cell history & stats so Profile UI reflects immediately
  try {
    const historyStore = useCellHistoryStore();
    historyStore.upsert({
      segId: rootId,
      isComplete: complete,
      claimPoint: fallbackPos,
      position: fallbackPos,
      dataset: getCurrentDataset(),
    });
    const statsStore = useUserStatsStore();
    if (complete) {
      statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
      statsStore.logDailyCellComplete();
    } else {
      // Decrement on unmark (don't go below 0)
      statsStore.setStats({ cellsSubmitted: Math.max(0, statsStore.stats.cellsSubmitted - 1) });
    }
  } catch { /* non-critical */ }
  // Log to Supabase regardless of CAVE/local path
  try {
    const backend = useProofreadingBackendStore();
    if (backend.userId) {
      backend.logEdit({
        operation: complete ? 'mark_complete' : 'unmark_complete',
        segment_after: rootId,
        coordinates: `${fallbackPos[0]}, ${fallbackPos[1]}, ${fallbackPos[2]}`,
        metadata: { root_id: rootId },
      });
      backend.postActivity(
        complete ? `marked ...${rootId.slice(-4)} complete` : `unmarked ...${rootId.slice(-4)}`,
        rootId,
      );
    }
  } catch { /* non-critical */ }
  // Celebration on complete (fallback path — CAVE was unavailable)
  if (complete) {
    try {
      const backend = useProofreadingBackendStore();
      await backend.loadUserStats();
      const statsStore = useUserStatsStore();
      const total = statsStore.stats.cellsSubmitted;
      const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
      backend.pendingCellCelebration = {
        totalCells: total,
        imageUrl: nurro,
      };
    } catch { /* non-critical */ }
  }
  return true;
}

/**
 * Save (or update) the cell-type annotation for a root ID.
 */
// ── Admin check: are the logged cell types in CAVE? (src/util/cell_type_check.ts) ──

/** Every row of this dataset's cell type table, as CAVE lists it now. The
 *  cell IDs are read as TEXT: they are larger than a JavaScript number holds.
 *  `problem` says why when it could not be read. */
export async function listCaveCellTypes(): Promise<{
  rows: { rootId: string; type: string; point: [number, number, number] | null; created: string | null }[];
  problem: string;
}> {
  const cfg = getActiveDatasetConfig();
  const { caveServer, datastack, cellTypeTable, cellTypeSchema } = cfg;
  if (!caveServer || !datastack || !cellTypeTable || cfg.exploreOnly) return { rows: [], problem: 'This dataset has no cell type table in CAVE.' };
  if (cfg.annotationLog || cfg.cellTypeReadOnly) return { rows: [], problem: 'The game does not write cell types to CAVE on this dataset, so there is nothing to compare.' };
  try {
    const res = await fetch(`${caveServer}/materialize/api/v3/datastack/${datastack}/query?return_pyarrow=false`, {
      method: 'POST', headers: authHeaders(caveServer),
      body: JSON.stringify({ table: cellTypeTable, timestamp: new Date().toISOString() }),
    });
    if (!res.ok) return { rows: [], problem: `CAVE did not list the table (error ${res.status}). Sign in to CAVE and try again.` };
    const text = (await res.text()).replace(/("pt_root_id"\s*:\s*)(\d+)/g, '$1"$2"');
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return { rows: [], problem: 'CAVE answered, but not with a list of rows.' };
    const num = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
    const rows = raw.filter((a: any) => a && a.valid !== false && a.valid !== 'f').map((a: any) => {
      const p = Array.isArray(a.pt_position) ? a.pt_position.map(num) : [num(a.pt_position_x), num(a.pt_position_y), num(a.pt_position_z)];
      const tag = cellTypeSchema === 'cell_type_local' ? (a.cell_type || a.tag) : a.user_id != null ? a.tag : decodeTag(a.tag).value;
      return {
        rootId: String(a.pt_root_id ?? '0'),
        type: String(tag ?? ''),
        point: p.length === 3 && p.every(Number.isFinite) ? p as [number, number, number] : null,
        created: a.created ? new Date(a.created).toISOString() : null,
      };
    });
    return { rows, problem: '' };
  } catch (e: any) {
    return { rows: [], problem: `Could not reach CAVE: ${e?.message || e}` };
  }
}

/** Save a cell type at a point taken from the game's log, for a save CAVE
 *  never took. CAVE records whoever is signed in as the one who saved it. */
export async function resendCellType(point: [number, number, number], cellType: string): Promise<{ ok: boolean; problem: string }> {
  const cfg = getActiveDatasetConfig();
  const { caveServer, cellTypeTable, cellTypeSchema, alignedVolume } = cfg;
  if (!caveServer || !cellTypeTable || cfg.annotationLog || cfg.cellTypeReadOnly) return { ok: false, problem: 'This dataset takes no cell types in CAVE.' };
  if (cellTypeSchema !== 'bound_tag_user') return { ok: false, problem: 'Sending again is only set up for the Retina table.' };
  try {
    const res = await fetch(annotationBaseUrl(caveServer, cellTypeTable, alignedVolume), {
      method: 'POST', headers: authHeaders(caveServer),
      body: JSON.stringify({ annotations: [{ pt: { position: point }, tag: cellType }] }),
    });
    if (res.ok) return { ok: true, problem: '' };
    return { ok: false, problem: `CAVE did not save it (error ${res.status}).` };
  } catch (e: any) {
    return { ok: false, problem: `Could not reach CAVE: ${e?.message || e}` };
  }
}

/** Why the last cell type was refused, in plain words ('' if it wasn't). */
let lastCellTypeProblem = '';
export function getLastCellTypeProblem(): string { return lastCellTypeProblem; }

export async function saveCellType(
    caveServer: string, rootId: string, cellType: string,
    existingAnnotationId?: number,
    /** Set when the point is already known to be inside the cell. */
    skipCrosshairCheck = false,
    /** The point to save the type at, in place of the crosshairs: the batch
     *  tool gives each cell the point the player saved inside it. */
    pointOverride?: [number, number, number]): Promise<boolean> {
  const dsCfg = getActiveDatasetConfig();
  const {cellTypeTable, cellTypeSchema, alignedVolume} = dsCfg;
  lastCellTypeProblem = '';
  if (!caveServer) {
    console.warn('[lightbulb] No CAVE server — cannot save cell type.');
    return false;
  }
  // A cell type is saved at a POINT, like a completion, and CAVE files it
  // under whatever cell is at that point. So the crosshairs must be inside
  // this cell (Ames 2026-10-11): then the type lands on the right cell, and
  // the spot says which cell it belongs to after later edits.
  if (!skipCrosshairCheck && !dsCfg.annotationLog) {
    const problem = (await crosshairProblem(rootId)).replace('then mark it again', 'then save the type again');
    if (problem) {
      lastCellTypeProblem = problem;
      console.warn('[lightbulb] cell type refused:', problem);
      return false;
    }
  }

  const baseUrl = annotationBaseUrl(caveServer, cellTypeTable, alignedVolume);
  const pos = pointOverride ?? getViewerPosition();

  // annotationLog: no CAVE table to write; the edit_log path below is the record.
  if (!dsCfg.annotationLog) try {
    // The old type is removed only AFTER the new one is saved (below). It
    // used to be removed first, so a save that failed left the cell with no
    // type in CAVE at all.

    // Create new annotation — schema-aware payload.
    //   - cell_type_local: classification_system carries the interim user
    //     identifier (currently '' for all ng-extend writes; original 480
    //     stroeh rows use AC/RGC there and stay untouched).
    //   - bound_tag_user: tag is the bare cell_type; AnnotationEngine
    //     auto-injects user_id server-side from g.auth_user["id"].
    //   - bound_tag (legacy): tag carries `<cell_type>|by:<user>`; the read
    //     path decodes the suffix.
    const userId = getUserIdentifier();
    let annotation: any;
    if (cellTypeSchema === 'cell_type_local') {
      annotation = {
        pt: {position: pos},
        cell_type: cellType,
        classification_system: userId !== 'anon' ? userId : '',
      };
    } else if (cellTypeSchema === 'bound_tag_user') {
      annotation = {
        pt: {position: pos},
        tag: cellType,  // server fills in user_id
      };
    } else {
      annotation = {
        pt: {position: pos},
        tag: encodeTag(cellType),
      };
    }
    const body = {
      annotations: [annotation],
    };
    console.info(`[lightbulb] POST cell type → ${baseUrl}`, body);
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: authHeaders(caveServer),
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const errText = await res.text().catch(() => '');
      console.error('[lightbulb] CAVE 401 — token expired:', errText);
      handleCaveAuthExpired(caveServer, parseAuthRealmHost(res));
      return false;  // do NOT fake-save to localStorage on auth failure
    }
    if (res.ok) {
      console.info(`[lightbulb] ✓ Cell type saved to CAVE`);
      if (existingAnnotationId !== undefined && existingAnnotationId >= 0) {
        await fetch(baseUrl, {
          method: 'DELETE',
          headers: authHeaders(caveServer),
          body: JSON.stringify({ annotation_ids: [existingAnnotationId] }),
        }).catch(() => {});
      }
      // Mirror to localStorage so the lightbulb shows the write immediately,
      // before the next materialization cron run.
      setLocalAnnotation(segKey(rootId), {cellType});
      rememberMarkSpot(rootId);
      try {
        const backend = useProofreadingBackendStore();
        if (backend.userId) {
          backend.logEdit({ operation: 'set_cell_type', segment_after: rootId, metadata: { root_id: rootId, cell_type: cellType } });
          backend.postActivity(`labeled ...${rootId.slice(-4)} as ${cellType}`, rootId);
        }
      } catch { /* non-critical */ }
      try {
        const historyStore = useCellHistoryStore();
        historyStore.upsert({
          segId: rootId,
          cellType: cellType,
          claimPoint: pos,
          position: pos,
          dataset: getCurrentDataset(),
        });
      } catch { /* non-critical */ }
      return true;
    }
    const errText = await res.text().catch(() => '');
    console.error(`[lightbulb] CAVE POST failed (${res.status}):`, errText);
    reportWriteFailure('cave_write', `cell type ${res.status} on ${getActiveDatasetConfig().cellTypeTable}`, errText.slice(0, 500));
    // CAVE did not save it, so the cell is NOT typed. This used to fall
    // through to "saved in this browser only": the menu said Saved, the type
    // was logged and counted, and CAVE and every other browser had nothing
    // (the same fault completions had until 2026-10-09; Ames 2026-10-12).
    lastCellTypeProblem = `CAVE did not save this (error ${res.status}), so the cell type is not saved. Try again in a moment.`;
    return false;
  } catch (e) {
    console.error('[lightbulb] saveCellType — CAVE network error:', e);
    reportWriteFailure('cave_write', `cell type network error on ${getActiveDatasetConfig().cellTypeTable}`, String((e as any)?.message || e).slice(0, 500));
    lastCellTypeProblem = 'Could not reach CAVE, so the cell type is not saved. Check your connection and try again.';
    return false;
  }

  // localStorage fallback — save locally so UI still works (keyed by rootId)
  setLocalAnnotation(segKey(rootId), {cellType});
  console.info(`[lightbulb] Saved cell type locally for ${segKey(rootId)} (CAVE unavailable)`);
  // Update local cell history so Profile UI reflects immediately
  try {
    const historyStore = useCellHistoryStore();
    historyStore.upsert({
      segId: rootId,
      cellType: cellType,
      claimPoint: pos,
      position: pos,
      dataset: getCurrentDataset(),
    });
  } catch { /* non-critical */ }
  // Log to Supabase regardless of CAVE/local path
  try {
    const backend = useProofreadingBackendStore();
    if (backend.userId) {
      backend.logEdit({ operation: 'set_cell_type', segment_after: rootId, coordinates: `${pos[0]}, ${pos[1]}, ${pos[2]}`, metadata: { root_id: rootId, cell_type: cellType } });
      backend.postActivity(`labeled ...${rootId.slice(-4)} as ${cellType}`, rootId);
    }
  } catch { /* non-critical */ }
  return true;
}
