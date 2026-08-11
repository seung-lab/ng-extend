// Pinia store for the MERGER FREE review workflow.
//
// This is the ng-extend port of the original demo's app.js.  The big
// difference: instead of pointing a spelunker iframe at a `#!{...}`
// URL, we drive the *embedded* neuroglancer viewer directly via
// viewer.state.restoreState() — the same mechanism neuroglancer uses
// to load its own URL hash.  Auth (middleauth/graphene) is handled by
// ng-extend's login store, so the MICrONS segmentation loads natively
// instead of requiring a separate spelunker login.

import { computed, ref, type Ref } from "vue";
import { defineStore } from "pinia";

import type { Viewer } from "neuroglancer/unstable/viewer.js";

import type {
  Bundle,
  Decision,
  DecisionMap,
  ReviewWindow,
} from "#src/merge_review/types.js";
import {
  buildViewerState,
  clusterPositions,
  editedClusterLabels,
  segmentationSources,
  type TokenEdits,
} from "#src/merge_review/state.js";
import { seedMulticut, supervoxelAt } from "#src/merge_review/multicut.js";
import { StatusMessage } from "neuroglancer/unstable/status.js";
import { enqueueJob, fetchKeepRoot } from "#src/merge_review/mergeQueueClient.js";
import {
  clearDecisionField,
  isDecided,
  loadDecisions,
  loadTokenEdits,
  saveDecisions,
  saveTokenEdits,
  setDecisionField,
} from "#src/merge_review/decisions.js";

export type ReviewTab = "suspect" | "all";

