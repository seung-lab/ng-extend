import {Ref, ref, reactive, computed} from 'vue';
import {defineStore} from 'pinia';

import {Viewer} from 'neuroglancer/viewer';
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {MiddleAuthCredentialsProvider} from 'neuroglancer/datasource/middleauth/credentials_provider';
import {cancellableFetchSpecialOk, parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import {responseJson} from 'neuroglancer/util/http_request';

import {Config, EYEWIRE_II_CAVE_CONFIG, getDatasetCaveConfig} from './config';
import {supabase} from './supabase';
import {getRootsFromSupervoxels} from './widgets/pcg_service';
import {SegmentationUserLayer} from "neuroglancer/segmentation_user_layer";
import {parsePositionString} from "neuroglancer/ui/default_clipboard_handling";
import {Uint64} from "neuroglancer/util/uint64";

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
  id: number,
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
          const { id, name, email } = message;
          newSessions.push({
            id,
            key,
            name,
            email,
            hostname,
          });
        } else {
          newSessions.push({
            id: 0,
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
    let localEditAccum = 0;
    let pendingNetDiff = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingRemoved = new Set<string>(); // specific segments removed during this operation
    const pendingAdded   = new Set<string>(); // specific segments added during this operation
    const EDIT_DEBOUNCE_MS = 3000; // 3s to allow failed merges to revert before counting
    /** Which graphene tool was engaged when this operation's changes arrived. */
    let pendingTool: 'multicut' | 'merge' | null = null;

    /**
     * The graphene tool currently engaged, or null if none.
     *
     * `visibleSegments` changes for many innocent reasons — jumping to a cell,
     * clicking a row in the segment list, loading a `#segId` from chat, or
     * applying a dataset's default segments. Previously every one of those was
     * counted as a merge/split, which inflated users' edit totals, streaks,
     * badges and leaderboard rank, and wrote bogus rows to `edit_log`.
     * A real graph edit only ever happens through the multicut/merge tools, so
     * require one to be engaged before counting anything.
     *
     * `closingTool` covers the success-hold window: the new root IDs land while
     * the bar is still showing the result and the tool has begun closing.
     */
    function engagedTool(): 'multicut' | 'merge' | null {
      try {
        const smo = useSplitMergeOverlayStore();
        return smo.toolActive ?? smo.closingTool ?? null;
      } catch { return null; }
    }

    // Signal fires (segId, wasAdded) — track the specific segments involved
    const handler = (changedId?: any, wasAdded?: boolean) => {
      const newCount = visibleSegs.size;

      // Gate before accumulating so selection-only changes never count.
      const tool = engagedTool();
      if (!tool) {
        // Still re-baseline, or the next real edit would measure its delta
        // against a stale count and be mis-sized.
        prevCount = newCount;
        return;
      }
      pendingTool = tool;

      // Capture the specific segment IDs from the signal
      try {
        if (changedId != null) {
          const ids = Array.isArray(changedId) ? changedId : [changedId];
          for (const id of ids) {
            const str = id.toString();
            if (wasAdded) pendingAdded.add(str);
            else pendingRemoved.add(str);
          }
        }
      } catch { /* Uint64 toString may fail */ }

      if (newCount === prevCount) return;

      // Accumulate net segment change (merge = negative, split = positive)
      pendingNetDiff += (newCount - prevCount);
      prevCount = newCount;

      // Debounce: group rapid segment changes from a single merge/split
      // into one edit event (visibleSegments.changed fires multiple times
      // as root IDs update during a single graph operation)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const net = pendingNetDiff;
        const tool = pendingTool;
        pendingNetDiff = 0;
        pendingTool = null;
        // Grab & clear the tracked segment IDs for this operation
        const removedIds = pendingRemoved.size ? [...pendingRemoved].join(',') : null;
        const addedIds   = pendingAdded.size   ? [...pendingAdded].join(',')   : null;
        pendingRemoved.clear();
        pendingAdded.clear();
        if (net === 0) return; // changes cancelled out
        if (!tool) return;     // not a graphene edit — nothing to count

        // The tool decides what happened; the direction must agree with it.
        // A merge collapses segments (net < 0), a split produces one more
        // (net > 0). This drops the residual case of selecting an extra
        // segment while a tool happens to be open.
        const operation: 'merge' | 'split' = tool === 'merge' ? 'merge' : 'split';
        if (operation === 'merge' && net >= 0) return;
        if (operation === 'split' && net <= 0) return;

        const statsStore = useUserStatsStore();
        // Count as exactly 1 operation per debounce window
        if (operation === 'merge') {
          statsStore.setStats({
            editsAllTime:   statsStore.stats.editsAllTime   + 1,
            mergesAllTime:  statsStore.stats.mergesAllTime  + 1,
            editsThisWeek:  statsStore.stats.editsThisWeek  + 1,
            mergesThisWeek: statsStore.stats.mergesThisWeek + 1,
            editsThisMonth: statsStore.stats.editsThisMonth + 1,
            mergesThisMonth:statsStore.stats.mergesThisMonth+ 1,
            editsToday:     statsStore.stats.editsToday     + 1,
            mergesToday:    statsStore.stats.mergesToday     + 1,
          });
        } else {
          statsStore.setStats({
            editsAllTime:   statsStore.stats.editsAllTime   + 1,
            splitsAllTime:  statsStore.stats.splitsAllTime  + 1,
            editsThisWeek:  statsStore.stats.editsThisWeek  + 1,
            splitsThisWeek: statsStore.stats.splitsThisWeek + 1,
            editsThisMonth: statsStore.stats.editsThisMonth + 1,
            splitsThisMonth:statsStore.stats.splitsThisMonth+ 1,
            editsToday:     statsStore.stats.editsToday     + 1,
            splitsToday:    statsStore.stats.splitsToday    + 1,
          });
        }

        statsStore.logDailyEdit(operation);
        statsStore.signalEdit(operation);
        localEditAccum += 1;
        if (localEditAccum >= 5) {
          statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
          localEditAccum = 0;
        }

        // Log to Supabase with diff=1 (one operation per debounce)
        try {
          const backendStore = useProofreadingBackendStore();
          if (backendStore.userId) {
            const viewer: any = (window as any)['viewer'];
            const pos = viewer?.navigationState?.position?.value;
            const coords = pos ? `${pos[0]}, ${pos[1]}, ${pos[2]}` : null;
            backendStore.logEdit({
              operation,
              segment_before: removedIds,
              segment_after: addedIds,
              coordinates: coords,
              metadata: { net_segment_change: net, diff: 1 },
            });
            backendStore.postActivity(`${operation === 'merge' ? 'merged' : 'split'} segment`);
          }
        } catch { /* backend logging is non-critical */ }
      }, EDIT_DEBOUNCE_MS);
    };

    visibleSegs.changed.add(handler);
    segEditCleanup = () => {
      visibleSegs.changed.remove(handler);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }

  function initializeWithViewer(v: Viewer) {
    console.log("initializeWithViewer");
    viewer = v;

    // set default values in settings
    viewer.chunkQueueManager.capacities.gpuMemory.sizeLimit.value = 2e9;
    viewer.chunkQueueManager.capacities.systemMemory.sizeLimit.value = 3e9;
    viewer.layout.restoreState('xy-3d');

    viewer.layerManager.layersChanged.add(refreshLayers);
    refreshLayers();
  }

  function parseHexColor(hex: string): {r: number, g: number, b: number} | null {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }

  // Skip the curated state-URL load for pinky_sandbox while a tutorial is active —
  // Tutorial 1 uses pinky_sandbox and drives its own state via per-step `state:` fields.
  // Lengths below are tracked manually; bump if a tutorial grows past these.
  function isUserInActiveTutorial(): boolean {
    try {
      const active = parseInt(localStorage.getItem('nge-active-tutorial') ?? '1');
      const stepKey = active === 2 ? 'nge-tutorial-2-step'
                    : active === 3 ? 'nge-tutorial-3-step'
                    : 'nge-tutorial-step';
      // store-pyr defaults: T1 step starts at 0 (in-progress), T2/T3 at -1 (not started).
      const defaultStep = active === 1 ? '0' : '-1';
      const step = parseInt(localStorage.getItem(stepKey) ?? defaultStep);
      // Tutorial step counts as of 2026-04: T1=18, T2=24, T3=TBD.
      const tutorialLengths: Record<number, number> = { 1: 18, 2: 24, 3: 30 };
      const length = tutorialLengths[active] ?? 30;
      return step >= 0 && step < length;
    } catch { return false; }
  }

  async function selectLayers(layers: any[]) {
    if (!viewer) return;

    // Detect the target dataset (by segmentation layer name) BEFORE restoring,
    // so we can short-circuit to a curated state URL if one is configured.
    const targetSegName = (() => {
      for (const l of layers as any[]) {
        if (l && l.type === 'segmentation' && typeof l.name === 'string') return l.name;
      }
      return '';
    })();
    const dsCfgEarly = targetSegName ? getDatasetCaveConfig(targetSegName) : undefined;
    const skipStateUrl = dsCfgEarly?.skipStateUrlIfTutorialActive && isUserInActiveTutorial();
    if (dsCfgEarly?.defaultStateUrl && !skipStateUrl) {
      // Apply via hash-only navigation when same-origin (so dev server doesn't bounce
      // to production). Neuroglancer's hashchange handler picks up the new state URL
      // and fetches+applies it. If the configured URL is on a different origin, the
      // hash-only swap still works because the hash itself contains the full state URL.
      const hashIdx = dsCfgEarly.defaultStateUrl.indexOf('#');
      const hashPart = hashIdx >= 0 ? dsCfgEarly.defaultStateUrl.slice(hashIdx) : '';
      console.info(`[layers] Loading curated view for ${targetSegName} → ${dsCfgEarly.defaultStateUrl}`);
      if (hashPart) {
        window.location.hash = hashPart;
        // Force a reload so all layers/state are re-initialized cleanly from the saved URL.
        window.location.reload();
      } else {
        window.location.assign(dsCfgEarly.defaultStateUrl);
      }
      return;
    }

    viewer.layerSpecification.restoreState(layers);
    viewer.navigationState.reset();

    const segmentationLayer = viewer.layerManager.managedLayers.filter(
        (x) => x.layer instanceof SegmentationUserLayer
    )[0];
    if (segmentationLayer) {
      const segmentationLayerName = segmentationLayer.name;
      const SETTINGS = DEFAULT_SETTINGS[segmentationLayerName]
      const dsCfg = getDatasetCaveConfig(segmentationLayerName);
      viewer!.coordinateSpace.restoreState({
        x: [SETTINGS.dimensions[0], "m"],
        y: [SETTINGS.dimensions[1], "m"],
        z: [SETTINGS.dimensions[2], "m"],
      });

      // Prefer dataset-config defaultPosition when set; fall back to DEFAULT_SETTINGS.position.
      // SETTINGS.position is an array of numbers in the JSON config; parsePositionString
      // is only used as a last-resort string parser for unexpected shapes.
      let position: Float32Array | undefined;
      if (dsCfg.defaultPosition) {
        position = Float32Array.from(dsCfg.defaultPosition);
      } else if (Array.isArray(SETTINGS.position)) {
        position = Float32Array.from(SETTINGS.position);
      } else if (typeof SETTINGS.position === 'string') {
        position = parsePositionString(SETTINGS.position, 3);
      }
      if (position !== undefined) {
        viewer!.navigationState.position.value = position;
      }
      viewer!.crossSectionScale.value = SETTINGS.crossSectionScale;
      viewer!.projectionScale.value = SETTINGS.projectionScale;
      viewer!.projectionOrientation.restoreState(SETTINGS.projectionOrientation);

      // Add default segments + apply per-segment colors so the user lands on a visible cell.
      // Re-applied in a setTimeout below because layer mount fires async callbacks that
      // can clear the visible set + recenter the camera right after we set them.
      const applyDefaults = () => {
        if (position !== undefined) {
          viewer!.navigationState.position.value = position;
        }
        if (!dsCfg.defaultSegments?.length) return;
        try {
          const segLayer = segmentationLayer.layer as SegmentationUserLayer;
          const groupState = segLayer.displayState.segmentationGroupState.value;
          const colorGroupState = segLayer.displayState.segmentationColorGroupState.value;
          for (const idStr of dsCfg.defaultSegments) {
            const segId = Uint64.parseString(idStr);
            if (!groupState.visibleSegments.has(segId)) {
              groupState.visibleSegments.add(segId);
            }
            const colorHex = dsCfg.segmentColors?.[idStr];
            const rgb = colorHex ? parseHexColor(colorHex) : null;
            if (rgb) {
              // neuroglancer packs as 0xBBGGRR.
              const packed = rgb.r | (rgb.g << 8) | (rgb.b << 16);
              colorGroupState.segmentStatedColors.set(segId, new Uint64(packed, 0));
            }
          }
          console.info(`[layers] Applied ${dsCfg.defaultSegments.length} default segment(s) for ${segmentationLayerName}`);
        } catch (e) {
          console.warn('[layers] Failed to apply default segments:', e);
        }
      };
      applyDefaults();
      // Re-apply once the layer's async mount has settled.
      setTimeout(applyDefaults, 200);
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

    // 1. Extract host from the graphene segmentation layer's URL.
    // Only match graphene:// — the EM image layer also uses middleauth+
    // (with precomputed:// prefix) and matching that returns a malformed URL
    // that lightbulb_service tries to fetch and chokes on.
    for (const ml of viewer.layerManager.managedLayers) {
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.startsWith('graphene://middleauth+')) {
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

  async function loadState(url: string) {
    if (!viewer) return;
    try {
      const {url: fetchUrl, credentialsProvider} = parseSpecialUrl(url, defaultCredentialsManager);
      const response = await cancellableFetchSpecialOk(credentialsProvider, fetchUrl, {}, responseJson);
      // Set layout first to avoid localPositionValid crashes during layout transitions
      if (response.layout) {
        const layoutName = typeof response.layout === 'string'
          ? response.layout
          : response.layout.type;
        if (layoutName) {
          try {
            viewer!.layout.container.setSpecification(layoutName);
          } catch (e) {
            console.warn('loadState: setSpecification error (non-fatal):', e);
          }
          await new Promise(r => requestAnimationFrame(r));
        }
      }
      viewer!.state.restoreState(response);
    } catch (e) {
      console.error('loadState failed:', e);
    }
  }

  return {initializeWithViewer, activeLayers, selectLayers, getCaveServerUrl, loadState};
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
  // Streak — consecutive calendar days with ≥1 activity (edits or cell completions)
  currentStreak: number;
  longestStreak: number;
  lastEditDate: string;       // ISO date string e.g. "2026-03-01"
  // Community totals — dataset-wide aggregate from CAVE ChunkedGraph
  communityEditsThisWeek: number;
  communityEditsThisMonth: number;
}

const STATS_KEY = 'nge_stats_v1';
const DAILY_LOG_KEY = 'nge_daily_log_v1';

export interface DailyLogEntry {
  date: string;          // ISO date "2026-03-04"
  edits: number;
  merges: number;
  splits: number;
  cellsCompleted: number;
  questsCompleted: number;
}

export const useUserStatsStore = defineStore('userStats', () => {
  // Hydrate from localStorage so stats survive page refresh
  const saved = (() => {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

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
    ...saved,
  });

  function persist() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats.value)); } catch {}
  }

  function setStats(partial: Partial<UserStats>) {
    Object.assign(stats.value, partial);
    // Guard: allTime must never be less than today/week/month
    const s = stats.value;
    s.editsAllTime   = Math.max(s.editsAllTime,   s.editsToday,  s.editsThisWeek,  s.editsThisMonth);
    s.mergesAllTime  = Math.max(s.mergesAllTime,  s.mergesToday, s.mergesThisWeek, s.mergesThisMonth);
    s.splitsAllTime  = Math.max(s.splitsAllTime,  s.splitsToday, s.splitsThisWeek, s.splitsThisMonth);
    s.editsThisWeek  = Math.max(s.editsThisWeek,  s.editsToday);
    s.editsThisMonth = Math.max(s.editsThisMonth, s.editsThisWeek);
    s.mergesThisWeek = Math.max(s.mergesThisWeek, s.mergesToday);
    s.mergesThisMonth= Math.max(s.mergesThisMonth,s.mergesThisWeek);
    s.splitsThisWeek = Math.max(s.splitsThisWeek, s.splitsToday);
    s.splitsThisMonth= Math.max(s.splitsThisMonth,s.splitsThisWeek);
    persist();
  }

  // ── Daily activity log (last 30 days) ───────────────────────────
  const dailyLog = ref<DailyLogEntry[]>([]);

  function loadDailyLog() {
    try {
      const raw = localStorage.getItem(DAILY_LOG_KEY);
      if (raw) dailyLog.value = JSON.parse(raw);
    } catch {}
  }

  function persistDailyLog() {
    try {
      // Keep only last 30 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      dailyLog.value = dailyLog.value.filter(d => d.date >= cutoffStr);
      localStorage.setItem(DAILY_LOG_KEY, JSON.stringify(dailyLog.value));
    } catch {}
  }

  function getTodayLog(): DailyLogEntry {
    const today = new Date().toISOString().slice(0, 10);
    let entry = dailyLog.value.find(d => d.date === today);
    if (!entry) {
      entry = { date: today, edits: 0, merges: 0, splits: 0, cellsCompleted: 0, questsCompleted: 0 };
      dailyLog.value.push(entry);
    }
    return entry;
  }

  function logDailyEdit(type: 'merge' | 'split') {
    const entry = getTodayLog();
    entry.edits++;
    if (type === 'merge') entry.merges++;
    else entry.splits++;
    persistDailyLog();
  }

  function logDailyCellComplete() {
    const entry = getTodayLog();
    entry.cellsCompleted++;
    persistDailyLog();
  }

  function logDailyQuestComplete() {
    const entry = getTodayLog();
    entry.questsCompleted++;
    persistDailyLog();
  }

  loadDailyLog();

  /** Recalculate today/week/month stats from dailyLog to prevent stale accumulation. */
  function recalcFromDailyLog() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // Start of current week (Monday) — matches the Mon–Sun range shown in WeeklyRecapPanel
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayUTC = todayUTC.getUTCDay(); // 0 = Sun, 1 = Mon, …
    const diffToMon = dayUTC === 0 ? -6 : 1 - dayUTC;
    const monday = new Date(todayUTC);
    monday.setUTCDate(todayUTC.getUTCDate() + diffToMon);
    const weekStart = monday.toISOString().slice(0, 10);

    // First day of the current calendar month — matches the "April 2026" label
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString().slice(0, 10);

    let editsToday = 0, mergesToday = 0, splitsToday = 0;
    let editsWeek = 0, mergesWeek = 0, splitsWeek = 0;
    let editsMonth = 0, mergesMonth = 0, splitsMonth = 0;

    for (const entry of dailyLog.value) {
      if (entry.date === today) {
        editsToday += entry.edits;
        mergesToday += entry.merges;
        splitsToday += entry.splits;
      }
      if (entry.date >= weekStart) {
        editsWeek += entry.edits;
        mergesWeek += entry.merges;
        splitsWeek += entry.splits;
      }
      if (entry.date >= monthStart) {
        editsMonth += entry.edits;
        mergesMonth += entry.merges;
        splitsMonth += entry.splits;
      }
    }

    // Only update today/week/month — preserve allTime from Supabase
    const s = stats.value;
    s.editsToday = editsToday;
    s.mergesToday = mergesToday;
    s.splitsToday = splitsToday;
    s.editsThisWeek = editsWeek;
    s.mergesThisWeek = mergesWeek;
    s.splitsThisWeek = splitsWeek;
    s.editsThisMonth = editsMonth;
    s.mergesThisMonth = mergesMonth;
    s.splitsThisMonth = splitsMonth;
    persist();
  }

  recalcFromDailyLog();

  // ── Edit event signal for UI celebrations ───────────────────────
  /** Brief reactive signal: set on merge/split, auto-clears after 2.5s. */
  const recentEditEvent = ref<{type: 'merge' | 'split'; ts: number} | null>(null);
  let editEventTimer: ReturnType<typeof setTimeout> | null = null;

  function signalEdit(type: 'merge' | 'split') {
    recentEditEvent.value = {type, ts: Date.now()};
    if (editEventTimer) clearTimeout(editEventTimer);
    editEventTimer = setTimeout(() => { recentEditEvent.value = null; }, 2500);
  }

  return {stats, setStats, dailyLog, logDailyEdit, logDailyCellComplete, logDailyQuestComplete, recentEditEvent, signalEdit};
});

