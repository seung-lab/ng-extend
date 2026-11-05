import { Step, useTutorialStore } from "./store-pyr";
import { ngePointScale } from "neuroglancer/annotation/point";
import { defaultCredentialsManager } from "neuroglancer/credentials_provider/default_manager";
import { responseJson } from "neuroglancer/util/http_request";
import { cancellableFetchSpecialOk, parseSpecialUrl } from "neuroglancer/util/special_protocol_request";
// The saved views name this neuron by its OLD root ids on purpose: they
// still show it as it was before the continuation was merged in (March
// 2026) and edited since. Swapping in its current id showed that merge
// (Ames, 2026-09-30), so the ids stay as they are.
import imgMainBanner from './images/main-banner-vF.jpg';
import imgSegmentation from './images/segmentation-tutorial.jpg';
import imgSynapseWide from './images/synapse-wide.png';
import imgSandboxExplosion from './images/sandbox-explosion.jpg';
import imgInspectorNurro from './images/inspector-nurro-2.png';
import imgNurroSuccessTiny from './images/nurro-success-tutorial-tiny.png';
import imgBravoNurro from './images/bravo-nurro.png';
import imgTutorialFinal from './images/ng-tutorial-final-image.png';

/* eslint-disable @typescript-eslint/no-explicit-any */
function getViewer(): any {
  return (window as any)['viewer'];
}

/** Set annotation color on all annotation layers */
function setAnnotationColor(color: string) {
  const viewer = getViewer();
  if (!viewer) return;
  const layers = viewer.layerManager && viewer.layerManager.managedLayers;
  if (!layers) return;
  for (const ml of layers) {
    // The class's static type: class names are renamed in production.
    if ((ml.layer?.constructor as any)?.type === 'annotation') {
      try { ml.layer.annotationColor.value = color; } catch (e) { /* */ }
    }
  }
}

/**
 * Bigger annotation points while a step that asks the learner to find one is
 * up (Ames, 2026-10-02: the yellow hint was two tiny dots). Uses the same
 * local multiplier as Settings' "Annotation point size", never below the
 * learner's own, and puts theirs back when the step is left.
 */
const TUTORIAL_POINT_SCALE = 3;
let pointScaleTimer: ReturnType<typeof setInterval> | null = null;
function bigPoints() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const redraw = () => { try { getViewer()?.display?.scheduleRedraw(); } catch { /* no viewer */ } };
  if (pointScaleTimer) clearInterval(pointScaleTimer);
  else bigPoints.before = ngePointScale.value;
  ngePointScale.value = Math.max(bigPoints.before, TUTORIAL_POINT_SCALE);
  redraw();
  pointScaleTimer = setInterval(() => {
    if (store.activeTutorial === tutorial && store.getTutorialStep() === step) return;
    clearInterval(pointScaleTimer!);
    pointScaleTimer = null;
    ngePointScale.value = bigPoints.before;
    redraw();
  }, 300);
}
bigPoints.before = 1;

/**
 * Leave one annotation on screen: the one the lesson is about. The saved
 * views carry two (reviewer, 2026-10-06), and two yellow dots read as two
 * things to find. `targetState` is the view that zooms in on the right one;
 * the annotation nearest its centre is kept and the rest are removed from
 * this session's copy of the view (the saved view is not changed).
 */
