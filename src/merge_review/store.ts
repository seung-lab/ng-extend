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
  UM_TO_VOXEL_X,
  UM_TO_VOXEL_Z,
  type TokenEdits,
} from "#src/merge_review/state.js";
import { seedMulticut, supervoxelAt } from "#src/merge_review/multicut.js";
import {
  fetchSkeleton,
  shortestPathNm,
  firstContactPathNm,
} from "#src/merge_review/skeletonPath.js";
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
      withAnchorPath(
        buildViewerState(bundle.value, currentWindow.value, currentEdits.value),
        currentWindow.value,
      ),
    );
  }

  // Overlay the "entrance": a white route from the anchor (nucleus) to the
  // current window, plus a white marker on the anchor, so the reviewer can
  // always see where the window sits relative to the fixed anchor.
  //
  // Preferred route FOLLOWS THE NEURON: the shortest path along the precomputed
  // skeleton, from the skeleton vertex nearest the anchor (the "entrance gate")
  // to the vertex nearest the window (see computeAnchorPath). While that async
  // fetch/solve is in flight — or if the skeleton is unavailable — we fall back
  // to a straight anchor→window-centre line so there's always immediate feedback.
  function withAnchorPath(
    state: Record<string, unknown>,
    w: ReviewWindow,
  ): Record<string, unknown> {
    if (anchorPos.value == null) return state;
    const a = anchorPos.value;
    const anns: Record<string, unknown>[] = [
      {
        type: "ellipsoid",
        center: a,
        radii: [80, 80, 8],
        id: "anchor-mark",
        description: "anchor (nucleus)",
      },
    ];
    const poly =
      anchorPathForIdx.value === w.idx && anchorPathPoints.value
        ? anchorPathPoints.value
        : null;
    if (poly && poly.length >= 1) {
      // Connector from the true anchor to the entrance gate (nearest vertex),
      // then the skeleton polyline hugging the neuron out to the window.
      anns.push({
        type: "line",
        pointA: a,
        pointB: poly[0],
        id: "anchor-gate",
        description: "anchor → entrance gate",
      });
      for (let i = 0; i < poly.length - 1; i++) {
        anns.push({
          type: "line",
          pointA: poly[i],
          pointB: poly[i + 1],
          id: `anchor-path-${i}`,
          description: i === 0 ? "entrance gate" : "",
        });
      }
    } else {
      const center = [
        w.center_um[0] * UM_TO_VOXEL_X,
        w.center_um[1] * UM_TO_VOXEL_X,
        w.center_um[2] * UM_TO_VOXEL_Z,
      ];
      anns.push({
        type: "line",
        pointA: a,
        pointB: center,
        id: "anchor-path-straight",
        description: "anchor → window",
      });
    }
    const layers = ((state.layers as Record<string, unknown>[]) ?? []).filter(
      (l) => l.name !== "anchor-path",
    );
    layers.push({
      type: "annotation",
      source: "local://annotations",
      tab: "annotations",
      annotationColor: "#ffffff",
      annotations: anns,
      name: "anchor-path",
    });
    return { ...state, layers };
  }

  // Fetch the neuron's skeleton and solve the shortest path anchor→window along
  // it, then redraw. Guarded by a token + current-window check so fast window
  // switching never draws a stale route. Silent no-op if the skeleton can't be
  // fetched/solved (the straight-line fallback stays).
  let anchorPathToken = 0;
  async function computeAnchorPath(w: ReviewWindow) {
    if (!viewer || anchorPos.value == null || root.value == null) return;
    const myIdx = w.idx;
    const myToken = ++anchorPathToken;
    const datastack = bundle.value?.neuron.datastack || "minnie65_public";
    const a = anchorPos.value;
    // anchor: viewer voxel → nm (×[4,4,40]).
    const anchorNm = [a[0] * 4, a[1] * 4, a[2] * 40];
    // This window's cluster token points (edit-aware), in nm, with their labels
    // — the path stops at the nearest of these (the entrance), not the centre.
    const edits = tokenEdits.value[myIdx] ?? {};
    const clustersVox = clusterPositions(w, edits); // Map<label, voxel[][]>
    const clusterPtsNm: number[][] = [];
    const clusterLabels: number[] = [];
    for (const [lab, pts] of clustersVox) {
      for (const v of pts) {
        clusterPtsNm.push([v[0] * 4, v[1] * 4, v[2] * 40]);
        clusterLabels.push(lab);
      }
    }
    console.log("[anchor-path] computing", {
      datastack,
      root: String(root.value),
      window: myIdx,
      anchorNm,
      clusterPts: clusterPtsNm.length,
    });
    const skel = await fetchSkeleton(viewer, datastack, String(root.value));
    // Bail if the anchor was cleared, the window changed, or a newer request
    // superseded this one while we were fetching.
    if (
      myToken !== anchorPathToken ||
      currentIdx.value !== myIdx ||
      anchorPos.value == null
    ) {
      return;
    }
    if (!skel) {
      console.warn("[anchor-path] skeleton fetch failed — keeping straight line");
      StatusMessage.showTemporaryMessage(
        "Entrance: skeleton unavailable — showing straight line.",
        4000,
      );
      return;
    }
    // Sanity-check the anchor is actually ON this neuron: distance from the anchor
    // to the nearest skeleton vertex. If it's far, the anchor is on the wrong
    // object and every cut will filter to nothing — warn the reviewer to re-set.
    let anchorDist2 = Infinity;
    for (let i = 0; i < skel.nv; i++) {
      const dx = skel.vertices[3 * i] - anchorNm[0];
      const dy = skel.vertices[3 * i + 1] - anchorNm[1];
      const dz = skel.vertices[3 * i + 2] - anchorNm[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < anchorDist2) anchorDist2 = d;
    }
    const anchorDistUm = Math.sqrt(anchorDist2) / 1000;
    if (anchorDistUm > 8) {
      StatusMessage.showTemporaryMessage(
        `⚠ Anchor is ${anchorDistUm.toFixed(0)}µm from this neuron — it's on the wrong object. ` +
          `Hover THIS neuron's nucleus and press A again.`,
        9000,
      );
      console.warn(`[anchor-path] anchor ${anchorDistUm.toFixed(1)}µm from skeleton — wrong object?`);
    }
    // Stop at the cluster entrance; only fall back to the window centre if this
    // window has no cluster points at all.
    const pathNm =
      clusterPtsNm.length > 0
        ? firstContactPathNm(skel, anchorNm, clusterPtsNm)
        : shortestPathNm(skel, anchorNm, [
            w.center_um[0] * 1000,
            w.center_um[1] * 1000,
            w.center_um[2] * 1000,
          ]);
    console.log("[anchor-path] skeleton", {
      vertices: skel.nv,
      pathPoints: pathNm ? pathNm.length : 0,
      entranceNm: pathNm ? pathNm[pathNm.length - 1] : null,
    });
    if (!pathNm || pathNm.length < 1) {
      StatusMessage.showTemporaryMessage(
        "Entrance: no skeleton route found — showing straight line.",
        4000,
      );
      return;
    }
    // The entrance vertex = last path point. The cluster whose point is nearest
    // it is the "main branch" (kept side); everything else is cut.
    if (clusterPtsNm.length > 0) {
      const e = pathNm[pathNm.length - 1];
      let bi = 0;
      let bd = Infinity;
      for (let j = 0; j < clusterPtsNm.length; j++) {
        const dx = clusterPtsNm[j][0] - e[0];
        const dy = clusterPtsNm[j][1] - e[1];
        const dz = clusterPtsNm[j][2] - e[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      mainClusterLabel.value = clusterLabels[bi];
      mainClusterForIdx.value = myIdx;
      console.log("[anchor-path] main-branch cluster", mainClusterLabel.value);
    }
    // nm → viewer voxel (÷[4,4,40]).
    anchorPathPoints.value = pathNm.map((p) => [p[0] / 4, p[1] / 4, p[2] / 40]);
    anchorPathForIdx.value = myIdx;
    StatusMessage.showTemporaryMessage(
      `Entrance: skeleton route (${pathNm.length} pts).`,
      3000,
    );
    rerenderCurrentWindow();
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
    // Leaving a window we marked YES (a real merge) → queue its fixed cut before moving on.
    if (currentIdx.value != null && currentIdx.value !== idx) {
      const d = decisions.value[currentIdx.value];
      if ((d?.merge ?? d?.verdict) === "yes") enqueueCurrentSplit();
    }
    currentIdx.value = idx;
    applyStateToViewer(
      withAnchorPath(
        buildViewerState(bundle.value, w, tokenEdits.value[idx] ?? {}),
        w,
      ),
    );
    // Trace the skeleton route to this window (async; swaps in over the
    // straight-line fallback when it resolves).
    if (anchorPos.value != null) void computeAnchorPath(w);
  }

  // ─────────────────────── merge verdict ───────────────────────
  function applyMerge(verdict: string) {
    if (!bundle.value || currentIdx.value == null) return;
    setField(currentIdx.value, "merge", verdict);
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
      // A new neuron: drop any anchor from the previous bundle. Its supervoxel is
      // on a different object, so leaving it set makes every cut filter to nothing
      // ("no_points_on_anchor_object"). The reviewer must set a fresh anchor.
      clearAnchor();
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
  // The anchor's 3D position (viewer voxel coords) — drives the white
  // "entrance" line/marker overlay (withAnchorPath).
  const anchorPos = ref<number[] | null>(null);
  // Skeleton route (viewer voxel coords) from the anchor to a window, and the
  // window idx it was computed for (so it's only drawn for that window).
  const anchorPathPoints = ref<number[][] | null>(null);
  const anchorPathForIdx = ref<number | null>(null);
  // The "main branch" cluster label for a window: the cluster the skeleton
  // entrance contacts (i.e. the one continuous with the anchor). It's the KEEP
  // side; every other cluster is cut. Set by computeAnchorPath.
  const mainClusterLabel = ref<number | null>(null);
  const mainClusterForIdx = ref<number | null>(null);
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
        anchorPos.value = pos; // for the white "entrance" line/marker
        anchorPathPoints.value = null; // recompute for the new anchor
        anchorPathForIdx.value = null;
        mainClusterLabel.value = null;
        mainClusterForIdx.value = null;
        StatusMessage.showTemporaryMessage(`Anchor set (supervoxel ${sv})`, 4000);
        // Draw the straight fallback now, then trace the skeleton route.
        rerenderCurrentWindow();
        if (currentWindow.value) void computeAnchorPath(currentWindow.value);
        return anchorSv.value;
      }
    }
    window.alert("No supervoxel here — make sure the segmentation is loaded, then retry.");
    return null;
  }
  function clearAnchor() {
    anchorSv.value = null;
    anchorPos.value = null;
    anchorPathPoints.value = null;
    anchorPathForIdx.value = null;
    mainClusterLabel.value = null;
    mainClusterForIdx.value = null;
    rerenderCurrentWindow(); // drop the entrance overlay
  }
  // Queue the current window's binary split as a BACKGROUND cut (view unchanged).
  const enqueuedWindows = new Set<number>();
  function enqueueCurrentSplit() {
    if (!bundle.value || currentIdx.value == null) return;
    const idx = currentIdx.value;
    const w = currentWindow.value;
    if (!w || !w.tokens || !w.tokens.labels) return;
    if (anchorSv.value == null) {
      StatusMessage.showTemporaryMessage("This window is marked YES but no anchor is set \u2014 hover the nucleus and press A.", 6000);
      return;
    }
    if (enqueuedWindows.has(idx)) return;
    // Effective clusters after node recolouring / deletions (voxel coords -> nm).
    const posByLabel = clusterPositions(w, currentEdits.value);
    const labs = Array.from(posByLabel.keys()).sort((a, b) => a - b);
    if (labs.length < 2) {
      StatusMessage.showTemporaryMessage(`Window ${idx}: <2 clusters, nothing to cut.`, 4000);
      return;
    }
    const split = decisions.value[idx]?.split;
    let cutLabels: Set<number>;
    if (Array.isArray(split) && split.length > 0) {
      // Reviewer explicitly highlighted the clusters to cut.
      cutLabels = new Set(split.map(Number));
    } else if (
      mainClusterForIdx.value === idx &&
      mainClusterLabel.value != null &&
      labs.includes(mainClusterLabel.value)
    ) {
      // Default: KEEP the main-branch cluster (the skeleton entrance), CUT every
      // other cluster away from it.
      const keep = mainClusterLabel.value;
      cutLabels = new Set(labs.filter((l) => l !== keep));
    } else {
      // Last resort (no skeleton main-branch yet): cut the first cluster.
      cutLabels = new Set([labs[0]]);
    }
    // Every token per side, in nm (voxel × [4,4,40]). We do NOT resolve
    // supervoxels here — getValueAt only sees the loaded z-slice, so off-slice
    // tokens don't resolve. The worker snaps each nm point to the nearest
    // supervoxel of the anchor's object instead (reliable, server-side).
    const A: number[][] = [];
    const B: number[][] = [];
    for (const [lab, pts] of posByLabel) {
      const side = cutLabels.has(lab) ? A : B;
      for (const v of pts) side.push([v[0] * 4, v[1] * 4, v[2] * 40]);
    }
    if (A.length === 0 || B.length === 0) {
      StatusMessage.showTemporaryMessage("Both split sides need at least one point.", 4000);
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
