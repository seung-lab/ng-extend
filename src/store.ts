import {Ref, ref, reactive} from 'vue';
import {defineStore} from 'pinia';

import {Viewer} from 'neuroglancer/viewer';
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {MiddleAuthCredentialsProvider} from 'neuroglancer/datasource/middleauth/credentials_provider';
import {cancellableFetchSpecialOk, parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import {responseJson} from 'neuroglancer/util/http_request';

import {Config, EYEWIRE_II_CAVE_CONFIG} from './config';
import {SegmentationUserLayer} from "neuroglancer/segmentation_user_layer";
import {parsePositionString} from "neuroglancer/ui/default_clipboard_handling";

declare const CONFIG: Config|undefined;
declare const DEFAULT_SETTINGS: {  [key: string]: any }

export const useDropdownListStore = defineStore('dropdownlist', () => {
  let dropdownCount = 0;

  const activeDropdowns = reactive({} as {[group: string]: number|undefined});

  function getDropdownId() {
    dropdownCount++;
    return dropdownCount;
  }

  return {getDropdownId, activeDropdowns};
});

export interface loginSession {
  key: string,
  name: string,
  email: string,
  hostname: string,
  status?: number,
}

export const useLoginStore = defineStore('login', () => {
  const TOKEN_PREFIX = 'auth_token_v2_';

  async function logout(session: loginSession) {
    window.localStorage.removeItem(session.key);
    const login_url = session.key.split(TOKEN_PREFIX)[1] as string|undefined;
    if (!login_url) return;
    const provider = defaultCredentialsManager.getCredentialsProvider('middleauth', login_url) as MiddleAuthCredentialsProvider;
    if (provider) {
      provider.updateCachedGet();
    }
    sessions.value = sessions.value.filter(x => x.key !== session.key);
  }

  async function update() {
    const localStorageKeys: string[] = [];
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(TOKEN_PREFIX)) {
        localStorageKeys.push(key);
      }
    }

    const newSessions: loginSession[] = [];

    for (const key of localStorageKeys) {
      const login_url = key.split(TOKEN_PREFIX)[1] as string|undefined;
      if (!login_url) continue;
      const provider = defaultCredentialsManager.getCredentialsProvider('middleauth', login_url) as MiddleAuthCredentialsProvider;
      if (!provider) continue;

      const dataString = localStorage.getItem(key);
      if (!dataString) { return; }
      const data = JSON.parse(dataString);
      const {hostname} = new URL(data.url);

      try {
        const res = await fetch(data.url + '/api/v1/user/me', {
          headers: {
            "Authorization": `Bearer ${data.accessToken}`,
          }
        });
        if (res.status === 200) {
          const contentType = res.headers.get("content-type");
          const message = await ((contentType === 'application/json') ? res.json() : res.text());
          newSessions.push({
            key,
            name: message.name,
            email: message.email,
            hostname,
          });
        } else {
          newSessions.push({
            key,
            name: '',
            email: '',
            hostname,
            status: res.status,
          });
        }
      } catch (e) {
        e;
        // newSessions.push({
        //   name: '',
        //   email: '',
        //   hostname,
        //   error: e,
        // });
      }
    }

    sessions.value = newSessions;
  }
  const sessions: Ref<loginSession[]> = ref([]);
  return {sessions, update, logout};
});

export interface Volume {
  name: string,
  description: string,
  image_layers: Layer[],
  segmentation_layers: Layer[],
}

interface Layer {
  source: string,
  ngl_image_name?: string,
  name: string,
  description: string,
  type: string,
}


