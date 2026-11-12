# Annotations tutorial (Pyr tutorial 12): proposal

Asked for by Ames on 2026-10-23. It also answers player report #220 (annkri, Idea: "need a tutorial for use of annotations"). Parked on the To do board on 2026-10-24. Nothing is built yet; waiting for her "go".

## Findings
- The only rule in the code about placing a point at every end is the Proofreading Test's (`src/proofreading-test.ts:212`, End layer, scored by `kind: 'endpoint'`). Nothing in the code is specific to bipolar cells. The open question for Ames: is that the whole rule?
- Find Path is already taught in Advanced Interface (`src/tutorial-2.ts:851`). The recommendation is to leave it out, or at most add one closing box with its video (https://youtu.be/CGooeAhSryg).
- There is no tag tool for single points. Tags are the separate top bar tool.

## Shape
- Tutorial id 12, "Annotations". In the burger menu it goes after Advanced Interface and before Ask for Edit Access.
- Annotations are local, so there is no queue. It uses the same neuron as Advanced Interface.
- Each step detects the player's action by polling `window.viewer`, as the helpers in `tutorial-2.ts` do (`nextWhenAnnotationLayerAdded`, `annotationsIn`, and others).

## Steps
Part 1 · Your first layer
1. Intro (Next).
2. Click + in the layer bar. Done when a new annotation layer appears.
3. Click the ✎ pencil (`button.nge-title-rename`) and name the layer Ends. Done when the name is /^ends$/i.
4. Ctrl+click the tips of three branches. Done when the layer has 3 points.
5. Pick a color (`input.neuroglancer-color-widget`). Done when `annotationDisplayState.color` changes.

Part 2 · Getting around
6. Use the ‹ › arrows (`.nge-ann-step`). Done after 2 presses.
7. Drag the view away, then right click point 1 in the list. Done when the view lands on that point.
8. Click a row and type a Description. Done when any point has a description.

Part 3 · More than one layer
9. Click + again and name the new layer Mergers. Done when it exists.
10. Click the Ends tab. New points go into the layer whose panel is open. Done when Ends is selected.
11. Switch to Mergers and Ctrl+click one point. Done when Mergers has 1 point.

Part 4 · Shapes and sizes
12. Learn the tool buttons (dot, big dot, Pyr gem, line, box, ellipsoid, polyline). Pick Line and Ctrl+click twice. Done when a line exists.
13. Move the Size slider (`label.nge-ann-size-row`) and read about Show through cells in 3D. Done when Size changes.
14. (Optional) Click + Folder (`.nge-ann-folder-new`) and drag a point in. Done when a folder holds a point.
15. Finish: a recap, plus a line about the Proofreading Test's end point rule.

## Open questions for Ames
- The end point rule (see Findings).
- Find Path: leave it out, or add one closing box?
- Achievement, yes or no, and a name. It needs a `special_badges` row (SQL that Ames runs).
- Keep or cut the Folders step.
- Which session is rewriting Tutorial 2 (`tutorial2-test` was not on either remote on 2026-10-23)?
