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
import { ngeGrapheneCutPreview, ngeGrapheneBranchGraph } from 'neuroglancer/datasource/graphene/frontend';
import { cutSides, piecesFromPreview, type Side } from './cut_sides';
import { setExtraTintLines } from './highlight';

const RED = [255, 72, 72];
const BLUE = [72, 120, 255];

/** Bumped by every new preview and every clear, so a slow answer that is no
 *  longer wanted is dropped when it arrives. */
let run = 0;
let showing = false;

function clear() {
  run++;
  if (!showing) return;
  showing = false;
  setExtraTintLines(null);
}

async function preview(layer: any) {
  const mine = ++run;
  const status = new StatusMessage();
  status.setText('Working out where the cut would fall…');
  try {
    const got = await ngeGrapheneCutPreview(layer);
    if (mine !== run) return;
    if (got.illegal) {
      setExtraTintLines(null);
      showing = false;
      StatusMessage.showTemporaryMessage('The server says these points cannot be cut apart. Try moving them or adding more.', 9000);
      return;
    }
    const graph = await ngeGrapheneBranchGraph(layer, got.rootId);
    if (mine !== run) return;
    const known: Map<string, Side> = piecesFromPreview(got.redBits, got.blueBits, got.pieceOf);
    // Where the points themselves sit is certain, whatever the counting said.
    for (const bit of got.redPicks) { const p = got.pieceOf.get(bit); if (p) known.set(p, 'red'); }
    for (const bit of got.bluePicks) { const p = got.pieceOf.get(bit); if (p && known.get(p) !== 'red') known.set(p, 'blue'); }
    const sides = cutSides(graph.edges, graph.points, known);
    if (!sides.lines.length) {
      StatusMessage.showTemporaryMessage('Could not place the preview on this cell. The cut itself is not affected.', 8000);
      return;
    }
    setExtraTintLines(sides.lines.map(l => ({ a: l.a, b: l.b, rgb: l.side === 'red' ? RED : BLUE })));
    showing = true;
    // For checking from the console and in tests.
    (window as any).__ngeCutPreview = { red: sides.red, blue: sides.blue, lines: sides.lines.length, knownPieces: known.size, mappedAll: got.mappedAll };
    StatusMessage.showTemporaryMessage(
        'Preview: red stays with the red points, blue goes with the blue ones. Nothing has been cut.', 7000);
  } catch (e: any) {
    if (mine !== run) return;
    console.warn('[cut preview]', e);
    StatusMessage.showTemporaryMessage(`No preview: ${e?.message || 'the server did not answer'}. The cut itself is not affected.`, 9000);
  } finally {
    status.dispose();
  }
}

/** While this is a test the Preview button is hidden. Opening the game once
 *  with ?cutpreview=1 in the address switches it on in this browser, and
 *  ?cutpreview=0 switches it off again. */
const TEST_KEY = 'nge-cut-preview-test';
function testSwitchedOn(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get('cutpreview');
    if (asked === '1') localStorage.setItem(TEST_KEY, '1');
    if (asked === '0') localStorage.removeItem(TEST_KEY);
    return localStorage.getItem(TEST_KEY) === '1';
  } catch { return false; }
}

export function startCutPreview() {
  (window as any).ngeCutPreviewTest = testSwitchedOn();
  window.addEventListener('nge-cut-preview', (e: Event) => { void preview((e as CustomEvent).detail?.layer); });
  window.addEventListener('nge-cut-preview-clear', clear);
}