// ─── User Preferences Store ───────────────────────────────────────────────────
// Persists flag emoji + bio to localStorage so they survive page reloads.

const PREFS_KEY = 'nge_prefs_v1';

export interface UserPreferences {
  flag: string;   // flag emoji e.g. "🇺🇸"
  bio: string;    // free-text, capped at 280 chars in the UI
  /** Which toolbar icons to show, in order. Empty = show all defaults. */
  toolbarIcons: string[];
  /** Mute chat: skip the green unread pip on the toolbar. Defaults
   *  to false (notifications on) when the key isn't set yet. */
  chatMuted?: boolean;
  /** Mute help requests: hide the pending count on the Second Opinion toolbar
   *  icon. Defaults to false (badge shown) when the key isn't set yet. */
  helpMuted?: boolean;
}

export const useUserPreferencesStore = defineStore('userPrefs', () => {
  const prefs: Ref<UserPreferences> = ref({ flag: '', bio: '', toolbarIcons: [], chatMuted: false, helpMuted: false });

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
  /** Classification system (e.g. 'RGC', 'AC') from cell_type_local schema. */
  classificationSystem?: string;
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
  segId: string;  // cached/display root ID (may be stale after edits)
  isComplete: boolean;
  cellType: string;
  /** Spatial anchor — the point-in-space claim coordinate. Primary key for matching. */
  claimPoint?: ClaimPoint;
  /** Viewer position at time of annotation — used for jump-to-cell. */
  position: [number, number, number];
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** User-assigned nickname (displayed instead of segId when set). */
  nickname?: string;
  /** Favorite flag — favorite cells appear at the top of the list. */
  isFavorite?: boolean;
  /** Dataset/layer name this cell belongs to (for filtering). */
  dataset?: string;
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

  /** Add or update a cell entry. Matches by claimPoint first, then segId. */
  function upsert(entry: Partial<CellHistoryEntry> & { segId: string }) {
    // Match by claimPoint (stable across edits) first, then by segId
    let idx = -1;
    if (entry.claimPoint) {
      idx = cells.value.findIndex(c =>
        c.claimPoint &&
        c.claimPoint[0] === entry.claimPoint![0] &&
        c.claimPoint[1] === entry.claimPoint![1] &&
        c.claimPoint[2] === entry.claimPoint![2],
      );
    }
    if (idx < 0) {
      idx = cells.value.findIndex(c => c.segId === entry.segId);
    }
    const now = new Date().toISOString();
    if (idx >= 0) {
      // Merge fields — don't overwrite existing data with empty values
      const existing = cells.value[idx];
      cells.value[idx] = {
        ...existing,
        ...entry,
        segId: entry.segId || existing.segId,  // update cached segId if provided
        cellType: entry.cellType || existing.cellType,
        position: entry.position || existing.position,
        claimPoint: entry.claimPoint || existing.claimPoint,
        dataset: entry.dataset || existing.dataset,
        updatedAt: now,
      };
    } else {
      cells.value.unshift({
        segId: entry.segId,
        isComplete: entry.isComplete ?? false,
        cellType: entry.cellType ?? '',
        claimPoint: entry.claimPoint,
        position: entry.position ?? [0, 0, 0],
        updatedAt: now,
        nickname: entry.nickname,
        isFavorite: entry.isFavorite,
        dataset: entry.dataset,
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

    // Use override position, or claimPoint (stable anchor), or fall back to cell history
    const pos = positionOverride ?? entry?.claimPoint ?? entry?.position;
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
        (x: any) => {
          const layer = x.layer;
          if (!layer) return false;
          const className = layer.constructor?.name || '';
          return className.includes('Segmentation') ||
            layer.type === 'segmentation' ||
            x.initialSpecification?.type === 'segmentation';
        },
      );
      if (!segLayer?.layer) {
        console.warn('[cellHistory] No segmentation layer found');
      } else {
        const groupState = segLayer.layer.displayState?.segmentationGroupState?.value;
        if (groupState?.visibleSegments) {
          const seg = Uint64.parseString(segId);
          if (!groupState.visibleSegments.has(seg)) {
            groupState.visibleSegments.add(seg);
          }
        } else {
          console.warn('[cellHistory] No segmentationGroupState on layer');
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

// ── Help requests (second-opinion) — backed by Supabase with realtime ────────

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
  /** Annotation layer attached to the ORIGINAL request (replies have their own). */
  annotationLayer?: string;
  /** Who created this request */
  userId?: string;
  userName?: string;
  /** Display name of the user who resolved this request */
  resolvedByName?: string;
  /** Response note from the resolver */
  responseNote?: string;
  /** Optional link (e.g. neuroglancer state URL) from the resolver */
  responseUrl?: string;
  /** Optional annotation layer name referenced by the resolver */
  responseAnnotationLayer?: string;
  /** Public URL of an attached screenshot (Firebase Storage). */
  screenshotUrl?: string;
  /** Thread of replies from the help_responses child table. Each reply keeps its
   *  OWN url / annotation layer / screenshot, so links accumulate instead of
   *  overwriting (the legacy response_* columns overwrote on every reply). */
  responses?: HelpResponse[];
}

export interface HelpResponse {
  id: string;
  userId?: string;
  userName?: string;
  note?: string;
  url?: string;
  annotationLayer?: string;
  screenshotUrl?: string;
  resolved?: boolean;
  createdAt: string;
}

function rowToHelpResponse(row: any): HelpResponse {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    note: row.note ?? undefined,
    url: row.url ?? undefined,
    annotationLayer: row.annotation_layer ?? undefined,
    screenshotUrl: row.screenshot_url ?? undefined,
    resolved: !!row.resolved,
    createdAt: row.created_at,
  };
}

/** Map Supabase row → HelpRequest interface */
function rowToHelpRequest(row: any): HelpRequest {
  return {
    id: row.id,
    segId: row.segment_id,
    position: (() => { try { return JSON.parse(row.position); } catch { return [0, 0, 0]; } })(),
    note: row.note ?? '',
    issueType: row.issue_type,
    createdAt: row.created_at,
    resolved: !!row.resolved,
    cellType: row.cell_type ?? undefined,
    nickname: row.nickname ?? undefined,
    dataset: row.dataset ?? undefined,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    resolvedByName: row.resolved_by_name ?? undefined,
    responseNote: row.response_note ?? undefined,
    responseUrl: row.response_url ?? undefined,
    responseAnnotationLayer: row.response_annotation_layer ?? undefined,
    screenshotUrl: row.screenshot_url ?? undefined,
    annotationLayer: row.annotation_layer ?? undefined,
  };
}

export const useHelpRequestStore = defineStore('helpRequests', () => {
  const requests = ref<HelpRequest[]>([]);
  const pending = ref<HelpRequest[]>([]);
  let realtimeChannel: any = null;

  function refreshPending() {
    pending.value = requests.value.filter(x => !x.resolved);
  }

  /** Load all help requests from Supabase. */
  async function load() {
    try {
      const { data, error } = await supabase
        .from('help_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        console.warn('[helpRequests] Supabase load error:', error.message);
        loadFromLocalStorage(); // fallback
        return;
      }
      const reqs = (data ?? []).map(rowToHelpRequest);
      // Attach each request's reply thread from the help_responses child table.
      // Best-effort: if the table/query fails, requests still load (legacy
      // response_* fields on the row remain as a fallback in the UI).
      try {
        const ids = reqs.map(r => r.id);
        if (ids.length) {
          const { data: resp } = await supabase
            .from('help_responses')
            .select('*')
            .in('request_id', ids)
            .order('created_at', { ascending: true });
          const byReq = new Map<string, HelpResponse[]>();
          for (const row of resp ?? []) {
            const list = byReq.get(row.request_id) ?? [];
            list.push(rowToHelpResponse(row));
            byReq.set(row.request_id, list);
          }
          for (const r of reqs) r.responses = byReq.get(r.id) ?? [];
        }
      } catch (e) {
        console.warn('[helpRequests] responses load failed:', e);
      }
      requests.value = reqs;
      refreshPending();
    } catch (e) {
      console.warn('[helpRequests] load failed, falling back to localStorage:', e);
      loadFromLocalStorage();
    }
  }

  /**
   * Add a reply to a help request as its own row in help_responses (so links /
   * screenshots accumulate). Optionally resolves the thread. Replaces the old
   * respond()/resolve() single-column writes for new replies.
   */
  async function addResponse(id: string, payload: {
    note?: string; url?: string; annotationLayer?: string;
    screenshotUrl?: string; resolve?: boolean;
  }) {
    const backend = useProofreadingBackendStore();
    const responderName = backend.chatHandle || backend.userName || backend.userEmail?.split('@')[0] || 'Anonymous';
    const row = {
      request_id: id,
      user_id: backend.userId || null,
      user_name: responderName,
      note: payload.note || null,
      url: payload.url || null,
      annotation_layer: payload.annotationLayer || null,
      screenshot_url: payload.screenshotUrl || null,
      resolved: !!payload.resolve,
    };
    const { data: inserted, error: insErr } = await supabase
      .from('help_responses').insert(row).select('*').single();
    if (insErr) { console.warn('[helpRequests] addResponse error:', insErr.message); return; }

    if (payload.resolve) {
      const { error: updErr } = await supabase.from('help_requests').update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: backend.userId || null,
        resolved_by_name: responderName,
      }).eq('id', id);
      if (updErr) console.warn('[helpRequests] resolve-on-response error:', updErr.message);
    }

    // Optimistic local update
    const r = requests.value.find(x => x.id === id);
    if (r) {
      r.responses = [...(r.responses ?? []), rowToHelpResponse(inserted)];
      if (payload.resolve) { r.resolved = true; r.resolvedByName = responderName; }
    }
    refreshPending();
  }

  /** Fallback: load from localStorage (migration period). */
  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('nge_help_requests_v1');
      if (raw) requests.value = JSON.parse(raw);
      refreshPending();
    } catch {}
  }

  /** Subscribe to realtime changes on help_requests table. */
  function subscribe() {
    if (realtimeChannel) return;
    realtimeChannel = supabase
      .channel('help_requests_realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'help_requests',
      }, (payload: any) => {
        const req = rowToHelpRequest(payload.new);
        // Avoid duplicates (we may have already added it optimistically)
        if (!requests.value.find(r => r.id === req.id)) {
          requests.value.unshift(req);
          refreshPending();
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'help_requests',
      }, (payload: any) => {
        const updated = rowToHelpRequest(payload.new);
        const idx = requests.value.findIndex(r => r.id === updated.id);
        if (idx >= 0) {
          requests.value[idx] = updated;
          refreshPending();
        }
      })
      .subscribe();
  }

  function unsubscribe() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  /** Add a new help request to Supabase. */
  async function add(req: Omit<HelpRequest, 'id' | 'createdAt' | 'resolved'>) {
    const backend = useProofreadingBackendStore();
    const row = {
      user_id: backend.userId || null,
      user_name: backend.userName || backend.userEmail?.split('@')[0] || 'Anonymous',
      segment_id: req.segId,
      position: JSON.stringify(req.position),
      note: req.note || '',
      issue_type: req.issueType,
      dataset: req.dataset || 'eyewire_ii',
      cell_type: req.cellType || null,
      nickname: req.nickname || null,
      screenshot_url: req.screenshotUrl || null,
      // Column added by supabase-help-responses-schema.sql.
      annotation_layer: req.annotationLayer || null,
    };

    const { data, error } = await supabase
      .from('help_requests')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.warn('[helpRequests] insert error:', error.message);
      // Optimistic local fallback
      requests.value.unshift({
        ...req,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: new Date().toISOString(),
        resolved: false,
      });
    } else if (data) {
      const newReq = rowToHelpRequest(data);
      if (!requests.value.find(r => r.id === newReq.id)) {
        requests.value.unshift(newReq);
      }
    }
    refreshPending();
  }

  /** Mark a help request as resolved in Supabase, optionally with a response. */
  async function resolve(id: string, response?: { note?: string; url?: string; annotationLayer?: string; appendToExisting?: boolean }) {
    const backend = useProofreadingBackendStore();
    const resolverName = backend.userName || backend.userEmail?.split('@')[0] || 'Anonymous';
    const updateData: Record<string, any> = {
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: backend.userId || null,
      resolved_by_name: resolverName,
    };
    if (response?.note) {
      if (response.appendToExisting) {
        const { data } = await supabase.from('help_requests').select('response_note').eq('id', id).single();
        const existing = data?.response_note || '';
        updateData.response_note = existing
          ? `${existing}\n---\n${resolverName}: ${response.note}`
          : response.note;
      } else {
        updateData.response_note = response.note;
      }
    }
    if (response?.url) updateData.response_url = response.url;
    if (response?.annotationLayer) updateData.response_annotation_layer = response.annotationLayer;

    const { error } = await supabase
      .from('help_requests')
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.warn('[helpRequests] resolve error:', error.message);
    }
    // Optimistic update
    const r = requests.value.find(x => x.id === id);
    if (r) {
      r.resolved = true;
      r.resolvedByName = resolverName;
      if (response?.note) r.responseNote = response.note;
      if (response?.url) r.responseUrl = response.url;
      if (response?.annotationLayer) r.responseAnnotationLayer = response.annotationLayer;
    }
    refreshPending();
  }

  /** Add a response to a help request WITHOUT resolving it. */
  async function respond(id: string, response: { note?: string; url?: string; annotationLayer?: string; appendToExisting?: boolean }) {
    const backend = useProofreadingBackendStore();
    const responderName = backend.userName || backend.userEmail?.split('@')[0] || 'Anonymous';

    // If appending to an existing thread, fetch current note from DB to avoid overwrites
    let finalNote = response.note || '';
    if (response.appendToExisting && response.note) {
      const { data } = await supabase
        .from('help_requests')
        .select('response_note')
        .eq('id', id)
        .single();
      const existing = data?.response_note || '';
      if (existing) {
        finalNote = `${existing}\n---\n${responderName}: ${response.note}`;
      }
    }

    const updateData: Record<string, any> = {};
    // Only set resolved_by_name if there's no existing response (don't overwrite original responder)
    if (!response.appendToExisting) {
      updateData.resolved_by_name = responderName;
    }
    if (finalNote) updateData.response_note = finalNote;
    if (response.url) updateData.response_url = response.url;
    if (response.annotationLayer) updateData.response_annotation_layer = response.annotationLayer;

    const { error } = await supabase
      .from('help_requests')
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.warn('[helpRequests] respond error:', error.message);
    }
    // Optimistic update
    const r = requests.value.find(x => x.id === id);
    if (r) {
      if (!response.appendToExisting) r.resolvedByName = responderName;
      if (finalNote) r.responseNote = finalNote;
      if (response.url) r.responseUrl = response.url;
      if (response.annotationLayer) r.responseAnnotationLayer = response.annotationLayer;
    }

    // Send notification to the requester
    if (r?.userId && r.userId !== backend.userId) {
      const notePreview = (response.note || '').slice(0, 120) + ((response.note || '').length > 120 ? '...' : '');
      await supabase.from('notifications').insert({
        title: `💬 Response to your help request`,
        body: `${responderName} responded on ${r.segId}: ${notePreview}`,
        target_type: 'user',
        target_id: r.userId,
        send_at: new Date().toISOString(),
        created_by: backend.userId,
      }).then(({ error: e }) => { if (e) console.warn('[helpRequests] notification error:', e.message); });
    }
  }

  /** Remove a help request (delete from Supabase). */
  async function remove(id: string) {
    const { error } = await supabase
      .from('help_requests')
      .delete()
      .eq('id', id);

    if (error) {
      console.warn('[helpRequests] delete error:', error.message);
    }
    requests.value = requests.value.filter(x => x.id !== id);
    refreshPending();
  }

  // Initialize: load from Supabase + subscribe to realtime
  load();
  subscribe();

  return { requests, pending, add, resolve, respond, addResponse, remove, refreshPending, load, subscribe, unsubscribe };
});

