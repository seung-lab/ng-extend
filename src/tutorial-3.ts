import { Step } from "./store-pyr";
import imgSynapsesTutorial from './images/synapses-tutorial.jpg';
import imgBravoNurro from './images/bravo-nurro.png';
// Amy's merge example, 2026-09-26: the cut-in-half branch, cell purple, loose piece yellow.
import imgMergeExample from './images/merge-example.jpg';
import { beginPractice, colorFirstTwoVisible, currentPractice, endPractice, ensureTool, joinWaitlist, leaveWaitlist, piecesMerged, placeMergeLine, type PracticeKind } from './practice';
import { useLayersStore } from './store';
import { useTutorialStore } from './store-pyr';
import { hidePyrMarkers, showPyrMarkers } from './markers';
import { defaultCredentialsManager } from 'neuroglancer/credentials_provider/default_manager';
import { responseJson } from 'neuroglancer/util/http_request';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'neuroglancer/util/special_protocol_request';

/**
 * Tutorial 3: Merge.
 * The cut half moved to tutorial-cut.ts (tutorial 5) on 2026-09-27, Amy:
 * one tool per tutorial, with the merge tutorial ending in an invitation to
 * the cut one. The helpers below are shared by both.
 */

// Amy's merge example, 2026-09-26: a branch she cut in half in the sandbox
// (648518346350730372 and 648518346351348401). Shown when no practice cell
// can be claimed, so the merge steps always have something to point at.
const STATE_MERGE_EXAMPLE = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5718864172154880';
// Amy's saved view with point annotations at the two spots to Ctrl+click for
// that merge (2026-09-28). Only its points are read; the tutorial draws Pyr
// pins there instead of loading the annotation layer.
const STATE_MERGE_HINTS = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5751472100737024';

/** Point annotations in a saved state, as global voxel coordinates. */
async function pointsInState(stateUrl: string): Promise<number[][]> {
  try {
    const { url, credentialsProvider } = parseSpecialUrl(stateUrl, defaultCredentialsManager);
    const state: any = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);
    const out: number[][] = [];
    // Layers are an array in current states and a name-keyed object in old ones.
    const layers: any[] = Array.isArray(state?.layers) ? state.layers : Object.values(state?.layers ?? {});
    for (const layer of layers) {
      if (layer?.type !== 'annotation') continue;
      for (const a of layer.annotations ?? []) {
        const pt = a?.point ?? (a?.type === undefined && Array.isArray(a) ? a : null);
        if ((a?.type === 'point' || a?.type === undefined) && Array.isArray(pt)) out.push(pt.slice(0, 3).map(Number));
      }
    }
    console.info(`[tutorial] hint state: ${layers.length} layers, ${layers.filter(l => l?.type === 'annotation').length} annotation layers, ${out.length} points`);
    return out;
  } catch (e) {
    console.warn('[tutorial] could not read hint points:', e);
    return [];
  }
}

/** Pyr pins at the click spots: the example's registered points if it has
 *  them, else Amy's hint state for the built-in merge example. */
