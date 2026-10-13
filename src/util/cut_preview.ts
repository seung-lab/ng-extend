/**
 * Cut preview, a TEST (Nseraf 2026-10-11: "colour the 3D based on red/blue
 * points during split ... easier to see that you have selected appropriate
 * supervoxels").
 *
 * The Preview button in the cut tool asks the server what the cut WOULD do,
 * without making it, and paints the cell in 3D: red for what would stay with
 * the red points, blue for what would go with the blue ones. The colours are
 * the same surface tint Highlight mode uses, so nothing is added to the view
 * or saved, and they go when the points change, when the cut is sent and when
 * the tool closes.
 *
 * How: the server lists the smallest bits of the cell on each side near the
 * points. Each bit belongs to one piece of the cell, the pieces are linked to
 * their neighbours, and the colour spreads outward along those links from
 * both sides at once, never across the cut (cut_sides.ts).
 */
import { StatusMessage } from 'neuroglancer/status';
import { ngeGrapheneCutPreview, ngeGrapheneCutGraph, ngeGrapheneBoxesOf, ngeGrapheneCutVoxels, ngeReadSideVoxels, type NgeCutVoxels } from 'neuroglancer/datasource/graphene/frontend';
import { setNgeMeshTintFine } from 'neuroglancer/mesh/nge_tint';
import { mat4 } from 'neuroglancer/util/geom';
import { buildFineGrid } from './cut_fine';
import { spreadSides, cutSideBlocks, sidesOfGroups, localBlocks, mergeBlocks, piecesFromBlocks, fillMissingSide } from './cut_sides';
import { setExtraTintBoxes } from './highlight';

const RED = [255, 64, 64];
const BLUE = [64, 110, 255];
/** A block that holds parts of both sides: the cut passes through it. */
const BOTH = [255, 232, 150];

/** Bumped by every new preview and every clear, so a slow answer that is no
 *  longer wanted is dropped when it arrives. */
let run = 0;
let showing = false;

function clear() {
  run++;
  if (!showing) return;
  showing = false;
  setExtraTintBoxes(null);
  setNgeMeshTintFine(null);
  redraw();
}

const redraw = () => { try { (window as any).viewer?.display?.scheduleRedraw(); } catch { /* no viewer */ } };

/** The fine picture: the supervoxels themselves, read from the volume round
 *  the points, drawn over the blocks. Says what happened; never throws. */
async function drawFine(layer: any, red: string[], blue: string[], paleBoxes: number[][], stillWanted: () => boolean,
                        read: () => Promise<NgeCutVoxels> = () => ngeGrapheneCutVoxels(layer, red, blue)): Promise<Record<string, unknown>> {
  try {
    const vox = await read();
    const said: Record<string, unknown> = {
      stored: vox.stored, files: vox.files, voxelsMarked: vox.marked, voxelNm: vox.voxelNm, voxels: vox.dims, drawn: false, why: vox.why,
    };
    if (!stillWanted() || !vox.ok) return said;
    const grid = buildFineGrid(vox, paleBoxes, RED, BLUE);
    if (!grid) { said.why = 'None of the voxels round the points belong to a supervoxel in the server\'s answer.'; return said; }
    const scalesNm: number[] = Array.from((window as any).viewer.coordinateSpace.value.scales as Float64Array).slice(0, 3).map(x => x / 1e-9);
    // Global coordinates to the grid's own, 0 to 1: (p * scaleNm - lo) / (dims * cell).
    const m = mat4.create();
    for (let i = 0; i < 3; i++) {
      m[i * 5] = scalesNm[i] / (grid.dims[i] * grid.cellNm[i]);
      m[12 + i] = -grid.loNm[i] / (grid.dims[i] * grid.cellNm[i]);
    }
    setNgeMeshTintFine({ data: grid.data, dims: grid.dims, gridFromGlobal: m });
    redraw();
    Object.assign(said, { drawn: true, cells: grid.dims, cellNm: grid.cellNm.map(v => Math.round(v)), exact: grid.exact, carried: grid.filled });
    return said;
  } catch (e: any) {
    return { drawn: false, why: String(e?.message || e) };
  }
}