export const useLayersStore = defineStore('layers', () => {
  const activeLayers: Set<string> = reactive(new Set());

  let viewer: Viewer|undefined = undefined;
  let segEditCleanup: (() => void) | null = null;

  function refreshLayers() {
    if (!viewer) return;
    activeLayers.clear();
    const layers = viewer.layerManager.managedLayers;
    for (const layer of layers) {
      if (!layer.layer) {
        console.log('does this ever happen?');
        continue;
      }
      const dataSources = layer.layer.dataSources;
      for (const source of dataSources) {
        activeLayers.add(source.spec.url.replace('middleauth+', ''));
      }
    }
    // Re-attach segment edit watcher whenever layers change
    watchSegmentEdits();
  }

  /**
   * Watch visible segments on the first SegmentationUserLayer.
   * Fires whenever the user merges, splits, or selects new segments.
   *
   * Heuristics:
   *   - segment count decreased → merge (fewer segments = segments were combined)
   *   - segment count increased → split or new selection
   *
   * Also increments cellsSubmitted every ~5 edits to animate the cell-dot canvas.
   */
  function watchSegmentEdits() {
    if (!viewer) return;

    // Clean up previous listener
    if (segEditCleanup) { segEditCleanup(); segEditCleanup = null; }

    const segLayer = viewer.layerManager.managedLayers.find(
      x => x.layer instanceof SegmentationUserLayer,
    );
    if (!segLayer || !(segLayer.layer instanceof SegmentationUserLayer)) return;

    const groupState = (segLayer.layer as SegmentationUserLayer)
      .displayState.segmentationGroupState.value;
    const visibleSegs = groupState.visibleSegments;

    let prevCount = visibleSegs.size;
    let localEditAccum = 0;   // accumulator for simulated cellsSubmitted bumps

    const handler = () => {
      const newCount = visibleSegs.size;
      if (newCount === prevCount) return;

      const statsStore = useUserStatsStore();
      const diff = Math.abs(newCount - prevCount);

      if (newCount < prevCount) {
        // Segments removed → merge (two segments combined into one)
        statsStore.setStats({
          editsAllTime:   statsStore.stats.editsAllTime   + diff,
          mergesAllTime:  statsStore.stats.mergesAllTime  + diff,
          editsThisWeek:  statsStore.stats.editsThisWeek  + diff,
          mergesThisWeek: statsStore.stats.mergesThisWeek + diff,
          editsThisMonth: statsStore.stats.editsThisMonth + diff,
          mergesThisMonth:statsStore.stats.mergesThisMonth+ diff,
          editsToday:     statsStore.stats.editsToday     + diff,
          mergesToday:    statsStore.stats.mergesToday     + diff,
        });
      } else {
        // Segments added → split or new segment selection → count as split / edit
        statsStore.setStats({
          editsAllTime:   statsStore.stats.editsAllTime   + diff,
          splitsAllTime:  statsStore.stats.splitsAllTime  + diff,
          editsThisWeek:  statsStore.stats.editsThisWeek  + diff,
          splitsThisWeek: statsStore.stats.splitsThisWeek + diff,
          editsThisMonth: statsStore.stats.editsThisMonth + diff,
          splitsThisMonth:statsStore.stats.splitsThisMonth+ diff,
          editsToday:     statsStore.stats.editsToday     + diff,
          splitsToday:    statsStore.stats.splitsToday    + diff,
        });
      }

      // Every ~5 edits, also bump cellsSubmitted (simulates cell completion)
      localEditAccum += diff;
      if (localEditAccum >= 5) {
        statsStore.setStats({
          cellsSubmitted: statsStore.stats.cellsSubmitted + 1,
        });
        localEditAccum = 0;
      }

      prevCount = newCount;
    };

    visibleSegs.changed.add(handler);
    segEditCleanup = () => visibleSegs.changed.remove(handler);
  }

  function initializeWithViewer(v: Viewer) {
    viewer = v;

    // set default values in settings
    viewer.chunkQueueManager.capacities.gpuMemory.sizeLimit.value = 2e9;
    viewer.chunkQueueManager.capacities.systemMemory.sizeLimit.value = 3e9;
    viewer.layout.restoreState('xy-3d');
    viewer.layerManager.layersChanged.add(refreshLayers);
    refreshLayers();
  }

  async function selectLayers(layers: any[]) {
    if (!viewer) return;
    viewer.layerSpecification.restoreState(layers);
    viewer.navigationState.reset();

    const segmentationLayer = viewer.layerManager.managedLayers.filter(
        (x) => x.layer instanceof SegmentationUserLayer
    )[0];
    if (segmentationLayer) {
      const segmentationLayerName = segmentationLayer.name;
      const SETTINGS = DEFAULT_SETTINGS[segmentationLayerName]
      viewer!.coordinateSpace.restoreState({
        x: [SETTINGS.dimensions[0], "m"],
        y: [SETTINGS.dimensions[1], "m"],
        z: [SETTINGS.dimensions[2], "m"],
      });

      const position = parsePositionString(SETTINGS.position, 3);
      if (position !== undefined) {
        viewer!.navigationState.position.value = position;
      }
      viewer!.crossSectionScale.value = SETTINGS.crossSectionScale;
      viewer!.projectionScale.value = SETTINGS.projectionScale;
      viewer!.projectionOrientation.restoreState(SETTINGS.projectionOrientation);
    }
  }

  /**
   * Derives the CAVE server base URL from the active neuroglancer state.
   * Priority:
   *   1. middleauth+ layer URL auto-extraction (production)
   *   2. EYEWIRE_II_CAVE_CONFIG.caveServerByDataset keyed by layer name (dev)
   *   3. EYEWIRE_II_CAVE_CONFIG.caveServerOverride (last resort)
   */
  function getCaveServerUrl(): string {
    if (!viewer) return EYEWIRE_II_CAVE_CONFIG.caveServerOverride;

    // 1. Try to extract from a middleauth-wrapped datasource URL
    for (const ml of viewer.layerManager.managedLayers) {
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('middleauth')) {
        const clean = url.replace('graphene://middleauth+', '');
        try {
          const u = new URL(clean);
          return `${u.protocol}//${u.host}${u.pathname.split('/segmentation')[0]}`;
        } catch { /* ignore */ }
      }
    }

    // 2. Fall back to per-dataset config
    for (const ml of viewer.layerManager.managedLayers) {
      const layerName = ml.name ?? '';
      const fromConfig = EYEWIRE_II_CAVE_CONFIG.caveServerByDataset?.[layerName];
      if (fromConfig) return fromConfig;
    }

    // 3. Global override
    return EYEWIRE_II_CAVE_CONFIG.caveServerOverride;
  }

  return {initializeWithViewer, activeLayers, selectLayers, getCaveServerUrl};
});

