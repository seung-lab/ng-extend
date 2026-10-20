import { Step, useTutorialStore } from "./store-pyr";
import { RESOURCES_MENU_SVG } from "./data/toolbar-icons";
import { lantern } from "./util/lantern";
import { highlightStyles } from "./util/highlight";
import { setStatedColor } from "./widgets/widget_utils";
import { Uint64 } from "neuroglancer/util/uint64";
import { useUserPreferencesStore } from "./store";

/** How a layer chip is selected and hidden. Since 2026-10-11 a plain click
 *  selects and a right click hides; Classic layer tabs in Settings swaps them
 *  (as tutorial-3.ts selectClick). The steps used to say it the old way round
 *  (Ames 2026-10-18). */
const classicLayers = () => { try { return useUserPreferencesStore().prefs.classicLayerClicks === true; } catch { return false; } };
const SELECT_CLICK = () => (classicLayers() ? 'RIGHT-CLICK' : 'CLICK');
const HIDE_CLICK = () => (classicLayers() ? 'CLICK' : 'RIGHT-CLICK');
/** A copy button for coordinates (TutorialStep.vue onHtmlClick). */
const copyButton = (coords: string) => `<button type="button" class="nge-tut-copy" data-nge-copy="${coords}">📋 Copy ${coords}</button>`;
/** The soma the tutorial starts on (its saved view, read 2026-10-18). */
const SOMA = '75744, 56704, 656';
/** A branch with a merger, for the collaborator's spot (Ames 2026-10-19). */
const MERGER_SPOT = '63047, 45841, 263';
// 132KB web-sized JPEG; the 18MB source PNG stays out of the bundle.
import imgWheresNurro from './images/wheres-nurro.png';
import imgNurroAtHome from './images/nurro-at-home600.png';
import imgTutorialFinal from './images/ng-tutorial-final-image.png';

const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};


const OVER_3D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.75,
  y: 0.15,
};

/** Move on by itself once the view has jumped to `spot` ("x, y, z"). */
function nextWhenAt(spot: string) {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const want = spot.split(',').map(Number);
  const at = () => {
    try {
      const p = (window as any).viewer.navigationState.position.value;
      return Math.abs(p[0] - want[0]) < 30 && Math.abs(p[1] - want[1]) < 30 && Math.abs(p[2] - want[2]) < 3;
    } catch { return false; }
  };
  // Wait for the step's view to load, which may itself sit on the spot.
  setTimeout(() => {
    const already = at();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      if (at() && !already) {
        clearInterval(timer);
        setTimeout(() => { if (here()) advance(); }, 1500);
      }
    }, 400);
  }, 2500);
}
/** Step 4 needs an annotation layer: the player's own if they made one,
 *  otherwise the + makes it now (so it gets the Pyr gem tool). */
function ensureAnnotationLayer() {
  setTimeout(() => {
    const viewer = (window as any).viewer;
    const layers = viewer?.layerManager?.managedLayers ?? [];
    const ann = layers.filter((ml: any) => !ml.archived && ml.layer?.type === 'annotation');
    if (ann.length === 0) {
      (document.querySelector('.neuroglancer-layer-add-button') as HTMLElement | null)?.click();
      return;
    }
    // Open its panel if another layer's is showing.
    const mine = ann[ann.length - 1];
    if (viewer.selectedLayer.layer !== mine) { viewer.selectedLayer.layer = mine; viewer.selectedLayer.visible = true; }
  }, 600);
}

const SEG_BOX = '.neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query';
/** Show where to paste: the box glows until the player clicks into it.
 *  (A Find Path style search line to it was tried and taken out, Ames
 *  2026-10-19: "I don't think it's right".) */
function pointAtSegBox() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  let box: HTMLElement | null = null;
  const glow = () => {
    box = document.querySelector<HTMLElement>(SEG_BOX);
    if (box) box.classList.toggle('nge-tour-target', document.activeElement !== box);
  };
  setTimeout(glow, 900);
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); box?.classList.remove('nge-tour-target'); return; }
    glow();
  }, 500);
}

/** Glow the layer side panel button (top bar, far right) for a while. */
function glowPanelButton() {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('#ngFarRight > .neuroglancer-icon:last-child');
    if (!el) return;
    el.classList.add('nge-tour-target');
    setTimeout(() => el.classList.remove('nge-tour-target'), 20000);
  }, 800);
}
/** The eye from the Segments panel, and a pretend row built from the
 *  panel's own parts (Ames 2026-10-18: "make a fake row with the icons"). */
