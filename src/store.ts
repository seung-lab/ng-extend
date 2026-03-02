import {Ref, ref, reactive} from 'vue';
import {defineStore} from 'pinia';

import {Viewer} from 'neuroglancer/viewer';
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {MiddleAuthCredentialsProvider} from 'neuroglancer/datasource/middleauth/credentials_provider';
import {cancellableFetchSpecialOk, parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import {responseJson} from 'neuroglancer/util/http_request';

import {Config} from './config';
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

  return {initializeWithViewer, activeLayers, selectLayers};
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
