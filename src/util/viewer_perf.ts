/**
 * The viewer's loading settings, kept per player (Krzysztof 2026-10-15: "I'd
 * like to be able to set viewer settings and have them not changed when I'm
 * claiming a new quest cell").
 *
 * Prefetching, concurrent chunk requests and the two memory limits live in
 * neuroglancer's view state, so every view the game opens (a quest cell, a
 * jump, a dataset switch) put them back to the defaults. A player on a slow
 * connection set them again for every cell.
 *
 * Now a value the player changes in Viewer settings is saved to their
 * preferences (userPrefs.viewerPerf, which follows the account), and put back
 * whenever a new view changes it. Only changes made while the Viewer settings
 * panel is open count as the player's: a view being loaded never overwrites
 * what they chose. A player who never touches these gets neuroglancer's
 * defaults, as before.
 */
import { watch } from 'vue';
import { useUserPreferencesStore, type ViewerPerf } from '../store';

type Key = keyof ViewerPerf;

/** Pyr's graphics memory default: 1 GB (it was 2 GB). Merges and cuts lagged
 *  on computers whose graphics card could not hold that much (Ames
 *  2026-11-24). Views saved before carry the old 2 GB in them. */
export const PYR_GPU_MEMORY = 1e9;
const OLD_PYR_GPU_MEMORY = 2e9;

interface Trackable<T> { value: T; changed: { add(cb: () => void): () => void } }

function trackables(viewer: any): Record<Key, Trackable<any> | undefined> {
  const q = viewer?.dataContext?.chunkQueueManager ?? viewer?.chunkQueueManager;
  return {
    prefetch: q?.enablePrefetch,
    concurrentDownloads: q?.capacities?.download?.itemLimit,
    gpuMemoryLimit: q?.capacities?.gpuMemory?.sizeLimit,
    systemMemoryLimit: q?.capacities?.systemMemory?.sizeLimit,
  };
}

const valid = (k: Key, v: unknown) => (k === 'prefetch' ? typeof v === 'boolean' : typeof v === 'number' && Number.isFinite(v) && v > 0);

export function startViewerPerf(viewer: any) {
  const prefs = useUserPreferencesStore();
  const t = trackables(viewer);
  const panelOpen = () => !!viewer?.settingsPanelState?.location?.watchableVisible?.value;
  let applying = false;

  /** Put the player's saved values back where a view changed them. */
  const apply = () => {
    const saved = prefs.prefs.viewerPerf;
    if (!saved) return;
    applying = true;
    try {
      for (const k of Object.keys(t) as Key[]) {
        const v = saved[k];
        if (t[k] && valid(k, v) && t[k]!.value !== v) t[k]!.value = v;
      }
    } finally { applying = false; }
  };

  let pending = false;
  const onChange = (k: Key) => () => {
    if (applying) return;
    const v = t[k]!.value;
    if (panelOpen()) {
      // The player's own change, in Viewer settings: keep it.
      if (valid(k, v) && prefs.prefs.viewerPerf?.[k] !== v) prefs.save({ viewerPerf: { ...(prefs.prefs.viewerPerf || {}), [k]: v } });
      return;
    }
    // A view saved with the old 2 GB default: the new one, unless the player
    // chose a graphics memory of their own.
    if (k === 'gpuMemoryLimit' && v === OLD_PYR_GPU_MEMORY && !valid(k, prefs.prefs.viewerPerf?.gpuMemoryLimit)) {
      queueMicrotask(() => { if (t[k]!.value === OLD_PYR_GPU_MEMORY) t[k]!.value = PYR_GPU_MEMORY; });
      return;
    }
    // A view being loaded reset it: put the player's value back, once the
    // whole state has been read.
    if (!prefs.prefs.viewerPerf || pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; apply(); });
  };
  for (const k of Object.keys(t) as Key[]) t[k]?.changed.add(onChange(k));

  // At start, and when the settings arrive from the player's account.
  watch(() => JSON.stringify(prefs.prefs.viewerPerf || null), () => apply(), { immediate: true });
}
