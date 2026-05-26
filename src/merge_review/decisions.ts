// Decision persistence + schema helpers.
//
// Decisions live in localStorage keyed by latest_root, then by window
// idx.  Each entry has two sub-fields:
//   merge — yes/no/skip/unsure  ("is this actually a real merge?")
//   split — array of cluster-id strings, or "skip"  ("which colored
//           clusters should be split off?")
// Legacy fields (verdict → merge, affinity → split) are migrated on
// read/write so older exports keep working.

import type { Decision, DecisionMap } from "#src/merge_review/types.js";

function decisionsKey(root: string | number): string {
  return `decisions.${root}`;
}

export function loadDecisions(root: string | number): DecisionMap {
  try {
    const raw = localStorage.getItem(decisionsKey(root));
    return raw ? (JSON.parse(raw) as DecisionMap) : {};
  } catch {
    return {};
  }
}

export function saveDecisions(
  root: string | number,
  decisions: DecisionMap,
): void {
  localStorage.setItem(decisionsKey(root), JSON.stringify(decisions));
}

export function setDecisionField(
  root: string | number,
  idx: number | string,
  field: keyof Decision,
  value: unknown,
): void {
  const all = loadDecisions(root);
  const cur: Decision =
    all[idx] && typeof all[idx] === "object" ? all[idx] : {};
  // Migrate legacy entries:
  //   v1: {verdict, notes, ts} → {merge: verdict, ...}
  //   v2 (intermediate): affinity → split
  if (cur.verdict && !cur.merge) {
    cur.merge = cur.verdict;
    delete cur.verdict;
  }
  if (cur.affinity && !cur.split) {
    cur.split = cur.affinity;
    delete cur.affinity;
  }
  (cur as Record<string, unknown>)[field] = value;
  cur.ts = new Date().toISOString();
  all[idx] = cur;
  saveDecisions(root, all);
}

export function clearDecisionField(
  root: string | number,
  idx: number | string,
  field: keyof Decision,
): void {
  const all = loadDecisions(root);
  const cur: Decision | null =
    all[idx] && typeof all[idx] === "object" ? all[idx] : null;
  if (!cur) return;
  delete cur[field];
  cur.ts = new Date().toISOString();
  all[idx] = cur;
  saveDecisions(root, all);
}

export function isSplitDecided(splitV: Decision["split"]): boolean {
  // "skip" string — explicit skip
  if (splitV === "skip") return true;
  // legacy "yes"/"no" strings
  if (splitV === "yes" || splitV === "no") return true;
  // new schema: array of cluster ids; non-empty = decided
  if (Array.isArray(splitV) && splitV.length > 0) return true;
  return false;
}

export function isDecided(d: Decision | null | undefined): boolean {
  if (!d) return false;
  if (d.merge || d.verdict) return true;
  if (isSplitDecided(d.split)) return true;
  if (d.affinity) return true; // legacy
  return false;
}

export function splitTagText(
  splitV: Decision["split"],
): { text: string; title: string } | null {
  if (splitV === "skip") return { text: "S:S", title: "Split: skip" };
  if (splitV === "yes") return { text: "S:Y", title: "Split: yes (legacy)" };
  if (splitV === "no") return { text: "S:N", title: "Split: no (legacy)" };
  if (Array.isArray(splitV) && splitV.length > 0) {
    return {
      text: "S:" + splitV.length + "c",
      title: "Split clusters: " + splitV.join(","),
    };
  }
  return null;
}
