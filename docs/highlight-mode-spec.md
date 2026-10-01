# Highlight mode: spec

Status: draft for Ames, 2026-10-01. Nothing is built yet.

## The problem

Proofreading a complex cell means checking many branches. Today players mark
the ends of branches with point annotations to remember what they have checked.
That marks a place, not a stretch of the cell, and on a big arbor it is hard to
see at a glance what is done.

## What the player gets

A **Highlight** tool. Click on the cell, and a stretch of it is marked as
checked in a color you choose. The cell fills in as you work, like coloring a
map, and what is still plain is what is left to do.

Three ways to mark:

1. **Between two points.** Click A, click B: the path between them is marked.
2. **Branch from here.** Click one point: everything from that point outward,
   away from the cell body, is marked (the whole sub branch).
3. **Back to the cell body.** Click one point: the path from there to the soma
   is marked.

Plus: undo the last mark, erase a mark by clicking it, pick the color (a few
presets: checked green, needs a look gold, problem red), and a "percent of the
cell marked" readout in the panel.

Marks belong to the player and the cell. They save with the claim (the same
place Save view and the autosave already keep annotations and layers), so they
come back when you jump back to the cell, and they travel in a shared link.

## What the code gives us today (verified)

- **Find path already does most of mode 1.** The graphene layer posts two
  (root id, position) pairs to `…/graph/find_path` and gets back
  `centroids_list`, an ordered list of points along the cell between them
  (one per level 2 chunk), and draws white line annotations through them
  (`third_party/neuroglancer/datasource/graphene/frontend.ts`, `findPath` and
  `FindPathState`). The server is told `precision_mode` on or off.
- **A segment is one color in 3D.** The mesh layer sets one color per cell and
  then draws all of its mesh pieces (`mesh/frontend.ts`, the
  `forEachVisibleSegmentToDraw` loop: `setColor` once, then `drawFragment` for
  each piece). The app's own recoloring (`segmentStatedColors`, used by the
  delta menu color picker) is also per whole cell.
- **The cell is drawn from pieces.** Each cell's mesh is a list of fragments
  from a manifest, so the draw loop is the natural place to give some pieces
  their own color. That is a small, contained change.
- **2D can already color below the cell level.** The slice views can color by
  supervoxel (`baseSegmentColoring`), and multicut paints chosen supervoxels red
  and blue.
- **We know where the cell body is.** Cell Library rows carry soma and nucleus
  coordinates (`somaCoords`, `nucCoords`), which gives "away from the cell
  body" a direction.
- **No skeletons in the app.** There is no skeleton source or skeleton call for
  graphene layers in this codebase.

## Not verified yet (needs a check against the live servers)

- Whether `find_path` also returns the level 2 ids of the path (PyChunkedGraph
  returns an `l2_path` next to `centroids_list` in the versions I know; this
  code only reads the centroids). We need the ids, not only the points, for
  true recoloring.
- Whether the level 2 graph endpoint (`…/lvl2_graph` for a root) is enabled on
  each of our CAVE servers (Retina on minnie, MEC on hc.himc-cave.com). Modes 2
  and 3 need it: "everything beyond this point" is the part of that graph cut
  off from the soma when you remove the clicked spot.
- How fine the mesh pieces are. Recently edited parts of a cell come as one
  piece per level 2 chunk, but untouched parts can come as larger pre-stitched
  pieces. If a branch is one big piece, per-piece coloring would paint more
  than the player asked for there.

## Build plan

### Stage 1: the overlay (small, no server unknowns)

Mark **between two points** only. Reuse find path, but keep the result: each
mark is a thick, colored line through the path's points, stored in a
"Checked" annotation layer on the cell.

- Looks like a highlighter stroke laid along the branch in 3D and 2D.
- Saves and shares for free (it is an annotation layer in the view).
- Undo, erase and colors are all ordinary annotation operations.
- Limits: it is a line on the cell, not the cell itself changing color, and
  only mode 1.

About 1 to 2 days. Good enough to put in front of Nseraf and the Retina
players and learn whether the idea helps.

### Stage 2: branch and back-to-soma marking

Add modes 2 and 3 using the level 2 graph. One fetch per cell (cached, refetched
after an edit), then both modes are quick graph walks in the browser. Still
drawn as the Stage 1 overlay, as a tree of strokes instead of one line.

About 2 to 3 days, if the endpoint is available on our servers.

### Stage 3: true recoloring

The marked stretch of the cell itself changes color.

- 3D: per-piece color in the mesh draw loop, keyed by the level 2 ids of each
  mark.
- 2D: supervoxel coloring for the same ids.
- Depends on the two unknowns above (ids from the server, and how fine the
  pieces are). If pieces are coarse in untouched regions we keep the overlay
  there and recolor where we can.

About a week, with the most risk.

## Things that need a decision

1. **Edits invalidate ids.** After a split or merge, level 2 ids near the edit
   change. Stage 1 marks are stored as points, so they survive edits. Stage 3
   marks should be stored as points too and turned back into ids on load.
2. **Who sees marks?** Proposed: private to the player, visible to others only
   through a shared link. Later, a reviewer could see the owner's marks.
3. **Does "marked" mean anything to the lab?** Proposed: no, it is a personal
   checklist. It does not write to the sheet or count toward completion.
4. **Where does the tool live?** Proposed: a toolbar button next to Find Path,
   with a small panel like Scout Tag mode (color, mode, undo, percent marked).

## Recommendation

Build Stage 1 now and try it with players. It is cheap, uses a server call we
already rely on, and tells us whether Stages 2 and 3 are worth the week.