async function keepOneAnnotation(targetState: string) {
  try {
    const { url, credentialsProvider } = parseSpecialUrl(targetState, defaultCredentialsManager);
    const state: any = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);
    const c: number[] = (state?.position ?? state?.navigation?.pose?.position?.voxelCoordinates ?? []).map(Number);
    if (c.length < 3) return;
    await new Promise(r => setTimeout(r, 1500)); // the step's own view has to finish loading
    const found: Array<{ src: any; id: string; d: number }> = [];
    for (const ml of getViewer()?.layerManager?.managedLayers ?? []) {
      if ((ml.layer?.constructor as any)?.type !== 'annotation') continue;
      const src = ml.layer.localAnnotations;
      if (!src) continue;
      for (const a of src) {
        const p = (a as any).point;
        if (!p || p.length < 3) {
          // Not a point (an ellipsoid drew a flat yellow blob over the
          // branch end, Ames 2026-10-24): it goes.
          const ref = src.getReference((a as any).id);
          try { src.delete(ref); } finally { ref.dispose(); }
          continue;
        }
        found.push({ src, id: (a as any).id, d: Math.hypot((p[0] - c[0]) * 4, (p[1] - c[1]) * 4, (p[2] - c[2]) * 40) });
      }
    }
    if (found.length < 2) return;
    found.sort((x, y) => x.d - y.d);
    for (const f of found.slice(1)) {
      const ref = f.src.getReference(f.id);
      try { f.src.delete(ref); } finally { ref.dispose(); }
    }
  } catch (e) {
    console.warn('[tutorial] could not thin the annotations:', e);
  }
}
const STATE_AT_ANNOTATION = 'middleauth+https://global.daf-apis.com/nglstate/api/v1/6606861248757760';

/**
 * A small mouse with one part lit, like the Eyewire 1 instructions (Ames,
 * 2026-10-24: some players are not sure what right-click means). Sits at the
 * left of the line it explains.
 */
function mouse(part: 'left' | 'right' | 'wheel'): string {
  const lit = '#e8eef5', line = '#aeb9c7';
  const left = part === 'left' ? `<path d="M20 4 A16 16 0 0 0 4 20 L4 22 L20 22 Z" fill="${lit}"/>` : '';
  const right = part === 'right' ? `<path d="M20 4 A16 16 0 0 1 36 20 L36 22 L20 22 Z" fill="${lit}"/>` : '';
  const wheel = `<rect x="17.5" y="8" width="5" height="10" rx="2.5" fill="${part === 'wheel' ? lit : 'none'}" stroke="${line}" stroke-width="1.4"/>`;
  return `<span class="nge-tut-mouse" aria-hidden="true"><svg viewBox="0 0 40 56" width="30" height="42">${left}${right}`
    + `<rect x="4" y="4" width="32" height="48" rx="16" fill="none" stroke="${line}" stroke-width="1.4"/>`
    + `<line x1="4" y1="22" x2="36" y2="22" stroke="${line}" stroke-width="1.4"/><line x1="20" y1="4" x2="20" y2="22" stroke="${line}" stroke-width="1.4"/>${wheel}</svg></span>`;
}

/** Remove annotation points from this session's copy of the view (the saved
 *  view is not changed). Used where a view carries points the step does not
 *  need: two near-identical ones read as one doubled dot. */
async function dropPoints(match: (p: number[]) => boolean) {
  await new Promise(r => setTimeout(r, 1500)); // the step's own view has to finish loading
  try {
    for (const ml of getViewer()?.layerManager?.managedLayers ?? []) {
      if ((ml.layer?.constructor as any)?.type !== 'annotation') continue;
      const src = ml.layer.localAnnotations;
      if (!src) continue;
      const gone: string[] = [];
      for (const a of src) { const pt = (a as any).point; if (pt && pt.length >= 3 && match([...pt].map(Number))) gone.push((a as any).id); }
      for (const id of gone) { const ref = src.getReference(id); try { src.delete(ref); } finally { ref.dispose(); } }
    }
  } catch (e) { console.warn('[tutorial] could not drop the extra points:', e); }
}
/** The pair of points at the end of the cut branch (z 545 and 546): on the
 *  steps about the continuation they doubled up on screen (Ames, 2026-10-24). */
const AT_DEFECT_END = (p: number[]) => Math.abs(p[2] - 545.5) < 1.6 && Math.abs(p[0] - 65634) < 40 && Math.abs(p[1] - 49706) < 40;

/** The 2D EM tab pulses while a step asks for it (Ames, 2026-10-24: "2D EM
 *  tab at the top" meant nothing until you could see it). */