// ── Working Links ─────────────────────────────────────────────────────────
// Saved viewer-state URLs (snapshots). Backed by Supabase `working_links`.

export interface WorkingLink {
  id: string;
  userId: string;
  userName?: string;
  title: string;
  note: string;
  url: string;
  starred: boolean;
  dataset?: string;
  position?: [number, number, number];
  visibleSegments: string[];
  isPublic: boolean;
  sharedGroupId?: number;
  createdAt: string;
  updatedAt: string;
}

function rowToWorkingLink(row: any): WorkingLink {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? undefined,
    title: row.title ?? 'Untitled',
    note: row.note ?? '',
    url: row.url ?? '',
    starred: !!row.starred,
    dataset: row.dataset ?? undefined,
    position: (row.position_x != null && row.position_y != null && row.position_z != null)
      ? [row.position_x, row.position_y, row.position_z] : undefined,
    visibleSegments: Array.isArray(row.visible_segments) ? row.visible_segments : [],
    isPublic: !!row.is_public,
    sharedGroupId: row.shared_group_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const useWorkingLinksStore = defineStore('workingLinks', () => {
  const links = ref<WorkingLink[]>([]);
  let realtimeChannel: any = null;

  /** Load all links visible to this user (own + public + shared-to-group). */
  async function load() {
    try {
      const { data, error } = await supabase
        .from('working_links')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) {
        console.warn('[workingLinks] load error:', error.message);
        return;
      }
      links.value = (data ?? []).map(rowToWorkingLink);
    } catch (e) {
      console.warn('[workingLinks] load failed:', e);
    }
  }

  function subscribe() {
    if (realtimeChannel) return;
    realtimeChannel = supabase
      .channel('working_links_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'working_links' }, (payload: any) => {
        const link = rowToWorkingLink(payload.new);
        if (!links.value.find(l => l.id === link.id)) links.value.unshift(link);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'working_links' }, (payload: any) => {
        const updated = rowToWorkingLink(payload.new);
        const idx = links.value.findIndex(l => l.id === updated.id);
        if (idx >= 0) links.value[idx] = updated;
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'working_links' }, (payload: any) => {
        const id = payload.old?.id;
        if (id) links.value = links.value.filter(l => l.id !== id);
      })
      .subscribe();
  }

  function unsubscribe() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  /** Save a new working link. Returns the inserted row's id, or null on failure. */
  async function add(input: {
    title: string;
    note?: string;
    url: string;
    dataset?: string;
    position?: [number, number, number];
    visibleSegments?: string[];
    starred?: boolean;
    isPublic?: boolean;
    sharedGroupId?: number | null;
  }): Promise<string | null> {
    const backend = useProofreadingBackendStore();
    if (!backend.userId) {
      console.warn('[workingLinks] cannot save without login');
      return null;
    }
    const row: any = {
      user_id: backend.userId,
      title: input.title || 'Untitled',
      note: input.note ?? '',
      url: input.url,
      starred: !!input.starred,
      dataset: input.dataset ?? null,
      position_x: input.position?.[0] ?? null,
      position_y: input.position?.[1] ?? null,
      position_z: input.position?.[2] ?? null,
      visible_segments: input.visibleSegments ?? [],
      is_public: !!input.isPublic,
      shared_group_id: input.sharedGroupId ?? null,
    };
    try {
      const { data, error } = await supabase
        .from('working_links')
        .insert(row)
        .select()
        .single();
      if (error) {
        console.warn('[workingLinks] insert error:', error.message);
        return null;
      }
      const link = rowToWorkingLink(data);
      // Optimistic local insert (realtime will dedupe)
      if (!links.value.find(l => l.id === link.id)) links.value.unshift(link);
      return link.id;
    } catch (e) {
      console.warn('[workingLinks] insert failed:', e);
      return null;
    }
  }

  async function update(id: string, patch: Partial<{
    title: string;
    note: string;
    starred: boolean;
    isPublic: boolean;
    sharedGroupId: number | null;
  }>): Promise<boolean> {
    const row: any = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.note !== undefined) row.note = patch.note;
    if (patch.starred !== undefined) row.starred = patch.starred;
    if (patch.isPublic !== undefined) row.is_public = patch.isPublic;
    if (patch.sharedGroupId !== undefined) row.shared_group_id = patch.sharedGroupId;
    try {
      const { error } = await supabase.from('working_links').update(row).eq('id', id);
      if (error) {
        console.warn('[workingLinks] update error:', error.message);
        return false;
      }
      // Optimistic local update
      const idx = links.value.findIndex(l => l.id === id);
      if (idx >= 0) links.value[idx] = { ...links.value[idx], ...patch, updatedAt: row.updated_at } as WorkingLink;
      return true;
    } catch (e) {
      console.warn('[workingLinks] update failed:', e);
      return false;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('working_links').delete().eq('id', id);
      if (error) {
        console.warn('[workingLinks] delete error:', error.message);
        return false;
      }
      links.value = links.value.filter(l => l.id !== id);
      return true;
    } catch (e) {
      console.warn('[workingLinks] delete failed:', e);
      return false;
    }
  }

  async function toggleStar(id: string): Promise<boolean> {
    const link = links.value.find(l => l.id === id);
    if (!link) return false;
    return update(id, { starred: !link.starred });
  }

  // Initialize
  load();
  subscribe();

  return { links, load, subscribe, unsubscribe, add, update, remove, toggleStar };
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
  dataset: string;            // dataset the cell belongs to (tagged at load time from its sheet)
  sheetStatus?: string;       // status text from the sheet (Stroeh: 'Status' column); '' if none
  assignee?: string;          // who's on it, from the sheet (Stroeh: 'Proofreader'); '' if none
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
  async function loadFromSheet(url?: string, datasetName?: string) {
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

      // First matching column index from a list of patterns (in priority order).
      const firstCol = (...names: string[]) => {
        for (const n of names) { const i = col(n); if (i >= 0) return i; }
        return -1;
      };

      const iIndex    = col('index');
      const iNuc      = col('nuccoord') >= 0 ? col('nuccoord') : col('nuc');
      const iSoma     = firstCol('somacoord', 'somaorstem', 'soma');
      // 'startseg' (Stroeh "Start SegID") before generic — avoids matching "Final SegID".
      const iSeg      = firstCol('startseg', 'segmentid', 'segment');
      const iFinal    = col('finalseg');
      const iFinalNuc = col('finalnuc');
      const iNotes    = col('note');
      const iDataset  = col('dataset');
      const iStatus   = col('status');
      const iAssignee = firstCol('proofreader', 'claimedby', 'assignee');

      if (iSeg < 0) { error.value = 'Could not find a Segment ID column'; loading.value = false; return; }

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
          // Tag with the dataset this sheet was loaded for; fall back to a
          // 'dataset' column if the sheet has one, else empty.
          dataset:    (datasetName || (iDataset >= 0 ? (row[iDataset] || '').trim() : '')) || '',
          sheetStatus: (iStatus >= 0 ? (row[iStatus] || '').trim() : '') || '',
          assignee:    (iAssignee >= 0 ? (row[iAssignee] || '').trim() : '') || '',
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

  /** Clear all local edits (soma coords, final seg ID, annotations). */
  function clearLocalEdits() {
    localEdits.value = {};
    persistEdits();
  }

  /** Full reset: clear proofread set + local edits, jump to start. */
  function resetAll() {
    proofread.value.clear();
    localEdits.value = {};
    persistProofread();
    persistEdits();
    currentIdx.value = 0;
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
    navigateToCurrentItem, markProofread, unmarkProofread, clearProofread, clearLocalEdits, resetAll,
    proofreadCount, totalCount, pendingCount, sessionMinutes,
    getEdits, setEdit, isClaimed, canComplete, writeSomaCoordsToSheet,
  };
});

/* ───────── Split / Merge Overlay Store ───────── */

export const useSplitMergeOverlayStore = defineStore('splitMergeOverlay', () => {
  const toolActive = ref<'multicut' | 'merge' | null>(null);
  const activeGroup = ref<'red' | 'blue'>('red');
  const redPointCount = ref(0);
  const bluePointCount = ref(0);
  const mergeSubmissionCount = ref(0);
  /** Scraped merge pairs: each entry is [sinkId, sourceId] or [sinkId] if incomplete */
  const mergeSegments = ref<string[][]>([]);
  /** Whether NG's auto-submit checkbox is checked */
  const autoSubmit = ref(false);
  const submitting = ref(false);
  /** Status message scraped from neuroglancer's tool UI */
  const statusMessage = ref('');
  /** Result flash: 'success' | 'error' | '' */
  const resultFlash = ref<'success' | 'error' | ''>('');
  const resultText = ref('');
  /** When true, bar holds visible in success/error state before closing */
  const pendingClose = ref(false);
  /** Which tool was active before pendingClose (for display) */
  const closingTool = ref<'multicut' | 'merge' | null>(null);
  /** Timestamp of the last "Clear points" click. The DOM scanner uses this to
   *  distinguish a Clear (points reset to 0, no submit) from an actual split
   *  submit (points also reset to 0, but the operation is processing). */
  const clearedAt = ref(0);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Record that the user just cleared the placed points. */
  function markCleared() {
    clearedAt.value = Date.now();
    submitting.value = false;
    statusMessage.value = '';
  }

  function setToolState(tool: 'multicut' | 'merge' | null) {
    if (pendingClose.value) return; // don't interfere during close animation
    if (tool !== toolActive.value) {
      toolActive.value = tool;
      if (tool === null) {
        redPointCount.value = 0;
        bluePointCount.value = 0;
        mergeSubmissionCount.value = 0;
        mergeSegments.value = [];
        autoSubmit.value = false;
        submitting.value = false;
        statusMessage.value = '';
        resultFlash.value = '';
        resultText.value = '';
        if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
      }
    }
  }

  function setActiveGroup(group: 'red' | 'blue') {
    activeGroup.value = group;
  }

  function updatePointCounts(red: number, blue: number) {
    redPointCount.value = red;
    bluePointCount.value = blue;
  }

  function setStatusMessage(msg: string) {
    statusMessage.value = msg;
  }

  /** Show inline result on the bar (merge tool stays active after) */
  function showResult(type: 'success' | 'error', text: string, durationMs = 4000) {
    resultFlash.value = type;
    resultText.value = text;
    submitting.value = false;
    statusMessage.value = '';
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      resultFlash.value = '';
      resultText.value = '';
    }, durationMs);
  }

  /** Hold bar in success state for 2.5s, then holographic exit */
  function beginSuccessClose(text: string) {
    closingTool.value = toolActive.value;
    pendingClose.value = true;
    resultFlash.value = 'success';
    resultText.value = text;
    submitting.value = false;
    statusMessage.value = '';
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      pendingClose.value = false;
      toolActive.value = null;
      closingTool.value = null;
      resultFlash.value = '';
      resultText.value = '';
      redPointCount.value = 0;
      bluePointCount.value = 0;
      mergeSubmissionCount.value = 0;
    }, 2500);
  }

  function removeMergeSegment(index: number) {
    // Remove from neuroglancer's DOM (the source of truth)
    try {
      const mergeEl = document.querySelector('.graphene-merge-segments');
      if (mergeEl) {
        const submissions = mergeEl.querySelectorAll('.graphene-merge-segments-submission');
        const sub = submissions[index];
        if (sub) {
          // Look for a delete/close/remove button within the submission
          const deleteBtn = sub.querySelector('button[title*="delete" i], button[title*="remove" i], button[title*="cancel" i], .neuroglancer-icon[title*="delete" i]') as HTMLElement | null;
          if (deleteBtn) {
            deleteBtn.click();
          } else {
            // No button found — try removing the DOM node directly
            sub.remove();
          }
        }
      }
    } catch (e) {
      console.warn('[smo] removeMergeSegment DOM error:', e);
    }
    // Also update local state immediately for UI responsiveness
    mergeSegments.value.splice(index, 1);
    if (mergeSubmissionCount.value > 0) mergeSubmissionCount.value--;
  }

  return {
    toolActive, activeGroup, redPointCount, bluePointCount,
    mergeSubmissionCount, mergeSegments, autoSubmit, submitting, statusMessage, resultFlash, resultText,
    pendingClose, closingTool, clearedAt,
    setToolState, setActiveGroup, updatePointCounts, setStatusMessage,
    showResult, beginSuccessClose, removeMergeSegment, markCleared,
  };
});