const EYE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
/** A Segments row as the panel draws it under the mouse: the eye, the ID
 *  in the cell's color, then trash, copy, fly to and the type triangle with
 *  its clock (Ames 2026-10-19: "copy the actual look of a seg ID row with
 *  hover state"). */
const FAKE_ROW = `<div class="nge-tut-row nge-tut-row--hover" aria-hidden="true"><span class="nge-tut-row-eye">${EYE_ICON}</span><span class="nge-tut-row-id">648518346356982336</span><span class="nge-tut-row-gap"></span><span class="nge-tut-row-trash">${TRASH_ICON}</span><span class="nge-tut-row-copy">${COPY_ICON}</span><span class="nge-tut-row-fly">↗</span><span class="nge-tut-row-tri">▲<i></i></span></div>`;

/** Find Path in the tutorial: the cells go see through so the path shows,
 *  a big "Path found!" when it arrives, then on. The cells come back to
 *  full strength once the player is past the next box. */
function findPathStep() {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const segLayers = () => ((window as any).viewer?.layerManager?.managedLayers ?? [])
    .filter((ml: any) => ml?.layer?.displayState?.objectAlpha);
  setTimeout(() => { for (const ml of segLayers()) ml.layer.displayState.objectAlpha.value = 0.35; }, 1500);
  const restore = setInterval(() => {
    const s = store.getTutorialStep();
    if (store.activeTutorial === tutorial && (s === step || s === step + 1)) return;
    clearInterval(restore);
    for (const ml of segLayers()) ml.layer.displayState.objectAlpha.value = 1;
  }, 500);
  const onFound = () => {
    if (store.activeTutorial !== tutorial || store.getTutorialStep() !== step) return;
    document.removeEventListener('nge:path-found', onFound);
    const banner = document.createElement('div');
    banner.className = 'nge-tut-banner';
    banner.textContent = 'Path found!';
    document.body.appendChild(banner);
    document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate'));
    setTimeout(() => {
      banner.remove();
      if (store.activeTutorial === tutorial && store.getTutorialStep() === step) advance();
    }, 2600);
  };
  document.addEventListener('nge:path-found', onFound);
}

/** Move on once a highlight in a color other than Checked is drawn. */
function nextWhenOtherHighlight() {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const others = () => {
    const names = highlightStyles().filter(st => st.key !== 'checked').map(st => st.layer);
    let n = 0;
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      if (ml.archived || !names.includes(ml.name)) continue;
      try { n += (ml.layer?.localAnnotations?.toJSON?.() ?? []).length; } catch { /* not loaded */ }
    }
    return n;
  };
  const base = others();
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    if (others() > base) {
      clearInterval(timer);
      setTimeout(() => { if (here()) advance(); }, 1500);
    }
  }, 500);
}
/** Move on once Lantern is lit (or, with `on` false, put out). */
function nextWhenLanternOn(on = true) {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const was = lantern.on;
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    if (lantern.on === on && was !== on) {
      clearInterval(timer);
      setTimeout(() => { if (here()) advance(); }, 1200);
    }
  }, 400);
}

/** A small "?" that shows a hint on hover (Ames 2026-10-18). */
/** With `show`, a selector: clicking the "?" lights that spot (Ames
 *  2026-10-19: "a secondary show me where to click"). */
const hint = (text: string, show?: string) => `<span class="nge-tut-hint" data-hint="Hint: ${text}${show ? ' (click to see where)' : ''}"${show ? ` data-show="${show}"` : ''} aria-label="Hint: ${text}">?</span>`;

/** Select 3D segmentation and show its Segments tab in the side panel. */
function openSegmentsTab() {
  // Kept at it for a few seconds: the step's view loads after the box, and
  // can bring the Render tab back (Ames 2026-10-19: "should open to Segments").
  let tries = 0;
  const timer = setInterval(() => {
    if (++tries > 24) { clearInterval(timer); return; }
    const viewer = (window as any).viewer;
    const seg = (viewer?.layerManager?.managedLayers ?? []).find((ml: any) => !ml.archived && ml.layer?.type === 'segmentation');
    if (!seg) return;
    if (viewer.selectedLayer.layer !== seg || !viewer.selectedLayer.visible) { viewer.selectedLayer.layer = seg; viewer.selectedLayer.visible = true; return; }
    const tab = Array.from(document.querySelectorAll<HTMLElement>('.neuroglancer-tab-label'))
      .find(t => (t.textContent || '').trim() === 'Segments');
    if (!tab) return;
    if (!tab.classList.contains('neuroglancer-selected-tab-label')) tab.click();
    else if (tries > 8) clearInterval(timer);
  }, 250);
}
/** Close enough in 2D to see the branches (the memo spot opened far out,
 *  Ames 2026-10-18: "I got stuck on 4"). */