let tabPulse: ReturnType<typeof setInterval> | null = null;
function tut1Style() {
  if (!document.getElementById('nge-tut1-style')) {
    const st = document.createElement('style');
    st.id = 'nge-tut1-style';
    st.textContent = `
      .nge-tut-pulse-tab { animation: nge-tut-tab 1.2s ease-in-out infinite !important; border-radius: 4px; }
      @keyframes nge-tut-tab { 0%, 100% { box-shadow: 0 0 0 0 rgba(126, 224, 255, 0); } 50% { box-shadow: 0 0 0 3px rgba(126, 224, 255, 0.85), 0 0 14px rgba(126, 224, 255, 0.6); } }
      .nge-tut-mouse { float: left; margin: 2px 12px 4px 0; line-height: 0; }`;
    document.head.appendChild(st);
  }
}
// At load: the mouse pictures need it from the first box that shows one.
tut1Style();
function pulse2DTab() {
  tut1Style();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  if (tabPulse) clearInterval(tabPulse);
  tabPulse = setInterval(() => {
    const tab = [...document.querySelectorAll('.neuroglancer-layer-item')].find(el => /2D EM|\bimg\b/i.test((el as HTMLElement).querySelector('[data-nge-label]')?.getAttribute('data-nge-label') ?? (el as HTMLElement).textContent ?? '')) as HTMLElement | undefined;
    const here = store.activeTutorial === tutorial && store.getTutorialStep() === step;
    document.querySelectorAll('.nge-tut-pulse-tab').forEach(el => { if (!here || el !== tab) el.classList.remove('nge-tut-pulse-tab'); });
    if (!here) { clearInterval(tabPulse!); tabPulse = null; return; }
    tab?.classList.add('nge-tut-pulse-tab');
  }, 400);
}

/**
 * No merging or cutting during Get Started (Ames, 2026-10-24): the lesson's
 * neuron is shared, and a merge on it breaks the steps for everyone after.
 * M, C and the Merge and Cut buttons do nothing while a Get Started box is up,
 * and the box says why. The Merge tutorial is where editing starts.
 */
function getStartedUp(): boolean {
  return useTutorialStore().activeTutorial === 1 && !!document.querySelector('.introductionStepAnchor');
}
function lockedNote() {
  const chip = document.querySelector('.introductionStepAnchor .chip .html') as HTMLElement | null;
  if (!chip || chip.querySelector('.nge-tut-locked')) return;
  const note = document.createElement('p');
  note.className = 'nge-hud-note nge-tut-locked';
  note.textContent = 'Editing tools are off during Get Started, so the lesson stays the same for everyone. You will merge for real in the Merge tutorial, next.';
  chip.appendChild(note);
  setTimeout(() => note.remove(), 6000);
}
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || !getStartedUp()) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key !== 'm' && e.key !== 'M' && e.key !== 'c' && e.key !== 'C') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  lockedNote();
}, true);
document.addEventListener('click', (e) => {
  if (!getStartedUp()) return;
  const icon = (e.target as HTMLElement | null)?.closest?.('[data-icon-id="merge"], [data-icon-id="split"]');
  if (!icon) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  lockedNote();
}, true);

/** Remove a segment from the first segmentation layer.
 *  The visible set lives in segmentationGroupState in this neuroglancer;
 *  the older `rootSegments` is kept as a fallback (it was the only path
 *  before, and it does not exist here, so these removals never happened). */
function removeSegment(segId: string) {
  const viewer = getViewer();
  if (!viewer) return;
  const layers = viewer.layerManager && viewer.layerManager.managedLayers;
  if (!layers) return;
  for (const ml of layers) {
    const layer = ml.layer;
    if ((layer?.constructor as any)?.type === 'segmentation') {
      const rootSegs = layer.displayState?.segmentationGroupState?.value?.visibleSegments
        ?? layer.displayState?.rootSegments;
      if (rootSegs) {
        for (const seg of rootSegs) {
          if (seg.toString() === segId) {
            rootSegs.delete(seg);
            return;
          }
        }
      }
    }
  }
}