/* ───────── Proofreading Backend Store (Supabase) ───────── */

/** Spatial coordinate anchor for point-in-space claims. */
export type ClaimPoint = [number, number, number];

export interface ProofreadingTask {
  id: number;
  segment_id: string;  // cached/resolved root ID from PCG (may be stale)
  dataset: string;
  nucleus_coords: string | null;
  soma_coords: string | null;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'skipped';
  assigned_to: string | null;
  priority: number;
  final_segment_id: string | null;
  final_nucleus_id: string | null;
  notes: string | null;
  source_sheet_url: string | null;
  created_at: string;
  updated_at: string;
  // Point-in-space claim anchor
  claim_point_x: number | null;
  claim_point_y: number | null;
  claim_point_z: number | null;
  /** Immutable supervoxel ID at claim point — used to resolve current root after edits/splits. */
  supervoxel_id: string | null;
}

export interface EditLogEntry {
  task_id?: number | null;
  user_id?: string | null;
  operation: string;
  segment_before?: string | null;
  segment_after?: string | null;
  coordinates?: string | null;
  metadata?: Record<string, any> | null;
  dataset?: string;
  success?: boolean;
}

export interface ActivityFeedItem {
  id: number;
  user_id: string | null;
  user_name: string | null;
  action: string;
  segment_id: string | null;
  timestamp: string;
}