function zoomIn2D() {
  try { (window as any).viewer.navigationState.zoomFactor.value = 2; } catch { /* no viewer */ }
}

/** The segmentation layer's chip on the layer bar gets a class the box can
 *  point at, kept on it while the step shows (Ames 2026-10-19: "unclear
 *  which one is being pointed to"). */
function segLayer(): any {
  return ((window as any).viewer?.layerManager?.managedLayers ?? []).find((ml: any) => !ml.archived && ml.layer?.type === 'segmentation');
}
function markSegChip() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const tag = () => {
    // The bar shows a friendly name, so match by place: the chips follow the
    // layer list, and a label that says segmentation settles a mismatch.
    const layers = ((window as any).viewer?.layerManager?.managedLayers ?? []).filter((ml: any) => !ml.archived);
    const items = Array.from(document.querySelectorAll<HTMLElement>('.neuroglancer-layer-panel > .neuroglancer-layer-item'));
    let at = layers.indexOf(segLayer());
    if (items.length !== layers.length) at = items.findIndex(it => /segmentation/i.test(it.querySelector('.neuroglancer-layer-item-label')?.textContent || ''));
    items.forEach((it, i) => it.classList.toggle('nge-tut-seg-chip', i === at));
  };
  tag();
  const timer = setInterval(() => {
    if (store.activeTutorial !== tutorial || store.getTutorialStep() !== step) {
      clearInterval(timer);
      document.querySelectorAll('.nge-tut-seg-chip').forEach(e => e.classList.remove('nge-tut-seg-chip'));
      return;
    }
    tag();
  }, 400);
}
/** Move on once 3D segmentation is the selected layer. */
function nextWhenSegSelected() {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const selected = () => { const v = (window as any).viewer; const seg = segLayer(); return !!seg && v?.selectedLayer?.layer === seg; };
  setTimeout(() => {
    const was = selected();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      if (selected() && !was) {
        clearInterval(timer);
        setTimeout(() => { if (here()) advance(); }, 1200);
      }
    }, 300);
  }, 800);
}
/** Move on once 3D segmentation has been hidden and shown again. */
function nextWhenSegHiddenAndShown(times = 1) {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  // Each hide then show counts once; it moves on after `times` of them (a
  // player: two right clicks moved on before they could try the key too).
  let hidden = false, rounds = 0;
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    const seg = segLayer();
    if (!seg) return;
    if (!seg.visible) hidden = true;
    else if (hidden && ++rounds < times) hidden = false;
    else if (hidden) {
      clearInterval(timer);
      setTimeout(() => { if (here()) advance(); }, 1200);
    }
  }, 250);
}

/** The 2D and 3D views side by side, the 2D one close enough to see. */
function showTwoPanels() {
  setTimeout(() => {
    try {
      const v = (window as any).viewer;
      const l = v.layout.toJSON();
      const name = typeof l === 'string' ? l : l?.type;
      if (name === '3d') v.layout.restoreState('xy-3d');
      if (v.navigationState.zoomFactor.value > 3) v.navigationState.zoomFactor.value = 2;
    } catch { /* no viewer */ }
  }, 600);
}

/** In this tutorial the Checked highlight draws pink, so it stands apart
 *  from the blue cell whatever color the player saved for it (Ames
 *  2026-10-19). Only the layer's color changes, never the saved choice;
 *  the highlight tint follows the layer's color (util/highlight.ts). */
const TUTORIAL_HIGHLIGHT = '#ff6ec7';
function pinkHighlights() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial;
  // The Highlight box shows Checked in pink too (util/highlight.ts).
  (window as any).__ngeCheckedColor = TUTORIAL_HIGHLIGHT;
  const timer = setInterval(() => {
    if (store.activeTutorial !== tutorial) { clearInterval(timer); (window as any).__ngeCheckedColor = undefined; return; }
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      if (ml.archived || ml.name !== 'Checked ✓') continue;
      try {
        const c = ml.layer?.annotationDisplayState?.color;
        if (c && String(c.toString()).toLowerCase() !== TUTORIAL_HIGHLIGHT) c.restoreState(TUTORIAL_HIGHLIGHT);
      } catch { /* not loaded yet */ }
    }
  }, 400);
}