export const useMergeReviewStore = defineStore("mergeReview", () => {
  let viewer: Viewer | undefined = undefined;

  const bundle: Ref<Bundle | null> = ref(null);
  const currentTab: Ref<ReviewTab> = ref("suspect");
  const currentIdx: Ref<number | null> = ref(null);
  const hideDecided = ref(false);
  // Reactive mirror of the on-disk decisions for the current root.
  // localStorage is not reactive, so we keep this in sync and persist
  // write-through on every mutation.
  const decisions: Ref<DecisionMap> = ref({});

  // Manual point edits (recolour / delete) per window, keyed by window
  // idx → { tokenIdx → newLabel | "x" }.  In-memory for the session;
  // they refine the split grouping that feeds createSplit().
  const tokenEdits: Ref<Record<number, TokenEdits>> = ref({});

  // Floating-panel chrome (re-openable from the top bar).
  const windowsOpen = ref(true);
  const windowsCollapsed = ref(false);
  const decisionOpen = ref(true);
  const decisionCollapsed = ref(false);

  // ─────────────────────── derived state ───────────────────────
  const root = computed(() =>
    bundle.value ? bundle.value.neuron.latest_root_id : null,
  );

  const showWelcome = computed(() => bundle.value === null);

  const currentWindow = computed<ReviewWindow | null>(() => {
    if (!bundle.value || currentIdx.value == null) return null;
    return bundle.value.windows.find((w) => w.idx === currentIdx.value) ?? null;
  });

  // Edits for the current window (empty object if none).
  const currentEdits = computed<TokenEdits>(() =>
    currentIdx.value == null ? {} : tokenEdits.value[currentIdx.value] ?? {},
  );

  // Cluster labels present in the current window AFTER edits — drives the
  // SPLIT WHICH buttons and the digit-key mapping.
  const splitClusterLabels = computed<number[]>(() =>
    currentWindow.value
      ? editedClusterLabels(currentWindow.value, currentEdits.value)
      : [],
  );

  // Whether the current window has any manual point edits.
  const hasTokenEdits = computed<boolean>(
    () => Object.keys(currentEdits.value).length > 0,
  );

  // The ordered, filtered window list shown in the list panel — also
  // the single source of truth used by keyboard/next navigation.
  const visibleWindows = computed<ReviewWindow[]>(() => {
    if (!bundle.value) return [];
    let windows = bundle.value.windows.slice();
    if (currentTab.value === "suspect") {
      windows = windows.filter((w) => w.is_suspect);
      windows.sort((a, b) => (b.verify_prob || 0) - (a.verify_prob || 0));
    } else {
      windows.sort((a, b) => a.idx - b.idx);
    }
    if (hideDecided.value) {
      windows = windows.filter((w) => !isDecided(decisions.value[w.idx]));
    }
    return windows;
  });

  const nReviewed = computed(
    () => Object.values(decisions.value).filter(isDecided).length,
  );

  const meta = computed(() => {
    if (!bundle.value) return "No bundle loaded.";
    const n = bundle.value.neuron;
    const md = bundle.value.metadata || {};
    const oldStr =
      Array.isArray(n.old_root_ids) && n.old_root_ids.length
        ? ` + ${n.old_root_ids.length} old`
        : n.old_root_id
          ? ` + 1 old`
          : "";
    return (
      `root=${n.latest_root_id}${oldStr}  · ` +
      `${md.n_suspects || 0} suspects / ` +
      `${md.n_windows || 0} windows · ` +
      `${nReviewed.value} reviewed`
    );
  });

  // ─────────────────────── viewer wiring ───────────────────────
  function initializeWithViewer(v: Viewer) {
    viewer = v;
  }

  function applyStateToViewer(state: Record<string, unknown>) {
    if (!viewer) return;
    // Mirror neuroglancer's own hash-binding behaviour:
    //   root.reset(); root.restoreState(json)
    viewer.state.reset();
    viewer.state.restoreState(state);
  }

  // Re-apply a rebuilt state after a point edit while keeping the
  // reviewer's camera.  Copy the live camera fields over the freshly
  // built (window-centred) ones, then reset()+restoreState() (the path
  // selectWindow() uses).
  //
  // Crucially, deactivate the mouse pick FIRST: the edit is triggered
  // while hovering an annotation, so mouseState.active is true.  As soon
  // as restoreState() tears down the old cluster layers, neuroglancer's
  // LayerSelectedValues.update() loop runs over the transient layers and
  // hits an uninitialised selectionState → "Cannot set properties of
  // undefined (setting 'localPositionValid')".  setActive(false) makes
  // that loop skip until the next mouse move, when the new layers are
  // fully built.
  function applyStatePreservingCamera(state: Record<string, unknown>) {
    if (!viewer) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (viewer as any).mouseState?.setActive?.(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cur = (viewer.state as any).toJSON?.() ?? {};
    for (const k of [
      "position",
      "crossSectionScale",
      "crossSectionOrientation",
      "projectionScale",
      "projectionOrientation",
    ]) {
      if (cur[k] !== undefined) state[k] = cur[k];
    }
    applyStateToViewer(state);
  }

  // Rebuild + re-apply the current window's annotations from the current
  // edits, preserving the camera.
  function rerenderCurrentWindow() {
    if (!viewer || !bundle.value || !currentWindow.value) return;
    applyStatePreservingCamera(
      buildViewerState(bundle.value, currentWindow.value, currentEdits.value),
    );
  }

  // ─────────────────────── decisions helpers ───────────────────
  function reloadDecisions() {
    decisions.value = root.value != null ? loadDecisions(root.value) : {};
  }

  function setField(
    idx: number | string,
    field: keyof Decision,
    value: unknown,
  ) {
    if (root.value == null) return;
    setDecisionField(root.value, idx, field, value);
    reloadDecisions();
  }

  function clearField(idx: number | string, field: keyof Decision) {
    if (root.value == null) return;
    clearDecisionField(root.value, idx, field);
    reloadDecisions();
  }

  // ─────────────────────── window selection ────────────────────
  function selectWindow(idx: number) {
    if (!bundle.value) return;
    const w = bundle.value.windows.find((x) => x.idx === idx);
    if (!w) return;
    currentIdx.value = idx;
    applyStateToViewer(
      buildViewerState(bundle.value, w, tokenEdits.value[idx] ?? {}),
    );
  }

  // ─────────────────────── merge verdict ───────────────────────
  function applyMerge(verdict: string) {
    if (!bundle.value || currentIdx.value == null) return;
    setField(currentIdx.value, "merge", verdict);
    if (verdict === "yes") enqueueCurrentSplit();
  }

  // ─────────────────────── split clusters ──────────────────────
  function persistSplit(value: string[] | "skip") {
    if (!bundle.value || currentIdx.value == null) return;
    if (Array.isArray(value) && value.length === 0) {
      // Empty → clear the field so the window is "undecided" again.
      clearField(currentIdx.value, "split");
    } else {
      setField(currentIdx.value, "split", value);
    }
  }

  function toggleSplitCluster(lab: number) {
    if (!bundle.value || currentIdx.value == null) return;
    const d = decisions.value[currentIdx.value] || {};
    // Picking a cluster cancels Skip and discards legacy yes/no.
    const arr = Array.isArray(d.split) ? d.split.slice() : [];
    const labStr = String(lab);
    const i = arr.indexOf(labStr);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(labStr);
    arr.sort((a, b) => Number(a) - Number(b));
    persistSplit(arr);
  }

  function toggleSplitSkip() {
    if (!bundle.value || currentIdx.value == null) return;
    const d = decisions.value[currentIdx.value] || {};
    if (d.split === "skip") {
      persistSplit([]); // toggle off → undecided
    } else {
      persistSplit("skip"); // overrides any cluster selection
    }
  }

  function setNotes(notes: string) {
    if (!bundle.value || currentIdx.value == null) return;
    setField(currentIdx.value, "notes", notes || "");
  }

  // Binary split: the highlighted (selected) clusters form ONE side,
  // every remaining cluster forms the OTHER side.  A single Create-split
  // therefore ALWAYS produces exactly two groups.  Seedable as soon as
  // at least one cluster is highlighted AND at least one is left out
  // (otherwise one of the two sides would be empty).
  const canCreateSplit = computed(() => {
    if (currentIdx.value == null) return false;
    const split = decisions.value[currentIdx.value]?.split;
    if (!Array.isArray(split) || split.length === 0) return false;
    // Count clusters after edits so recolours/deletes stay consistent.
    const total = splitClusterLabels.value.length;
    if (total === 0) return false;
    // ≥1 highlighted and ≥1 not highlighted → both sides non-empty.
    return split.length >= 1 && split.length < total;
  });

  // Seed the graphene multicut tool with the binary split: the
  // highlighted clusters become one side (sinks), all the remaining
  // clusters become the other side (sources), then activate it.
  function createSplit() {
    if (!viewer || !bundle.value || currentIdx.value == null) return;
    const w = currentWindow.value;
    if (!w) return;
    const split = decisions.value[currentIdx.value]?.split;
    if (!Array.isArray(split) || split.length === 0) return;

    const selected = new Set(split.map(Number));
    const posByLabel = clusterPositions(w, currentEdits.value);
    // posA = union of all highlighted clusters; posB = union of the rest.
    const posA: number[][] = [];
    const posB: number[][] = [];
    for (const [lab, pts] of posByLabel) {
      (selected.has(lab) ? posA : posB).push(...pts);
    }
    if (posA.length === 0 || posB.length === 0) {
      alert(
        "Binary split needs both sides non-empty — highlight at least one " +
          "cluster and leave at least one un-highlighted.",
      );
      return;
    }
    seedMulticut(viewer, String(splitRootId()), posA, posB);
  }

  // The segment to multicut.  Demo: the merge error lives in the OLD
  // (pre-proofread) root, so cut against that; fall back to the latest.
  function splitRootId(): string | number {
    const n = bundle.value!.neuron;
    const oldRoot =
      Array.isArray(n.old_root_ids) && n.old_root_ids.length
        ? n.old_root_ids[0]
        : n.old_root_id;
    return oldRoot != null ? oldRoot : n.latest_root_id;
  }

  // ─────────────────────── manual point edits ──────────────────
  // Write-through the in-memory point edits to localStorage, keyed by the
  // current root, so a page reload / crash no longer wipes the reviewer's
  // fine-grained skeleton re-grouping.
  function persistTokenEdits() {
    if (root.value != null) saveTokenEdits(root.value, tokenEdits.value);
  }

  // Apply an edit to one token of the current window: a number recolours
  // it to that cluster label, "x" deletes it.  Re-renders in place so the
  // viewer updates colour/removes the point without moving the camera.
  function editToken(tokenIdx: number, action: number | "x") {
    if (currentIdx.value == null || !currentWindow.value) return;
    const idx = currentIdx.value;
    const map = { ...(tokenEdits.value[idx] ?? {}) };
    const orig = currentWindow.value.tokens?.labels?.[tokenIdx];
    if (action !== "x" && orig === action) {
      delete map[tokenIdx]; // recolour back to original → drop the edit
    } else {
      map[tokenIdx] = action;
    }
    tokenEdits.value = { ...tokenEdits.value, [idx]: map };
    persistTokenEdits();
    rerenderCurrentWindow();
  }

  // The token currently hovered in the viewer, or null.  Reads
  // neuroglancer's pick state; our ellipsoid ids are `tok<globalIdx>`.
  function hoveredTokenIdx(): number | null {
    if (!viewer) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = (viewer as any).mouseState?.pickedAnnotationId as
      | string
      | undefined;
    if (!id || !id.startsWith("tok")) return null;
    const n = Number(id.slice(3));
    return Number.isFinite(n) ? n : null;
  }

  // Edit whatever token is hovered right now; returns true if it acted
  // (so the key handler knows whether to swallow the event).
  function editHoveredToken(action: number | "x"): boolean {
    const tok = hoveredTokenIdx();
    if (tok == null) return false;
    editToken(tok, action);
    return true;
  }

  // Drop all manual edits for the current window and re-render.
  function resetTokenEdits() {
    if (currentIdx.value == null) return;
    const { [currentIdx.value]: _drop, ...rest } = tokenEdits.value;
    void _drop;
    tokenEdits.value = rest;
    persistTokenEdits();
    rerenderCurrentWindow();
  }

  // ─────────────────────── navigation ──────────────────────────
  function jumpRow(delta: number) {
    const visible = visibleWindows.value.map((w) => w.idx);
    if (!visible.length) return;
    let i = visible.indexOf(currentIdx.value ?? -1);
    i = i < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, i + delta));
    selectWindow(visible[i]);
  }

  function goNextUndecided() {
    const visible = visibleWindows.value.map((w) => w.idx);
    if (!visible.length) return;
    const startPos = visible.indexOf(currentIdx.value ?? -1);
    // Search from the row AFTER the current one for the next undecided.
    for (let off = 1; off <= visible.length; off++) {
      const idx = visible[(startPos + off) % visible.length];
      if (!isDecided(decisions.value[idx])) {
        selectWindow(idx);
        return;
      }
    }
    // All decided — just step one row down.
    if (startPos >= 0 && startPos + 1 < visible.length) {
      selectWindow(visible[startPos + 1]);
    } else {
      selectWindow(visible[0]);
    }
  }

  // ─────────────────────── import / export ─────────────────────
  function importBundleFromText(text: string): boolean {
    try {
      const obj = JSON.parse(text) as Bundle;
      if (!obj.neuron || !obj.windows) {
        alert("That JSON doesn't look like a review bundle.");
        return false;
      }
      bundle.value = obj;
      currentIdx.value = null;
      // Restore any point edits previously saved for this root (survives
      // reloads).  Fresh neuron with no saved edits → empty map.
      tokenEdits.value = root.value != null ? loadTokenEdits(root.value) : {};
      reloadDecisions();
      // Auto-select the first window in the visible list so the
      // reviewer is dropped straight into the EM view.
      const first = visibleWindows.value[0];
      if (first) selectWindow(first.idx);
      return true;
    } catch (e) {
      alert("Failed to parse bundle JSON: " + (e as Error).message);
      return false;
    }
  }

  function importDecisionsFromText(text: string) {
    if (!bundle.value || root.value == null) {
      alert("Import a bundle first, then a decisions JSON.");
      return;
    }
    try {
      const obj = JSON.parse(text);
      const rootStr = String(root.value);
      let entries: DecisionMap | null = null;
      if (obj && typeof obj === "object") {
        if (obj[rootStr] && typeof obj[rootStr] === "object") {
          entries = obj[rootStr];
        } else if (obj.root_id != null && obj.decisions != null) {
          entries = obj.decisions;
        } else {
          entries = obj;
        }
      }
      if (!entries || typeof entries !== "object") {
        alert("Could not find decisions for root " + rootStr);
        return;
      }
      const cur = loadDecisions(root.value);
      const restoredEdits: Record<number, TokenEdits> = { ...tokenEdits.value };
      let n = 0;
      let nEdits = 0;
      for (const k of Object.keys(entries)) {
        // Loosely typed: a v3 record also carries `edits` (per-token
        // re-grouping) and `tokens` alongside the merge/split verdict.
        const v = entries[k] as unknown as Record<string, unknown>;
        if (!v || typeof v !== "object") continue;
        // Normalise legacy: verdict → merge, affinity → split.
        if (v.verdict && !v.merge) {
          v.merge = v.verdict;
          delete v.verdict;
        }
        if (v.affinity && !v.split) {
          v.split = v.affinity;
          delete v.affinity;
        }
        // Restore the per-token skeleton re-grouping (multi-way splits).
        // The old import dropped this: the edits were written to the file
        // but never re-loaded into the in-memory map that drives rendering,
        // so re-importing looked like the edits had vanished.
        const rawEdits = v.edits;
        if (rawEdits && typeof rawEdits === "object") {
          const te: TokenEdits = {};
          for (const t of Object.keys(rawEdits as Record<string, unknown>)) {
            const val = (rawEdits as Record<string, unknown>)[t];
            te[Number(t)] = val === "x" ? "x" : Number(val);
          }
          if (Object.keys(te).length) {
            restoredEdits[Number(k)] = te;
            nEdits++;
          }
        }
        // Keep a decision entry only when it carries a merge/split verdict
        // (a window with only point edits is restored above, not here).
        if (v.merge || v.split) {
          cur[k] = v as unknown as Decision;
          n++;
        }
      }
      saveDecisions(root.value, cur);
      tokenEdits.value = restoredEdits;
      persistTokenEdits();
      reloadDecisions();
      if (currentIdx.value != null) rerenderCurrentWindow();
      alert(`Merged ${n} decision(s), restored ${nEdits} window edit(s).`);
    } catch (e) {
      alert("Failed to parse decisions JSON: " + (e as Error).message);
    }
  }

  function exportDecisions() {
    if (!bundle.value || root.value == null) return;
    const all = loadDecisions(root.value);
    const editsByIdx = tokenEdits.value;
    // window idx -> bundle window, so we can inline token positions/labels
    const winByIdx = new Map<number, ReviewWindow>();
    for (const w of bundle.value.windows) winByIdx.set(w.idx, w);

    // every window that has a saved decision OR in-session token edits
    const idxKeys = new Set<string>([
      ...Object.keys(all),
      ...Object.keys(editsByIdx),
    ]);

    // Self-contained per-window record: decision + raw per-token edits +
    // token positions + original/effective grouping + a `modified` flag.
    // This is the hardcase ("错题本") feed — no need to re-join the bundle.
    const records: Record<string, unknown> = {};
    let nModified = 0;
    for (const key of idxKeys) {
      const idx = Number(key);
      const dec: Decision = all[key] ?? {};
      const wEdits: TokenEdits = editsByIdx[idx] ?? {};
      const w = winByIdx.get(idx);
      const tk = w?.tokens;
      const origLabels = tk?.labels ?? [];
      // grouping after the user's recolour/delete edits ("x" → -1 = deleted)
      const effLabels = origLabels.map((l, i) =>
        i in wEdits ? (wEdits[i] === "x" ? -1 : (wEdits[i] as number)) : l,
      );
      const splitDecided =
        dec.split != null &&
        dec.split !== "skip" &&
        (Array.isArray(dec.split) ? dec.split.length > 0 : true);
      const modified = Object.keys(wEdits).length > 0 || splitDecided;
      if (modified) nModified++;
      records[key] = {
        ...dec,
        modified, // a correction (recolour/delete or split) was made here
        edits: wEdits, // tokenIdx -> new cluster label, or "x" = deleted
        center_um: w?.center_um ?? null,
        verify_prob: w?.verify_prob ?? null,
        tokens: tk
          ? {
              pos_rel_um: tk.pos_rel_um, // per-token position (window-relative µm)
              labels: origLabels, // original model grouping
              labels_effective: effLabels, // grouping after user edits
            }
          : null,
      };
    }

    const payload = {
      schema: "merge-review-decisions/v3",
      root_id: root.value,
      exported_at: new Date().toISOString(),
      n_decisions: Object.values(all).filter(isDecided).length,
      n_modified: nModified,
      decisions: records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${root.value}_decisions.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─────────────────────── anchor + background cut queue ───────
  // Anchor = a STABLE supervoxel (the nucleus / keep side). Hover the nucleus, press A.
  const anchorSv = ref<string | null>(null);
  const hasAnchor = computed(() => anchorSv.value != null);
  // Side-by-side "cleaned" layer: poll the worker's keep_root and show it as a
  // second segmentation layer (green), leaving the frozen review layer untouched.
  let lastCleanedRoot: string | null = null;
  function showCleanedRoot(keepRoot: string) {
    if (!viewer || keepRoot === lastCleanedRoot) return;
    lastCleanedRoot = keepRoot;
    const s = viewer.state.toJSON() as Record<string, unknown> & {
      layers?: Array<Record<string, unknown>>;
    };
    const layers = (s.layers ?? []).filter((l) => l.name !== "cleaned");
    layers.push({
      type: "segmentation",
      source: segmentationSources("minnie65_phase3_v1"),
      tab: "source",
      segments: [keepRoot],
      segmentColors: { [keepRoot]: "#2e9e6b" },
      name: "cleaned",
    });
    applyStatePreservingCamera({ ...s, layers });
  }
  let cleanedTimer: ReturnType<typeof setInterval> | null = null;
  function startCleanedPoll() {
    if (cleanedTimer || root.value == null) return;
    const sess = String(root.value);
    cleanedTimer = setInterval(() => {
      void fetchKeepRoot(sess).then((kr) => {
        if (kr) showCleanedRoot(kr);
      });
    }, 5000);
  }
  function setAnchorFromClick(): string | null {
    if (!viewer) return null;
    const ms = (viewer as unknown as { mouseState?: { position?: Float32Array } }).mouseState;
    const pos = ms && ms.position ? Array.from(ms.position) : null;
    if (!pos) {
      window.alert("Hover the cursor over the nucleus, then press A.");
      return null;
    }
    for (const managed of viewer.layerManager.managedLayers) {
      const sv = supervoxelAt(managed.layer, pos);
      if (sv && sv !== 0n) {
        anchorSv.value = sv.toString();
        StatusMessage.showTemporaryMessage(`Anchor set (supervoxel ${sv})`, 4000);
        return anchorSv.value;
      }
    }
    window.alert("No supervoxel here — make sure the segmentation is loaded, then retry.");
    return null;
  }
  function clearAnchor() {
    anchorSv.value = null;
  }
  // Queue the current window's binary split as a BACKGROUND cut (view unchanged).
  const enqueuedWindows = new Set<number>();
  function enqueueCurrentSplit() {
    if (!bundle.value || currentIdx.value == null) return;
    const idx = currentIdx.value;
    const w = currentWindow.value;
    if (!w || !w.tokens || !w.tokens.labels) return;
    if (anchorSv.value == null) {
      StatusMessage.showTemporaryMessage("Set an anchor first: hover the nucleus and press A.", 5000);
      return;
    }
    if (enqueuedWindows.has(idx)) {
      StatusMessage.showTemporaryMessage(`Window ${idx} is already queued.`, 3000);
      return;
    }
    const t = w.tokens;
    // Cut side = the reviewer's highlighted clusters, or (default) the first suggested cluster.
    const split = decisions.value[idx]?.split;
    let cutLabels: Set<number>;
    if (Array.isArray(split) && split.length > 0) {
      cutLabels = new Set(split.map(Number));
    } else {
      const labs = Array.from(new Set(t.labels)).sort((a, b) => a - b);
      if (labs.length < 2) {
        StatusMessage.showTemporaryMessage("Window has <2 clusters — nothing to cut.", 4000);
        return;
      }
      cutLabels = new Set([labs[0]]);
    }
    const c = w.center_um;
    const A: number[][] = [];
    const B: number[][] = [];
    t.pos_rel_um.forEach((p, i) => {
      const nm = [(c[0] + p[0]) * 1000, (c[1] + p[1]) * 1000, (c[2] + p[2]) * 1000];
      (cutLabels.has(t.labels[i]) ? A : B).push(nm);
    });
    if (A.length === 0 || B.length === 0) {
      StatusMessage.showTemporaryMessage("Both split sides must be non-empty.", 4000);
      return;
    }
    enqueuedWindows.add(idx);
    StatusMessage.showTemporaryMessage(`Queuing cut for window ${idx}\u2026`, 3000);
    void enqueueJob({
      session_id: String(root.value ?? "session"),
      reviewer: "reviewer",
      window_id: String(idx),
      source_root_id: String(root.value),
      anchor_sv: anchorSv.value,
      cluster_a_nm: A,
      cluster_b_nm: B,
      approved: false,
    }).then((r) => {
      if ("error" in r) {
        enqueuedWindows.delete(idx);
        StatusMessage.showTemporaryMessage("Queue failed: " + r.error, 6000);
      } else {
        StatusMessage.showTemporaryMessage(
          `Cut queued (job ${(r as { id: number }).id}) for window ${idx}.`, 4000);
      }
    });
    startCleanedPoll();
  }

  return {
    // state
    bundle,
    currentTab,
    currentIdx,
    hideDecided,
    decisions,
    windowsOpen,
    windowsCollapsed,
    decisionOpen,
    decisionCollapsed,
    // derived
    root,
    showWelcome,
    currentWindow,
    visibleWindows,
    nReviewed,
    meta,
    canCreateSplit,
    splitClusterLabels,
    hasTokenEdits,
    // actions
    initializeWithViewer,
    selectWindow,
    applyMerge,
    toggleSplitCluster,
    toggleSplitSkip,
    createSplit,
    editToken,
    editHoveredToken,
    resetTokenEdits,
    setNotes,
    jumpRow,
    goNextUndecided,
    importBundleFromText,
    importDecisionsFromText,
    exportDecisions,
    // background cut queue
    hasAnchor,
    setAnchorFromClick,
    clearAnchor,
    enqueueCurrentSplit,
  };
});