async function showWhereToClick(): Promise<boolean> {
  const ex = currentPractice().example;
  let pts: number[][] = [];
  if (ex?.point_a && ex?.point_b) {
    try { pts = [JSON.parse(ex.point_a), JSON.parse(ex.point_b)]; } catch { pts = []; }
  }
  if (!pts.length) pts = await pointsInState(STATE_MERGE_HINTS);
  return showPyrMarkers(pts, ['Ctrl+click', 'Ctrl+click'], 60);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getViewer(): any {
  return (window as any)['viewer'];
}

/** Close the side panel if open */
export function closeSidePanel() {
  const viewer = getViewer();
  if (!viewer) return;
  try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
}

// ─── Practice cell wiring (src/practice.ts) ────────────────────────────────
// One sandbox example per user at a time. The status line under the step
// text is the only live part of the tutorial: it says whether the example
// loaded, and flips when the viewer confirms the merge or the cut landed.

let practiceWatch = 0;

function chipBody(): Element | null {
  return document.querySelector('.introductionStepAnchor .chip .html');
}

function smallButton(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.style.cssText = 'margin:8px 8px 0 0;padding:5px 10px;border-radius:4px;font:inherit;font-size:0.85em;cursor:pointer;'
    + 'background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.4);color:#cde;';
  b.addEventListener('click', onClick);
  return b;
}

export function practiceStatus(text: string, done = false) {
  const chip = chipBody();
  if (!chip) return;
  let el = chip.querySelector('.nge-practice-status') as HTMLElement | null;
  if (!el) {
    el = document.createElement('p');
    el.className = 'nge-practice-status';
    el.style.cssText = 'margin:10px 0 0;padding:8px 10px;border-radius:4px;font-size:0.92em;line-height:1.4;'
      + 'background:rgba(53,181,255,0.10);border-left:2px solid rgba(53,181,255,0.75);color:#d0e8ff;';
    chip.appendChild(el);
  }
  el.textContent = text;
  el.style.background = done ? 'rgba(96,192,96,0.14)' : 'rgba(53,181,255,0.10)';
  el.style.borderLeftColor = done ? '#60c060' : 'rgba(53,181,255,0.75)';
  el.style.fontWeight = done ? '600' : '';
  // Stuck? One button opens a small panel with the ways out (Amy).
  let help = chip.querySelector('.nge-practice-help') as HTMLElement | null;
  if (!help) {
    help = smallButton('nge-practice-help', "I'm stuck", () => toggleStuckPanel());
    chip.appendChild(help);
  }
  help.style.display = done ? 'none' : '';
  const stuck = chip.querySelector('.nge-practice-stuck') as HTMLElement | null;
  if (stuck && done) stuck.remove();
  const place = chip.querySelector('.nge-practice-place') as HTMLElement | null;
  if (place) place.style.display = done ? 'none' : '';
  // The chip just grew; keep it on screen.
  document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
}

function notePanel(cls: string, html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.style.cssText = 'margin:8px 0 0;padding:10px 12px;border-radius:6px;font-size:0.9em;line-height:1.45;'
    + 'background:rgba(8,12,24,0.9);border:1px solid rgba(74,158,255,0.35);color:#d0e8ff;';
  el.innerHTML = html;
  return el;
}

function toggleStuckPanel() {
  const chip = chipBody();
  if (!chip) return;
  const existing = chip.querySelector('.nge-practice-stuck');
  if (existing) { existing.remove(); document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp')); return; }
  const panel = notePanel('nge-practice-stuck',
    '<div style="font-weight:600;margin-bottom:6px">Stuck? Three ways out.</div>'
    + '<div style="margin:4px 0">1. The merge and cut tools act on the <b>segmentation layer</b>, the chip at the top of the viewer. Press <kbd>2</kbd> or right-click it to select it.</div>'
    + '<div style="margin:4px 0">2. Ask people in the community chat. Someone is usually around.</div>'
    + '<div style="margin:4px 0">3. Ask Nurro, the AI guide. It knows this tutorial and the tools.</div>');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:0 4px;margin-top:6px';
  row.appendChild(smallButton('nge-practice-stuck-layer', 'Show me the layer', () => document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer'))));
  const ex = currentPractice().example;
  if (!ex || ex.kind === 'merge_then_cut') {
    row.appendChild(smallButton('nge-practice-stuck-where', 'Show me where to click', async () => {
      ensureTool('merge');
      const shown = await showWhereToClick();
      if (!shown) { practiceStatus('No click hints for this cell yet. Ctrl+click anywhere on the yellow branch, then anywhere on the purple cell near it.'); return; }
      const placed = ex?.point_a && ex?.point_b ? placeMergeLine() : false;
      practiceStatus(placed
        ? 'Pyr marks the two spots and the merge line is already placed. Press Submit merge, or Enter.'
        : 'Pyr marks the two spots: Ctrl+click the one on the yellow branch, then the one on the purple cell, then Submit merge.');
    }));
  }
  row.appendChild(smallButton('nge-practice-stuck-chat', 'Ask in chat', () => document.dispatchEvent(new CustomEvent('nge:open-chat'))));
  row.appendChild(smallButton('nge-practice-stuck-ai', 'Ask Nurro', () => (document.querySelector('.nge-ask-btn') as HTMLElement | null)?.click()));
  panel.appendChild(row);
  chip.appendChild(panel);
  document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
}

/** "Place the merge points for me": the registered points go into the merge
 *  tool as a ready line, and the learner only has to press Submit merge.
 *  Only offered when the example carries points. */
function offerPlacePoints() {
  const chip = chipBody();
  const ex = currentPractice().example;
  if (!chip || !ex || !ex.point_a || !ex.point_b || chip.querySelector('.nge-practice-place')) return;
  const b = smallButton('nge-practice-place', 'Place the merge points for me', () => {
    ensureTool('merge');
    setTimeout(() => {
      const ok = placeMergeLine();
      practiceStatus(ok ? 'Points placed. Press Submit merge on the bar at the bottom, or Enter.'
                        : 'Could not place the points. Press M and Ctrl+click the two pieces yourself.');
    }, 700);
  });
  chip.insertBefore(b, chip.querySelector('.nge-practice-help'));
}

/** Wait for the chip to render, then keep a status line current while
 *  polling the graph until `wantMerged` matches, or the step changes.
 *  Success gets confetti once, and the black box note (Amy): a fresh mesh
 *  can render as a black box until the page is refreshed. */
export function watchPractice(wantMerged: boolean, waiting: string, finished: string) {
  const token = ++practiceWatch;
  let celebrated = false;
  const tick = async () => {
    if (token !== practiceWatch) return;
    const p = currentPractice();
    if (p.phase === 'unavailable') { practiceStatus('Practice cells need you to be signed in. Read along and press next.'); return; }
    if (p.phase === 'busy') { waitForCell(wantMerged ? 'merge_then_cut' : 'cut', wantMerged, waiting, finished); return; }
    if (p.phase === 'released') { return; }
    if (!p.example) { practiceStatus('Loading a practice cell…'); setTimeout(tick, 1000); return; }
    const merged = await piecesMerged();
    if (token !== practiceWatch) return;
    if (merged === wantMerged) {
      hidePyrMarkers();
      practiceStatus(finished + ' If a black box appears where the pieces meet, the new mesh is still being built: click the Pyr logo top left to refresh, your place here is saved.', true);
      if (!celebrated) { celebrated = true; document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate')); }
      return;
    }
    practiceStatus(waiting);
    if (wantMerged) offerPlacePoints();
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 600);
}

export function stopWatching() { practiceWatch++; leaveWaitlist(); hidePyrMarkers(); }

// Idle countdown under the status line (Amy): appears after a quiet minute,
// and at zero the cell is undone and released.
document.addEventListener('nge:practice-countdown', ((e: CustomEvent) => {
  const chip = chipBody();
  if (!chip) return;
  const secs = e.detail?.seconds as number | null;
  let el = chip.querySelector('.nge-practice-countdown') as HTMLElement | null;
  if (secs == null) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('p');
    el.className = 'nge-practice-countdown';
    el.style.cssText = 'margin:8px 0 0;padding:6px 10px;border-radius:4px;font-size:0.88em;line-height:1.4;'
      + 'background:rgba(245,166,35,0.12);border-left:2px solid rgba(245,166,35,0.8);color:#ffd27a;';
    chip.appendChild(el);
  }
  const m = Math.floor(secs / 60), s = String(secs % 60).padStart(2, '0');
  el.textContent = `Still there? Your practice cell goes to the next person in ${m}:${s}. Move the mouse or press a key to keep it.`;
}) as EventListener);

document.addEventListener('nge:practice-released', () => {
  practiceStatus('Your practice cell was released after five quiet minutes and put back for the next person. Press back, then next, to get a cell again.');
});

/** Every cell of this kind is held: queue up, and take the cell the moment
 *  it is our turn. The status line shows the position. */
function waitForCell(kind: PracticeKind, wantMerged: boolean, waiting: string, finished: string) {
  const token = practiceWatch;
  joinWaitlist(kind,
    () => { if (token === practiceWatch) watchPractice(wantMerged, waiting, finished); },
    (pos) => { if (token === practiceWatch) practiceStatus(pos <= 1
      ? 'You are next in line for a practice cell. It becomes yours the moment it is free.'
      : `Every practice cell is in use. You are number ${pos} in line; this box updates when one is yours. Read along meanwhile.`); });
}

/** A small (i) in the step text. Hover for the tip, click to flash the
 *  segmentation layer chip at the top of the viewer. Inline onclick works
 *  inside v-html where a Vue handler would not. */
export const INFO_LAYER = '<span class="nge-tut-info" role="button" tabindex="0"'
  + ' title="Which layer? Click for a note."'
  + ' onclick="document.dispatchEvent(new CustomEvent(\'nge:tutorial-layer-note\'))"'
  + ' style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:4px;border-radius:50%;border:1px solid #7ecaff;color:#7ecaff;font-size:12px;font-weight:700;cursor:pointer;vertical-align:middle;line-height:1">i</span>';

// The (i) next to "the segmentation layer has to be selected": a note in
// the box (a browser tooltip ran off the screen and vanished), plus a flash
// of the chip it means.
document.addEventListener('nge:tutorial-layer-note', () => {
  const chip = chipBody();
  if (!chip) return;
  if (!chip.querySelector('.nge-practice-layer-note')) {
    const note = notePanel('nge-practice-layer-note',
      'The <b>segmentation layer</b> is the chip at the top of the viewer that is flashing now, the one named after the dataset, next to <b>img</b>. '
      + 'Press <kbd>2</kbd>, or right-click that chip, to select it. Tools like merge and cut only work on the selected layer.');
    chip.appendChild(note);
    document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
  }
  document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer'));
});

document.addEventListener('nge:tutorial-flash-seg-layer', () => {
  const viewer = getViewer();
  const layers: any[] = viewer?.layerManager?.managedLayers ?? [];
  const seg = layers.find(ml => (ml.layer?.constructor?.name ?? '').includes('Segmentation'));
  const chips = Array.from(document.querySelectorAll('.neuroglancer-layer-panel .neuroglancer-layer-item')) as HTMLElement[];
  // Match the chip by its label; fall back to the layer's index.
  let chip = seg ? chips.find(c => (c.textContent ?? '').includes(seg.name)) : undefined;
  if (!chip) chip = chips[Math.max(0, layers.indexOf(seg))];
  if (!chip) { console.warn('[tutorial] no layer chip to flash'); return; }
  // The layer bar clips box shadows, so flash the chip itself: background,
  // colour and a little scale, which stay inside the bar.
  const old = { bg: chip.style.background, color: chip.style.color, transform: chip.style.transform, transition: chip.style.transition, z: chip.style.zIndex };
  chip.style.transition = 'background 0.2s, transform 0.2s';
  chip.style.zIndex = '5';
  let on = false;
  const timer = setInterval(() => {
    on = !on;
    chip!.style.background = on ? '#edd040' : old.bg;
    chip!.style.color = on ? '#000' : old.color;
    chip!.style.transform = on ? 'scale(1.12)' : old.transform;
  }, 320);
  setTimeout(() => {
    clearInterval(timer);
    Object.assign(chip!.style, { background: old.bg, color: old.color, transform: old.transform, transition: old.transition, zIndex: old.z });
  }, 3500);
});

// A step's html can ask to start another tutorial (the merge tutorial's last
// step invites the learner to the cut one).
document.addEventListener('nge:tutorial-start', ((e: CustomEvent) => {
  const id = Number(e.detail?.id);
  if (!Number.isFinite(id)) return;
  const store = useTutorialStore();
  store.activeTutorial = id;
  store.setTutorialStep(0);
}) as EventListener);

export function startTutorialButton(id: number, label: string) {
  return `<button onclick="document.dispatchEvent(new CustomEvent('nge:tutorial-start',{detail:{id:${id}}}))"`
    + ' style="margin-top:12px;padding:8px 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;'
    + 'background:rgba(96,192,96,0.18);border:1px solid rgba(96,192,96,0.6);color:#d6ffd6">' + label + '</button>';
}

/** Two captioned pictures side by side, inline styled because the step
 *  html is rendered outside TutorialStep's scoped CSS. Each opens full size
 *  in a new tab (Amy: keep the examples open while working). */
export function beforeAfter(before: string, beforeCaption: string, after: string, afterCaption: string) {
  const fig = (src: string, cap: string) =>
    `<figure style="margin:0;flex:1 1 0;min-width:0">`
    + `<a href="${src}" target="_blank" rel="noopener" title="Open in a new tab">`
    + `<img src="${src}" alt="${cap}" style="display:block;width:100%;height:auto;border-radius:4px;border:1px solid rgba(74,158,255,0.25)">`
    + `</a>`
    + `<figcaption style="margin-top:6px;font-size:0.85em;line-height:1.35;color:#9fd0ff">${cap}`
    + ` <a href="${src}" target="_blank" rel="noopener" style="color:#7ecaff;white-space:nowrap">open in new tab ↗</a></figcaption>`
    + `</figure>`;
  return `<div style="display:flex;gap:12px;align-items:flex-start;margin-top:14px">${fig(before, beforeCaption)}${fig(after, afterCaption)}</div>`;
}

/** Where the cheat sheet lives on the web, to keep open beside the viewer. */
export const CHEAT_SHEET_URL = 'https://connectome.quest/proofreading/';

/** A tidy two-column cheat sheet (Amy: the markdown table ran its columns
 *  together). Keys sit in key caps; the link opens the same sheet on
 *  connectome.quest in a new tab. */
export function cheatSheet(rows: Array<[string, string]>) {
  const key = (k: string) => /^[A-Z]$|^Enter$|^Ctrl\+Click$/.test(k)
    ? `<kbd style="display:inline-block;padding:2px 8px;border-radius:4px;border:1px solid rgba(126,202,255,0.5);background:rgba(126,202,255,0.10);font:inherit;font-size:0.9em;color:#d0e8ff">${k}</kbd>`
    : k;
  const tr = (a: string, b: string) =>
    `<tr><td style="padding:6px 18px 6px 0;white-space:nowrap;color:#d0e8ff">${a}</td><td style="padding:6px 0;color:#9fd0ff">${key(b)}</td></tr>`;
  return `<table style="border-collapse:collapse;margin:10px 0 4px;font-size:0.95em;line-height:1.3">${rows.map(r => tr(r[0], r[1])).join('')}</table>`
    + `<p style="margin:6px 0 0;font-size:0.85em"><a href="${CHEAT_SHEET_URL}" target="_blank" rel="noopener" style="color:#7ecaff">Open the cheat sheet in a new tab ↗</a></p>`;
}

export const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};

export const OVER_3D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.75,
  y: 0.15,
};

export const OVER_2D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.25,
  y: 0.15,
};

export const steps: Step[] = [
  // 1: Welcome
  {
    title: "Merge",
    text: `
AI reconstructions of neurons are impressive, but they're not perfect. Sometimes the AI misses a branch entirely, leaving a neuron incomplete.

A <strong style="color:#60c060">merge</strong> joins two separate segments that actually belong to the same neuron. Every merge you make reconnects a lost branch and improves the connectome, the wiring diagram of the brain.`,
    position: MIDDLE,
    width: "480px",
    image: imgSynapsesTutorial,
    nextLabel: "Let's learn!",
  },

  // 2: What is merge?
  {
    title: "What a merge fixes",
    text: `
Like this one: the yellow branch belongs to the purple cell, but the AI left it as its own segment. You will fix it in a moment.`,
    position: MIDDLE,
    width: "560px",
    image: imgMergeExample,
  },

  // 3: Activating merge, on the learner's own cell
  {
    title: "How to Merge",
    text: `
Let's jump to an area that needs a merge. The purple cell behind this box has a yellow branch the AI left off it. It is yours to practice on until the end of this tutorial.

Press the **M** key to start the merge tool. The segmentation layer has to be selected for that. ` + INFO_LAYER + `

You can also start it from the toolbar at the top of the screen. Once it's on, the merge tool appears at the bottom of the viewer.`,
    position: OVER_3D,
    width: "450px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Press M, then Ctrl+click the yellow branch and the purple cell.', 'Merge success! You did it. The branch is part of the cell now.');
      // Point at the segmentation layer chip without being asked (Amy).
      setTimeout(() => document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer')), 1500);
      const ex = await beginPractice('merge_then_cut');
      // No cell free (or not signed in): show Amy's example to look at.
      if (!ex) {
        await useLayersStore().loadState(STATE_MERGE_EXAMPLE);
        colorFirstTwoVisible('pinky_nf_v2');
      }
    },
  },

  // 4: Another merge, on a second cell
  {
    title: "Let's try another merge",
    text: `
This time an axon is missing a branch. The purple axon behind this box lost the yellow piece; the AI left it as its own segment.

1. Press **M** if the merge tool is off.
2. **Ctrl+Click** the yellow piece.
3. **Ctrl+Click** the purple axon, close to where the piece should join it.
4. Press **Submit merge** on the bar at the bottom, or press **Enter**.

You'll see "trying..." and then "done", and the piece turns purple.`,
    position: OVER_3D,
    width: "420px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Waiting for your merge: Ctrl+click yellow, Ctrl+click purple, Submit merge.', 'Merge success! You did it again. The piece is part of the axon now.');
      // A second merge cell, held alongside the first; both go back at the
      // end. With one registered, the same cell is shown again (already merged).
      await beginPractice('merge_then_cut', 'start', { slot: 'b' });
      setTimeout(() => ensureTool('merge'), 400);
    },
  },

  // 5: Merge tips
  {
    title: "Merge Tips",
    text: `
- Not sure two pieces belong together? The **2D panel** on the left shows the raw electron microscope slices. Scroll through them at the join for context the 3D can't give you.
- If a merge fails, try clicking at a slightly different spot on each piece.
- Merged the wrong piece? There is no undo key. Fix it with a <strong style="color:#e06060">cut</strong> between the two pieces, which the Cut tutorial teaches.

Merged already? Press next.`,
    position: OVER_2D,
    width: "400px",
    onEnter: () => {
      watchPractice(true, 'Waiting for your merge: Ctrl+click yellow, Ctrl+click purple, Submit merge.', 'Merge success! You did it. The piece is part of the axon now.');
    },
  },

  // 6: Done, and on to cuts
  {
    title: "Merge: done!",
    text: `
You know how to merge. Every merge reconnects a lost branch, and there are thousands waiting.

Next up is the other half of proofreading: a <strong style="color:#e06060">cut</strong> separates two neurons the AI fused together.
` + startTutorialButton(5, 'Start the Cut tutorial') + `

Or press done and explore. The cell you practised on is put back for the next person.
` + cheatSheet([
      ['<strong style="color:#60c060">Merge</strong> tool', 'M'],
      ['Place a point', 'Ctrl+Click'],
      ['Submit', 'Enter'],
      ['Fix a bad merge', 'Cut it apart'],
    ]),
    position: MIDDLE,
    width: "480px",
    image: imgBravoNurro,
    onEnter: () => {
      stopWatching();
      // Whatever state the practice cell is in, put it back for the next person.
      endPractice();
    },
  },
];