/** The visible root ids of the first segmentation layer. */
function visibleSegmentIds(): Set<string> | null {
  const layers = getViewer()?.layerManager?.managedLayers;
  if (!layers) return null;
  for (const ml of layers) {
    const vs = ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (vs) return new Set([...vs].map((s: any) => s.toString()));
  }
  return null;
}

/** Step 17: when the learner double clicks the continuation in 2D, a new
 *  segment joins the visible set; go straight to the reveal (Ames,
 *  2026-09-29). Stops once the learner leaves this step. */
function advanceWhenSegmentAdded() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  let base: Set<string> | null = null;
  // Let the step's view finish loading before taking the baseline.
  setTimeout(() => {
    base = visibleSegmentIds();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      const now = visibleSegmentIds();
      if (!base) { base = now; return; }
      if (now && [...now].some(id => !base!.has(id))) {
        clearInterval(timer);
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
      }
    }, 400);
  }, 2500);
}

/** Move on once the view goes from 3D only to split screen, whichever way:
 *  SPACE, or a click on the 2D EM tab (Ames 2026-10-22: the tab now shows
 *  and hides the 2D view). SPACE already moves on by itself (spaceAdvances). */
function advanceWhenSplit() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const layout = () => { try { const j = getViewer()?.layout?.toJSON?.(); return typeof j === 'string' ? j : (j?.type ?? ''); } catch { return ''; } };
  // Let the step's own view load first (it opens in 3D only).
  setTimeout(() => {
    let was = layout();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      const now = layout();
      if (was === '3d' && now !== '3d' && now) {
        clearInterval(timer);
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 600);
      }
      was = now;
    }, 300);
  }, 2000);
}

/** Close the viewer's side panels through neuroglancer's own state, so they
 *  can be reopened normally. (These steps used to set display:none on every
 *  side panel element, which left the panels unopenable until a reload.) */
function closeSidePanels() {
  const viewer = getViewer();
  if (!viewer) return;
  try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
  for (const panel of [viewer.layerListPanelState, viewer.selectionDetailsState,
                       viewer.helpPanelState, viewer.settingsPanelState]) {
    try { panel.location.visible = false; } catch (e) { /* */ }
  }
}

const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};

const OVER_2D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.25,
  y: 0.15,
};

const OVER_3D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.75,
  y: 0.15,
};

// Step 16 view, from Ames (2026-09-29): the cell with the dendrite the
// defect disconnected, and no purple branch yet. Inline, not a state-server
// link, so it needs no fetch.
const STATE_DEFECT_VIEW = {
  "dimensions": {
    "x": [
      4e-09,
      "m"
    ],
    "y": [
      4e-09,
      "m"
    ],
    "z": [
      4e-08,
      "m"
    ]
  },
  "position": [
    77603.1875,
    59828.70703125,
    426.684326171875
  ],
  "crossSectionScale": 13.46721884640639,
  "projectionOrientation": [
    -0.003505238564684987,
    -0.9830650687217712,
    -0.12847700715065002,
    -0.13063110411167145
  ],
  "projectionScale": 48392.34998080223,
  "layers": [
    {
      "type": "image",
      "source": "precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em",
      "tab": "annotations",
      "shader": "#uicontrol float black slider(min=0, max=1, default=0.0)\n#uicontrol float white slider(min=0, max=1, default=1.0)\nfloat rescale(float value) {\n  return (value - black) / (white - black);\n}\nvoid main() {\n  float val = toNormalized(getDataValue());\n  if (val < black) {\n    emitRGB(vec3(0,0,0));\n  } else if (val > white) {\n    emitRGB(vec3(1.0, 1.0, 1.0));\n  } else {\n    emitGrayscale(rescale(val));\n  }\n}\n",
      "shaderControls": {
        "black": 0.29
      },
      "name": "img"
    },
    {
      "type": "segmentation",
      "source": "graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_training6",
      "tab": "segments",
      "selectedAlpha": 0.3,
      "segments": [
        "!648518346354708544",
        "!648518346355322263",
        "!648518346353084129",
        "!648518346356789312",
        "648518346353862024"
      ],
      "segmentColors": {
        "648518346353862024": "#2ec0ff"
      },
      "name": "pinky_training6"
    }
  ],
  "showAxisLines": false,
  "showSlices": false,
  "gpuMemoryLimit": 2000000000,
  "systemMemoryLimit": 3000000000,
  "selectedLayer": {
    "layer": "pinky_training6"
  },
  "layout": "3d",
  "selection": {}
};