export const useProofreadingBackendStore = defineStore('proofreadingBackend', () => {
  const userId = ref<string | null>(null);
  const userEmail = ref<string>('');
  const userName = ref<string>('');
  /**
   * Unique handle used for chat display and @mentions.
   *
   * Display names ("Amy S.") are neither unique nor single-token, so mentions
   * couldn't tell two people apart or capture a name containing a space. A
   * username is unique and space-free, making a mention unambiguous by
   * construction. Empty until the user picks one; chat falls back to the
   * display name in that case.
   */
  const username = ref<string>('');

  /** Name to show in chat and match mentions against. */
  const chatHandle = computed(() => username.value || userName.value || 'Anonymous');

  const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

  /** Validate a candidate username. Returns '' when acceptable. */
  function validateUsername(name: string): string {
    const n = (name || '').trim();
    if (!n) return 'Pick a username.';
    if (!USERNAME_RE.test(n)) {
      return 'Use 3-20 characters: letters, numbers or underscore, no spaces.';
    }
    return '';
  }

  /** True when the username is free (case-insensitively), ignoring our own row. */
  async function isUsernameAvailable(name: string): Promise<boolean> {
    const n = (name || '').trim();
    if (!n) return false;
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .ilike('username', n)     // case-insensitive, matching the unique index
      .limit(1);
    if (error) { console.warn('[username] availability check failed:', error.message); return false; }
    if (!data || data.length === 0) return true;
    return data[0].id === userId.value;   // our own row doesn't count as taken
  }

  /**
   * Suggest a free username derived from the user's display name.
   *
   * Existing users all have NULL, so asking them to invent a handle from
   * nothing is friction for no reason. "Amy R. Sterling" -> "amy_r_sterling",
   * with a numeric suffix if that's taken, so the prompt is usually one click.
   */
  async function suggestUsername(): Promise<string> {
    const base = (userName.value || userEmail.value.split('@')[0] || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')   // spaces and punctuation become separators
      .replace(/^_+|_+$/g, '')       // no leading/trailing separators
      .slice(0, 20);
    let candidate = base.length >= 3 ? base : `${base}_user`.slice(0, 20);
    for (let i = 0; i < 20; i++) {
      // Only offer something we've confirmed is actually free.
      if (await isUsernameAvailable(candidate)) return candidate;
      const suffix = String(i + 2);
      candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    }
    return candidate;
  }

  /** Persist the username. Throws with a friendly message on conflict. */
  async function saveUsername(name: string) {
    const n = (name || '').trim();
    const invalid = validateUsername(n);
    if (invalid) throw new Error(invalid);
    if (!userId.value) throw new Error('Not signed in.');
    const { error } = await supabase
      .from('users')
      .update({ username: n, updated_at: new Date().toISOString() })
      .eq('id', userId.value);
    if (error) {
      // 23505 = unique violation, i.e. someone already has it.
      if ((error as any).code === '23505' || /duplicate|unique/i.test(error.message)) {
        throw new Error('That username is taken.');
      }
      throw new Error(error.message);
    }
    username.value = n;
  }
  const tasks = ref<ProofreadingTask[]>([]);
  const activeTaskId = ref<number | null>(null);
  const activityFeed = ref<ActivityFeedItem[]>([]);
  const loading = ref(false);
  const error = ref('');

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let feedSubscription: any = null;

  // ── User sync ─────────────────────────────────────────────────────────
  /** Upsert user from middleauth identity. Call after login. */
  async function syncUser(email: string, displayName: string) {
    userEmail.value = email;
    userName.value = displayName;
    console.info('[backend] syncUser called for', email);
    try {
      // Try to find existing user by email
      const { data: existing, error: selectErr } = await supabase
        .from('users')
        .select('id, username')
        .eq('middleauth_email', email)
        .single();

      if (selectErr && selectErr.code !== 'PGRST116') {
        // PGRST116 = "no rows returned" (expected for new users)
        console.warn('[backend] syncUser SELECT error:', selectErr.message);
      }

      if (existing) {
        userId.value = existing.id;
        username.value = existing.username || '';
        // Mirrored to a global so error reporting can attribute a crash without
        // importing this store (it may not exist yet during a bootstrap failure).
        (window as any).__ngeUserId = existing.id;
        console.info('[backend] syncUser: found existing user', existing.id);
        // Update display name if changed
        await supabase
          .from('users')
          .update({ display_name: displayName, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        // Create new user
        console.info('[backend] syncUser: creating new user for', email);
        const { data: newUser, error: insertErr } = await supabase
          .from('users')
          .insert({ middleauth_email: email, display_name: displayName })
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        userId.value = newUser?.id ?? null;
        (window as any).__ngeUserId = newUser?.id ?? null;
        console.info('[backend] syncUser: created user', userId.value);
      }
      // Check admin status + load special badges + favorite badge after user is synced
      await checkAdmin();
      await loadMySpecialBadges();
      await loadMyBadgeAwards();
      await loadFavoriteBadge();
    } catch (e: any) {
      console.warn('[backend] User sync failed:', e.message);
    }
  }

  // ── CAVE user-id capture (Phase B leaderboard groundwork) ───────────────
  /**
   * Read the current CAVE bearer token from localStorage, call CAVE's
   * /auth/api/v1/user/me, and persist the returned numeric `id` to
   * users.cave_user_id. Used so the leaderboard can join cell-completion
   * counts (written by AnnotationEngine into bound_tag_user tables, keyed
   * on a numeric CAVE user_id) against this Supabase users row.
   *
   * Idempotent and silent on failure — if there's no token, the endpoint
   * is unreachable, or the user already has a cave_user_id stored, this
   * just returns. Safe to call after every middleauthlogin event.
   */
  async function captureCaveUserId(): Promise<void> {
    if (!userId.value) {
      console.info('[backend] captureCaveUserId: no userId yet, skipping');
      return;
    }
    // CAVE's sticky_auth realm — same one lightbulb_service.ts reads from.
    const STICKY_AUTH_URL = 'https://global.daf-apis.com/sticky_auth';
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem(`auth_token_v2_${STICKY_AUTH_URL}`);
      if (raw) token = JSON.parse(raw).accessToken ?? null;
    } catch { /* ignore */ }
    if (!token) {
      console.info('[backend] captureCaveUserId: no CAVE token in localStorage, skipping');
      return;
    }

    // Skip if we already have an id stored (idempotency — avoids a network
    // round-trip on every login).
    try {
      const { data: existing } = await supabase
        .from('users')
        .select('cave_user_id')
        .eq('id', userId.value)
        .single();
      if (existing?.cave_user_id) {
        console.info('[backend] captureCaveUserId: already stored', existing.cave_user_id);
        return;
      }
    } catch { /* fall through to lookup */ }

    // Try the global daf-apis auth-me endpoint first, then minnie as a
    // fallback. Both are sticky_auth-backed; one of them should answer.
    const endpoints = [
      'https://global.daf-apis.com/auth/api/v1/user/me',
      'https://minnie.microns-daf.com/auth/api/v1/user/me',
    ];
    let caveId: number | null = null;
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          console.info(`[backend] captureCaveUserId: ${url} → ${res.status}`);
          continue;
        }
        const me = await res.json();
        // CAVE returns { id, email, name, ... }. The id is a Postgres
        // bigint — JS Number is fine here (real CAVE ids are well under 2^53).
        if (me && typeof me.id === 'number') {
          caveId = me.id;
          console.info(`[backend] captureCaveUserId: ${url} →`, me.id, me.email);
          break;
        }
      } catch (e: any) {
        console.info(`[backend] captureCaveUserId: ${url} error`, e?.message);
      }
    }
    if (caveId === null) return;

    try {
      await supabase
        .from('users')
        .update({ cave_user_id: caveId, updated_at: new Date().toISOString() })
        .eq('id', userId.value);
      console.info('[backend] captureCaveUserId: persisted', caveId, 'for user', userId.value);
    } catch (e: any) {
      console.warn('[backend] captureCaveUserId: update failed:', e?.message);
    }
  }

  // ── Task management ───────────────────────────────────────────────────
  /** Load tasks for a dataset, with optional status filter. */
  async function loadTasks(dataset: string = 'eyewire_ii', statusFilter?: string) {
    loading.value = true;
    error.value = '';
    try {
      let query = supabase
        .from('proofreading_tasks')
        .select('*')
        .eq('dataset', dataset)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      tasks.value = data ?? [];
    } catch (e: any) {
      error.value = e.message || 'Failed to load tasks';
      console.warn('[backend] loadTasks error:', e.message);
    }
    loading.value = false;
  }

  /** Claim a task — insert assignment, update task status, start heartbeat. */
  async function claimTask(taskId: number) {
    if (!userId.value) { error.value = 'Not logged in'; return false; }
    try {
      // Check if already claimed by someone else
      const task = tasks.value.find(t => t.id === taskId);
      if (task && (task.status === 'assigned' || task.status === 'in_progress') && task.assigned_to && task.assigned_to !== userId.value) {
        error.value = 'This cell is already claimed by another user';
        return false;
      }
      // Insert assignment
      const { error: assignErr } = await supabase
        .from('task_assignments')
        .insert({
          task_id: taskId,
          user_id: userId.value,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
      if (assignErr) throw assignErr;

      // Update task status
      const { error: taskErr } = await supabase
        .from('proofreading_tasks')
        .update({ status: 'assigned', assigned_to: userId.value, updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (taskErr) throw taskErr;

      activeTaskId.value = taskId;
      startHeartbeat();

      // Log to edit_log
      await logEdit({ operation: 'claim_task', task_id: taskId });

      // Post to activity feed
      const t = tasks.value.find(x => x.id === taskId);
      const label = t?.segment_id ? `...${t.segment_id.slice(-4)}` : `#${taskId}`;
      await postActivity(`claimed cell ${label}`);

      return true;
    } catch (e: any) {
      error.value = e.message || 'Failed to claim task';
      console.warn('[backend] claimTask error:', e.message);
      return false;
    }
  }

  /** Release the currently active task (give up / skip). */
  async function releaseTask() {
    if (!activeTaskId.value || !userId.value) return;
    const taskId = activeTaskId.value;
    try {
      // Mark assignment as released
      await supabase
        .from('task_assignments')
        .update({ status: 'released', released_at: new Date().toISOString() })
        .eq('task_id', taskId)
        .eq('user_id', userId.value)
        .eq('status', 'active');

      // Set task back to pending
      await supabase
        .from('proofreading_tasks')
        .update({ status: 'pending', assigned_to: null, updated_at: new Date().toISOString() })
        .eq('id', taskId);

      await logEdit({ operation: 'release_task', task_id: taskId });

      activeTaskId.value = null;
      stopHeartbeat();
    } catch (e: any) {
      console.warn('[backend] releaseTask error:', e.message);
    }
  }

  /** Mark a task as completed with final segment/soma data. */
  async function completeTask(taskId: number, finalSegId?: string, somaCoords?: string) {
    if (!userId.value) return;
    try {
      const updates: any = {
        status: 'completed',
        updated_at: new Date().toISOString(),
      };
      if (finalSegId) updates.final_segment_id = finalSegId;
      if (somaCoords) updates.soma_coords = somaCoords;

      await supabase
        .from('proofreading_tasks')
        .update(updates)
        .eq('id', taskId);

      // Mark assignment as completed
      await supabase
        .from('task_assignments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('task_id', taskId)
        .eq('user_id', userId.value)
        .eq('status', 'active');

      await logEdit({
        operation: 'complete_task',
        task_id: taskId,
        metadata: { final_segment_id: finalSegId, soma_coords: somaCoords },
      });

      // Find segment_id for the feed
      const task = tasks.value.find(t => t.id === taskId);
      const segLabel = task?.segment_id ? `...${task.segment_id.slice(-4)}` : `#${taskId}`;
      await postActivity(`completed ${segLabel}`);

      if (activeTaskId.value === taskId) {
        activeTaskId.value = null;
        stopHeartbeat();
      }

      // Update user stats timestamp
      await supabase
        .from('users')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', userId.value);
    } catch (e: any) {
      console.warn('[backend] completeTask error:', e.message);
    }
  }

  // ── Heartbeat — extends assignment expiry every 10 min ────────────────
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(async () => {
      if (!activeTaskId.value || !userId.value) return;
      try {
        await supabase
          .from('task_assignments')
          .update({ expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
          .eq('task_id', activeTaskId.value)
          .eq('user_id', userId.value)
          .eq('status', 'active');
      } catch { /* heartbeat failure is non-fatal */ }
    }, 10 * 60 * 1000); // every 10 minutes
  }

  function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  }

  // ── Edit logging ──────────────────────────────────────────────────────
  /** Log an edit operation to the audit trail + increment user stats + update streaks. */
  async function logEdit(entry: EditLogEntry) {
    try {
      const uid = entry.user_id ?? userId.value;
      if (!uid) {
        console.warn('[backend] logEdit skipped — no userId set (syncUser may not have run yet)');
      }
      // Fire audit trail insert (non-blocking)
      supabase.from('edit_log').insert({
        task_id: entry.task_id ?? activeTaskId.value,
        user_id: uid,
        operation: entry.operation,
        segment_before: entry.segment_before ?? null,
        segment_after: entry.segment_after ?? null,
        coordinates: entry.coordinates ?? null,
        metadata: entry.metadata ?? null,
        dataset: entry.dataset ?? 'eyewire_ii',
        success: entry.success ?? true,
      }).then(
        ({ error }) => { if (error) console.warn('[backend] edit_log insert failed:', error.message); },
        () => {},
      );

      // Increment user stats in Supabase + calculate streak
      if (!userId.value || !(entry.success ?? true)) return;
      const op = entry.operation;
      const diff = (entry.metadata as any)?.diff ?? 1;

      // Single SELECT to get all stats we need
      const { data: row } = await supabase.from('users')
        .select('total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak, last_edit_date')
        .eq('id', userId.value).single();
      if (!row) return;

      const today = new Date().toISOString().slice(0, 10);
      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
        last_edit_date: today,
      };

      // Increment operation-specific counters
      if (op === 'merge') {
        updates.total_edits = (row.total_edits || 0) + diff;
        updates.total_merges = (row.total_merges || 0) + diff;
      } else if (op === 'split') {
        updates.total_edits = (row.total_edits || 0) + diff;
        updates.total_splits = (row.total_splits || 0) + diff;
      } else if (op === 'mark_complete') {
        updates.cells_completed = (row.cells_completed || 0) + 1;
      } else if (op === 'unmark_complete') {
        updates.cells_completed = Math.max(0, (row.cells_completed || 0) - 1);
      }

      // Calculate streak: consecutive calendar days with any activity (edits or completions)
      const lastDate = row.last_edit_date;
      let streak = row.current_streak || 0;
      let longest = row.longest_streak || 0;
      if (lastDate !== today) {
        // Different day — check if it's consecutive
        const lastMs = lastDate ? new Date(lastDate + 'T00:00:00').getTime() : 0;
        const todayMs = new Date(today + 'T00:00:00').getTime();
        const dayGap = Math.round((todayMs - lastMs) / 86400000);
        if (dayGap === 1) {
          streak += 1; // consecutive day
        } else if (dayGap > 1 || !lastDate) {
          streak = 1; // streak broken, restart
        }
        longest = Math.max(longest, streak);
        updates.current_streak = streak;
        updates.longest_streak = longest;
      }

      await supabase.from('users').update(updates).eq('id', userId.value);

      // Immediately update local stats store for instant UI feedback
      const statsStore = useUserStatsStore();
      const localUpdates: Record<string, any> = {};
      if (updates.total_edits !== undefined) localUpdates.editsAllTime = updates.total_edits;
      if (updates.total_merges !== undefined) localUpdates.mergesAllTime = updates.total_merges;
      if (updates.total_splits !== undefined) localUpdates.splitsAllTime = updates.total_splits;
      if (updates.cells_completed !== undefined) localUpdates.cellsSubmitted = updates.cells_completed;
      if (updates.current_streak !== undefined) localUpdates.currentStreak = updates.current_streak;
      if (updates.longest_streak !== undefined) localUpdates.longestStreak = updates.longest_streak;
      localUpdates.lastEditDate = today;
      statsStore.setStats(localUpdates);
    } catch (e: any) {
      console.warn('[backend] logEdit error:', e.message);
    }
  }

  // ── Activity feed ─────────────────────────────────────────────────────
  /** Post an action to the activity feed. */
  async function postActivity(action: string, segmentId?: string) {
    try {
      await supabase.from('activity_feed').insert({
        user_id: userId.value,
        user_name: userName.value || userEmail.value?.split('@')[0] || 'Anonymous',
        action,
        segment_id: segmentId ?? null,
      });
    } catch (e: any) {
      console.warn('[backend] postActivity error:', e.message);
    }
  }

  /** Subscribe to realtime activity feed updates. */
  function subscribeToFeed() {
    if (feedSubscription) return; // already subscribed
    // Load recent feed items
    supabase
      .from('activity_feed')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) activityFeed.value = data.reverse();
      });

    // Subscribe to new inserts
    feedSubscription = supabase
      .channel('activity_feed_realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_feed',
      }, (payload: any) => {
        activityFeed.value.push(payload.new as ActivityFeedItem);
        // Keep only last 100 items in memory
        if (activityFeed.value.length > 100) {
          activityFeed.value = activityFeed.value.slice(-100);
        }
      })
      .subscribe();
  }

  /** Unsubscribe from realtime feed. */
  function unsubscribeFromFeed() {
    if (feedSubscription) {
      supabase.removeChannel(feedSubscription);
      feedSubscription = null;
    }
  }

  // ── Import from Google Sheet (reuses parseCsv from queue store) ─────
  /** Batch-import tasks from a Google Sheet CSV into Supabase. */
  async function importFromGoogleSheet(url: string, dataset: string = 'eyewire_ii') {
    loading.value = true;
    error.value = '';
    try {
      // Convert to CSV export URL
      let csvUrl = url;
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const gidMatch = url.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';
        csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
      }

      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      // Parse CSV lines (simple split — Google Sheets CSV export is well-formed)
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length < 2) { error.value = 'Sheet is empty'; loading.value = false; return; }

      // Find header
      let headerIdx = 0;
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        if (lines[i].toLowerCase().includes('segment')) { headerIdx = i; break; }
      }

      const header = lines[headerIdx].split(',').map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const col = (name: string) => header.findIndex(h => h.includes(name));
      const iSeg = col('segmentid') >= 0 ? col('segmentid') : col('segment');
      const iNuc = col('nuccoord') >= 0 ? col('nuccoord') : col('nuc');
      const iSoma = col('somacoord') >= 0 ? col('somacoord') : col('soma');
      const iNotes = col('note');

      if (iSeg < 0) { error.value = 'No "Segment ID" column found'; loading.value = false; return; }

      const toInsert: any[] = [];
      for (let r = headerIdx + 1; r < lines.length; r++) {
        const fields = lines[r].split(',').map(f => f.trim());
        const segId = fields[iSeg] || '';
        if (!segId || !/^\d+$/.test(segId)) continue;

        // Parse nucleus coords into claim point anchor
        const nucRaw = iNuc >= 0 ? fields[iNuc] || '' : '';
        const nucParts = nucRaw.split(',').map(p => parseFloat(p.trim()));
        const hasNuc = nucParts.length >= 3 && nucParts.every(n => !isNaN(n));

        toInsert.push({
          segment_id: segId,
          dataset,
          nucleus_coords: nucRaw || null,
          soma_coords: iSoma >= 0 ? fields[iSoma] || null : null,
          notes: iNotes >= 0 ? fields[iNotes] || null : null,
          source_sheet_url: url,
          // Point-in-space anchor from nucleus coordinates
          claim_point_x: hasNuc ? Math.round(nucParts[0]) : null,
          claim_point_y: hasNuc ? Math.round(nucParts[1]) : null,
          claim_point_z: hasNuc ? Math.round(nucParts[2]) : null,
        });
      }

      if (toInsert.length === 0) { error.value = 'No valid segments found'; loading.value = false; return; }

      // Batch insert (Supabase handles up to 1000 rows per insert)
      const batchSize = 500;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        const { error: insertErr } = await supabase.from('proofreading_tasks').insert(batch);
        if (insertErr) throw insertErr;
      }

      console.info(`[backend] Imported ${toInsert.length} tasks from Google Sheet`);
      // Reload tasks
      await loadTasks(dataset);
    } catch (e: any) {
      error.value = e.message || 'Failed to import sheet';
      console.warn('[backend] importFromGoogleSheet error:', e.message);
    }
    loading.value = false;
  }

  // ── Load user stats from Supabase → local store ──────────────────────
  /** Hydrate local stats store from Supabase users table. Call after login. */
  async function loadUserStats() {
    if (!userId.value) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak, last_edit_date')
        .eq('id', userId.value)
        .single();
      if (data) {
        const statsStore = useUserStatsStore();
        statsStore.setStats({
          editsAllTime: data.total_edits || 0,
          mergesAllTime: data.total_merges || 0,
          splitsAllTime: data.total_splits || 0,
          cellsSubmitted: data.cells_completed || 0,
          currentStreak: data.current_streak || 0,
          longestStreak: data.longest_streak || 0,
          lastEditDate: data.last_edit_date || '',
        });
        console.info('[backend] Loaded user stats from Supabase');
      }
    } catch (e: any) {
      console.warn('[backend] loadUserStats error:', e.message);
    }
  }

  // ── Load another user's profile data ────────────────────────────────
  async function loadUserProfile(targetUserId: string): Promise<any | null> {
    try {
      const { data: user } = await supabase
        .from('users')
        // NOTE: middleauth_email is deliberately NOT selected. This loads OTHER
        // users' profiles, and fetching their address shipped it to the client
        // (visible in devtools) even once it stopped being rendered.
        .select('id, display_name, username, flag, total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak, last_edit_date, favorite_badge')
        .eq('id', targetUserId)
        .single();
      if (!user) return null;

      // Load their special badges
      const { data: awards } = await supabase
        .from('special_badge_awards')
        .select('*, badge:special_badges(*)')
        .eq('user_id', targetUserId);

      return { ...user, specialBadges: awards || [] };
    } catch (e: any) {
      console.warn('[backend] loadUserProfile error:', e.message);
      return null;
    }
  }

  // ── Leaderboard: top users from Supabase ────────────────────────────
  const leaderboard: Ref<any[]> = ref([]);

  async function loadLeaderboard() {
    // Pull from the `user_edit_counts` view so we get distinct edits_24h,
    // edits_week, and edits_alltime per user (used by the leaderboard
    // panel's three tabs). Falls back to the `users` table if the view
    // hasn't been deployed yet.
    try {
      const { data, error } = await supabase
        .from('user_edit_counts')
        .select('id, display_name, flag, bio, total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak, edits_24h, edits_week, edits_alltime, completions_24h, completions_week, completions_alltime')
        .order('total_edits', { ascending: false })
        .limit(50);
      if (!error && data) {
        leaderboard.value = data;
        return;
      }
      if (error) {
        console.warn('[backend] user_edit_counts view query failed, falling back to users:', error.message);
      }
    } catch (e: any) {
      console.warn('[backend] loadLeaderboard view error:', e.message);
    }
    // Fallback path
    try {
      const { data } = await supabase
        .from('users')
        .select('id, display_name, flag, total_edits, total_merges, total_splits, cells_completed, current_streak, longest_streak')
        .order('total_edits', { ascending: false })
        .limit(50);
      if (data) {
        leaderboard.value = data.map((u: any) => ({
          ...u,
          edits_24h: 0,
          edits_week: 0,
          edits_alltime: u.total_edits ?? 0,
          completions_24h: 0,
          completions_week: 0,
          completions_alltime: u.cells_completed ?? 0,
        }));
      }
    } catch (e: any) {
      console.warn('[backend] loadLeaderboard fallback error:', e.message);
    }
  }

  // ── Weekly podium counts: how many times a user finished top-3 ──────
  /** Result shape: { gold, silver, bronze } counts for one user.
   *  metric defaults to 'edits' for backward compatibility. Pass 'completions'
   *  for the cell-completions podium. The weekly_winners table now carries
   *  a `metric` column (Phase B) so both podiums coexist. */
  async function loadWeeklyPodium(
      targetUserId: string,
      metric: 'edits' | 'completions' = 'edits',
  ): Promise<{ gold: number; silver: number; bronze: number }> {
    const empty = { gold: 0, silver: 0, bronze: 0 };
    if (!targetUserId) return empty;
    try {
      // Tolerant query: select metric so legacy rows (no column) and migrated
      // rows ('edits' / 'completions') both work. We filter client-side so
      // pre-migration rows (where metric IS NULL) are treated as 'edits'.
      const { data, error } = await supabase
        .from('weekly_winners')
        .select('rank, metric')
        .eq('user_id', targetUserId);
      if (error) {
        console.warn('[backend] loadWeeklyPodium error:', error.message);
        return empty;
      }
      const counts = { gold: 0, silver: 0, bronze: 0 };
      for (const row of (data ?? [])) {
        const rowMetric = (row as any).metric ?? 'edits';
        if (rowMetric !== metric) continue;
        if (row.rank === 1) counts.gold++;
        else if (row.rank === 2) counts.silver++;
        else if (row.rank === 3) counts.bronze++;
      }
      return counts;
    } catch (e: any) {
      console.warn('[backend] loadWeeklyPodium failed:', e.message);
      return empty;
    }
  }

  /**
   * Persist the profile fields a user edits in Settings (flag, bio).
   *
   * Settings previously only wrote to localStorage via useUserPreferencesStore,
   * so a saved flag/bio never reached Supabase — the profile and leaderboard
   * read `users.flag`, so the change appeared not to save at all. `syncStats`
   * would have written these, but nothing ever called it.
   *
   * Deliberately NARROW: it must not push edit/merge/split counts. Those are
   * CAVE-derived, and having the client overwrite them with locally-inferred
   * numbers is exactly the bug we're removing.
   */
  async function saveProfileFields(fields: { flag?: string; bio?: string }) {
    if (!userId.value) return;
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (fields.flag !== undefined) update.flag = fields.flag;
    if (fields.bio !== undefined) update.bio = fields.bio;
    const { error } = await supabase.from('users').update(update).eq('id', userId.value);
    if (error) console.warn('[settings] saveProfileFields failed:', error.message);
  }

  // ── Sync user stats to Supabase ───────────────────────────────────────
  /** Push local stats to the users table. Call periodically or on significant events.
   *  NOTE: currently unreferenced. Do not wire this up for stats — see the
   *  CAVE-sourced stats work; use saveProfileFields for profile edits. */
  async function syncStats() {
    if (!userId.value) return;
    const statsStore = useUserStatsStore();
    const prefsStore = useUserPreferencesStore();
    try {
      await supabase
        .from('users')
        .update({
          total_edits: statsStore.stats.editsAllTime,
          total_merges: statsStore.stats.mergesAllTime,
          total_splits: statsStore.stats.splitsAllTime,
          current_streak: statsStore.stats.currentStreak,
          longest_streak: statsStore.stats.longestStreak,
          last_edit_date: statsStore.stats.lastEditDate || null,
          flag: prefsStore.prefs.flag,
          bio: prefsStore.prefs.bio,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId.value);
    } catch (e: any) {
      console.warn('[backend] syncStats error:', e.message);
    }
  }

  // ── Point-in-space claim helpers ──────────────────────────────────────
  const MAX_CLAIMS = 3;

  function pointKey(pt: ClaimPoint): string { return `${pt[0]},${pt[1]},${pt[2]}`; }

  /** Batch-refresh cached segment_ids by resolving supervoxel → current root via PCG.
   *  Correctly follows edits and splits. */
  async function refreshSegmentIds(): Promise<void> {
    const tasksWithSv = tasks.value.filter(t => t.supervoxel_id);
    if (!tasksWithSv.length) return;

    const svIds = tasksWithSv.map(t => t.supervoxel_id!);
    const resolved = await getRootsFromSupervoxels(svIds);
    for (const task of tasksWithSv) {
      const newRoot = resolved.get(task.supervoxel_id!);
      if (newRoot && newRoot !== task.segment_id) {
        task.segment_id = newRoot;
        supabase.from('proofreading_tasks')
          .update({ segment_id: newRoot })
          .eq('id', task.id)
          .then(() => {}, () => {});
      }
    }
  }

  function _findTaskByPoint(point: ClaimPoint): ProofreadingTask | undefined {
    return tasks.value.find(
      t => t.claim_point_x === point[0] && t.claim_point_y === point[1] && t.claim_point_z === point[2],
    );
  }

  function _findActiveTaskByPoint(point: ClaimPoint): ProofreadingTask | undefined {
    return tasks.value.find(
      t => t.claim_point_x === point[0] && t.claim_point_y === point[1] && t.claim_point_z === point[2] &&
           (t.status === 'assigned' || t.status === 'in_progress'),
    );
  }

  /** How many active claims does the current user have? */
  function myActiveClaimCount(): number {
    if (!userId.value) return 0;
    return tasks.value.filter(
      t => t.assigned_to === userId.value && (t.status === 'assigned' || t.status === 'in_progress'),
    ).length;
  }

  /** Is a specific point claimed by anyone? */
  function isClaimedPoint(point: ClaimPoint): {claimed: boolean; byMe: boolean; byName?: string} {
    const task = _findActiveTaskByPoint(point);
    if (!task) return { claimed: false, byMe: false };
    return {
      claimed: true,
      byMe: task.assigned_to === userId.value,
      byName: task.assigned_to && task.assigned_to !== userId.value ? task.assigned_to : undefined,
    };
  }

  /** Is a segment claimed? Checks by matching cached segment_id on any active task. */
  function isClaimedSegment(segId: string): {claimed: boolean; byMe: boolean; byName?: string} {
    const task = tasks.value.find(
      t => t.segment_id === segId && (t.status === 'assigned' || t.status === 'in_progress'),
    );
    if (!task) return { claimed: false, byMe: false };
    return {
      claimed: true,
      byMe: task.assigned_to === userId.value,
      byName: task.assigned_to && task.assigned_to !== userId.value ? task.assigned_to : undefined,
    };
  }

  /** Claim a cell by spatial coordinate + current root ID + supervoxel ID.
   *  The point is the stable navigation anchor; supervoxel_id is the immutable
   *  segment used to resolve current root after edits/splits. */
  async function claimCell(point: ClaimPoint, currentSegId?: string, supervoxelId?: string): Promise<{ok: boolean; reason?: string}> {
    if (!userId.value) return { ok: false, reason: 'Not logged in' };
    if (myActiveClaimCount() >= MAX_CLAIMS) return { ok: false, reason: `Max ${MAX_CLAIMS} claims reached` };

    // Check if already claimed at this point
    const existing = isClaimedPoint(point);
    if (existing.claimed) return { ok: false, reason: existing.byMe ? 'Already claimed by you' : 'Claimed by another player' };

    // Also check by segment ID if provided (in case the same cell was claimed at a different point)
    if (currentSegId) {
      const segClaim = isClaimedSegment(currentSegId);
      if (segClaim.claimed) return { ok: false, reason: segClaim.byMe ? 'Already claimed by you' : 'Claimed by another player' };
    }

    try {
      let task = _findTaskByPoint(point);
      if (!task) {
        const { data, error: insertErr } = await supabase
          .from('proofreading_tasks')
          .insert({
            segment_id: currentSegId || '',
            dataset: 'eyewire_ii',
            status: 'pending',
            claim_point_x: point[0],
            claim_point_y: point[1],
            claim_point_z: point[2],
            supervoxel_id: supervoxelId || null,
          })
          .select('*')
          .single();
        if (insertErr) throw insertErr;
        task = data;
        tasks.value.push(data);
      }

      const ok = await claimTask(task!.id);
      if (ok) {
        const local = tasks.value.find(t => t.id === task!.id);
        if (local) { local.status = 'assigned'; local.assigned_to = userId.value; }
        await loadTasks('eyewire_ii');
        const label = currentSegId ? `...${currentSegId.slice(-4)}` : pointKey(point);
        await postActivity(`claimed cell ${label}`);
        return { ok: true };
      }
      return { ok: false, reason: error.value || 'Claim failed' };
    } catch (e: any) {
      console.warn('[backend] claimCell error:', e.message);
      return { ok: false, reason: e.message };
    }
  }

  /** Release a claim by spatial coordinate. */
  async function releaseCell(point: ClaimPoint): Promise<boolean> {
    const task = tasks.value.find(
      t => t.claim_point_x === point[0] && t.claim_point_y === point[1] && t.claim_point_z === point[2] &&
           t.assigned_to === userId.value &&
           (t.status === 'assigned' || t.status === 'in_progress'),
    );
    if (!task) return false;
    const prevActive = activeTaskId.value;
    activeTaskId.value = task.id;
    await releaseTask();
    activeTaskId.value = prevActive;
    await loadTasks('eyewire_ii');
    return true;
  }

  /** Release a claim by segment ID (finds matching task by cached segment_id). */
  async function releaseBySegment(segId: string): Promise<boolean> {
    const task = tasks.value.find(
      t => t.segment_id === segId && t.assigned_to === userId.value &&
           (t.status === 'assigned' || t.status === 'in_progress'),
    );
    if (!task) return false;
    const prevActive = activeTaskId.value;
    activeTaskId.value = task.id;
    await releaseTask();
    activeTaskId.value = prevActive;
    await loadTasks('eyewire_ii');
    return true;
  }

  // ── Admin Hub ──────────────────────────────────────────────────────────

  const isAdmin = ref(false);

  async function checkAdmin() {
    if (!userEmail.value) { isAdmin.value = false; return; }
    const { data } = await supabase
      .from('admins')
      .select('id')
      .eq('email', userEmail.value)
      .maybeSingle();
    isAdmin.value = !!data;
    if (isAdmin.value) console.info('[backend] Admin access granted for', userEmail.value);
  }

  // ── Notifications ─────────────────────────────────────────────────────

  interface Notification {
    id: number;
    title: string;
    body: string;
    image_url: string | null;
    thumbnail_url: string | null;
    send_at: string;
    expires_at: string | null;
    target_type: string;
    target_id: string | null;
    post_to_chat: boolean;
    created_at: string;
    created_by: string | null;
  }

  const notifications = ref<Notification[]>([]);
  const notificationReads = ref<Set<number>>(new Set());
  /**
   * Dismissed notification ids for the current user.
   *
   * Previously this lived in localStorage and hid a notification FOREVER, per
   * browser, with no undo — one stray click on the × (which sits next to the
   * admin 🗑) wiped it from the feed permanently. It now lives in Supabase on
   * `notification_reads.dismissed`, so it is per-user rather than per-browser,
   * survives a machine change, and is separable from read state: you can mark
   * everything read without deleting it, or delete all without reading.
   */
  const notificationDismissals = ref<Set<number>>(new Set());

  // One-time cleanup: drop the old browser-local dismissal list so anything
  // hidden by an accidental click under the previous behaviour comes back.
  try { localStorage.removeItem('nge-notification-dismissals'); } catch { /* private mode */ }
  let notifSubscription: any = null;

  /** Trigger badge celebration from notification click — AchievementToast watches this */
  const pendingBadgeCelebration = ref<{ title: string; body: string; imageUrl: string } | null>(null);
  const pendingCellCelebration = ref<{ totalCells: number; imageUrl: string; batchCount?: number } | null>(null);

  const unreadNotificationCount = computed(() =>
    notifications.value.filter(n => !notificationReads.value.has(n.id)).length
  );

  async function loadNotifications() {
    if (!userId.value) return;
    const now = new Date().toISOString();

    // Get user's group IDs for group-targeted notifications
    const { data: memberships } = await supabase
      .from('user_group_members')
      .select('group_id')
      .eq('user_id', userId.value);
    const groupIds = (memberships || []).map((m: any) => String(m.group_id));

    // Fetch active notifications
    let query = supabase
      .from('notifications')
      .select('*')
      .lte('send_at', now)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: allNotifs } = await query;
    if (!allNotifs) return;

    // Filter: show only non-expired + matching target + not dismissed
    notifications.value = allNotifs.filter((n: Notification) => {
      if (n.expires_at && new Date(n.expires_at) < new Date()) return false;
      if (notificationDismissals.value.has(n.id)) return false;
      if (n.target_type === 'all') return true;
      if (n.target_type === 'user' && n.target_id === userId.value) return true;
      if (n.target_type === 'group' && groupIds.includes(n.target_id || '')) return true;
      return false;
    });

    // Load read + dismissed status together (both live on notification_reads).
    const { data: reads } = await supabase
      .from('notification_reads')
      .select('notification_id, dismissed')
      .eq('user_id', userId.value);
    notificationReads.value = new Set((reads || []).map((r: any) => r.notification_id));
    notificationDismissals.value = new Set(
      (reads || []).filter((r: any) => r.dismissed).map((r: any) => r.notification_id));

    // Dismissed notifications are hidden from the feed. Done after the read
    // query so the freshly-loaded dismissal set is applied to this batch.
    if (notificationDismissals.value.size) {
      notifications.value = notifications.value.filter(
        n => !notificationDismissals.value.has(n.id));
    }
  }

  /**
   * The admin's view of notifications — ALL of them, not just the ones a user
   * would see.
   *
   * loadNotifications() filters to `send_at <= now` and the current user's
   * targeting, so an admin can't see what's scheduled, what's expired, or
   * anything aimed at someone else. This is the management list instead.
   *
   * Paginated deliberately: a project that has been running a while
   * accumulates notifications, and loading every one to render a settings
   * panel gets slow for no benefit. Newest first, a page at a time.
   * Ordering by send_at DESC also means future-dated (scheduled) rows sort to
   * the top, so the queue is always on the first page.
   */
  const adminNotifications = ref<Notification[]>([]);
  const adminNotifHasMore = ref(false);
  const ADMIN_NOTIF_PAGE = 15;

  async function loadAdminNotifications(append = false) {
    if (!isAdmin.value) return;
    const offset = append ? adminNotifications.value.length : 0;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('send_at', { ascending: false })
      .range(offset, offset + ADMIN_NOTIF_PAGE - 1);
    if (error) { console.warn('[admin] loadAdminNotifications failed:', error.message); return; }
    const rows = data || [];
    // A full page back implies there may be more; a short page means the end.
    adminNotifHasMore.value = rows.length === ADMIN_NOTIF_PAGE;
    adminNotifications.value = append ? [...adminNotifications.value, ...rows] : rows;
  }

  /**
   * Edit an existing notification.
   *
   * Callers must not offer this for expired notifications — editing something
   * nobody can see any more is misleading. Enforced in the UI (the edit button
   * is hidden) rather than here, so an admin script could still repair a row.
   */
  async function updateNotification(id: number, fields: {
    title?: string; body?: string;
    image_url?: string | null; thumbnail_url?: string | null;
    send_at?: string; expires_at?: string | null;
    target_type?: string; target_id?: string | null;
    post_to_chat?: boolean;
  }) {
    if (!isAdmin.value) return;
    const { error } = await supabase.from('notifications').update(fields).eq('id', id);
    if (error) { console.warn('[admin] updateNotification failed:', error.message); throw new Error(error.message); }
    // Reflect locally without a full refetch.
    const patch = (list: Notification[]) => {
      const i = list.findIndex(n => n.id === id);
      if (i >= 0) list[i] = { ...list[i], ...fields } as Notification;
    };
    patch(adminNotifications.value);
    patch(notifications.value);
  }

  async function markNotificationRead(notifId: number) {
    if (!userId.value) return;
    notificationReads.value.add(notifId);
    await supabase.from('notification_reads').insert({
      notification_id: notifId,
      user_id: userId.value,
    }).then(() => {}, () => {}); // ignore duplicate errors
  }

  async function markAllNotificationsRead() {
    if (!userId.value) return;
    const unread = notifications.value.filter(n => !notificationReads.value.has(n.id));
    for (const n of unread) {
      notificationReads.value.add(n.id);
    }
    // Batch insert (ignore conflicts)
    const rows = unread.map(n => ({ notification_id: n.id, user_id: userId.value }));
    if (rows.length > 0) {
      await supabase.from('notification_reads').upsert(rows, { onConflict: 'notification_id,user_id' });
    }
  }

  async function createNotification(data: {
    title: string; body: string;
    image_url?: string; thumbnail_url?: string;
    send_at?: string; expires_at?: string;
    target_type?: string; target_id?: string;
    post_to_chat?: boolean;
  }) {
    if (!isAdmin.value || !userId.value) return;
    const row = {
      title: data.title,
      body: data.body,
      image_url: data.image_url || null,
      thumbnail_url: data.thumbnail_url || null,
      send_at: data.send_at || new Date().toISOString(),
      expires_at: data.expires_at || null,
      target_type: data.target_type || 'all',
      target_id: data.target_id || null,
      post_to_chat: data.post_to_chat || false,
      created_by: userId.value,
    };
    // Select the id back so the chat announcement can link to this exact
    // notification rather than telling people to go and find it.
    const { data: created, error: err } = await supabase
      .from('notifications').insert(row).select('id').single();
    if (err) console.warn('[admin] createNotification error:', err.message);
    const newNotifId: number | null = created?.id ?? null;

    // Post to chat as a system message if requested — but ONLY for
    // notifications going out now.
    //
    // This used to fire on every create, so scheduling a notification for next
    // Tuesday still announced it in chat the instant you hit Send, pointing
    // everyone at something that `send_at` keeps hidden until Tuesday.
    //
    // The `post_to_chat` flag is persisted on the row; the scheduled
    // announcement is posted at its send time by postDueChatAnnouncements()
    // below, which the notification poller runs on every client. Exactly one
    // client posts because the claim is an atomic conditional UPDATE on
    // chat_posted_at (a naive "every client posts" would duplicate — that's why
    // the claim matters). A cron (chat-announcements.yml) was the original plan
    // but it lives on this branch, and GitHub only runs schedules from the
    // default branch, so it never fired — hence the client-side poster.
    // "Scheduled" means the admin explicitly picked a future send time. Post to
    // chat instantly ONLY for send-now notifications — either no send_at, or one
    // whose time has already arrived. Key off `data.send_at` (undefined for a
    // send-now) rather than `row.send_at` (which defaults to now), and use only
    // a small jitter skew.
    //
    // The old guard allowed a 60-second grace: anything less than a minute ahead
    // counted as "now" and fired an instant post. But scheduling for the current
    // or next minute — exactly how this feature gets tested — lands inside that
    // window, so a "scheduled" notification announced itself in chat the instant
    // it was created (e.g. one set for 20:44 posted at 20:43:48).
    const scheduledMs = data.send_at ? new Date(data.send_at).getTime() : NaN;
    const isScheduledForLater = Number.isFinite(scheduledMs) && scheduledMs > Date.now() + 2_000;
    if (data.post_to_chat && !isScheduledForLater) {
      try {
        const chatStore = useChatStore();
        if (chatStore.connected) {
          chatStore.sendMessage(`📢 ${data.title}`, newNotifId);
          // Record that the announcement already went out, so the every-10-min
          // cron (post-due-chat-announcements.mjs) doesn't post a second copy.
          // Only mark it when we actually sent: if chat was offline we couldn't
          // post, so leave chat_posted_at null and let the cron be the fallback.
          if (newNotifId != null) {
            await supabase.from('notifications')
              .update({ chat_posted_at: new Date().toISOString() })
              .eq('id', newNotifId);
          }
        }
      } catch (e) { console.warn('[admin] post_to_chat failed:', e); }
    }
    await loadNotifications();
  }

  /**
   * Post to chat any notifications whose scheduled send time has arrived, that
   * asked to post to chat, and that haven't been posted yet. Runs on every
   * connected client via the notification poller, but posts each announcement
   * exactly once: the claim is an atomic conditional UPDATE (`.is('chat_posted_at',
   * null)`), so only the client whose UPDATE actually flips the column wins and
   * posts. This is what makes scheduled "also post to chat" announcements
   * actually appear (the intended cron never ran — see createNotification).
   */
  async function postDueChatAnnouncements() {
    const chatStore = useChatStore();
    // Need a live channel to broadcast to other users. If no one is connected
    // yet, leave the rows unposted; the next connected poller picks them up.
    if (!chatStore.connected) return;
    const now = new Date().toISOString();
    const { data: due, error: dueErr } = await supabase
      .from('notifications')
      .select('id,title')
      .eq('post_to_chat', true)
      .is('chat_posted_at', null)
      .lte('send_at', now)
      // Don't announce something that already expired — this also skips a stale
      // backlog of expired test notifications when this poster first ships.
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('send_at', { ascending: true })
      .limit(10);
    if (dueErr || !due?.length) return;
    for (const n of due) {
      // Atomic claim: only the row still NULL gets updated, and only one client's
      // UPDATE can win that race, so exactly one client proceeds to post.
      const { data: claimed, error: claimErr } = await supabase
        .from('notifications')
        .update({ chat_posted_at: new Date().toISOString() })
        .eq('id', n.id)
        .is('chat_posted_at', null)
        .select('id');
      if (claimErr) { console.warn('[admin] claim chat announcement failed:', claimErr.message); continue; }
      if (claimed && claimed.length) {
        chatStore.sendMessage(`📢 ${n.title}`, n.id);
      }
    }
  }

  /** Create a self-targeted notification (no admin required). */
  async function createSelfNotification(data: {
    title: string; body: string;
    image_url?: string; thumbnail_url?: string;
  }) {
    if (!userId.value) return;
    const row = {
      title: data.title,
      body: data.body,
      image_url: data.image_url || null,
      thumbnail_url: data.thumbnail_url || null,
      send_at: new Date().toISOString(),
      expires_at: null,
      target_type: 'user',
      target_id: userId.value,
      post_to_chat: false,
      created_by: userId.value,
    };
    const { error: err } = await supabase.from('notifications').insert(row);
    if (err) console.warn('[notifications] self-notification error:', err.message);
    await loadNotifications();
  }

  async function deleteNotification(notifId: number) {
    if (!isAdmin.value) return;
    const { error } = await supabase.from('notifications').delete().eq('id', notifId);
    if (error) { console.warn('[admin] deleteNotification failed:', error.message); throw new Error(error.message); }
    notifications.value = notifications.value.filter(n => n.id !== notifId);
    // Also drop it from the scheduled queue — deleting a pending notification
    // is how an admin cancels it.
    adminNotifications.value = adminNotifications.value.filter(n => n.id !== notifId);
  }

  /** Delete (permanently hide) one notification for the current user. */
  async function dismissNotification(notifId: number) {
    notificationDismissals.value.add(notifId);
    notifications.value = notifications.value.filter(n => n.id !== notifId);
    if (!userId.value) return;
    const { error } = await supabase.from('notification_reads').upsert({
      notification_id: notifId,
      user_id: userId.value,
      dismissed: true,
      dismissed_at: new Date().toISOString(),
    }, { onConflict: 'notification_id,user_id' });
    if (error) console.warn('[notifications] dismiss failed:', error.message);
  }

  /**
   * Delete all of the current user's visible notifications.
   *
   * Deliberately separate from "mark all read": read state controls the unread
   * pip, this clears the feed. Neither one deletes the underlying
   * `notifications` row (that stays admin-only) — it only hides them for this
   * user, so one person clearing their feed never affects anyone else's.
   */
  async function dismissAllNotifications() {
    if (!userId.value) return;
    const visible = notifications.value.slice();
    if (!visible.length) return;
    for (const n of visible) notificationDismissals.value.add(n.id);
    notifications.value = [];
    const rows = visible.map(n => ({
      notification_id: n.id,
      user_id: userId.value,
      dismissed: true,
      dismissed_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('notification_reads')
      .upsert(rows, { onConflict: 'notification_id,user_id' });
    if (error) console.warn('[notifications] dismiss-all failed:', error.message);
  }

  function subscribeToNotifications() {
    if (notifSubscription) return;
    notifSubscription = supabase
      .channel('notifications_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload: any) => {
          loadNotifications();
          // Auto-trigger hero celebration for badge award notifications
          const row = payload?.new;
          if (row?.title?.includes('New Achievement') && row?.target_type !== 'group') {
            // Only show if it's for the current user
            if (!row.target_id || row.target_id === userId.value) {
              pendingBadgeCelebration.value = {
                title: row.title,
                body: row.body || '',
                imageUrl: row.image_url || row.thumbnail_url || '',
              };
            }
          }
        })
      .subscribe();
  }

  function unsubscribeFromNotifications() {
    if (notifSubscription) {
      supabase.removeChannel(notifSubscription);
      notifSubscription = null;
    }
  }

  // ── User Groups ───────────────────────────────────────────────────────

  interface UserGroup {
    id: number;
    name: string;
    description: string;
    color: string;
    created_at: string;
    member_count?: number;
  }

  interface GroupMember {
    user_id: string;
    display_name: string;
    email: string;
    added_at: string;
  }

  const groups = ref<UserGroup[]>([]);

  async function loadGroups() {
    const { data } = await supabase
      .from('user_groups')
      .select('*')
      .order('name');
    if (data) {
      // Get member counts
      for (const g of data) {
        const { count } = await supabase
          .from('user_group_members')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', g.id);
        g.member_count = count || 0;
      }
      groups.value = data;
    }
  }

  async function createGroup(name: string, description: string = '', color: string = '#4a9eff') {
    if (!isAdmin.value || !userId.value) return;
    const { error: err } = await supabase.from('user_groups').insert({
      name, description, color, created_by: userId.value,
    });
    if (err) console.warn('[admin] createGroup error:', err.message);
    await loadGroups();
  }

  async function deleteGroup(groupId: number) {
    if (!isAdmin.value) return;
    await supabase.from('user_groups').delete().eq('id', groupId);
    await loadGroups();
  }

  async function loadGroupMembers(groupId: number): Promise<GroupMember[]> {
    const { data } = await supabase
      .from('user_group_members')
      .select('user_id, added_at, users!user_group_members_user_id_fkey(display_name, middleauth_email)')
      .eq('group_id', groupId);
    return (data || []).map((m: any) => ({
      user_id: m.user_id,
      display_name: m.users?.display_name || '',
      email: m.users?.middleauth_email || '',
      added_at: m.added_at,
    }));
  }

  async function addGroupMembers(groupId: number, userIds: string[]) {
    if (!isAdmin.value || !userId.value) return;
    const rows = userIds.map(uid => ({
      group_id: groupId, user_id: uid, added_by: userId.value,
    }));
    await supabase.from('user_group_members').upsert(rows, { onConflict: 'group_id,user_id' });
    await loadGroups();
  }

  async function removeGroupMember(groupId: number, memberId: string) {
    if (!isAdmin.value) return;
    await supabase.from('user_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', memberId);
    await loadGroups();
  }

  async function searchUsers(query: string): Promise<Array<{id: string; display_name: string; email: string}>> {
    if (!query || query.length < 2) return [];
    const { data } = await supabase
      .from('users')
      .select('id, display_name, middleauth_email')
      .or(`display_name.ilike.%${query}%,middleauth_email.ilike.%${query}%`)
      .limit(10);
    return (data || []).map((u: any) => ({
      id: u.id, display_name: u.display_name, email: u.middleauth_email,
    }));
  }

  // ── Special Badges ────────────────────────────────────────────────────

  interface SpecialBadge {
    id: number;
    name: string;
    description: string;
    slug: string;
    image_url: string;
    thumbnail_url: string | null;
    created_at: string;
  }

  interface SpecialBadgeAward {
    id: number;
    badge_id: number;
    user_id: string;
    awarded_at: string;
    awarded_by: string | null;
    reason: string;
    badge?: SpecialBadge;
  }

  const specialBadges = ref<SpecialBadge[]>([]);
  const mySpecialBadges = ref<SpecialBadgeAward[]>([]);

  async function loadSpecialBadges() {
    const { data } = await supabase
      .from('special_badges')
      .select('*')
      .order('created_at', { ascending: false });
    specialBadges.value = data || [];
  }

  async function loadMySpecialBadges() {
    if (!userId.value) return;
    const { data } = await supabase
      .from('special_badge_awards')
      .select('*, special_badges(*)')
      .eq('user_id', userId.value)
      .order('awarded_at', { ascending: false });
    mySpecialBadges.value = (data || []).map((a: any) => ({
      ...a,
      badge: a.special_badges || undefined,
    }));
  }

  /** Load special badges for any user (for viewing other profiles). */
  async function loadUserSpecialBadges(uid: string): Promise<SpecialBadgeAward[]> {
    const { data } = await supabase
      .from('special_badge_awards')
      .select('*, special_badges(*)')
      .eq('user_id', uid)
      .order('awarded_at', { ascending: false });
    return (data || []).map((a: any) => ({
      ...a,
      badge: a.special_badges || undefined,
    }));
  }

  // ── Building/Exploration badge awards ─────────────────────────────────────
  // Persist the first time each edits/cells threshold is crossed, so a badge
  // stays earned even if the underlying stat later drops. Keyed 'track:badgeId'.
  const myBadgeAwards = ref<Set<string>>(new Set());
  function badgeAwardKey(track: string, badgeId: number): string {
    return `${track}:${badgeId}`;
  }
  async function loadMyBadgeAwards() {
    if (!userId.value) return;
    const { data } = await supabase
      .from('badge_awards')
      .select('track,badge_id')
      .eq('user_id', userId.value);
    myBadgeAwards.value = new Set((data || []).map((r: any) => badgeAwardKey(r.track, r.badge_id)));
  }
  async function recordBadgeAward(track: string, badgeId: number) {
    if (!userId.value || badgeId == null) return;
    const key = badgeAwardKey(track, badgeId);
    if (myBadgeAwards.value.has(key)) return;   // already recorded this session
    myBadgeAwards.value.add(key);
    const { error: err } = await supabase
      .from('badge_awards')
      .upsert({ user_id: userId.value, track, badge_id: badgeId },
              { onConflict: 'user_id,track,badge_id' });
    if (err) console.warn('[badge] recordBadgeAward failed:', err.message);
  }

  async function createSpecialBadge(data: {
    name: string; description: string; slug: string;
    image_url: string; thumbnail_url?: string;
  }) {
    if (!isAdmin.value || !userId.value) return;
    const { error: err } = await supabase.from('special_badges').insert({
      ...data, thumbnail_url: data.thumbnail_url || null, created_by: userId.value,
    });
    if (err) console.warn('[admin] createSpecialBadge error:', err.message);
    await loadSpecialBadges();
  }

  async function awardBadge(badgeId: number, userIds: string[], reason: string = '') {
    if (!isAdmin.value || !userId.value) return;
    const rows = userIds.map(uid => ({
      badge_id: badgeId, user_id: uid, awarded_by: userId.value, reason,
    }));
    const { error: err } = await supabase.from('special_badge_awards')
      .upsert(rows, { onConflict: 'badge_id,user_id' });
    if (err) console.warn('[admin] awardBadge error:', err.message);
  }

  async function awardBadgeToGroup(badgeId: number, groupId: number, reason: string = '') {
    if (!isAdmin.value || !userId.value) return;
    const { data: members } = await supabase
      .from('user_group_members')
      .select('user_id')
      .eq('group_id', groupId);
    if (members && members.length > 0) {
      await awardBadge(badgeId, members.map((m: any) => m.user_id), reason);
    }
  }

  async function revokeBadge(badgeId: number, uid: string) {
    if (!isAdmin.value) return;
    await supabase.from('special_badge_awards')
      .delete()
      .eq('badge_id', badgeId)
      .eq('user_id', uid);
  }

  // ── Image Upload ──────────────────────────────────────────────────────

  /**
   * Upload limits for admin images.
   *
   * The feed renders the thumbnail for every card, so a heavy image is paid for
   * on every open by every user. 8 MB is generous for a source image while
   * still rejecting an accidental raw camera/screenshot dump; the feed itself
   * always loads the small thumbnail, never the full file.
   */
  const MAX_ADMIN_IMAGE_BYTES = 8 * 1024 * 1024;
  const ALLOWED_ADMIN_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  /** Validate before upload. Returns an error string, or '' when acceptable. */
  function validateAdminImage(file: File): string {
    if (!ALLOWED_ADMIN_IMAGE_TYPES.includes(file.type)) {
      return `Unsupported format (${file.type || 'unknown'}). Use PNG, JPEG, WebP or GIF.`;
    }
    if (file.size > MAX_ADMIN_IMAGE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return `Image is ${mb} MB — the limit is ${MAX_ADMIN_IMAGE_BYTES / (1024 * 1024)} MB. Please resize it.`;
    }
    return '';
  }

  async function uploadAdminImage(
    file: File, type: 'notifications' | 'badges',
  ): Promise<{fullUrl: string; thumbUrl: string}> {
    const invalid = validateAdminImage(file);
    if (invalid) throw new Error(invalid);
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = `${type}/${timestamp}-${safeName}`;
    const thumbPath = `${type}/${timestamp}-${safeName}-thumb.png`;

    // Upload full image
    const { error: fullErr } = await supabase.storage
      .from('admin-uploads')
      .upload(fullPath, file, { contentType: file.type, upsert: true });
    if (fullErr) throw new Error('Full image upload failed: ' + fullErr.message);

    // Generate thumbnail client-side
    const thumbBlob = await generateThumbnail(file, 120);
    const { error: thumbErr } = await supabase.storage
      .from('admin-uploads')
      .upload(thumbPath, thumbBlob, { contentType: 'image/png', upsert: true });
    if (thumbErr) throw new Error('Thumbnail upload failed: ' + thumbErr.message);

    const { data: fullData } = supabase.storage.from('admin-uploads').getPublicUrl(fullPath);
    const { data: thumbData } = supabase.storage.from('admin-uploads').getPublicUrl(thumbPath);

    return { fullUrl: fullData.publicUrl, thumbUrl: thumbData.publicUrl };
  }

  /**
   * Upload a help-request screenshot and return its public URL.
   *
   * Deliberately goes straight to Supabase Storage rather than through the
   * signScreenshotUpload Cloud Function. That function mints a v4 signed URL,
   * which requires the runtime service account to sign via the IAM signBlob
   * API — a permission it was never granted, so every request 500'd and
   * screenshot attach was broken. Supabase Storage needs no signing step, no
   * extra IAM, and no Cloud Function: the bucket and its policies already
   * exist for admin uploads, and the same anon key already in the bundle can
   * write to it. Fewer moving parts and nothing new to pay for.
   */
  async function uploadHelpScreenshot(blob: Blob): Promise<string> {
    if (blob.size > MAX_ADMIN_IMAGE_BYTES) {
      const mb = (blob.size / (1024 * 1024)).toFixed(1);
      throw new Error(`Screenshot is ${mb} MB — the limit is ${MAX_ADMIN_IMAGE_BYTES / (1024 * 1024)} MB. Try a smaller size.`);
    }
    const day = new Date().toISOString().slice(0, 10);
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `help-screenshots/${day}/${userId.value || 'anon'}-${rand}.png`;
    const { error } = await supabase.storage
      .from('admin-uploads')
      .upload(path, blob, { contentType: 'image/png', upsert: false });
    if (error) throw new Error('Screenshot upload failed: ' + error.message);
    const { data } = supabase.storage.from('admin-uploads').getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Upload a small icon used as the notification's feed thumbnail.
   *
   * The feed shows a thumbnail per card. Deriving it from a large hero image
   * gives a crop that often reads poorly at 120px, so an admin can supply a
   * purpose-made icon instead. Downscaled to 128px on upload regardless of what
   * was picked, so the feed always loads something small.
   */
  async function uploadAdminIcon(file: File): Promise<string> {
    const invalid = validateAdminImage(file);
    if (invalid) throw new Error(invalid);
    const iconBlob = await generateThumbnail(file, 128);
    const path = `notifications/icon-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.png`;
    const { error } = await supabase.storage
      .from('admin-uploads')
      .upload(path, iconBlob, { contentType: 'image/png', upsert: true });
    if (error) throw new Error('Icon upload failed: ' + error.message);
    const { data } = supabase.storage.from('admin-uploads').getPublicUrl(path);
    return data.publicUrl;
  }

  function generateThumbnail(file: File, maxWidth: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxWidth / img.width, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Thumbnail generation failed'));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ── Favorite Badge (persisted to Supabase) ─────────────────────────────
  const favoriteBadgeSlug: Ref<string> = ref('');

  async function loadFavoriteBadge() {
    if (!userId.value) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('favorite_badge')
        .eq('id', userId.value)
        .single();
      if (data?.favorite_badge) {
        favoriteBadgeSlug.value = data.favorite_badge;
      }
    } catch (e: any) {
      console.warn('[backend] loadFavoriteBadge error:', e.message);
    }
  }

  async function saveFavoriteBadge(slug: string) {
    favoriteBadgeSlug.value = slug;
    if (!userId.value) return;
    try {
      await supabase
        .from('users')
        .update({ favorite_badge: slug || null })
        .eq('id', userId.value);
    } catch (e: any) {
      console.warn('[backend] saveFavoriteBadge error:', e.message);
    }
  }

  return {
    userId, userEmail, userName, tasks, activeTaskId, activityFeed, loading, error,
    username, chatHandle, validateUsername, isUsernameAvailable, saveUsername, suggestUsername,
    leaderboard,
    syncUser, captureCaveUserId, loadTasks, claimTask, releaseTask, completeTask,
    logEdit, postActivity, subscribeToFeed, unsubscribeFromFeed,
    importFromGoogleSheet, syncStats, saveProfileFields, loadUserStats, loadUserProfile, loadLeaderboard, loadWeeklyPodium,
    // Point-in-space claims
    claimCell, releaseCell, releaseBySegment, isClaimedPoint, isClaimedSegment, myActiveClaimCount,
    refreshSegmentIds,
    MAX_CLAIMS,
    // Admin Hub
    isAdmin, checkAdmin,
    // Notifications
    notifications, notificationReads, unreadNotificationCount, loadNotifications,
    adminNotifications, adminNotifHasMore, loadAdminNotifications, updateNotification,
    markNotificationRead, markAllNotificationsRead,
    createNotification, createSelfNotification, postDueChatAnnouncements, deleteNotification, dismissNotification,
    dismissAllNotifications,
    subscribeToNotifications, unsubscribeFromNotifications,
    pendingBadgeCelebration,
    pendingCellCelebration,
    // User Groups
    groups, loadGroups, createGroup, deleteGroup,
    loadGroupMembers, addGroupMembers, removeGroupMember, searchUsers,
    // Special Badges
    specialBadges, mySpecialBadges,
    myBadgeAwards, loadMyBadgeAwards, recordBadgeAward,
    loadSpecialBadges, loadMySpecialBadges, loadUserSpecialBadges,
    createSpecialBadge, awardBadge, awardBadgeToGroup, revokeBadge,
    // Image Upload
    uploadAdminImage, uploadAdminIcon, uploadHelpScreenshot, validateAdminImage, MAX_ADMIN_IMAGE_BYTES,
    // Favorite Badge
    favoriteBadgeSlug, loadFavoriteBadge, saveFavoriteBadge,
  };
});

export const useVolumesStore = defineStore('volumes', () => {
  const volumes: Ref<Volume[]> = ref([]);

  async function loadVolumes(_viewer?: any) {
      if (!CONFIG || !CONFIG.volumes_url) return;
      const {url, credentialsProvider} = parseSpecialUrl(CONFIG.volumes_url, defaultCredentialsManager);
      const response = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);

        for (const [key, value] of Object.entries(response as any)) {
          if (CONFIG.volumes_enabled && !CONFIG.volumes_enabled.includes(key)) {
            continue;
          }
          volumes.value.push({
            name: key,
            description: (value as any).description,
            image_layers: (value as any).image_layers.map((x: any) => {
              x.type = 'image';
              x.source = [x.image_source];
              return x;
            }),
            segmentation_layers: (value as any).segmentation_layers.map((x: any) => {
              x.type = 'segmentation';
              x.source = [x.segmentation_source];
              if (x.skeleton_source) {
                x.source.push(x.skeleton_source);
              }
              return x;
            }),
          });
        }

        // Auto-select default volume if no layers loaded yet
        const layerStore = useLayersStore();
        if (layerStore.activeLayers.size === 0 || (layerStore.activeLayers.size === 1 && layerStore.activeLayers.has(''))) {
          if (CONFIG.volumes_default) {
            const volume = volumes.value.find(x => x.name === CONFIG.volumes_default?.name);
            if (volume) {
              const imageLayer = volume.image_layers.find(x => x.name === CONFIG.volumes_default?.image);
              const segmentationLayer = volume.segmentation_layers.find(x => x.name === CONFIG.volumes_default?.segmentation);
              if (imageLayer && segmentationLayer) {
                layerStore.selectLayers([imageLayer, segmentationLayer]);
              }
            }
          }
        }
  }

  // Auto-load on store creation
  loadVolumes();

  return {loadVolumes, volumes};
});