/** Moves on, and the step no longer waits on the player. */
function advance() {
  (window as any).__ngeStepPending = false;
  document.dispatchEvent(new CustomEvent('nge:tutorial-next'));
}
/** This step waits on the player's action (Tutorial.vue nudges on Next). */
function waitForAction() { (window as any).__ngeStepPending = true; }

/** Sparkles around the eye of our cell's row (Ames 2026-10-19: "bring
 *  attention to the eye, sparkles or something silly"), while the step shows. */
const OUR_CELL = '648518346353862024';
function sparkleEye() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const timer = setInterval(() => {
    const here = store.activeTutorial === tutorial && store.getTutorialStep() === step;
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`.neuroglancer-segment-list-entry[data-id="${OUR_CELL}"]`));
    const eyes = rows.map(r => r.querySelector<HTMLElement>('.neuroglancer-eye-icon')).filter(Boolean) as HTMLElement[];
    if (!here) {
      clearInterval(timer);
      document.querySelectorAll('.nge-tut-sparkle').forEach(e => e.classList.remove('nge-tut-sparkle'));
      return;
    }
    eyes.forEach(e => e.classList.add('nge-tut-sparkle'));
  }, 400);
}

/** The visible segment IDs of the segmentation layer. */
function visibleIds(): Set<string> {
  try {
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      const vs = ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
      if (vs) return new Set([...vs].map((x: any) => x.toString()));
    }
  } catch { /* the viewer is not ready */ }
  return new Set();
}
/** Move on by itself once `count` new cells have joined the view (any cells:
 *  the Sandbox's cells are edited by players, so their IDs change). Stops
 *  when the learner leaves the step. As tutorial-1.ts advanceWhenSegmentAdded. */
function nextWhenCellsAdded(count: number) {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  setTimeout(() => {
    const base = visibleIds();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      const fresh = [...visibleIds()].filter(id => !base.has(id));
      fresh.forEach(colorNewCell);
      const added = fresh.length;
      if (added >= count) {
        clearInterval(timer);
        setTimeout(() => { if (here()) advance(); }, 1200);
      }
    }, 400);
  }, 1500);
}
/** Each cell the player adds gets its own color, so a new cell stands
 *  apart from the ones already in view (Ames 2026-10-18). */
const NEW_CELL_COLORS = [0xf5d142, 0x7cffb2, 0xb48cff, 0xff7aa8];
const colored = new Set<string>();
function colorNewCell(id: string) {
  if (colored.has(id)) return;
  try {
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      const map = ml.layer?.displayState?.segmentationColorGroupState?.value?.segmentStatedColors;
      if (!map) continue;
      const rgb = NEW_CELL_COLORS[colored.size % NEW_CELL_COLORS.length];
      // packed as 0xBBGGRR
      const packed = ((rgb >> 16) & 0xff) | (((rgb >> 8) & 0xff) << 8) | ((rgb & 0xff) << 16);
      setStatedColor(map, Uint64.parseString(id), packed);
      colored.add(id);
      return;
    }
  } catch { /* the layer is not ready */ }
}
/** Move on by itself once an annotation layer has been added. */
function nextWhenAnnotationLayerAdded() {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const count = () => ((window as any).viewer?.layerManager?.managedLayers ?? [])
    .filter((ml: any) => !ml.archived && (ml.layer?.constructor?.type ?? ml.layer?.type ?? ml.initialSpecification?.type) === 'annotation').length;
  setTimeout(() => {
    const base = count();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      if (count() > base) {
        clearInterval(timer);
        document.getElementById('nge-tutorial-highlight')?.remove();
        setTimeout(() => { if (here()) advance(); }, 1200);
      }
    }, 400);
  }, 1200);
}
/** Move on by itself once an annotation layer is called "Tutorial". */
function nextWhenRenamedTutorial() {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    const named = ((window as any).viewer?.layerManager?.managedLayers ?? [])
      .some((ml: any) => !ml.archived && /^tutorial$/i.test(String(ml.name || '').trim()));
    if (named) {
      clearInterval(timer);
      setTimeout(() => { if (here()) advance(); }, 1200);
    }
  }, 400);
}
/** The annotations in layers with these names, counted. */
function annotationsIn(names: RegExp): number {
  let n = 0;
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (ml.archived || !names.test(String(ml.name || ''))) continue;
    try { n += (ml.layer?.localAnnotations?.toJSON?.() ?? []).length; } catch { /* not an annotation layer */ }
  }
  return n;
}
/** Move on once something has been highlighted (src/util/highlight.ts layers). */
function nextWhenHighlighted() {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const marked = /^(Checked ✓|Needs a look|Problem)$/;
  const base = annotationsIn(marked);
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    if (annotationsIn(marked) > base) {
      clearInterval(timer);
      setTimeout(() => { if (here()) advance(); }, 1500);
    }
  }, 500);
}
/** The memo mission: each line of the checklist ticks itself off, and a point
 *  in the Top Secret layer is the find (Ames 2026-10-18: "detect your action,
 *  and something should happen when you find the missing branch"). */