async function preview(layer: any) {
  const mine = ++run;
  const status = new StatusMessage();
  status.setText('Working out where the cut would fall…');
  try {
    const got = await ngeGrapheneCutPreview(layer);
    if (mine !== run) return;
    if (got.illegal) {
      setExtraTintBoxes(null);
      showing = false;
      StatusMessage.showTemporaryMessage('The server says these points cannot be cut apart. Try moving them or adding more.', 9000);
      return;
    }
    // Which group is which side: by the points each group holds.
    const sides = sidesOfGroups(got.groups, got.redPicks, got.bluePicks);
    const say: Record<string, unknown> = {
      groups: sides.groups, toldApartBy: sides.how, redPoints: got.redPicks.length, bluePoints: got.bluePicks.length,
    };
    (window as any).__ngeCutPreview = say;
    if (sides.how === 'none') {
      console.error('[cut preview] could not tell the sides apart', JSON.stringify(say));
      StatusMessage.showTemporaryMessage('The server answered, but its answer does not say which side is red and which is blue. The cut itself is not affected.', 9000);
      return;
    }
    // Near the cut, straight from the supervoxels: the block each is in.
    const boxes = await ngeGrapheneBoxesOf(layer, [...sides.red, ...sides.blue]);
    if (mine !== run) return;
    const near = localBlocks(sides.red, sides.blue, boxes);
    // The rest of the cell: colour spreads from the pieces lying in those
    // blocks, and never through a piece the cut passes through. Nothing
    // more is asked of the server than the cell's own map of pieces.
    const graph = await ngeGrapheneCutGraph(layer, got.rootId);
    if (mine !== run) return;
    const { known, barriers } = piecesFromBlocks(near, graph.boxes);
    const side = spreadSides(graph.edges, known, 120, barriers);
    const filled = fillMissingSide(graph.edges, side, barriers);
    const blocks = mergeBlocks(cutSideBlocks(side, graph.boxes), near);
    const count = (list: { side: string }[]) => ({ red: list.filter(x => x.side === 'red').length, blue: list.filter(x => x.side === 'blue').length, both: list.filter(x => x.side === 'both').length });
    let redPieces = 0, bluePieces = 0;
    for (const v of side.values()) { if (v === 'red') redPieces++; else bluePieces++; }
    Object.assign(say, {
      redSupervoxels: sides.red.length, blueSupervoxels: sides.blue.length, supervoxelsPlaced: boxes.size,
      nearBlocks: count(near), startPieces: count([...known.values()].map(v => ({ side: v }))), cutPieces: barriers.size,
      cellPieces: graph.boxes.size, piecesColoured: { red: redPieces, blue: bluePieces }, sideFilledIn: filled,
      blocks: count(blocks),
    });
    if (!blocks.length) {
      console.info('[cut preview]', JSON.stringify(say));
      StatusMessage.showTemporaryMessage('Could not place the preview on this cell. The cut itself is not affected.', 8000);
      return;
    }
    setExtraTintBoxes(blocks.map(b => ({ box: b.box, rgb: b.side === 'red' ? RED : b.side === 'blue' ? BLUE : BOTH })));
    showing = true;
    // The blocks are up; now the supervoxels themselves, where the cut is.
    const fine = await drawFine(layer, sides.red, sides.blue, blocks.filter(b => b.side === 'both').map(b => b.box), () => mine === run);
    say.supervoxels = fine;
    console.info('[cut preview]', JSON.stringify(say));
    if (mine !== run) { setNgeMeshTintFine(null); return; }
    if (fine.drawn) {
      StatusMessage.showTemporaryMessage(
          'Preview: red stays with the red points, blue goes with the blue ones, drawn from the supervoxels round your points. Nothing has been cut.', 9000);
      return;
    }
    console.warn('[cut preview] the supervoxels could not be drawn:', fine.why);
    StatusMessage.showTemporaryMessage(
        'Preview: red stays with the red points, blue goes with the blue ones. The pale stretch holds both, so the cut falls inside it. Nothing has been cut.', 9000);
  } catch (e: any) {
    if (mine !== run) return;
    console.warn('[cut preview]', e?.message || e);
    StatusMessage.showTemporaryMessage(`No preview: ${e?.message || 'the server did not answer'}. The cut itself is not affected.`, 9000);
  } finally {
    status.dispose();
  }
}

/** While this is a test the Preview button is hidden. Opening the game once
 *  with ?cutpreview=1 in the address switches it on in this browser, and
 *  ?cutpreview=0 switches it off again. */
const TEST_KEY = 'nge-cut-preview-test';
export function cutPreviewTestOn(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get('cutpreview');
    if (asked === '1') localStorage.setItem(TEST_KEY, '1');
    if (asked === '0') localStorage.removeItem(TEST_KEY);
    return localStorage.getItem(TEST_KEY) === '1';
  } catch { return false; }
}

export function startCutPreview() {
  (window as any).ngeCutPreviewTest = cutPreviewTestOn();
  // While it is a test: paint blocks by hand from the console, to look at the
  // colouring itself without a cut (boxes in nanometres, rgb 0 to 255).
  if ((window as any).ngeCutPreviewTest) (window as any).__ngeCutPreviewPaint = (boxes: { box: number[]; rgb: number[] }[] | null) => setExtraTintBoxes(boxes);
  // And the fine picture on any plainly stored volume: read the voxels of a
  // region, mark two lists of ids red and blue, and draw them.
  if ((window as any).ngeCutPreviewTest) {
    (window as any).__ngeCutPreviewVoxels = (dataUrl: string, scales: any[], lo: number[], hi: number[], red: string[], blue: string[], pale: number[][] = []) =>
        drawFine(null, red, blue, pale, () => true, () => ngeReadSideVoxels(dataUrl, scales, lo, hi, red, blue));
  }
  window.addEventListener('nge-cut-preview', (e: Event) => { void preview((e as CustomEvent).detail?.layer); });
  window.addEventListener('nge-cut-preview-clear', clear);
}