// ════════════════════════════════════════════════════════════════════════════════
// Chat Store — Supabase Realtime Broadcast (no separate WebSocket server needed)
// ════════════════════════════════════════════════════════════════════════════════

export interface MessagePart {
  type: 'text' | 'link' | 'sender' | 'segment' | 'mention';
  text: string;
}

export interface ChatMessage {
  type: 'message' | 'join' | 'leave' | 'disconnected' | 'time';
  name: string;
  rank: string;
  time?: string;
  dateTime: Date;
  parts: MessagePart[];
  /** Segmentation layer the sender was viewing, for #SegID disambiguation.
   *  Null on messages sent before this was recorded. */
  dataset?: string | null;
  /** Set on announcement messages so clicking opens that notification. */
  notificationId?: number | null;
}

/**
 * Name of the active segmentation layer — our dataset key.
 *
 * Root IDs only mean anything within a single segmentation, so anything that
 * shares a segment ID between users has to record which dataset it came from.
 */
function currentDatasetName(): string | null {
  try {
    const viewer: any = (window as any)['viewer'];
    const layers = viewer?.layerManager?.managedLayers || [];
    for (const l of layers) {
      const cn = l?.layer?.constructor?.name || '';
      if (cn.includes('Segmentation') || l?.layer?.type === 'segmentation') {
        return l.name || null;
      }
    }
  } catch { /* viewer not ready */ }
  return null;
}