function watchMission() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const SPOT = [82190, 58009, 381];
  const secret = /secret\s*hideout/i;
  const checks: Record<string, () => boolean> = {
    spot: () => {
      try {
        const p = (window as any).viewer.navigationState.position.value;
        return Math.abs(p[0] - SPOT[0]) < 2500 && Math.abs(p[1] - SPOT[1]) < 2500 && Math.abs(p[2] - SPOT[2]) < 150;
      } catch { return false; }
    },
    layer: () => ((window as any).viewer?.layerManager?.managedLayers ?? []).some((ml: any) => !ml.archived && secret.test(String(ml.name || ''))),
    layout: () => { try { const l = (window as any).viewer.layout.toJSON(); const name = typeof l === 'string' ? l : l?.type; return name !== '3d' && name !== 'xy' && name !== 'yz' && name !== 'xz'; } catch { return false; } },
    point: () => annotationsIn(secret) > 0,
  };
  const done = new Set<string>();
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    for (const [key, test] of Object.entries(checks)) {
      if (done.has(key) || !test()) continue;
      done.add(key);
      if (key === 'spot') zoomIn2D();
      document.querySelector(`.nge-tut-checklist [data-check="${key}"]`)?.classList.add('nge-tut-done');
    }
    if (done.has('point')) {
      clearInterval(timer);
      // Found it: the celebration and a word, and the player moves on when
      // ready (Ames 2026-10-19: "I don't like that this box auto-moves").
      document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate'));
      const list = document.querySelector('.nge-tut-checklist');
      if (list && !document.querySelector('.nge-tut-found')) {
        const p = document.createElement('p');
        p.className = 'nge-tut-found';
        p.textContent = 'Nice find! Press Next when you are ready.';
        list.after(p);
      }
    }
  }, 500);
}
/** Glow the Render tab's controls worth trying first (Ames 2026-10-18). */
function glowRenderControls() {
  // Kept on while the step shows: the Render tab may open after the box
  // does, and its rows are rebuilt when it does (Ames 2026-10-19: "not
  // highlighting").
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const lit = new Set<HTMLElement>();
  const timer = setInterval(() => {
    if (store.activeTutorial !== tutorial || store.getTutorialStep() !== step) {
      clearInterval(timer);
      lit.forEach(el => el.classList.remove('nge-tour-target'));
      return;
    }
    for (const name of ['Opacity (on)', 'Opacity (3d)', 'Silhouette (3d)']) {
      // The tagged element can be a wrapper with no box of its own: light the
      // row inside it (a glow on the wrapper drew a bar across the panel top).
      const tagged = document.querySelector<HTMLElement>(`.neuroglancer-layer-side-panel-tab-view [data-nge-control="${name}"]`);
      const row = tagged?.matches('.neuroglancer-layer-control-container') ? tagged : tagged?.querySelector<HTMLElement>('.neuroglancer-layer-control-container');
      if (!row || row.classList.contains('nge-tour-target')) continue;
      row.classList.add('nge-tour-target');
      lit.add(row);
    }
  }, 500);
}

