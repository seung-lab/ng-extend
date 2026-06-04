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
import { buildViewerState, clusterPositions } from "#src/merge_review/state.js";
import { seedMulticut } from "#src/merge_review/multicut.js";
import {
  clearDecisionField,
  isDecided,
  loadDecisions,
  saveDecisions,
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
    applyStateToViewer(buildViewerState(bundle.value, w));
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
    const w = currentWindow.value;
    const labels = w?.tokens?.labels;
    if (!labels) return false;
    const total = new Set(labels).size;
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
    const posByLabel = clusterPositions(w);
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
    // Demo: the merge error lives in the OLD (pre-proofread) root —
    // that's the segment to multicut — so seed against the old root,
    // not the latest. Fall back to the latest root if no old root.
    const n = bundle.value.neuron;
    const oldRoot =
      Array.isArray(n.old_root_ids) && n.old_root_ids.length
        ? n.old_root_ids[0]
        : n.old_root_id;
    const rootForSplit = oldRoot != null ? oldRoot : n.latest_root_id;
    seedMulticut(viewer, String(rootForSplit), posA, posB);
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
      let n = 0;
      for (const k of Object.keys(entries)) {
        const v = entries[k];
        if (
          v &&
          typeof v === "object" &&
          (v.merge || v.verdict || v.split || v.affinity)
        ) {
          // Normalise legacy: verdict → merge, affinity → split.
          if (v.verdict && !v.merge) {
            v.merge = v.verdict;
            delete v.verdict;
          }
          if (v.affinity && !v.split) {
            v.split = v.affinity;
            delete v.affinity;
          }
          cur[k] = v;
          n++;
        }
      }
      saveDecisions(root.value, cur);
      reloadDecisions();
      alert(`Merged ${n} prior decision(s).`);
    } catch (e) {
      alert("Failed to parse decisions JSON: " + (e as Error).message);
    }
  }

  function exportDecisions() {
    if (!bundle.value || root.value == null) return;
    const all = loadDecisions(root.value);
    const payload = {
      schema: "merge-review-decisions/v2",
      root_id: root.value,
      exported_at: new Date().toISOString(),
      n_decisions: Object.values(all).filter(isDecided).length,
      decisions: all,
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
    // actions
    initializeWithViewer,
    selectWindow,
    applyMerge,
    toggleSplitCluster,
    toggleSplitSkip,
    createSplit,
    setNotes,
    jumpRow,
    goNextUndecided,
    importBundleFromText,
    importDecisionsFromText,
    exportDecisions,
  };
});