export const steps: Step[] = [
 // {
 //   html: `<iframe style="margin-bottom: -4px;" width='640' height='360'
 //       src="https://www.youtube.com/embed/tnoIdea7Wmo?si=xiJSTIQyr_Q5XDo3"
 //       frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
 //   position: MIDDLE,
 //   modal: true,
 //   state:
 //     "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
 // },
  //1 -- full screen 3D - button option to skip to keyboard commands - state middleauth+https://global.daf-apis.com/nglstate/api/v1/6173054938906624
  {
    title: `Welcome to Pyr!`,
    text: `
Pyr is a global community of researchers, citizen scientists, and engineers working to map the brain.

Together, we're exploring uncharted neural territory and transforming neuroscience. Join us!`,
    image:
      imgMainBanner,
    position: MIDDLE,
    width: "1000px",
    state: 
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4594033348313088",
  },
  //2 + image 2
  {
    text: `
A connectomics dataset starts with a brain! It is imaged at nanoscale and reconstructed in 3D using a mix of AI and human insight.

The map of every neuron and its connections is called a connectome. Learn more with <a href="https://connectome.quest/atlas/" target="_blank" rel="noopener">Connectome 101</a>.`,
    position: MIDDLE,
    image:
      imgSegmentation,
    width: "500px"
  },
  //4
  {
    text: `
Although AI reconstructions are impressive, there are still many mistakes. That's why we need YOU!

The flexibility and big-picture thinking of the human mind enables humans to solve problems when the AI gets stuck. Ready to get started?`,
    position: MIDDLE,
    image:
      imgSynapseWide,
    width: "500px",
    nextLabel: "Let's go!",
  },
  //5 -- this is the box that #1 jumps to if user clicks to skip to commands
  {
    text: `
Welcome to the Sandbox! This is a place to play and get acquainted with neurons and the software used to map them. The cell behind this box is a pyramidal neuron from mouse visual cortex.

**This is a spare copy of the data, made for learning. Nothing you do here can hurt the real data, so explore freely!**`,
    position: MIDDLE,
    image:
      imgSandboxExplosion,
    width: "500px",
    state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/5789745012539392",
    nextLabel: "ONWARD!",
  },
  //6 - gif reuse 3D click+ drag
  {
    text: `
This is a 3D neuron that has been mapped by AI.

${mouse('left')}**CLICK + DRAG** to rotate it.

This box won't go away when you click outside it.`,
    position: OVER_3D,
  },
  //7 - zoom in 3D: SCROLL
  {
    text: `${mouse('wheel')}**SCROLL** to zoom in and out.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
    onEnter: () => {
      const viewer = getViewer();
      if (!viewer) return;
      // Close side panel so segment list isn't visible
      try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
      // Remove the annotations layer entirely
      setTimeout(() => {
        const layers = viewer.layerManager && viewer.layerManager.managedLayers;
        if (layers) {
          for (let i = layers.length - 1; i >= 0; i--) {
            // The class's static type: class names are renamed in production.
            if ((layers[i].layer?.constructor as any)?.type === 'annotation') {
              layers[i].setVisible(false);
              try { viewer.layerManager.removeManagedLayer(layers[i]); } catch (e) { /* */ }
            }
          }
        }
        // Remove extra segments, keep only 648518346353862024
        removeSegment('648518346353084129');
        removeSegment('648518346354708544');
        removeSegment('648518346355322263');
        removeSegment('648518346356789312');
      }, 1500);
    },
  },
  //8a - right click
  {
    text: `${mouse('right')}**RIGHT-CLICK** on the neuron to re-center your view.

**RIGHT-DRAG** to slide the view around.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5527767895506944",
    onEnter: () => {
      const viewer = getViewer();
      if (!viewer) return;
      // Turn on axis lines (keyboard shortcut A)
      viewer.showAxisLines.value = true;
      // Close the side panel / deselect layer to remove annotation tab
      try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
      try { viewer.selectedLayer.layer = null; } catch (e) { /* */ }
      // Also try closing after a delay in case state load re-opens it
      setTimeout(() => {
        try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
        try { viewer.selectedLayer.layer = null; } catch (e) { /* */ }
      }, 1000);
    },
  },
  //8b - find annotation
  {
    text: `**See if you can find a yellow annotation at the end of one of the branches and zoom in on it.**

Don't worry if you can't find it - the Next button will take you there.`,
    position: OVER_3D,
    image:
      imgInspectorNurro,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5527767895506944",
    onEnter: () => { setAnnotationColor('#edd040'); bigPoints(); keepOneAnnotation(STATE_AT_ANNOTATION); },
  },
  //9 - new NG state middleauth+https://global.daf-apis.com/nglstate/api/v1/4893758698029056
  {
    text: `There it is! This flat edge reveals a mistake by the AI.

It missed a branch. Let's see if we can find it.`,

    position: OVER_3D,
    image:
      imgNurroSuccessTiny,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6606861248757760",
    width: "200px",
    onEnter: () => { setAnnotationColor('#edd040'); bigPoints(); keepOneAnnotation(STATE_AT_ANNOTATION); },
  },
  //11 - this tries to get user to bring up split screen - we need to default to split vs 4 panel view. otherwise need to add anoter box to get them to split view - ng link middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288

  {
    text: `Press **SPACE** to bring up a split screen view: the electron microscope images these neurons were reconstructed from.

You can also click the **2D EM** tab, glowing at the top left.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6606861248757760",
    spaceAdvances: true,
    onEnter: () => { advanceWhenSplit(); pulse2DTab(); },
  },
  //12 - over 2D - EM cross section view
  {
    text: `This is an electron microscope (EM) image of the brain. A stack of such images creates a 3D volume. The neuron branch is visible in the cross section.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },
  // (The "if you end up in 4 panel view" tip lived here. The app no longer
  // offers a 4 panel view, see no_four_panel.ts, so the step is gone.)
  //13 - gif
  {
    text: `Press **COMMA** and **PERIOD**, or **Q** and **W**, to step through the EM slices. You can also hover your mouse over the EM and **SCROLL** through the images.

Don't worry if you lose the neuron. The Next button in this section resets this view.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },
  //14 - 2D control + scroll gif
  {
    text: `${mouse('wheel')}Hold your cursor over the black and white EM and press **CTRL + SCROLL** to zoom in and out.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },
  //15 - 2D right click center gif
  {
    text: `${mouse('right')}**RIGHT-CLICK** to recenter.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },

  //17 - position center of page - ensure location is  middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288
  {
    text: `The big black empty space is an imaging defect, which happens occasionally when you are snapping at the nanoscale. It caused the AI to make a mistake and disconnect a dendrite.`,
    // Split screen, so the black void shows in the EM images on the left
    // (reviewer, 2026-10-06); the box sits over the 3D side.
    position: OVER_3D,
    state: { ...STATE_DEFECT_VIEW, layout: 'xy-3d' },
    onEnter: () => {
      // Belt and braces: the purple branch must not show on this step.
      setTimeout(() => removeSegment('648518346356484078'), 1500);
    },
  },
  //18 -  middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408
  {
    text: `To fix it, we need to scroll past the defect and find where the branch continues.

This is a tutorial so we dropped a hint. Hit the comma key a few times until you get to an image past the black spill that does not have the cell colored in. There is an annotation point in the continuation segment. See what happens when you double click in 2D.

Hit next to reveal the answer.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5250067188416512",
    // Normal size points (3x read as excessive here) and not the pair at the
    // branch end, which showed as one doubled dot (Ames, 2026-10-24).
    onEnter: () => { advanceWhenSegmentAdded(); void dropPoints(AT_DEFECT_END); },
  },
  //20 - Nurro swoop! - new NG state with extension added middleauth+https://global.daf-apis.com/nglstate/api/v1/5190220459802624
  {
    text: `Bravo! We found the continuation!`,
    position: {
      element: "body",
      x: 0.5,
      y: 0.12,
    },
    floatingImage:
      imgBravoNurro,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5114308439572480",
    onEnter: () => { void dropPoints(AT_DEFECT_END); },
  },
  {
    text: `Check out this top right menu for guides, tutorials, and more resources.`,
    position: {
      element: "#hamburger > button",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => {
      // The state load can reopen a panel, so close again once it settles.
      closeSidePanels();
      setTimeout(closeSidePanels, 300);
      setTimeout(closeSidePanels, 1000);

      // Fun hamburger emoji animation on the menu button
      setTimeout(() => {
        const btn = document.querySelector('#hamburger > button') as HTMLElement;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();

        // Create emoji overlay
        const emoji = document.createElement('div');
        emoji.textContent = '\u{1F354}';
        emoji.style.cssText = [
          'position: fixed',
          'z-index: 10000',
          'font-size: 28px',
          'pointer-events: none',
          'left: ' + (rect.left + rect.width / 2) + 'px',
          'top: ' + (rect.top + rect.height / 2) + 'px',
          'transform: translate(-50%, -50%) scale(0)',
          'transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
          'opacity: 1',
          'filter: drop-shadow(0 0 8px rgba(255, 180, 50, 0.6))',
        ].join(';');
        document.body.appendChild(emoji);

        // Animate in: scale up with bounce
        requestAnimationFrame(() => {
          emoji.style.transform = 'translate(-50%, -50%) scale(1.8)';
        });

        // Wiggle
        setTimeout(() => {
          emoji.style.transition = 'transform 0.15s ease-in-out';
          emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(12deg)';
          setTimeout(() => {
            emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(-10deg)';
            setTimeout(() => {
              emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(6deg)';
              setTimeout(() => {
                emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(0deg)';
              }, 150);
            }, 150);
          }, 150);
        }, 500);

        // Fade out
        setTimeout(() => {
          emoji.style.transition = 'transform 0.5s ease-in, opacity 0.5s ease-in';
          emoji.style.transform = 'translate(-50%, -50%) scale(0.5)';
          emoji.style.opacity = '0';
          setTimeout(() => emoji.remove(), 600);
        }, 1600);
      }, 800);
    },
  },
  {
    // Links open a new tab, so the learner is not taken away from the app.
    title: `You've finished Get Started!`,
    text: `<span class="nge-done-lead">Now you know the basics. Ready to fix your first mistake?</span>

The **Merge** tutorial walks you through joining a branch the AI cut off, on a cell in the Sandbox. It is a real edit, made by you.

Questions? Email <a href="mailto:support@eyewire.ai">support@eyewire.ai</a>.

Thanks for being a part of the neuroscience community. For Science!`,
    // The button finishes Get Started (its Achievement counts) and Merge
    // starts by itself (toolbar_staging getStartedFinished). Ames 2026-10-21:
    // "there should be a button to start Merge".
    nextLabel: 'Start Merge',
    position: MIDDLE,
    image:
      imgTutorialFinal,
    width: "600px",
    onEnter: closeSidePanels,
  },
];
