/**
 * Undelete: bring back cells that were just removed from the view.
 *
 * The idea, and the behaviour players already know, are Krzysztof Kruk's: his
 * "Undelete" user scripts for Pyr and BANC (discuss.flywire.ai/t/235 and
 * /t/236) kept the last 50 removed segments and put them back one click at a
 * time. Nik (Nseraf) asked for the same in EyeWire II (2026-10-07). This is
 * written fresh for this viewer, not copied from the scripts.
 *
 * What it keeps: every time cells leave the selected set of the segmentation
 * layer, one step is remembered, newest last, up to MAX_STEPS. A step is the
 * cells that left together: one cell for a single removal, or all of them for
 * "clear" (KK's script could not bring those back; this can, as one step).
 * Undelete puts the newest step back, selected and visible.
 *
 * Limits, the same honest ones as the scripts:
 *  - It is about the VIEW. It does not undo a merge or a cut.
 *  - A cut removes the old cell and adds its pieces, so the old id becomes a
 *    step too. Bringing it back shows whatever that id resolves to now.
 *  - A jump that replaces the view makes a step of the cells it replaced.
 *
 * The list is kept for this tab and this dataset (sessionStorage), so it
 * survives a reload, and two tabs or two datasets never mix.
 */
import { ref } from 'vue';

const MAX_STEPS = 50;
const MAX_CELLS_IN_STEP = 2000;       // a huge "clear" is kept in part, never dropped silently below this
const KEY = 'nge-undelete-v1';

/** How many steps can be brought back, for the button. */
export const undeleteCount = ref(0);
/** How many cells the newest step holds, for the button's tooltip. */
export const undeleteNext = ref(0);

let steps: string[][] = [];
let layerName = '';
let attached: any = null;             // the selectedSegments set being watched
let detach: (() => void) | null = null;
let shadow = new Set<string>();       // what is selected now, so a "clear" knows what it removed
let restoring = false;

function load(name: string): string[][] {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    const list = all?.[name];
    return Array.isArray(list) ? list.filter((s: any) => Array.isArray(s) && s.length && s.every((x: any) => typeof x === 'string')) : [];
  } catch { return []; }
}
function save() {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {};
    all[layerName] = steps;
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode or full: the list still works until the tab closes */ }
}
function publish() {
  undeleteCount.value = steps.length;
  undeleteNext.value = steps.length ? steps[steps.length - 1].length : 0;
}

function remember(ids: string[]) {
  ids = ids.filter(id => /^\d+$/.test(id) && id !== '0').slice(0, MAX_CELLS_IN_STEP);
  if (!ids.length) return;
  const last = steps[steps.length - 1];
  // The same single cell removed twice in a row is one step (KK's rule).
  if (last && last.length === 1 && ids.length === 1 && last[0] === ids[0]) return;
  steps.push(ids);
  if (steps.length > MAX_STEPS) steps.splice(0, steps.length - MAX_STEPS);
  save(); publish();
}

function segLayer(): any {
  const viewer: any = (window as any).viewer;
  return viewer?.layerManager?.managedLayers?.find((l: any) => !l?.archived && String(l?.layer?.type || '').startsWith('segmentation'));
}
const setsOf = (ml: any) => {
  const gs = ml?.layer?.displayState?.segmentationGroupState?.value;
  return { selected: gs?.selectedSegments, visible: gs?.visibleSegments };
};

function attach() {
  const ml = segLayer();
  const { selected } = setsOf(ml);
  if (!selected || selected === attached) return;
  detach?.();
  attached = selected;
  layerName = ml.name || '';
  steps = load(layerName);
  shadow = new Set<string>([...selected].map((x: any) => x.toString()));
  publish();
  const onChange = (x: any, add: boolean) => {
    if (add) {
      for (const v of Array.isArray(x) ? x : [x]) if (v != null) shadow.add(v.toString());
      return;
    }
    let gone: string[];
    if (x === null) gone = [...shadow];                                   // clear: everything that was there
    else gone = (Array.isArray(x) ? x : [x]).map((v: any) => v.toString());
    for (const id of gone) shadow.delete(id);
    if (x === null) shadow.clear();
    if (!restoring) remember(gone);
  };
  selected.changed.add(onChange);
  const watched = selected;
  detach = () => { try { watched.changed.remove(onChange); } catch { /* layer already gone */ } };
}

/** Put the newest step back. Returns how many cells came back. */
export function undelete(): number {
  attach();
  const ml = segLayer();
  const { selected, visible } = setsOf(ml);
  if (!selected || !steps.length) return 0;
  const ids = steps.pop()!;
  save(); publish();
  const Uint64Ctor = [...selected][0]?.constructor ?? [...(visible ?? [])][0]?.constructor ?? (window as any).__ngeUint64;
  restoring = true;
  let n = 0;
  try {
    for (const id of ids) {
      const v = Uint64Ctor?.parseString ? Uint64Ctor.parseString(id) : null;
      if (!v) continue;
      selected.add(v);
      visible?.add(v);
      n++;
    }
  } finally { restoring = false; }
  return n;
}

/** Forget every step for the dataset on screen. */
export function clearUndelete() {
  steps = [];
  save(); publish();
}

/** Ctrl+Z (⌘+Z) brings a step back, when the player has the Undelete icon
 *  turned on and is not typing somewhere. */
function onKey(e: KeyboardEvent, enabled: () => boolean) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (!enabled() || !steps.length) return;
  e.preventDefault();
  undelete();
}

let started = false;
/** Call once the viewer exists. `enabled` says whether the player has turned
 *  Undelete on; the list is kept either way, so it is ready when they do. */
export function startUndelete(Uint64Class: any, enabled: () => boolean = () => true) {
  if (started) return;
  started = true;
  window.addEventListener('keydown', e => onKey(e, enabled));
  (window as any).__ngeUint64 = Uint64Class;   // so a step can come back into an empty view
  attach();
  // The segmentation layer is replaced on a dataset switch or a loaded view.
  setInterval(attach, 1500);
}