// ─── User Stats Store ────────────────────────────────────────────────────────
// Populated by the external user-profile repo via setStats().
// Call `useUserStatsStore().setStats({...})` from the profile integration to
// wire in live edit counts and cells-submitted totals.

export interface UserStats {
  editsToday: number;
  mergesToday: number;
  splitsToday: number;
  editsThisWeek: number;
  mergesThisWeek: number;
  splitsThisWeek: number;
  editsAllTime: number;
  mergesAllTime: number;
  splitsAllTime: number;
  cellsSubmitted: number;
  // Monthly stats
  editsThisMonth: number;
  mergesThisMonth: number;
  splitsThisMonth: number;
  // Streak — consecutive calendar days with ≥1 edit (merge OR split counts)
  currentStreak: number;
  longestStreak: number;
  lastEditDate: string;       // ISO date string e.g. "2026-03-01"
  // Community totals — dataset-wide aggregate from CAVE ChunkedGraph
  communityEditsThisWeek: number;
  communityEditsThisMonth: number;
}

export const useUserStatsStore = defineStore('userStats', () => {
  const stats: Ref<UserStats> = ref({
    editsToday: 0,
    mergesToday: 0,
    splitsToday: 0,
    editsThisWeek: 0,
    mergesThisWeek: 0,
    splitsThisWeek: 0,
    editsAllTime: 0,
    mergesAllTime: 0,
    splitsAllTime: 0,
    cellsSubmitted: 0,
    editsThisMonth: 0,
    mergesThisMonth: 0,
    splitsThisMonth: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastEditDate: '',
    communityEditsThisWeek: 0,
    communityEditsThisMonth: 0,
  });

  function setStats(partial: Partial<UserStats>) {
    Object.assign(stats.value, partial);
  }

  return {stats, setStats};
});

// ─── User Preferences Store ───────────────────────────────────────────────────
// Persists flag emoji + bio to localStorage so they survive page reloads.

const PREFS_KEY = 'nge_prefs_v1';

export interface UserPreferences {
  flag: string;   // flag emoji e.g. "🇺🇸"
  bio: string;    // free-text, capped at 280 chars in the UI
}

export const useUserPreferencesStore = defineStore('userPrefs', () => {
  const prefs: Ref<UserPreferences> = ref({ flag: '', bio: '' });

  function load() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) Object.assign(prefs.value, JSON.parse(raw));
    } catch { /* ignore parse errors */ }
  }

  function save(partial: Partial<UserPreferences>) {
    Object.assign(prefs.value, partial);
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value));
  }

  load(); // hydrate from localStorage on store init
  return { prefs, save };
});

// ─── Segment Annotation Store ─────────────────────────────────────────────────
// Tracks the currently-selected segment ID and its CAVE annotation status.
// Populated by main.ts (DOM observer) when a segment list entry appears.

export interface SegmentAnnotation {
  segId: string;
  isComplete: boolean;
  cellType: string;
  annotationId?: number;
  cellTypeAnnotationId?: number;
  loading: boolean;
  error: string;
}

