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
import { ngeGrapheneCutPreview, ngeGrapheneCutGraph, ngeGrapheneBoxesOf, ngeGraphenePiecesOf } from 'neuroglancer/datasource/graphene/frontend';
import { spreadSides, cutSideBlocks, sidesOfGroups, localBlocks, sampleBits, certainPieces, mergeBlocks } from './cut_sides';
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
    // The rest of the cell: colour spreads from pieces whose side is certain.
    // A point placed in 3D carries the cell's ID, not a supervoxel's, and has
    // no block of its own: only points that are supervoxels are asked about.
    const redPicks = got.redPicks.filter(x => boxes.has(x)), bluePicks = got.bluePicks.filter(x => boxes.has(x));
    const asked = [...new Set([...sampleBits(sides.red, sides.blue, boxes), ...redPicks, ...bluePicks])];
    const pieceOf = await ngeGraphenePiecesOf(layer, asked);
    if (mine !== run) return;
    const askedSet = new Set(asked);
    const known = certainPieces(
        [...sides.red.filter(x => askedSet.has(x)), ...redPicks], [...sides.blue.filter(x => askedSet.has(x)), ...bluePicks], pieceOf);
    const graph = await ngeGrapheneCutGraph(layer, got.rootId);
    if (mine !== run) return;
    const side = spreadSides(graph.edges, known);
    const blocks = mergeBlocks(cutSideBlocks(side, graph.boxes), near);
    Object.assign(say, {
      redSupervoxels: sides.red.length, blueSupervoxels: sides.blue.length, supervoxelsPlaced: boxes.size,
      nearBlocks: { red: near.filter(x => x.side === 'red').length, blue: near.filter(x => x.side === 'blue').length, both: near.filter(x => x.side === 'both').length },
      piecesAsked: asked.length, piecesAnswered: pieceOf.size, certainPieces: known.size,
      cellPieces: new Set(graph.edges.flat()).size, piecesColoured: side.size,
      blocks: { red: blocks.filter(x => x.side === 'red').length, blue: blocks.filter(x => x.side === 'blue').length, both: blocks.filter(x => x.side === 'both').length },
    });
    console.info('[cut preview]', JSON.stringify(say));
    if (!blocks.length) {
      StatusMessage.showTemporaryMessage('Could not place the preview on this cell. The cut itself is not affected.', 8000);
      return;
    }
    setExtraTintBoxes(blocks.map(b => ({ box: b.box, rgb: b.side === 'red' ? RED : b.side === 'blue' ? BLUE : BOTH })));
    showing = true;
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
  window.addEventListener('nge-cut-preview', (e: Event) => { void preview((e as CustomEvent).detail?.layer); });
  window.addEventListener('nge-cut-preview-clear', clear);
}
