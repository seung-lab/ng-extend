interface RootTask {
  id: number;
  dataset: string;
  segment_id: string;
  supervoxel_id: string | null;
  status: string;
}

/** A reverted edit restores the same IDs; selections do not replace roots. */
export function shouldRefreshClaimRoots(
  tool: 'merge' | 'multicut' | null,
  removed: Set<string>,
  added: Set<string>,
): boolean {
  return !!tool && removed.size > 0 && added.size > 0 &&
    (removed.size !== added.size || [...removed].some(id => !added.has(id)));
}

/** Serialize lookups and writes; an edit during a lookup requests one fresh pass. */
export function createClaimRootRefresher<T extends RootTask>(options: {
  tasks: () => T[];
  dataset: () => string;
  canonicalDataset: (name: string) => string;
  resolve: (ids: string[]) => Promise<Map<string, string>>;
  persist: (task: T, root: string, previousRoot: string) => Promise<boolean>;
  onError: (error: unknown) => void;
}) {
  let running: Promise<void> | null = null;
  let requested = false;
  let includeInactive = false;

  async function drain() {
    while (requested) {
      requested = false;
      const all = includeInactive;
      includeInactive = false;
      const dataset = options.dataset();
      const eligible = (task: T) => !!task.supervoxel_id &&
        options.canonicalDataset(task.dataset) === dataset &&
        (all || task.status === 'assigned' || task.status === 'in_progress');
      const snapshots = options.tasks().filter(eligible).map(task => ({
        id: task.id, sv: task.supervoxel_id!, root: task.segment_id,
      }));
      if (!snapshots.length) continue;
      try {
        const roots = await options.resolve([...new Set(snapshots.map(t => t.sv))]);
        // A newer edit may have invalidated this response while it was in flight.
        if (requested) { includeInactive ||= all; continue; }
        if (options.dataset() !== dataset) continue;
        for (const snapshot of snapshots) {
          if (requested || options.dataset() !== dataset) break;
          const task = options.tasks().find(t => t.id === snapshot.id);
          const root = roots.get(snapshot.sv);
          if (!task || !eligible(task) || task.supervoxel_id !== snapshot.sv ||
              task.segment_id !== snapshot.root || !root || root === '0' || root === task.segment_id) continue;
          task.segment_id = root;
          // Only the cached root changes: claim ownership, notes and status stay intact.
          try {
            const updated = await options.persist(task, root, snapshot.root);
            if (!updated && task.segment_id === root) task.segment_id = snapshot.root;
          }
          catch (error) {
            // Keep the previous cache value retryable after a rejected write.
            if (task.segment_id === root) task.segment_id = snapshot.root;
            options.onError(error);
          }
        }
      } catch (error) { options.onError(error); }
    }
  }

  return function refresh(activeClaimsOnly = false): Promise<void> {
    requested = true;
    includeInactive ||= !activeClaimsOnly;
    if (!running) running = Promise.resolve().then(drain).finally(() => { running = null; });
    return running;
  };
}