export const useSegmentAnnotationStore = defineStore('segAnnotation', () => {
  const activeSegId  = ref<string | null>(null);
  const caveUrl      = ref<string>('');
  const annotation   = ref<SegmentAnnotation | null>(null);

  function setActiveSegId(id: string | null, cave?: string) {
    activeSegId.value = id;
    if (cave !== undefined) caveUrl.value = cave;
    if (id === null) { annotation.value = null; return; }
    // Reset to loading state so the panel shows a spinner
    annotation.value = {
      segId: id, isComplete: false, cellType: '',
      loading: true, error: '',
    };
  }

  function setAnnotation(a: SegmentAnnotation | null) {
    annotation.value = a;
  }

  return { activeSegId, caveUrl, annotation, setActiveSegId, setAnnotation };
});

// ─── Cell History Store ──────────────────────────────────────────────────────
// Tracks every cell the user has completed, ID'd, or interacted with.
// Persists to localStorage so it survives page reloads.

const CELL_HISTORY_KEY = 'nge_cell_history_v1';

export interface CellHistoryEntry {
  segId: string;
  isComplete: boolean;
  cellType: string;
  /** Viewer position at time of annotation — used for jump-to-cell. */
  position: [number, number, number];
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** User-assigned nickname (displayed instead of segId when set). */
  nickname?: string;
  /** Favorite flag — favorite cells appear at the top of the list. */
  isFavorite?: boolean;
}