export const steps: Step[] = [
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
You've merged and cut your first cells. Now let's take a deeper dive into the interface, in four short parts: marking what you see, working with cells, finding your way, and putting it together to find where a merger starts.`,
    image:
      imgWheresNurro,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
During this tutorial, you may make a mistake, accidentally delete something or become lost. 

You can step backwards in the tutorial to retry. If you are still lost, just keep going and we will restore the workspace within 1 or 2 slides.`,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
Let's start by marking what we see. Annotations are your notes on the cells: points, lines and boxes you place yourself.

They live in an ANNOTATION LAYER. <strong>CLICK the "+" to add one.</strong>`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div.neuroglancer-icon.neuroglancer-layer-add-button",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
    state:
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
    onEnter() {
      nextWhenAnnotationLayerAdded();
      // Highlight the + button with a pulsing glow so it's easy to find
      let style = document.getElementById('nge-tutorial-highlight');
      if (!style) { style = document.createElement('style'); style.id = 'nge-tutorial-highlight'; document.head.appendChild(style); }
      style.textContent = `
        .neuroglancer-layer-add-button {
          animation: nge-pulse-highlight 1.2s ease-in-out infinite !important;
          border-radius: 4px !important;
          position: relative;
          z-index: 1;
          /* Big enough to read as a plus (Nik took it for an airplane). */
          transform: scale(1.7);
          transform-origin: left center;
          margin-right: 18px !important;
          color: #fff !important;
          border-color: #7ee0ff !important;
          background: rgba(126, 224, 255, 0.22) !important;
        }
        @keyframes nge-pulse-highlight {
          0%, 100% { box-shadow: 0 0 8px 3px rgba(80, 160, 255, 0.7), inset 0 0 4px rgba(80, 160, 255, 0.3); }
          50% { box-shadow: 0 0 18px 6px rgba(80, 160, 255, 1), inset 0 0 8px rgba(80, 160, 255, 0.5); }
        }
      `;
    },
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
This is your new layer's side panel. Let's give the layer a name of its own.

<strong>Click the ✎ pencil next to the layer's name</strong> (or the name itself), type <strong>Tutorial</strong> and press Enter.`,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter() { ensureAnnotationLayer(); nextWhenRenamedTutorial(); },
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
The Pyr gem tool is already picked. <strong>CTRL+CLICK anywhere on the cell</strong> to drop a gem. Try placing a few!

Each gem is listed in the panel: click one there to add a note to it. Your gems stay with you for the rest of the tutorial. Press Next when you're ready to move on.`,
    position: OVER_3D,
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
This LAYER has a light running around its border: that means it is the one selected.`,
    position: {
      element: ".neuroglancer-layer-panel > .neuroglancer-layer-item[data-selected=\"true\"]",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
      state:
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/5077771186339840",
  },
  {
    part: "Part 2 of 4 · Working with cells",
    get text() { return `
<strong>${SELECT_CLICK()}</strong> on <strong>3D segmentation</strong> to select it instead.

If it worked, the light moves to its border!`; },
    onEnter: () => { markSegChip(); nextWhenSegSelected(); },
    position: {
      element: ".nge-tut-seg-chip",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    get text() { return `
Try both ways to HIDE and SHOW <strong>3D segmentation</strong>:

<ol class="nge-tut-steps">
<li><strong>${HIDE_CLICK()}</strong> on it to hide it, then again to show it.</li>
<li>Press its <strong>LAYER NUMBER</strong>, <strong>2</strong>, on your keyboard, twice.</li>
</ol>`; },
    onEnter: () => { markSegChip(); nextWhenSegHiddenAndShown(2); },
    position: {
      element: ".nge-tut-seg-chip",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Selecting a layer opens its SIDE PANEL: this is your control panel for that layer. For <strong>3D segmentation</strong>, it's where the cells live.

The glowing button at the right end of the top bar opens and closes it any time.`,
    onEnter: glowPanelButton,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Let's add more cells. The box at the top of the Segments tab takes cell IDs. Copy this one:

${copyButton('648518346356982336')}

<strong>Click the box, then press CTRL+V</strong>. The cell appears in 3D and in the list.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => { nextWhenCellsAdded(1); pointAtSegBox(); },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Good job! You added a second cell.

You can paste several IDs at once, separated by commas:

${copyButton('648518346352672169, 648518346356973888')}

<strong>Paste them into the same box.</strong>`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => { nextWhenCellsAdded(2); pointAtSegBox(); },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Great work! That's four pyramidal neurons now. Pyramidal neurons are the main excitatory neurons of the brain, and the cells Pyr is named after!

The box also takes coordinates: it adds whichever cell is at that spot. Copy these:

${copyButton('85624, 70674, 651')}

<strong>Paste them into the box too.</strong>`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => { showTwoPanels(); nextWhenCellsAdded(1); pointAtSegBox(); },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
That's the <strong>NUCLEUS</strong> of a cell! Here the nucleus is its own piece, apart from the rest of its cell.

To find the cell it belongs to, <strong>DOUBLE CLICK the EM just around the nucleus</strong> in the 2D view.`,
    width: "460px",
    position: OVER_3D,
    onEnter: () => { showTwoPanels(); nextWhenCellsAdded(1); },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Each cell in view has a row in the panel. Its buttons appear when you <strong>hover over the row</strong>, like this:

${FAKE_ROW}

<div class="nge-tut-legend">
<div><span class="nge-tut-key">${EYE_ICON}</span>shows or hides the cell</div>
<div><span class="nge-tut-key nge-tut-key--trash">${TRASH_ICON}</span>takes it out of view</div>
<div><span class="nge-tut-key">${COPY_ICON}</span>copies its ID</div>
<div><span class="nge-tut-key">↗</span>flies to the cell</div>
<div><span class="nge-tut-key">▲</span>marks it Proofread or gives it a cell type</div>
</div>

You can also make folders with <strong>+ Folder</strong> and drag and drop cell IDs into them to keep them organized.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-segment-list-entry",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    highlight: true,
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
<span class="nge-tut-tab">Render</span> is another important tab. Here you change how your cells look.

We've lit up a few worth trying: <strong>Opacity</strong> under 2D view, for how strongly the cell is colored over the image, and <strong>Opacity</strong> and <strong>Silhouette</strong> under 3D view. We've opened the 2D view so you can see both.

Try them! We'll restore the default view in the next slide.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        //"middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
    "middleauth+https://global.daf-apis.com/nglstate/api/v1/5352335057354752",
    onEnter: glowRenderControls,
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
Many elements in the interface have hover states with help text. Try hovering your mouse over some of the buttons or white text at the top of the screen. The help text may need a few seconds to load.

If you get confused in the future, hovering may help!`,
    image:
      imgNurroAtHome,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
Right now we are centered in the cell's soma. <strong>Press the "A" key</strong> to reveal the axis lines. 

These lines converge at the point we are centered on and represent the volume's x, y, and z dimensions.

<strong>Press "A" again</strong> to remove them. Many of our keyboard commands act as a toggle switch between SHOW and HIDE.`,
    width: "500px",
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    get text() { return `
A collaborator found a branch with a merger and wants us to look. First, <strong>hide our cell</strong>: click the eye next to its ID in the Segments panel.

Then copy this spot and <strong>paste it into the box at the top of the Segments panel</strong>. Pyr adds the cell there and jumps to it:

${copyButton(MERGER_SPOT)}`; },
    width: "460px",
    position: { element: SEG_BOX, side: "left", offset: { x: 0, y: 0 } },
    onEnter: () => { openSegmentsTab(); sparkleEye(); nextWhenCellsAdded(1); pointAtSegBox(); },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
This box always shows where you are. If you ever need to share your spot with a teammate, <strong>click its copy icon</strong> to copy it.`,
    width: "460px",
    position: { element: "#extensionBar .neuroglancer-position-widget", side: "right", offset: { x: 0, y: 0 } },
    highlight: true,
  },
  {
    part: "Part 3 of 4 · Find your way",
    get text() { return `
Now let's go back to our cell:

<ol class="nge-tut-steps">
<li>In the Segments panel, <strong>click the eye</strong> next to our cell to show it again.</li>
<li>Copy the soma's spot, then <strong>press CTRL+V anywhere in the viewer</strong> to jump there: ${copyButton(SOMA)}</li>
</ol>`; },
    width: "460px",
    position: OVER_3D,
    onEnter: () => { sparkleEye(); nextWhenAt(SOMA); },
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Now let's put it together. <strong>Find Path</strong> draws the route through a cell between two points.

<strong>Press F</strong>, then <strong>CTRL+CLICK on the soma</strong> and then <strong>anywhere down a branch</strong>, then press <span class="nge-tut-key-big">ENTER</span> to trace the path. (Points from before still there? Click <strong>Clear</strong> in the Find Path bar first.) (or click <strong>Submit</strong> in the Find Path bar at the bottom).

We've made the cell see through, so the path stands out.`,
    width: "500px",
    position: OVER_3D,
    onEnter: findPathStep,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
That's how you find where a merger starts. When a branch looks wrong, put one point on the soma and one on the wrong branch, and Find Path shows exactly where the wrong piece joins the cell. That join is where you cut.

If you are scouting mergers, you can then tag the spot with the glowing <strong>Tag</strong> tool on the top bar, so you or a teammate can find it again.`,
    width: "500px",
    position: { element: '#extensionBar [data-icon-id="tags"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
One more tool for keeping track: <strong>Highlight</strong> marks the parts of a cell you have already checked, so you never look twice.

<strong>Press SHIFT+H</strong> (or the glowing Highlight button on the top bar), pick <strong>Checked</strong> (pink in this tutorial), then <strong>CTRL+CLICK two points along a branch</strong>. The branch between them lights up.`,
    width: "500px",
    position: { element: '#extensionBar [data-icon-id="highlight"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
    onEnter: () => { pinkHighlights(); nextWhenHighlighted(); },
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Now pick a <strong>different color</strong> in the Highlight box (<strong>Needs a look</strong>, or make your own with <strong>+ Add</strong>), then <strong>CTRL+CLICK two points</strong> along another branch.`,
    width: "500px",
    position: OVER_3D,
    onEnter: () => nextWhenOtherHighlight(),
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
For a big cell, <strong>Lantern</strong> lights the part around where you are and dims the rest, so you can check it one part at a time.

<strong>Press SHIFT+N</strong> (or the glowing lantern on the top bar) to light it.`,
    width: "500px",
    position: { element: '#extensionBar [data-icon-id="lantern"]', side: "bottom", offset: { x: 0, y: 70 } },
    highlight: true,
    onEnter: () => nextWhenLanternOn(),
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
<strong>RIGHT-CLICK</strong> anywhere on the cell to move there: the light follows you. In the Lantern box, <strong>Size</strong> sets how much of the cell is lit and <strong>Flame</strong> how bright.

<strong>Close Lantern</strong> when you want the whole cell back: the ✕ in its box, or SHIFT+N again.`,
    width: "500px",
    // Below the Lantern bar, which sits along the top (a player found it
    // covering this box, 2026-10-20).
    position: { ...OVER_3D, y: 0.3 },
    onEnter: () => { if (!lantern.on) lantern.on = true; nextWhenLanternOn(false); },
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Oh great, I finally found that very important memo from our collaborators! It was buried in a different pile of papers along with some suspicious looking cat hair and a file called "KITTY WORLD DOMINATION TOP SECRET." I wonder what that could mean 🤔.

Can you help out with this final task? Each line ticks itself off as you do it:

<ol class="nge-tut-checklist">
<li data-check="spot">Go to this location: ${copyButton('82190, 58009, 381')}&nbsp;${hint('Copy it, then press CTRL+V anywhere in the viewer. The coordinates box shows where you are', '#extensionBar .neuroglancer-position-widget')}</li>
<li data-check="layer">Add a new annotation layer and name it <strong>Secret Hideout</strong>&nbsp;${hint('The + at the end of the layer bar adds one. Then click the ✎ pencil to name it', '.neuroglancer-layer-add-button, .nge-title-rename')}</li>
<li data-check="layout">Open the 2 panel view (2D + 3D)&nbsp;${hint('Press SPACE')}</li>
<li data-check="point">There is a merger here! CTRL+CLICK to place annotation points around where the merger starts&nbsp;${hint('Scroll the mouse wheel over the 2D view to move through the slices. Find Path from the soma to the odd branch shows where it joins')}</li>
</ol>`,
    position: OVER_3D,
    state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/4777677526401024",
    onEnter() {
      openSegmentsTab(); watchMission();
      // The axis lines mark the spot to search around (Ames 2026-10-19).
      setTimeout(() => { try { (window as any).viewer.showAxisLines.value = true; } catch { /* no viewer */ } }, 1500);
    },
  },
  // The "add a description and tag" step and its video are out until the
  // video is redone (Ames 2026-10-19: the video is out of date). Video:
  // https://www.youtube.com/watch?v=vnAqH91EgNQ (playlist index 6).
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Thank you! Nurro will investigate that merger right away.`,
    image:
      imgWheresNurro,
    width: "400px",
    position: MIDDLE,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Stuck, or found something odd? <strong>Chat</strong> is where the Pyr community helps each other. Ask a question, share your view, or just say hi: the community is the best place for help and for working together.`,
    width: "460px",
    position: { element: '#extensionBar [data-icon-id="chat"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
That's a high level view of the interface! Next: put it to work in the <strong>Merger Sandbox</strong>. Seven cells, each with a merger to find and cut.

<button class="nge-hud-btn nge-hud-btn--go" onclick="document.dispatchEvent(new CustomEvent('nge:sandbox-next'))">Start the Merger Sandbox</button>

When you are ready to edit real cells, choose <strong>Ask for Edit Access</strong> in the <span class="nge-tut-burger">${RESOURCES_MENU_SVG}</span> hamburger menu (chomp it up!). <a href="https://connectome.quest/blog/post.html?p=how-to-unlock-edit-access-in-pyr" target="_blank" rel="noopener">How access works ↗</a>

Thanks for being a part of the neuroscience community! For Science!`,
    position: MIDDLE,
    image:
      imgTutorialFinal,
  },
];