/** Parse message text into parts (text + auto-detected links + #SegID references) */
function parseMessageParts(name: string, text: string): MessagePart[] {
  const parts: MessagePart[] = [{ type: 'sender', text: name }];
  // Split on URLs, #SegmentID references, and @mentions.
  //
  // A mention is a SINGLE token: we can't reliably guess where a multi-word
  // display name ends in free text ("@Amy S. and Bob" vs "@celia look at this"
  // are indistinguishable), and trying to swallow a second word grabbed the
  // following ordinary word instead. So match one token and let the self-match
  // below compare against the first word of a display name.
  //
  // The lookbehind prevents matching the "@" inside an email address
  // (a@b.com) or a doubled "@@".
  const tokenRegex = /(https?:\/\/\S+|#\d{5,}|(?<![\w@.])@[A-Za-z0-9._-]{2,})/g;
  const segments = text.split(tokenRegex);
  for (const seg of segments) {
    if (!seg) continue;
    if (/^https?:\/\//.test(seg)) {
      parts.push({ type: 'link', text: seg });
    } else if (/^#\d{5,}$/.test(seg)) {
      parts.push({ type: 'segment', text: seg });
    } else if (/^@[A-Za-z0-9._-]/.test(seg)) {
      parts.push({ type: 'mention', text: seg });
    } else {
      parts.push({ type: 'text', text: seg });
    }
  }
  return parts;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export const useChatStore = defineStore('chat', () => {
  const chatMessages = ref<ChatMessage[]>([]);
  const connected = ref(false);
  const unreadMessages = ref(false);
  /** Numeric unread counter for the green pip on the chat toolbar
   *  icon. Cleared on markRead(); muting prevents increments. */
  const unreadCount = ref(0);

  let channel: ReturnType<typeof supabase.channel> | null = null;
  let connecting = false;
  let lastMessageDate = '';

  function addTimeSeparatorIfNeeded(date: Date) {
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (dateStr !== lastMessageDate) {
      lastMessageDate = dateStr;
      chatMessages.value.push({
        type: 'time',
        name: '',
        rank: '',
        time: dateStr,
        dateTime: date,
        parts: [],
      });
    }
  }

  /** Seed the panel with the most recent persisted messages (chronological, with
   *  timestamps) so users see context instead of a blank chat on open. Silently
   *  no-ops if the `chat_messages` table isn't present yet. */
  async function loadRecentMessages(limit = 5) {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('name, rank, text, created_at, dataset, notification_id')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data) return;
      for (const r of data.slice().reverse()) {          // reverse → chronological
        const date = new Date(r.created_at);
        addTimeSeparatorIfNeeded(date);
        chatMessages.value.push({
          type: 'message',
          name: r.name,
          rank: r.rank || 'player',
          time: formatTime(date),
          dateTime: date,
          parts: parseMessageParts(r.name, r.text),
          dataset: r.dataset ?? null,
          notificationId: r.notification_id ?? null,
        });
      }
    } catch (e) {
      console.warn('[chat] loadRecentMessages failed:', e);
    }
  }

  async function connect() {
    if (channel || connecting) return; // already connected / connecting

    const backend = useProofreadingBackendStore();
    // Login gate: don't connect anonymous users — chat needs an authenticated identity.
    if (!backend.userId || !backend.userName) {
      console.warn('[chat] connect: skipped — user not logged in');
      return;
    }
    // Prefer the unique username; fall back to display name until one is set.
    const displayName = backend.chatHandle;
    if (displayName === 'Anonymous') {
      console.warn('[chat] connect: displayName fell through to "Anonymous" — defensive only');
    }

    connecting = true;
    // Show the recent conversation before we announce the join / go live.
    await loadRecentMessages();

    channel = supabase.channel('eyewire-ii-chat', {
      config: { broadcast: { self: true } },
    });

    channel
      .on('broadcast', { event: 'message' }, (payload) => {
        const { name, rank, text, timestamp, senderId, dataset, notificationId } = payload.payload;
        const date = new Date(timestamp);
        addTimeSeparatorIfNeeded(date);
        chatMessages.value.push({
          type: 'message',
          name,
          rank: rank || 'player',
          time: formatTime(date),
          dateTime: date,
          parts: parseMessageParts(name, text),
          dataset: dataset ?? null,
          notificationId: notificationId ?? null,
        });
        // The channel runs with `broadcast: { self: true }` so the sender also
        // receives their own message — that's how it lands in their own list.
        // But you can't have unread mail from yourself, so don't let it light
        // up the green toolbar pip. Prefer the sender id; fall back to the
        // display name for clients built before senderId was in the payload.
        const isOwnMessage = senderId
          ? senderId === backend.userId
          : name === backend.userName;
        // Also skip the bump if the user muted chat — they explicitly opted
        // out of the green pip on the toolbar.
        const prefs = useUserPreferencesStore();
        if (!isOwnMessage && !prefs.prefs.chatMuted) {
          unreadMessages.value = true;
          unreadCount.value++;
        }
      })
      .on('broadcast', { event: 'join' }, (payload) => {
        const { name } = payload.payload;
        const now = new Date();
        chatMessages.value.push({
          type: 'join',
          name,
          rank: '',
          time: formatTime(now),
          dateTime: now,
          parts: [{ type: 'text', text: `${name} joined the chat` }],
        });
      })
      .on('broadcast', { event: 'leave' }, (payload) => {
        const { name } = payload.payload;
        const now = new Date();
        chatMessages.value.push({
          type: 'leave',
          name,
          rank: '',
          time: formatTime(now),
          dateTime: now,
          parts: [{ type: 'text', text: `${name} left the chat` }],
        });
      })
      .on('presence', { event: 'sync' }, () => {
        // Could track online users here in the future
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          connected.value = true;
          // Announce join
          await channel!.send({
            type: 'broadcast',
            event: 'join',
            payload: { name: displayName },
          });
          // Track presence
          await channel!.track({ name: displayName, joined_at: new Date().toISOString() });
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          connected.value = false;
        }
      });
    connecting = false; // channel is now assigned; the guard above holds
  }

  /**
   * @param notificationId set on announcement messages, so the client can render
   *   the message as a link that opens that exact notification instead of
   *   telling people to go and find it.
   */
  function sendMessage(text: string, notificationId: number | null = null) {
    if (!channel || !connected.value) return;
    const backend = useProofreadingBackendStore();
    const name = backend.chatHandle;
    const rank = backend.isAdmin ? 'admin' : 'player';
    channel.send({
      type: 'broadcast',
      event: 'message',
      payload: {
        name,
        rank,
        text,
        notificationId,
        timestamp: new Date().toISOString(),
        // Lets the receiving handler recognise this message as our own and
        // skip the unread bump (the channel echoes it back via self: true).
        senderId: backend.userId || null,
        // Root IDs are only meaningful inside ONE segmentation, so a shared
        // #SegID is meaningless (or silently wrong) without knowing which
        // dataset the sender was looking at. Stamp it so the reader can warn /
        // offer to switch instead of jumping to a different cell entirely.
        dataset: currentDatasetName(),
      },
    });
    // Persist for history so the last messages show on next open (best-effort;
    // no-ops if the chat_messages table isn't present).
    supabase.from('chat_messages')
      .insert({ name, rank, text, dataset: currentDatasetName(), notification_id: notificationId })
      .then(({ error }) => { if (error) console.warn('[chat] persist failed:', error.message); });
  }

  function markRead() {
    unreadMessages.value = false;
    unreadCount.value = 0;
  }

  function disconnect() {
    if (channel) {
      const backend = useProofreadingBackendStore();
      const name = backend.chatHandle;
      channel.send({
        type: 'broadcast',
        event: 'leave',
        payload: { name },
      });
      supabase.removeChannel(channel);
      channel = null;
      connected.value = false;
      connecting = false;
    }
  }

  return { chatMessages, connected, unreadMessages, unreadCount, connect, sendMessage, markRead, disconnect };
});