export const useCellHistoryStore = defineStore('cellHistory', () => {
  const cells = ref<CellHistoryEntry[]>([]);

  function load() {
    try {
      const raw = localStorage.getItem(CELL_HISTORY_KEY);
      if (raw) cells.value = JSON.parse(raw);
    } catch { /* ignore parse errors */ }
  }

  function persist() {
    localStorage.setItem(CELL_HISTORY_KEY, JSON.stringify(cells.value));
  }

  /** Add or update a cell entry. */
  function upsert(entry: Partial<CellHistoryEntry> & { segId: string }) {
    const idx = cells.value.findIndex(c => c.segId === entry.segId);
    const now = new Date().toISOString();
    if (idx >= 0) {
      // Merge fields — don't overwrite existing data with empty values
      const existing = cells.value[idx];
      cells.value[idx] = {
        ...existing,
        ...entry,
        cellType: entry.cellType || existing.cellType,
        position: entry.position || existing.position,
        updatedAt: now,
      };
    } else {
      cells.value.unshift({
        segId: entry.segId,
        isComplete: entry.isComplete ?? false,
        cellType: entry.cellType ?? '',
        position: entry.position ?? [0, 0, 0],
        updatedAt: now,
        nickname: entry.nickname,
        isFavorite: entry.isFavorite,
      });
    }
    // Sort: favorites first, then by most recent
    cells.value.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    persist();
  }

  /** Toggle favorite status for a cell. */
  function toggleFavorite(segId: string) {
    const cell = cells.value.find(c => c.segId === segId);
    if (cell) {
      cell.isFavorite = !cell.isFavorite;
      // Re-sort
      cells.value.sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      persist();
    }
  }

  /** Set a nickname for a cell. */
  function setNickname(segId: string, name: string) {
    const cell = cells.value.find(c => c.segId === segId);
    if (cell) {
      cell.nickname = name.trim() || undefined;
      persist();
    }
  }

  /** Lookup a nickname by segment ID (used globally to replace segID display). */
  function getNickname(segId: string): string | undefined {
    const cell = cells.value.find(c => c.segId === segId);
    return cell?.nickname;
  }

  /** Navigate the viewer to a cell and select it.
   *  If `positionOverride` is given, jump there instead of the cell history position. */
  function jumpToCell(segId: string, positionOverride?: [number, number, number]) {
    const entry = cells.value.find(c => c.segId === segId);
    const viewer: any = (window as any)['viewer'];
    if (!viewer) return;

    // Use override position (e.g. from help request) or fall back to cell history
    const pos = positionOverride ?? entry?.position;
    if (pos && (pos[0] || pos[1] || pos[2])) {
      try {
        viewer.navigationState.position.value = Float32Array.from(pos);
      } catch (e) {
        console.warn('[cellHistory] Could not set position:', e);
      }
    }

    // Select the segment in the first segmentation layer
    try {
      const segLayer = viewer.layerManager.managedLayers.find(
        (x: any) => x.layer?.constructor?.name?.includes('Segmentation'),
      );
      if (segLayer?.layer) {
        const groupState = segLayer.layer.displayState?.segmentationGroupState?.value;
        if (groupState) {
          // Parse the segment ID as a Uint64
          const Uint64 = groupState.visibleSegments.hashTable?.emptyValue?.constructor;
          if (Uint64) {
            const seg = Uint64.parseString(segId);
            if (!groupState.visibleSegments.has(seg)) {
              groupState.visibleSegments.add(seg);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[cellHistory] Could not select segment:', e);
    }
  }

  load(); // hydrate on store init

  // Seed with demo data if empty (real minnie65 segIDs)
  if (cells.value.length === 0) {
    const now = Date.now();
    const SEED: Array<Partial<CellHistoryEntry> & { segId: string }> = [
      { segId: '864691135445639570', isComplete: true, cellType: 'L2/3 Pyramidal',
        position: [120320, 103936, 21360], isFavorite: true },
      { segId: '864691135158265390', isComplete: true, cellType: 'L2/3 Pyramidal',
        position: [119040, 104448, 21280] },
      { segId: '864691135697404831', isComplete: false, cellType: 'L2/3 Pyramidal',
        position: [121600, 102912, 21440] },
      { segId: '864691136239802390', isComplete: true, cellType: 'L4 Spiny Stellate',
        position: [118784, 105984, 21200] },
      { segId: '864691135213953920', isComplete: false, cellType: 'L5 Thick-Tufted',
        position: [120064, 106496, 21120] },
      { segId: '864691135158296972', isComplete: true, cellType: 'L5 Slender-Tufted',
        position: [119808, 103168, 21520] },
      { segId: '864691134884741468', isComplete: false, cellType: '',
        position: [121856, 105472, 21040] },
      { segId: '864691135697405836', isComplete: true, cellType: 'PV+ Basket Cell',
        position: [118528, 104960, 21360], isFavorite: true },
      { segId: '864691135158267390', isComplete: false, cellType: 'SST+ Martinotti',
        position: [120576, 102400, 21600] },
      { segId: '864691136239803118', isComplete: true, cellType: 'VIP+ Bipolar',
        position: [119296, 105216, 21480] },
      { segId: '864691135158265120', isComplete: false, cellType: '',
        position: [121344, 104192, 21240] },
    ];
    SEED.forEach((s, i) => {
      cells.value.push({
        segId: s.segId,
        isComplete: s.isComplete ?? false,
        cellType: s.cellType ?? '',
        position: s.position ?? [0, 0, 0],
        updatedAt: new Date(now - i * 3600000 * 3).toISOString(),
        nickname: s.nickname,
        isFavorite: s.isFavorite,
      });
    });
    cells.value.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    persist();
  }

  return { cells, upsert, jumpToCell, toggleFavorite, setNickname, getNickname };
});

// ── Help requests (second-opinion) ────────────────────────────────────────────
const HELP_REQUESTS_KEY = 'nge_help_requests_v1';

export interface HelpRequest {
  id: string;
  segId: string;
  position: [number, number, number];
  note: string;
  /** Issue category: extension, merge, black spill, doublecheck */
  issueType: string;
  createdAt: string;
  resolved: boolean;
  /** Cell type guess at time of request */
  cellType?: string;
  nickname?: string;
  /** Dataset/layer name this request belongs to (for cross-dataset filtering). */
  dataset?: string;
}

export const useHelpRequestStore = defineStore('helpRequests', () => {
  const requests = ref<HelpRequest[]>([]);

  function load() {
    try {
      const raw = localStorage.getItem(HELP_REQUESTS_KEY);
      if (raw) requests.value = JSON.parse(raw);
    } catch {}
  }

  function persist() {
    localStorage.setItem(HELP_REQUESTS_KEY, JSON.stringify(requests.value));
  }

  function add(req: Omit<HelpRequest, 'id' | 'createdAt' | 'resolved'>) {
    requests.value.unshift({
      ...req,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      resolved: false,
    });
    persist();
  }

  function resolve(id: string) {
    const r = requests.value.find(x => x.id === id);
    if (r) { r.resolved = true; persist(); }
  }

  function remove(id: string) {
    requests.value = requests.value.filter(x => x.id !== id);
    persist();
  }

  const pending = ref<HelpRequest[]>([]);
  // Keep a reactive computed-like ref
  function refreshPending() {
    pending.value = requests.value.filter(x => !x.resolved);
  }

  load();
  refreshPending();
  return { requests, pending, add, resolve, remove, refreshPending };
});

// ── Proofreading Queue ─────────────────────────────────────────────────────
// Loads a queue of segments to review from a published Google Sheet (CSV).
// Users cycle through items, mark them reviewed, and track session progress.

const QUEUE_SHEET_KEY    = 'nge_queue_sheet_url_v1';

/** Hash a sheet URL into a short suffix so each sheet gets its own storage keys. */
function sheetKeyHash(url: string): string {
  if (!url) return '_default';
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return '_' + Math.abs(h).toString(36);
}

export interface QueueItem {
  segId: string;
  index: string;              // e.g. "B1", "B2"
  nucCoords: string;          // nucleus coordinates "x, y, z"
  somaCoords: string;         // soma coordinates "x, y, z"
  finalSegId: string;         // final segment ID after proofreading
  finalNucId: string;         // final nucleus ID
  notes: string;
}

export const useProofreadingQueueStore = defineStore('proofreadingQueue', () => {
  const items       = ref<QueueItem[]>([]);
  const currentIdx  = ref(0);
  const proofread   = ref<Set<string>>(new Set());   // formerly "reviewed"
  const loading     = ref(false);
  const error       = ref('');
  const sheetUrl    = ref('');
  const sessionStart = Date.now();

  // Per-item local edits (soma coords, final seg id, annotation) keyed by segId
  const localEdits = ref<Record<string, { somaCoords?: string; finalSegId?: string; annotation?: string }>>(
    {});

  // Persist proofread set, sheet URL, and local edits — keyed per-sheet
  // so different datasets (pinky vs minnie65) don't clobber each other.
  function reviewedKey() { return 'nge_queue_reviewed' + sheetKeyHash(sheetUrl.value); }
  function editsKey()    { return 'nge_queue_edits' + sheetKeyHash(sheetUrl.value); }

  function loadLocal() {
    try {
      const url = localStorage.getItem(QUEUE_SHEET_KEY);
      if (url) sheetUrl.value = url;
    } catch {}
    try {
      const raw = localStorage.getItem(reviewedKey());
      if (raw) proofread.value = new Set(JSON.parse(raw));
    } catch {}
    try {
      const edits = localStorage.getItem(editsKey());
      if (edits) localEdits.value = JSON.parse(edits);
    } catch {}
  }

  function persistProofread() {
    localStorage.setItem(reviewedKey(), JSON.stringify([...proofread.value]));
  }

  function persistEdits() {
    localStorage.setItem(editsKey(), JSON.stringify(localEdits.value));
  }

  function persistSheetUrl() {
    localStorage.setItem(QUEUE_SHEET_KEY, sheetUrl.value);
  }

  /** Get local edits for a segment, merged with sheet data. */
  function getEdits(segId: string) {
    return localEdits.value[segId] || {};
  }

  /** Save local edit for a specific field. */
  function setEdit(segId: string, field: 'somaCoords' | 'finalSegId' | 'annotation', value: string) {
    if (!localEdits.value[segId]) localEdits.value[segId] = {};
    localEdits.value[segId][field] = value;
    persistEdits();
  }

  /** Check if item has soma coords (from sheet or local edit) — i.e. "claimed". */
  function isClaimed(item: QueueItem): boolean {
    const coords = item.somaCoords || getEdits(item.segId).somaCoords || '';
    return coords.trim().length > 0;
  }

  /** Check if item can be marked proofread (has soma + final seg id). */
  function canComplete(item: QueueItem): boolean {
    const edits = getEdits(item.segId);
    const hasSoma = (item.somaCoords || edits.somaCoords || '').trim().length > 0;
    const hasFinal = (item.finalSegId || edits.finalSegId || '').trim().length > 0;
    return hasSoma && hasFinal;
  }

  /** Parse CSV text into rows (handles quoted fields). */
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { row.push(field.trim()); field = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(field.trim()); field = '';
          if (row.some(f => f)) rows.push(row);
          row = [];
        } else { field += ch; }
      }
    }
    row.push(field.trim());
    if (row.some(f => f)) rows.push(row);
    return rows;
  }

  /**
   * Fetch and parse a published Google Sheet CSV.
   * Finds the header row dynamically (looks for "Segment ID" in any row).
   * Expected columns: Index, Nuc Coords, Soma Coords, Segment ID,
   *                   Final SegID, Final NucID, Notes
   */
  async function loadFromSheet(url?: string) {
    const sheetSource = url || sheetUrl.value;
    if (!sheetSource) { error.value = 'No sheet URL configured'; return; }

    loading.value = true;
    error.value = '';

    try {
      // Convert share URL to CSV export URL
      let csvUrl = sheetSource;
      const match = sheetSource.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) {
        // Extract gid if present (for multi-tab sheets)
        const gidMatch = sheetSource.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';
        csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
      }

      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCsv(text);
      if (rows.length < 2) { error.value = 'Sheet is empty'; loading.value = false; return; }

      // Find header row dynamically — look for a row containing "segment"
      let headerIdx = 0;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const lower = rows[i].map(c => c.toLowerCase());
        if (lower.some(c => c.includes('segment'))) { headerIdx = i; break; }
      }

      const header = rows[headerIdx].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const col = (name: string) =>
        header.findIndex(h => h.includes(name));

      const iIndex    = col('index');
      const iNuc      = col('nuccoord') >= 0 ? col('nuccoord') : col('nuc');
      const iSoma     = col('somacoord') >= 0 ? col('somacoord') : col('soma');
      const iSeg      = col('segmentid') >= 0 ? col('segmentid') : col('segment');
      const iFinal    = col('finalseg');
      const iFinalNuc = col('finalnuc');
      const iNotes    = col('note');

      if (iSeg < 0) { error.value = 'Could not find "Segment ID" column'; loading.value = false; return; }

      const parsed: QueueItem[] = [];
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const segId = (row[iSeg] || '').trim();
        if (!segId || !/^\d+$/.test(segId)) continue;

        parsed.push({
          segId,
          index:      (iIndex >= 0 ? row[iIndex] : '') || '',
          nucCoords:  cleanCoord(iNuc >= 0 ? row[iNuc] : ''),
          somaCoords: cleanCoord(iSoma >= 0 ? row[iSoma] : ''),
          finalSegId: (iFinal >= 0 ? row[iFinal] : '') || '',
          finalNucId: (iFinalNuc >= 0 ? row[iFinalNuc] : '') || '',
          notes:      (iNotes >= 0 ? row[iNotes] : '') || '',
        });
      }

      items.value = parsed;
      if (url && url !== sheetUrl.value) {
        // Switching to a different sheet — save current, then load new sheet's data
        sheetUrl.value = url;
        persistSheetUrl();
        // Load proofread/edits for the NEW sheet (keyed by URL hash)
        try {
          const raw = localStorage.getItem(reviewedKey());
          proofread.value = raw ? new Set(JSON.parse(raw)) : new Set();
        } catch { proofread.value = new Set(); }
        try {
          const edits = localStorage.getItem(editsKey());
          localEdits.value = edits ? JSON.parse(edits) : {};
        } catch { localEdits.value = {}; }
        currentIdx.value = 0;
      }
    } catch (e: any) {
      error.value = e.message || 'Failed to load sheet';
    }
    loading.value = false;
  }

  /** Clean a coordinate string — strip dashes and whitespace-only values. */
  function cleanCoord(s: string): string {
    const trimmed = s.trim();
    return (trimmed === '-' || trimmed === '') ? '' : trimmed;
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  function currentItem(): QueueItem | null {
    return items.value[currentIdx.value] ?? null;
  }

  function next() {
    if (items.value.length === 0) return;
    currentIdx.value = (currentIdx.value + 1) % items.value.length;
    navigateToCurrentItem();
  }

  function prev() {
    if (items.value.length === 0) return;
    currentIdx.value = (currentIdx.value - 1 + items.value.length) % items.value.length;
    navigateToCurrentItem();
  }

  function jumpToIndex(idx: number) {
    if (idx >= 0 && idx < items.value.length) {
      currentIdx.value = idx;
      navigateToCurrentItem();
    }
  }

  function nextUnproofread() {
    if (items.value.length === 0) return;
    for (let i = 1; i <= items.value.length; i++) {
      const idx = (currentIdx.value + i) % items.value.length;
      if (!proofread.value.has(items.value[idx].segId)) {
        currentIdx.value = idx;
        navigateToCurrentItem();
        return;
      }
    }
  }

  function navigateToCurrentItem() {
    const item = currentItem();
    if (!item) return;
    const edits = getEdits(item.segId);
    // Prefer local edits soma, then sheet soma, then nuc coords
    const coordStr = edits.somaCoords || item.somaCoords || item.nucCoords || '';
    const pos = parseCoordString(coordStr);
    const historyStore = useCellHistoryStore();
    // Always jump to segment (selects it), position is optional
    historyStore.jumpToCell(item.segId, pos[0] || pos[1] || pos[2] ? pos : undefined);
  }

  /** Parse "x, y, z" coordinate string into a tuple. */
  function parseCoordString(s: string): [number, number, number] {
    if (!s) return [0, 0, 0];
    const parts = s.split(',').map(p => parseInt(p.trim(), 10) || 0);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }

  function markProofread(segId?: string) {
    const id = segId || currentItem()?.segId;
    if (id) { proofread.value.add(id); persistProofread(); }
  }

  function unmarkProofread(segId: string) {
    proofread.value.delete(segId);
    persistProofread();
  }

  function clearProofread() {
    proofread.value.clear();
    persistProofread();
  }

  // ── Google Sheets write-back ─────────────────────────────────────────

  /**
   * Write soma coordinates back to the Google Sheet for the given segment.
   * Uses Google Sheets API v4 with an API key (sheet must be publicly editable,
   * or the user must be signed into Google in this browser).
   */
  async function writeSomaCoordsToSheet(segId: string, coords: string) {
    const source = sheetUrl.value;
    if (!source) return;

    // Extract spreadsheet ID
    const idMatch = source.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) { console.warn('[quest] Cannot extract spreadsheet ID from URL'); return; }
    const spreadsheetId = idMatch[1];
    const gidMatch = source.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    // Find the row for this segId in our items array
    const item = items.value.find(i => i.segId === segId);
    if (!item) return;
    const itemIdx = items.value.indexOf(item);

    // We need to know the header row offset and soma column.
    // Re-fetch the sheet to find the exact cell reference.
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
      const res = await fetch(csvUrl);
      if (!res.ok) { console.warn('[quest] Could not fetch sheet for write-back'); return; }
      const text = await res.text();
      const rows = parseCsv(text);

      // Find header row
      let headerIdx = 0;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const lower = rows[i].map(c => c.toLowerCase());
        if (lower.some(c => c.includes('segment'))) { headerIdx = i; break; }
      }

      const header = rows[headerIdx].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const somaColIdx = header.findIndex(h => h.includes('somacoord') || h.includes('soma'));
      if (somaColIdx < 0) { console.warn('[quest] No "Soma Coords" column found'); return; }

      // Convert column index to letter (A, B, C, ... Z, AA, AB, etc.)
      const colLetter = (idx: number) => {
        let s = '';
        let n = idx;
        while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
        return s;
      };

      // The data row is: headerIdx + 1 + itemIdx (0-based data rows)
      // In the sheet, row numbers are 1-based
      const sheetRow = headerIdx + 1 + itemIdx + 1; // +1 for header, +1 for 1-based
      const cellRef = `${colLetter(somaColIdx)}${sheetRow}`;

      // Try writing via Google Sheets API v4 (requires the sheet to be editable)
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${cellRef}?valueInputOption=USER_ENTERED`;
      const writeRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          range: cellRef,
          majorDimension: 'ROWS',
          values: [[coords]],
        }),
      });

      if (writeRes.ok) {
        console.info(`[quest] ✓ Soma coords written to sheet cell ${cellRef}`);
      } else {
        const errText = await writeRes.text().catch(() => '');
        console.warn(`[quest] Sheet write failed (${writeRes.status}): ${errText}`);
        console.info('[quest] Soma coords saved locally. To enable Google Sheets write-back, share the sheet with "anyone with the link can edit" and add a Google API key.');
      }
    } catch (e) {
      console.warn('[quest] Sheet write-back error:', e);
    }
  }

  // ── Computed-like helpers ───────────────────────────────────────────────
  function proofreadCount(): number { return proofread.value.size; }
  function totalCount(): number { return items.value.length; }
  function pendingCount(): number {
    return items.value.filter(i => !proofread.value.has(i.segId)).length;
  }
  function sessionMinutes(): number {
    return Math.floor((Date.now() - sessionStart) / 60000);
  }

  loadLocal();
  // Auto-load if we have a saved sheet URL
  if (sheetUrl.value) loadFromSheet();

  return {
    items, currentIdx, proofread, loading, error, sheetUrl, localEdits,
    loadFromSheet, currentItem, next, prev, jumpToIndex, nextUnproofread,
    navigateToCurrentItem, markProofread, unmarkProofread, clearProofread,
    proofreadCount, totalCount, pendingCount, sessionMinutes,
    getEdits, setEdit, isClaimed, canComplete, writeSomaCoordsToSheet,
  };
});

export const useVolumesStore = defineStore('volumes', () => {
  const volumes: Ref<Volume[]> = ref([]);

  (async () => {
      if (!CONFIG || !CONFIG.volumes_url) return;
      const {url, credentialsProvider} = parseSpecialUrl(CONFIG.volumes_url, defaultCredentialsManager);
      const response = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);

        for (const [key, value] of Object.entries(response as any)) {
          volumes.value.push({
            name: key,
            description: (value as any).description,
            image_layers: (value as any).image_layers.map((x: any) => {
              x.type = 'image';
              x.source = x.image_source;
              return x;
            }),
            segmentation_layers: (value as any).segmentation_layers.map((x: any) => {
              x.type = 'segmentation';
              x.source = x.segmentation_source;
              return x;
            }),
          });
        }
  })();

  return {volumes};
});
